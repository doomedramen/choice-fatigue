import "server-only";
import { adminIntegrationEncryptionContext, decryptIntegrationConfig } from "@/lib/integrations/crypto";
import { IntegrationRequestError } from "@/lib/integrations/request";
import { prisma } from "@/lib/prisma";
import { getTmdbTitleDetails, TmdbRequestError, type TmdbMediaType } from "@/lib/providers/tmdb";

export async function getSavedTmdbTitle(userId: string, integrationId: string, catalogueEntryId: string, service: "seerr" | "plex") {
  const [connection, discovery] = await Promise.all([
    prisma.adminServiceIntegration.findUnique({ where: { id: integrationId } }),
    prisma.discoveryState.findUnique({ where: { userId }, select: { state: true } }),
  ]);
  if (!connection) throw new IntegrationRequestError(404, "Connection not found.");
  const serviceName = service === "seerr" ? "Seerr" : "Plex";
  if (connection.service !== service) throw new IntegrationRequestError(409, `This action is available through ${serviceName} in this release.`);

  const state = discovery?.state;
  const saved = state && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>).saved : null;
  if (!Array.isArray(saved) || !saved.includes(catalogueEntryId)) throw new IntegrationRequestError(403, "Save this title to your account before checking or requesting it.");
  const sourceMatch = /^tmdb-(movie|tv)-(\d{1,10})$/.exec(catalogueEntryId);
  const tmdbId = sourceMatch ? Number(sourceMatch[2]) : NaN;
  if (!sourceMatch || !Number.isSafeInteger(tmdbId) || tmdbId < 1 || tmdbId > 2_147_483_647) {
    throw new IntegrationRequestError(409, `This title has no supported TMDB link for ${serviceName}.`);
  }

  let details: Awaited<ReturnType<typeof getTmdbTitleDetails>>;
  try {
    details = await getTmdbTitleDetails(sourceMatch[1] as TmdbMediaType, tmdbId);
  } catch (error) {
    if (error instanceof TmdbRequestError) throw new IntegrationRequestError(404, "This title is no longer available from TMDB.");
    throw error;
  }

  const config = decryptIntegrationConfig(connection.encryptedConfig, adminIntegrationEncryptionContext(connection.id));
  return {
    connection,
    entry: { ...details, category: sourceMatch[1] === "movie" ? "Movies" : "Shows" },
    config,
    mediaType: sourceMatch[1] as TmdbMediaType,
    tmdbId,
  };
}

export function getSavedSeerrTitle(userId: string, integrationId: string, catalogueEntryId: string) {
  return getSavedTmdbTitle(userId, integrationId, catalogueEntryId, "seerr");
}
