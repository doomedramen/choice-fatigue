import assert from "node:assert/strict";
import test from "node:test";
import { isValidRecommendationEvent, partitionRecommendationEvents, recommendationEventMatchesCategory, recommendationProviderCategoryForId, type RecommendationEventInput } from "../src/lib/recommendation-event-validation";
import { recommendationEventBatch, settleRecommendationBatch } from "../src/lib/recommendation-outbox";

const base: RecommendationEventInput = { id: "event-1", sessionId: "session-1", reviewId: null, sequence: 1, itemId: null, category: "Movies", eventType: "candidate_batch", decision: null, rating: null, targetEventId: null, algorithmVersion: "content-v3", occurredAt: "2026-10-31T10:00:00.000Z", retrievalId: "fetch-1", source: "tmdb", lane: "popular", candidateIds: ["tmdb-movie-12", "tmdb-movie-13"] };
const decision: RecommendationEventInput = { ...base, id: "decision", eventType: "decision", itemId: "tmdb-movie-12", decision: "keep", candidateIds: null, retrievalId: null, source: null, lane: null };

test("accepts v3 source batches and actual shown order; rejects old contracts and metadata", () => {
  assert.equal(isValidRecommendationEvent(base), true);
  assert.equal(isValidRecommendationEvent({ ...decision, eventType: "item_shown", decision: null, candidateIds: ["tmdb-movie-12", "tmdb-movie-13"] }), true);
  for (const change of [{ algorithmVersion: "content-v2" }, { occurredAt: "bad" }, { title: "Cached metadata" }, { candidateIds: ["tmdb-movie-12", "tmdb-movie-12"] }, { candidateIds: Array.from({ length: 101 }, (_, i) => `tmdb-movie-${i + 1}`) }, { source: "stashdb" }]) {
    assert.equal(isValidRecommendationEvent({ ...base, ...change }), false);
  }
  assert.equal(isValidRecommendationEvent({ ...decision, eventType: "item_shown", decision: null, candidateIds: ["tmdb-movie-13", "tmdb-movie-12"] }), false);
});
test("strict provider IDs prevent category mixing", () => {
  assert.equal(recommendationProviderCategoryForId("tmdb-movie-12"), "Movies");
  assert.equal(recommendationProviderCategoryForId("tmdb-tv-12"), "Shows");
  assert.equal(recommendationProviderCategoryForId("tmdb-movie-0"), null);
  assert.equal(recommendationProviderCategoryForId("stashdb-ab12"), "Adult");
  assert.equal(recommendationEventMatchesCategory({ ...base, category: "Adult" }), false);
});
test("an invalid trace or disabled Adult event cannot block valid decisions", () => {
  const invalid = { ...base, candidateIds: Array.from({ length: 120 }, (_, i) => `tmdb-movie-${i + 1}`) };
  const adult = { ...decision, id: "adult", category: "Adult", itemId: "stashdb-abc" };
  const partition = partitionRecommendationEvents([invalid, decision, adult], false);
  assert.deepEqual(partition.accepted.map(event => event.id), ["decision"]);
  assert.deepEqual(partition.rejected.map(event => event.code), ["invalid", "adult_disabled"]);
});
test("outbox byte limits and partial acknowledgement allow later events to proceed", () => {
  const events = [base, decision];
  const oneSize = new TextEncoder().encode(JSON.stringify({ events: [base] })).byteLength;
  assert.equal(recommendationEventBatch(events, oneSize).length, 1);
  const result = settleRecommendationBatch(events, ["decision"], [{ id: base.id, index: 0, code: "invalid" }]);
  assert.deepEqual(result.confirmed, [decision]);
  assert.deepEqual(result.quarantined, [base]);
  assert.deepEqual(result.remaining, []);
  assert.deepEqual(settleRecommendationBatch(events, [], []).remaining, events);
});

test("ten-point ratings use v4 while queued v3 ratings retain their original range", () => {
  assert.equal(isValidRecommendationEvent({ ...decision, algorithmVersion: "content-v4", decision: "seen", rating: 10 }), true);
  assert.equal(isValidRecommendationEvent({ ...decision, algorithmVersion: "content-v3", decision: "seen", rating: 10 }), false);
  assert.equal(isValidRecommendationEvent({ ...decision, algorithmVersion: "content-v3", decision: "seen", rating: 5 }), true);
});

test("v5 relationship provenance is restricted to valid show batches", () => {
  const provenance = { seedItemId: "tmdb-tv-9", seedEventId: "seed-event", endpoint: "recommendations", page: 1, positions: [1, 3] };
  const batch = { ...base, category: "Shows", algorithmVersion: "content-v5", lane: "related", candidateIds: ["tmdb-tv-12", "tmdb-tv-13"], provenance };
  assert.equal(isValidRecommendationEvent(batch), true);
  assert.equal(isValidRecommendationEvent({ ...batch, algorithmVersion: "content-v4" }), false);
  assert.equal(isValidRecommendationEvent({ ...batch, provenance: { ...provenance, positions: [1] } }), false);
  assert.equal(isValidRecommendationEvent({ ...batch, provenance: { ...provenance, name: "metadata" } }), false);
  assert.equal(isValidRecommendationEvent({ ...decision, provenance }), false);
});
