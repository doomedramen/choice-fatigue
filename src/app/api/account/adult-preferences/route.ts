import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, requireSession } from "@/lib/auth-session";
import { userHasAdultGrant } from "@/lib/adult-access";
import { adultAccessEnabled } from "@/lib/adult-access-policy";
import { parseHiddenPairings } from "@/lib/adult-pairing";
import { getGlobalSettings } from "@/lib/global-settings";
import { IntegrationRequestError, readIntegrationJson, requireSameOrigin } from "@/lib/integrations/request";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

async function requireAdultAccess(userId: string) {
  const [settings, grant] = await Promise.all([getGlobalSettings(), userHasAdultGrant(userId)]);
  return adultAccessEnabled(settings.adultSectionEnabled, grant);
}

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Adult preferences could not be saved." }, { status: 500 });
}

/** The pairings this account hides in Adult. Only available while the account has Adult access. */
export async function GET() {
  try {
    const session = await requireSession();
    if (!await requireAdultAccess(session.user.id)) return NextResponse.json({ error: "The Adult category is currently disabled." }, { status: 403 });
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { adultHiddenPairings: true } });
    return NextResponse.json({ hiddenPairings: parseHiddenPairings(user?.adultHiddenPairings ?? []) ?? [] }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const session = await requireSession();
    if (!await requireAdultAccess(session.user.id)) return NextResponse.json({ error: "The Adult category is currently disabled." }, { status: 403 });
    const body = await readIntegrationJson(request, 4 * 1024);
    const hiddenPairings = body && typeof body === "object" && !Array.isArray(body) ? parseHiddenPairings((body as { hiddenPairings?: unknown }).hiddenPairings) : null;
    if (!hiddenPairings) return NextResponse.json({ error: "Choose pairings from the list." }, { status: 400 });
    await prisma.user.update({ where: { id: session.user.id }, data: { adultHiddenPairings: hiddenPairings } });
    return NextResponse.json({ hiddenPairings }, { headers });
  } catch (error) { return errorResponse(error); }
}
