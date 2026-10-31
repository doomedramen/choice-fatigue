import type { RecommendationEventInput, RejectedRecommendationEvent } from "@/lib/recommendation-event-validation";

/** Bound the serialized request, not just the event count. */
export function recommendationEventBatch(events: RecommendationEventInput[], maxBytes = 240 * 1024): RecommendationEventInput[] {
  const batch: RecommendationEventInput[] = [];
  for (const event of events.slice(0, 64)) {
    const next = [...batch, event];
    if (new TextEncoder().encode(JSON.stringify({ events: next })).byteLength > maxBytes) break;
    batch.push(event);
  }
  return batch;
}

/**
 * Settled events leave the outbox. Rejections are quarantined, except Adult events refused only
 * because access is off right now: those are held and offered again once access returns.
 */
export function settleRecommendationBatch(batch: RecommendationEventInput[], acceptedIds: string[], rejected: RejectedRecommendationEvent[]) {
  const accepted = new Set(acceptedIds);
  const codes = new Map(rejected.map(event => [event.index, event.code]));
  return {
    confirmed: batch.filter(event => accepted.has(event.id)),
    held: batch.filter((event, index) => !accepted.has(event.id) && codes.get(index) === "adult_disabled"),
    quarantined: batch.filter((event, index) => !accepted.has(event.id) && codes.has(index) && codes.get(index) !== "adult_disabled"),
    remaining: batch.filter((event, index) => !accepted.has(event.id) && !codes.has(index)),
  };
}
