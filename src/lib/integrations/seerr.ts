import "server-only";
import type { IntegrationConfig } from "@/lib/integrations/crypto";
import { requestIntegrationService } from "@/lib/integrations/http";

export const seerrAvailabilityStates = ["not-listed", "not-requested", "unknown", "pending", "processing", "partially-available", "available", "deleted"] as const;
export type SeerrAvailability = (typeof seerrAvailabilityStates)[number];

export class SeerrApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "SeerrApiError";
  }
}

export const seerrAvailabilityLabels: Record<SeerrAvailability, string> = {
  "not-listed": "No matching result in Seerr",
  "not-requested": "Not requested",
  unknown: "Seerr status unknown",
  pending: "Request pending",
  processing: "Being added",
  "partially-available": "Partly available",
  available: "Available in your library",
  deleted: "Removed from Seerr",
};

export function seerrAlreadyTracksTitle(status: SeerrAvailability) {
  return status === "pending" || status === "processing" || status === "partially-available" || status === "available";
}

export async function getSeerrAvailability(config: IntegrationConfig, input: { title: string; mediaType: "movie" | "tv"; tmdbId: number }): Promise<SeerrAvailability> {
  if (!input.title.trim() || input.title.length > 160) throw new SeerrApiError(422, "This title cannot be checked in Seerr.");
  const query = new URLSearchParams({ query: input.title, page: "1" });
  const response = await requestIntegrationService(config, `api/v1/search?${query.toString()}`);
  if (response.status === 401 || response.status === 403) throw new SeerrApiError(422, "Seerr rejected the API key. Check the key and its permissions.");
  if (response.status < 200 || response.status >= 300) throw new SeerrApiError(502, "Seerr could not check this title.");

  let payload: unknown;
  try { payload = JSON.parse(response.body) as unknown; }
  catch { throw new SeerrApiError(502, "Seerr returned an invalid search response."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray((payload as Record<string, unknown>).results)) {
    throw new SeerrApiError(502, "Seerr returned an invalid search response.");
  }

  const results = (payload as { results: unknown[] }).results;
  const match = results.find(result => result && typeof result === "object" && !Array.isArray(result)
    && (result as Record<string, unknown>).id === input.tmdbId
    && (result as Record<string, unknown>).mediaType === input.mediaType);
  if (!match || typeof match !== "object" || Array.isArray(match)) return "not-listed";
  const mediaInfo = (match as Record<string, unknown>).mediaInfo;
  if (!mediaInfo || typeof mediaInfo !== "object" || Array.isArray(mediaInfo)) return "not-requested";

  const status = (mediaInfo as Record<string, unknown>).status;
  if (status === 2) return "pending";
  if (status === 3) return "processing";
  if (status === 4) return "partially-available";
  if (status === 5) return "available";
  if (status === 6) return "deleted";
  return "unknown";
}
