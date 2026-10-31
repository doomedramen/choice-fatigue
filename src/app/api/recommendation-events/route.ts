import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthenticationError } from "@/lib/auth-session";
import { userHasAdultGrant } from "@/lib/adult-access";
import { adultAccessEnabled } from "@/lib/adult-access-policy";
import { getGlobalSettings } from "@/lib/global-settings";
import { prisma } from "@/lib/prisma";
import { loadRecommendationProfile } from "@/lib/recommendation-profile";
import { invalidUndoTargetIds, partitionRecommendationEvents, recommendationCategories, type RecommendationCategory, type RecommendationEventInput, type RejectedRecommendationEvent } from "@/lib/recommendation-event-validation";
import { IntegrationRequestError, readIntegrationJson, requireSameOrigin } from "@/lib/integrations/request";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Recommendation history could not be loaded." }, { status: 500 });
}
async function canAccessAdult(userId: string) {
  const [settings, grant] = await Promise.all([getGlobalSettings(), userHasAdultGrant(userId)]);
  return adultAccessEnabled(settings.adultSectionEnabled, grant);
}
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const category = request.nextUrl.searchParams.get("category") as RecommendationCategory;
    if (!recommendationCategories.includes(category)) return NextResponse.json({ error: "Choose a valid category." }, { status: 400 });
    if (category === "Adult" && !await canAccessAdult(session.user.id)) return NextResponse.json({ error: "The Adult category is currently disabled." }, { status: 403 });
    const knownIds = request.nextUrl.searchParams.getAll("knownFeatureId").filter(id => id.length <= 200).slice(0, 200);
    const { events, featuresByItemId, coverage, creditCoverage, resolvedCreditItemIds, requestedCreditItemIds, attemptedFeatureItemIds } = await loadRecommendationProfile(session.user.id, category, knownIds);
    return NextResponse.json({ events, featuresByItemId, coverage, creditCoverage, resolvedCreditItemIds, requestedCreditItemIds, attemptedFeatureItemIds }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const session = await requireSession();
    const value = await readIntegrationJson(request, 256 * 1024);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !Array.isArray((value as Record<string, unknown>).events)) {
      return NextResponse.json({ error: "Recommendation events have an invalid shape." }, { status: 400 });
    }
    const events = (value as { events: unknown[] }).events;
    if (events.length > 500) return NextResponse.json({ error: "Too many recommendation events." }, { status: 400 });
    const hasAdult = events.some(event => event && typeof event === "object" && (event as { category?: string }).category === "Adult");
    const { accepted, rejected } = partitionRecommendationEvents(events, hasAdult ? await canAccessAdult(session.user.id) : false);
    const reject = (event: RecommendationEventInput, code: RejectedRecommendationEvent["code"]) => rejected.push({ id: event.id, index: events.findIndex(value => value === event), code });
    // Check global event IDs before acknowledging a retry; another account's ID is never accepted.
    const existing = await prisma.recommendationEvent.findMany({ where: { id: { in: accepted.map(event => event.id) } }, select: { id: true, userId: true } });
    const foreignIds = new Set(existing.filter(row => row.userId !== session.user.id).map(row => row.id));
    const undoTargetIds = accepted.flatMap(event => event.eventType === "decision_undone" && event.targetEventId ? [event.targetEventId] : []);
    const storedTargets = undoTargetIds.length ? await prisma.recommendationEvent.findMany({ where: { userId: session.user.id, id: { in: undoTargetIds } }, select: { id: true, itemId: true, eventType: true } }) : [];
    const invalidTargets = invalidUndoTargetIds(accepted.filter(event => !foreignIds.has(event.id)), storedTargets);
    const owned = accepted.filter(event => !foreignIds.has(event.id) && !invalidTargets.has(event.id));
    for (const event of accepted) if (foreignIds.has(event.id)) reject(event, "duplicate"); else if (invalidTargets.has(event.id)) reject(event, "invalid_target");
    if (owned.length) await prisma.recommendationEvent.createMany({
      data: owned.map(event => ({ ...event, userId: session.user.id, occurredAt: new Date(event.occurredAt), candidateIds: event.candidateIds ?? undefined, provenance: event.provenance ?? undefined })), skipDuplicates: true,
    });
    // A concurrent insert of the same ID by another account is skipped above; acknowledge only rows this user owns.
    const stored = owned.length ? new Set((await prisma.recommendationEvent.findMany({ where: { userId: session.user.id, id: { in: owned.map(event => event.id) } }, select: { id: true } })).map(row => row.id)) : new Set<string>();
    for (const event of owned) if (!stored.has(event.id)) reject(event, "duplicate");
    return NextResponse.json({ acceptedIds: owned.filter(event => stored.has(event.id)).map(event => event.id), rejected }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const session = await requireSession();
    await prisma.recommendationEvent.deleteMany({ where: { userId: session.user.id } });
    return NextResponse.json({ deleted: true }, { headers });
  } catch (error) { return errorResponse(error); }
}
