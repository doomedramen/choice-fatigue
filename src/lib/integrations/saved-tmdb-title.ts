import "server-only";
import { adminIntegrationEncryptionContext, decryptIntegrationConfig } from "@/lib/integrations/crypto";
import { IntegrationRequestError } from "@/lib/integrations/request";
import { prisma } from "@/lib/prisma";

export async function getSavedTmdbTitle(userId: string, integrationId: string, catalogueEntryId: string, service: "seerr" | "plex") {
  const [connection, discovery, entry] = await Promise.all([
    prisma.adminServiceIntegration.findUnique({ where: { id: integrationId } }),
    prisma.discoveryState.findUnique({ where: { userId }, select: { state: true } }),
    prisma.catalogueEntry.findFirst({ where: { id: catalogueEntryId, active: true } }),
  ]);
  if (!connection) throw new IntegrationRequestError(404, "Connection not found.");
  const serviceName = service === "seerr" ? "Seerr" : "Plex";
  if (connection.service !== service) throw new IntegrationRequestError(409, `This action is available through ${serviceName} in this release.`);

  const state = discovery?.state;
  const saved = state && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>).saved : null;
  if (!Array.isArray(saved) || !saved.includes(catalogueEntryId)) throw new IntegrationRequestError(403, "Save this title to your account before checking or requesting it.");
  if (!entry) throw new IntegrationRequestError(404, "This title is no longer available in the catalogue.");
  if (entry.category === "Adult") throw new IntegrationRequestError(403, `Adult titles cannot be checked through ${serviceName}.`);

  const sourceMatch = entry.source === "tmdb" ? /^(movie|tv):(\d{1,10})$/.exec(entry.sourceId) : null;
  const tmdbId = sourceMatch ? Number(sourceMatch[2]) : NaN;
  if (!sourceMatch || !Number.isSafeInteger(tmdbId) || tmdbId < 1 || tmdbId > 2_147_483_647) {
    throw new IntegrationRequestError(409, `This title has no supported TMDB link for ${serviceName}.`);
  }

  const config = decryptIntegrationConfig(connection.encryptedConfig, adminIntegrationEncryptionContext(connection.id));
  return { connection, entry, config, mediaType: sourceMatch[1] as "movie" | "tv", tmdbId };
}

export function getSavedSeerrTitle(userId: string, integrationId: string, catalogueEntryId: string) {
  return getSavedTmdbTitle(userId, integrationId, catalogueEntryId, "seerr");
}
