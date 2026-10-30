import assert from "node:assert/strict";
import test from "node:test";
import { compareSessionRankings, summarizeMetadataCoverage } from "../src/lib/recommendation-evaluation";

test("compares provider and ranker order against the same saved and shortlisted labels", () => {
  const result = compareSessionRankings([
    { providerOrder: ["a", "b", "c"], rankerOrder: ["c", "b", "a"], shortlisted: ["c"], saved: ["c"] },
    { providerOrder: ["a", "b"], rankerOrder: ["b", "a"], shortlisted: ["b"], saved: [] },
  ]);

  assert.equal(result.providerOrder.saved.meanReciprocalRank, 0.3333);
  assert.equal(result.currentRanker.saved.meanReciprocalRank, 1);
  assert.equal(result.providerOrder.shortlisted.recallAt5, 1);
  assert.equal(result.currentRanker.shortlisted.recallAt5, 1);
  assert.equal(result.providerOrder.saved.labeledSessions, 1);
});

test("reports missing relevant titles as zero coverage instead of inventing a score", () => {
  const result = compareSessionRankings([
    { providerOrder: ["a"], rankerOrder: ["a"], shortlisted: ["missing"], saved: [] },
  ]);
  assert.equal(result.currentRanker.shortlisted.labeledSessions, 0);
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
