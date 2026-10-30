import type { Category } from "@/data";

export type ProviderTitleReference =
  | { provider: "tmdb"; mediaType: "movie" | "tv"; sourceId: number; category: "Movies" | "Shows" }
  | { provider: "theporndb"; kind: "scene" | "movie"; sourceId: string; category: "Adult" }
  | { provider: "stashdb"; sourceId: string; category: "Adult" };

export function parseProviderTitleId(id: string): ProviderTitleReference | null {
  const tmdb = /^tmdb-(movie|tv)-([1-9]\d{0,9})$/.exec(id);
  if (tmdb) return { provider: "tmdb", mediaType: tmdb[1] as "movie" | "tv", sourceId: Number(tmdb[2]), category: tmdb[1] === "movie" ? "Movies" : "Shows" };
  const thePornDb = /^theporndb-(scene|movie)-([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(id);
  if (thePornDb) return { provider: "theporndb", kind: thePornDb[1] as "scene" | "movie", sourceId: thePornDb[2], category: "Adult" };
  const stashDb = /^stashdb-([A-Za-z0-9][A-Za-z0-9_-]{0,159})$/.exec(id);
  if (stashDb) return { provider: "stashdb", sourceId: stashDb[1], category: "Adult" };
  return null;
}

export function providerTitleCategory(id: string): Category | null {
  return parseProviderTitleId(id)?.category ?? null;
}
