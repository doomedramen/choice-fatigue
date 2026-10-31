import assert from "node:assert/strict";
import test from "node:test";
import type { MediaItem } from "../src/data";
import { buildRecommendationProfile, effectiveRecommendationEvents, mergeRecommendationEvents, rankRecommendations, recommendationBaseline, recommendationComparisonsFromHistory, recommendationFeatureItemIds, recommendationRetrievalFeatures, recommendationSignalsFromHistory, relatedShowSeeds, reviewRatingWeights, shownCandidateIds, type RecommendationHistoryEvent } from "../src/lib/recommendations";

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
test("one corrected history: undo and save withdrawal agree across ranker, seeds, and comparisons", () => {
  const keep = event({ id: "keep", itemId: "tmdb-tv-7", category: "Shows", decision: "seen", rating: 9 });
  const save = event({ id: "save", itemId: "tmdb-tv-7", category: "Shows", eventType: "saved", decision: null, targetEventId: "keep", occurredAt: "2026-10-31T10:01:00.000Z" });
  const withdraw = event({ id: "withdraw", itemId: "tmdb-tv-7", category: "Shows", eventType: "save_withdrawn", decision: null, occurredAt: "2026-10-31T10:02:00.000Z" });
  const resave = event({ id: "resave", itemId: "tmdb-tv-7", category: "Shows", eventType: "saved", decision: null, occurredAt: "2026-10-31T10:03:00.000Z" });
  assert.deepEqual(effectiveRecommendationEvents([keep, save, withdraw]).map(row => row.id), ["keep"]);
  assert.deepEqual(effectiveRecommendationEvents([keep, save, withdraw, resave]).map(row => row.id), ["keep", "resave"]);
  assert.deepEqual(effectiveRecommendationEvents(effectiveRecommendationEvents([keep, save, withdraw])).map(row => row.id), ["keep"], "idempotent");
  const withdrawnSignals = recommendationSignalsFromHistory([keep, save, withdraw], "Shows");
  assert.deepEqual(withdrawnSignals.map(signal => signal.itemId), ["tmdb-tv-7"], "the first impression still counts");
  const undo = event({ id: "undo", itemId: "tmdb-tv-7", category: "Shows", eventType: "decision_undone", decision: null, targetEventId: "keep", occurredAt: "2026-10-31T10:04:00.000Z" });
  assert.deepEqual(recommendationSignalsFromHistory([keep, save, undo], "Shows"), [], "a save that rests on an undone decision is dropped everywhere");
  assert.deepEqual(relatedShowSeeds([keep, save, undo]), []);
  const removed = event({ id: "removed", reviewId: "r", itemId: "a", eventType: "review_removed", decision: null });
  const reviewSave = event({ id: "review-save", reviewId: "r", itemId: "b", eventType: "saved", decision: null });
  assert.equal(recommendationComparisonsFromHistory([removed, reviewSave]).length, 1);
  assert.equal(recommendationComparisonsFromHistory([removed, reviewSave, event({ id: "w", itemId: "b", eventType: "save_withdrawn", decision: null, occurredAt: "2026-10-31T10:05:00.000Z" })]).length, 0);
});
test("features are scored against the user's base rate, not against zero", () => {
  const signals = (count: number, genre: string, decision: "keep" | "pass") => Array.from({ length: count }, (_, index) => ({ itemId: `${genre}-${decision}-${index}`, decision, featureKeys: [`genre:${genre}`] }));
  // Mostly passes: Drama is kept a little above this user's usual rate, Comedy below it, Horror is unseen.
  const history = [...signals(3, "drama", "keep"), ...signals(30, "drama", "pass"), ...signals(20, "comedy", "pass")];
  const items = [item("horror", "Horror"), item("comedy", "Comedy"), item("drama", "Drama")];
  assert.deepEqual(rankRecommendations(items, history).items.map(row => row.id), ["drama", "horror", "comedy"]);
  assert.ok(recommendationBaseline(history) < 0);
  assert.equal(recommendationBaseline(history.slice(0, 4)), 0, "too few signals keep the neutral cold-start baseline");
});
test("each title counts once: repeats, re-ratings, and saves do not stack", () => {
  const keep = event({ id: "k1" });
  const repeat = event({ id: "k2", sessionId: "other-device", occurredAt: "2026-10-31T10:01:00.000Z" });
  assert.equal(recommendationSignalsFromHistory([keep, repeat]).length, 1);
  const rated = recommendationSignalsFromHistory([event({ id: "r1", decision: "seen", rating: 4 }), event({ id: "r2", decision: "seen", rating: 9, occurredAt: "2026-10-31T10:01:00.000Z" })]);
  assert.deepEqual(rated.map(signal => signal.rating), [9], "the latest rating wins");
  const saved = recommendationSignalsFromHistory([keep, repeat, event({ id: "s", eventType: "saved", decision: null, occurredAt: "2026-10-31T10:02:00.000Z" })]);
  assert.deepEqual(saved.map(signal => [signal.itemId, signal.weight]), [["old", 1.5]]);
});
test("the comparison cap samples every saved title before repeating one", () => {
  const history = [
    ...Array.from({ length: 30 }, (_, index) => event({ id: `rm${index}`, reviewId: "r", itemId: `removed-${index}`, eventType: "review_removed", decision: null, sequence: index })),
    ...Array.from({ length: 6 }, (_, index) => event({ id: `sv${index}`, reviewId: "r", itemId: `saved-${index}`, eventType: "saved", decision: null, sequence: 100 + index })),
  ];
  const pairs = recommendationComparisonsFromHistory(history);
  assert.equal(pairs.length, 24);
  assert.deepEqual(new Set(pairs.slice(0, 6).map(pair => pair.preferredItemId)).size, 6);
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
  assert.equal(profile.signals.length, 1, "a kept-then-saved title is one piece of evidence");
  assert.equal(profile.signals[0].weight, 1.5);
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
