import { NextRequest, NextResponse } from "next/server";
import { requireSession, AuthenticationError } from "@/lib/auth-session";
import { userHasAdultGrant } from "@/lib/adult-access";
import { adultAccessEnabled } from "@/lib/adult-access-policy";
import { getGlobalSettings } from "@/lib/global-settings";
import { prisma } from "@/lib/prisma";
import { loadRecommendationProfile } from "@/lib/recommendation-profile";
import { partitionRecommendationEvents, recommendationCategories, type RecommendationCategory } from "@/lib/recommendation-event-validation";
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
    const candidates = request.nextUrl.searchParams.getAll("candidateId").filter(id => id.length > 0 && id.length <= 200).slice(0, 100);
    const { events, featuresByItemId, coverage } = await loadRecommendationProfile(session.user.id, category, candidates);
    return NextResponse.json({ events, featuresByItemId, coverage }, { headers });
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
    // Check global event IDs before acknowledging a retry; another account's ID is never accepted.
    const existing = await prisma.recommendationEvent.findMany({ where: { id: { in: accepted.map(event => event.id) } }, select: { id: true, userId: true } });
    const foreignIds = new Set(existing.filter(row => row.userId !== session.user.id).map(row => row.id));
    const owned = accepted.filter(event => !foreignIds.has(event.id));
    for (const event of accepted) if (foreignIds.has(event.id)) rejected.push({ id: event.id, index: events.findIndex(value => value === event), code: "duplicate" });
    if (owned.length) await prisma.recommendationEvent.createMany({
      data: owned.map(event => ({ ...event, userId: session.user.id, occurredAt: new Date(event.occurredAt), candidateIds: event.candidateIds ?? undefined })), skipDuplicates: true,
    });
    return NextResponse.json({ acceptedIds: owned.map(event => event.id), rejected }, { headers });
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
