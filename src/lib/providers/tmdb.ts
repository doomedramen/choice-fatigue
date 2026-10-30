import "server-only";
import { prisma } from "@/lib/prisma";
import { getEnabledTmdbToken, TmdbConfigurationError, TmdbNotEnabledError } from "@/lib/providers/tmdb-config";

export const tmdbCategories = ["Movies", "TV"] as const;
export type TmdbCategory = (typeof tmdbCategories)[number];
export type TmdbMediaType = "movie" | "tv";

type TmdbRecord = {
  id?: unknown;
  adult?: unknown;
  title?: unknown;
  name?: unknown;
  release_date?: unknown;
  first_air_date?: unknown;
  overview?: unknown;
  poster_path?: unknown;
  media_type?: unknown;
  vote_average?: unknown;
};

type TmdbSearchPayload = { results?: TmdbRecord[] };

export class TmdbRequestError extends Error {}
export class TmdbAdultResultError extends Error {}
export { TmdbConfigurationError, TmdbNotEnabledError };

async function requestTmdb<T>(path: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.themoviedb.org/3${path}`, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new TmdbRequestError();
    return await response.json() as T;
  } catch (error) {
    if (error instanceof TmdbRequestError) throw error;
    throw new TmdbRequestError();
  } finally {
    clearTimeout(timeout);
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function yearFrom(dateValue: unknown) {
  const match = typeof dateValue === "string" ? /^(\d{4})/.exec(dateValue) : null;
  return match ? Number(match[1]) : undefined;
}

function posterUrl(pathValue: unknown) {
  const path = text(pathValue);
  return path.startsWith("/") ? `https://image.tmdb.org/t/p/w500${path}` : undefined;
}

function mediaTypeFor(record: TmdbRecord, category: TmdbCategory): TmdbMediaType | null {
  if (category === "Movies") return "movie";
  if (category === "TV") return "tv";
  return null;
}

function titleFor(record: TmdbRecord, mediaType: TmdbMediaType) {
  return text(mediaType === "movie" ? record.title : record.name);
}

export async function searchTmdb(query: string, category: TmdbCategory) {
  const token = await getEnabledTmdbToken();
  const encoded = encodeURIComponent(query);
  const endpoint = category === "Movies"
    ? `/search/movie?query=${encoded}&include_adult=false&language=en-US&page=1`
    : `/search/tv?query=${encoded}&include_adult=false&language=en-US&page=1`;
  const payload = await requestTmdb<TmdbSearchPayload>(endpoint, token);
  return (Array.isArray(payload.results) ? payload.results : [])
    .filter(record => record && record.adult !== true)
    .map(record => {
      const mediaType = mediaTypeFor(record, category);
      if (!mediaType || typeof record.id !== "number" || record.id < 1) return null;
      const title = titleFor(record, mediaType);
      if (!title) return null;
      const year = yearFrom(mediaType === "movie" ? record.release_date : record.first_air_date);
      const artwork = posterUrl(record.poster_path);
      return {
        tmdbId: record.id,
        mediaType,
        title,
        ...(year ? { year } : {}),
        synopsis: text(record.overview),
        ...(artwork ? { posterUrl: artwork } : {}),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 12);
}

function formatMinutes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return hours ? `${hours}h${minutes ? ` ${minutes}m` : ""}` : `${minutes}m`;
}

function formatRuntime(record: TmdbRecord & { runtime?: unknown; episode_run_time?: unknown; number_of_seasons?: unknown }, mediaType: TmdbMediaType) {
  if (mediaType === "movie") return formatMinutes(record.runtime);
  const episodeRuntime = Array.isArray(record.episode_run_time) ? record.episode_run_time.find(value => typeof value === "number") : undefined;
  const seasons = typeof record.number_of_seasons === "number" && record.number_of_seasons > 0 ? `${record.number_of_seasons} ${record.number_of_seasons === 1 ? "season" : "seasons"}` : "Series";
  return episodeRuntime ? `${seasons} · ${formatMinutes(episodeRuntime)} episodes` : seasons;
}

export async function importTmdbEntry(input: { tmdbId: number; mediaType: TmdbMediaType; category: TmdbCategory }) {
  const token = await getEnabledTmdbToken();
  const { tmdbId, mediaType, category } = input;
  if ((category === "Movies" && mediaType !== "movie") || (category === "TV" && mediaType !== "tv")) {
    throw new TypeError("The selected category does not match the TMDB item type.");
  }

  const record = await requestTmdb<TmdbRecord & {
    genres?: Array<{ name?: unknown }>;
    runtime?: unknown;
    episode_run_time?: unknown;
    number_of_seasons?: unknown;
    tagline?: unknown;
  }>(`/${mediaType}/${tmdbId}?language=en-US`, token);
  if (record.adult === true) throw new TmdbAdultResultError();
  const title = titleFor(record, mediaType);
  if (!title || typeof record.id !== "number" || record.id !== tmdbId) throw new TmdbRequestError();

  const year = yearFrom(mediaType === "movie" ? record.release_date : record.first_air_date);
  const genres = Array.isArray(record.genres)
    ? record.genres.map(genre => text(genre?.name)).filter(Boolean).slice(0, 20)
    : [];
  const rating = typeof record.vote_average === "number" && Number.isFinite(record.vote_average)
    ? Math.min(10, Math.max(0, record.vote_average))
    : null;
  const artwork = posterUrl(record.poster_path);
  const sourceId = `${mediaType}:${tmdbId}`;
  const existing = await prisma.catalogueEntry.findUnique({ where: { source_sourceId: { source: "tmdb", sourceId } } });
  const lastInCategory = await prisma.catalogueEntry.findFirst({ where: { category }, orderBy: { displayOrder: "desc" }, select: { displayOrder: true } });
  const fields = {
    title,
    category,
    year: year ?? null,
    type: mediaType === "movie" ? "Movie" : "TV series",
    runtime: formatRuntime(record, mediaType),
    rating,
    genres,
    synopsis: text(record.overview),
    palette: ["#344255", "#263244", "#151d2c"],
    art: "mist",
    label: text(record.tagline) || title,
    artworkUrl: artwork ?? null,
    ageRestriction: null,
    contentFlags: [],
    active: true,
  };

  return prisma.catalogueEntry.upsert({
    where: { source_sourceId: { source: "tmdb", sourceId } },
    create: {
      id: `tmdb-${sourceId.replace(":", "-")}`,
      source: "tmdb",
      sourceId,
      displayOrder: (lastInCategory?.displayOrder ?? -1) + 1,
      ...fields,
    },
    update: fields,
  });
}
