import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, requireSession } from "@/lib/auth-session";
import { getGlobalSettings } from "@/lib/global-settings";
import {
  decryptIntegrationConfig,
  encryptIntegrationConfig,
  IntegrationEncryptionUnavailableError,
  integrationEncryptionContext,
  isIntegrationEncryptionConfigured,
} from "@/lib/integrations/crypto";
import { getIntegrationService } from "@/lib/integrations/registry";
import { IntegrationRequestError, readIntegrationJson, requireSameOrigin } from "@/lib/integrations/request";
import { prisma } from "@/lib/prisma";
import { serverConfig } from "@/lib/server-config";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function parseUpdateInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IntegrationRequestError(400, "Connection details are invalid.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["name", "baseUrl", "apiKey"].includes(key))) throw new IntegrationRequestError(400, "Connection details are invalid.");
  if ("apiKey" in input && typeof input.apiKey !== "string") throw new IntegrationRequestError(400, "Credential must be text.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const baseUrlText = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (name.length < 1 || name.length > 60 || baseUrlText.length > 2048 || apiKey.length > 4096) throw new IntegrationRequestError(400, "Enter a connection name and valid server address.");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrlText);
  } catch {
    throw new IntegrationRequestError(400, "Enter a complete server address, including http:// or https://.");
  }
  if ((parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new IntegrationRequestError(400, "Use an http or https address without credentials, query parameters, or fragments.");
  }
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "");
  return { name, baseUrl: parsedUrl.toString().replace(/\/$/, ""), apiKey };
}

function handleError(error: unknown) {
  if (error instanceof AuthenticationError) return jsonError("Sign in is required.", 401);
  if (error instanceof IntegrationRequestError) return jsonError(error.message, error.status);
  if (error instanceof IntegrationEncryptionUnavailableError) return jsonError("Secure connection storage is not configured on this server.", 503);
  console.error("User integration update failed.");
  return jsonError("Connection could not be updated. Try again shortly.", 500);
}

async function authenticate(request: NextRequest) {
  requireSameOrigin(request);
  return requireSession();
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await authenticate(request);
  } catch (error) {
    return handleError(error);
  }

  try {
    const id = (await params).id;
    const input = parseUpdateInput(await readIntegrationJson(request, MAX_BODY_BYTES));
    const current = await prisma.userIntegration.findFirst({ where: { id, userId: session.user.id } });
    if (!current) return jsonError("Connection not found.", 404);
    const service = getIntegrationService(current.service);
    if (!service) return jsonError("This saved service is no longer supported.", 410);
    if (service.adultOnly) {
      const settings = await getGlobalSettings();
      if (!serverConfig.adultSectionEnabled || !settings.adultSectionEnabled) return jsonError("Enable the Adult section before changing this connection.", 403);
    }
    if (!isIntegrationEncryptionConfigured()) throw new IntegrationEncryptionUnavailableError();

    const context = integrationEncryptionContext(session.user.id, current.id);
    const previousConfig = decryptIntegrationConfig(current.encryptedConfig, context);
    const encryptedConfig = encryptIntegrationConfig({ baseUrl: input.baseUrl, apiKey: input.apiKey || previousConfig.apiKey }, context);
    const updated = await prisma.$transaction(async transaction => {
      const integration = await transaction.userIntegration.update({
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
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await authenticate(request);
  } catch (error) {
    return handleError(error);
  }

  try {
    const id = (await params).id;
    const current = await prisma.userIntegration.findFirst({ where: { id, userId: session.user.id }, select: { id: true, service: true, name: true } });
    if (!current) return jsonError("Connection not found.", 404);
    await prisma.$transaction(async transaction => {
      await transaction.integrationAuditLog.create({
        data: { userId: session.user.id, integrationId: current.id, service: current.service, action: "deleted", name: current.name },
      });
      await transaction.userIntegration.delete({ where: { id: current.id } });
    });
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleError(error);
  }
}
