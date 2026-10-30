import { NextResponse } from "next/server";
import { requireAdmin, AuthenticationError, AuthorizationError } from "@/lib/auth-session";

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
    return NextResponse.json({
      providers: {
        tmdb: { credentialConfigured: tmdbCredentialConfigured, enabled: tmdbCredentialConfigured && process.env.TMDB_METADATA_ENABLED === "true", integration: "configured" },
        theporndb: { credentialConfigured: Boolean(process.env.THEPORNDB_API_TOKEN), integration: "not-built" },
        stashdb: { credentialConfigured: Boolean(process.env.STASHDB_API_KEY), integration: "not-built" },
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
