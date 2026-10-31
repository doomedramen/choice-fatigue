"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { categories, type Category, type MediaItem } from "@/data";
import { signOut } from "@/lib/auth-client";
import { rankSessionRecommendations, recommendationSignalsFromHistory, type RecommendationComparison, type RecommendationSignal } from "@/lib/recommendations";
import { mergeDiscoveryState } from "@/lib/discovery-state-merge";
import { createClientUuid } from "@/lib/client-uuid";
import type { CategoryFeedStatus } from "@/lib/catalogue";

type Decision = "keep" | "pass" | "seen";
type TmdbCategory = "Movies" | "Shows";
type DiscoveryPageState = Record<TmdbCategory, { hasMore: boolean; loading: boolean; error: string }>;
interface SessionState {
  sessionId: string;
  eventSequence: number;
  reviewId: string | null;
  category: Category;
  lockedItemId: string | null;
  decisions: Record<string, Decision>;
  ratings: Record<string, number>;
  shortlisted: string[];
  saved: string[];
  history: Array<{ id: string; decision: Decision; rating?: number; eventId?: string }>;
  reviewRemoved: string[];
  view: "discover" | "review";
  ageVerified: boolean;
}
type LearningEvent = { id: string; sessionId: string; reviewId: string | null; sequence: number; itemId: string | null; candidateIds?: string[] | null; category: Category; eventType: string; decision: Decision | null; rating: number | null; targetEventId: string | null; algorithmVersion: "content-v2" };
const initialState = (): SessionState => ({ sessionId:"", eventSequence:0, reviewId:null, category:"Movies", lockedItemId:null, decisions:{}, ratings:{}, shortlisted:[], saved:[], history:[], reviewRemoved:[], view:"discover", ageVerified:false });
const seerrAvailabilityLabels: Record<string, string> = {
  "not-listed": "No matching result in Seerr",
  "not-requested": "Not requested",
  unknown: "Seerr status unknown",
  pending: "Request pending",
  processing: "Being added",
  "partially-available": "Partly available",
  available: "Available in your library",
  deleted: "Removed from Seerr",
};
const seerrTrackedStatuses = new Set(["pending", "processing", "partially-available", "available"]);

type IconName = "spark"|"back"|"close"|"left"|"right"|"check"|"bookmark"|"arrow"|"info"|"rewind"|"lock"|"eye";
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    spark:<><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/></>,
    back:<><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></>,
    close:<path d="m18 6-12 12M6 6l12 12"/>,
    left:<path d="m15 18-6-6 6-6"/>,
    right:<path d="m9 18 6-6-6-6"/>,
    check:<path d="m5 12 4 4L19 6"/>,
    bookmark:<path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-3.6L6 21V4.8Z"/>,
    arrow:<path d="M5 12h14M13 6l6 6-6 6"/>,
    info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
    rewind:<><path d="M3 7v5h5"/><path d="M4.5 16a8 8 0 1 0 .4-8.3L3 12"/></>,
    lock:<><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/></>,
    eye:<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Poster({ item, className="", loading="lazy" }: { item: MediaItem; className?: string; loading?: "eager" | "lazy" }) {
  const style = { "--p1":item.palette[0], "--p2":item.palette[1], "--p3":item.palette[2] } as CSSProperties;
  return <div className={`poster art-${item.art} ${item.artworkUrl?"has-artwork":""} ${className}`} style={style}>
    {item.artworkUrl&&<img className="poster-artwork" src={item.artworkUrl} alt="" loading={loading} draggable={false} referrerPolicy="no-referrer"/>}<div className="poster-grain"/><div className="poster-mark" aria-hidden="true"/>
    <div className="poster-copy"><span className="poster-kicker">{item.category === "Adult" ? "AFTER DARK · 18+" : item.type.toUpperCase()}</span><strong>{item.title}</strong><small>{item.label}</small></div>
    <span className="poster-year">{item.year}</span>
  </div>;
}

function unavailableSavedItem(id: string): MediaItem {
  const category: Category = id.startsWith("tmdb-movie-") ? "Movies" : id.startsWith("tmdb-tv-") ? "Shows" : "Adult";
  return {
    id, title: "Title details unavailable", type: "Saved title", runtime: "—", rating: "—", genre: [],
    synopsis: `The provider could not return details right now. This saved provider ID is still safe in your account: ${id}`,
    palette: ["#344255", "#263244", "#151d2c"], art: "mist", label: "Saved provider ID", category,
  };
}

function DetailsBackdrop({ item }: { item: MediaItem }) {
  const [failedSource, setFailedSource] = useState("");
  const source = item.backdropUrl && item.backdropUrl !== failedSource
    ? item.backdropUrl
    : item.artworkUrl && item.artworkUrl !== failedSource
      ? item.artworkUrl
      : undefined;
  const style = { "--p1":item.palette[0], "--p2":item.palette[1], "--p3":item.palette[2] } as CSSProperties;

  return <div className="modal-backdrop-art" style={style} aria-hidden="true">
    {source && <img
      className={source === item.backdropUrl ? "" : "poster-fallback"}
      src={source}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailedSource(source)}
    />}
  </div>;
}

interface DiscoveryClientProps {
  appName: string;
  userName: string;
  userId: string;
  isAdmin: boolean;
  adultSectionEnabled: boolean;
  mediaItems: MediaItem[];
  catalogueNotice: string;
  categoryOutcomes: Record<Category, CategoryFeedStatus>;
  seerrConnections: Array<{ id: string; name: string }>;
  plexConnections: Array<{ id: string; name: string }>;
}

export default function DiscoveryClient({ appName, userName, userId, isAdmin, adultSectionEnabled, mediaItems, catalogueNotice, categoryOutcomes, seerrConnections, plexConnections }: DiscoveryClientProps) {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>(initialState);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "error">("saving");
  const [details, setDetails] = useState<MediaItem|null>(null);
  const [ratingSelectorOpen, setRatingSelectorOpen] = useState(false);
  const [ageOpen, setAgeOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [resolvedSavedItems, setResolvedSavedItems] = useState<Record<string, MediaItem>>({});
  const [catalogueItems, setCatalogueItems] = useState(mediaItems);
  const [discoveryPages, setDiscoveryPages] = useState<DiscoveryPageState>(() => ({
    Movies: { hasMore: categoryOutcomes.Movies.outcome === "ready", loading: false, error: "" },
    Shows: { hasMore: categoryOutcomes.Shows.outcome === "ready", loading: false, error: "" },
  }));
  const nextDiscoveryPage = useRef<Record<TmdbCategory, number>>({ Movies: 3, Shows: 3 });
  const discoveryPagesInFlight = useRef(new Set<TmdbCategory>());
  const resolvingSavedIds = useRef(new Set<string>());
  const [selectedSeerrId, setSelectedSeerrId] = useState(seerrConnections[0]?.id ?? "");
  const [selectedPlexId, setSelectedPlexId] = useState(plexConnections[0]?.id ?? "");
  const [requestingKey, setRequestingKey] = useState("");
  const [requestMessages, setRequestMessages] = useState<Record<string, string>>({});
  const [availabilityCheckingKey, setAvailabilityCheckingKey] = useState("");
  const [availabilityResults, setAvailabilityResults] = useState<Record<string, { status: string | null; message: string; ok: boolean }>>({});
  const [plexAvailabilityCheckingKey, setPlexAvailabilityCheckingKey] = useState("");
  const [plexAvailabilityResults, setPlexAvailabilityResults] = useState<Record<string, { inLibrary: boolean; message: string }>>({});
  const [notice, setNotice] = useState("");
  const [cardExiting, setCardExiting] = useState(false);
  const drag = useRef<{ x:number }|null>(null);
  const swipeExit = useRef(false);
  const mediaCard = useRef<HTMLElement|null>(null);
  const ratingInput = useRef<HTMLInputElement|null>(null);
  const seenButton = useRef<HTMLButtonElement|null>(null);
  const shownItemKey = useRef("");
  const accountMenu = useRef<HTMLDetailsElement|null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveVersion = useRef(0);
  const stateRevision = useRef(0);
  const serverBaseState = useRef<SessionState | null>(null);
  const learningQueue = useRef<LearningEvent[]>([]);
  const learningWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const learningSequence = useRef(0);
  const [historicalProfile, setHistoricalProfile] = useState<{ category: Category; sessionId: string; signals: RecommendationSignal[]; comparisons: RecommendationComparison[]; consideredIds: string[] }>({ category: "Movies", sessionId: "", signals: [], comparisons: [], consideredIds: [] });
  const activeRecommendationContext = useRef({ category: session.category, sessionId: session.sessionId });
  activeRecommendationContext.current = { category: session.category, sessionId: session.sessionId };
  const catalogue = catalogueItems.filter(item => adultSectionEnabled || item.category !== "Adult");
  const categoryItems = catalogue.filter(item => item.category === session.category);
  const categoryItemSignature = categoryItems.map(item => item.id).join(",");
  const historicalSignals = historicalProfile.category === session.category && historicalProfile.sessionId === session.sessionId ? historicalProfile.signals : [];
  const historicalComparisons = historicalProfile.category === session.category && historicalProfile.sessionId === session.sessionId ? historicalProfile.comparisons : [];
  const historicalConsideredIds = historicalProfile.category === session.category && historicalProfile.sessionId === session.sessionId ? historicalProfile.consideredIds : [];
  const savedIds = new Set(session.saved);
  const recommendationSignals = [
    ...historicalSignals.filter(signal => !(signal.weight === 1.5 && savedIds.has(signal.itemId))),
    ...[...savedIds].map(itemId => ({ itemId, decision: "keep" as const, weight: 1.5 })),
  ];
  const recommendations = rankSessionRecommendations(categoryItems, session.decisions, session.ratings, recommendationSignals, historicalComparisons);
  const items = recommendations.items;
  const queuedConsideredIds = recommendationSignalsFromHistory(learningQueue.current, null, session.category).map(signal => signal.itemId);
  const previouslyConsideredIds = new Set([...historicalSignals.map(signal => signal.itemId), ...historicalConsideredIds, ...queuedConsideredIds]);
  const remainingItems = items.filter(candidate => !session.decisions[candidate.id] && !previouslyConsideredIds.has(candidate.id));
  const item = remainingItems.find(candidate => candidate.id === session.lockedItemId) ?? remainingItems[0];
  const nextItem = remainingItems.find(candidate => candidate.id !== item?.id);
  const picks = session.shortlisted.map(id => catalogue.find(candidate => candidate.id === id) ?? resolvedSavedItems[id] ?? unavailableSavedItem(id));
  const removed = session.reviewRemoved.map(id => catalogue.find(candidate => candidate.id === id) ?? resolvedSavedItems[id] ?? unavailableSavedItem(id));
  const saved = session.saved.map(id => catalogue.find(candidate => candidate.id === id) ?? resolvedSavedItems[id] ?? unavailableSavedItem(id));
  const seenCount = categoryItems.length - categoryItems.filter(candidate => !session.decisions[candidate.id]).length;

  useEffect(() => setCatalogueItems(mediaItems), [mediaItems]);

  async function loadMoreDiscoveries(category: TmdbCategory) {
    if (discoveryPagesInFlight.current.has(category) || !discoveryPages[category].hasMore) return;
    discoveryPagesInFlight.current.add(category);
    setDiscoveryPages(current => ({ ...current, [category]: { ...current[category], loading: true, error: "" } }));
    const page = nextDiscoveryPage.current[category];
    try {
      const response = await fetch(`/api/discovery-feed?category=${category}&page=${page}`, { cache: "no-store" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const result = await response.json() as { items?: MediaItem[]; hasMore?: boolean; error?: string };
      if (!response.ok || !Array.isArray(result.items) || typeof result.hasMore !== "boolean") throw new Error(result.error || "More titles could not be loaded.");
      nextDiscoveryPage.current[category] = page + 1;
      setCatalogueItems(current => {
        const knownIds = new Set(current.map(candidate => candidate.id));
        const additions = result.items!.filter(candidate => {
          if (candidate.category !== category || knownIds.has(candidate.id)) return false;
          knownIds.add(candidate.id);
          return true;
        });
        return [...current, ...additions];
      });
      setDiscoveryPages(current => ({ ...current, [category]: { ...current[category], hasMore: result.hasMore === true } }));
    } catch (error) {
      setDiscoveryPages(current => ({ ...current, [category]: { ...current[category], error: error instanceof Error ? error.message : "More titles could not be loaded." } }));
    } finally {
      discoveryPagesInFlight.current.delete(category);
      setDiscoveryPages(current => ({ ...current, [category]: { ...current[category], loading: false } }));
    }
  }

  useEffect(() => {
    const category = session.category;
    if ((category === "Movies" || category === "Shows") && session.view === "discover" && remainingItems.length <= 5 && discoveryPages[category].hasMore && !discoveryPages[category].loading && !discoveryPages[category].error) {
      void loadMoreDiscoveries(category);
    }
  }, [session.category, session.view, remainingItems.length, discoveryPages]);

  useEffect(() => {
    let cancelled = false;
    async function loadState() {
      setLoadError("");
      try {
        const response = await fetch("/api/discovery-state", { cache: "no-store" });
        if (response.status === 401) { window.location.replace("/sign-in"); return; }
        if (!response.ok) throw new Error("The saved session could not be loaded.");
        const serverStored = await response.json() as Partial<SessionState>;
        const serverLoaded = { ...initialState(), ...serverStored };
        stateRevision.current = Number(response.headers.get("x-discovery-state-revision") ?? 0);
        serverBaseState.current = JSON.parse(JSON.stringify(serverLoaded)) as SessionState;
        let stored: Partial<SessionState> = serverStored;
        let hasLegacyState = false;
        if (response.headers.get("x-discovery-state-exists") === "false") {
          try {
            const legacy = localStorage.getItem("elsewhere-discovery-v1");
            if (legacy) {
              const parsed = JSON.parse(legacy) as Omit<Partial<SessionState>, "category"> & { category?: Category | "TV" | "Anime" };
              const validShape = parsed && ["Movies", "Shows", "TV", "Anime", "Adult"].includes(parsed.category ?? "") && typeof parsed.decisions === "object" && parsed.decisions !== null && Array.isArray(parsed.shortlisted) && Array.isArray(parsed.saved) && Array.isArray(parsed.history) && Array.isArray(parsed.reviewRemoved) && (parsed.view === "discover" || parsed.view === "review") && typeof parsed.ageVerified === "boolean";
              if (validShape) { stored = { ...parsed, category: parsed.category === "Anime" || parsed.category === "TV" ? "Shows" : parsed.category }; hasLegacyState = true; }
            }
          } catch { /* Ignore invalid browser-local data and start clean. */ }
        }
        if (cancelled) return;
        const next = { ...initialState(), ...stored };
        if (!next.sessionId) next.sessionId = createClientUuid();
        if (typeof next.eventSequence !== "number" || next.eventSequence < 0) next.eventSequence = 0;
        if (typeof next.reviewId !== "string") next.reviewId = null;
        learningSequence.current = next.eventSequence;
        if ((next.category as string) === "TV") next.category = "Shows";
        if (!adultSectionEnabled && next.category === "Adult") next.category = "Movies";
        const availableIds = new Set(catalogue.map(candidate => candidate.id));
        if (next.lockedItemId && (!availableIds.has(next.lockedItemId) || next.decisions[next.lockedItemId] || !catalogue.some(candidate => candidate.id === next.lockedItemId && candidate.category === next.category))) next.lockedItemId = null;
        setSession(next);
        if (hasLegacyState) { try { localStorage.setItem("choice-fatigue-legacy-pending", "1"); } catch { /* Continue without browser-local migration bookkeeping. */ } }
        setReady(true);
      } catch {
        if (!cancelled) setLoadError("We couldn’t load your discovery session. Check your connection and try again.");
      }
    }
    void loadState();
    return () => { cancelled = true; };
  }, [adultSectionEnabled, loadAttempt]);

  useEffect(() => {
    if (!ready || !session.sessionId) return;
    async function loadLearningData() {
      const queueKey = `choice-fatigue-learning-${userId}`;
      try {
        const storedQueue = localStorage.getItem(queueKey);
        if (storedQueue) {
          const parsed = JSON.parse(storedQueue) as LearningEvent[];
          if (Array.isArray(parsed)) {
            learningQueue.current = parsed.filter(event => event && typeof event.id === "string" && typeof event.sessionId === "string");
            const currentSessionSequence = learningQueue.current.filter(event => event.sessionId === session.sessionId).reduce((latest, event) => Math.max(latest, event.sequence + 1), 0);
            learningSequence.current = Math.max(learningSequence.current, currentSessionSequence);
          }
        }
      } catch { /* Keep any in-memory queued events when browser storage is unavailable. */ }
      if (learningQueue.current.length) {
        const context = { category: session.category, sessionId: session.sessionId };
        const queuedSignals = recommendationSignalsFromHistory(learningQueue.current, context.sessionId, context.category);
        const queuedConsideredIds = recommendationSignalsFromHistory(learningQueue.current, null, context.category).map(signal => signal.itemId);
        setHistoricalProfile({ ...context, signals: queuedSignals, comparisons: [], consideredIds: queuedConsideredIds });
        await flushLearningQueue();
      }
      await refreshHistoricalProfile();
    }
    void loadLearningData();
  }, [ready, session.sessionId, session.category, userId, adultSectionEnabled]);

  async function persistSnapshot(snapshot: SessionState, version: number) {
    let local = JSON.parse(JSON.stringify(snapshot)) as SessionState;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch("/api/discovery-state", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-discovery-state-revision": String(stateRevision.current) },
        body: JSON.stringify(local),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 409) {
        const conflict = await response.json() as { state?: Partial<SessionState>; revision?: number };
        if (!conflict.state || !Number.isSafeInteger(conflict.revision)) throw new Error("Discovery state conflict could not be recovered.");
        const remote = { ...initialState(), ...conflict.state, ratings: conflict.state.ratings ?? {}, lockedItemId: conflict.state.lockedItemId ?? null };
        const base = serverBaseState.current ?? initialState();
        local = mergeDiscoveryState(base, local, remote);
        serverBaseState.current = remote;
        stateRevision.current = conflict.revision!;
        if (version === saveVersion.current) setSession(local);
        continue;
      }
      if (!response.ok) throw new Error("Discovery state save failed.");
      stateRevision.current = Number(response.headers.get("x-discovery-state-revision") ?? stateRevision.current + 1);
      serverBaseState.current = JSON.parse(JSON.stringify(local)) as SessionState;
      try {
        if (localStorage.getItem("choice-fatigue-legacy-pending") === "1") {
          localStorage.removeItem("elsewhere-discovery-v1");
          localStorage.removeItem("choice-fatigue-legacy-pending");
        }
      } catch { /* Browser storage is optional once the server copy is saved. */ }
      if (version === saveVersion.current) setSaveStatus("saved");
      return;
    }
    throw new Error("Discovery state kept changing in another tab. Try again.");
  }

  function flushLearningQueue() {
    learningWriteQueue.current = learningWriteQueue.current.catch(() => undefined).then(async () => {
      const batch = learningQueue.current.filter(event => adultSectionEnabled || event.category !== "Adult").slice(0, 500);
      if (!batch.length) return;
      const response = await fetch("/api/recommendation-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
      });
      if (!response.ok) return;
      const data = await response.json() as { acceptedIds?: string[] };
      const accepted = new Set(data.acceptedIds ?? []);
      learningQueue.current = learningQueue.current.filter(event => !accepted.has(event.id));
      try { localStorage.setItem(`choice-fatigue-learning-${userId}`, JSON.stringify(learningQueue.current)); } catch { /* Event delivery is already confirmed by the server. */ }
    }).catch(() => undefined);
    return learningWriteQueue.current;
  }

  async function refreshHistoricalProfile() {
    const context = { ...activeRecommendationContext.current };
    if (!context.sessionId) return;
    try {
      const query = new URLSearchParams({ category: context.category, excludeSessionId: context.sessionId });
      for (const candidate of catalogue.filter(item => item.category === context.category).slice(0, 100)) query.append("candidateId", candidate.id);
      const response = await fetch(`/api/recommendation-events?${query}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { signals?: RecommendationSignal[]; comparisons?: RecommendationComparison[]; consideredIds?: string[] };
      const current = activeRecommendationContext.current;
      if (current.category === context.category && current.sessionId === context.sessionId) {
        const savedSignals = Array.isArray(data.signals) ? data.signals : [];
        const queuedSignals = recommendationSignalsFromHistory(learningQueue.current, context.sessionId, context.category);
        const queuedConsideredIds = recommendationSignalsFromHistory(learningQueue.current, null, context.category).map(signal => signal.itemId);
        setHistoricalProfile({
          ...context,
          signals: [...savedSignals, ...queuedSignals],
          comparisons: Array.isArray(data.comparisons) ? data.comparisons : [],
          consideredIds: [...new Set([...(Array.isArray(data.consideredIds) ? data.consideredIds : []), ...queuedConsideredIds])],
        });
      }
    } catch { /* Discovery continues with the current session's signals. */ }
  }

  function enqueueLearningEvent(eventType: LearningEvent["eventType"], itemId: string | null, category: Category, decision: Decision | null = null, rating: number | null = null, targetEventId: string | null = null, reviewId = session.reviewId, candidateIds: string[] | null = null) {
    const event: LearningEvent = {
      id: createClientUuid(), sessionId: session.sessionId, reviewId, sequence: learningSequence.current++, itemId, candidateIds, category,
      eventType, decision, rating, targetEventId, algorithmVersion: "content-v2",
    };
    learningQueue.current = [...learningQueue.current, event];
    try { localStorage.setItem(`choice-fatigue-learning-${userId}`, JSON.stringify(learningQueue.current)); } catch { /* The server write below is still attempted. */ }
    setSession(current => ({ ...current, eventSequence: Math.max(current.eventSequence, event.sequence + 1) }));
    void flushLearningQueue();
    return event;
  }

  useEffect(() => {
    if (!ready) return;
    setSaveStatus("saving");
    const version = ++saveVersion.current;
    const snapshot = JSON.parse(JSON.stringify(session)) as SessionState;
    const timer = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.catch(() => undefined).then(() => persistSnapshot(snapshot, version))
        .catch(() => { if (version === saveVersion.current) setSaveStatus("error"); });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [ready, session]);

  const idsToResolve = [...new Set([...session.saved, ...session.shortlisted, ...(session.view === "review" ? session.reviewRemoved : [])])];
  const savedLookupKey = JSON.stringify(idsToResolve.filter(id => !catalogue.some(candidate => candidate.id === id) && !resolvedSavedItems[id]));
  useEffect(() => {
    if (!savedOpen && session.view !== "review" && session.shortlisted.length === 0) return;
    let ids: string[];
    try { ids = JSON.parse(savedLookupKey) as string[]; } catch { return; }
    const unresolved = ids.filter(id => !resolvingSavedIds.current.has(id));
    if (!unresolved.length) return;
    unresolved.forEach(id => resolvingSavedIds.current.add(id));
    void fetch("/api/media/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: unresolved.slice(0, 40) }),
    }).then(async response => {
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (!response.ok) return;
      const data = await response.json() as { items?: MediaItem[] };
      const validItems = Array.isArray(data.items) ? data.items.filter(item => item && typeof item.id === "string" && unresolved.includes(item.id)) : [];
      setResolvedSavedItems(current => ({ ...current, ...Object.fromEntries(validItems.map(item => [item.id, item])) }));
    }).catch(() => undefined).finally(() => unresolved.forEach(id => resolvingSavedIds.current.delete(id)));
  }, [savedOpen, session.view, session.shortlisted.length, savedLookupKey]);

  const recordedCandidateSets = useRef(new Set<string>());
  useEffect(() => {
    if (!ready || !session.sessionId || !categoryItems.length) return;
    const key = `${session.sessionId}:${session.category}:${categoryItemSignature}`;
    if (recordedCandidateSets.current.has(key)) return;
    recordedCandidateSets.current.add(key);
    enqueueLearningEvent("candidate_set", null, session.category, null, null, null, null, categoryItems.map(candidate => candidate.id));
  }, [ready, session.sessionId, session.category, categoryItemSignature]);

  useEffect(() => {
    if (!ready || session.view !== "discover" || !item) return;
    const key = `${session.sessionId}:${session.history.length}:${session.shortlisted.length}:${item.id}`;
    if (shownItemKey.current === key) return;
    shownItemKey.current = key;
    enqueueLearningEvent("item_shown", item.id, item.category, null, null, null, null, remainingItems.map(candidate => candidate.id));
  }, [ready, session.view, session.sessionId, item?.id, session.history.length, session.shortlisted.length]);

  useEffect(() => {
    if (ratingSelectorOpen) ratingInput.current?.focus();
  }, [ratingSelectorOpen]);

  useEffect(() => {
    function closeAccountMenu(event: globalThis.PointerEvent) {
      const menu = accountMenu.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
    function closeAccountMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && accountMenu.current?.open) accountMenu.current.open = false;
    }
    document.addEventListener("pointerdown", closeAccountMenu);
    document.addEventListener("keydown", closeAccountMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeAccountMenu);
      document.removeEventListener("keydown", closeAccountMenuOnEscape);
    };
  }, []);

  function showNotice(message:string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2100);
  }
  function categoryForId(id: string): Category {
    return catalogue.find(candidate => candidate.id === id)?.category ?? resolvedSavedItems[id]?.category ?? unavailableSavedItem(id).category;
  }
  function cancelRatingSelector() {
    setRatingSelectorOpen(false);
    window.requestAnimationFrame(() => seenButton.current?.focus());
  }
  async function requestSavedTitle(pick: MediaItem) {
    if (!selectedSeerrId || !pick.requestable || requestingKey || availabilityCheckingKey || plexAvailabilityCheckingKey) return;
    const key = `${selectedSeerrId}:${pick.id}`;
    setRequestingKey(key);
    setRequestMessages(current => ({ ...current, [key]: "" }));
    try {
      const response = await fetch(`/api/integrations/${selectedSeerrId}/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalogueEntryId: pick.id }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const data = await response.json() as { requested?: boolean; alreadyTracked?: boolean; availability?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Seerr could not accept this title.");
      if (data.alreadyTracked && data.availability) {
        const message = seerrAvailabilityLabels[data.availability] ?? "Already tracked in Seerr";
        setAvailabilityResults(current => ({ ...current, [key]: { status: data.availability ?? null, message, ok: true } }));
        return;
      }
      if (data.requested !== true) throw new Error(data.error || "Seerr could not accept this title.");
      setRequestMessages(current => ({ ...current, [key]: "Request sent to Seerr." }));
      setAvailabilityResults(current => ({ ...current, [key]: { status: "pending", message: "Request sent to Seerr.", ok: true } }));
    } catch (cause) {
      setRequestMessages(current => ({ ...current, [key]: cause instanceof Error ? cause.message : "Seerr could not accept this title." }));
    } finally {
      setRequestingKey("");
    }
  }
  async function checkSavedAvailability(pick: MediaItem) {
    if (!selectedSeerrId || !pick.requestable || availabilityCheckingKey || requestingKey || plexAvailabilityCheckingKey) return;
    const key = `${selectedSeerrId}:${pick.id}`;
    setAvailabilityCheckingKey(key);
    setAvailabilityResults(current => ({ ...current, [key]: { status: null, message: "Checking Seerr…", ok: false } }));
    setRequestMessages(current => ({ ...current, [key]: "" }));
    try {
      const response = await fetch(`/api/integrations/${selectedSeerrId}/availability`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalogueEntryId: pick.id }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const data = await response.json() as { availability?: string; error?: string };
      if (!response.ok || typeof data.availability !== "string") throw new Error(data.error || "Seerr availability could not be checked.");
      const availability = data.availability;
      setAvailabilityResults(current => ({ ...current, [key]: { status: availability, message: seerrAvailabilityLabels[availability] ?? "Seerr status unknown", ok: true } }));
    } catch (cause) {
      setAvailabilityResults(current => ({ ...current, [key]: { status: null, message: cause instanceof Error ? cause.message : "Seerr availability could not be checked.", ok: false } }));
    } finally {
      setAvailabilityCheckingKey("");
    }
  }
  async function checkSavedPlexAvailability(pick: MediaItem) {
    if (!selectedPlexId || !pick.requestable || plexAvailabilityCheckingKey || availabilityCheckingKey || requestingKey) return;
    const key = `${selectedPlexId}:${pick.id}`;
    setPlexAvailabilityCheckingKey(key);
    setPlexAvailabilityResults(current => ({ ...current, [key]: { inLibrary: false, message: "Checking Plex…" } }));
    try {
      const response = await fetch(`/api/integrations/${selectedPlexId}/availability`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalogueEntryId: pick.id }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const data = await response.json() as { inLibrary?: boolean; error?: string };
      if (!response.ok || typeof data.inLibrary !== "boolean") throw new Error(data.error || "Plex could not check this title.");
      setPlexAvailabilityResults(current => ({ ...current, [key]: { inLibrary: data.inLibrary === true, message: data.inLibrary ? "In your Plex library" : "Not in your Plex library" } }));
    } catch (cause) {
      setPlexAvailabilityResults(current => ({ ...current, [key]: { inLibrary: false, message: cause instanceof Error ? cause.message : "Plex could not check this title." } }));
    } finally {
      setPlexAvailabilityCheckingKey("");
    }
  }
  function decide(decision:Decision, rating?:number) {
    if (!item) return;
    if (decision === "seen" && (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating))) return;
    const currentItem = item;
    const nextItemId = nextItem?.id ?? null;
    const event = enqueueLearningEvent("decision", currentItem.id, currentItem.category, decision, decision === "seen" ? rating! : null, null, null);
    const historyEntry = decision === "seen" ? {id:currentItem.id, decision, rating:rating!, eventId:event.id} : {id:currentItem.id, decision, eventId:event.id};
    setSession(current => ({
      ...current,
      lockedItemId:nextItemId && !current.decisions[nextItemId] && catalogue.some(candidate => candidate.id === nextItemId && candidate.category === current.category) ? nextItemId : null,
      decisions:{...current.decisions, [currentItem.id]:decision},
      ratings:decision === "seen" ? {...current.ratings, [currentItem.id]:rating!} : current.ratings,
      shortlisted:decision === "keep" ? [...current.shortlisted.filter(id => id !== currentItem.id), currentItem.id] : current.shortlisted,
      history:[...current.history, historyEntry],
    }));
  }
  function transitionDecision(decision:Decision, source:"drag"|"control"="control", rating?:number) {
    if (swipeExit.current || !item) return;
    if (decision === "seen" && (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating))) return;
    setRatingSelectorOpen(false);
    const element=mediaCard.current;
    if (!element) { decide(decision, rating); return; }
    swipeExit.current=true;
    setCardExiting(true);
    element.style.transform=decision === "seen" ? "translateY(-10px) scale(.98)" : `translateX(${decision==="keep"?"105%":"-105%"}) rotate(${decision==="keep"?4:-4}deg)`;
    element.style.opacity="0";
    element.style.pointerEvents="none";
    if (source==="control") element.classList.add("control-exit");
    element.classList.remove("drag-keep","drag-pass");
    const handoffDelay=window.matchMedia("(prefers-reduced-motion: reduce)").matches?0:source==="control"?230:150;
    window.setTimeout(()=>{
      swipeExit.current=false;
      setCardExiting(false);
      decide(decision, rating);
    },handoffDelay);
  }
  function undo() {
    const last = session.history.at(-1);
    if (last?.eventId) enqueueLearningEvent("decision_undone", last.id, categoryForId(last.id), null, null, last.eventId, null);
    setSession(current => {
      if (!last) return current;
      const decisions={...current.decisions}; delete decisions[last.id];
      const ratings={...current.ratings}; delete ratings[last.id];
      const restoredCategory=categoryForId(last.id);
      return {...current, category:restoredCategory, lockedItemId:last.id, view:"discover", decisions, ratings, shortlisted:current.shortlisted.filter(id=>id!==last.id), history:current.history.slice(0,-1)};
    });
    setRatingSelectorOpen(false);
  }
  function changeCategory(category:Category) {
    if (category === "Adult" && !session.ageVerified) { setAgeOpen(true); return; }
    setSession(current=>({...current, category, lockedItemId:category === current.category ? current.lockedItemId : null, view:"discover"})); setDetails(null); setRatingSelectorOpen(false);
  }
  function removePick(id:string) {
    const targetEventId = [...session.history].reverse().find(entry => entry.id === id)?.eventId ?? null;
    enqueueLearningEvent("shortlist_withdrawn", id, categoryForId(id), null, null, targetEventId);
    setSession(current=>{ const decisions={...current.decisions}; delete decisions[id]; return {...current, shortlisted:current.shortlisted.filter(value=>value!==id), decisions}; });
    showNotice("Back in discovery — your first impression still counts.");
  }
  function beginReview() {
    const reviewId = createClientUuid();
    enqueueLearningEvent("review_started", null, session.category, null, null, null, reviewId);
    setSession(current=>({...current, reviewId, reviewRemoved:[], view:"review"}));
  }
  function leaveReview() {
    enqueueLearningEvent("review_abandoned", null, session.category);
    setSession(current=>({...current, reviewId:null, reviewRemoved:[], view:"discover"}));
  }
  function removeFromReview(id:string) {
    const targetEventId = [...session.history].reverse().find(entry => entry.id === id)?.eventId ?? null;
    enqueueLearningEvent("review_removed", id, categoryForId(id), null, null, targetEventId);
    setSession(current=>{ const decisions={...current.decisions}; delete decisions[id]; return {...current, shortlisted:current.shortlisted.filter(value=>value!==id), decisions, reviewRemoved:[...new Set([...current.reviewRemoved,id])]}; });
    showNotice("Removed for now — you can restore it below.");
  }
  function restorePick(id:string) {
    const targetEventId = [...session.history].reverse().find(entry => entry.id === id)?.eventId ?? null;
    enqueueLearningEvent("review_restored", id, categoryForId(id), null, null, targetEventId);
    setSession(current=>({...current, shortlisted:[...new Set([...current.shortlisted,id])], decisions:{...current.decisions,[id]:"keep"}, reviewRemoved:current.reviewRemoved.filter(value=>value!==id)}));
    showNotice("Restored to your shortlist");
  }
  function savePicks() {
    if (!picks.length) return;
    const count=picks.length;
    const visiblePickIds=picks.map(pick=>pick.id);
    for (const pick of picks) {
      enqueueLearningEvent("review_kept", pick.id, pick.category);
      enqueueLearningEvent("saved", pick.id, pick.category);
    }
    setSession(current=>({...current, saved:[...new Set([...current.saved,...visiblePickIds])], shortlisted:current.shortlisted.filter(id=>!visiblePickIds.includes(id)), reviewRemoved:current.reviewRemoved.filter(id=>!visiblePickIds.includes(id)), view:"discover"}));
    setSavedOpen(true); showNotice(`${count} ${count===1?"title":"titles"} saved for later`);
    void flushLearningQueue().then(refreshHistoricalProfile);
  }
  function onCardPointerDown(event:PointerEvent<HTMLElement>) {
    if (swipeExit.current || (event.target as HTMLElement).closest("button, input, label, select, textarea, a")) return;
    if (!mediaCard.current) return;
    drag.current={x:event.clientX}; event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onCardPointerMove(event:PointerEvent<HTMLElement>) {
    const card = mediaCard.current;
    if (!drag.current || !card) return;
    const dx=event.clientX-drag.current.x;
    card.style.transform=`translate(${dx}px,${Math.max(-16,Math.abs(dx)*-.025)}px) rotate(${dx*.035}deg)`;
    card.classList.toggle("drag-keep",dx>20); card.classList.toggle("drag-pass",dx< -20);
  }
  function onCardPointerUp(event:PointerEvent<HTMLElement>) {
    const card = mediaCard.current;
    if (!drag.current || !card) return;
    const dx=event.clientX-drag.current.x; drag.current=null;
    const swipeThreshold=Math.max(80,card.clientWidth*.24);
    if (Math.abs(dx)>swipeThreshold) transitionDecision(dx>0?"keep":"pass","drag");
    else {
      card.style.transform="";
      card.style.opacity="";
      card.classList.remove("drag-keep","drag-pass");
    }
  }

  function onCardPointerCancel() {
    const card = mediaCard.current;
    drag.current=null;
    if (!card) return;
    card.style.transform="";
    card.style.opacity="";
    card.classList.remove("drag-keep","drag-pass");
  }

  function renderMediaCard(candidate: MediaItem, active: boolean) {
    return <article
      key={candidate.id}
      ref={active ? mediaCard : null}
      className={`media-card ${active ? "card-active" : "card-under"}`}
      tabIndex={active ? 0 : -1}
      aria-hidden={active ? undefined : true}
      aria-label={active ? `${candidate.title}, ${candidate.year}. Use left and right arrow keys to pass or shortlist, or mark it seen and rate it.` : undefined}
      onPointerDown={active ? onCardPointerDown : undefined}
      onPointerMove={active ? onCardPointerMove : undefined}
      onPointerUp={active ? onCardPointerUp : undefined}
      onPointerCancel={active ? onCardPointerCancel : undefined}
    >
      <Poster item={candidate} className="card-poster" loading="eager"/>
      <div className="card-content">
          <div className="card-overline"><span>{candidate.type} · {candidate.year}</span><span><Icon name="spark"/> {candidate.rating}</span></div>
          <h2>{candidate.title}</h2>
          <div className="card-footer">
            <div className="tag-row">{candidate.genre.slice(0,2).map(genre=><span key={genre}>{genre}</span>)}<span>{candidate.runtime}</span></div>
            <div className="card-actions">
              {active && (ratingSelectorOpen ? <fieldset className="seen-rating" aria-label={`Rate ${candidate.title}`}>
                <legend className="sr-only">Rate {candidate.title} with 1 to 5 stars to continue.</legend>
                <div className="seen-rating-options">{[1,2,3,4,5].map(stars=><label key={stars}>
                  <input ref={stars===1?ratingInput:undefined} type="radio" name={`seen-rating-${candidate.id}`} value={stars} aria-label={`${stars} star${stars===1?"":"s"}`} onChange={()=>transitionDecision("seen","control",stars)}/>
                  <span aria-hidden="true">★</span>
                </label>)}</div>
                <button className="rating-cancel" type="button" onClick={cancelRatingSelector}>Cancel</button>
              </fieldset> : <button ref={seenButton} className="card-seen-button" type="button" onClick={()=>setRatingSelectorOpen(true)} aria-label={`Seen it: rate ${candidate.title}`}><Icon name="eye"/><span>Seen it</span></button>)}
              {active && <button className="card-details-button" type="button" onClick={()=>{setRatingSelectorOpen(false);setDetails(candidate);}} aria-label={`More about ${candidate.title}`}><Icon name="info"/><span>Details</span></button>}
            </div>
          </div>
        </div>
      {active && <><div className="swipe-stamp stamp-keep">KEEP</div><div className="swipe-stamp stamp-pass">PASS</div></>}
    </article>;
  }

  useEffect(() => {
    function onKeyDown(event:KeyboardEvent) {
      if (event.key === "Escape") { if(ratingSelectorOpen)cancelRatingSelector(); else if(savedOpen)setSavedOpen(false); else if(details)setDetails(null); else if(ageOpen)setAgeOpen(false); return; }
      if (!ready || session.view !== "discover" || details || savedOpen || ageOpen || cardExiting) return;
      if (event.target instanceof HTMLElement && event.target.closest("button, input, select, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); transitionDecision("pass"); }
      if (event.key === "ArrowRight") { event.preventDefault(); transitionDecision("keep"); }
    }
    window.addEventListener("keydown",onKeyDown);
    return ()=>window.removeEventListener("keydown",onKeyDown);
  },[ready,session,details,savedOpen,ageOpen,cardExiting,ratingSelectorOpen]);

  async function handleSignOut() {
    if (ready) {
      try {
        await saveQueue.current.catch(() => undefined);
        await persistSnapshot(session, ++saveVersion.current);
      } catch { /* Keep sign-out available if the network is unavailable. */ }
    }
    await signOut();
    window.location.replace("/sign-in");
  }

  if (!ready) return <div className="shell"><main className="main"><section className="content-area"><div className="empty-state" role={loadError ? "alert" : "status"}>
    <div className="eyebrow"><span className="live-dot"/> YOUR DISCOVERY SESSION</div>
    <h2>{loadError ? "Your session didn’t load." : "Picking up where you left off…"}</h2>
    <p>{loadError || "Loading your saved choices."}</p>
    {loadError && <button className="button button-dark" onClick={() => setLoadAttempt(value => value + 1)}>Try again <Icon name="rewind"/></button>}
  </div></section></main></div>;

  return <div className="shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label={`${appName} home`}><span className="brand-symbol">✳</span><span>{appName.toLowerCase()}</span></a>
      <nav className="category-nav" aria-label="Media categories">{categories.filter(category=>adultSectionEnabled || category!=="Adult").map(category=>{const index=categories.indexOf(category); return <button key={category} className={`nav-item ${session.category===category?"active":""} ${category==="Adult"?"adult-nav":""}`} onClick={()=>changeCategory(category)} aria-pressed={session.category===category}>{category==="Adult"?<><Icon name="lock"/><span>Adult</span></>:<><span className={`nav-dot dot-${index}`}/><span>{category}</span></>}</button>;})}</nav>
      <div className="header-right"><button className="saved-link" onClick={()=>setSavedOpen(true)} aria-label={`Saved ${saved.length}` }><Icon name="bookmark"/><span>Saved</span><b>{saved.length}</b></button><details ref={accountMenu} className="account-menu"><summary className="avatar" title={userName} aria-label={`Account menu for ${userName}`}>{userName.trim().charAt(0).toUpperCase()}</summary><div className="account-dropdown"><strong>{userName}</strong><a href="/account">Account settings</a>{isAdmin&&<a href="/admin?section=services">Service connections</a>}<a href="/credits">About &amp; credits</a>{isAdmin&&<a href="/admin">Admin settings</a>}<button type="button" onClick={handleSignOut}>Sign out</button></div></details></div>
    </header>
    <main className={`main ${session.view==="review"?"review-mode":""}`}>
      <section className="content-area">
        {session.view === "review" ? <div className="review-page">
          <div className="review-head"><button className="back-button" onClick={leaveReview}><Icon name="left"/> Back to exploring</button><div className="eyebrow"><span className="live-dot"/> THE SECOND LOOK</div><h1>Review your<br/><em>shortlist.</em></h1><p>Compare your picks, remove any you’re unsure about, then save the ones you want to keep.</p></div>
          {picks.length ? <>
            <div className="review-bar"><span>{picks.length} {picks.length===1?"contender":"contenders"}</span><span>Remove any titles you don’t want to save</span></div>
            <div className="review-grid">{picks.map(pick=><article className="review-card" key={pick.id}><Poster item={pick} className="review-poster"/><div className="review-card-info"><div className="card-overline"><span>{pick.category.toUpperCase()} · {pick.year}</span><span><Icon name="spark"/> {pick.rating}</span></div><h3>{pick.title}</h3><div className="tag-row">{pick.genre.slice(0,2).map(genre=><span key={genre}>{genre}</span>)}</div><p>{pick.synopsis}</p><button className="remove-review" onClick={()=>removeFromReview(pick.id)}><Icon name="close"/> Remove from shortlist</button></div></article>)}</div>
            {removed.length>0&&<div className="restored-list"><div><strong>Removed for now</strong><span>Changed your mind? Add any title back.</span></div>{removed.map(pick=><div className="restore-row" key={pick.id}><Poster item={pick} className="restore-poster"/><span>{pick.title}</span><button onClick={()=>restorePick(pick.id)}><Icon name="back"/> Restore</button></div>)}</div>}
            <div className="review-actions"><button className="text-button" onClick={leaveReview}><Icon name="left"/> Keep browsing</button><button className="button button-accent" onClick={savePicks}>Save {picks.length} {picks.length===1?"pick":"picks"} <Icon name="arrow"/></button></div>
          </> : removed.length ? <>
            <div className="review-bar"><span>No picks left in your maybe pile</span><span>Your removals are reversible</span></div><div className="restored-list">{removed.map(pick=><div className="restore-row" key={pick.id}><Poster item={pick} className="restore-poster"/><span>{pick.title}</span><button onClick={()=>restorePick(pick.id)}><Icon name="back"/> Restore</button></div>)}</div><div className="review-actions"><button className="text-button" onClick={leaveReview}><Icon name="left"/> Keep browsing</button></div>
          </> : <div className="review-empty"><div className="empty-orbit"><Icon name="spark"/></div><h2>No picks in the maybe pile.</h2><p>Keep browsing and shortlist anything that catches your eye.</p><button className="button button-dark" onClick={leaveReview}>Keep browsing <Icon name="arrow"/></button></div>}
          <div className="review-footnote">You can keep browsing before saving your picks.</div>
        </div> : <div className="discover-layout">
          {catalogueNotice && <p className="catalogue-source-note" role="status">{catalogueNotice}</p>}
          <div className="discover-intro"><h1>{session.category}</h1></div>
          {item ? <div className="deck-wrap"><div className="deck-meta"><span>{String(seenCount+1).padStart(2,"0")} <small>/ {String(items.length).padStart(2,"0")}</small></span></div>
            <div className={`card-stack ${nextItem ? "has-stack" : ""}`} aria-label="Media discovery card">
              {nextItem && <><span className="stack-shadow stack-shadow-one" aria-hidden="true"/><span className="stack-shadow stack-shadow-two" aria-hidden="true"/></>}
              {nextItem && renderMediaCard(nextItem, false)}
              {renderMediaCard(item, true)}
            </div>
            <div className="decision-row"><button className="decision-button pass" onClick={()=>transitionDecision("pass")} disabled={cardExiting} aria-label="Pass, left arrow key"><span><Icon name="left"/></span><small>Pass</small></button><button className="undo-swipe-button" onClick={undo} disabled={!session.history.length || cardExiting} aria-label="Undo last swipe" title="Undo last swipe"><Icon name="rewind"/><small>Undo</small></button><button className="decision-button keep" onClick={()=>transitionDecision("keep")} disabled={cardExiting} aria-label="Shortlist, right arrow key"><small>Shortlist</small><span><Icon name="right"/></span></button></div>
            {(session.category === "Movies" || session.category === "Shows") && discoveryPages[session.category].error && <p className="feed-load-error" role="alert">{discoveryPages[session.category].error} <button className="text-button" onClick={() => void loadMoreDiscoveries(session.category as TmdbCategory)}>Try again</button></p>}
          </div> : <div className="empty-state"><div className="empty-orbit"><Icon name={categoryOutcomes[session.category].outcome === "ready" ? "spark" : "info"}/></div>
            {(session.category === "Movies" || session.category === "Shows") && discoveryPages[session.category].loading ? <><h2>Finding more titles…</h2><p>Your next picks are on the way.</p></> : (session.category === "Movies" || session.category === "Shows") && discoveryPages[session.category].error ? <><h2>More titles couldn’t load.</h2><p>{discoveryPages[session.category].error}</p><button className="button button-dark" onClick={() => void loadMoreDiscoveries(session.category as TmdbCategory)}>Try again <Icon name="rewind"/></button></> : categoryOutcomes[session.category].outcome === "ready" ? <><h2>That’s everything for now.</h2><p>You’ve reached the end of the available {session.category.toLowerCase()} feed.</p><button className="button button-dark" onClick={beginReview}>Review your shortlist <Icon name="arrow"/></button></> : categoryOutcomes[session.category].outcome === "unconfigured" ? <><h2>A metadata source needs setup.</h2><p>{isAdmin ? `Connect the provider for ${session.category.toLowerCase()} in your instance settings to start discovering titles.` : `Ask your instance administrator to configure a metadata source for ${session.category.toLowerCase()}.`}</p>{isAdmin && <a className="button button-dark" href="/admin?section=providers">Configure metadata sources <Icon name="arrow"/></a>}</> : categoryOutcomes[session.category].outcome === "unavailable" ? <><h2>This metadata source is temporarily unavailable.</h2><p>Your saved choices are safe. Try loading this category again in a moment.</p><button className="button button-dark" onClick={() => router.refresh()}>Try again <Icon name="rewind"/></button></> : <><h2>No popular titles are available right now.</h2><p>The provider returned no titles for this category. You can retry to check again.</p><button className="button button-dark" onClick={() => router.refresh()}>Try again <Icon name="rewind"/></button></>}
          </div>}
          {saveStatus === "error" && <p className="sync-error" role="alert">Couldn’t sync your choices. They’ll retry automatically.</p>}
        </div>}
      </section>
      {session.view==="discover"&&<aside className="shortlist-panel"><div className="panel-heading"><div><div className="eyebrow">YOUR SHORTLIST</div><h2>Your shortlist <span>{picks.length}</span></h2></div><button className="undo-button" onClick={undo} aria-label="Undo last choice" disabled={!session.history.length}><Icon name="rewind"/> Undo</button></div><p className="panel-copy">Temporary picks to compare before saving.</p>
        <div className="tray-list">{picks.length?picks.slice(-4).reverse().map(pick=><div className="tray-item" key={pick.id}><Poster item={pick} className="tray-poster"/><div><strong>{pick.title}</strong><small>{pick.year} · {pick.type}</small></div><button onClick={()=>removePick(pick.id)} aria-label={`Remove ${pick.title} from shortlist`}><Icon name="close"/></button></div>):<div className="tray-empty"><div className="tray-spark">✳</div><span>Shortlisted titles<br/>will appear here.</span></div>}</div>
        {picks.length>4&&<div className="more-picks">+ {picks.length-4} more in your shortlist</div>}
        <div className="panel-bottom"><div className="panel-count"><span className="count-dot"/>{picks.length} {picks.length===1?"title":"titles"} in the maybe pile</div><button className="button button-dark review-button" onClick={beginReview} disabled={!picks.length}>Review &amp; compare <Icon name="arrow"/></button></div><div className="privacy-note"><Icon name="spark"/> Synced to your account</div>
      </aside>}
    </main>
    {details&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setDetails(null);}}><section className="details-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={()=>setDetails(null)} aria-label="Close details"><Icon name="close"/></button><DetailsBackdrop key={details.id} item={details}/><div className="modal-info"><div className="eyebrow">{details.category.toUpperCase()} · {details.year} · {details.runtime}</div><h2 id="modal-title">{details.title}</h2><div className="tag-row">{details.genre.map(genre=><span key={genre}>{genre}</span>)}<span>★ {details.rating}</span></div><p>{details.synopsis}</p>{details.age&&<div className="age-note"><Icon name="lock"/> Adults only · 18+</div>}<button className="button button-accent" onClick={()=>{if(item?.id===details.id&&!session.shortlisted.includes(details.id))decide("keep");setDetails(null);showNotice("Added to your maybe pile");}}>Add to shortlist <Icon name="arrow"/></button></div></section></div>}
    {ageOpen&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setAgeOpen(false);}}><section className="age-modal" role="dialog" aria-modal="true" aria-labelledby="age-title"><div className="age-icon"><Icon name="lock"/></div><div className="eyebrow">A PRIVATE SECTION</div><h2 id="age-title">Before you step inside</h2><p>This section is for adults aged 18 and over. It contains mature themes. Artwork in this prototype is non-explicit.</p><div className="age-actions"><button className="button button-quiet" onClick={()=>setAgeOpen(false)}>Not now</button><button className="button button-accent" onClick={()=>{setSession(current=>({...current,ageVerified:true,category:"Adult",lockedItemId:null}));setAgeOpen(false);}}>I’m 18 or older <Icon name="arrow"/></button></div><small>Your choice is remembered on your account.</small></section></div>}
    {savedOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSavedOpen(false); }}>
      <section className="saved-modal" role="dialog" aria-modal="true" aria-labelledby="saved-title">
        <button className="modal-close" onClick={() => setSavedOpen(false)} aria-label="Close saved titles"><Icon name="close" /></button>
        <div className="eyebrow">YOUR KEEPERS · PERMANENTLY SAVED</div>
        <h2 id="saved-title">Saved for later</h2>
        <p>These made it through the second look. Your shortlist stays temporary until you save it here.</p>
        {saved.length > 0 && seerrConnections.length > 0 && <label className="saved-connection-select">Seerr server
          <select value={selectedSeerrId} onChange={event => setSelectedSeerrId(event.target.value)}>{seerrConnections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select>
        </label>}
        {saved.length > 0 && plexConnections.length > 0 && <label className="saved-connection-select">Plex library
          <select value={selectedPlexId} onChange={event => setSelectedPlexId(event.target.value)}>{plexConnections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select>
        </label>}
        {saved.length > 0 && seerrConnections.length === 0 && plexConnections.length === 0 && <p className="saved-connect-prompt">{isAdmin ? <>Configure Seerr to request eligible titles or Plex to check your library. <a href="/admin?section=services">Set up services →</a></> : "Seerr and Plex connections are managed by your instance administrator."}</p>}
        {saved.length ? <div className="saved-grid">{saved.map(pick => {
          const key = `${selectedSeerrId}:${pick.id}`;
          const plexKey = `${selectedPlexId}:${pick.id}`;
          const requestMessage = requestMessages[key];
          const availability = availabilityResults[key];
          const plexAvailability = plexAvailabilityResults[plexKey];
          const message = requestMessage || availability?.message;
          const requestSent = requestMessage?.startsWith("Request sent") === true;
          const tracked = requestSent || (availability?.status ? seerrTrackedStatuses.has(availability.status) : false);
          const messageIsPositive = requestMessage ? requestSent : availability?.ok === true;
          return <div className="saved-item" key={pick.id}>
            <Poster item={pick} className="saved-poster" />
            <div className="saved-item-copy"><strong>{pick.title}</strong><small>{pick.year ?? "Details pending"} · {pick.category}</small>{pick.title === "Title details unavailable" && <small role="status">Your provider ID remains saved. Details will reappear when the source is available.</small>}
              {message && <small className={messageIsPositive ? "request-success" : "request-feedback"} role="status">{message}</small>}
              {plexAvailability && <small className={plexAvailability.inLibrary ? "request-success" : plexAvailability.message.startsWith("Not in your Plex") || plexAvailability.message.startsWith("Checking Plex") ? "request-neutral" : "request-feedback"} role="status">{plexAvailability.message}</small>}
            </div>
            {pick.requestable && (seerrConnections.length > 0 || plexConnections.length > 0) ? <div className="saved-actions">
              {seerrConnections.length > 0 && <>
                <button className="saved-availability-button" type="button" onClick={() => void checkSavedAvailability(pick)} disabled={!selectedSeerrId || availabilityCheckingKey !== "" || requestingKey !== "" || plexAvailabilityCheckingKey !== "" || saveStatus === "saving"} aria-label={`Check ${pick.title} in Seerr`}>{availabilityCheckingKey === key ? "Checking…" : "Seerr check"}</button>
                <button className="saved-request-button" type="button" onClick={() => void requestSavedTitle(pick)} disabled={!selectedSeerrId || requestingKey !== "" || availabilityCheckingKey !== "" || plexAvailabilityCheckingKey !== "" || saveStatus === "saving" || tracked}>{saveStatus === "saving" ? "Syncing…" : requestingKey === key ? "Sending…" : tracked ? "Tracked" : "Request"}</button>
              </>}
              {plexConnections.length > 0 && <button className="saved-availability-button" type="button" onClick={() => void checkSavedPlexAvailability(pick)} disabled={!selectedPlexId || plexAvailabilityCheckingKey !== "" || availabilityCheckingKey !== "" || requestingKey !== "" || saveStatus === "saving"} aria-label={`Check ${pick.title} in Plex`}>{plexAvailabilityCheckingKey === plexKey ? "Checking…" : "Plex check"}</button>}
            </div> : <span className="saved-request-note">{pick.requestable ? "Connect Seerr or Plex" : "TMDB link needed"}</span>}
          </div>;
        })}</div> : <div className="saved-empty">Your saved list is empty. Review a shortlist to keep your favourites here.</div>}
        <button className="button button-dark saved-done" onClick={() => setSavedOpen(false)}>Done</button>
      </section>
    </div>}
    <div className={`toast ${notice?"show":""}`} role="status" aria-live="polite">{notice}</div>
  </div>;
}
