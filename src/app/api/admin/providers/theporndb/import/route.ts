import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthenticationError, AuthorizationError } from "@/lib/auth-session";
import { importThePornDBEntry, thePornDBKinds, ThePornDBInvalidRecordError, ThePornDBNotEnabledError, ThePornDBRequestError, type ThePornDBKind } from "@/lib/providers/theporndb";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof ThePornDBNotEnabledError) return NextResponse.json({ error: "ThePornDB is not enabled for the Adult catalogue." }, { status: 503 });
  if (error instanceof ThePornDBInvalidRecordError) return NextResponse.json({ error: "The selected ThePornDB record is invalid or no longer available." }, { status: 400 });
  if (error instanceof ThePornDBRequestError) return NextResponse.json({ error: "ThePornDB could not complete the request. Try again shortly." }, { status: 502 });
  console.error("Admin ThePornDB import failed.");
  return NextResponse.json({ error: "The Adult title could not be added." }, { status: 500 });
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
  if (Object.keys(input).length !== 2 || typeof input.sourceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.sourceId) || !thePornDBKinds.includes(input.kind as ThePornDBKind)) {
    return NextResponse.json({ error: "The selected ThePornDB record is invalid." }, { status: 400 });
  }

  try {
    const entry = await importThePornDBEntry({ sourceId: input.sourceId, kind: input.kind as ThePornDBKind });
    return NextResponse.json({ entry: { id: entry.id, title: entry.title, category: "Adult", year: entry.year } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
