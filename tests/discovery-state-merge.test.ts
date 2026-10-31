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

test("a title unsaved on one device stays unsaved when another device saves something else", () => {
  const base: MergeableDiscoveryState = { ...empty(), saved: ["tmdb-movie-1", "tmdb-movie-2"] };
  const local: MergeableDiscoveryState = { ...base, saved: ["tmdb-movie-2"] };
  const remote: MergeableDiscoveryState = { ...base, saved: ["tmdb-movie-1", "tmdb-movie-2", "tmdb-movie-3"] };
  assert.deepEqual(new Set(mergeDiscoveryState(base, local, remote).saved), new Set(["tmdb-movie-2", "tmdb-movie-3"]));
});

test("diverging decisions and shortlists keep each side's own changes; the local edit wins a same-title conflict", () => {
  const base: MergeableDiscoveryState = { ...empty(), shortlisted: ["a"], decisions: { a: "keep" } };
  const local: MergeableDiscoveryState = { ...base, shortlisted: [], decisions: { a: "pass", b: "keep" } };
  const remote: MergeableDiscoveryState = { ...base, shortlisted: ["a", "c"], decisions: { a: "seen", c: "keep" } };
  const merged = mergeDiscoveryState(base, local, remote);
  assert.deepEqual(merged.decisions, { a: "pass", b: "keep", c: "keep" });
  assert.deepEqual(merged.shortlisted, ["c"]);
});

test("concurrent history appends from two tabs both survive, and a shared entry is not duplicated", () => {
  const shared = { id: "a", eventId: "e1", decision: "keep" };
  const base: MergeableDiscoveryState = { ...empty(), history: [shared] };
  const local: MergeableDiscoveryState = { ...base, history: [shared, { id: "b", eventId: "e2", decision: "pass" }] };
  const remote: MergeableDiscoveryState = { ...base, history: [shared, { id: "c", eventId: "e3", decision: "keep" }] };
  assert.deepEqual(mergeDiscoveryState(base, local, remote).history.map(entry => entry.eventId), ["e1", "e3", "e2"]);
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

test("merged lists stay consistent: saved beats shortlisted, removed is not shortlisted, shortlisted means keep", () => {
  const base = empty();
  const local: MergeableDiscoveryState = { ...base, saved: ["a"], shortlisted: ["b"], decisions: { b: "keep" } };
  const remote: MergeableDiscoveryState = { ...base, shortlisted: ["a", "c"], reviewRemoved: ["b"], decisions: { a: "keep", c: "pass" } };
  const merged = mergeDiscoveryState(base, local, remote);
  assert.deepEqual(merged.saved, ["a"]);
  assert.deepEqual(merged.shortlisted, ["c"]);
  assert.deepEqual(merged.reviewRemoved, ["b"]);
  assert.equal(merged.decisions.c, "keep");
});
