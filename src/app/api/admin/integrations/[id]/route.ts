import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireAdmin } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";
import { adminIntegrationEncryptionContext, decryptIntegrationConfig, encryptIntegrationConfig, IntegrationCiphertextError, IntegrationEncryptionUnavailableError, isIntegrationEncryptionConfigured } from "@/lib/integrations/crypto";
import { parseAdminServiceUpdateInput } from "@/lib/integrations/admin-service";
import { IntegrationRequestError, readIntegrationJson, requireSameOrigin } from "@/lib/integrations/request";
import { getIntegrationService } from "@/lib/integrations/registry";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof IntegrationEncryptionUnavailableError) return NextResponse.json({ error: "Secure connection storage is not available." }, { status: 503 });
  if (error instanceof IntegrationCiphertextError) return NextResponse.json({ error: "This saved service could not be decrypted. Re-enter its details and try again." }, { status: 503 });
  console.error("Admin service connection update failed.");
  return NextResponse.json({ error: "Service connection could not be updated. Try again shortly." }, { status: 500 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireAdmin();
    requireSameOrigin(request);
  } catch (error) {
    return errorResponse(error);
  }

  try {
    const { id } = await params;
    const input = parseAdminServiceUpdateInput(await readIntegrationJson(request, 16 * 1024));
    const current = await prisma.adminServiceIntegration.findUnique({ where: { id } });
    if (!current) return NextResponse.json({ error: "Service connection not found." }, { status: 404 });
    const service = getIntegrationService(current.service);
    if (!service) return NextResponse.json({ error: "This saved service is no longer supported." }, { status: 410 });
    if (service.adultOnly && !(await getGlobalSettings()).adultSectionEnabled) return NextResponse.json({ error: "Enable the Adult section before changing this service." }, { status: 403 });
    if (!isIntegrationEncryptionConfigured()) throw new IntegrationEncryptionUnavailableError();

    const context = adminIntegrationEncryptionContext(current.id);
    const previousConfig = decryptIntegrationConfig(current.encryptedConfig, context);
    const encryptedConfig = encryptIntegrationConfig({ baseUrl: input.baseUrl, apiKey: input.apiKey || previousConfig.apiKey }, context);
    const updated = await prisma.$transaction(async transaction => {
      const integration = await transaction.adminServiceIntegration.update({
        where: { id: current.id },
        data: { name: input.name, encryptedConfig },
        select: { id: true, service: true, name: true, createdAt: true, updatedAt: true },
      });
      await transaction.integrationAuditLog.create({
        data: { userId: session.user.id, integrationId: current.id, service: current.service, action: input.apiKey ? "credential_replaced" : "updated", name: input.name },
      });
      return integration;
    });
    return NextResponse.json({ integration: { ...updated, baseUrl: input.baseUrl, credentialSaved: true } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireAdmin();
    requireSameOrigin(request);
  } catch (error) {
    return errorResponse(error);
  }

  try {
    const { id } = await params;
    const current = await prisma.adminServiceIntegration.findUnique({ where: { id }, select: { id: true, service: true, name: true } });
    if (!current) return NextResponse.json({ error: "Service connection not found." }, { status: 404 });
    await prisma.$transaction(async transaction => {
      await transaction.integrationAuditLog.create({
        data: { userId: session.user.id, integrationId: current.id, service: current.service, action: "deleted", name: current.name },
      });
      await transaction.adminServiceIntegration.delete({ where: { id: current.id } });
    });
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
