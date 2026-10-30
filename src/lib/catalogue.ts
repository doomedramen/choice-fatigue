import "server-only";
import { categories, media as fixtureCatalogue, type Category, type MediaItem } from "@/data";
import { prisma } from "@/lib/prisma";

const categorySet = new Set<string>(categories);
const defaultPalette: [string, string, string] = ["#344255", "#263244", "#151d2c"];

function fromDatabase(entry: Awaited<ReturnType<typeof prisma.catalogueEntry.findMany>>[number]): MediaItem | null {
  if (!categorySet.has(entry.category)) return null;
  const category = entry.category as Category;
  const fixture = fixtureCatalogue.find(item => item.id === entry.id);
  const palette = entry.palette.length >= 3
    ? [entry.palette[0], entry.palette[1], entry.palette[2]] as [string, string, string]
    : fixture?.palette ?? defaultPalette;

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
    palette,
    art: entry.art ?? fixture?.art ?? "mist",
    label: entry.label ?? fixture?.label ?? entry.title,
    category,
    ...(entry.ageRestriction === null ? {} : { age: entry.ageRestriction }),
    contentFlags: entry.contentFlags,
  };
}

export async function getCatalogue(): Promise<MediaItem[]> {
  try {
    const entries = await prisma.catalogueEntry.findMany({
      orderBy: [{ category: "asc" }, { displayOrder: "asc" }, { title: "asc" }],
    });
    if (entries.length === 0) return fixtureCatalogue;
    return entries.filter(entry => entry.active).map(fromDatabase).filter((item): item is MediaItem => item !== null);
  } catch {
    console.warn("Catalogue table unavailable; using the local fixture catalogue.");
    return fixtureCatalogue;
  }
}
