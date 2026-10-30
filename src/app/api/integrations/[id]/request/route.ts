import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, requireSession } from "@/lib/auth-session";
import { decryptIntegrationConfig, IntegrationCiphertextError, IntegrationEncryptionUnavailableError, integrationEncryptionContext } from "@/lib/integrations/crypto";
import { IntegrationTargetError, requestIntegrationService } from "@/lib/integrations/http";
import { IntegrationRequestError, readIntegrationJson, requireSameOrigin } from "@/lib/integrations/request";
import { prisma } from "@/lib/prisma";

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

  try {
    const input = await readIntegrationJson(request, 2 * 1024);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1) {
      return jsonError("Choose a saved title to request.", 400);
    }
    const catalogueEntryId = (input as Record<string, unknown>).catalogueEntryId;
    if (typeof catalogueEntryId !== "string" || catalogueEntryId.length > 128) return jsonError("Choose a saved title to request.", 400);
    const { id } = await params;
    const [connection, discovery, entry] = await Promise.all([
      prisma.userIntegration.findFirst({ where: { id, userId: session.user.id } }),
      prisma.discoveryState.findUnique({ where: { userId: session.user.id }, select: { state: true } }),
      prisma.catalogueEntry.findFirst({ where: { id: catalogueEntryId, active: true } }),
    ]);
    if (!connection) return jsonError("Connection not found.", 404);
    if (connection.service !== "seerr") return jsonError("Title requests are available through Seerr in this release.", 409);

    const state = discovery?.state;
    const saved = state && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>).saved : null;
    if (!Array.isArray(saved) || !saved.includes(catalogueEntryId)) return jsonError("Save this title to your account before requesting it.", 403);
    if (!entry) return jsonError("This title is no longer available in the catalogue.", 404);
    if (entry.category === "Adult") return jsonError("Adult titles cannot be sent through Seerr.", 403);
    const sourceMatch = entry.source === "tmdb" ? /^(movie|tv):(\d{1,10})$/.exec(entry.sourceId) : null;
    const tmdbId = sourceMatch ? Number(sourceMatch[2]) : NaN;
    if (!sourceMatch || !Number.isSafeInteger(tmdbId) || tmdbId < 1 || tmdbId > 2_147_483_647) {
      return jsonError("This title has no supported TMDB link for Seerr.", 409);
    }

    const config = decryptIntegrationConfig(connection.encryptedConfig, integrationEncryptionContext(connection.userId, connection.id));
    const response = await requestIntegrationService(config, "api/v1/request", {
      method: "POST",
      body: { mediaType: sourceMatch[1], mediaId: tmdbId },
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
    return NextResponse.json({ requested: true, title: entry.title }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return jsonError("Sign in is required.", 401);
    if (error instanceof IntegrationRequestError) return jsonError(error.message, error.status);
    if (error instanceof IntegrationEncryptionUnavailableError) return jsonError("Secure connection storage is not configured on this server.", 503);
    if (error instanceof IntegrationCiphertextError) return jsonError("This saved connection could not be decrypted. Re-enter its details and try again.", 503);
    if (error instanceof IntegrationTargetError) return jsonError("Choice Fatigue could not safely reach this address. Check its URL and the server network settings.", 422);
    console.error("Seerr title request failed.");
    return jsonError("Seerr could not accept this title. Check the connection and try again.", 502);
  }
}
