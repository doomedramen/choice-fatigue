import "server-only";
import { media } from "@/data";
import { prisma } from "@/lib/prisma";

export async function userHasAdultGrant(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { adultAllowed: true } });
  return user?.adultAllowed === true;
}

export async function getAdultCatalogueIds() {
  return new Set(media.filter(item => item.category === "Adult").map(item => item.id));
}

export function isAdultCatalogueId(id: string, knownIds?: Set<string>) {
  return knownIds?.has(id) === true || /^theporndb-(?:scene|movie)-[A-Za-z0-9_-]{1,128}$/.test(id) || /^stashdb-[A-Za-z0-9_-]{1,160}$/.test(id);
}
