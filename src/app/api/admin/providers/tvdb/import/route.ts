import { NextRequest, NextResponse } from "next/server";
import { AuthorizationError, AuthenticationError, requireAdmin } from "@/lib/auth-session";
import { importTvdbEntry, TvdbAuthenticationError, TvdbConfigurationError, TvdbNotEnabledError, TvdbRequestError, type TvdbCategory, type TvdbMediaType, tvdbCategories } from "@/lib/providers/tvdb";
import { IntegrationRequestError, requireSameOrigin } from "@/lib/integrations/request";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TvdbNotEnabledError) return NextResponse.json({ error: "TheTVDB is not enabled. Add a project key in Admin → Providers first." }, { status: 503 });
  if (error instanceof TvdbConfigurationError) return NextResponse.json({ error: "TheTVDB credentials could not be decrypted. Check secure server storage." }, { status: 503 });
  if (error instanceof TvdbAuthenticationError) return NextResponse.json({ error: "TheTVDB rejected the project key or subscriber PIN." }, { status: 502 });
  if (error instanceof TvdbRequestError) return NextResponse.json({ error: "TheTVDB could not complete the request. Try again shortly." }, { status: 502 });
  if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("Admin TheTVDB import failed.");
  return NextResponse.json({ error: "The TheTVDB title could not be added." }, { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    requireSameOrigin(request);
  } catch (error) {
    return errorResponse(error);
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Expected a JSON request." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "The selected title is invalid." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== 3 || typeof input.tvdbId !== "number" || !Number.isSafeInteger(input.tvdbId) || input.tvdbId < 1 || input.tvdbId > 2_147_483_647
    || (input.mediaType !== "movie" && input.mediaType !== "series")
    || !tvdbCategories.includes(input.category as TvdbCategory)) {
    return NextResponse.json({ error: "The selected TheTVDB title is invalid." }, { status: 400 });
  }

  try {
    const entry = await importTvdbEntry({ tvdbId: input.tvdbId, mediaType: input.mediaType as TvdbMediaType, category: input.category as TvdbCategory });
    return NextResponse.json({ entry: { id: entry.id, title: entry.title, category: entry.category, year: entry.year, hasTmdbArtwork: Boolean(entry.artworkUrl) } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
