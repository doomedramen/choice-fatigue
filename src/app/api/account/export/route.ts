import { NextResponse } from "next/server";
import { media } from "@/data";
import { getSession } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";

function referencedTitleIds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const state = value as Record<string, unknown>;
  const ids = new Set<string>();
  for (const key of ["shortlisted", "saved", "reviewRemoved"]) {
    if (Array.isArray(state[key])) for (const id of state[key]) if (typeof id === "string") ids.add(id);
  }
  if (state.decisions && typeof state.decisions === "object" && !Array.isArray(state.decisions)) {
    for (const id of Object.keys(state.decisions)) ids.add(id);
  }
  if (Array.isArray(state.history)) {
    for (const entry of state.history) if (entry && typeof entry === "object" && "id" in entry && typeof entry.id === "string") ids.add(entry.id);
  }
  return [...ids];
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });

  try {
    const [account, discoveryRow] = await Promise.all([
      prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, email: true, emailVerified: true, createdAt: true } }),
      prisma.discoveryState.findUnique({ where: { userId: session.user.id }, select: { state: true, createdAt: true, updatedAt: true } }),
    ]);
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const discoveryState = discoveryRow?.state ?? null;
    const referencedIds = referencedTitleIds(discoveryState);
    const storedCatalogue = referencedIds.length ? await prisma.catalogueEntry.findMany({
      where: { id: { in: referencedIds } },
      select: { id: true, title: true, year: true, type: true, category: true, genres: true, runtime: true },
    }) : [];
    const storedEntriesById = new Map(storedCatalogue.map(item => [item.id, item]));
    const catalogueEntries = referencedIds.map(id => {
      const stored = storedEntriesById.get(id);
      if (stored) return stored;
      const fixture = media.find(item => item.id === id);
      return fixture ? { id, title: fixture.title, year: fixture.year ?? null, type: fixture.type, category: fixture.category, genres: fixture.genre, runtime: fixture.runtime } : null;
    }).filter(item => item !== null);

    const date = new Date().toISOString().slice(0, 10);
    return NextResponse.json({
      format: "choice-fatigue-account-export-v1",
      exportedAt: new Date().toISOString(),
      account,
      discovery: {
        state: discoveryState,
        createdAt: discoveryRow?.createdAt ?? null,
        updatedAt: discoveryRow?.updatedAt ?? null,
        catalogueEntries,
      },
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
