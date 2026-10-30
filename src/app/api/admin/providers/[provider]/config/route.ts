import { NextRequest, NextResponse } from "next/server";
import { AuthorizationError, AuthenticationError, requireAdmin } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";
import { IntegrationRequestError, requireSameOrigin } from "@/lib/integrations/request";
import {
  adultMetadataProviders,
  getAdultMetadataProviderStatus,
  saveAdultMetadataProviderConfig,
  type AdultMetadataProvider,
  AdultMetadataProviderConfigurationError,
} from "@/lib/providers/adult-metadata-config";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof AdultMetadataProviderConfigurationError) return NextResponse.json({ error: error.message || "Provider credential settings could not be saved." }, { status: 503 });
  console.error("Admin Adult metadata provider settings request failed.");
  return NextResponse.json({ error: "Provider settings could not be saved." }, { status: 500 });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  try {
    await requireAdmin();
  } catch (error) {
    return errorResponse(error);
  }

  const { provider } = await params;
  if (!adultMetadataProviders.includes(provider as AdultMetadataProvider)) return NextResponse.json({ error: "Unknown metadata provider." }, { status: 404 });
  try { requireSameOrigin(request); } catch (error) { return errorResponse(error); }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Expected a JSON request." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Settings have an invalid shape." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !["apiKey", "enabled"].includes(key)) || typeof input.apiKey !== "string" || input.apiKey.length > 4096 || typeof input.enabled !== "boolean") {
    return NextResponse.json({ error: "Settings have an invalid value." }, { status: 400 });
  }

  try {
    const status = await saveAdultMetadataProviderConfig(provider as AdultMetadataProvider, { apiKey: input.apiKey, enabled: input.enabled });
    return NextResponse.json({ status }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  try {
    await requireAdmin();
  } catch (error) {
    return errorResponse(error);
  }
  const { provider } = await params;
  if (!adultMetadataProviders.includes(provider as AdultMetadataProvider)) return NextResponse.json({ error: "Unknown metadata provider." }, { status: 404 });
  try { requireSameOrigin(request); } catch (error) { return errorResponse(error); }
  try {
    await prisma.metadataProviderCredential.deleteMany({ where: { provider } });
    return NextResponse.json({ status: await getAdultMetadataProviderStatus(provider as AdultMetadataProvider) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
