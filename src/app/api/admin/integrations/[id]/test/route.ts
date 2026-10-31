import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireAdmin } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";
import { adminIntegrationEncryptionContext, decryptIntegrationConfig, IntegrationCiphertextError, IntegrationEncryptionUnavailableError } from "@/lib/integrations/crypto";
import { IntegrationTargetError, integrationTargetErrorMessage, requestIntegrationService } from "@/lib/integrations/http";
import { IntegrationRequestError, requireSameOrigin } from "@/lib/integrations/request";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    requireSameOrigin(request);
  } catch (error) {
    if (error instanceof AuthenticationError) return jsonError("Sign in is required.", 401);
    if (error instanceof AuthorizationError) return jsonError("Administrator access is required.", 403);
    if (error instanceof IntegrationRequestError) return jsonError(error.message, error.status);
    return jsonError("Service could not be checked.", 500);
  }

  try {
    const row = await prisma.adminServiceIntegration.findUnique({ where: { id: (await params).id } });
    if (!row) return jsonError("Service connection not found.", 404);
    if (row.service === "whisparr-v2" || row.service === "whisparr-v3" || row.service === "stash") {
      if (!(await getGlobalSettings()).adultSectionEnabled) return jsonError("Enable the Adult section before checking this service.", 403);
    }
    const endpoint = row.service === "seerr"
      ? "api/v1/settings/public"
      : row.service === "radarr" || row.service === "sonarr"
        ? "api"
        : row.service === "plex"
          ? ""
          : row.service === "whisparr-v2" || row.service === "whisparr-v3"
            ? "api/v3/system/status"
            : null;
    if (endpoint === null) return jsonError("Connection checks are available for Seerr, Plex, Radarr, Sonarr, and Whisparr in this release.", 409);

    const config = decryptIntegrationConfig(row.encryptedConfig, adminIntegrationEncryptionContext(row.id));
    const response = await requestIntegrationService(config, endpoint, row.service === "plex" ? { credentialHeader: "x-plex-token" } : {});
    const serviceName = row.service === "seerr" ? "Seerr" : row.service === "plex" ? "Plex" : row.service === "radarr" ? "Radarr" : row.service === "sonarr" ? "Sonarr" : "Whisparr";
    if (response.status === 401 || response.status === 403) return jsonError(`${serviceName} rejected this credential. Check the token or service settings.`, 422);
    if (response.status < 200 || response.status >= 300) return jsonError(`${serviceName} responded, but its API could not verify the connection.`, 502);

    let payload: unknown;
    try { payload = JSON.parse(response.body) as unknown; }
    catch { return jsonError(`The address responded, but it did not return valid ${serviceName} settings.`, 502); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return jsonError(`The address responded, but it did not return valid ${serviceName} API data.`, 422);
    const fields = payload as Record<string, unknown>;
    const plexContainer = fields.MediaContainer;
    const validResponse = row.service === "seerr"
      ? typeof fields.applicationTitle === "string"
      : row.service === "plex"
        ? Boolean(plexContainer && typeof plexContainer === "object" && !Array.isArray(plexContainer)
          && typeof (plexContainer as Record<string, unknown>).machineIdentifier === "string"
          && typeof (plexContainer as Record<string, unknown>).friendlyName === "string")
        : row.service === "whisparr-v2" || row.service === "whisparr-v3"
          ? fields.appName === "Whisparr" && typeof fields.version === "string"
          : (typeof fields.current === "string" || fields.current === null) && Array.isArray(fields.deprecated);
    if (!validResponse) return jsonError(`The address responded, but it does not look like a ${serviceName} server.`, 422);
    return NextResponse.json({ connected: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof IntegrationEncryptionUnavailableError) return jsonError("Secure connection storage is not available.", 503);
    if (error instanceof IntegrationCiphertextError) return jsonError("This saved service could not be decrypted. Re-enter its details and try again.", 503);
    if (error instanceof IntegrationTargetError) return jsonError(integrationTargetErrorMessage(error), 422);
    console.error("Admin media service connection check failed.");
    return jsonError("The service could not be reached. Check the server address and try again.", 502);
  }
}
