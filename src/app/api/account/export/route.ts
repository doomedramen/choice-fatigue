import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });

  try {
    const [account, discoveryRow, integrationRows, recommendationRows] = await Promise.all([
      prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, email: true, emailVerified: true, adultAllowed: true, createdAt: true } }),
      prisma.discoveryState.findUnique({ where: { userId: session.user.id }, select: { state: true, createdAt: true, updatedAt: true } }),
      prisma.userIntegration.findMany({ where: { userId: session.user.id }, select: { id: true, service: true, name: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: "asc" } }),
      prisma.recommendationEvent.findMany({ where: { userId: session.user.id }, orderBy: [{ createdAt: "asc" }, { sequence: "asc" }] }),
    ]);
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const discoveryState = discoveryRow?.state ?? null;

    const date = new Date().toISOString().slice(0, 10);
    return NextResponse.json({
      format: "choice-fatigue-account-export-v3",
      exportedAt: new Date().toISOString(),
      account,
      integrations: integrationRows.map(({ id, service, name, createdAt, updatedAt }) => ({ id, service, name, createdAt, updatedAt, serverAddressIncluded: false, credentialIncluded: false })),
      discovery: {
        state: discoveryState,
        createdAt: discoveryRow?.createdAt ?? null,
        updatedAt: discoveryRow?.updatedAt ?? null,
      },
      recommendationHistory: recommendationRows,
    }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="choice-fatigue-data-${date}.json"`,
      },
    });
  } catch (error) {
    console.error("Account data export failed.", error);
    return NextResponse.json({ error: "Account data could not be exported." }, { status: 500 });
  }
}
