import { NextResponse } from "next/server";
import { requireAdmin, AuthenticationError, AuthorizationError } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  console.error("Admin provider status request failed.", error);
  return NextResponse.json({ error: "Provider status could not be loaded." }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdmin();
    const tmdbCredentialConfigured = Boolean(process.env.TMDB_API_READ_ACCESS_TOKEN);
    const thePornDbCredentialConfigured = Boolean(process.env.THEPORNDB_API_TOKEN);
    const stashDbCredentialConfigured = Boolean(process.env.STASHDB_API_KEY);
    const settings = await getGlobalSettings();
    return NextResponse.json({
      adultSectionEnabled: settings.adultSectionEnabled,
      providers: {
        tmdb: { credentialConfigured: tmdbCredentialConfigured, enabled: tmdbCredentialConfigured && process.env.TMDB_METADATA_ENABLED === "true", integration: "configured" },
        theporndb: { credentialConfigured: thePornDbCredentialConfigured, enabled: settings.adultSectionEnabled && thePornDbCredentialConfigured && process.env.THEPORNDB_METADATA_ENABLED === "true", integration: "configured" },
        stashdb: { credentialConfigured: stashDbCredentialConfigured, enabled: settings.adultSectionEnabled && stashDbCredentialConfigured && process.env.STASHDB_METADATA_ENABLED === "true", integration: "configured" },
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
