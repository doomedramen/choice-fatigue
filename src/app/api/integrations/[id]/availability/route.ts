import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, requireSession } from "@/lib/auth-session";
import { IntegrationCiphertextError, IntegrationEncryptionUnavailableError } from "@/lib/integrations/crypto";
import { IntegrationTargetError } from "@/lib/integrations/http";
import { IntegrationRequestError, readIntegrationJson, requireSameOrigin } from "@/lib/integrations/request";
import { getSavedSeerrTitle } from "@/lib/integrations/saved-seerr-title";
import { getSeerrAvailability, SeerrApiError } from "@/lib/integrations/seerr";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    requireSameOrigin(request);
    session = await requireSession();
  } catch (error) {
    if (error instanceof AuthenticationError) return jsonError("Sign in is required.", 401);
    if (error instanceof IntegrationRequestError) return jsonError(error.message, error.status);
    return jsonError("Availability could not be checked.", 500);
  }

  try {
    const input = await readIntegrationJson(request, 2 * 1024);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1) return jsonError("Choose a saved title to check.", 400);
    const catalogueEntryId = (input as Record<string, unknown>).catalogueEntryId;
    if (typeof catalogueEntryId !== "string" || catalogueEntryId.length > 128) return jsonError("Choose a saved title to check.", 400);

    const { id } = await params;
    const title = await getSavedSeerrTitle(session.user.id, id, catalogueEntryId);
    const availability = await getSeerrAvailability(title.config, { title: title.entry.title, mediaType: title.mediaType, tmdbId: title.tmdbId });
    return NextResponse.json({ availability }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return jsonError("Sign in is required.", 401);
    if (error instanceof IntegrationRequestError) return jsonError(error.message, error.status);
    if (error instanceof IntegrationEncryptionUnavailableError) return jsonError("Secure connection storage is not configured on this server.", 503);
    if (error instanceof IntegrationCiphertextError) return jsonError("This saved connection could not be decrypted. Re-enter its details and try again.", 503);
    if (error instanceof IntegrationTargetError) return jsonError("Choice Fatigue could not safely reach this address. Check its URL and the server network settings.", 422);
    if (error instanceof SeerrApiError) return jsonError(error.message, error.status);
    console.error("Seerr title availability check failed.");
    return jsonError("Seerr could not check this title. Check the connection and try again.", 502);
  }
}
