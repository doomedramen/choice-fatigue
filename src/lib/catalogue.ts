import "server-only";
import { type MediaItem } from "@/data";
import { getPopularTmdbCatalogue } from "@/lib/providers/tmdb";
import { getTmdbProviderStatus } from "@/lib/providers/tmdb-config";
import { getAdultMetadataProviderStatus } from "@/lib/providers/adult-metadata-config";
import { getPopularThePornDBCatalogue } from "@/lib/providers/theporndb";
import { getPopularStashDbCatalogue } from "@/lib/providers/stashdb";

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
  const feeds: Promise<MediaItem[]>[] = [];
  if (tmdbStatus.enabled) feeds.push(getPopularTmdbCatalogue());
  if (thePornDbStatus?.enabled) feeds.push(getPopularThePornDBCatalogue());
  if (stashDbStatus?.enabled) feeds.push(getPopularStashDbCatalogue());
  const results = await Promise.allSettled(feeds);
  const items = results.flatMap(result => result.status === "fulfilled" ? result.value : [])
    .filter(item => includeAdult || item.category !== "Adult");
  const providerFailed = results.some(result => result.status === "rejected");
  return {
    items: deduplicateTitles(items),
    notice: providerFailed ? "A metadata source is temporarily unavailable. Available titles are still shown." : "",
  };
}
