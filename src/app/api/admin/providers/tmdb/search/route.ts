import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthenticationError, AuthorizationError } from "@/lib/auth-session";
import { searchTmdb, tmdbCategories, TmdbConfigurationError, TmdbNotEnabledError, TmdbRequestError } from "@/lib/providers/tmdb";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof TmdbConfigurationError) return NextResponse.json({ error: "TMDB credentials could not be decrypted. Check secure server storage." }, { status: 503 });
  if (error instanceof TmdbNotEnabledError) return NextResponse.json({ error: "TMDB is not enabled on this server." }, { status: 503 });
  if (error instanceof TmdbRequestError) return NextResponse.json({ error: "TMDB could not complete the request. Try again shortly." }, { status: 502 });
  console.error("Admin TMDB search failed.");
  return NextResponse.json({ error: "TMDB search could not be completed." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return errorResponse(error);
  }

  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  const category = request.nextUrl.searchParams.get("category") ?? "";
  if (query.length < 2 || query.length > 80 || !tmdbCategories.includes(category as typeof tmdbCategories[number])) {
    return NextResponse.json({ error: "Enter a search of 2 to 80 characters and choose Movies, TV, or Anime." }, { status: 400 });
  }

  try {
    const results = await searchTmdb(query, category as typeof tmdbCategories[number]);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
