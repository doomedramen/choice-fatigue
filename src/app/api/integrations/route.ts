import { randomUUID } from "node:crypto";
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
const MAX_CONNECTIONS = 24;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function parseConnectionInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IntegrationRequestError(400, "Connection details are invalid.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["service", "name", "baseUrl", "apiKey"].includes(key))) throw new IntegrationRequestError(400, "Connection details are invalid.");

  const service = getIntegrationService(input.service);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const baseUrlText = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (!service || name.length < 1 || name.length > 60 || baseUrlText.length > 2048 || apiKey.length < 1 || apiKey.length > 4096) {
    throw new IntegrationRequestError(400, "Enter a service, connection name, server address, and credential.");
  }

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

  return { service, name, baseUrl: parsedUrl.toString().replace(/\/$/, ""), apiKey };
}

function adultIntegrationAllowed() {
  return serverConfig.adultSectionEnabled;
}

function handleError(error: unknown) {
  if (error instanceof AuthenticationError) return jsonError("Sign in is required.", 401);
  if (error instanceof IntegrationRequestError) return jsonError(error.message, error.status);
  if (error instanceof IntegrationEncryptionUnavailableError) return jsonError("Secure connection storage is not configured on this server.", 503);
  console.error("User integrations request failed.");
  return jsonError("Connections could not be saved. Try again shortly.", 500);
}

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await prisma.userIntegration.findMany({ where: { userId: session.user.id }, orderBy: [{ service: "asc" }, { createdAt: "asc" }] });
    const encryptionConfigured = isIntegrationEncryptionConfigured();
    const integrations = rows.map(row => ({
      id: row.id,
      service: row.service,
      name: row.name,
      baseUrl: encryptionConfigured ? decryptIntegrationConfig(row.encryptedConfig, integrationEncryptionContext(row.userId, row.id)).baseUrl : null,
      credentialSaved: true as const,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    return NextResponse.json({ integrations, encryptionConfigured }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return handleError(error);
  }

  try {
    requireSameOrigin(request);
    const input = parseConnectionInput(await readIntegrationJson(request, MAX_BODY_BYTES));
    if (input.service.adultOnly && !adultIntegrationAllowed()) return jsonError("Adult integrations are unavailable while the Adult section is disabled.", 403);
    const settings = await getGlobalSettings();
    if (input.service.adultOnly && !settings.adultSectionEnabled) return jsonError("Enable the Adult section before adding this connection.", 403);
    if (!isIntegrationEncryptionConfigured()) throw new IntegrationEncryptionUnavailableError();

    const existingCount = await prisma.userIntegration.count({ where: { userId: session.user.id } });
    if (existingCount >= MAX_CONNECTIONS) return jsonError("You’ve reached the maximum number of saved service connections.", 409);

    const id = randomUUID();
    const encryptedConfig = encryptIntegrationConfig(
      { baseUrl: input.baseUrl, apiKey: input.apiKey },
      integrationEncryptionContext(session.user.id, id),
    );
    const created = await prisma.$transaction(async transaction => {
      const integration = await transaction.userIntegration.create({
        data: { id, userId: session.user.id, service: input.service.id, name: input.name, encryptedConfig },
        select: { id: true, service: true, name: true, createdAt: true, updatedAt: true },
      });
      await transaction.integrationAuditLog.create({
        data: { userId: session.user.id, integrationId: id, service: input.service.id, action: "created", name: input.name },
      });
      return integration;
    });
    return NextResponse.json({ integration: { ...created, baseUrl: input.baseUrl, credentialSaved: true } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleError(error);
  }
}
