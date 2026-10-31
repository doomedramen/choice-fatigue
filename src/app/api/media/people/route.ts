import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, requireSession } from "@/lib/auth-session";
import { userHasAdultGrant } from "@/lib/adult-access";
import { adultAccessEnabled } from "@/lib/adult-access-policy";
import { getGlobalSettings } from "@/lib/global-settings";
import { parseProviderTitleId } from "@/lib/media-provider-id";
import { getTmdbPeople } from "@/lib/providers/tmdb";
import { getThePornDBPeople } from "@/lib/providers/theporndb";
import { getStashDbPeople } from "@/lib/providers/stashdb";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const id = request.nextUrl.searchParams.get("id") ?? "";
    const reference = parseProviderTitleId(id);
    if (!reference) return NextResponse.json({ error: "Choose a valid title." }, { status: 400, headers });
    if (reference.category === "Adult") {
      const [settings, grant] = await Promise.all([getGlobalSettings(), userHasAdultGrant(session.user.id)]);
      if (!adultAccessEnabled(settings.adultSectionEnabled, grant)) return NextResponse.json({ error: "The Adult category is currently disabled." }, { status: 403, headers });
    }
    const people = reference.provider === "tmdb" ? await getTmdbPeople(reference.mediaType, reference.sourceId)
      : reference.provider === "theporndb" ? await getThePornDBPeople(reference.kind, reference.sourceId)
      : await getStashDbPeople(reference.sourceId);
    return NextResponse.json({ people }, { headers });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401, headers });
    return NextResponse.json({ error: "People could not be loaded." }, { status: 503, headers });
  }
}
