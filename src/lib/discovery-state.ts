import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-session";

export async function getDiscoveryState(): Promise<Prisma.JsonValue | null> {
  const session = await requireSession();
  const row = await prisma.discoveryState.findUnique({
    where: { userId: session.user.id },
    select: { state: true },
  });
  return row?.state ?? null;
}

export async function saveDiscoveryState(state: Prisma.InputJsonValue): Promise<Prisma.JsonValue> {
  const session = await requireSession();
  const row = await prisma.discoveryState.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, state },
    update: { state },
    select: { state: true },
  });
  return row.state;
}
