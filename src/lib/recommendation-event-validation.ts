import { providerTitleCategory, parseProviderTitleId } from "@/lib/media-provider-id";

export const recommendationCategories = ["Movies", "Shows", "Adult"] as const;
export type RecommendationCategory = (typeof recommendationCategories)[number];
export type RecommendationSource = "tmdb" | "theporndb" | "stashdb";
export type RecommendationLane = "popular" | "personalized" | "related" | "person" | "company";
export const recommendationEventTypes = ["candidate_batch", "retrieval_snapshot", "item_shown", "decision", "decision_undone", "shortlist_withdrawn", "review_started", "review_removed", "review_restored", "review_kept", "saved", "save_withdrawn", "review_abandoned", "session_ended"] as const;
export const recommendationAlgorithmVersions = ["content-v3", "content-v4", "content-v5", "content-v6", "content-v7"] as const;
export type RecommendationAlgorithmVersion = (typeof recommendationAlgorithmVersions)[number];
export const currentRecommendationAlgorithmVersion: RecommendationAlgorithmVersion = "content-v7";
/** History keeps every readable version; new writes come only from current clients or outboxes queued just before an upgrade. */
export const writableRecommendationAlgorithmVersions: readonly RecommendationAlgorithmVersion[] = ["content-v6", "content-v7"];
/** Client clocks order history, so writes must fall near the time the server received them. */
export const recommendationEventMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
export const recommendationEventMaxFutureMs = 60 * 1000;

export type RelatedProvenance = { seedItemId: string; seedEventId: string; endpoint: "recommendations"; page: number; positions: number[] };
export type RetrievalSnapshot = { candidateRequestedIds: string[]; candidateResolvedIds: string[]; historicalRequestedIds: string[]; historicalResolvedIds: string[] };
export function isRelatedProvenance(value: RecommendationEventInput["provenance"]): value is RelatedProvenance { return !!value && "endpoint" in value; }

export type RecommendationEventInput = {
  id: string; sessionId: string; reviewId: string | null; sequence: number; itemId: string | null; candidateIds: string[] | null;
  category: RecommendationCategory; eventType: (typeof recommendationEventTypes)[number]; decision: "keep" | "pass" | "seen" | null;
  rating: number | null; targetEventId: string | null; algorithmVersion: RecommendationAlgorithmVersion; occurredAt: string;
  provenance?: RelatedProvenance | RetrievalSnapshot | null; retrievalId: string | null; source: RecommendationSource | null; lane: RecommendationLane | null;
};

function isStringId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 200; }
export const recommendationProviderCategoryForId = providerTitleCategory;

export function isValidRecommendationEvent(value: unknown): value is RecommendationEventInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const keys = ["id", "sessionId", "reviewId", "sequence", "itemId", "candidateIds", "category", "eventType", "decision", "rating", "targetEventId", "algorithmVersion", "occurredAt", "retrievalId", "source", "lane", "provenance"];
  if (Object.keys(event).some(key => !keys.includes(key)) || keys.filter(key => key !== "provenance").some(key => !(key in event))) return false;
  if (!isStringId(event.id) || !isStringId(event.sessionId) || !(event.reviewId === null || isStringId(event.reviewId))) return false;
  if (!Number.isSafeInteger(event.sequence) || Number(event.sequence) < 0 || Number(event.sequence) > 2147483647) return false;
  if (!(event.itemId === null || isStringId(event.itemId)) || !recommendationCategories.includes(event.category as RecommendationCategory)) return false;
  if (!(event.candidateIds === null || Array.isArray(event.candidateIds) && event.candidateIds.length <= (event.eventType === "retrieval_snapshot" ? 600 : 100) && event.candidateIds.every(isStringId) && new Set(event.candidateIds).size === event.candidateIds.length)) return false;
  if (!recommendationEventTypes.includes(event.eventType as RecommendationEventInput["eventType"])) return false;
  if (!(event.decision === null || event.decision === "keep" || event.decision === "pass" || event.decision === "seen")) return false;
  if (!(event.rating === null || Number.isInteger(event.rating) && Number(event.rating) >= 1 && Number(event.rating) <= (event.algorithmVersion === "content-v3" ? 5 : 10))) return false;
  if (event.decision !== "seen" && event.rating !== null) return false;
  if (!(event.targetEventId === null || isStringId(event.targetEventId)) || !recommendationAlgorithmVersions.includes(event.algorithmVersion as RecommendationAlgorithmVersion)) return false;
  if (typeof event.occurredAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.occurredAt) || !Number.isFinite(Date.parse(event.occurredAt))) return false;
  if (event.eventType === "candidate_batch") {
    return isStringId(event.retrievalId) && event.itemId === null && event.decision === null && event.targetEventId === null && event.reviewId === null && Array.isArray(event.candidateIds) && event.candidateIds.length > 0
      && ["tmdb", "theporndb", "stashdb"].includes(event.source as string) && ["popular", "personalized", "related", "person", "company"].includes(event.lane as string)
      && (!["related", "person", "company"].includes(event.lane as string) || ["content-v5", "content-v6", "content-v7"].includes(event.algorithmVersion as string) && event.source === "tmdb" && event.category !== "Adult")
      && (event.lane === "related" ? event.category === "Shows" && event.source === "tmdb" && Boolean(event.provenance && typeof event.provenance === "object" && isStringId((event.provenance as Record<string, unknown>).seedEventId) && /^tmdb-tv-[1-9]\d*$/.test(String((event.provenance as Record<string, unknown>).seedItemId)) && (event.provenance as Record<string, unknown>).endpoint === "recommendations" && Number.isSafeInteger((event.provenance as Record<string, unknown>).page) && Number((event.provenance as Record<string, unknown>).page) >= 1 && Number((event.provenance as Record<string, unknown>).page) <= 500 && Object.keys(event.provenance as object).length === 5 && Array.isArray((event.provenance as Record<string, unknown>).positions) && ((event.provenance as Record<string, unknown>).positions as unknown[]).length === event.candidateIds.length && ((event.provenance as Record<string, unknown>).positions as unknown[]).every(position => Number.isSafeInteger(position) && Number(position) >= 1 && Number(position) <= 100)) : event.provenance == null)
      && event.candidateIds.every(id => parseProviderTitleId(id)?.provider === event.source);
  }
  if (event.eventType === "retrieval_snapshot") {
    if (!["content-v6", "content-v7"].includes(event.algorithmVersion as string) || !isStringId(event.retrievalId) || event.itemId !== null || event.decision !== null || event.targetEventId !== null || event.reviewId !== null || event.source !== null || event.lane !== null || !Array.isArray(event.candidateIds) || !event.provenance || typeof event.provenance !== "object" || Array.isArray(event.provenance)) return false;
    const snapshot = event.provenance as Record<string, unknown>;
    const keys = ["candidateRequestedIds", "candidateResolvedIds", "historicalRequestedIds", "historicalResolvedIds"];
    if (Object.keys(snapshot).length !== keys.length || !keys.every(key => Array.isArray(snapshot[key]) && (snapshot[key] as unknown[]).length <= (key.startsWith("candidate") ? 10 : 12) && (snapshot[key] as unknown[]).every(id => isStringId(id) && providerTitleCategory(id) === event.category) && new Set(snapshot[key] as string[]).size === (snapshot[key] as string[]).length)) return false;
    return (snapshot.candidateResolvedIds as string[]).every(id => (snapshot.candidateRequestedIds as string[]).includes(id)) && (snapshot.historicalResolvedIds as string[]).every(id => (snapshot.historicalRequestedIds as string[]).includes(id));
  }
  if (event.retrievalId !== null || event.source !== null || event.lane !== null || event.provenance != null) return false;
  if (event.eventType === "item_shown") return isStringId(event.itemId) && event.decision === null && Array.isArray(event.candidateIds) && event.candidateIds[0] === event.itemId;
  if (event.candidateIds !== null) return false;
  if (event.eventType === "decision") return isStringId(event.itemId) && event.decision !== null && (event.decision !== "seen" || event.rating !== null);
  if (event.decision !== null || event.rating !== null) return false;
  if (event.eventType === "decision_undone") return isStringId(event.itemId) && isStringId(event.targetEventId);
  if (["shortlist_withdrawn", "review_removed", "review_restored", "review_kept", "saved", "save_withdrawn"].includes(event.eventType as string)) return isStringId(event.itemId);
  return event.itemId === null;
}

export function recommendationEventMatchesCategory(event: RecommendationEventInput) {
  return [...(event.itemId ? [event.itemId] : []), ...(event.candidateIds ?? [])].every(id => providerTitleCategory(id) === event.category);
}

export type RejectedRecommendationEvent = { id: string | null; index: number; code: "invalid" | "category" | "adult_disabled" | "duplicate" | "version" | "occurred_at_out_of_range" | "invalid_target" };

export function partitionRecommendationEvents(events: unknown[], adultAllowed: boolean, receivedAt = Date.now()) {
  const accepted: RecommendationEventInput[] = [];
  const rejected: RejectedRecommendationEvent[] = [];
  const seen = new Set<string>();
  events.forEach((value, index) => {
    const id = value && typeof value === "object" && isStringId((value as { id?: unknown }).id) ? (value as { id: string }).id : null;
    const code = !isValidRecommendationEvent(value) ? "invalid"
      : !writableRecommendationAlgorithmVersions.includes(value.algorithmVersion) ? "version"
      : Date.parse(value.occurredAt) < receivedAt - recommendationEventMaxAgeMs || Date.parse(value.occurredAt) > receivedAt + recommendationEventMaxFutureMs ? "occurred_at_out_of_range"
      : !recommendationEventMatchesCategory(value) ? "category"
      : value.category === "Adult" && !adultAllowed ? "adult_disabled"
      : seen.has(value.id) ? "duplicate" : null;
    if (code) rejected.push({ id, index, code });
    else { accepted.push(value as RecommendationEventInput); seen.add(id!); }
  });
  return { accepted, rejected };
}

type UndoTarget = { id: string; itemId: string | null; eventType: string };

/** An undo must name the same user's decision for the same title, stored already or earlier in this batch. */
export function invalidUndoTargetIds(events: RecommendationEventInput[], storedTargets: UndoTarget[]) {
  const targets = new Map<string, UndoTarget>(storedTargets.map(target => [target.id, target]));
  const invalid = new Set<string>();
  for (const event of events) {
    if (event.eventType === "decision_undone") {
      const target = targets.get(event.targetEventId ?? "");
      if (!target || target.eventType !== "decision" || target.itemId !== event.itemId) invalid.add(event.id);
    }
    if (!invalid.has(event.id)) targets.set(event.id, event);
  }
  return invalid;
}

/**
 * A save may name the decision that shortlisted it. A target that is not this user's decision for the
 * same title is not trusted; the route drops the link and keeps the save, which still counts on its own.
 */
export function unverifiedSaveTargetIds(events: RecommendationEventInput[], storedTargets: UndoTarget[]) {
  const targets = new Map<string, UndoTarget>(storedTargets.map(target => [target.id, target]));
  const unverified = new Set<string>();
  for (const event of events) {
    if (event.eventType === "saved" && event.targetEventId) {
      const target = targets.get(event.targetEventId);
      if (!target || target.eventType !== "decision" || target.itemId !== event.itemId) unverified.add(event.id);
    }
    targets.set(event.id, event);
  }
  return unverified;
}
