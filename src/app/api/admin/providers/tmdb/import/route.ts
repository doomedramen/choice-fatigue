import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthenticationError, AuthorizationError } from "@/lib/auth-session";
import { importTmdbEntry, tmdbCategories, TmdbAdultResultError, TmdbNotEnabledError, TmdbRequestError, type TmdbMediaType } from "@/lib/providers/tmdb";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof TmdbNotEnabledError) return NextResponse.json({ error: "TMDB is not enabled on this server." }, { status: 503 });
  if (error instanceof TmdbAdultResultError) return NextResponse.json({ error: "Adult-flagged results cannot be added to this catalogue." }, { status: 400 });
  if (error instanceof TmdbRequestError) return NextResponse.json({ error: "TMDB could not complete the request. Try again shortly." }, { status: 502 });
  if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("Admin TMDB import failed.");
  return NextResponse.json({ error: "The TMDB title could not be added." }, { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return errorResponse(error);
  }

  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Expected a JSON request." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Request body has an invalid shape." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== 3 || typeof input.tmdbId !== "number" || !Number.isSafeInteger(input.tmdbId) || input.tmdbId < 1 || input.tmdbId > 2_147_483_647 || (input.mediaType !== "movie" && input.mediaType !== "tv") || !tmdbCategories.includes(input.category as typeof tmdbCategories[number])) {
    return NextResponse.json({ error: "The selected TMDB item is invalid." }, { status: 400 });
  }

  try {
    const entry = await importTmdbEntry({ tmdbId: input.tmdbId, mediaType: input.mediaType as TmdbMediaType, category: input.category as typeof tmdbCategories[number] });
    return NextResponse.json({ entry: { id: entry.id, title: entry.title, category: entry.category, year: entry.year } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
