import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { searchTmdb, type TmdbCategory } from "@/lib/providers/tmdb";
import { getEnabledTvdbConfig, TvdbConfigurationError, TvdbNotEnabledError } from "@/lib/providers/tvdb-config";

const API_BASE = "https://api4.thetvdb.com/v4";
const TOKEN_TTL_MS = 25 * 24 * 60 * 60 * 1000;

export const tvdbCategories = ["Movies", "TV"] as const;
export type TvdbCategory = (typeof tvdbCategories)[number];
export type TvdbMediaType = "movie" | "series";

type TvdbRecord = {
  id?: unknown;
  tvdb_id?: unknown;
  type?: unknown;
  name?: unknown;
  title?: unknown;
  name_translated?: unknown;
  year?: unknown;
  first_air_time?: unknown;
  firstAired?: unknown;
  overview?: unknown;
  genres?: unknown;
  runtime?: unknown;
  averageRuntime?: unknown;
  data?: unknown;
};

type TvdbTokenResponse = { data?: { token?: unknown } };
type TvdbSearchResponse = { data?: TvdbRecord[] };
type TvdbDetailsResponse = { data?: TvdbRecord };

export class TvdbAuthenticationError extends Error {}
export class TvdbRequestError extends Error {}
export { TvdbConfigurationError, TvdbNotEnabledError };

let tokenCache: { fingerprint: string; token: string; expiresAt: number } | null = null;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveId(value: unknown) {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function yearFrom(...values: unknown[]) {
  for (const value of values) {
    const match = typeof value === "string" ? /^(\d{4})/.exec(value.trim()) : null;
    if (match) {
      const year = Number(match[1]);
      if (year >= 1888 && year <= new Date().getFullYear() + 10) return year;
    }
  }
  return undefined;
}

function configFingerprint(apiKey: string, subscriberPin: string) {
  return createHash("sha256").update(apiKey).update("\0").update(subscriberPin).digest("hex");
}

async function login() {
  const config = await getEnabledTvdbConfig();
  const fingerprint = configFingerprint(config.apiKey, config.subscriberPin);
  if (tokenCache?.fingerprint === fingerprint && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const payload = { apikey: config.apiKey, ...(config.subscriberPin ? { pin: config.subscriberPin } : {}) };
    const response = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) throw new TvdbAuthenticationError();
    if (!response.ok) throw new TvdbRequestError();
    const result = await response.json() as TvdbTokenResponse;
    const token = text(result?.data?.token);
    if (!token) throw new TvdbRequestError();
    tokenCache = { fingerprint, token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return token;
  } catch (error) {
    if (error instanceof TvdbAuthenticationError || error instanceof TvdbRequestError || error instanceof TvdbNotEnabledError || error instanceof TvdbConfigurationError) throw error;
    throw new TvdbRequestError();
  } finally {
    clearTimeout(timeout);
  }
}

async function requestTvdb<T>(path: string, retryUnauthorized = true): Promise<T> {
  const token = await login();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.status === 401 && retryUnauthorized) {
      tokenCache = null;
      return requestTvdb<T>(path, false);
    }
    if (response.status === 401 || response.status === 403) throw new TvdbAuthenticationError();
    if (!response.ok) throw new TvdbRequestError();
    return await response.json() as T;
  } catch (error) {
    if (error instanceof TvdbAuthenticationError || error instanceof TvdbRequestError) throw error;
    throw new TvdbRequestError();
  } finally {
    clearTimeout(timeout);
  }
}

function titleFor(record: TvdbRecord) {
  return text(record.name) || text(record.name_translated) || text(record.title);
}

function normalizedTitle(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

async function tmdbArtworkFor(title: string, year: number | undefined, category: TvdbCategory) {
  try {
    const matches = await searchTmdb(title, category as TmdbCategory);
    const normalized = normalizedTitle(title);
    const exact = matches.filter(match =>
      normalizedTitle(match.title) === normalized
      && (!year || match.year === year)
      && (category !== "Movies" || match.mediaType === "movie")
      && (category !== "TV" || match.mediaType === "tv"),
    );
    return exact.length === 1 ? { posterUrl: exact[0].posterUrl, backdropUrl: exact[0].backdropUrl } : {};
  } catch {
    // TVDB remains usable on its own if TMDB is unconfigured or unavailable.
    return {};
  }
}

export async function searchTvdb(query: string, category: TvdbCategory) {
  const type: TvdbMediaType = category === "Movies" ? "movie" : "series";
  const params = new URLSearchParams({ query, type, limit: "12" });
  const payload = await requestTvdb<TvdbSearchResponse>(`/search?${params.toString()}`);
  const records = Array.isArray(payload.data) ? payload.data : [];
  return records.flatMap(record => {
    const tvdbId = positiveId(record.tvdb_id) ?? positiveId(record.id);
    const title = titleFor(record);
    if (!tvdbId || !title) return [];
    const year = yearFrom(record.year, record.first_air_time);
    return [{
      tvdbId,
      mediaType: type,
      title,
      ...(year ? { year } : {}),
      synopsis: text(record.overview),
    }];
  }).slice(0, 12);
}

function genresFrom(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(genre => {
    const name = typeof genre === "string" ? genre.trim() : genre && typeof genre === "object" ? text((genre as { name?: unknown }).name) : "";
    return name ? [name] : [];
  }).slice(0, 20);
}

function runtimeFrom(record: TvdbRecord, mediaType: TvdbMediaType) {
  const runtime = positiveId(mediaType === "movie" ? record.runtime : record.averageRuntime);
  if (!runtime) return mediaType === "series" ? "Series" : "—";
  return mediaType === "series" ? `${runtime}m episodes` : `${runtime}m`;
}

export async function importTvdbEntry(input: { tvdbId: number; mediaType: TvdbMediaType; category: TvdbCategory }) {
  if ((input.category === "Movies" && input.mediaType !== "movie") || (input.category === "TV" && input.mediaType !== "series")) {
    throw new TypeError("The selected category does not match the TheTVDB item type.");
  }
  const endpoint = input.mediaType === "movie" ? "movies" : "series";
  const payload = await requestTvdb<TvdbDetailsResponse>(`/${endpoint}/${input.tvdbId}/extended?short=true`);
  const record = payload.data;
  if (!record || positiveId(record.id) !== input.tvdbId) throw new TvdbRequestError();
  const title = titleFor(record);
  if (!title) throw new TvdbRequestError();

  const year = yearFrom(record.year, record.firstAired);
  const artwork = await tmdbArtworkFor(title, year, input.category);
  const category = input.category;
  const sourceId = `${input.mediaType}:${input.tvdbId}`;
  const lastInCategory = await prisma.catalogueEntry.findFirst({ where: { category }, orderBy: { displayOrder: "desc" }, select: { displayOrder: true } });
  const fields = {
    title,
    category,
    year: year ?? null,
    type: input.mediaType === "movie" ? "Movie" : "TV series",
    runtime: runtimeFrom(record, input.mediaType),
    rating: null,
    genres: genresFrom(record.genres),
    synopsis: text(record.overview),
    palette: ["#344255", "#263244", "#151d2c"],
    art: "mist",
    label: title,
    artworkUrl: artwork.posterUrl ?? null,
    backdropUrl: artwork.backdropUrl ?? null,
    ageRestriction: null,
    contentFlags: [],
    active: true,
  };

  return prisma.catalogueEntry.upsert({
    where: { source_sourceId: { source: "tvdb", sourceId } },
    create: {
      id: `tvdb-${sourceId.replace(":", "-")}`,
      source: "tvdb",
      sourceId,
      displayOrder: (lastInCategory?.displayOrder ?? -1) + 1,
      ...fields,
    },
    update: fields,
  });
}
