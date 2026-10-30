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
import { IntegrationRequestError, readIntegrationJson, requireSameOrigin } from "@/lib/integrations/request";

export const dynamic = "force-dynamic";

const categories = ["Movies", "Shows", "Adult"] as const;
const eventTypes = ["candidate_set", "item_shown", "decision", "decision_undone", "shortlist_withdrawn", "review_started", "review_removed", "review_restored", "review_kept", "saved", "review_abandoned", "session_ended"] as const;
const algorithmVersions = ["content-v1", "content-v2"] as const;
type RecommendationEventInput = {
  id: string; sessionId: string; reviewId: string | null; sequence: number; itemId: string | null; candidateIds?: string[] | null;
  category: typeof categories[number]; eventType: typeof eventTypes[number]; decision: "keep" | "pass" | "seen" | null;
  rating: number | null; targetEventId: string | null; algorithmVersion: (typeof algorithmVersions)[number];
};

function isStringId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function providerCategoryForId(id: string) {
  if (/^tmdb-movie-\d{1,10}$/.test(id)) return "Movies";
  if (/^tmdb-tv-\d{1,10}$/.test(id)) return "Shows";
  if (/^theporndb-(?:scene|movie)-[A-Za-z0-9_-]{1,128}$/.test(id) || /^stashdb-[A-Za-z0-9_-]{1,160}$/.test(id)) return "Adult";
  return null;
}

function validEvent(value: unknown): value is RecommendationEventInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const keys = ["id", "sessionId", "reviewId", "sequence", "itemId", "candidateIds", "category", "eventType", "decision", "rating", "targetEventId", "algorithmVersion"];
  const legacyKeys = keys.filter(key => key !== "candidateIds");
  if (!(Object.keys(event).length === keys.length || Object.keys(event).length === legacyKeys.length) || Object.keys(event).some(key => !keys.includes(key))) return false;
  if (!isStringId(event.id) || !isStringId(event.sessionId) || !(event.reviewId === null || isStringId(event.reviewId))) return false;
  if (!Number.isSafeInteger(event.sequence) || Number(event.sequence) < 0) return false;
  if (!(event.itemId === null || isStringId(event.itemId)) || !categories.includes(event.category as typeof categories[number])) return false;
  if (!(event.candidateIds === undefined || event.candidateIds === null || Array.isArray(event.candidateIds) && event.candidateIds.length <= 100 && event.candidateIds.every(isStringId) && new Set(event.candidateIds).size === event.candidateIds.length)) return false;
  if (!eventTypes.includes(event.eventType as typeof eventTypes[number])) return false;
  if (!(event.decision === null || event.decision === "keep" || event.decision === "pass" || event.decision === "seen")) return false;
  if (!(event.rating === null || Number.isInteger(event.rating) && Number(event.rating) >= 1 && Number(event.rating) <= 5)) return false;
  if ((event.decision !== "seen" && event.rating !== null) || (event.decision === null && event.rating !== null)) return false;
  if (!(event.targetEventId === null || isStringId(event.targetEventId)) || !algorithmVersions.includes(event.algorithmVersion as (typeof algorithmVersions)[number])) return false;
  if (event.eventType === "candidate_set") return event.itemId === null && Array.isArray(event.candidateIds) && event.candidateIds.length > 0;
  if (event.eventType === "item_shown") return isStringId(event.itemId) && (event.candidateIds === undefined || event.candidateIds === null || event.candidateIds[0] === event.itemId);
  if (event.eventType === "decision") return isStringId(event.itemId) && event.decision !== null && (event.decision !== "seen" || event.rating !== null);
  if (event.decision !== null || event.rating !== null) return false;
  if (["decision_undone", "shortlist_withdrawn", "review_removed", "review_restored", "review_kept", "saved"].includes(event.eventType as string)) return isStringId(event.itemId);
  return true;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Recommendation history could not be loaded." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const requestedCategory = request.nextUrl.searchParams.get("category");
    const excludeSessionId = request.nextUrl.searchParams.get("excludeSessionId");
    if (!requestedCategory || !categories.includes(requestedCategory as typeof categories[number])) return NextResponse.json({ error: "Choose a valid category." }, { status: 400 });
    const category = requestedCategory as typeof categories[number];
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
    const currentCandidateIds = new Set(request.nextUrl.searchParams.getAll("candidateId").filter(isStringId).slice(0, 100));
    const featureItemIds = [...signals.map(signal => signal.itemId), ...comparisons.flatMap(comparison => [comparison.preferredItemId, comparison.removedItemId])];
    const missing = [...new Set(featureItemIds.filter(id => !currentCandidateIds.has(id)))].slice(-12);
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
    if (events.length > 500 || !events.every(validEvent)) return NextResponse.json({ error: "Recommendation events have an invalid value." }, { status: 400 });
    if (new Set(events.map(event => (event as RecommendationEventInput).id)).size !== events.length) return NextResponse.json({ error: "Recommendation event IDs must be unique." }, { status: 400 });
    const adultEvents = events.some(event => (event as RecommendationEventInput).category === "Adult");
    if (adultEvents) {
      const [settings, adultAllowed] = await Promise.all([getGlobalSettings(), userHasAdultGrant(session.user.id)]);
      if (!adultAccessEnabled(settings.adultSectionEnabled, adultAllowed)) return NextResponse.json({ error: "The Adult category is currently disabled." }, { status: 403 });
    }
    const itemIds = [...new Set(events.map(event => (event as RecommendationEventInput).itemId).filter((id): id is string => Boolean(id)))];
    const catalogueRows = itemIds.length ? await prisma.catalogueEntry.findMany({ where: { id: { in: itemIds } }, select: { id: true, category: true } }) : [];
    const categoriesById = new Map(catalogueRows.map(row => [row.id, row.category]));
    for (const fixture of media) categoriesById.set(fixture.id, fixture.category);
    for (const event of events as RecommendationEventInput[]) {
      const titleCategory = event.itemId ? categoriesById.get(event.itemId) ?? providerCategoryForId(event.itemId) : null;
      if (event.itemId && titleCategory !== event.category) return NextResponse.json({ error: "An event category does not match its catalogue title." }, { status: 400 });
      if (event.candidateIds?.some(id => (categoriesById.get(id) ?? providerCategoryForId(id)) !== event.category)) return NextResponse.json({ error: "A candidate snapshot contains a title from another category." }, { status: 400 });
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
