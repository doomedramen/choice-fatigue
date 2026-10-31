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

export function settleRecommendationBatch(batch: RecommendationEventInput[], acceptedIds: string[], rejected: RejectedRecommendationEvent[]) {
  const accepted = new Set(acceptedIds);
  const rejectedIndices = new Set(rejected.map(event => event.index));
  return {
    confirmed: batch.filter(event => accepted.has(event.id)),
    quarantined: batch.filter((event, index) => !accepted.has(event.id) && rejectedIndices.has(index)),
    remaining: batch.filter((event, index) => !accepted.has(event.id) && !rejectedIndices.has(index)),
  };
}
