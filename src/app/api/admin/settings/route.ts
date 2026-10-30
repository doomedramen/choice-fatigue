import { NextResponse, type NextRequest } from "next/server";
import { getAdminGlobalSettings, saveAdminGlobalSettings } from "@/lib/global-settings";
import { requireAdmin, AuthenticationError, AuthorizationError } from "@/lib/auth-session";
import { IntegrationRequestError, requireSameOrigin } from "@/lib/integrations/request";

const categories = ["Movies", "TV", "Anime"] as const;
const acceptedKeys = ["appName", "defaultCategory", "adultSectionEnabled", "allowPrivateNetworkTargets", "betaInviteCode", "smtpEnabled", "smtpFrom", "smtpUrl", "clearSmtpConfig"] as const;

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.message.startsWith("Add the SMTP") || error instanceof Error && error.message.startsWith("Use a valid smtp") || error instanceof Error && error.message.startsWith("Enter a valid SMTP") || error instanceof Error && error.message.startsWith("Disable password")) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof Error && error.message === "Secure credential storage is unavailable.") return NextResponse.json({ error: error.message }, { status: 503 });
  console.error("Admin settings request failed.", error);
  return NextResponse.json({ error: "Settings could not be saved." }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await getAdminGlobalSettings(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();
    requireSameOrigin(request);
  } catch (error) {
    return errorResponse(error);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Expected JSON settings." }, { status: 400 });

  let value: unknown;
  try { value = await request.json(); } catch { return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Settings have an invalid shape." }, { status: 400 });
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !(acceptedKeys as readonly string[]).includes(key))
    || typeof input.appName !== "string" || input.appName.trim().length < 1 || input.appName.trim().length > 50
    || !categories.includes(input.defaultCategory as typeof categories[number])
    || typeof input.adultSectionEnabled !== "boolean"
    || typeof input.allowPrivateNetworkTargets !== "boolean"
    || typeof input.betaInviteCode !== "string" || input.betaInviteCode.trim().length > 128
    || typeof input.smtpEnabled !== "boolean"
    || typeof input.smtpFrom !== "string" || input.smtpFrom.trim().length > 254
    || typeof input.smtpUrl !== "string" || input.smtpUrl.length > 2048
    || typeof input.clearSmtpConfig !== "boolean") {
    return NextResponse.json({ error: "Settings have an invalid value." }, { status: 400 });
  }

  try {
    const settings = await saveAdminGlobalSettings({
      appName: input.appName.trim(),
      defaultCategory: input.defaultCategory as string,
      adultSectionEnabled: input.adultSectionEnabled,
      allowPrivateNetworkTargets: input.allowPrivateNetworkTargets,
      betaInviteCode: input.betaInviteCode,
      smtpEnabled: input.smtpEnabled,
      smtpFrom: input.smtpFrom,
      smtpUrl: input.smtpUrl,
      clearSmtpConfig: input.clearSmtpConfig,
    });
    return NextResponse.json(settings, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
