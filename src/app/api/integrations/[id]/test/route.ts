import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, requireSession } from "@/lib/auth-session";
import { decryptIntegrationConfig, IntegrationCiphertextError, IntegrationEncryptionUnavailableError, integrationEncryptionContext } from "@/lib/integrations/crypto";
import { IntegrationTargetError, requestIntegrationService } from "@/lib/integrations/http";
import { IntegrationRequestError, requireSameOrigin } from "@/lib/integrations/request";
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
    return jsonError("Connection could not be checked.", 500);
  }

  try {
    const row = await prisma.userIntegration.findFirst({ where: { id: (await params).id, userId: session.user.id } });
    if (!row) return jsonError("Connection not found.", 404);
    const endpoint = row.service === "seerr"
      ? "api/v1/settings/network"
      : row.service === "radarr" || row.service === "sonarr"
        ? "api"
        : row.service === "plex"
          ? ""
        : null;
    if (endpoint === null) return jsonError("Connection checks are available for Seerr, Plex, Radarr, and Sonarr in this release.", 409);

    const config = decryptIntegrationConfig(row.encryptedConfig, integrationEncryptionContext(row.userId, row.id));
    const response = await requestIntegrationService(config, endpoint, row.service === "plex" ? { credentialHeader: "x-plex-token" } : {});
    const serviceName = row.service === "seerr" ? "Seerr" : row.service === "plex" ? "Plex" : row.service === "radarr" ? "Radarr" : "Sonarr";
    if (response.status === 401 || response.status === 403) return jsonError(`${serviceName} rejected this credential. Check the token or service settings.`, 422);
    if (response.status < 200 || response.status >= 300) return jsonError(`${serviceName} responded, but its API could not verify the connection.`, 502);

    let payload: unknown;
    try { payload = JSON.parse(response.body) as unknown; }
    catch { return jsonError(`The address responded, but it did not return valid ${serviceName} settings.`, 502); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return jsonError(`The address responded, but it did not return valid ${serviceName} API data.`, 422);
    }
    const fields = payload as Record<string, unknown>;
    const plexContainer = fields.MediaContainer;
    const validResponse = row.service === "seerr"
      ? typeof fields.applicationTitle === "string"
      : row.service === "plex"
        ? Boolean(plexContainer && typeof plexContainer === "object" && !Array.isArray(plexContainer)
          && typeof (plexContainer as Record<string, unknown>).machineIdentifier === "string"
          && typeof (plexContainer as Record<string, unknown>).friendlyName === "string")
        : (typeof fields.current === "string" || fields.current === null) && Array.isArray(fields.deprecated);
    if (!validResponse) {
      return jsonError(`The address responded, but it does not look like a ${serviceName} server.`, 422);
    }
    return NextResponse.json({ connected: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof IntegrationEncryptionUnavailableError) return jsonError("Secure connection storage is not configured on this server.", 503);
    if (error instanceof IntegrationCiphertextError) return jsonError("This saved connection could not be decrypted. Re-enter its details and try again.", 503);
    if (error instanceof IntegrationTargetError) return jsonError("Choice Fatigue could not safely reach this address. Check its URL and the server network settings.", 422);
    console.error("Media service connection check failed.");
    return jsonError("The service could not be reached. Check the server address and try again.", 502);
  }
}
