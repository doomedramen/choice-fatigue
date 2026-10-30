import assert from "node:assert/strict";
import test from "node:test";
import { isValidRecommendationEvent, recommendationEventMatchesCategory, recommendationProviderCategoryForId } from "../src/lib/recommendation-event-validation";

const baseEvent = {
  id: "event-1", sessionId: "session-1", reviewId: null, sequence: 1, itemId: null, category: "Movies",
  eventType: "candidate_set", decision: null, rating: null, targetEventId: null, algorithmVersion: "content-v2",
} as const;

test("accepts bounded ordered candidate IDs and legacy events without candidate IDs", () => {
  assert.equal(isValidRecommendationEvent({ ...baseEvent, candidateIds: ["tmdb-movie-12", "tmdb-movie-13"] }), true);
  const legacyShown = { ...baseEvent, itemId: "tmdb-movie-12", eventType: "item_shown" };
  delete (legacyShown as { candidateIds?: string[] }).candidateIds;
  assert.equal(isValidRecommendationEvent(legacyShown), true);
});

test("rejects duplicate, oversized, misordered, and metadata-bearing candidate events", () => {
  assert.equal(isValidRecommendationEvent({ ...baseEvent, candidateIds: ["tmdb-movie-12", "tmdb-movie-12"] }), false);
  assert.equal(isValidRecommendationEvent({ ...baseEvent, candidateIds: Array.from({ length: 101 }, (_, i) => `tmdb-movie-${i + 1}`) }), false);
  assert.equal(isValidRecommendationEvent({ ...baseEvent, eventType: "item_shown", itemId: "tmdb-movie-12", candidateIds: ["tmdb-movie-13"] }), false);
  assert.equal(isValidRecommendationEvent({ ...baseEvent, candidateIds: ["tmdb-movie-12"], title: "Cached title" }), false);
});

test("classifies provider IDs into strict media categories", () => {
  assert.equal(recommendationProviderCategoryForId("tmdb-movie-12"), "Movies");
  assert.equal(recommendationProviderCategoryForId("tmdb-tv-12"), "Shows");
  assert.equal(recommendationProviderCategoryForId("theporndb-scene-ab12"), "Adult");
  assert.equal(recommendationProviderCategoryForId("stashdb-ab12"), "Adult");
  assert.equal(recommendationProviderCategoryForId("unknown-12"), null);
  assert.equal(recommendationEventMatchesCategory({ ...baseEvent, candidateIds: ["tmdb-movie-12"] }, new Map()), true);
  assert.equal(recommendationEventMatchesCategory({ ...baseEvent, category: "Adult", candidateIds: ["tmdb-movie-12"] } as never), false);
  assert.equal(recommendationEventMatchesCategory({ ...baseEvent, category: "Adult", candidateIds: ["theporndb-scene-ab12"] } as never), true);
});
