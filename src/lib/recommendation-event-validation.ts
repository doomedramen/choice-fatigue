export const recommendationCategories = ["Movies", "Shows", "Adult"] as const;
export type RecommendationCategory = (typeof recommendationCategories)[number];

export const recommendationEventTypes = ["candidate_set", "item_shown", "decision", "decision_undone", "shortlist_withdrawn", "review_started", "review_removed", "review_restored", "review_kept", "saved", "review_abandoned", "session_ended"] as const;
const algorithmVersions = ["content-v1", "content-v2"] as const;

export type RecommendationEventInput = {
  id: string; sessionId: string; reviewId: string | null; sequence: number; itemId: string | null; candidateIds?: string[] | null;
  category: RecommendationCategory; eventType: (typeof recommendationEventTypes)[number]; decision: "keep" | "pass" | "seen" | null;
  rating: number | null; targetEventId: string | null; algorithmVersion: (typeof algorithmVersions)[number];
};

function isStringId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

export function recommendationProviderCategoryForId(id: string): RecommendationCategory | null {
  if (/^tmdb-movie-\d{1,10}$/.test(id)) return "Movies";
  if (/^tmdb-tv-\d{1,10}$/.test(id)) return "Shows";
  if (/^theporndb-(?:scene|movie)-[A-Za-z0-9_-]{1,128}$/.test(id) || /^stashdb-[A-Za-z0-9_-]{1,160}$/.test(id)) return "Adult";
  return null;
}

export function isValidRecommendationEvent(value: unknown): value is RecommendationEventInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const keys = ["id", "sessionId", "reviewId", "sequence", "itemId", "candidateIds", "category", "eventType", "decision", "rating", "targetEventId", "algorithmVersion"];
  const legacyKeys = keys.filter(key => key !== "candidateIds");
  if (!(Object.keys(event).length === keys.length || Object.keys(event).length === legacyKeys.length) || Object.keys(event).some(key => !keys.includes(key))) return false;
  if (!isStringId(event.id) || !isStringId(event.sessionId) || !(event.reviewId === null || isStringId(event.reviewId))) return false;
  if (!Number.isSafeInteger(event.sequence) || Number(event.sequence) < 0) return false;
  if (!(event.itemId === null || isStringId(event.itemId)) || !recommendationCategories.includes(event.category as RecommendationCategory)) return false;
  if (!(event.candidateIds === undefined || event.candidateIds === null || Array.isArray(event.candidateIds) && event.candidateIds.length <= 100 && event.candidateIds.every(isStringId) && new Set(event.candidateIds).size === event.candidateIds.length)) return false;
  if (!recommendationEventTypes.includes(event.eventType as (typeof recommendationEventTypes)[number])) return false;
  if (!(event.decision === null || event.decision === "keep" || event.decision === "pass" || event.decision === "seen")) return false;
  if (!(event.rating === null || Number.isInteger(event.rating) && Number(event.rating) >= 1 && Number(event.rating) <= 5)) return false;
  if ((event.decision !== "seen" && event.rating !== null) || (event.decision === null && event.rating !== null)) return false;
  if (!(event.targetEventId === null || isStringId(event.targetEventId)) || !algorithmVersions.includes(event.algorithmVersion as (typeof algorithmVersions)[number])) return false;
  if (event.eventType === "candidate_set") return event.itemId === null && Array.isArray(event.candidateIds) && event.candidateIds.length > 0;
  if (event.eventType === "item_shown") return isStringId(event.itemId) && (event.candidateIds === undefined || event.candidateIds === null || event.candidateIds[0] === event.itemId);
  if (event.eventType === "decision") return isStringId(event.itemId) && event.decision !== null && (event.decision !== "seen" || event.rating !== null);
  if (event.decision !== null || event.rating !== null) return false;
  if (["decision_undone", "shortlist_withdrawn", "review_removed", "review_restored", "review_kept", "saved"].includes(event.eventType as string)) return isStringId(event.itemId);
  return true;
}

export function recommendationEventMatchesCategory(event: RecommendationEventInput, fixtures: ReadonlyMap<string, string> = new Map()) {
  const itemIds = [...(event.itemId ? [event.itemId] : []), ...(event.candidateIds ?? [])];
  return itemIds.every(id => (fixtures.get(id) ?? recommendationProviderCategoryForId(id)) === event.category);
}
