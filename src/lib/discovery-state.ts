import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-session";

export async function getDiscoveryStateRecord() {
  const session = await requireSession();
  return prisma.discoveryState.findUnique({
    where: { userId: session.user.id },
    select: { state: true, revision: true },
  });
}

export async function saveDiscoveryState(state: Prisma.InputJsonValue, expectedRevision: number): Promise<{ state: Prisma.JsonValue; revision: number } | null> {
  const session = await requireSession();
  const where = { userId: session.user.id };
  const existing = await prisma.discoveryState.findUnique({ where, select: { revision: true } });
  if (!existing) {
    if (expectedRevision !== 0) return null;
    try {
      const row = await prisma.discoveryState.create({ data: { ...where, state, revision: 1 }, select: { state: true, revision: true } });
      return row;
    } catch (error) {
      // Another tab may have initialized state after the read above.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return null;
      throw error;
    }
  }
  if (existing.revision !== expectedRevision) return null;
  const updated = await prisma.discoveryState.updateMany({
    where: { ...where, revision: expectedRevision },
    data: { state, revision: { increment: 1 } },
  });
  if (updated.count !== 1) return null;
  return { state: state as Prisma.JsonValue, revision: expectedRevision + 1 };
}
