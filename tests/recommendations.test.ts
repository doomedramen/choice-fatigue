import assert from "node:assert/strict";
import test from "node:test";
import type { MediaItem } from "../src/data";
import { rankSessionRecommendations, recommendationSignalsFromHistory } from "../src/lib/recommendations";

const item = (id: string, title: string, genre: string): MediaItem => ({
  id, title, type: "Movie", runtime: "90m", rating: "5.0", genre: [genre], synopsis: "",
  palette: ["#000", "#111", "#222"], art: "mist", label: title, category: "Movies",
});

test("history keeps decisions across sessions and applies 1–5 star ratings", () => {
  const events = [
    { id: "keep", sessionId: "old", itemId: "a", eventType: "decision", decision: "keep", rating: null, targetEventId: null },
    { id: "seen", sessionId: "old", itemId: "b", eventType: "decision", decision: "seen", rating: 1, targetEventId: null },
  ];
  const signals = recommendationSignalsFromHistory(events);
  const ranked = rankSessionRecommendations([item("candidate-a", "A", "Drama"), item("candidate-b", "B", "Comedy")], {}, {}, [
    { ...signals[0], itemId: "candidate-a" }, { ...signals[1], itemId: "candidate-b" },
  ]);
  assert.deepEqual(ranked.items.map(candidate => candidate.id), ["candidate-a", "candidate-b"]);
});

test("passive impressions are retained in history but do not train preferences", () => {
  assert.deepEqual(recommendationSignalsFromHistory([
    { id: "shown", sessionId: "old", itemId: "a", eventType: "item_shown", decision: null, rating: null, targetEventId: null },
  ]), []);
});

test("undo and pre-review shortlist withdrawal remove the original signal", () => {
  const events = [
    { id: "keep", sessionId: "old", itemId: "a", eventType: "decision", decision: "keep", rating: null, targetEventId: null },
    { id: "undo", sessionId: "old", itemId: "a", eventType: "decision_undone", decision: null, rating: null, targetEventId: "keep" },
    { id: "pass", sessionId: "old", itemId: "b", eventType: "decision", decision: "pass", rating: null, targetEventId: null },
    { id: "withdraw", sessionId: "old", itemId: "b", eventType: "shortlist_withdrawn", decision: null, rating: null, targetEventId: "pass" },
  ];
  assert.deepEqual(recommendationSignalsFromHistory(events), []);
});

test("review pruning removes keep evidence without creating a pass, and restore reinstates it", () => {
  const events = [
    { id: "keep", sessionId: "old", itemId: "a", eventType: "decision", decision: "keep", rating: null, targetEventId: null },
    { id: "removed", sessionId: "old", itemId: "a", eventType: "review_removed", decision: null, rating: null, targetEventId: "keep" },
  ];
  assert.deepEqual(recommendationSignalsFromHistory(events), []);
  events.push({ id: "restored", sessionId: "old", itemId: "a", eventType: "review_restored", decision: null, rating: null, targetEventId: "keep" });
  assert.deepEqual(recommendationSignalsFromHistory(events), [{ itemId: "a", decision: "keep", rating: undefined }]);
});

test("profile replay excludes the active session", () => {
  const events = [
    { id: "old", sessionId: "old", itemId: "a", eventType: "decision", decision: "keep", rating: null, targetEventId: null },
    { id: "current", sessionId: "current", itemId: "b", eventType: "decision", decision: "pass", rating: null, targetEventId: null },
  ];
  assert.deepEqual(recommendationSignalsFromHistory(events, "current"), [{ itemId: "a", decision: "keep", rating: undefined }]);
});

test("profile replay does not mix categories", () => {
  const events = [
    { id: "movie", sessionId: "old", itemId: "shared-id", category: "Movies", eventType: "decision", decision: "keep", rating: null, targetEventId: null },
    { id: "adult", sessionId: "old", itemId: "shared-id", category: "Adult", eventType: "decision", decision: "pass", rating: null, targetEventId: null },
  ];
  assert.deepEqual(recommendationSignalsFromHistory(events, null, "Movies"), [{ itemId: "shared-id", decision: "keep", rating: undefined }]);
});
