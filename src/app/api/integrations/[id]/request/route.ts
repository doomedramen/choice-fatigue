import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, requireSession } from "@/lib/auth-session";
import { IntegrationCiphertextError, IntegrationEncryptionUnavailableError } from "@/lib/integrations/crypto";
import { IntegrationTargetError, integrationTargetErrorMessage, requestIntegrationService } from "@/lib/integrations/http";
import { IntegrationRequestError, readIntegrationJson, requireSameOrigin } from "@/lib/integrations/request";
import { getSavedSeerrTitle } from "@/lib/integrations/saved-tmdb-title";
import { getSeerrAvailability, SeerrApiError, seerrAlreadyTracksTitle } from "@/lib/integrations/seerr";
import { prisma } from "@/lib/prisma";
import { integrationsReadOnly } from "@/lib/outbound-policy";

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
    return jsonError("The request could not be sent.", 500);
  }

  if (integrationsReadOnly()) return jsonError("Media service requests are disabled in read-only mode.", 403);

  try {
    const input = await readIntegrationJson(request, 2 * 1024);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1) {
      return jsonError("Choose a saved title to request.", 400);
    }
    const catalogueEntryId = (input as Record<string, unknown>).catalogueEntryId;
    if (typeof catalogueEntryId !== "string" || catalogueEntryId.length > 128) return jsonError("Choose a saved title to request.", 400);
    const { id } = await params;
    const { connection, entry, config, mediaType, tmdbId } = await getSavedSeerrTitle(session.user.id, id, catalogueEntryId);
    const availability = await getSeerrAvailability(config, { title: entry.title, mediaType, tmdbId });
    if (seerrAlreadyTracksTitle(availability)) return NextResponse.json({ requested: false, alreadyTracked: true, availability }, { headers: { "Cache-Control": "private, no-store" } });
    const response = await requestIntegrationService(config, "api/v1/request", {
      method: "POST",
      body: { mediaType, mediaId: tmdbId },
    });
    if (response.status < 200 || response.status >= 300) {
      if (response.status === 401 || response.status === 403) return jsonError("Seerr rejected the request. Check its API key and request permissions.", 422);
      if (response.status === 409) return jsonError("Seerr already has a request for this title.", 409);
      if (response.status === 404) return jsonError("Seerr could not find this title. Check that its TMDB catalogue is available.", 422);
      return jsonError("Seerr could not accept this title. Check its request settings and try again.", 502);
    }

    try {
      await prisma.integrationAuditLog.create({ data: { userId: session.user.id, integrationId: connection.id, service: connection.service, action: "title_requested", name: connection.name } });
    } catch {
      console.warn("A successful Seerr request could not be added to the integration audit log.");
    }
    return NextResponse.json({ requested: true, title: entry.title, availability: "pending" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return jsonError("Sign in is required.", 401);
    if (error instanceof IntegrationRequestError) return jsonError(error.message, error.status);
    if (error instanceof IntegrationEncryptionUnavailableError) return jsonError("Secure connection storage is not configured on this server.", 503);
    if (error instanceof IntegrationCiphertextError) return jsonError("This saved connection could not be decrypted. Re-enter its details and try again.", 503);
    if (error instanceof IntegrationTargetError) return jsonError(integrationTargetErrorMessage(error), 422);
    if (error instanceof SeerrApiError) return jsonError(error.message, error.status);
    console.error("Seerr title request failed.");
    return jsonError("Seerr could not accept this title. Check the connection and try again.", 502);
  }
}
