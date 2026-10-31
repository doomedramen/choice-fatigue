import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthenticationError } from "@/lib/auth-session";
import { userHasAdultGrant } from "@/lib/adult-access";
import { adultAccessEnabled } from "@/lib/adult-access-policy";
import { getGlobalSettings } from "@/lib/global-settings";
import { prisma } from "@/lib/prisma";
import { media } from "@/data";
import { recommendationComparisonsFromHistory, recommendationSignalsFromHistory } from "@/lib/recommendations";
import { getTmdbRecommendationFeatures } from "@/lib/providers/tmdb";
import { getThePornDBRecommendationFeatures, type ThePornDBKind } from "@/lib/providers/theporndb";
import { getStashDbRecommendationFeatures } from "@/lib/providers/stashdb";
import { isValidRecommendationEvent, recommendationCategories, recommendationEventMatchesCategory, type RecommendationEventInput } from "@/lib/recommendation-event-validation";
import { IntegrationRequestError, readIntegrationJson, requireSameOrigin } from "@/lib/integrations/request";

export const dynamic = "force-dynamic";


function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Recommendation history could not be loaded." }, { status: 500 });
}

function isStringId(value: string): boolean {
  return value.length > 0 && value.length <= 200;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const requestedCategory = request.nextUrl.searchParams.get("category");
    const excludeSessionId = request.nextUrl.searchParams.get("excludeSessionId");
    if (!requestedCategory || !recommendationCategories.includes(requestedCategory as (typeof recommendationCategories)[number])) return NextResponse.json({ error: "Choose a valid category." }, { status: 400 });
    const category = requestedCategory as (typeof recommendationCategories)[number];
    if (category === "Adult") {
      const [settings, adultAllowed] = await Promise.all([getGlobalSettings(), userHasAdultGrant(session.user.id)]);
      if (!adultAccessEnabled(settings.adultSectionEnabled, adultAllowed)) return NextResponse.json({ error: "The Adult category is currently disabled." }, { status: 403 });
    }
    const rows = await prisma.recommendationEvent.findMany({
      where: { userId: session.user.id, category },
      orderBy: [{ createdAt: "asc" }, { sequence: "asc" }],
      select: { id: true, sessionId: true, reviewId: true, itemId: true, eventType: true, decision: true, rating: true, targetEventId: true, category: true },
    });
    const signals = recommendationSignalsFromHistory(rows, excludeSessionId, category);
    // Comparisons are additional evidence, not a duplicate of the current session's decision signals.
    const comparisons = recommendationComparisonsFromHistory(rows, null, category);
    const profileView = request.nextUrl.searchParams.get("profile") === "1";
    const featureLimit = profileView ? 4 : 12;
    const currentCandidateIds = new Set(request.nextUrl.searchParams.getAll("candidateId").filter(isStringId).slice(0, 100));
    // The account profile summarizes choice signals. Keep its metadata budget
    // focused on those signals rather than review comparisons.
    const featureItemIds = profileView
      ? signals.map(signal => signal.itemId)
      : [...signals.map(signal => signal.itemId), ...comparisons.flatMap(comparison => [comparison.preferredItemId, comparison.removedItemId])];
    const missing = [...new Set(featureItemIds.filter(id => !currentCandidateIds.has(id)))].slice(-featureLimit);
    const loadFeatures = async (id: string) => {
      try {
        let featureKeys: string[] = [];
        const tmdb = /^tmdb-(movie|tv)-(\d{1,10})$/.exec(id);
        const theporndb = /^theporndb-(scene|movie)-([A-Za-z0-9_-]{1,128})$/.exec(id);
        const stashdb = /^stashdb-([A-Za-z0-9_-]{1,160})$/.exec(id);
        if (tmdb) featureKeys = await getTmdbRecommendationFeatures(tmdb[1] as "movie" | "tv", Number(tmdb[2]));
        else if (theporndb) featureKeys = await getThePornDBRecommendationFeatures(theporndb[1] as ThePornDBKind, theporndb[2]);
        else if (stashdb) featureKeys = await getStashDbRecommendationFeatures(stashdb[1]);
        return [id, featureKeys] as const;
      } catch {
        return [id, [] as string[]] as const;
      }
    };
    const featurePairs: Array<readonly [string, string[]]> = [];
    for (let index = 0; index < missing.length; index += 4) {
      featurePairs.push(...await Promise.all(missing.slice(index, index + 4).map(loadFeatures)));
    }
    const featureKeysById = new Map(featurePairs);
    const enrichedSignals = signals.map(signal => ({ ...signal, ...(featureKeysById.has(signal.itemId) ? { featureKeys: featureKeysById.get(signal.itemId) } : {}) }));
    const enrichedComparisons = comparisons.map(comparison => ({
      ...comparison,
      ...(featureKeysById.has(comparison.preferredItemId) ? { preferredFeatureKeys: featureKeysById.get(comparison.preferredItemId) } : {}),
      ...(featureKeysById.has(comparison.removedItemId) ? { removedFeatureKeys: featureKeysById.get(comparison.removedItemId) } : {}),
    }));
    return NextResponse.json({ signals: enrichedSignals, comparisons: enrichedComparisons }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let session;
  try {
    requireSameOrigin(request);
    session = await requireSession();
  } catch (error) {
    return errorResponse(error);
  }
  try {
    const value = await readIntegrationJson(request, 256 * 1024);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !Array.isArray((value as Record<string, unknown>).events)) {
      return NextResponse.json({ error: "Recommendation events have an invalid shape." }, { status: 400 });
    }
    const events = (value as { events: unknown[] }).events;
    if (events.length > 500 || !events.every(isValidRecommendationEvent)) return NextResponse.json({ error: "Recommendation events have an invalid value." }, { status: 400 });
    if (new Set(events.map(event => (event as RecommendationEventInput).id)).size !== events.length) return NextResponse.json({ error: "Recommendation event IDs must be unique." }, { status: 400 });
    const adultEvents = events.some(event => (event as RecommendationEventInput).category === "Adult");
    if (adultEvents) {
      const [settings, adultAllowed] = await Promise.all([getGlobalSettings(), userHasAdultGrant(session.user.id)]);
      if (!adultAccessEnabled(settings.adultSectionEnabled, adultAllowed)) return NextResponse.json({ error: "The Adult category is currently disabled." }, { status: 403 });
    }
    const categoriesById = new Map<string, string>(media.map(fixture => [fixture.id, fixture.category]));
    for (const event of events as RecommendationEventInput[]) {
      if (!recommendationEventMatchesCategory(event, categoriesById)) return NextResponse.json({ error: "An event contains a title from another category." }, { status: 400 });
    }
    const data = (events as RecommendationEventInput[]).map(event => ({ ...event, candidateIds: event.candidateIds ?? undefined, userId: session.user.id }));
    if (data.length) await prisma.recommendationEvent.createMany({ data, skipDuplicates: true });
    return NextResponse.json({ acceptedIds: data.map(event => event.id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const session = await requireSession();
    await prisma.recommendationEvent.deleteMany({ where: { userId: session.user.id } });
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
