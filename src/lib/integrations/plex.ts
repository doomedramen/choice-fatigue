import "server-only";
import type { IntegrationConfig } from "@/lib/integrations/crypto";
import { requestIntegrationService } from "@/lib/integrations/http";

export class PlexApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "PlexApiError";
  }
}

export async function getPlexLibraryAvailability(
  config: IntegrationConfig,
  input: { title: string; year?: number; mediaType: "movie" | "tv"; tmdbId: number },
): Promise<boolean> {
  if (!input.title.trim() || input.title.length > 160 || !Number.isSafeInteger(input.tmdbId) || input.tmdbId < 1) {
    throw new PlexApiError(422, "This title cannot be checked in Plex.");
  }

  const query = new URLSearchParams({
    type: input.mediaType === "movie" ? "1" : "2",
    guid: `tmdb://${input.tmdbId}`,
    title: input.title,
  });
  if (input.year && Number.isInteger(input.year) && input.year >= 1870 && input.year <= 2200) query.set("year", String(input.year));

  const response = await requestIntegrationService(config, `library/matches?${query.toString()}`, { credentialHeader: "x-plex-token" });
  if (response.status === 401 || response.status === 403) throw new PlexApiError(422, "Plex rejected this token. Check the token and its server access.");
  if (response.status < 200 || response.status >= 300) throw new PlexApiError(502, "Plex could not check this title.");

  let payload: unknown;
  try { payload = JSON.parse(response.body) as unknown; }
  catch { throw new PlexApiError(502, "Plex returned an invalid library match response."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new PlexApiError(502, "Plex returned an invalid library match response.");
  const container = (payload as Record<string, unknown>).MediaContainer;
  if (!container || typeof container !== "object" || Array.isArray(container)) throw new PlexApiError(502, "Plex returned an invalid library match response.");
  const matches = (container as Record<string, unknown>).Metadata;
  if (matches === undefined) return false;
  if (!Array.isArray(matches)) throw new PlexApiError(502, "Plex returned an invalid library match response.");

  return matches.some(match => {
    if (!match || typeof match !== "object" || Array.isArray(match)) return false;
    const fields = match as Record<string, unknown>;
    const score = typeof fields.score === "number" || typeof fields.score === "string" ? Number(fields.score) : 0;
    return score >= 85 && fields.type === (input.mediaType === "movie" ? "movie" : "show");
  });
}
