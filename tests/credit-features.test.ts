import test from "node:test";
import assert from "node:assert/strict";
import { creditFeatureKeys, creditPreferences, creditBonus } from "../src/lib/credit-features";
import { relatedShowSeeds, rankRecommendations, recentUnresolvedFeatureIds, type RecommendationHistoryEvent } from "../src/lib/recommendations";
import type { MediaItem } from "../src/data";
const event = (id: string, itemId: string, changes: Partial<RecommendationHistoryEvent> = {}): RecommendationHistoryEvent => ({ id, itemId, sessionId: "s", category: "Shows", eventType: "decision", decision: "seen", rating: 8, targetEventId: null, occurredAt: `2026-10-31T10:00:0${id}.000Z`, algorithmVersion: "content-v4", ...changes });
const item = (id: string): MediaItem => ({ id, title: id, category: "Shows", type: "Series", genre: [], runtime: "—", rating: "—", synopsis: "", label: id, art: "mist", palette: ["", "", ""] });

test("cached history does not expand the twelve-title hydration window", () => {
  const ids = Array.from({ length: 20 }, (_, i) => `tmdb-movie-${i + 1}`);
  const requested = recentUnresolvedFeatureIds(ids, new Set(ids.slice(0, 10)));
  assert.deepEqual(requested, ids.slice(10, 12));
});

test("normalizes and bounds role-specific credit identifiers", () => {
  assert.deepEqual(creditFeatureKeys({ created_by: [{ id: 11 }, { id: 11 }], production_companies: [{ id: 9 }], aggregate_credits: { cast: Array.from({ length: 7 }, (_, id) => ({ id: id + 1, order: id })), crew: [{ id: 5, jobs: [{ job: "Director" }, { job: "Writer" }] }, { id: 6, jobs: [{ job: "Producer" }] }] } }, "tv"), ["actor:1", "actor:2", "actor:3", "actor:4", "actor:5", "director:5", "writer:5", "creator:11", "company:9"]);
});
test("seeds preserve corrected rating scales and choose one rated and one saved", () => {
  const rows = [event("1", "tmdb-tv-1", { algorithmVersion: "content-v3", rating: 4 }), event("2", "tmdb-tv-2", { eventType: "saved", decision: null, rating: null }), event("3", "tmdb-tv-3", { rating: 9 })];
  assert.deepEqual(relatedShowSeeds(rows).map(seed => seed.itemId), ["tmdb-tv-3", "tmdb-tv-2"]);
  assert.deepEqual(relatedShowSeeds([...rows, event("4", "tmdb-tv-3", { eventType: "saved", decision: null, rating: null })]).map(seed => seed.itemId), ["tmdb-tv-3", "tmdb-tv-2"]);
  rows.push(event("4", "tmdb-tv-3", { eventType: "decision_undone", decision: null, rating: null, targetEventId: "3" }));
  assert.deepEqual(relatedShowSeeds(rows).map(seed => seed.itemId), ["tmdb-tv-1", "tmdb-tv-2"]);
  rows.push(event("5", "tmdb-tv-2", { rating: 2 }));
  assert.deepEqual(relatedShowSeeds(rows).map(seed => seed.itemId), ["tmdb-tv-1"]);
});
test("credits require distinct positive titles and produce a bounded neutral-on-missing bonus", () => {
  const signal = (id: string) => ({ itemId: id, decision: "keep" as const, featureKeys: ["actor:77"] });
  assert.equal(creditPreferences([signal("a"), signal("a")])[0].positiveTitles, 1);
  const prefs = creditPreferences([signal("a"), signal("b")]);
  assert.equal(prefs[0].positiveTitles, 2);
  assert.equal(creditBonus([], prefs), 0);
  assert.ok(creditBonus(["actor:77"], prefs) > 0 && creditBonus(["actor:77"], prefs) <= 0.15);
});
test("related rank influences final ordering, using the best rank only", () => {
  const candidates = [item("a"), item("b")];
  assert.deepEqual(rankRecommendations(candidates, [], [], {}, { b: 1 }).items.map(row => row.id), ["b", "a"]);
  assert.deepEqual(rankRecommendations(candidates, [], [], {}, { a: 20, b: 1 }).items.map(row => row.id), ["b", "a"]);
});
