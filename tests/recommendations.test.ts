import assert from "node:assert/strict";
import test from "node:test";
import type { MediaItem } from "../src/data";
import {
  rankSessionRecommendations,
  recommendationComparisonsFromHistory,
  recommendationSignalsFromHistory,
  reviewRatingWeights,
} from "../src/lib/recommendations";

const item = (id: string, title: string, genre: string, rating = "—"): MediaItem => ({
  id, title, type: "Movie", runtime: "90m", rating, genre: genre ? [genre] : [], synopsis: "",
  palette: ["#000", "#111", "#222"], art: "mist", label: title, category: "Movies",
});

const event = (overrides: Partial<{
  id: string; sessionId: string; reviewId: string | null; itemId: string | null; category: string;
  eventType: string; decision: string | null; rating: number | null; targetEventId: string | null;
}>) => ({
  id: "event", sessionId: "old", reviewId: null, itemId: "provider-1", category: "Movies",
  eventType: "decision", decision: "keep", rating: null, targetEventId: null, ...overrides,
});

test("keeps provider order as the cold start and ignores provider ratings", () => {
  const items = [item("low", "Low provider rating", "", "1.0"), item("high", "High provider rating", "", "10.0")];
  assert.deepEqual(rankSessionRecommendations(items, {}).items.map(candidate => candidate.id), ["low", "high"]);
});

test("uses seen-title ratings on a neutral-centered scale", () => {
  assert.deepEqual(reviewRatingWeights, { 1: -0.5, 2: -0.25, 3: 0, 4: 0.5, 5: 1 });
  const events = [
    event({ id: "seen-1", itemId: "old-drama", decision: "seen", rating: 1 }),
    event({ id: "seen-5", itemId: "old-comedy", decision: "seen", rating: 5 }),
  ];
  const signals = recommendationSignalsFromHistory(events);
  const ranked = rankSessionRecommendations(
    [item("comedy", "Comedy", "comedy"), item("drama", "Drama", "drama")],
    {},
    {},
    [
      { ...signals[0], itemId: "drama", featureKeys: ["genre:drama"] },
      { ...signals[1], itemId: "comedy", featureKeys: ["genre:comedy"] },
    ],
  );
  assert.deepEqual(ranked.items.map(candidate => candidate.id), ["comedy", "drama"]);
});

test("passive impressions do not train preferences", () => {
  assert.deepEqual(recommendationSignalsFromHistory([
    event({ id: "shown", eventType: "item_shown", decision: null }),
  ]), []);
});

test("undo retracts a decision while shortlist withdrawal preserves first-impression evidence", () => {
  const signals = recommendationSignalsFromHistory([
    event({ id: "undone-keep", itemId: "a" }),
    event({ id: "undo", itemId: "a", eventType: "decision_undone", decision: null, targetEventId: "undone-keep" }),
    event({ id: "withdrawn-keep", itemId: "b" }),
    event({ id: "withdraw", itemId: "b", eventType: "shortlist_withdrawn", decision: null, targetEventId: "withdrawn-keep" }),
  ]);
  assert.deepEqual(signals, [{ itemId: "b", decision: "keep", rating: undefined }]);
});

test("review pruning preserves consideration and restoration cancels removed status", () => {
  const events = [
    event({ id: "keep-a", sessionId: "s1", reviewId: "r1", itemId: "a" }),
    event({ id: "remove-a", sessionId: "s1", reviewId: "r1", itemId: "a", eventType: "review_removed", decision: null }),
  ];
  assert.deepEqual(recommendationSignalsFromHistory(events), [{ itemId: "a", decision: "keep", rating: undefined }]);
  assert.deepEqual(recommendationComparisonsFromHistory(events), []);

  events.push(event({ id: "restore-a", sessionId: "s1", reviewId: "r1", itemId: "a", eventType: "review_restored", decision: null }));
  events.push(event({ id: "save-b", sessionId: "s1", reviewId: "r1", itemId: "b", eventType: "saved", decision: null }));
  assert.deepEqual(recommendationComparisonsFromHistory(events), []);
});

test("saved and removed titles become a pair only within the same review", () => {
  const comparisons = recommendationComparisonsFromHistory([
    event({ id: "remove-a", sessionId: "s1", reviewId: "r1", itemId: "a", eventType: "review_removed", decision: null }),
    event({ id: "save-b", sessionId: "s1", reviewId: "r1", itemId: "b", eventType: "saved", decision: null }),
    event({ id: "remove-c", sessionId: "s2", reviewId: "r2", itemId: "c", eventType: "review_removed", decision: null }),
    event({ id: "save-d", sessionId: "s2", reviewId: "r2", itemId: "d", eventType: "saved", decision: null }),
  ]);
  assert.deepEqual(comparisons, [
    { preferredItemId: "d", removedItemId: "c" },
    { preferredItemId: "b", removedItemId: "a" },
  ]);
  assert.deepEqual(recommendationComparisonsFromHistory([
    event({ id: "remove-a", sessionId: "s1", reviewId: "r1", itemId: "a", eventType: "review_removed", decision: null }),
    event({ id: "save-b", sessionId: "s1", reviewId: "r1", itemId: "b", eventType: "saved", decision: null }),
  ], "s1"), []);
});

test("confidence shrinkage gives repeated evidence more weight than a single observation", () => {
  const items = [item("comedy", "Comedy", "comedy"), item("drama", "Drama", "drama")];
  const signal = (itemId: string) => ({ itemId, decision: "keep" as const, featureKeys: [`genre:${itemId}`] });
  const ranked = rankSessionRecommendations(items, {}, {}, [
    signal("drama"), signal("drama"), signal("drama"), signal("comedy"),
  ]);
  assert.deepEqual(ranked.items.map(candidate => candidate.id), ["drama", "comedy"]);
});

test("profile replay excludes the active session and stays category-isolated", () => {
  const signals = recommendationSignalsFromHistory([
    event({ id: "old-movie", sessionId: "old", itemId: "shared-id", category: "Movies" }),
    event({ id: "current-movie", sessionId: "current", itemId: "current-id", category: "Movies", decision: "pass" }),
    event({ id: "adult", sessionId: "old", itemId: "adult-id", category: "Adult", decision: "pass" }),
  ], "current", "Movies");
  assert.deepEqual(signals, [{ itemId: "shared-id", decision: "keep", rating: undefined }]);
});
