import { NextRequest, NextResponse } from "next/server";
import { AuthorizationError, AuthenticationError, requireAdmin } from "@/lib/auth-session";
import { saveTmdbProviderConfig, TmdbConfigurationError } from "@/lib/providers/tmdb-config";
import { IntegrationRequestError, requireSameOrigin } from "@/lib/integrations/request";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TmdbConfigurationError) return NextResponse.json({ error: error.message || "Credential encryption is unavailable. Check secure server storage and try again." }, { status: 503 });
  return NextResponse.json({ error: "TMDB settings could not be saved." }, { status: 500 });
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return errorResponse(error);
  }

  try { requireSameOrigin(request); } catch (error) { return errorResponse(error); }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Expected a JSON request." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Settings have an invalid shape." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !["apiKey", "enabled"].includes(key)) || typeof input.apiKey !== "string" || input.apiKey.length > 2048 || typeof input.enabled !== "boolean") {
    return NextResponse.json({ error: "Settings have an invalid value." }, { status: 400 });
  }

  try {
    const status = await saveTmdbProviderConfig({ apiKey: input.apiKey, enabled: input.enabled });
    return NextResponse.json({ status }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
