import { NextResponse, type NextRequest } from "next/server";
import { getGlobalSettings } from "@/lib/global-settings";
import { requireAdmin, AuthenticationError, AuthorizationError } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";
import { serverConfig } from "@/lib/server-config";

const categories = ["Movies", "TV", "Anime"] as const;

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  console.error("Admin settings request failed.", error);
  return NextResponse.json({ error: "Settings could not be loaded." }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ ...await getGlobalSettings(), adultCanBeEnabled: serverConfig.adultSectionEnabled });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return errorResponse(error);
  }

  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Expected JSON settings." }, { status: 400 });

  let value: unknown;
  try { value = await request.json(); } catch { return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Settings have an invalid shape." }, { status: 400 });
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 3 || typeof input.appName !== "string" || input.appName.trim().length < 1 || input.appName.trim().length > 50 || !categories.includes(input.defaultCategory as typeof categories[number]) || typeof input.adultSectionEnabled !== "boolean") {
    return NextResponse.json({ error: "Settings have an invalid value." }, { status: 400 });
  }
  if (input.adultSectionEnabled && !serverConfig.adultSectionEnabled) return NextResponse.json({ error: "Adult is disabled by the server configuration." }, { status: 400 });

  try {
    const settings = await prisma.globalSettings.upsert({
      where: { id: "global" },
      create: { id: "global", appName: input.appName.trim(), defaultCategory: input.defaultCategory as string, adultSectionEnabled: input.adultSectionEnabled },
      update: { appName: input.appName.trim(), defaultCategory: input.defaultCategory as string, adultSectionEnabled: input.adultSectionEnabled },
    });
    return NextResponse.json({ appName: settings.appName, defaultCategory: settings.defaultCategory, adultSectionEnabled: serverConfig.adultSectionEnabled && settings.adultSectionEnabled, adultCanBeEnabled: serverConfig.adultSectionEnabled });
  } catch (error) {
    return errorResponse(error);
  }
}
