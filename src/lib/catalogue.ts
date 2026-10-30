import "server-only";
import { categories, media as fixtureCatalogue, type Category, type MediaItem } from "@/data";
import { prisma } from "@/lib/prisma";
import { syncTmdbDiscoveryCatalogue } from "@/lib/providers/tmdb";
import { getTmdbProviderStatus } from "@/lib/providers/tmdb-config";

const categorySet = new Set<string>(categories);
const defaultPalette: [string, string, string] = ["#344255", "#263244", "#151d2c"];

function fromDatabase(entry: Awaited<ReturnType<typeof prisma.catalogueEntry.findMany>>[number]): MediaItem | null {
  if (!categorySet.has(entry.category)) return null;
  const category = entry.category as Category;
  const fixture = fixtureCatalogue.find(item => item.id === entry.id);
  const palette = entry.palette.length >= 3
    ? [entry.palette[0], entry.palette[1], entry.palette[2]] as [string, string, string]
    : fixture?.palette ?? defaultPalette;

  const tmdbMatch = entry.source === "tmdb" ? /^(movie|tv):(\d{1,10})$/.exec(entry.sourceId) : null;
  const tmdbId = tmdbMatch ? Number(tmdbMatch[2]) : NaN;

  return {
    id: entry.id,
    title: entry.title,
    year: entry.year ?? fixture?.year,
    type: entry.type ?? fixture?.type ?? "Title",
    runtime: entry.runtime ?? fixture?.runtime ?? "—",
    rating: entry.rating === null ? fixture?.rating ?? "—" : entry.rating.toFixed(1),
    genre: entry.genres.length > 0 ? entry.genres : fixture?.genre ?? [],
    synopsis: entry.synopsis ?? fixture?.synopsis ?? "",
    ...(entry.artworkUrl ? { artworkUrl: entry.artworkUrl } : {}),
    ...(entry.backdropUrl ? { backdropUrl: entry.backdropUrl } : {}),
    palette,
    art: entry.art ?? fixture?.art ?? "mist",
    label: entry.label ?? fixture?.label ?? entry.title,
    category,
    ...(entry.ageRestriction === null ? {} : { age: entry.ageRestriction }),
    contentFlags: entry.contentFlags,
    ...(tmdbMatch && Number.isSafeInteger(tmdbId) && tmdbId > 0
      ? { requestable: { provider: "tmdb" as const, mediaType: tmdbMatch[1] as "movie" | "tv", id: tmdbId } }
      : {}),
  };
}

export async function getCatalogue(): Promise<MediaItem[]> {
  try {
    const entries = await prisma.catalogueEntry.findMany({
      where: { source: { not: "local" } },
      orderBy: [{ category: "asc" }, { displayOrder: "asc" }, { title: "asc" }],
    });
    return entries.filter(entry => entry.active).map(fromDatabase).filter((item): item is MediaItem => item !== null);
  } catch {
    console.warn("Catalogue table unavailable; discovery has no provider entries to show.");
    return [];
  }
}

function deduplicateTitles(items: MediaItem[]) {
  const preferred = [...items].sort((a, b) => Number(Boolean(b.requestable)) - Number(Boolean(a.requestable)));
  const ids = new Set<string>();
  const titles = new Set<string>();
  return preferred.filter(item => {
    const normalizedTitle = item.title.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    const titleKey = `${item.category}:${normalizedTitle}:${item.year ?? "unknown-year"}`;
    if (ids.has(item.id) || titles.has(titleKey)) return false;
    ids.add(item.id);
    titles.add(titleKey);
    return true;
  });
}

export async function getDiscoveryCatalogue() {
  const existingItems = await getCatalogue();
  try {
    const status = await getTmdbProviderStatus();
    if (!status.enabled) return { items: deduplicateTitles(existingItems), notice: "" };

    await syncTmdbDiscoveryCatalogue();
    const items = deduplicateTitles(await getCatalogue());
    return { items, notice: "" };
  } catch {
    console.warn("TMDB discovery could not refresh the catalogue; showing imported provider entries only.");
    return {
      items: deduplicateTitles(existingItems),
      notice: "TMDB titles couldn’t be loaded. Already imported titles are still available.",
    };
  }
}
