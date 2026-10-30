import { NextRequest, NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireAdmin, requireSession } from "@/lib/auth-session";
import { IntegrationRequestError, requireSameOrigin } from "@/lib/integrations/request";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
    const integrations = await prisma.adminServiceIntegration.findMany({
      select: { id: true, service: true, name: true },
      orderBy: [{ service: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ integrations }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    return NextResponse.json({ error: "Service connections could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    requireSameOrigin(request);
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "Only administrators can manage shared service connections." }, { status: 403 });
    if (error instanceof IntegrationRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Service connection could not be saved." }, { status: 500 });
  }
  return NextResponse.json({ error: "Use Admin settings to manage shared service connections." }, { status: 410 });
}
