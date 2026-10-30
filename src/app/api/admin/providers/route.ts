import { NextResponse } from "next/server";
import { requireAdmin, AuthenticationError, AuthorizationError } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";
import { getTvdbProviderStatus } from "@/lib/providers/tvdb-config";
import { getTmdbProviderStatus } from "@/lib/providers/tmdb-config";
import { getAdultMetadataProviderStatus } from "@/lib/providers/adult-metadata-config";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  console.error("Admin provider status request failed.", error);
  return NextResponse.json({ error: "Provider status could not be loaded." }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdmin();
    const [settings, tmdb, tvdb, theporndb, stashdb] = await Promise.all([
      getGlobalSettings(),
      getTmdbProviderStatus(),
      getTvdbProviderStatus(),
      getAdultMetadataProviderStatus("theporndb"),
      getAdultMetadataProviderStatus("stashdb"),
    ]);
    return NextResponse.json({
      adultSectionEnabled: settings.adultSectionEnabled,
      providers: {
        tmdb: { ...tmdb, integration: "configured" },
        tvdb: { ...tvdb, integration: "configured" },
        theporndb: { ...theporndb, integration: "configured" },
        stashdb: { ...stashdb, integration: "configured" },
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
