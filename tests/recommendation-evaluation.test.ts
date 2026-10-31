import assert from "node:assert/strict";
import test from "node:test";
import { compareRankings, summarizeMetadataCoverage } from "../src/lib/recommendation-evaluation";

test("compares provider and ranker order against the same saved and shortlisted labels", () => {
  const result = compareRankings([
    { providerOrder: ["a", "b", "c"], rankerOrder: ["c", "b", "a"], shortlisted: ["c"], saved: ["c"] },
    { providerOrder: ["a", "b"], rankerOrder: ["b", "a"], shortlisted: ["b"], saved: [] },
  ]);

  assert.equal(result.providerOrder.saved.meanReciprocalRank, 0.3333);
  assert.equal(result.currentRanker.saved.meanReciprocalRank, 1);
  assert.equal(result.providerOrder.shortlisted.recallAt5, 1);
  assert.equal(result.currentRanker.shortlisted.recallAt5, 1);
  assert.equal(result.providerOrder.saved.labeledTraces, 1);
});

test("reports missing relevant titles as zero coverage instead of inventing a score", () => {
  const result = compareRankings([
    { providerOrder: ["a"], rankerOrder: ["a"], shortlisted: ["missing"], saved: [] },
  ]);
  assert.equal(result.currentRanker.shortlisted.labeledTraces, 0);
  assert.equal(result.currentRanker.shortlisted.meanReciprocalRank, null);
});

test("reports uncapped eligibility separately from the bounded metadata sample", () => {
  assert.deepEqual(summarizeMetadataCoverage(700, 500, 450), {
    eligible: 700,
    requested: 500,
    resolved: 450,
    omittedByLimit: 200,
    resolutionRate: 0.6429,
    attemptedResolutionRate: 0.9,
  });
});

import { replayRecommendationEvents } from "../src/lib/recommendation-evaluation";
import type { RecommendationEventInput } from "../src/lib/recommendation-event-validation";
import type { MediaItem } from "../src/data";
const replayItem = (id: string, genre: string): MediaItem => ({ id, title: id, type: "Movie", runtime: "—", rating: "—", genre: [genre], synopsis: "", category: "Movies", palette: ["", "", ""], art: "mist", label: id });
const replayEvent = (sequence: number, values: Partial<RecommendationEventInput>): RecommendationEventInput => ({ id: `event-${sequence}`, sessionId: "run", reviewId: null, sequence, occurredAt: new Date(Date.UTC(2026, 9, 31, 10, 0, sequence)).toISOString(), category: "Movies", eventType: "item_shown", itemId: null, candidateIds: null, decision: null, rating: null, targetEventId: null, algorithmVersion: "content-v3", retrievalId: null, source: null, lane: null, ...values });

test("replay uses preceding evidence at each impression and includes later pagination", () => {
  const metadata = new Map([replayItem("tmdb-movie-1", "Drama"), replayItem("tmdb-movie-2", "Comedy"), replayItem("tmdb-movie-3", "Drama"), replayItem("tmdb-movie-99", "Drama")].map(item => [item.id, item]));
  const events = [
    replayEvent(0, { eventType: "candidate_batch", candidateIds: ["tmdb-movie-1", "tmdb-movie-2"], retrievalId: "first", source: "tmdb", lane: "popular" }),
    replayEvent(1, { itemId: "tmdb-movie-1", candidateIds: ["tmdb-movie-1", "tmdb-movie-2"] }),
    replayEvent(2, { eventType: "decision", itemId: "tmdb-movie-99", decision: "pass" }),
    replayEvent(3, { itemId: "tmdb-movie-2", candidateIds: ["tmdb-movie-2", "tmdb-movie-1"] }),
    replayEvent(4, { eventType: "decision", itemId: "tmdb-movie-2", decision: "keep" }),
    replayEvent(5, { eventType: "candidate_batch", candidateIds: ["tmdb-movie-3"], retrievalId: "next-page", source: "tmdb", lane: "popular" }),
    replayEvent(6, { itemId: "tmdb-movie-3", candidateIds: ["tmdb-movie-3"] }),
  ];
  const report = replayRecommendationEvents([...events].reverse(), metadata)[0];
  assert.equal(report.impressions, 3);
  assert.equal(report.candidateMetadataCoverage.eligible, 3);
  assert.equal(report.matchedCandidateMixRanking.currentRanker.shortlisted.meanReciprocalRank, 0.75);
  assert.equal(report.matchedCandidateMixRanking.providerOrder.shortlisted.meanReciprocalRank, 0.5);
});
test("replay respects the 12-ID history budget and separates popularity from added candidates", () => {
  const old = Array.from({ length: 13 }, (_, i) => replayEvent(i, { sessionId: "old-run", eventType: "decision", itemId: `tmdb-movie-${100 + i}`, decision: "keep" }));
  const events = [...old,
    replayEvent(14, { eventType: "candidate_batch", candidateIds: ["tmdb-movie-1"], retrievalId: "mix", source: "tmdb", lane: "popular" }),
    replayEvent(15, { eventType: "candidate_batch", candidateIds: ["tmdb-movie-2"], retrievalId: "mix", source: "tmdb", lane: "personalized" }),
    replayEvent(16, { itemId: "tmdb-movie-2", candidateIds: ["tmdb-movie-2", "tmdb-movie-1"] }),
    replayEvent(17, { eventType: "decision", itemId: "tmdb-movie-2", decision: "keep" }),
  ];
  const metadata = new Map([...old.map(event => replayItem(event.itemId!, "Comedy")), replayItem("tmdb-movie-1", "Drama"), replayItem("tmdb-movie-2", "Comedy")].map(item => [item.id, item]));
  const report = replayRecommendationEvents(events, metadata)[0];
  assert.equal(report.historicalFeatureCoverage.eligible, 13);
  assert.equal(report.historicalFeatureCoverage.requested, 12);
  assert.equal(report.historicalFeatureCoverage.omittedByLimit, 1);
  assert.equal(report.matchedPopularityRanking.currentRanker.shortlisted.labeledTraces, 0);
  assert.equal(report.retrievalLanes["tmdb:personalized"].shortlisted, 1);
});

test("retention follows a shortlist saved after the UI is restored in another browser run", () => {
  const events = [
    replayEvent(0, { sessionId: "first-run", eventType: "decision", itemId: "tmdb-movie-1", decision: "keep" }),
    replayEvent(1, { sessionId: "restored-run", eventType: "saved", itemId: "tmdb-movie-1", targetEventId: "event-0", reviewId: "review" }),
  ];
  assert.equal(replayRecommendationEvents(events, new Map())[0].reviewRetention, 1);
});
