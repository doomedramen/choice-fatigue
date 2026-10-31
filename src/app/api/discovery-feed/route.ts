import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, requireSession } from "@/lib/auth-session";
import { getDiscoveryFeed, InvalidFeedCursorError } from "@/lib/catalogue";
import { recommendationCategories, type RecommendationCategory } from "@/lib/recommendation-event-validation";
import { userHasAdultGrant } from "@/lib/adult-access";
import { getGlobalSettings } from "@/lib/global-settings";
import { adultAccessEnabled } from "@/lib/adult-access-policy";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const category = request.nextUrl.searchParams.get("category") as RecommendationCategory;
    if (!recommendationCategories.includes(category)) return NextResponse.json({ error: "Choose a valid discovery category." }, { status: 400 });
    if (category === "Adult") {
      const [settings, grant] = await Promise.all([getGlobalSettings(), userHasAdultGrant(session.user.id)]);
      if (!adultAccessEnabled(settings.adultSectionEnabled, grant)) return NextResponse.json({ error: "The Adult category is currently disabled." }, { status: 403 });
    }
    const pendingIds = request.nextUrl.searchParams.getAll("excludeId").filter(id => id.length <= 200).slice(0, 100);
    const result = await getDiscoveryFeed(session.user.id, category, request.nextUrl.searchParams.get("cursor"), request.nextUrl.searchParams.get("refresh") === "1", pendingIds);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    if (error instanceof InvalidFeedCursorError) return NextResponse.json({ error: "Invalid discovery cursor." }, { status: 400 });
    return NextResponse.json({ error: "More titles could not be loaded." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
