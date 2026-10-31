import { recommendationAlgorithmVersions, type RecommendationCategory } from "@/lib/recommendation-event-validation";

/** Only these event types train the profile; traces (shown cards, batches, snapshots) are for replay. */
export const recommendationProfileEventTypes = ["decision", "decision_undone", "shortlist_withdrawn", "review_started", "review_removed", "review_restored", "review_kept", "saved", "save_withdrawn", "review_abandoned"] as const;
/** The most recent preference events per category; older evidence ages out instead of growing every read. */
export const recommendationProfileHistoryLimit = 5000;

/** Newest first so `take` keeps recent evidence; callers reverse the rows into chronological order. */
export function recommendationProfileQuery(userId: string, category: RecommendationCategory) {
  return {
    where: { userId, category, algorithmVersion: { in: [...recommendationAlgorithmVersions] }, eventType: { in: [...recommendationProfileEventTypes] } },
    select: { id: true, sessionId: true, reviewId: true, sequence: true, itemId: true, eventType: true, decision: true, rating: true, targetEventId: true, algorithmVersion: true, occurredAt: true },
    orderBy: [{ occurredAt: "desc" as const }, { sessionId: "desc" as const }, { sequence: "desc" as const }, { id: "desc" as const }],
    take: recommendationProfileHistoryLimit,
  };
}

/**
 * Titles decided or saved before the capped profile window began. They no longer train the profile,
 * but they must stay out of the deck; IDs only, so the read stays cheap however long the history.
 */
export function recommendationConsideredBeforeQuery(userId: string, category: RecommendationCategory, before: Date) {
  return {
    where: { userId, category, eventType: { in: ["decision", "saved"] }, itemId: { not: null }, occurredAt: { lt: before } },
    select: { itemId: true },
    distinct: ["itemId" as const],
  };
}

/** Trace events exist only for offline replay; they are kept for 180 days, preference events forever. */
export const recommendationTraceEventTypes = ["item_shown", "candidate_batch", "retrieval_snapshot"] as const;
export const recommendationTraceRetentionMs = 180 * 24 * 60 * 60 * 1000;

export function recommendationTracePruneQuery(userId: string, now = Date.now()) {
  return { where: { userId, eventType: { in: [...recommendationTraceEventTypes] }, occurredAt: { lt: new Date(now - recommendationTraceRetentionMs) } } };
}
