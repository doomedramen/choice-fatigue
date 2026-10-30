import "dotenv/config";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { MediaItem } from "../src/data";
import { decryptMetadataProviderConfig } from "../src/lib/integrations/crypto";
import { recommendationComparisonsFromHistory, recommendationFeatureKeys, recommendationSignalsFromHistory, rankSessionRecommendations } from "../src/lib/recommendations";
import { compareSessionRankings, summarizeMetadataCoverage } from "../src/lib/recommendation-evaluation";

type Category = "Movies" | "Shows" | "Adult";
type Row = {
  id: string;
  sessionId: string;
  reviewId?: string | null;
  sequence: number;
  category: Category;
  eventType: string;
  itemId: string | null;
  decision: string | null;
  rating?: number | null;
  candidateIds?: string[] | null;
  targetEventId?: string | null;
  createdAt?: string | Date;
};
type ProviderReference = { provider: "tmdb"; mediaType: "movie" | "tv"; id: number } | { provider: "theporndb"; kind: "scene" | "movie"; id: string } | { provider: "stashdb"; id: string };
type FeatureMetadata = { genres: string[]; year?: number; type: string };

const maxIds = 500;
const concurrency = 4;

function orderRows(events: Row[]) {
  return [...events].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeA - timeB || a.sequence - b.sequence;
  });
}

function median(values: number[]) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function providerReference(id: string): ProviderReference | null {
  const tmdb = /^tmdb-(movie|tv)-([1-9]\d{0,9})$/.exec(id);
  if (tmdb) return { provider: "tmdb", mediaType: tmdb[1] as "movie" | "tv", id: Number(tmdb[2]) };
  const thePornDb = /^theporndb-(scene|movie)-([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(id);
  if (thePornDb) return { provider: "theporndb", kind: thePornDb[1] as "scene" | "movie", id: thePornDb[2] };
  const stashDb = /^stashdb-([A-Za-z0-9][A-Za-z0-9_-]{0,159})$/.exec(id);
  if (stashDb) return { provider: "stashdb", id: stashDb[1] };
  return null;
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function year(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})/.exec(value);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return parsed >= 1880 && parsed <= 2200 ? parsed : undefined;
}
function tags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(entry => entry && typeof entry === "object" ? text((entry as { name?: unknown }).name) : "").filter(Boolean).slice(0, 20);
}

async function requestJson<T>(url: string, headers: Record<string, string>, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error("Metadata provider request failed.");
    return await response.json() as T;
  } finally { clearTimeout(timeout); }
}

function baseUrl(envName: string, fallback: string) {
  return process.env.NODE_ENV !== "production" ? process.env[envName] || fallback : fallback;
}

async function fetchFeatureMetadata(id: string, keys: Map<string, string>) : Promise<FeatureMetadata | null> {
  const reference = providerReference(id);
  if (!reference) return null;
  if (reference.provider === "tmdb") {
    const apiKey = keys.get("tmdb");
    if (!apiKey) return null;
    const endpoint = baseUrl("TMDB_API_BASE_URL", "https://api.themoviedb.org/3").replace(/\/$/, "");
    const record = await requestJson<Record<string, unknown>>(`${endpoint}/${reference.mediaType}/${reference.id}?language=en-US`, { Authorization: `Bearer ${apiKey}`, accept: "application/json" });
    if (record.id !== reference.id || record.adult === true) return null;
    const genres = Array.isArray(record.genres) ? record.genres.map(item => item && typeof item === "object" ? text((item as { name?: unknown }).name) : "").filter(Boolean) : [];
    return { genres, year: year(reference.mediaType === "movie" ? record.release_date : record.first_air_date), type: reference.mediaType === "movie" ? "Movie" : "Series" };
  }
  if (reference.provider === "theporndb") {
    const apiKey = keys.get("theporndb");
    if (!apiKey) return null;
    const endpoint = baseUrl("THEPORNDB_API_BASE_URL", "https://api.theporndb.net").replace(/\/$/, "");
    const collection = reference.kind === "scene" ? "scenes" : "movies";
    const payload = await requestJson<{ data?: Record<string, unknown> | Array<Record<string, unknown>> }>(`${endpoint}/${collection}/${encodeURIComponent(reference.id)}`, { Authorization: `Bearer ${apiKey}`, accept: "application/json" });
    const record = Array.isArray(payload.data) ? payload.data[0] : payload.data;
    if (!record || text(record._id ?? record.id) !== reference.id || !text(record.title)) return null;
    return { genres: tags(record.tags), year: typeof record.year === "number" ? record.year : year(record.date), type: reference.kind === "movie" ? "Movie" : "Scene" };
  }
  const apiKey = keys.get("stashdb");
  if (!apiKey) return null;
  const endpoint = baseUrl("STASHDB_API_BASE_URL", "https://stashdb.org/graphql");
  const query = `query ReplayFeatureById($id: ID!) { findScene(id: $id) { id title release_date tags { name } } }`;
  const payload = await requestJson<{ data?: { findScene?: { id?: unknown; title?: unknown; release_date?: unknown; tags?: unknown } | null }; errors?: unknown[] }>(endpoint, { ApiKey: apiKey, "content-type": "application/json", accept: "application/json" }, { query, variables: { id: reference.id } });
  const record = payload.data?.findScene;
  if (payload.errors?.length || !record || text(record.id) !== reference.id || !text(record.title)) return null;
  return { genres: tags(record.tags), year: year(record.release_date), type: "Scene" };
}

async function loadTransientMetadata(ids: string[], adultAllowed: boolean) {
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.INTEGRATION_CREDENTIALS_KEY;
  if (!databaseUrl || !encryptionKey) return { items: new Map<string, MediaItem>(), eligible: 0, requested: 0, resolved: 0, error: "Set DATABASE_URL and INTEGRATION_CREDENTIALS_KEY to compare ranking policies." };
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const [rows, globalSettings] = await Promise.all([
      prisma.metadataProviderCredential.findMany({ where: { enabled: true } }),
      prisma.globalSettings.findUnique({ where: { id: "global" }, select: { adultSectionEnabled: true } }),
    ]);
    const keys = new Map<string, string>();
    for (const row of rows) {
      if (row.provider !== "tmdb" && row.provider !== "theporndb" && row.provider !== "stashdb") continue;
      if (row.provider !== "tmdb" && (!adultAllowed || !globalSettings?.adultSectionEnabled)) continue;
      try {
        const config = decryptMetadataProviderConfig(row.encryptedConfig, row.provider, encryptionKey);
        if (config.apiKey) keys.set(row.provider, config.apiKey);
      } catch { /* A provider with an unreadable key is counted as unresolved. */ }
    }
    const eligibleIds = [...new Set(ids)].filter(id => {
      const reference = providerReference(id);
      return Boolean(reference && keys.has(reference.provider));
    });
    const uniqueIds = eligibleIds.slice(0, maxIds);
    const items = new Map<string, MediaItem>();
    for (let index = 0; index < uniqueIds.length; index += concurrency) {
      const batch = uniqueIds.slice(index, index + concurrency);
      const resolved = await Promise.all(batch.map(async id => {
        try {
          const feature = await fetchFeatureMetadata(id, keys);
          if (!feature) return null;
          const category: Category = id.startsWith("tmdb-movie-") ? "Movies" : id.startsWith("tmdb-tv-") ? "Shows" : "Adult";
          const item: MediaItem = {
            id, title: id, type: feature.type, runtime: "—", rating: "—", genre: feature.genres, synopsis: "",
            palette: ["#344255", "#263244", "#151d2c"], art: "mist", label: id, category,
            ...(feature.year ? { year: feature.year } : {}),
          };
          return [id, item] as const;
        } catch { return null; }
      }));
      for (const entry of resolved) if (entry) items.set(entry[0], entry[1]);
    }
    return { items, eligible: eligibleIds.length, requested: uniqueIds.length, resolved: items.size, error: undefined };
  } finally { await prisma.$disconnect(); }
}

function toHistoryEvent(row: Row) {
  return { ...row, reviewId: row.reviewId ?? null, rating: row.rating ?? null, targetEventId: row.targetEventId ?? null };
}

function sessionOutcome(events: Row[], candidateIds: string[]) {
  const ids = new Set(candidateIds);
  const decisionItemByEvent = new Map<string, string>();
  const shortlisted = new Set<string>();
  const saved = new Set<string>();
  for (const event of orderRows(events)) {
    if (event.eventType === "decision" && event.itemId) {
      decisionItemByEvent.set(event.id, event.itemId);
      if (event.decision === "keep") shortlisted.add(event.itemId);
      else shortlisted.delete(event.itemId);
    } else if (["decision_undone", "shortlist_withdrawn", "review_removed"].includes(event.eventType) && event.targetEventId) {
      const affected = decisionItemByEvent.get(event.targetEventId) ?? event.itemId;
      if (affected) shortlisted.delete(affected);
    } else if (event.eventType === "review_restored" && event.itemId) shortlisted.add(event.itemId);
    else if (event.eventType === "saved" && event.itemId) saved.add(event.itemId);
  }
  return { shortlisted: [...shortlisted].filter(id => ids.has(id)), saved: [...saved].filter(id => ids.has(id)) };
}

async function main() {
  const file = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
  if (!file) throw new Error("Usage: pnpm eval:replay -- account-export.json");
  const parsed = JSON.parse(await readFile(file, "utf8")) as { account?: { adultAllowed?: boolean }; recommendationHistory?: unknown };
  if (!Array.isArray(parsed.recommendationHistory)) throw new Error("Input must be a Choice Fatigue account export with recommendationHistory.");
  const rows = parsed.recommendationHistory.filter((row): row is Row => Boolean(row && typeof row === "object" && ["Movies", "Shows", "Adult"].includes((row as Row).category) && typeof (row as Row).sessionId === "string" && typeof (row as Row).id === "string"));
  const ordered = orderRows(rows);
  const allIds = ordered.flatMap(row => [...(row.itemId ? [row.itemId] : []), ...(row.candidateIds ?? [])]);
  const metadata = await loadTransientMetadata(allIds, parsed.account?.adultAllowed === true);
  const categories: Category[] = ["Movies", "Shows", "Adult"];
  const reports = categories.map(category => {
    const groups = new Map<string, Row[]>();
    for (const row of ordered.filter(row => row.category === category)) groups.set(row.sessionId, [...(groups.get(row.sessionId) ?? []), row]);
    const sessions = [...groups.entries()].map(([sessionId, events]) => ({ sessionId, events: orderRows(events) })).sort((a, b) => {
      const timeA = a.events[0]?.createdAt ? new Date(a.events[0].createdAt!).getTime() : 0;
      const timeB = b.events[0]?.createdAt ? new Date(b.events[0].createdAt!).getTime() : 0;
      return timeA - timeB || a.sessionId.localeCompare(b.sessionId);
    });
    const priorEvents: Row[] = [];
    const comparisons: Array<{ providerOrder: string[]; rankerOrder: string[]; shortlisted: string[]; saved: string[] }> = [];
    let impressions = 0;
    let sessionShortlists = 0;
    let sessionSaves = 0;
    let savesFromShortlist = 0;
    let sessionsWithSave = 0;
    const cardsToFirstSave: number[] = [];
    let candidateSetCount = 0;
    let candidateIdCount = 0;
    let resolvedCandidateIdCount = 0;
    for (const { events } of sessions) {
      const firstCandidateSet = events.find(event => event.eventType === "candidate_set" && Array.isArray(event.candidateIds));
      const providerOrder = firstCandidateSet?.candidateIds ?? [];
      const candidateMedia = providerOrder.map(id => metadata.items.get(id)).filter((item): item is MediaItem => Boolean(item));
      if (providerOrder.length) {
        candidateSetCount += 1;
        candidateIdCount += providerOrder.length;
        resolvedCandidateIdCount += candidateMedia.length;
      }
      const currentIds = new Set(candidateMedia.map(item => item.id));
      const history = priorEvents.map(toHistoryEvent);
      const signals = recommendationSignalsFromHistory(history, null, category).map(signal => {
        const item = metadata.items.get(signal.itemId);
        return item ? { ...signal, featureKeys: recommendationFeatureKeys({ genres: item.genre, year: item.year, type: item.type }) } : signal;
      });
      const historicalComparisons = recommendationComparisonsFromHistory(history, null, category).map(comparison => ({
        ...comparison,
        ...(metadata.items.has(comparison.preferredItemId) ? { preferredFeatureKeys: recommendationFeatureKeys({ genres: metadata.items.get(comparison.preferredItemId)!.genre, year: metadata.items.get(comparison.preferredItemId)!.year, type: metadata.items.get(comparison.preferredItemId)!.type }) } : {}),
        ...(metadata.items.has(comparison.removedItemId) ? { removedFeatureKeys: recommendationFeatureKeys({ genres: metadata.items.get(comparison.removedItemId)!.genre, year: metadata.items.get(comparison.removedItemId)!.year, type: metadata.items.get(comparison.removedItemId)!.type }) } : {}),
      }));
      const rankerOrder = candidateMedia.length
        ? rankSessionRecommendations(candidateMedia, {}, {}, signals, historicalComparisons).items.map(item => item.id)
        : [];
      const labels = sessionOutcome(events, [...currentIds]);
      if (rankerOrder.length) comparisons.push({ providerOrder: candidateMedia.map(item => item.id), rankerOrder, ...labels });
      sessionShortlists += labels.shortlisted.length;
      sessionSaves += labels.saved.length;
      savesFromShortlist += labels.saved.filter(id => labels.shortlisted.includes(id)).length;
      const savedIds = new Set(labels.saved);
      const shown = events.filter(event => event.eventType === "item_shown" && event.itemId);
      impressions += shown.length;
      const firstSavedIndex = shown.findIndex(event => savedIds.has(event.itemId!));
      if (firstSavedIndex >= 0) { sessionsWithSave += 1; cardsToFirstSave.push(firstSavedIndex + 1); }
      priorEvents.push(...events);
    }
    return {
      category,
      descriptive: {
        sessions: sessions.length,
        candidateSets: candidateSetCount,
        candidateIds: candidateIdCount,
        resolvedCandidateIds: resolvedCandidateIdCount,
        candidateMetadataCoverage: candidateIdCount ? Number((resolvedCandidateIdCount / candidateIdCount).toFixed(4)) : null,
        impressions,
        shortlists: sessionShortlists,
        saves: sessionSaves,
        savedAmongShortlistedRate: sessionShortlists ? Number((savesFromShortlist / sessionShortlists).toFixed(4)) : null,
        sessionsWithSave,
        medianObservedCardsToFirstSave: median(cardsToFirstSave),
      },
      initialSessionRankingComparison: compareSessionRankings(comparisons),
    };
  });
  const metadataCoverage = { ...summarizeMetadataCoverage(metadata.eligible, metadata.requested, metadata.resolved), error: metadata.error ?? null };
  process.stdout.write(`${JSON.stringify({ method: "offline initial-session ranking comparison using current provider metadata; observational and not causal", metadataPolicy: "fetched transiently at evaluation time and not written to disk or database", metadataCoverage, categories: reports }, null, 2)}\n`);
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Replay evaluation failed."); process.exitCode = 1; });
