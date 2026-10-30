import "server-only";
import { prisma } from "@/lib/prisma";
import { getGlobalSettings } from "@/lib/global-settings";
import { serverConfig } from "@/lib/server-config";

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
  const token = process.env.THEPORNDB_API_TOKEN;
  if (process.env.THEPORNDB_METADATA_ENABLED !== "true" || !token || !serverConfig.adultSectionEnabled) {
    throw new ThePornDBNotEnabledError();
  }

  const settings = await getGlobalSettings();
  if (!settings.adultSectionEnabled) throw new ThePornDBNotEnabledError();
  return token;
}

async function requestThePornDB<T>(path: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.theporndb.net/${path}`, {
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

function apiPath(kind: ThePornDBKind, id?: string) {
  const collection = kind === "scene" ? "scenes" : "movies";
  return id ? `${collection}/${encodeURIComponent(id)}` : collection;
}

export async function searchThePornDB(query: string, kind: ThePornDBKind) {
  const token = await accessToken();
  const params = new URLSearchParams({ parse: query, limit: "25" });
  const payload = await requestThePornDB<ThePornDBPayload>(`${apiPath(kind)}?${params.toString()}`, token);
  return recordsFrom(payload)
    .map(record => toSearchResult(record, kind))
    .filter((result): result is NonNullable<typeof result> => result !== null)
    .slice(0, 12);
}

export async function importThePornDBEntry(input: { sourceId: string; kind: ThePornDBKind }) {
  const token = await accessToken();
  if (!idPattern.test(input.sourceId)) throw new ThePornDBInvalidRecordError();

  const payload = await requestThePornDB<ThePornDBPayload>(apiPath(input.kind, input.sourceId), token);
  const record = recordsFrom(payload)[0];
  if (!record || (recordId(record) && recordId(record) !== input.sourceId)) throw new ThePornDBInvalidRecordError();
  const result = toSearchResult(record, input.kind);
  if (!result) throw new ThePornDBInvalidRecordError();

  const sourceId = `${input.kind}:${input.sourceId}`;
  const category = "Adult";
  const lastInCategory = await prisma.catalogueEntry.findFirst({ where: { category }, orderBy: { displayOrder: "desc" }, select: { displayOrder: true } });

  return prisma.catalogueEntry.upsert({
    where: { source_sourceId: { source: "theporndb", sourceId } },
    create: {
      id: `theporndb-${input.kind}-${input.sourceId}`,
      source: "theporndb",
      sourceId,
      displayOrder: (lastInCategory?.displayOrder ?? -1) + 1,
      title: result.title,
      category,
      year: result.year ?? null,
      type: input.kind === "movie" ? "Movie" : "Scene",
      runtime: result.runtime ?? "—",
      rating: typeof record.rating === "number" && Number.isFinite(record.rating) ? Math.min(10, Math.max(0, record.rating)) : null,
      genres: result.genres,
      synopsis: result.synopsis,
      palette: ["#58352e", "#362b30", "#211c28"],
      art: "noir",
      label: result.title,
      artworkUrl: null,
      ageRestriction: 18,
      contentFlags: ["adult"],
      active: true,
    },
    update: {
      title: result.title,
      year: result.year ?? null,
      type: input.kind === "movie" ? "Movie" : "Scene",
      runtime: result.runtime ?? "—",
      rating: typeof record.rating === "number" && Number.isFinite(record.rating) ? Math.min(10, Math.max(0, record.rating)) : null,
      genres: result.genres,
      synopsis: result.synopsis,
      label: result.title,
      artworkUrl: null,
      ageRestriction: 18,
      contentFlags: ["adult"],
      active: true,
    },
  });
}
