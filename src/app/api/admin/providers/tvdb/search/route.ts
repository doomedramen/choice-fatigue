import { NextRequest, NextResponse } from "next/server";
import { AuthorizationError, AuthenticationError, requireAdmin } from "@/lib/auth-session";
import { searchTvdb, TvdbAuthenticationError, TvdbConfigurationError, TvdbNotEnabledError, TvdbRequestError, tvdbCategories } from "@/lib/providers/tvdb";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof TvdbNotEnabledError) return NextResponse.json({ error: "TheTVDB is not enabled. Add a project key in Admin → Providers first." }, { status: 503 });
  if (error instanceof TvdbConfigurationError) return NextResponse.json({ error: "TheTVDB credentials could not be decrypted. Check secure server storage." }, { status: 503 });
  if (error instanceof TvdbAuthenticationError) return NextResponse.json({ error: "TheTVDB rejected the project key or subscriber PIN." }, { status: 502 });
  if (error instanceof TvdbRequestError) return NextResponse.json({ error: "TheTVDB could not complete the request. Try again shortly." }, { status: 502 });
  console.error("Admin TheTVDB search failed.");
  return NextResponse.json({ error: "TheTVDB search could not be completed." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return errorResponse(error);
  }

  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  const category = request.nextUrl.searchParams.get("category") ?? "";
  if (query.length < 2 || query.length > 80 || !tvdbCategories.includes(category as typeof tvdbCategories[number])) {
    return NextResponse.json({ error: "Enter a search of 2 to 80 characters and choose Movies or Shows." }, { status: 400 });
  }

  try {
    const results = await searchTvdb(query, category as typeof tvdbCategories[number]);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
