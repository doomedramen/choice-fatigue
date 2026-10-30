import assert from "node:assert/strict";
import test from "node:test";
import { mergeDiscoveryState, type MergeableDiscoveryState } from "../src/lib/discovery-state-merge";

const empty = (): MergeableDiscoveryState => ({
  sessionId: "session-1", eventSequence: 0, reviewId: null, category: "Movies", lockedItemId: null,
  decisions: {} as Record<string, unknown>, ratings: {} as Record<string, unknown>, shortlisted: [] as string[], saved: [] as string[],
  history: [] as Array<{ id: string; eventId?: string; decision?: string }>, reviewRemoved: [] as string[], view: "discover", ageVerified: false,
});

test("rebases independent tab additions without dropping either title", () => {
  const base = empty();
  const local: MergeableDiscoveryState = { ...base, shortlisted: ["tmdb-movie-1"], saved: ["tmdb-movie-2"], decisions: { "tmdb-movie-1": "keep" } };
  const remote: MergeableDiscoveryState = { ...base, shortlisted: ["tmdb-movie-3"], saved: ["tmdb-movie-4"], decisions: { "tmdb-movie-3": "keep" } };

  const merged = mergeDiscoveryState(base, local, remote);

  assert.deepEqual(new Set(merged.shortlisted), new Set(["tmdb-movie-1", "tmdb-movie-3"]));
  assert.deepEqual(new Set(merged.saved), new Set(["tmdb-movie-2", "tmdb-movie-4"]));
  assert.deepEqual(merged.decisions, { "tmdb-movie-1": "keep", "tmdb-movie-3": "keep" });
});

test("applies a local undo while preserving another tab's new action", () => {
  const base: MergeableDiscoveryState = { ...empty(), shortlisted: ["tmdb-movie-1"], decisions: { "tmdb-movie-1": "keep" }, history: [{ id: "tmdb-movie-1", eventId: "event-1", decision: "keep" }] };
  const local: MergeableDiscoveryState = { ...empty(), shortlisted: [], decisions: {}, history: [] };
  const remote: MergeableDiscoveryState = { ...base, shortlisted: ["tmdb-movie-1", "tmdb-movie-2"], decisions: { "tmdb-movie-1": "keep", "tmdb-movie-2": "keep" }, history: [...base.history, { id: "tmdb-movie-2", eventId: "event-2", decision: "keep" }] };

  const merged = mergeDiscoveryState(base, local, remote);

  assert.deepEqual(merged.shortlisted, ["tmdb-movie-2"]);
  assert.deepEqual(merged.decisions, { "tmdb-movie-2": "keep" });
  assert.deepEqual(merged.history.map(entry => entry.eventId), ["event-2"]);
});

test("preserves unchanged scalar state from the remote snapshot", () => {
  const base = empty();
  const local: MergeableDiscoveryState = { ...base, saved: ["tmdb-movie-1"] };
  const remote: MergeableDiscoveryState = { ...base, category: "Shows", ageVerified: true, eventSequence: 5 };

  const merged = mergeDiscoveryState(base, local, remote);

  assert.equal(merged.category, "Shows");
  assert.equal(merged.ageVerified, true);
  assert.equal(merged.eventSequence, 5);
  assert.deepEqual(merged.saved, ["tmdb-movie-1"]);
});
