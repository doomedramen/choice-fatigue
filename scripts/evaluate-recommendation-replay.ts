import "dotenv/config";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { MediaItem } from "../src/data";
import { decryptMetadataProviderConfig } from "../src/lib/integrations/crypto";
import { replayMetadataPlan, replayRecommendationEvents, summarizeMetadataCoverage } from "../src/lib/recommendation-evaluation";
import { isValidRecommendationEvent, type RecommendationEventInput } from "../src/lib/recommendation-event-validation";
import { creditFeatureKeys } from "../src/lib/credit-features";
import { requestProviderJson } from "../src/lib/providers/request";

type Category = "Movies" | "Shows" | "Adult";
type ProviderReference = { provider: "tmdb"; mediaType: "movie" | "tv"; id: number } | { provider: "theporndb"; kind: "scene" | "movie"; id: string } | { provider: "stashdb"; id: string };
type FeatureMetadata = { genres: string[]; year?: number; type: string; creditKeys?: string[] };

const maxIds = 500;
const concurrency = 4;

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
  const source = new URL(url).host;
  return requestProviderJson<T>(source, url, { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
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
    const record = await requestJson<Record<string, unknown>>(`${endpoint}/${reference.mediaType}/${reference.id}?language=en-US&append_to_response=${reference.mediaType === "tv" ? "aggregate_credits" : "credits"}`, { Authorization: `Bearer ${apiKey}`, accept: "application/json" });
    if (record.id !== reference.id || record.adult === true || !text(reference.mediaType === "movie" ? record.title : record.name)) return null;
    const genres = Array.isArray(record.genres) ? record.genres.map(item => item && typeof item === "object" ? text((item as { name?: unknown }).name) : "").filter(Boolean) : [];
    return { genres, year: year(reference.mediaType === "movie" ? record.release_date : record.first_air_date), type: reference.mediaType === "movie" ? "Movie" : "Series", ...(record[reference.mediaType === "movie" ? "credits" : "aggregate_credits"] ? { creditKeys: creditFeatureKeys(record, reference.mediaType) } : {}) };
  }
  if (reference.provider === "theporndb") {
    const apiKey = keys.get("theporndb");
    if (!apiKey) return null;
    const endpoint = baseUrl("THEPORNDB_API_BASE_URL", "https://api.theporndb.net").replace(/\/$/, "");
    const collection = reference.kind === "scene" ? "scenes" : "movies";
    const payload = await requestJson<{ data?: Record<string, unknown> | Array<Record<string, unknown>> }>(`${endpoint}/${collection}/${encodeURIComponent(reference.id)}`, { Authorization: `Bearer ${apiKey}`, accept: "application/json" });
    const record = Array.isArray(payload.data) ? payload.data[0] : payload.data;
    if (!record || text(record._id ?? record.id) !== reference.id || !text(record.title)) return null;
    return { genres: tags(record.tags), year: typeof record.year === "number" && Number.isInteger(record.year) && record.year >= 1880 && record.year <= 2200 ? record.year : year(record.date), type: reference.kind === "movie" ? "Movie" : "Scene" };
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

async function loadTransientMetadata(rows: RecommendationEventInput[], adultAllowed: boolean) {
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.INTEGRATION_CREDENTIALS_KEY;
  if (!databaseUrl || !encryptionKey) return { items: new Map<string, MediaItem>(), eligible: 0, requested: 0, resolved: 0, sessionsWithLabels: 0, sessionsCovered: 0, error: "Set DATABASE_URL and INTEGRATION_CREDENTIALS_KEY to compare ranking policies." };
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const [credentials, globalSettings] = await Promise.all([
      prisma.metadataProviderCredential.findMany({ where: { enabled: true } }),
      prisma.globalSettings.findUnique({ where: { id: "global" }, select: { adultSectionEnabled: true } }),
    ]);
    const keys = new Map<string, string>();
    for (const row of credentials) {
      if (row.provider !== "tmdb" && row.provider !== "theporndb" && row.provider !== "stashdb") continue;
      if (row.provider !== "tmdb" && (!adultAllowed || !globalSettings?.adultSectionEnabled)) continue;
      try {
        const config = decryptMetadataProviderConfig(row.encryptedConfig, row.provider, encryptionKey);
        if (config.apiKey) keys.set(row.provider, config.apiKey);
      } catch { /* A provider with an unreadable key is counted as unresolved. */ }
    }
    const isEligible = (id: string) => { const reference = providerReference(id); return Boolean(reference && keys.has(reference.provider)); };
    const eligibleIds = [...new Set(rows.flatMap(row => [...(row.itemId ? [row.itemId] : []), ...(row.candidateIds ?? [])]))].filter(isEligible);
    // Spend the lookup budget on whole sessions rather than on whichever IDs appear first.
    const plan = replayMetadataPlan(rows, isEligible, maxIds);
    const uniqueIds = plan.ids;
    const items = new Map<string, MediaItem>();
    for (let index = 0; index < uniqueIds.length; index += concurrency) {
      const batch = uniqueIds.slice(index, index + concurrency);
      const resolved = await Promise.all(batch.map(async id => {
        try {
          const feature = await fetchFeatureMetadata(id, keys);
          if (!feature) return null;
          const category: Category = id.startsWith("tmdb-movie-") ? "Movies" : id.startsWith("tmdb-tv-") ? "Shows" : "Adult";
          const item: MediaItem & { creditKeys?: string[] } = {
            id, title: id, type: feature.type, runtime: "—", rating: "—", genre: feature.genres, synopsis: "",
            palette: ["#344255", "#263244", "#151d2c"], art: "mist", label: id, category,
            ...(feature.year ? { year: feature.year } : {}),
            ...(feature.creditKeys ? { creditKeys: feature.creditKeys } : {}),
          };
          return [id, item] as const;
        } catch { return null; }
      }));
      for (const entry of resolved) if (entry) items.set(entry[0], entry[1]);
    }
    return { items, eligible: eligibleIds.length, requested: uniqueIds.length, resolved: items.size, sessionsWithLabels: plan.sessionsWithLabels, sessionsCovered: plan.sessionsCovered, error: undefined };
  } finally { await prisma.$disconnect(); }
}

async function main() {
  const file = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
  if (!file) throw new Error("Usage: pnpm eval:replay -- account-export.json");
  const parsed = JSON.parse(await readFile(file, "utf8")) as { account?: { adultAllowed?: boolean }; recommendationHistory?: unknown };
  if (!Array.isArray(parsed.recommendationHistory)) throw new Error("Input must be a Choice Fatigue account export with recommendationHistory.");
  const eventKeys = ["id", "sessionId", "reviewId", "sequence", "itemId", "candidateIds", "category", "eventType", "decision", "rating", "targetEventId", "algorithmVersion", "occurredAt", "retrievalId", "source", "lane", "provenance"];
  const rows = parsed.recommendationHistory.map(row => row && typeof row === "object" ? Object.fromEntries(eventKeys.map(key => [key, (row as Record<string, unknown>)[key]])) : row).filter(isValidRecommendationEvent);
  if (rows.length !== parsed.recommendationHistory.length) throw new Error("Replay requires valid content-v3 through content-v7 events.");
  const metadata = await loadTransientMetadata(rows, parsed.account?.adultAllowed === true);
  const reports = replayRecommendationEvents(rows, metadata.items);
  const metadataCoverage = { ...summarizeMetadataCoverage(metadata.eligible, metadata.requested, metadata.resolved), sessionsWithLabels: metadata.sessionsWithLabels, sessionsCovered: metadata.sessionsCovered, error: metadata.error ?? null };
  process.stdout.write(`${JSON.stringify({ method: "chronological per-impression comparison on matched candidates using current metadata; whole sessions sampled within the lookup budget; list metrics favour the logging policy, so read shownCardAuc and the paired ranker-minus-baseline intervals first; observational, not causal; lane yield is descriptive", metadataPolicy: "fetched transiently at evaluation time and not written to disk or database", metadataCoverage, categories: reports }, null, 2)}\n`);
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Replay evaluation failed."); process.exitCode = 1; });
