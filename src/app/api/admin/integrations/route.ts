import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireAdmin } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";
import { adminIntegrationEncryptionContext, decryptIntegrationConfig, encryptIntegrationConfig, IntegrationEncryptionUnavailableError, isIntegrationEncryptionConfigured } from "@/lib/integrations/crypto";
import { parseAdminServiceCreateInput } from "@/lib/integrations/admin-service";
import { IntegrationRequestError, readIntegrationJson, requireSameOrigin } from "@/lib/integrations/request";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_CONNECTIONS = 24;

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof IntegrationEncryptionUnavailableError) return NextResponse.json({ error: "Secure connection storage is not available." }, { status: 503 });
  console.error("Admin service connections request failed.");
  return NextResponse.json({ error: "Service connections could not be saved. Try again shortly." }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdmin();
    const rows = await prisma.adminServiceIntegration.findMany({ orderBy: [{ service: "asc" }, { createdAt: "asc" }] });
    const encryptionConfigured = isIntegrationEncryptionConfigured();
    const integrations = rows.map(row => ({
      id: row.id,
      service: row.service,
      name: row.name,
      baseUrl: encryptionConfigured ? decryptIntegrationConfig(row.encryptedConfig, adminIntegrationEncryptionContext(row.id)).baseUrl : null,
      credentialSaved: true as const,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    return NextResponse.json({ integrations, encryptionConfigured }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireAdmin();
    requireSameOrigin(request);
  } catch (error) {
    return errorResponse(error);
  }

  try {
    const input = parseAdminServiceCreateInput(await readIntegrationJson(request, 16 * 1024));
    const settings = await getGlobalSettings();
    if (input.service.adultOnly && !settings.adultSectionEnabled) return NextResponse.json({ error: "Enable the Adult section before adding this service." }, { status: 403 });
    if (!isIntegrationEncryptionConfigured()) throw new IntegrationEncryptionUnavailableError();
    if (await prisma.adminServiceIntegration.count() >= MAX_CONNECTIONS) return NextResponse.json({ error: "You’ve reached the maximum number of service connections." }, { status: 409 });

    const id = randomUUID();
    const encryptedConfig = encryptIntegrationConfig({ baseUrl: input.baseUrl, apiKey: input.apiKey }, adminIntegrationEncryptionContext(id));
    const created = await prisma.$transaction(async transaction => {
      const integration = await transaction.adminServiceIntegration.create({
        data: { id, service: input.service.id, name: input.name, encryptedConfig },
        select: { id: true, service: true, name: true, createdAt: true, updatedAt: true },
      });
      await transaction.integrationAuditLog.create({
        data: { userId: session.user.id, integrationId: id, service: input.service.id, action: "created", name: input.name },
      });
      return integration;
    });
    return NextResponse.json({ integration: { ...created, baseUrl: input.baseUrl, credentialSaved: true } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
