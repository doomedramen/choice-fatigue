import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthenticationError, AuthorizationError } from "@/lib/auth-session";
import { searchStashDbScenes, StashDbNotEnabledError, StashDbRequestError } from "@/lib/providers/stashdb";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof StashDbNotEnabledError) return NextResponse.json({ error: "StashDB is not enabled for Adult on this server." }, { status: 503 });
  if (error instanceof StashDbRequestError) return NextResponse.json({ error: "StashDB could not complete the request. Try again shortly." }, { status: 502 });
  console.error("Admin StashDB search failed.");
  return NextResponse.json({ error: "StashDB search could not be completed." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return errorResponse(error);
  }

  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  if (query.length < 2 || query.length > 80) {
    return NextResponse.json({ error: "Enter a search of 2 to 80 characters." }, { status: 400 });
  }

  try {
    const results = await searchStashDbScenes(query);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
