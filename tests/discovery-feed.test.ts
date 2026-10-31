import assert from "node:assert/strict";
import test from "node:test";
import { advanceFeedStreams, interleaveItems, type FeedStream } from "../src/lib/discovery-feed";
import { retryAfterTime, requestProviderJson, ProviderRequestError } from "../src/lib/providers/request";
import type { MediaItem } from "../src/data";
const item = (id: string): MediaItem => ({ id, title: id, type: "Movie", runtime: "—", rating: "—", genre: [], synopsis: "", category: "Movies", palette: ["", "", ""], art: "mist", label: id });
const stream = (source: FeedStream["source"], lane: FeedStream["lane"] = "popular"): FeedStream => ({ source, lane, page: 1, features: lane === "popular" ? [] : ["genre:drama"], done: false, retryAt: null, fingerprint: null });
test("mixes lanes deterministically and deduplicates matching IDs/titles", () => {
  assert.deepEqual(interleaveItems([[item("a"), item("b")], [item("c"), item("a")]]).map(row => row.id), ["a", "c", "b"]);
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
