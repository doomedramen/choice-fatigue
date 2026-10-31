import assert from "node:assert/strict";
import test from "node:test";
import { advanceFeedStreams, deduplicateTitles, degradedFeedNotice, feedRetryDelay, interleaveItems, reconcileFeedStreams, type FeedStream } from "../src/lib/discovery-feed";
import { retryAfterTime, requestProviderJson, ProviderRequestError } from "../src/lib/providers/request";
import type { MediaItem } from "../src/data";
const item = (id: string): MediaItem => ({ id, title: id, type: "Movie", runtime: "—", rating: "—", genre: [], synopsis: "", category: "Movies", palette: ["", "", ""], art: "mist", label: id });
const stream = (source: FeedStream["source"], lane: FeedStream["lane"] = "popular"): FeedStream => ({ source, lane, page: 1, features: lane === "popular" ? [] : ["genre:drama"], done: false, retryAt: null, fingerprint: null });
test("mixes lanes deterministically and deduplicates matching IDs/titles", () => {
  assert.deepEqual(interleaveItems([[item("a"), item("b")], [item("c"), item("a")]]).map(row => row.id), ["a", "c", "b"]);
});
test("title matching only merges cross-provider listings with a known year", () => {
  const titled = (id: string, title: string, year?: number, category: MediaItem["category"] = "Movies"): MediaItem => ({ ...item(id), title, year, category });
  assert.deepEqual(deduplicateTitles([titled("tmdb-movie-1", "Solaris", 2002), titled("tmdb-movie-2", "Solaris", 2002)]).map(row => row.id), ["tmdb-movie-1", "tmdb-movie-2"], "a provider's distinct IDs are distinct titles");
  assert.deepEqual(deduplicateTitles([titled("stashdb-a", "Scene", undefined, "Adult"), titled("theporndb-b", "Scene", undefined, "Adult")]).length, 2, "an unknown year never matches");
  assert.deepEqual(deduplicateTitles([titled("stashdb-a", "Scene", 2020, "Adult"), titled("theporndb-b", "Scene", 2020, "Adult")]).map(row => row.id), ["stashdb-a"]);
  assert.deepEqual(deduplicateTitles([titled("tmdb-movie-1", "Solaris", 2002), titled("tmdb-movie-1", "Solaris", 2002)]).length, 1);
});
test("a failed page waits only for its own cooldown, and the deck shows one notice", () => {
  const source = (outcome: "ready" | "unavailable", retryAt: number | null) => ({ source: "tmdb" as const, lane: "popular" as const, outcome, retryAt });
  assert.equal(feedRetryDelay([source("ready", null)], 1000), null);
  assert.equal(feedRetryDelay([source("unavailable", 5000), source("unavailable", 3000)], 1000), 2000);
  assert.equal(feedRetryDelay([source("unavailable", 500)], 1000), 0, "an elapsed cooldown is due now");
  assert.equal(degradedFeedNotice([source("ready", null)]), "");
  assert.match(degradedFeedNotice([source("unavailable", 5000)]), /temporarily unavailable/);
  assert.match(degradedFeedNotice([source("ready", null)], true), /temporarily unavailable/, "a failed page on a healthy-looking feed still explains itself");
});
test("a refresh that keeps every lane reports them as healthy rather than empty", async () => {
  const result = await advanceFeedStreams([stream("tmdb")], async () => ({ items: [item("x")], hasMore: true }), ids => ids.join(","), Date.now(), () => false);
  assert.equal(result.status.outcome, "ready");
  assert.equal(result.status.successfulSources, 1);
});
test("refresh preserves unchanged lanes and restarts only changed queries", () => {
  const existing = [{ ...stream("tmdb"), page: 3, retryAt: 100 }, { ...stream("tmdb", "person"), features: ["actor:1"], page: 4 }];
  const desired = [stream("tmdb"), { ...stream("tmdb", "person"), features: ["actor:2"] }];
  const result = reconcileFeedStreams(existing, desired);
  assert.equal(result[0].page, 3);
  assert.equal(result[0].retryAt, 100);
  assert.equal(result[1].page, 1);
});
test("selective refresh does not advance unchanged streams", async () => {
  const popular = { ...stream("tmdb"), page: 3 };
  const person = { ...stream("tmdb", "person"), features: ["actor:2"] };
  const result = await advanceFeedStreams([popular, person], async () => ({ items: [item("new")], hasMore: true }), ids => ids.join(","), Date.now(), lane => lane.lane === "person");
  assert.deepEqual(result.streams.map(lane => lane.page), [3, 2]);
});
test("related streams preserve duplicate origins and advance independently", async () => {
  const related: FeedStream = { ...stream("tmdb"), lane: "related", seedItemId: "tmdb-tv-1", seedEventId: "event-1", page: 2 };
  const result = await advanceFeedStreams([stream("tmdb"), related], async lane => ({ items: [item("shared")], positions: lane.lane === "related" ? { shared: 4 } : undefined, hasMore: true }), ids => ids.join(","));
  assert.deepEqual(result.items.map(row => row.id), ["shared"]);
  assert.equal(result.batches.length, 2);
  assert.deepEqual(result.batches[1].provenance, { seedItemId: "tmdb-tv-1", seedEventId: "event-1", endpoint: "recommendations", page: 2, positions: [4] });
  assert.deepEqual(result.streams.map(row => row.page), [2, 3]);
});
test("a failed source retains its page while successful sources advance", async () => {
  const result = await advanceFeedStreams([stream("tmdb"), stream("stashdb")], async source => {
    if (source.source === "tmdb") throw new Error("upstream failed");
    return { items: [item("available")], hasMore: true };
  }, ids => ids.join(","));
  assert.deepEqual(result.items.map(row => row.id), ["available"]);
  assert.deepEqual(result.streams.map(row => row.page), [1, 2]);
  assert.equal(result.status.outcome, "ready");
  assert.equal(result.sources[0].outcome, "unavailable");
});

test("empty filtered pages do not stop a stream before a later page", async () => {
  const load = async (source: FeedStream) => ({ items: source.page < 3 ? [] : [item("later")], hasMore: source.page < 3 });
  const first = await advanceFeedStreams([stream("tmdb")], load, ids => ids.join(","));
  const second = await advanceFeedStreams(first.streams, load, ids => ids.join(","));
  assert.equal(second.streams[0].done, false);
  const third = await advanceFeedStreams(second.streams, load, ids => ids.join(","));
  assert.deepEqual(third.items.map(row => row.id), ["later"]);
});
test("Adult streams paginate independently, stop repeated pages, and skip exhausted lanes", async () => {
  const first = await advanceFeedStreams([stream("theporndb"), stream("stashdb")], async source => ({ items: [item(source.source)], hasMore: true }), ids => ids.join(","));
  const second = await advanceFeedStreams(first.streams, async source => ({ items: [item(source.source)], hasMore: true }), ids => ids.join(","));
  assert.equal(second.items.length, 0);
  assert.equal(second.streams.every(source => source.done), true);
  let calls = 0;
  await advanceFeedStreams(second.streams, async () => { calls++; return { items: [], hasMore: false }; }, ids => ids.join(","));
  assert.equal(calls, 0);
});
test("Retry-After is honored before another request, including HTTP-date values", async () => {
  const now = Date.now();
  assert.equal(retryAfterTime("2", now), now + 2000);
  assert.equal(retryAfterTime(null, now), now + 30_000);
  assert.ok(retryAfterTime(new Date(now + 5000).toUTCString(), now) > now);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("", { status: 429, headers: { "Retry-After": "60" } }); };
  try {
    await assert.rejects(requestProviderJson("test-throttle", "https://example.test"), ProviderRequestError);
    await assert.rejects(requestProviderJson("test-throttle", "https://example.test"), ProviderRequestError);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
  let loads = 0;
  const source = { ...stream("tmdb"), retryAt: now + 60_000 };
  const result = await advanceFeedStreams([source], async () => { loads++; return { items: [], hasMore: false }; }, () => "", now);
  assert.equal(loads, 0);
  assert.equal(result.streams[0].page, 1);
});

test("provider calls share a four-request concurrency budget across lanes and lookups", async () => {
  const original = globalThis.fetch;
  let active = 0, peak = 0;
  globalThis.fetch = async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--; return Response.json({ ok: true });
  };
  try {
    await Promise.all(Array.from({ length: 12 }, (_, index) => requestProviderJson(`budget-${index}`, "https://example.test")));
    assert.equal(peak, 4);
  } finally { globalThis.fetch = original; }
});
