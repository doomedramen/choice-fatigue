import "server-only";
import { createHash } from "node:crypto";
import { getTmdbCataloguePage, getTmdbRelatedShows, getTmdbCreditCataloguePage, getTmdbCreditFeatures } from "@/lib/providers/tmdb";
import { getTmdbProviderStatus } from "@/lib/providers/tmdb-config";
import { getAdultMetadataProviderStatus } from "@/lib/providers/adult-metadata-config";
import { getThePornDBCataloguePage } from "@/lib/providers/theporndb";
import { getStashDbCataloguePage } from "@/lib/providers/stashdb";
import { relatedShowSeeds, buildRecommendationProfile } from "@/lib/recommendations";
import { parseProviderTitleId } from "@/lib/media-provider-id";
import { loadRecommendationProfile } from "@/lib/recommendation-profile";
import { advanceFeedStreams, reconcileFeedStreams, type DiscoveryFeed, type FeedCursor, type FeedStream } from "@/lib/discovery-feed";
import type { RecommendationCategory } from "@/lib/recommendation-event-validation";
import { encodeFeedCursor, feedCursorSecret, InvalidFeedCursorError, readFeedCursor } from "@/lib/feed-cursor";
export type { CategoryFeedStatus } from "@/lib/discovery-feed";

export { InvalidFeedCursorError };
function decodeCursor(value: unknown, category: RecommendationCategory): FeedCursor {
  try {
    const cursor = value as FeedCursor;
    if (!cursor || typeof cursor !== "object") throw new Error();
    if (cursor.category !== category || !Array.isArray(cursor.streams) || cursor.streams.length > 6) throw new Error();
    const keys = new Set<string>();
    for (const stream of cursor.streams) {
      if (!stream || !["tmdb", "theporndb", "stashdb"].includes(stream.source) || !["popular", "personalized", "related", "person", "company"].includes(stream.lane)) throw new Error();
      if ((category === "Adult") === (stream.source === "tmdb")) throw new Error();
      if (stream.source === "theporndb" ? !["scene", "movie"].includes(stream.kind ?? "") || stream.lane !== "popular" : stream.kind !== undefined) throw new Error();
      if (!Number.isSafeInteger(stream.page) || stream.page < 1 || stream.page > 501 || typeof stream.done !== "boolean") throw new Error();
      if (!Array.isArray(stream.features) || stream.features.length > 2 || !stream.features.every(feature => typeof feature === "string" && feature.length <= 200 && (stream.source === "stashdb" ? /^[A-Za-z0-9_-]+$/.test(feature) : /^(genre:.+|(actor|director|writer|creator|company):[1-9]\d*)$/.test(feature)))) throw new Error();
      if (stream.lane === "related") {
        if (category !== "Shows" || stream.source !== "tmdb" || !/^tmdb-tv-[1-9]\d*$/.test(stream.seedItemId ?? "") || !stream.seedEventId || stream.seedEventId.length > 200 || stream.features.length) throw new Error();
      } else if (stream.seedItemId !== undefined || stream.seedEventId !== undefined) throw new Error();
      if (["person", "company"].includes(stream.lane) && (stream.source !== "tmdb" || stream.features.length !== 1 || !(stream.lane === "company" ? /^company:/ : /^(actor|director|writer|creator):/).test(stream.features[0]))) throw new Error();
      if (stream.lane === "popular" && stream.features.length || ["personalized", "person", "company"].includes(stream.lane) && !stream.features.length) throw new Error();
      if (!(stream.retryAt === null || typeof stream.retryAt === "number" && Number.isFinite(stream.retryAt))) throw new Error();
      if (!(stream.fingerprint === null || typeof stream.fingerprint === "string" && /^[a-f0-9]{64}$/.test(stream.fingerprint))) throw new Error();
      const key = `${stream.source}:${stream.kind ?? ""}:${stream.lane}:${stream.seedItemId ?? ""}`;
      if (keys.has(key)) throw new Error();
      keys.add(key);
    }
    return cursor;
  } catch { throw new InvalidFeedCursorError(); }
}

/** Authorization is enforced by the page/API before Adult retrieval is requested. */
export async function getDiscoveryFeed(userId: string, category: RecommendationCategory, cursorParam: string | null = null, refresh = false, pendingExcludedIds: string[] = [], knownFeatureIds: string[] = []): Promise<DiscoveryFeed> {
  const secret = feedCursorSecret();
  // A cursor issued before signing reads as null and restarts the feed instead of being trusted.
  const cursorValue = cursorParam ? readFeedCursor(cursorParam, userId, secret) : null;
  const enabled = new Set<string>();
  if (category === "Adult") {
    const statuses = await Promise.all([getAdultMetadataProviderStatus("theporndb"), getAdultMetadataProviderStatus("stashdb")]);
    if (statuses[0].enabled) enabled.add("theporndb");
    if (statuses[1].enabled) enabled.add("stashdb");
  } else if ((await getTmdbProviderStatus()).enabled) enabled.add("tmdb");
  let streams = cursorValue ? decodeCursor(cursorValue, category).streams.filter(stream => enabled.has(stream.source)) : [];
  const previousStreams = streams;
  const profile = enabled.size ? await loadRecommendationProfile(userId, category, [], !cursorValue || refresh) : null;
  if (!cursorValue || refresh) {
    const previous = streams;
    streams = refresh ? previous.filter(stream => stream.lane === "popular") : [];
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
    if (profile && enabled.has("tmdb")) {
      if (category === "Shows") for (const seed of relatedShowSeeds(profile.events)) streams.push({ source: "tmdb", lane: "related", seedItemId: seed.itemId, seedEventId: seed.eventId, features: [], page: 1, done: false, retryAt: null, fingerprint: null });
      const person = profile.creditFeatures.find(feature => !feature.key.startsWith("company:"));
      const company = profile.creditFeatures.find(feature => feature.key.startsWith("company:"));
      if (person) add("tmdb", "person", [person.key]);
      if (company) add("tmdb", "company", [company.key]);
    }
    if (refresh) streams = reconcileFeedStreams(previous, streams);
  }
  const result = await advanceFeedStreams(streams, stream => {
    if (stream.source === "tmdb") {
      if (stream.lane === "related") return getTmdbRelatedShows(Number(stream.seedItemId!.split("-").at(-1)), stream.page);
      if (stream.lane === "person" || stream.lane === "company") { const [role, id] = stream.features[0].split(":"); return getTmdbCreditCataloguePage(category as "Movies" | "Shows", role, Number(id), stream.page); }
      return getTmdbCataloguePage(category as "Movies" | "Shows", stream.page, stream.features);
    }
    if (stream.source === "theporndb") return getThePornDBCataloguePage(stream.kind!, stream.page);
    return getStashDbCataloguePage(stream.page, stream.features);
  }, ids => createHash("sha256").update(ids.join("\n")).digest("hex"), Date.now(), stream => !refresh || !previousStreams.includes(stream));
  const candidateFeatures: Record<string, string[]> = {};
  const considered = new Set(profile ? buildRecommendationProfile(profile.events, profile.featuresByItemId, category).consideredIds : []);
  for (const id of pendingExcludedIds) if (parseProviderTitleId(id)?.category === category) considered.add(id);
  // Ten credit lookups per page, spent on titles this tab has not already resolved or tried.
  const known = new Set(knownFeatureIds);
  const candidates = category === "Adult" ? [] : result.items.filter(item => !considered.has(item.id) && !known.has(item.id)).slice(0, 10);
  await Promise.all(candidates.map(async item => {
    const reference = parseProviderTitleId(item.id);
    if (!reference || reference.provider !== "tmdb") return;
    try { candidateFeatures[item.id] = await getTmdbCreditFeatures(reference.mediaType, reference.sourceId); } catch { /* Missing credits are neutral. */ }
  }));
  return {
    candidateFeatures, creditCoverage: { requested: candidates.length, resolved: Object.keys(candidateFeatures).length },
    snapshot: { candidateRequestedIds: candidates.map(item => item.id), candidateResolvedIds: Object.keys(candidateFeatures), historicalRequestedIds: profile?.requestedCreditItemIds ?? [], historicalResolvedIds: profile?.resolvedCreditItemIds ?? [] },
    items: result.items, batches: result.batches, sources: result.sources, status: result.status,
    hasMore: result.streams.some(stream => !stream.done),
    cursor: result.streams.length ? encodeFeedCursor({ category, streams: result.streams }, userId, secret) : null,
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
