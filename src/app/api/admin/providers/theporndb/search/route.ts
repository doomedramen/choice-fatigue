import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthenticationError, AuthorizationError } from "@/lib/auth-session";
import { searchThePornDB, thePornDBKinds, ThePornDBNotEnabledError, ThePornDBRequestError, type ThePornDBKind } from "@/lib/providers/theporndb";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof ThePornDBNotEnabledError) return NextResponse.json({ error: "ThePornDB is not enabled for the Adult catalogue." }, { status: 503 });
  if (error instanceof ThePornDBRequestError) return NextResponse.json({ error: "ThePornDB could not complete the request. Try again shortly." }, { status: 502 });
  console.error("Admin ThePornDB search failed.");
  return NextResponse.json({ error: "ThePornDB search could not be completed." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return errorResponse(error);
  }

  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  const kind = request.nextUrl.searchParams.get("kind") ?? "";
  if (query.length < 2 || query.length > 80 || !thePornDBKinds.includes(kind as ThePornDBKind)) {
    return NextResponse.json({ error: "Enter a search of 2 to 80 characters and choose scenes or movies." }, { status: 400 });
  }

  try {
    const results = await searchThePornDB(query, kind as ThePornDBKind);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
