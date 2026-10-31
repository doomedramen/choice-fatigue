import type { MediaItem } from "@/data";
import type { RecommendationCategory, RecommendationLane, RecommendationSource } from "@/lib/recommendation-event-validation";
import type { RetrievalSnapshot } from "@/lib/recommendation-event-validation";

export type FeedOutcome = "ready" | "unconfigured" | "unavailable" | "empty";
export type CategoryFeedStatus = { outcome: FeedOutcome; enabledSources: number; successfulSources: number; hasTitles: boolean };
export type FeedStream = {
  source: RecommendationSource; lane: RecommendationLane; kind?: "scene" | "movie";
  seedItemId?: string; seedEventId?: string; page: number; features: string[]; done: boolean; retryAt: number | null; fingerprint: string | null;
};
export type CandidateBatch = { source: RecommendationSource; lane: RecommendationLane; candidateIds: string[]; provenance?: { seedItemId: string; seedEventId: string; endpoint: "recommendations"; page: number; positions: number[] } | null };
export type FeedSourceStatus = { source: RecommendationSource; lane: RecommendationLane; kind?: "scene" | "movie"; outcome: "ready" | "empty" | "unavailable"; retryAt: number | null };
export type DiscoveryFeed = { items: MediaItem[]; batches: CandidateBatch[]; cursor: string | null; hasMore: boolean; status: CategoryFeedStatus; sources: FeedSourceStatus[]; candidateFeatures?: Record<string, string[]>; creditCoverage?: { requested: number; resolved: number }; snapshot?: RetrievalSnapshot };
export type FeedCursor = { category: RecommendationCategory; streams: FeedStream[] };

/** Keep pagination and retry state only while a lane still represents the same query. */
export function reconcileFeedStreams(existing: FeedStream[], desired: FeedStream[]): FeedStream[] {
  const identity = (stream: FeedStream) => JSON.stringify([stream.source, stream.kind ?? null, stream.lane, stream.seedItemId ?? null, stream.seedEventId ?? null, stream.features]);
  const previous = new Map(existing.map(stream => [identity(stream), stream]));
  return desired.map(stream => previous.get(identity(stream)) ?? stream);
}

export function interleaveItems(groups: MediaItem[][]): MediaItem[] {
  const items: MediaItem[] = [];
  for (let index = 0; index < Math.max(0, ...groups.map(group => group.length)); index++) {
    for (const group of groups) if (group[index]) items.push(group[index]);
  }
  return deduplicateTitles(items);
}

export function deduplicateTitles(items: MediaItem[]) {
  const ids = new Set<string>(), titles = new Set<string>();
  return items.filter(item => {
    const key = `${item.category}:${item.title.trim().toLowerCase().replace(/\s+/g, " ")}:${item.year ?? "unknown-year"}`;
    if (ids.has(item.id) || titles.has(key)) return false;
    ids.add(item.id); titles.add(key); return true;
  });
}

/** Independent source failures must not discard successful pages or advance failed cursors. */
export async function advanceFeedStreams(
  streams: FeedStream[],
  load: (stream: FeedStream) => Promise<{ items: MediaItem[]; hasMore: boolean; positions?: Record<string, number> }>,
  fingerprint: (ids: string[]) => string,
  now = Date.now(),
  shouldLoad: (stream: FeedStream) => boolean = () => true,
) {
  const next = streams.map(stream => ({ ...stream }));
  const results = await Promise.all(next.map(async (stream, index) => {
    if (stream.done || !shouldLoad(streams[index])) return null;
    try {
      if (stream.retryAt && stream.retryAt > now) throw { retryAt: stream.retryAt };
      const result = await load(stream);
      const ids = [...new Set(result.items.map(item => item.id))].slice(0, 100);
      const hash = fingerprint(ids);
      const repeated = stream.fingerprint === hash;
      stream.fingerprint = hash;
      stream.done = repeated || !result.hasMore || stream.page >= 500;
      const fetchedPage = stream.page;
      stream.page += 1;
      stream.retryAt = null;
      return { stream, items: repeated ? [] : result.items, ids: repeated ? [] : ids, failed: false, fetchedPage, positions: result.positions };
    } catch (error) {
      const retryAt = error && typeof error === "object" && "retryAt" in error ? Number(error.retryAt) : 0;
      stream.retryAt = Number.isFinite(retryAt) && retryAt > now ? retryAt : now + 15_000;
      return { stream, items: [], ids: [], failed: true, fetchedPage: stream.page, positions: undefined };
    }
  }));
  const active = results.filter(result => result !== null);
  const items = interleaveItems(active.map(result => result.items));
  const sources: FeedSourceStatus[] = active.map(({ stream, items, failed }) => ({
    source: stream.source, lane: stream.lane, ...(stream.kind ? { kind: stream.kind } : {}),
    outcome: failed ? "unavailable" : items.length ? "ready" : "empty", retryAt: stream.retryAt,
  }));
  const successfulSources = active.filter(result => !result.failed).length;
  const outcome: FeedOutcome = !streams.length ? "unconfigured" : items.length ? "ready" : active.some(result => result.failed) ? "unavailable" : "empty";
  return {
    items, streams: next, sources,
    batches: active.filter(result => result.ids.length).map(({ stream, ids, fetchedPage, positions }) => ({ source: stream.source, lane: stream.lane, candidateIds: ids, ...(stream.lane === "related" ? { provenance: { seedItemId: stream.seedItemId!, seedEventId: stream.seedEventId!, endpoint: "recommendations" as const, page: fetchedPage, positions: ids.map((id, index) => positions?.[id] ?? index + 1) } } : {}) })),
    status: { outcome, enabledSources: streams.length, successfulSources, hasTitles: items.length > 0 } satisfies CategoryFeedStatus,
  };
}
