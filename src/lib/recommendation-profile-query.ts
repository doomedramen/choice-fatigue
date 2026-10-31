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
