import assert from "node:assert/strict";
import test from "node:test";
import { compareRankings, replayMetadataPlan, summarizeMetadataCoverage } from "../src/lib/recommendation-evaluation";

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

test("reports a seeded random floor, kept-over-passed accuracy, and session-level intervals", () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    providerOrder: Array.from({ length: 10 }, (_, rank) => `t${index}-${rank}`),
    rankerOrder: [`t${index}-9`, ...Array.from({ length: 9 }, (_, rank) => `t${index}-${rank}`)],
    shortlisted: [`t${index}-9`], saved: [], passed: [`t${index}-0`], sessionId: `s${index % 8}`,
  }));
  const first = compareRankings(rows, 7);
  assert.deepEqual(compareRankings(rows, 7), first, "the same seed reproduces every number");
  assert.equal(first.currentRanker.shortlisted.meanReciprocalRank, 1);
  assert.equal(first.providerOrder.shortlisted.meanReciprocalRank, 0.1);
  const random = first.randomOrder.shortlisted.meanReciprocalRank!;
  assert.ok(random > 0.1 && random < 0.6, `a uniform shuffle lands near the expected 0.29, got ${random}`);
  assert.equal(first.keptOverPassedAccuracy.currentRanker, 1);
  assert.equal(first.keptOverPassedAccuracy.providerOrder, 0);
  assert.deepEqual(first.shortlistedMeanReciprocalRank95.currentRanker, [1, 1]);
  const [low, high] = first.shortlistedMeanReciprocalRank95.randomOrder!;
  assert.ok(low <= random && random <= high);
  assert.equal(compareRankings(rows.slice(0, 1)).shortlistedMeanReciprocalRank95.currentRanker, null, "one session is too few to resample");
  assert.ok(first.exposureWeightedShortlistRecallAt10.currentRanker! >= first.exposureWeightedShortlistRecallAt10.providerOrder!);
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

test("replay checks related seeds against choices already made, never future ratings", () => {
  const events = [
    replayEvent(0, { category: "Shows", eventType: "candidate_batch", candidateIds: ["tmdb-tv-2"], retrievalId: "related", source: "tmdb", lane: "related", algorithmVersion: "content-v5", provenance: { seedItemId: "tmdb-tv-1", seedEventId: "event-1", endpoint: "recommendations", page: 1, positions: [1] } }),
    replayEvent(1, { category: "Shows", eventType: "decision", itemId: "tmdb-tv-1", decision: "seen", rating: 9, algorithmVersion: "content-v5" }),
  ];
  const report = replayRecommendationEvents(events, new Map())[1];
  assert.equal(report.relatedSeedBatches, 1);
  assert.equal(report.matchingRelatedSeedBatches, 0);
});

test("v6 replay uses retained order and recorded hydration outcomes", () => {
  const metadata = new Map([replayItem("tmdb-movie-1", "Drama"), replayItem("tmdb-movie-2", "Drama")].map(item => [item.id, item]));
  const events = [
    replayEvent(0, { eventType: "candidate_batch", candidateIds: ["tmdb-movie-1", "tmdb-movie-2"], retrievalId: "first", source: "tmdb", lane: "popular", algorithmVersion: "content-v6" }),
    replayEvent(1, { eventType: "retrieval_snapshot", candidateIds: ["tmdb-movie-2", "tmdb-movie-1"], retrievalId: "first", algorithmVersion: "content-v6", provenance: { candidateRequestedIds: ["tmdb-movie-1", "tmdb-movie-2"], candidateResolvedIds: ["tmdb-movie-2"], historicalRequestedIds: [], historicalResolvedIds: [] } }),
    replayEvent(2, { itemId: "tmdb-movie-2", candidateIds: ["tmdb-movie-2", "tmdb-movie-1"], algorithmVersion: "content-v6" }),
    replayEvent(3, { eventType: "decision", itemId: "tmdb-movie-2", decision: "keep", algorithmVersion: "content-v6" }),
  ];
  const report = replayRecommendationEvents(events, metadata)[0];
  assert.equal(report.matchedCandidateMixRanking.providerOrder.shortlisted.meanReciprocalRank, 1);
  assert.equal(report.recordedCreditCoverage.requested, 2);
  assert.equal(report.recordedCreditCoverage.resolved, 1);
  assert.deepEqual(report.snapshotCoverage, { snapshots: 1, incompleteImpressions: 0 });
  const missing = replayRecommendationEvents(events.filter(event => event.eventType !== "retrieval_snapshot"), metadata)[0];
  assert.equal(missing.snapshotCoverage.incompleteImpressions, 1);
});

test("exposure weighting uses the logged shown order, and the shown card is scored pointwise", () => {
  const row = (index: number, shownCard: { itemId: string; outcome: "keep" | "pass" }) => ({
    providerOrder: ["a", "b", "c"], rankerOrder: shownCard.outcome === "keep" ? [shownCard.itemId, ...["a", "b", "c"].filter(id => id !== shownCard.itemId)] : [...["a", "b", "c"].filter(id => id !== shownCard.itemId), shownCard.itemId],
    shortlisted: shownCard.outcome === "keep" ? [shownCard.itemId] : [], saved: [], sessionId: `s${index}`,
    shownOrder: ["c", "b", "a"], shownCard,
  });
  const rows = [row(0, { itemId: "c", outcome: "keep" }), row(1, { itemId: "a", outcome: "pass" }), row(2, { itemId: "b", outcome: "keep" }), row(3, { itemId: "c", outcome: "pass" })];
  const result = compareRankings(rows, 3);
  assert.equal(result.shownCardAuc.currentRanker, 1, "kept cards ranked first, passed cards last");
  assert.equal(result.shownCardAuc.providerOrder, 0.375, "kept c,b sit at 0 and 0.5; passed a,c at 1 and 0: 1.5 of 4 pairs");
  const weighted = compareRankings([{ providerOrder: ["a", "b"], rankerOrder: ["a", "b"], shortlisted: ["a"], saved: [], shownOrder: ["b", "a"] }]);
  assert.equal(weighted.exposureWeightedShortlistRecallAt10.currentRanker, 1);
});

test("ranker-versus-baseline differences are paired per trace and bootstrapped by session", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ providerOrder: ["x", "y", "z"], rankerOrder: ["z", "x", "y"], shortlisted: ["z"], saved: [], sessionId: `s${index % 4}` }));
  const difference = compareRankings(rows, 5).shortlistedReciprocalRankDifference95.currentRankerMinusProvider!;
  assert.equal(difference.mean, round(1 - 1 / 3));
  assert.deepEqual(difference.interval, [difference.mean, difference.mean], "the same gain in every trace leaves no uncertainty");
  assert.equal(compareRankings(rows.slice(0, 1)).shortlistedReciprocalRankDifference95.currentRankerMinusProvider, null);
});
function round(value: number) { return Number(value.toFixed(4)); }

test("the replay lookup budget covers whole sessions instead of the earliest IDs", () => {
  const session = (sessionId: string, base: number) => [
    replayEvent(base, { sessionId, eventType: "item_shown", itemId: `tmdb-movie-${base}`, candidateIds: [`tmdb-movie-${base}`, `tmdb-movie-${base + 1}`, `tmdb-movie-${base + 2}`] }),
    replayEvent(base + 1, { sessionId, eventType: "decision", itemId: `tmdb-movie-${base}`, decision: "keep" }),
  ];
  const events = [...session("a", 100), ...session("b", 200), ...session("c", 300)];
  const plan = replayMetadataPlan(events, () => true, 6, 9);
  assert.equal(plan.sessionsWithLabels, 3);
  assert.equal(plan.sessionsCovered, 2, "two whole sessions fit in six lookups");
  const coveredSessions = new Set(plan.ids.map(id => Math.floor(Number(id.split("-").at(-1)) / 100)));
  assert.equal(coveredSessions.size, 2);
  assert.deepEqual(replayMetadataPlan(events, () => true, 6, 9), plan, "the same seed picks the same sessions");
  assert.equal(replayMetadataPlan(events, id => !id.endsWith("-101"), 100).ids.includes("tmdb-movie-101"), false, "ineligible IDs are never requested");
});
