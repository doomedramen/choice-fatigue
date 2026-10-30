import "server-only";
import { getGlobalSettings } from "@/lib/global-settings";
import { getEnabledAdultMetadataProviderConfig } from "@/lib/providers/adult-metadata-config";
import type { MediaItem } from "@/data";
import { recommendationFeatureKeys } from "@/lib/recommendations";

export const thePornDBKinds = ["scene", "movie"] as const;
export type ThePornDBKind = (typeof thePornDBKinds)[number];

type ThePornDBRecord = {
  _id?: unknown;
  id?: unknown;
  title?: unknown;
  description?: unknown;
  date?: unknown;
  year?: unknown;
  duration?: unknown;
  tags?: unknown;
  type?: unknown;
  rating?: unknown;
};

type ThePornDBPayload = { data?: ThePornDBRecord[] | ThePornDBRecord };

export class ThePornDBNotEnabledError extends Error {}
export class ThePornDBRequestError extends Error {}
export class ThePornDBInvalidRecordError extends Error {}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

async function accessToken() {
  const settings = await getGlobalSettings();
  if (!settings.adultSectionEnabled) throw new ThePornDBNotEnabledError();
  try {
    return (await getEnabledAdultMetadataProviderConfig("theporndb")).apiKey;
  } catch {
    throw new ThePornDBNotEnabledError();
  }
}

async function requestThePornDB<T>(path: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const baseUrl = process.env.NODE_ENV !== "production" ? process.env.THEPORNDB_API_BASE_URL || "https://api.theporndb.net" : "https://api.theporndb.net";
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "ChoiceFatigue/0.1",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new ThePornDBRequestError();
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ThePornDBRequestError) throw error;
    throw new ThePornDBRequestError();
  } finally {
    clearTimeout(timeout);
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function recordId(record: ThePornDBRecord) {
  const id = text(record._id) || text(record.id);
  return idPattern.test(id) ? id : "";
}

function recordsFrom(payload: ThePornDBPayload): ThePornDBRecord[] {
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object") return [payload.data];
  return [];
}

function yearFrom(record: ThePornDBRecord) {
  if (typeof record.year === "number" && Number.isInteger(record.year) && record.year >= 1880 && record.year <= 2200) return record.year;
  const date = text(record.date);
  const match = /^(\d{4})/.exec(date);
  return match ? Number(match[1]) : undefined;
}

function formatDuration(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const minutes = Math.round(value / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;
}

function genresFrom(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(tag => {
    if (!tag || typeof tag !== "object") return "";
    return text((tag as { name?: unknown }).name);
  }).filter(Boolean).slice(0, 20);
}

function toSearchResult(record: ThePornDBRecord, kind: ThePornDBKind) {
  const sourceId = recordId(record);
  const title = text(record.title);
  if (!sourceId || !title) return null;
  const year = yearFrom(record);
  const runtime = formatDuration(record.duration);
  return {
    sourceId,
    kind,
    title,
    ...(year ? { year } : {}),
    synopsis: text(record.description),
    ...(runtime ? { runtime } : {}),
    genres: genresFrom(record.tags),
  };
}

function popularItem(record: ThePornDBRecord, kind: ThePornDBKind): MediaItem | null {
  const result = toSearchResult(record, kind);
  if (!result) return null;
  const rating = typeof record.rating === "number" && Number.isFinite(record.rating)
    ? Math.min(10, Math.max(0, record.rating))
    : null;
  return {
    id: `theporndb-${kind}-${result.sourceId}`,
    title: result.title,
    ...(result.year ? { year: result.year } : {}),
    type: kind === "movie" ? "Movie" : "Scene",
    runtime: result.runtime ?? "—",
    rating: rating === null ? "—" : rating.toFixed(1),
    genre: result.genres,
    synopsis: result.synopsis,
    palette: ["#58352e", "#362b30", "#211c28"],
    art: "noir",
    label: result.title,
    category: "Adult",
    age: 18,
    contentFlags: ["adult"],
  };
}

/** Load ThePornDB's relevance-ranked scene and movie feeds on demand. */
export async function getPopularThePornDBCatalogue(): Promise<MediaItem[]> {
  const token = await accessToken();
  const load = async (kind: ThePornDBKind) => {
    const params = new URLSearchParams({ orderBy: "most_relevant", per_page: "25", page: "1" });
    const payload = await requestThePornDB<ThePornDBPayload>(`${apiPath(kind)}?${params.toString()}`, token);
    return recordsFrom(payload).map(record => popularItem(record, kind)).filter((item): item is MediaItem => item !== null);
  };
  const [scenes, movies] = await Promise.all([load("scene"), load("movie")]);
  return [...scenes, ...movies];
}

function apiPath(kind: ThePornDBKind, id?: string) {
  const collection = kind === "scene" ? "scenes" : "movies";
  return id ? `${collection}/${encodeURIComponent(id)}` : collection;
}

export async function getThePornDBRecommendationFeatures(kind: ThePornDBKind, sourceId: string) {
  if (!idPattern.test(sourceId)) throw new ThePornDBInvalidRecordError();
  const token = await accessToken();
  const payload = await requestThePornDB<ThePornDBPayload>(apiPath(kind, sourceId), token);
  const record = recordsFrom(payload)[0];
  if (!record || recordId(record) !== sourceId) throw new ThePornDBInvalidRecordError();
  return recommendationFeatureKeys({ genres: genresFrom(record.tags), year: yearFrom(record), type: kind === "movie" ? "Movie" : "Scene" });
}
