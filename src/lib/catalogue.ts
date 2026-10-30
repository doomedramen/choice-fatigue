import "server-only";
import { type MediaItem } from "@/data";
import { getPopularTmdbCatalogue } from "@/lib/providers/tmdb";
import { getTmdbProviderStatus } from "@/lib/providers/tmdb-config";
import { getAdultMetadataProviderStatus } from "@/lib/providers/adult-metadata-config";
import { getPopularThePornDBCatalogue } from "@/lib/providers/theporndb";
import { getPopularStashDbCatalogue } from "@/lib/providers/stashdb";

export type FeedOutcome = "ready" | "unconfigured" | "unavailable" | "empty";
export type CategoryFeedStatus = { outcome: FeedOutcome; enabledSources: number; successfulSources: number; hasTitles: boolean };
type FeedSource = { name: string; categories: Array<"Movies" | "Shows" | "Adult">; enabled: boolean; load: () => Promise<MediaItem[]> };

function deduplicateTitles(items: MediaItem[]) {
  const ids = new Set<string>();
  const titles = new Set<string>();
  return items.filter(item => {
    const normalizedTitle = item.title.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    const titleKey = `${item.category}:${normalizedTitle}:${item.year ?? "unknown-year"}`;
    if (ids.has(item.id) || titles.has(titleKey)) return false;
    ids.add(item.id);
    titles.add(titleKey);
    return true;
  });
}

export async function getDiscoveryCatalogue(includeAdult = false) {
  const [tmdbStatus, thePornDbStatus, stashDbStatus] = await Promise.all([
    getTmdbProviderStatus(),
    includeAdult ? getAdultMetadataProviderStatus("theporndb") : null,
    includeAdult ? getAdultMetadataProviderStatus("stashdb") : null,
  ]);
  const sources: FeedSource[] = [
    { name: "tmdb", categories: ["Movies", "Shows"], enabled: tmdbStatus.enabled, load: getPopularTmdbCatalogue },
    ...(includeAdult ? [{ name: "theporndb", categories: ["Adult"] as Array<"Adult">, enabled: thePornDbStatus?.enabled === true, load: getPopularThePornDBCatalogue }] : []),
    ...(includeAdult ? [{ name: "stashdb", categories: ["Adult"] as Array<"Adult">, enabled: stashDbStatus?.enabled === true, load: getPopularStashDbCatalogue }] : []),
  ];
  const enabledSources = sources.filter(source => source.enabled);
  const results = await Promise.allSettled(enabledSources.map(source => source.load()));
  const sourceResults = enabledSources.map((source, index) => ({ source, result: results[index] }));
  const items = results.flatMap(result => result.status === "fulfilled" ? result.value : [])
    .filter(item => includeAdult || item.category !== "Adult");
  const categoryOutcomes = Object.fromEntries(((["Movies", "Shows", "Adult"] as const).map(category => {
    const eligible = sourceResults.filter(({ source }) => source.categories.includes(category));
    const successful = eligible.filter(({ result }) => result.status === "fulfilled");
    const hasTitles = items.some(item => item.category === category);
    const outcome: FeedOutcome = !eligible.length ? "unconfigured" : !successful.length ? "unavailable" : hasTitles ? "ready" : "empty";
    return [category, { outcome, enabledSources: eligible.length, successfulSources: successful.length, hasTitles } satisfies CategoryFeedStatus];
  }))) as Record<"Movies" | "Shows" | "Adult", CategoryFeedStatus>;
  const providerFailed = results.some(result => result.status === "rejected");
  return {
    items: deduplicateTitles(items),
    notice: providerFailed ? "A metadata source is temporarily unavailable. Available titles are still shown." : "",
    categoryOutcomes,
  };
}
