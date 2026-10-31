import assert from "node:assert/strict";
import test from "node:test";
import { invalidUndoTargetIds, isValidRecommendationEvent, partitionRecommendationEvents, recommendationEventMatchesCategory, recommendationProviderCategoryForId, type RecommendationEventInput } from "../src/lib/recommendation-event-validation";
import { recommendationEventBatch, settleRecommendationBatch } from "../src/lib/recommendation-outbox";

const base: RecommendationEventInput = { id: "event-1", sessionId: "session-1", reviewId: null, sequence: 1, itemId: null, category: "Movies", eventType: "candidate_batch", decision: null, rating: null, targetEventId: null, algorithmVersion: "content-v3", occurredAt: "2026-10-31T10:00:00.000Z", retrievalId: "fetch-1", source: "tmdb", lane: "popular", candidateIds: ["tmdb-movie-12", "tmdb-movie-13"] };
const decision: RecommendationEventInput = { ...base, id: "decision", eventType: "decision", itemId: "tmdb-movie-12", decision: "keep", candidateIds: null, retrievalId: null, source: null, lane: null };
const receivedAt = Date.parse("2026-10-31T10:01:00.000Z");

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
  const current = { ...decision, algorithmVersion: "content-v7" as const };
  const adult = { ...current, id: "adult", category: "Adult", itemId: "stashdb-abc" };
  const partition = partitionRecommendationEvents([invalid, current, adult], false, receivedAt);
  assert.deepEqual(partition.accepted.map(event => event.id), ["decision"]);
  assert.deepEqual(partition.rejected.map(event => event.code), ["invalid", "adult_disabled"]);
});

test("writes accept only current versions and timestamps near receipt", () => {
  const write = (overrides: Partial<RecommendationEventInput>) => partitionRecommendationEvents([{ ...decision, algorithmVersion: "content-v7", ...overrides }], false, receivedAt).rejected.map(event => event.code);
  assert.deepEqual(write({}), []);
  assert.deepEqual(write({ algorithmVersion: "content-v6" }), []);
  assert.deepEqual(write({ algorithmVersion: "content-v3" }), ["version"]);
  assert.deepEqual(write({ occurredAt: "2027-01-01T00:00:00.000Z" }), ["occurred_at_out_of_range"]);
  assert.deepEqual(write({ occurredAt: "2026-08-01T00:00:00.000Z" }), ["occurred_at_out_of_range"]);
  assert.equal(isValidRecommendationEvent({ ...decision, algorithmVersion: "content-v3" }), true, "older history stays readable");
});

test("save withdrawal names a title; undo must target the same title's decision", () => {
  const withdrawn = { ...decision, id: "withdraw", eventType: "save_withdrawn" as const, decision: null };
  assert.equal(isValidRecommendationEvent(withdrawn), true);
  assert.equal(isValidRecommendationEvent({ ...withdrawn, itemId: null }), false);
  const undo = { ...decision, id: "undo", eventType: "decision_undone" as const, decision: null, targetEventId: "decision" };
  assert.deepEqual([...invalidUndoTargetIds([decision, undo], [])], [], "the target may arrive earlier in the same batch");
  assert.deepEqual([...invalidUndoTargetIds([undo], [{ id: "decision", itemId: "tmdb-movie-12", eventType: "decision" }])], []);
  assert.deepEqual([...invalidUndoTargetIds([undo], [{ id: "decision", itemId: "tmdb-movie-99", eventType: "decision" }])], ["undo"]);
  assert.deepEqual([...invalidUndoTargetIds([undo], [{ id: "decision", itemId: "tmdb-movie-12", eventType: "saved" }])], ["undo"]);
  assert.deepEqual([...invalidUndoTargetIds([undo], [])], ["undo"]);
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
  const held = settleRecommendationBatch(events, [], [{ id: decision.id, index: 1, code: "adult_disabled" }]);
  assert.deepEqual(held.held, [decision], "Adult events refused while access is off are kept for later");
  assert.deepEqual(held.quarantined, []);
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

test("v6 snapshots accept only bounded category-specific IDs and real resolution subsets", () => {
  const snapshot = { ...base, algorithmVersion: "content-v6", eventType: "retrieval_snapshot", source: null, lane: null, candidateIds: ["tmdb-movie-12"], provenance: { candidateRequestedIds: ["tmdb-movie-12"], candidateResolvedIds: ["tmdb-movie-12"], historicalRequestedIds: ["tmdb-movie-13"], historicalResolvedIds: [] } };
  assert.equal(isValidRecommendationEvent(snapshot), true);
  assert.equal(isValidRecommendationEvent({ ...snapshot, provenance: { ...snapshot.provenance, candidateResolvedIds: ["tmdb-movie-13"] } }), false);
  assert.equal(isValidRecommendationEvent({ ...snapshot, provenance: { ...snapshot.provenance, historicalRequestedIds: ["tmdb-tv-1"] } }), false);
  assert.equal(isValidRecommendationEvent({ ...snapshot, algorithmVersion: "content-v5" }), false);
});
