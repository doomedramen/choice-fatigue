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

/**
 * IDs always deduplicate. A matching title and known year only merges listings from different
 * providers (the same scene on ThePornDB and StashDB); one provider's distinct IDs are distinct
 * titles, such as a same-year remake, and an unknown year is never evidence of a match.
 */
export function deduplicateTitles(items: MediaItem[]) {
  const ids = new Set<string>(), titleProviders = new Map<string, string>();
  return items.filter(item => {
    if (ids.has(item.id)) return false;
    const provider = item.id.split("-")[0];
    const key = item.year == null ? null : `${item.category}:${item.title.trim().toLowerCase().replace(/\s+/g, " ")}:${item.year}`;
    if (key && titleProviders.has(key) && titleProviders.get(key) !== provider) return false;
    ids.add(item.id);
    if (key && !titleProviders.has(key)) titleProviders.set(key, provider);
    return true;
  });
}

/** Milliseconds until the earliest failed source may be retried, or null when none is waiting. */
export function feedRetryDelay(sources: FeedSourceStatus[], now = Date.now()): number | null {
  const waiting = sources.filter(source => source.outcome === "unavailable" && source.retryAt !== null).map(source => source.retryAt! - now);
  return waiting.length ? Math.max(0, Math.min(...waiting)) : null;
}

const sourceNames: Record<RecommendationSource, string> = { tmdb: "TMDB", theporndb: "ThePornDB", stashdb: "StashDB" };
const laneNames: Record<RecommendationLane, string> = { popular: "", personalized: "personalised picks", related: "related shows", person: "people picks", company: "studio picks" };

/** Readable names for the sources that failed, e.g. "TMDB related shows". */
export function failedSourceNames(sources: FeedSourceStatus[]): string[] {
  return [...new Set(sources.filter(source => source.outcome === "unavailable").map(source => [sourceNames[source.source], laneNames[source.lane]].filter(Boolean).join(" ")))];
}

function listNames(names: string[]) {
  return names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The blocking message when a category has nothing to show because sources failed. */
export function feedFailureMessage(sources: FeedSourceStatus[]): string {
  const names = failedSourceNames(sources);
  return names.length ? `${listNames(names)} could not load.` : "A metadata source could not load.";
}

/**
 * One non-blocking line for a deck that still has titles while a source is down or the latest page
 * failed. A countdown would go stale between renders, so the retry is described, not timed.
 */
export function degradedFeedNotice(sources: FeedSourceStatus[], pageFailed = false): string {
  const names = failedSourceNames(sources);
  if (!pageFailed && !names.length) return "";
  const subject = names.length ? `${listNames(names)} ${names.length === 1 ? "is" : "are"}` : "A metadata source is";
  return `${subject} temporarily unavailable. Showing the titles that loaded; more will be retried automatically.`;
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
      const repeated = ids.length > 0 && stream.fingerprint === hash;
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
  // A selective refresh that only keeps existing lanes loaded nothing new, but those lanes are still healthy.
  const keptSources = active.length ? 0 : next.filter((stream, index) => !stream.done && !shouldLoad(streams[index])).length;
  const successfulSources = active.filter(result => !result.failed).length + keptSources;
  const outcome: FeedOutcome = !streams.length ? "unconfigured" : items.length || keptSources ? "ready" : active.some(result => result.failed) ? "unavailable" : "empty";
  return {
    items, streams: next, sources,
    batches: active.filter(result => result.ids.length).map(({ stream, ids, fetchedPage, positions }) => ({ source: stream.source, lane: stream.lane, candidateIds: ids, ...(stream.lane === "related" ? { provenance: { seedItemId: stream.seedItemId!, seedEventId: stream.seedEventId!, endpoint: "recommendations" as const, page: fetchedPage, positions: ids.map((id, index) => positions?.[id] ?? index + 1) } } : {}) })),
    status: { outcome, enabledSources: streams.length, successfulSources, hasTitles: items.length > 0 } satisfies CategoryFeedStatus,
  };
}
