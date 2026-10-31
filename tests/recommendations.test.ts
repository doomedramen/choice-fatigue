import assert from "node:assert/strict";
import test from "node:test";
import type { MediaItem } from "../src/data";
import { buildRecommendationProfile, mergeRecommendationEvents, rankRecommendations, recommendationComparisonsFromHistory, recommendationFeatureItemIds, recommendationRetrievalFeatures, recommendationSignalsFromHistory, reviewRatingWeights, shownCandidateIds, type RecommendationHistoryEvent } from "../src/lib/recommendations";

const item = (id: string, genre: string, rating = "—"): MediaItem => ({ id, title: id, type: "Movie", runtime: "90m", rating, genre: genre ? [genre] : [], synopsis: "", palette: ["#000", "#111", "#222"], art: "mist", label: id, category: "Movies" });
const event = (overrides: Partial<RecommendationHistoryEvent> = {}): RecommendationHistoryEvent => ({ id: "e", sessionId: "run", reviewId: null, itemId: "old", category: "Movies", eventType: "decision", decision: "keep", rating: null, targetEventId: null, occurredAt: "2026-10-31T10:00:00.000Z", ...overrides });

test("cold start preserves provider order and ignores provider ratings", () => {
  const items = [item("low", "", "1.0"), item("high", "", "10.0")];
  assert.deepEqual(rankRecommendations(items).items.map(row => row.id), ["low", "high"]);
});
test("seen ratings are centered on neutral; passive exposure does not train", () => {
  assert.deepEqual([2, 4, 6, 8, 10].map(value => reviewRatingWeights[value]), [-0.5, -0.25, 0, 0.5, 1]);
  assert.equal(buildRecommendationProfile([event({ decision: "seen", rating: 5, algorithmVersion: "content-v3" })], { old: ["genre:comedy"] }, "Movies").signals[0].rating, 10);
  const profile = buildRecommendationProfile([event({ decision: "seen", rating: 10 })], { old: ["genre:comedy"] }, "Movies");
  assert.equal(rankRecommendations([item("drama", "Drama"), item("comedy", "Comedy")], profile.signals).items[0].id, "comedy");
  assert.deepEqual(recommendationSignalsFromHistory([event({ eventType: "item_shown", decision: null })]), []);
});
test("undo retracts consideration, while shortlist and review removal preserve it", () => {
  const initial = event();
  for (const eventType of ["shortlist_withdrawn", "review_removed"]) {
    const history = [initial, event({ id: eventType, eventType, decision: null, targetEventId: initial.id })];
    assert.equal(buildRecommendationProfile(history, { old: ["genre:drama"] }, "Movies").signals.length, 1);
  }
  assert.deepEqual(recommendationSignalsFromHistory([initial, event({ id: "undo", eventType: "decision_undone", decision: null, targetEventId: initial.id })]), []);
});
test("review comparisons stay within one review and restoration cancels removal", () => {
  const history = [event({ id: "remove", reviewId: "r1", itemId: "a", eventType: "review_removed", decision: null }), event({ id: "save", reviewId: "r1", itemId: "b", eventType: "saved", decision: null }), event({ id: "other", reviewId: "r2", itemId: "c", eventType: "saved", decision: null })];
  assert.deepEqual(recommendationComparisonsFromHistory(history), [{ preferredItemId: "b", removedItemId: "a" }]);
  history.push(event({ id: "restore", reviewId: "r1", itemId: "a", eventType: "review_restored", decision: null }));
  assert.deepEqual(recommendationComparisonsFromHistory(history), []);
});
test("reload, off-feed evidence, and saved retention survive without double counting", () => {
  const old = event();
  const saved = event({ id: "save", eventType: "saved", decision: null });
  const events = mergeRecommendationEvents([old, saved], [old, saved]);
  const profile = buildRecommendationProfile(events, { old: ["genre:comedy"] }, "Movies");
  assert.equal(profile.signals.length, 2);
  assert.equal(profile.signals.filter(signal => signal.weight === 1.5).length, 1);
  assert.equal(rankRecommendations([item("drama", "Drama"), item("comedy", "Comedy")], profile.signals).items[0].id, "comedy");
  const pendingUndo = event({ id: "undo", eventType: "decision_undone", targetEventId: "e", decision: null });
  assert.equal(buildRecommendationProfile(mergeRecommendationEvents(events, [pendingUndo]), { old: ["genre:comedy"] }, "Movies").signals.length, 1);
});
test("confidence grows with evidence and category boundaries are strict", () => {
  const signal = (id: string, genre: string) => ({ itemId: id, decision: "keep" as const, featureKeys: [`genre:${genre}`] });
  assert.equal(rankRecommendations([item("comedy", "Comedy"), item("drama", "Drama")], [signal("a", "drama"), signal("b", "drama"), signal("c", "drama"), signal("d", "comedy")]).items[0].id, "drama");
  assert.deepEqual(buildRecommendationProfile([event({ category: "Adult" })], { old: ["genre:drama"] }, "Movies").signals, []);
});
test("retrieval requires three distinct titles and never derives hard negative filters", () => {
  const profile = (ids: string[], decision: "keep" | "pass" = "keep") => ids.map(itemId => ({ itemId, decision, featureKeys: ["genre:drama"] }));
  assert.deepEqual(recommendationRetrievalFeatures(profile(["a", "a", "a"])), []);
  assert.deepEqual(recommendationRetrievalFeatures(profile(["a", "b", "c"])), ["genre:drama"]);
  assert.deepEqual(recommendationRetrievalFeatures(profile(["a", "b", "c"], "pass")), []);
});
test("hydration prioritizes last actions rather than first appearances or pair order", () => {
  const history = [event({ id: "1", itemId: "a", sequence: 0 }), event({ id: "2", itemId: "b", sequence: 1 }), event({ id: "3", itemId: "a", sequence: 2, eventType: "saved", decision: null })];
  assert.deepEqual(recommendationFeatureItemIds(history, "Movies"), ["a", "b"]);
});
test("shown traces put the locked card first and bound accumulated catalogues", () => {
  const ranked = rankRecommendations([item("a", "Drama"), item("b", "Drama"), item("c", "Comedy")], [{ itemId: "a", decision: "pass", featureKeys: ["genre:drama"] }]).items.filter(row => row.id !== "a");
  assert.deepEqual(ranked.map(row => row.id), ["c", "b"]);
  assert.deepEqual(shownCandidateIds("b", ranked.map(row => row.id)), ["b", "c"]);
  assert.equal(shownCandidateIds("locked", Array.from({ length: 120 }, (_, index) => String(index))).length, 100);
});
