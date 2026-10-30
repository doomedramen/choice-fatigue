import "server-only";
import { decryptIntegrationConfig, integrationEncryptionContext } from "@/lib/integrations/crypto";
import { IntegrationRequestError } from "@/lib/integrations/request";
import { prisma } from "@/lib/prisma";

export async function getSavedSeerrTitle(userId: string, integrationId: string, catalogueEntryId: string) {
  const [connection, discovery, entry] = await Promise.all([
    prisma.userIntegration.findFirst({ where: { id: integrationId, userId } }),
    prisma.discoveryState.findUnique({ where: { userId }, select: { state: true } }),
    prisma.catalogueEntry.findFirst({ where: { id: catalogueEntryId, active: true } }),
  ]);
  if (!connection) throw new IntegrationRequestError(404, "Connection not found.");
  if (connection.service !== "seerr") throw new IntegrationRequestError(409, "This action is available through Seerr in this release.");

  const state = discovery?.state;
  const saved = state && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>).saved : null;
  if (!Array.isArray(saved) || !saved.includes(catalogueEntryId)) throw new IntegrationRequestError(403, "Save this title to your account before checking or requesting it.");
  if (!entry) throw new IntegrationRequestError(404, "This title is no longer available in the catalogue.");
  if (entry.category === "Adult") throw new IntegrationRequestError(403, "Adult titles cannot be sent through Seerr.");

  const sourceMatch = entry.source === "tmdb" ? /^(movie|tv):(\d{1,10})$/.exec(entry.sourceId) : null;
  const tmdbId = sourceMatch ? Number(sourceMatch[2]) : NaN;
  if (!sourceMatch || !Number.isSafeInteger(tmdbId) || tmdbId < 1 || tmdbId > 2_147_483_647) {
    throw new IntegrationRequestError(409, "This title has no supported TMDB link for Seerr.");
  }

  const config = decryptIntegrationConfig(connection.encryptedConfig, integrationEncryptionContext(connection.userId, connection.id));
  return { connection, entry, config, mediaType: sourceMatch[1] as "movie" | "tv", tmdbId };
}
