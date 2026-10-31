import "server-only";
import { requestProviderJson } from "@/lib/providers/request";
import type { MediaItem } from "@/data";
import { recommendationFeatureKeys } from "@/lib/recommendations";
import { getEnabledTmdbToken, TmdbConfigurationError, TmdbNotEnabledError } from "@/lib/providers/tmdb-config";

export const tmdbCategories = ["Movies", "Shows"] as const;
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
  backdrop_path?: unknown;
  media_type?: unknown;
  vote_average?: unknown;
  vote_count?: unknown;
  popularity?: unknown;
  genre_ids?: unknown;
  genres?: Array<{ name?: unknown }>;
};

type TmdbSearchPayload = { results?: TmdbRecord[]; total_pages?: number };
type TmdbGenrePayload = { genres?: Array<{ id?: unknown; name?: unknown }> };

export class TmdbRequestError extends Error {}
export class TmdbAdultResultError extends Error {}
export { TmdbConfigurationError, TmdbNotEnabledError };

async function requestTmdb<T>(path: string, token: string): Promise<T> {
  const baseUrl = process.env.NODE_ENV !== "production" ? process.env.TMDB_API_BASE_URL || "https://api.themoviedb.org/3" : "https://api.themoviedb.org/3";
  return requestProviderJson<T>("tmdb", `${baseUrl.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
  });
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

function backdropUrl(pathValue: unknown) {
  const path = text(pathValue);
  return path.startsWith("/") ? `https://image.tmdb.org/t/p/w1280${path}` : undefined;
}

function mediaTypeFor(record: TmdbRecord, category: TmdbCategory): TmdbMediaType | null {
  if (category === "Movies") return "movie";
  if (category === "Shows") return "tv";
  return null;
}

function titleFor(record: TmdbRecord, mediaType: TmdbMediaType) {
  return text(mediaType === "movie" ? record.title : record.name);
}

export async function getTmdbTitleDetails(mediaType: TmdbMediaType, tmdbId: number) {
  if (!Number.isSafeInteger(tmdbId) || tmdbId < 1) throw new TmdbRequestError();
  const token = await getEnabledTmdbToken();
  const record = await requestTmdb<TmdbRecord & { runtime?: unknown; episode_run_time?: unknown; number_of_seasons?: unknown }>(`/${mediaType}/${tmdbId}?language=en-US`, token);
  if (record.adult === true || record.id !== tmdbId) throw new TmdbAdultResultError();
  const title = titleFor(record, mediaType);
  if (!title) throw new TmdbRequestError();
  return {
    title,
    year: yearFrom(mediaType === "movie" ? record.release_date : record.first_air_date),
    runtime: formatRuntime(record, mediaType),
    genres: Array.isArray(record.genres) ? record.genres.map(genre => text(genre.name)).filter(Boolean) : [],
  };
}

/** Resolve one saved TMDB ID on demand. Provider metadata is returned to the caller and never stored. */
export async function getTmdbMediaItem(mediaType: TmdbMediaType, tmdbId: number): Promise<MediaItem> {
  if (!Number.isSafeInteger(tmdbId) || tmdbId < 1) throw new TmdbRequestError();
  const token = await getEnabledTmdbToken();
  const record = await requestTmdb<TmdbRecord & { runtime?: unknown; episode_run_time?: unknown; number_of_seasons?: unknown }>(`/${mediaType}/${tmdbId}?language=en-US`, token);
  if (record.adult === true || record.id !== tmdbId) throw new TmdbAdultResultError();
  const title = titleFor(record, mediaType);
  if (!title) throw new TmdbRequestError();
  const category: TmdbCategory = mediaType === "movie" ? "Movies" : "Shows";
  const genres = Array.isArray(record.genres) ? record.genres.map(genre => text(genre.name)).filter(Boolean).slice(0, 8) : [];
  const rating = typeof record.vote_average === "number" && Number.isFinite(record.vote_average) ? Math.min(10, Math.max(0, record.vote_average)).toFixed(1) : "—";
  return {
    id: `tmdb-${mediaType}-${tmdbId}`,
    title,
    ...(yearFrom(mediaType === "movie" ? record.release_date : record.first_air_date) ? { year: yearFrom(mediaType === "movie" ? record.release_date : record.first_air_date) } : {}),
    type: mediaType === "movie" ? "Movie" : "Series",
    runtime: formatRuntime(record, mediaType),
    rating,
    genre: genres,
    synopsis: text(record.overview),
    ...(posterUrl(record.poster_path) ? { artworkUrl: posterUrl(record.poster_path) } : {}),
    ...(backdropUrl(record.backdrop_path) ? { backdropUrl: backdropUrl(record.backdrop_path) } : {}),
    palette: ["#344255", "#263244", "#151d2c"],
    art: "mist",
    label: title,
    category,
    requestable: { provider: "tmdb", mediaType, id: tmdbId },
  };
}

export async function getTmdbRecommendationFeatures(mediaType: TmdbMediaType, tmdbId: number) {
  const details = await getTmdbTitleDetails(mediaType, tmdbId);
  return recommendationFeatureKeys({ genres: details.genres, year: details.year, type: mediaType === "movie" ? "Movie" : "Series" });
}

function discoveryEntry(record: TmdbRecord, category: TmdbCategory, displayOrder: number, genresById: Map<number, string>) {
  const mediaType = mediaTypeFor(record, category);
  if (!mediaType || record.adult === true || typeof record.id !== "number" || !Number.isSafeInteger(record.id) || record.id < 1) return null;
  const title = titleFor(record, mediaType);
  if (!title) return null;

  const genreIds = Array.isArray(record.genre_ids) ? record.genre_ids : [];
  const genres = [...new Set(genreIds
    .filter((id): id is number => typeof id === "number")
    .map(id => genresById.get(id))
    .filter((genre): genre is string => Boolean(genre)))].slice(0, 8);
  const rating = typeof record.vote_average === "number" && Number.isFinite(record.vote_average)
    ? Math.min(10, Math.max(0, record.vote_average))
    : null;
  const sourceId = `${mediaType}:${record.id}`;

  return {
    id: `tmdb-${sourceId.replace(":", "-")}`,
    source: "tmdb",
    sourceId,
    title,
    category,
    year: yearFrom(mediaType === "movie" ? record.release_date : record.first_air_date) ?? null,
    type: mediaType === "movie" ? "Movie" : "Series",
    runtime: mediaType === "movie" ? "—" : "Series",
    rating,
    genres,
    synopsis: text(record.overview),
    palette: ["#344255", "#263244", "#151d2c"],
    art: "mist",
    label: title,
    artworkUrl: posterUrl(record.poster_path) ?? null,
    backdropUrl: backdropUrl(record.backdrop_path) ?? null,
    ageRestriction: null,
    contentFlags: [],
    active: true,
    displayOrder,
  };
}

function catalogueItemsFromRecords(records: TmdbRecord[], category: TmdbCategory, genresById: Map<number, string>): MediaItem[] {
  return records.flatMap(record => {
    const entry = discoveryEntry(record, category, 0, genresById);
    if (!entry) return [];
    const mediaType = mediaTypeFor(record, category)!;
    return [{
      id: entry.id,
      title: entry.title,
      ...(entry.year === null ? {} : { year: entry.year }),
      type: entry.type,
      runtime: entry.runtime,
      rating: entry.rating === null ? "—" : entry.rating.toFixed(1),
      genre: entry.genres,
      synopsis: entry.synopsis,
      ...(entry.artworkUrl ? { artworkUrl: entry.artworkUrl } : {}),
      ...(entry.backdropUrl ? { backdropUrl: entry.backdropUrl } : {}),
      palette: ["#344255", "#263244", "#151d2c"],
      art: "mist",
      label: entry.label,
      category,
      requestable: { provider: "tmdb" as const, mediaType, id: Number(record.id) },
    }];
  });
}

async function getCatalogueGenres(category: TmdbCategory, token: string) {
  const payload = await requestTmdb<TmdbGenrePayload>(`/genre/${category === "Movies" ? "movie" : "tv"}/list?language=en-US`, token);
  if (!Array.isArray(payload.genres)) throw new TmdbRequestError();
  return new Map<number, string>(payload.genres
    .filter(genre => typeof genre.id === "number" && typeof genre.name === "string")
    .map(genre => [genre.id as number, text(genre.name)]));
}

/** Load one further page of popular titles after the initial discovery batch. */
export async function getTmdbCataloguePage(category: TmdbCategory, page: number, featureKeys: string[] = []) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 500) throw new TmdbRequestError();
  const token = await getEnabledTmdbToken();
  const mediaType = category === "Movies" ? "movie" : "tv";
  const genres = await getCatalogueGenres(category, token);
  const genreIds = [...genres].filter(([, name]) => featureKeys.includes(`genre:${name.trim().toLowerCase().replace(/\s+/g, " ")}`)).map(([id]) => id);
  if (featureKeys.length && !genreIds.length) return { items: [], hasMore: false };
  const filters = genreIds.length ? `&with_genres=${encodeURIComponent(genreIds.join("|"))}` : "";
  const payload = await requestTmdb<TmdbSearchPayload>(`/discover/${mediaType}?include_adult=false&${mediaType === "movie" ? "include_video=false&" : "include_null_first_air_dates=false&"}language=en-US&page=${page}&sort_by=popularity.desc${filters}`, token);
  if (!Array.isArray(payload.results)) throw new TmdbRequestError();
  const records = payload.results;
  const totalPages = typeof payload.total_pages === "number" && Number.isFinite(payload.total_pages)
    ? Math.min(500, Math.max(1, Math.floor(payload.total_pages)))
    : 500;
  return { items: catalogueItemsFromRecords(records, category, genres), hasMore: records.length > 0 && page < totalPages };
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
