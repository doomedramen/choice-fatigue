import "server-only";
import { createHash } from "node:crypto";
import { getTmdbCataloguePage } from "@/lib/providers/tmdb";
import { getTmdbProviderStatus } from "@/lib/providers/tmdb-config";
import { getAdultMetadataProviderStatus } from "@/lib/providers/adult-metadata-config";
import { getThePornDBCataloguePage } from "@/lib/providers/theporndb";
import { getStashDbCataloguePage } from "@/lib/providers/stashdb";
import { loadRecommendationProfile } from "@/lib/recommendation-profile";
import { advanceFeedStreams, type DiscoveryFeed, type FeedCursor, type FeedStream } from "@/lib/discovery-feed";
import type { RecommendationCategory } from "@/lib/recommendation-event-validation";
export type { CategoryFeedStatus } from "@/lib/discovery-feed";

export class InvalidFeedCursorError extends Error {}
function decodeCursor(value: string, category: RecommendationCategory): FeedCursor {
  try {
    if (value.length > 8192) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as FeedCursor;
    if (cursor.category !== category || !Array.isArray(cursor.streams) || cursor.streams.length > 4) throw new Error();
    const keys = new Set<string>();
    for (const stream of cursor.streams) {
      if (!stream || !["tmdb", "theporndb", "stashdb"].includes(stream.source) || !["popular", "personalized"].includes(stream.lane)) throw new Error();
      if ((category === "Adult") === (stream.source === "tmdb")) throw new Error();
      if (stream.source === "theporndb" ? !["scene", "movie"].includes(stream.kind ?? "") || stream.lane !== "popular" : stream.kind !== undefined) throw new Error();
      if (!Number.isSafeInteger(stream.page) || stream.page < 1 || stream.page > 501 || typeof stream.done !== "boolean") throw new Error();
      if (!Array.isArray(stream.features) || stream.features.length > 2 || !stream.features.every(feature => typeof feature === "string" && feature.length <= 200 && (stream.source === "stashdb" ? /^[A-Za-z0-9_-]+$/.test(feature) : /^genre:.+/.test(feature)))) throw new Error();
      if (stream.lane === "popular" && stream.features.length || stream.lane === "personalized" && !stream.features.length) throw new Error();
      if (!(stream.retryAt === null || typeof stream.retryAt === "number" && Number.isFinite(stream.retryAt))) throw new Error();
      if (!(stream.fingerprint === null || typeof stream.fingerprint === "string" && /^[a-f0-9]{64}$/.test(stream.fingerprint))) throw new Error();
      const key = `${stream.source}:${stream.kind ?? ""}:${stream.lane}`;
      if (keys.has(key)) throw new Error();
      keys.add(key);
    }
    return cursor;
  } catch { throw new InvalidFeedCursorError(); }
}

/** Authorization is enforced by the page/API before Adult retrieval is requested. */
export async function getDiscoveryFeed(userId: string, category: RecommendationCategory, cursorValue: string | null = null, refresh = false): Promise<DiscoveryFeed> {
  const enabled = new Set<string>();
  if (category === "Adult") {
    const statuses = await Promise.all([getAdultMetadataProviderStatus("theporndb"), getAdultMetadataProviderStatus("stashdb")]);
    if (statuses[0].enabled) enabled.add("theporndb");
    if (statuses[1].enabled) enabled.add("stashdb");
  } else if ((await getTmdbProviderStatus()).enabled) enabled.add("tmdb");
  const streams = cursorValue ? decodeCursor(cursorValue, category).streams.filter(stream => enabled.has(stream.source)) : [];
  if (!cursorValue || refresh) {
    const profile = enabled.size ? await loadRecommendationProfile(userId, category) : null;
    if (refresh) {
      // A review refresh resets only personalized lanes, preserving popular pagination.
      for (let index = streams.length - 1; index >= 0; index--) if (streams[index].lane === "personalized") streams.splice(index, 1);
    }
    const add = (source: FeedStream["source"], lane: FeedStream["lane"], features: string[] = [], kind?: FeedStream["kind"]) => {
      streams.push({ source, lane, ...(kind ? { kind } : {}), features, page: 1, done: false, retryAt: null, fingerprint: null });
    };
    if (!cursorValue) {
      if (enabled.has("tmdb")) add("tmdb", "popular");
      if (enabled.has("theporndb")) { add("theporndb", "popular", [], "scene"); add("theporndb", "popular", [], "movie"); }
      if (enabled.has("stashdb")) add("stashdb", "popular");
    }
    if (profile?.retrievalFeatures.length && enabled.has("tmdb")) add("tmdb", "personalized", profile.retrievalFeatures);
    if (profile?.stashTagIds.length && enabled.has("stashdb")) add("stashdb", "personalized", profile.stashTagIds);
  }
  const result = await advanceFeedStreams(streams, stream => {
    if (stream.source === "tmdb") return getTmdbCataloguePage(category as "Movies" | "Shows", stream.page, stream.features);
    if (stream.source === "theporndb") return getThePornDBCataloguePage(stream.kind!, stream.page);
    return getStashDbCataloguePage(stream.page, stream.features);
  }, ids => createHash("sha256").update(ids.join("\n")).digest("hex"));
  return {
    items: result.items, batches: result.batches, sources: result.sources, status: result.status,
    hasMore: result.streams.some(stream => !stream.done),
    cursor: result.streams.length ? Buffer.from(JSON.stringify({ category, streams: result.streams })).toString("base64url") : null,
  };
}

export async function getDiscoveryCatalogue(userId: string, includeAdult = false) {
  const categories = includeAdult ? ["Movies", "Shows", "Adult"] as const : ["Movies", "Shows"] as const;
  const results = await Promise.all(categories.map(category => getDiscoveryFeed(userId, category)));
  const empty: DiscoveryFeed = { items: [], batches: [], cursor: null, hasMore: false, sources: [], status: { outcome: "unconfigured", enabledSources: 0, successfulSources: 0, hasTitles: false } };
  const feeds = { Movies: empty, Shows: empty, Adult: empty };
  categories.forEach((category, index) => { feeds[category] = results[index]; });
  return { feeds, items: results.flatMap(result => result.items) };
}
