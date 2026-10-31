import "server-only";
import { requestProviderJson } from "@/lib/providers/request";
import { providerArtworkUrl } from "@/lib/provider-artwork";
import { stashDbPeople } from "@/lib/media-people";
import { getGlobalSettings } from "@/lib/global-settings";
import { getEnabledAdultMetadataProviderConfig } from "@/lib/providers/adult-metadata-config";
import type { MediaItem } from "@/data";
import { recommendationFeatureKeys } from "@/lib/recommendations";

const ENDPOINT = process.env.NODE_ENV !== "production" ? process.env.STASHDB_API_BASE_URL || "https://stashdb.org/graphql" : "https://stashdb.org/graphql";
const RESULT_LIMIT = 25;

type StashTag = { id?: unknown; name?: unknown };
type StashStudio = { name?: unknown } | null;
type StashScene = {
  id?: unknown;
  title?: unknown;
  details?: unknown;
  release_date?: unknown;
  duration?: unknown;
  tags?: StashTag[];
  studio?: StashStudio;
  images?: Array<{ url?: unknown } | null>;
};

type GraphqlResponse<T> = { data?: T; errors?: Array<{ message?: unknown }> };
type SceneBrowseResponse = { queryScenes?: { count?: number; scenes?: StashScene[] } };
type FindSceneResponse = { findScene?: StashScene | null };

export class StashDbNotEnabledError extends Error {}
export class StashDbRequestError extends Error {}
export class StashDbMissingSceneError extends Error {}

async function getApiKey() {
  const settings = await getGlobalSettings();
  if (!settings.adultSectionEnabled) throw new StashDbNotEnabledError();
  try {
    return (await getEnabledAdultMetadataProviderConfig("stashdb")).apiKey;
  } catch {
    throw new StashDbNotEnabledError();
  }
}

async function graphql<T>(query: string, variables: Record<string, unknown>, apiKey: string): Promise<T> {
  const result = await requestProviderJson<GraphqlResponse<T>>("stashdb", ENDPOINT, {
    method: "POST", headers: { ApiKey: apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (result.errors?.length || !result.data) throw new StashDbRequestError();
  return result.data;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function yearFrom(value: unknown) {
  const match = typeof value === "string" ? /^(\d{4})/.exec(value) : null;
  if (!match) return undefined;
  const year = Number(match[1]);
  return Number.isInteger(year) && year >= 1880 && year <= 2200 ? year : undefined;
}

function runtimeFrom(secondsValue: unknown) {
  if (typeof secondsValue !== "number" || !Number.isFinite(secondsValue) || secondsValue <= 0) return undefined;
  const minutes = Math.round(secondsValue / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours ? `${hours}h${remainingMinutes ? ` ${remainingMinutes}m` : ""}` : `${minutes}m`;
}

function normalizeScene(scene: StashScene) {
  const sourceId = stringValue(scene.id);
  const title = stringValue(scene.title);
  if (!sourceId || !title || sourceId.length > 160) return null;
  const genres = Array.isArray(scene.tags)
    ? scene.tags.map(tag => stringValue(tag?.name)).filter(Boolean).slice(0, 20)
    : [];
  return {
    sourceId,
    title,
    ...(yearFrom(scene.release_date) ? { year: yearFrom(scene.release_date) } : {}),
    synopsis: stringValue(scene.details).slice(0, 3000),
    ...(runtimeFrom(scene.duration) ? { runtime: runtimeFrom(scene.duration) } : {}),
    genres,
    artworkUrl: providerArtworkUrl(...(Array.isArray(scene.images) ? scene.images.map(image => image?.url) : [])),
  };
}

const findQuery = `query FindSceneById($id: ID!) {
  findScene(id: $id) {
    id
    title
    details
    release_date
    duration
    tags { id name }
    studio { name }
    images { url }
  }
}`;

const peopleQuery = `query ScenePeople($id: ID!) {
  findScene(id: $id) { id performers { as performer { name images { url } } } }
}`;

export async function getStashDbPeople(sourceId: string) {
  if (!sourceId || sourceId.length > 160 || !/^[A-Za-z0-9_-]+$/.test(sourceId)) throw new StashDbMissingSceneError();
  const response = await graphql<FindSceneResponse>(peopleQuery, { id: sourceId }, await getApiKey());
  if (!response.findScene || response.findScene.id !== sourceId) throw new StashDbMissingSceneError();
  return stashDbPeople(response.findScene);
}

const popularQuery = `query PopularScenes($input: SceneQueryInput!) {
  queryScenes(input: $input) {
    count
    scenes {
      id
      title
      details
      release_date
      duration
      tags { id name }
      studio { name }
      images { url }
    }
  }
}`;

/** Filter only by this provider's own tag IDs. */
export async function getStashDbCataloguePage(page: number, tagIds: string[] = []) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 500) throw new StashDbRequestError();
  const apiKey = await getApiKey();
  const response = await graphql<SceneBrowseResponse>(popularQuery, { input: {
    page, per_page: RESULT_LIMIT, direction: "DESC", sort: "POPULARITY",
    ...(tagIds.length ? { tags: { value: tagIds, modifier: "INCLUDES" } } : {}),
  } }, apiKey);
  if (!Array.isArray(response.queryScenes?.scenes)) throw new StashDbRequestError();
  const records = response.queryScenes.scenes;
  const count = response.queryScenes.count;
  return {
    items: records.map(normalizeScene).filter((scene): scene is NonNullable<typeof scene> => scene !== null).map(stashDbMediaItem),
    hasMore: records.length > 0 && page < 500 && (typeof count === "number" ? page * RESULT_LIMIT < count : records.length === RESULT_LIMIT),
  };
}

function stashDbMediaItem(scene: NonNullable<ReturnType<typeof normalizeScene>>): MediaItem {
  return {
    id: `stashdb-${scene.sourceId}`,
    title: scene.title,
    ...(scene.year ? { year: scene.year } : {}),
    ...(scene.artworkUrl ? { artworkUrl: scene.artworkUrl } : {}),
    type: "Scene",
    runtime: scene.runtime ?? "—",
    rating: "—",
    genre: scene.genres,
    synopsis: scene.synopsis,
    palette: ["#3d2d38", "#2a202b", "#181620"],
    art: "noir",
    label: scene.title,
    category: "Adult",
    age: 18,
    contentFlags: ["adult"],
  };
}

/** Resolve one saved StashDB ID on demand without retaining its metadata. */
export async function getStashDbMediaItem(sourceId: string): Promise<MediaItem> {
  if (!sourceId || sourceId.length > 160 || !/^[A-Za-z0-9_-]+$/.test(sourceId)) throw new StashDbMissingSceneError();
  const apiKey = await getApiKey();
  const response = await graphql<FindSceneResponse>(findQuery, { id: sourceId }, apiKey);
  const scene = response.findScene;
  if (!scene) throw new StashDbMissingSceneError();
  const normalized = normalizeScene(scene);
  if (!normalized || normalized.sourceId !== sourceId) throw new StashDbMissingSceneError();
  return stashDbMediaItem(normalized);
}

export async function getStashDbRecommendationMetadata(sourceId: string) {
  if (!sourceId || sourceId.length > 160 || !/^[A-Za-z0-9_-]+$/.test(sourceId)) throw new StashDbMissingSceneError();
  const apiKey = await getApiKey();
  const response = await graphql<FindSceneResponse>(findQuery, { id: sourceId }, apiKey);
  const scene = response.findScene;
  const normalized = scene ? normalizeScene(scene) : null;
  if (!scene || !normalized || normalized.sourceId !== sourceId) throw new StashDbMissingSceneError();
  return {
    featureKeys: recommendationFeatureKeys({ genres: normalized.genres, year: normalized.year, type: "Scene" }),
    retrievalTags: Object.fromEntries((scene.tags ?? []).flatMap(tag => {
      const id = stringValue(tag.id), name = stringValue(tag.name).toLowerCase().replace(/\s+/g, " ");
      return id && name ? [[`genre:${name}`, id]] : [];
    })),
  };
}

export async function getStashDbRecommendationFeatures(sourceId: string) {
  return (await getStashDbRecommendationMetadata(sourceId)).featureKeys;
}
