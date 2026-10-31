"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Modal } from "@/app/modal";
import { categories, type Category, type MediaItem } from "@/data";
import { signOut } from "@/lib/auth-client";
import { rankRecommendations, buildRecommendationProfile, mergeRecommendationEvents, recommendationFeatureKeys, shownCandidateIds, type RecommendationFeatures } from "@/lib/recommendations";
import { currentRecommendationAlgorithmVersion, isValidRecommendationEvent, isRelatedProvenance, recommendationEventMaxAgeMs, type RecommendationEventInput, type RejectedRecommendationEvent } from "@/lib/recommendation-event-validation";
import { recommendationEventBatch, settleRecommendationBatch } from "@/lib/recommendation-outbox";
import { mergeDiscoveryState } from "@/lib/discovery-state-merge";
import { createClientUuid } from "@/lib/client-uuid";
import { deduplicateTitles, degradedFeedNotice, feedFailureMessage, feedRetryDelay, type DiscoveryFeed, type CandidateBatch } from "@/lib/discovery-feed";
import type { MediaPerson } from "@/lib/media-people";

type Decision = "keep" | "pass" | "seen";
type DiscoveryPageState = Record<Category, { feed: DiscoveryFeed; loading: boolean; error: string }>;
function discoveryPageState(feed: DiscoveryFeed) {
  return { feed, loading: false, error: feed.status.outcome === "unavailable" ? feedFailureMessage(feed.sources) : "" };
}
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
type LearningEvent = RecommendationEventInput;
type NoticeAction = { label: string; run: () => void };
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
  const [failedSource, setFailedSource] = useState("");
  const source = item.artworkUrl && item.artworkUrl !== failedSource ? item.artworkUrl : undefined;
  const style = { "--p1":item.palette[0], "--p2":item.palette[1], "--p3":item.palette[2] } as CSSProperties;
  return <div className={`poster art-${item.art} ${source?"has-artwork":""} ${className}`} style={style}>
    {source&&<img className="poster-artwork" src={source} alt="" loading={loading} draggable={false} referrerPolicy="no-referrer" onError={() => setFailedSource(source)}/>}<div className="poster-grain"/><div className="poster-mark" aria-hidden="true"/>
    {!source && className.split(/\s+/).includes("card-poster") && <span className="poster-unavailable">Artwork unavailable</span>}
    <div className="poster-copy"><span className="poster-kicker">{item.category === "Adult" ? "AFTER DARK · 18+" : item.type.toUpperCase()}</span><strong>{item.title}</strong><small>{item.label}</small></div>
    <span className="poster-year">{item.year}</span>
  </div>;
}

function displayMetadata(item: MediaItem, includeCategory = false) {
  return [includeCategory ? item.category.toUpperCase() : "", item.year, item.runtime !== "—" ? item.runtime : ""].filter(Boolean).join(" · ");
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

function PersonCard({ person }: { person: MediaPerson }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = person.name.split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] ?? "").join("").toLocaleUpperCase();
  return <li className="person-card">
    <div className="person-portrait">
      {person.imageUrl && !imageFailed ? <img src={person.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)}/> : <span aria-hidden="true">{initials}</span>}
    </div>
    <strong>{person.name}</strong>
    {person.role && <small>{person.role}</small>}
  </li>;
}

function DetailsPeople({ item }: { item: MediaItem }) {
  const [people, setPeople] = useState<MediaPerson[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const label = item.category === "Adult" ? "Performers" : "Cast";
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/media/people?${new URLSearchParams({ id: item.id })}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const result = await response.json() as { people?: MediaPerson[] };
        setPeople(Array.isArray(result.people) ? result.people : []);
        setStatus("ready");
      }).catch(() => { if (!controller.signal.aborted) setStatus("unavailable"); });
    return () => controller.abort();
  }, [item.id]);
  return <section className="details-people" aria-label={label} aria-busy={status === "loading"}>
    <h3>{label}</h3>
    {status === "loading" ? <p className="details-people-status" role="status">Loading {label.toLowerCase()}…</p>
      : status === "unavailable" ? <p className="details-people-status">{label} information isn’t available right now.</p>
      : people.length ? <ul className="people-list">{people.map((person, index) => <PersonCard key={`${person.name}-${index}`} person={person}/>)}</ul>
      : <p className="details-people-status">No {label.toLowerCase()} information available.</p>}
  </section>;
}

interface DiscoveryClientProps {
  appName: string;
  userName: string;
  userId: string;
  isAdmin: boolean;
  integrationsReadOnly: boolean;
  adultSectionEnabled: boolean;
  mediaItems: MediaItem[];
  initialFeeds: Record<Category, DiscoveryFeed>;
  seerrConnections: Array<{ id: string; name: string }>;
  plexConnections: Array<{ id: string; name: string }>;
}

export default function DiscoveryClient({ appName, userName, userId, isAdmin, integrationsReadOnly, adultSectionEnabled, mediaItems, initialFeeds, seerrConnections, plexConnections }: DiscoveryClientProps) {
  const [session, setSession] = useState<SessionState>(initialState);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "error">("saving");
  const [details, setDetails] = useState<MediaItem|null>(null);
  const [ratingSelectorOpen, setRatingSelectorOpen] = useState(false);
  const [ageOpen, setAgeOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [justSaved, setJustSaved] = useState<{ ids: string[]; history: SessionState["history"] } | null>(null);
  useEffect(() => { if (!savedOpen) setJustSaved(null); }, [savedOpen]);
  const [resolvedSavedItems, setResolvedSavedItems] = useState<Record<string, MediaItem>>({});
  const [catalogueItems, setCatalogueItems] = useState(mediaItems);
  const catalogueItemsRef = useRef(mediaItems);
  const [discoveryPages, setDiscoveryPages] = useState<DiscoveryPageState>(() => Object.fromEntries(
    categories.map(category => [category, discoveryPageState(initialFeeds[category])]),
  ) as DiscoveryPageState);
  const discoveryPagesInFlight = useRef(new Set<Category>());
  const refreshGeneration = useRef<Record<Category, number>>({ Movies: 0, Shows: 0, Adult: 0 });
  const refreshedGeneration = useRef<Record<Category, number>>({ Movies: 0, Shows: 0, Adult: 0 });
  const [refreshRevision, setRefreshRevision] = useState(0);
  const feedCursors = useRef<Record<Category, string | null>>({ Movies: initialFeeds.Movies.cursor, Shows: initialFeeds.Shows.cursor, Adult: initialFeeds.Adult.cursor });
  const resolvingSavedIds = useRef(new Set<string>());
  const [selectedSeerrId, setSelectedSeerrId] = useState(seerrConnections[0]?.id ?? "");
  const [selectedPlexId, setSelectedPlexId] = useState(plexConnections[0]?.id ?? "");
  const [requestingKey, setRequestingKey] = useState("");
  const [requestMessages, setRequestMessages] = useState<Record<string, string>>({});
  const [availabilityCheckingKey, setAvailabilityCheckingKey] = useState("");
  const [availabilityResults, setAvailabilityResults] = useState<Record<string, { status: string | null; message: string; ok: boolean }>>({});
  const [plexAvailabilityCheckingKey, setPlexAvailabilityCheckingKey] = useState("");
  const [plexAvailabilityResults, setPlexAvailabilityResults] = useState<Record<string, { inLibrary: boolean; message: string }>>({});
  const [notice, setNotice] = useState<{ message: string; action?: NoticeAction } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const refocusCard = useRef(false);
  const noticeTimer = useRef<number | null>(null);
  const [cardExiting, setCardExiting] = useState(false);
  // The swipe hint shows until this account's first decision in this browser.
  const swipeHintKey = `choice-fatigue-swipe-hint-${userId}`;
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  useEffect(() => {
    try { setShowSwipeHint(localStorage.getItem(swipeHintKey) !== "dismissed"); } catch { setShowSwipeHint(true); }
  }, [swipeHintKey]);
  function dismissSwipeHint() {
    if (!showSwipeHint) return;
    setShowSwipeHint(false);
    try { localStorage.setItem(swipeHintKey, "dismissed"); } catch { /* The hint simply returns next visit. */ }
  }
  const drag = useRef<{ x:number; y:number }|null>(null);
  const lockedNextItemId = useRef<string | null>(null);
  const swipeExit = useRef(false);
  const dragFrame = useRef<number | null>(null);
  const dragOffset = useRef(0);
  const mediaCard = useRef<HTMLElement|null>(null);
  const ratingInput = useRef<HTMLButtonElement|null>(null);
  const windowKeyHandler = useRef<(event:KeyboardEvent) => void>(() => undefined);
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
  const runId = useRef("");
  const [learningEvents, setLearningEvents] = useState<LearningEvent[]>([]);
  const [featuresByItemId, setFeaturesByItemId] = useState<RecommendationFeatures>(() => Object.assign({}, ...Object.values(initialFeeds).map(feed => feed.candidateFeatures ?? {})));
  const resolvedCreditIds = useRef(new Set(Object.values(initialFeeds).flatMap(feed => Object.keys(feed.candidateFeatures ?? {}))));
  const lastHistoricalSnapshot = useRef("");
  const [learningError, setLearningError] = useState("");
  // Titles decided before the server's capped profile window: excluded from the deck, never trained on.
  const [olderConsideredIds, setOlderConsideredIds] = useState<Record<Category, string[]>>({ Movies: [], Shows: [], Adult: [] });
  const [loadedProfileCategories, setLoadedProfileCategories] = useState<Set<Category>>(() => new Set());
  const activeCategory = useRef(session.category);
  activeCategory.current = session.category;
  const catalogue = catalogueItems.filter(item => adultSectionEnabled || item.category !== "Adult");
  const categoryItems = catalogue.filter(item => item.category === session.category);
  const localFeatures = Object.fromEntries([...catalogue, ...Object.values(resolvedSavedItems)].map(item => [item.id, recommendationFeatureKeys({ genres: item.genre, year: item.year, type: item.type })]));
  const combinedFeatures = { ...featuresByItemId };
  for (const [id, keys] of Object.entries(localFeatures)) combinedFeatures[id] = [...new Set([...(combinedFeatures[id] ?? []), ...keys])];
  const profile = buildRecommendationProfile(learningEvents, combinedFeatures, session.category);
  const relatedRanks: Record<string, number> = {};
  for (const event of learningEvents) if (event.sessionId === runId.current && event.category === session.category && event.eventType === "candidate_batch" && event.lane === "related" && isRelatedProvenance(event.provenance)) {
    const provenance = event.provenance;
    event.candidateIds?.forEach((id, index) => { const rank = (provenance.page - 1) * 20 + provenance.positions[index]; relatedRanks[id] = Math.min(relatedRanks[id] ?? Infinity, rank); });
  }
  const recommendations = rankRecommendations(categoryItems, profile.signals, profile.comparisons, combinedFeatures, relatedRanks);
  const items = recommendations.items;
  const previouslyConsideredIds = new Set([...profile.consideredIds, ...olderConsideredIds[session.category]]);
  const retainedIds = new Set([...session.saved, ...session.shortlisted]);
  const remainingItems = items.filter(candidate => !session.decisions[candidate.id] && !retainedIds.has(candidate.id) && !previouslyConsideredIds.has(candidate.id));
  const categoryOutcomes = Object.fromEntries(categories.map(category => [category, discoveryPages[category].feed.status])) as Record<Category, DiscoveryFeed["status"]>;
  const item = loadedProfileCategories.has(session.category) ? remainingItems.find(candidate => candidate.id === session.lockedItemId) ?? remainingItems[0] : undefined;
  // Keep the card underneath stable while background refreshes re-rank the rest of the deck.
  const nextItem = remainingItems.find(candidate => candidate.id === lockedNextItemId.current && candidate.id !== item?.id) ?? remainingItems.find(candidate => candidate.id !== item?.id);
  lockedNextItemId.current = nextItem?.id ?? null;
  // Shown only while the deck still has cards; an empty deck explains the failure itself.
  const catalogueNotice = item ? degradedFeedNotice(discoveryPages[session.category].feed.sources, Boolean(discoveryPages[session.category].error)) : "";
  const picks = session.shortlisted.map(id => catalogue.find(candidate => candidate.id === id) ?? resolvedSavedItems[id] ?? unavailableSavedItem(id));
  // The deck counter is per category; the shortlist panel shows the total across categories.
  const categoryPicks = picks.filter(pick => pick.category === session.category).length;
  const removed = session.reviewRemoved.map(id => catalogue.find(candidate => candidate.id === id) ?? resolvedSavedItems[id] ?? unavailableSavedItem(id));
  const saved = session.saved.map(id => catalogue.find(candidate => candidate.id === id) ?? resolvedSavedItems[id] ?? unavailableSavedItem(id));
  const seenCount = categoryItems.length - categoryItems.filter(candidate => !session.decisions[candidate.id]).length;

  async function loadMoreDiscoveries(category: Category, refresh = false) {
    if (discoveryPagesInFlight.current.has(category) || (!refresh && !discoveryPages[category].feed.hasMore)) return false;
    discoveryPagesInFlight.current.add(category);
    setDiscoveryPages(current => ({ ...current, [category]: { ...current[category], loading: true, error: "" } }));
    try {
      const query = new URLSearchParams({ category });
      const cursor = feedCursors.current[category];
      if (cursor) query.set("cursor", cursor);
      if (refresh) query.set("refresh", "1");
      for (const event of learningQueue.current.filter(event => event.category === category && event.eventType === "decision").slice(-100)) if (event.itemId) query.append("excludeId", event.itemId);
      for (const id of [...resolvedCreditIds.current].filter(id => categoryForId(id) === category).slice(-100)) query.append("knownFeatureId", id);
      const response = await fetch(`/api/discovery-feed?${query}`, { cache: "no-store" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const result = await response.json() as DiscoveryFeed & { error?: string };
      if (!response.ok || !Array.isArray(result.items) || !Array.isArray(result.batches) || !result.status) throw new Error(result.error || "More titles could not be loaded.");
      feedCursors.current[category] = result.cursor;
      setFeaturesByItemId(current => ({ ...current, ...result.candidateFeatures }));
      Object.keys(result.candidateFeatures ?? {}).forEach(id => resolvedCreditIds.current.add(id));
      const retrievalId = createClientUuid();
      for (const batch of result.batches) recordCandidateBatch(category, batch, retrievalId);
      const previousItems = catalogueItemsRef.current;
      const mergedItems = deduplicateTitles([...previousItems, ...result.items.filter(candidate => candidate.category === category)]);
      catalogueItemsRef.current = mergedItems;
      const previousIds = new Set(previousItems.map(candidate => candidate.id));
      recordFeedSnapshot(category, result, retrievalId, mergedItems.filter(candidate => !previousIds.has(candidate.id)).map(candidate => candidate.id));
      setCatalogueItems(mergedItems);
      const failed = result.status.outcome === "unavailable";
      setDiscoveryPages(current => ({ ...current, [category]: { feed: { ...result, status: current[category].feed.status.hasTitles ? { ...result.status, outcome: "ready", hasTitles: true } : result.status }, loading: false, error: failed ? feedFailureMessage(result.sources) : "" } }));
      return !failed;
    } catch (error) {
      setDiscoveryPages(current => ({ ...current, [category]: { ...current[category], error: error instanceof Error ? error.message : "More titles could not be loaded." } }));
      return false;
    } finally {
      discoveryPagesInFlight.current.delete(category);
      setDiscoveryPages(current => ({ ...current, [category]: { ...current[category], loading: false } }));
    }
  }

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        await flushLearningQueue();
        for (const category of categories) {
          const generation = refreshGeneration.current[category];
          if (generation === refreshedGeneration.current[category] || learningQueue.current.some(event => event.category === category && ["decision", "decision_undone", "saved"].includes(event.eventType))) continue;
          if (discoveryPagesInFlight.current.has(category)) continue;
          await refreshHistoricalProfile(category);
          if (await loadMoreDiscoveries(category, true)) refreshedGeneration.current[category] = generation;
        }
      })();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [ready, refreshRevision, discoveryPages]);

  /** Every "Try again" goes through here: continue the feed when it has titles, otherwise start it afresh. */
  function retryCategory(category: Category) {
    const page = discoveryPages[category];
    void loadMoreDiscoveries(category, !page.feed.status.hasTitles || !page.feed.hasMore);
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (categories.some(category => refreshGeneration.current[category] !== refreshedGeneration.current[category])) setRefreshRevision(value => value + 1);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // A failed page blocks prefetch only until its sources' cooldown ends, not until a fixed sweep.
  useEffect(() => {
    const waits = categories.flatMap(category => {
      const page = discoveryPages[category];
      const delay = page.error ? feedRetryDelay(page.feed.sources) : null;
      return delay === null ? [] : [{ category, delay }];
    });
    if (!waits.length) return;
    const timer = window.setTimeout(() => setDiscoveryPages(current => {
      const due = waits.filter(wait => current[wait.category].error && (feedRetryDelay(current[wait.category].feed.sources) ?? 0) <= 0);
      if (!due.length) return current;
      const next = { ...current };
      for (const { category } of due) next[category] = { ...current[category], error: "" };
      return next;
    }), Math.min(...waits.map(wait => wait.delay)) + 50);
    return () => window.clearTimeout(timer);
  }, [discoveryPages]);

  useEffect(() => {
    const category = session.category;
    if (ready && loadedProfileCategories.has(category) && session.view === "discover" && remainingItems.length <= 5 && discoveryPages[category].feed.hasMore && !discoveryPages[category].loading && !discoveryPages[category].error) {
      void loadMoreDiscoveries(category);
    }
  }, [ready, loadedProfileCategories, session.category, session.view, remainingItems.length, discoveryPages]);

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
        if (cancelled) return;
        const next = { ...initialState(), ...serverStored };
        if (!runId.current) runId.current = createClientUuid();
        next.sessionId = runId.current;
        if (typeof next.eventSequence !== "number" || next.eventSequence < 0) next.eventSequence = 0;
        if (typeof next.reviewId !== "string") next.reviewId = null;
        learningSequence.current = next.eventSequence;
        if ((next.category as string) === "TV") next.category = "Shows";
        if (!adultSectionEnabled && next.category === "Adult") next.category = "Movies";
        const availableIds = new Set(catalogue.map(candidate => candidate.id));
        if (next.lockedItemId && (!availableIds.has(next.lockedItemId) || next.decisions[next.lockedItemId] || !catalogue.some(candidate => candidate.id === next.lockedItemId && candidate.category === next.category))) next.lockedItemId = null;
        setSession(next);
        setReady(true);
      } catch {
        if (!cancelled) setLoadError("We couldn’t load your discovery session. Check your connection and try again.");
      }
    }
    void loadState();
    return () => { cancelled = true; };
  }, [adultSectionEnabled, loadAttempt]);

  const loadedOutbox = useRef(false);
  const heldOutboxKey = `choice-fatigue-learning-held-${userId}`;
  function requeueHeldEvents() {
    try {
      const held = JSON.parse(localStorage.getItem(heldOutboxKey) ?? "[]") as unknown;
      if (!Array.isArray(held) || !held.length) return;
      localStorage.removeItem(heldOutboxKey);
      const valid = held.filter(isValidRecommendationEvent);
      // The server refuses events older than its window; keep those in this browser rather than sending them to be rejected.
      const tooOld = valid.filter(event => Date.parse(event.occurredAt) < Date.now() - recommendationEventMaxAgeMs);
      const resend = valid.filter(event => !tooOld.includes(event));
      if (tooOld.length) {
        const key = `choice-fatigue-learning-quarantine-${userId}`;
        const quarantined = JSON.parse(localStorage.getItem(key) ?? "[]");
        localStorage.setItem(key, JSON.stringify([...(Array.isArray(quarantined) ? quarantined : []), ...tooOld]));
        setLearningError("Some Adult choices made while access was off are too old to sync. They are kept in this browser.");
      }
      learningQueue.current = mergeRecommendationEvents(learningQueue.current, resend);
      setLearningEvents(current => mergeRecommendationEvents(current, resend));
      persistOutbox();
    } catch { /* Held events stay stored when this browser cannot read them now. */ }
  }
  useEffect(() => {
    if (!ready) return;
    if (!loadedOutbox.current) {
      loadedOutbox.current = true;
      try {
        const stored = JSON.parse(localStorage.getItem(`choice-fatigue-learning-v3-${userId}`) ?? "[]") as unknown;
        if (Array.isArray(stored)) {
          learningQueue.current = mergeRecommendationEvents(learningQueue.current, stored.filter(isValidRecommendationEvent));
          setLearningEvents(current => mergeRecommendationEvents(current, learningQueue.current));
        }
      } catch { /* The outbox still works in memory when storage is unavailable. */ }
    }
    // Adult events held while access was off are offered again whenever access is on, not only on first load.
    if (adultSectionEnabled) requeueHeldEvents();
    void flushLearningQueue().then(() => refreshHistoricalProfile());
  }, [ready, session.category, userId, adultSectionEnabled]);

  useEffect(() => {
    const retry = () => {
      if (learningQueue.current.some(event => adultSectionEnabled || event.category !== "Adult")) void flushLearningQueue().then(() => refreshHistoricalProfile());
    };
    const timer = window.setInterval(retry, 15_000);
    window.addEventListener("online", retry);
    return () => { window.clearInterval(timer); window.removeEventListener("online", retry); };
  }, [userId, adultSectionEnabled]);

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
      if (version === saveVersion.current) setSaveStatus("saved");
      return;
    }
    throw new Error("Discovery state kept changing in another tab. Try again.");
  }

  function persistOutbox() {
    try { localStorage.setItem(`choice-fatigue-learning-v3-${userId}`, JSON.stringify(learningQueue.current)); } catch { /* Server delivery is still attempted. */ }
  }

  function flushLearningQueue() {
    learningWriteQueue.current = learningWriteQueue.current.catch(() => undefined).then(async () => {
      let byteLimit = 240 * 1024;
      while (true) {
        const deliverable = learningQueue.current.filter(event => adultSectionEnabled || event.category !== "Adult");
        if (!deliverable.length) return;
        const batch = recommendationEventBatch(deliverable, byteLimit);
        if (!batch.length) { setLearningError("A learning event is too large to sync. Your choices are still saved in this browser."); return; }
        const response = await fetch("/api/recommendation-events", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: batch }),
        });
        if (response.status === 401) { window.location.replace("/sign-in"); return; }
        if (response.status === 413 && batch.length > 1) { byteLimit = Math.floor(new TextEncoder().encode(JSON.stringify({ events: batch })).byteLength / 2); continue; }
        // Rate-limited: the 15-second retry picks the queue up again, so there is nothing to report.
        if (response.status === 429) return;
        if (!response.ok) { setLearningError("Couldn’t sync recommendation learning. Your choices will retry automatically."); return; }
        const data = await response.json() as { acceptedIds: string[]; rejected: RejectedRecommendationEvent[] };
        const result = settleRecommendationBatch(batch, data.acceptedIds, data.rejected);
        const settledIds = new Set([...result.confirmed, ...result.quarantined, ...result.held].map(event => event.id));
        if (!settledIds.size) return;
        learningQueue.current = learningQueue.current.filter(event => !settledIds.has(event.id));
        persistOutbox();
        if (result.held.length) {
          try {
            const stored = JSON.parse(localStorage.getItem(heldOutboxKey) ?? "[]");
            localStorage.setItem(heldOutboxKey, JSON.stringify([...(Array.isArray(stored) ? stored : []), ...result.held].slice(-2000)));
          } catch { /* Held Adult events are dropped only when this browser cannot store them. */ }
        }
        if (result.quarantined.length) {
          try {
            const key = `choice-fatigue-learning-quarantine-${userId}`;
            const stored = JSON.parse(localStorage.getItem(key) ?? "[]");
            localStorage.setItem(key, JSON.stringify([...(Array.isArray(stored) ? stored : []), ...result.quarantined]));
          } catch { /* The error remains visible even when storage is unavailable. */ }
          setLearningError("Some recommendation events were rejected. Other choices continue to sync; rejected events are retained in this browser.");
        } else setLearningError(current => current.startsWith("Some recommendation") ? current : "");
      }
    }).catch(() => { setLearningError("Couldn’t sync recommendation learning. Your choices will retry automatically."); });
    return learningWriteQueue.current;
  }

  async function refreshHistoricalProfile(category = activeCategory.current) {
    try {
      const query = new URLSearchParams({ category });
      // Most recently learned first, so the server's recent-title window sees what this tab already holds.
      for (const id of [...resolvedCreditIds.current].filter(id => categoryForId(id) === category).slice(-200)) query.append("knownFeatureId", id);
      const response = await fetch(`/api/recommendation-events?${query}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { events: LearningEvent[]; featuresByItemId: RecommendationFeatures; resolvedCreditItemIds?: string[]; requestedCreditItemIds?: string[]; attemptedFeatureItemIds?: string[]; olderConsideredIds?: string[] };
      data.resolvedCreditItemIds?.forEach(id => resolvedCreditIds.current.add(id));
      // A failed lookup is retried on the next page load, not on every refresh.
      data.attemptedFeatureItemIds?.forEach(id => resolvedCreditIds.current.add(id));
      if (data.olderConsideredIds?.length) setOlderConsideredIds(current => ({ ...current, [category]: data.olderConsideredIds! }));
      setLearningEvents(current => mergeRecommendationEvents(current, data.events, learningQueue.current));
      setFeaturesByItemId(current => ({ ...current, ...data.featuresByItemId }));
      const snapshotKey = `${category}:${(data.requestedCreditItemIds ?? []).join(",")}`;
      if (data.requestedCreditItemIds?.length && lastHistoricalSnapshot.current !== snapshotKey) {
        lastHistoricalSnapshot.current = snapshotKey;
        enqueueLearningEvent("retrieval_snapshot", null, category, null, null, null, null, [], null, null, createClientUuid(), { candidateRequestedIds: [], candidateResolvedIds: [], historicalRequestedIds: data.requestedCreditItemIds, historicalResolvedIds: data.resolvedCreditItemIds ?? [] });
      }
    } catch { /* Local decisions remain usable while profile resolution is unavailable. */ }
    finally { setLoadedProfileCategories(current => new Set([...current, category])); }
  }

  function enqueueLearningEvent(eventType: LearningEvent["eventType"], itemId: string | null, category: Category, decision: Decision | null = null, rating: number | null = null, targetEventId: string | null = null, reviewId = session.reviewId, candidateIds: string[] | null = null, source: LearningEvent["source"] = null, lane: LearningEvent["lane"] = null, retrievalId: string | null = null, provenance: LearningEvent["provenance"] = null) {
    const event: LearningEvent = {
      id: createClientUuid(), sessionId: runId.current, reviewId, sequence: learningSequence.current++, itemId, candidateIds, category,
      eventType, decision, rating, targetEventId, algorithmVersion: currentRecommendationAlgorithmVersion, occurredAt: new Date().toISOString(), retrievalId, source, lane, provenance,
    };
    learningQueue.current = [...learningQueue.current, event];
    if (["decision", "decision_undone", "saved"].includes(eventType)) {
      refreshGeneration.current[category] += 1;
      setRefreshRevision(value => value + 1);
    }
    setLearningEvents(current => mergeRecommendationEvents(current, [event]));
    persistOutbox();
    void flushLearningQueue();
    return event;
  }

  function recordCandidateBatch(category: Category, batch: CandidateBatch, retrievalId: string) {
    enqueueLearningEvent("candidate_batch", null, category, null, null, null, null, batch.candidateIds, batch.source, batch.lane, retrievalId, batch.provenance ?? null);
  }

  function recordFeedSnapshot(category: Category, feed: DiscoveryFeed, retrievalId: string, retainedIds = feed.items.map(item => item.id)) {
    if (feed.snapshot) enqueueLearningEvent("retrieval_snapshot", null, category, null, null, null, null, retainedIds, null, null, retrievalId, feed.snapshot);
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

  const previousInitialFeeds = useRef(initialFeeds);
  useEffect(() => {
    if (previousInitialFeeds.current === initialFeeds) return;
    previousInitialFeeds.current = initialFeeds;
    setCatalogueItems(mediaItems);
    catalogueItemsRef.current = mediaItems;
    setFeaturesByItemId(current => ({ ...current, ...Object.assign({}, ...Object.values(initialFeeds).map(feed => feed.candidateFeatures ?? {})) }));
    Object.values(initialFeeds).flatMap(feed => Object.keys(feed.candidateFeatures ?? {})).forEach(id => resolvedCreditIds.current.add(id));
    setDiscoveryPages(Object.fromEntries(categories.map(category => [category, discoveryPageState(initialFeeds[category])])) as DiscoveryPageState);
    feedCursors.current = { Movies: initialFeeds.Movies.cursor, Shows: initialFeeds.Shows.cursor, Adult: initialFeeds.Adult.cursor };
    if (ready) for (const category of categories) if (category !== "Adult" || adultSectionEnabled) {
      const retrievalId = createClientUuid();
      for (const batch of initialFeeds[category].batches) recordCandidateBatch(category, batch, retrievalId);
      recordFeedSnapshot(category, initialFeeds[category], retrievalId);
    }
  }, [initialFeeds, mediaItems, ready, adultSectionEnabled]);

  const recordedInitialBatches = useRef(false);
  useEffect(() => {
    if (!ready || recordedInitialBatches.current) return;
    recordedInitialBatches.current = true;
    for (const category of categories) if (category !== "Adult" || adultSectionEnabled) {
      const retrievalId = createClientUuid();
      for (const batch of initialFeeds[category].batches) recordCandidateBatch(category, batch, retrievalId);
      recordFeedSnapshot(category, initialFeeds[category], retrievalId);
    }
  }, [ready, initialFeeds, adultSectionEnabled]);

  useEffect(() => {
    if (!ready || session.view !== "discover" || !item) return;
    const key = `${runId.current}:${session.history.length}:${session.shortlisted.length}:${item.id}`;
    if (shownItemKey.current === key) return;
    shownItemKey.current = key;
    enqueueLearningEvent("item_shown", item.id, item.category, null, null, null, null, shownCandidateIds(item.id, remainingItems.map(candidate => candidate.id)));
  }, [ready, session.view, item?.id, session.history.length, session.shortlisted.length]);

  useEffect(() => {
    if (ratingSelectorOpen) ratingInput.current?.focus();
  }, [ratingSelectorOpen]);

  useEffect(() => {
    function closeAccountMenu(event: globalThis.PointerEvent) {
      const menu = accountMenu.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
    function closeAccountMenuOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !accountMenu.current?.open) return;
      const focusWasInMenu = accountMenu.current.contains(document.activeElement);
      accountMenu.current.open = false;
      if (focusWasInMenu) accountMenu.current.querySelector("summary")?.focus();
    }
    document.addEventListener("pointerdown", closeAccountMenu);
    document.addEventListener("keydown", closeAccountMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeAccountMenu);
      document.removeEventListener("keydown", closeAccountMenuOnEscape);
    };
  }, []);

  /** One toast at a time; a new notice replaces the old one and restarts its timer. */
  function showNotice(message:string, action?:NoticeAction) {
    setNotice({ message, action });
    scheduleNoticeDismissal(action ? 6000 : 4000);
  }
  function scheduleNoticeDismissal(delay:number) {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => { noticeTimer.current = null; setNotice(null); }, delay);
  }
  function pauseNotice() {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
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
    if (decision === "seen" && (!rating || rating < 1 || rating > 10 || !Number.isInteger(rating))) return;
    dismissSwipeHint();
    const currentItem = item;
    const nextItemId = nextItem?.id ?? null;
    const event = enqueueLearningEvent("decision", currentItem.id, currentItem.category, decision, decision === "seen" ? rating! : null, null, null);
    const historyEntry = decision === "seen" ? {id:currentItem.id, decision, rating:rating!, eventId:event.id} : {id:currentItem.id, decision, eventId:event.id};
    setAnnouncement(decision === "keep" ? `Shortlisted ${currentItem.title}` : decision === "pass" ? `Passed ${currentItem.title}` : `Rated ${currentItem.title} ${rating} out of 10`);
    keepCardFocus();
    setSession(current => ({
      ...current,
      lockedItemId:nextItemId && !current.decisions[nextItemId] && catalogue.some(candidate => candidate.id === nextItemId && candidate.category === current.category) ? nextItemId : null,
      decisions:{...current.decisions, [currentItem.id]:decision},
      ratings:decision === "seen" ? {...current.ratings, [currentItem.id]:rating!} : current.ratings,
      shortlisted:decision === "keep" ? [...current.shortlisted.filter(id => id !== currentItem.id), currentItem.id] : current.shortlisted,
      reviewRemoved:current.reviewRemoved.filter(id => id !== currentItem.id),
      history:[...current.history, historyEntry],
    }));
  }
  /** A decision replaces the card, so move focus to the new one if it was on (or lost with) the old one. */
  function keepCardFocus() {
    const active = document.activeElement;
    refocusCard.current = !active || active === document.body || Boolean(mediaCard.current?.contains(active));
  }
  function transitionDecision(decision:Decision, source:"drag"|"control"="control", rating?:number) {
    if (swipeExit.current || !item) return;
    if (decision === "seen" && (!rating || rating < 1 || rating > 10 || !Number.isInteger(rating))) return;
    setRatingSelectorOpen(false);
    const element=mediaCard.current;
    // Reduced motion skips the exit animation entirely rather than running it at zero duration.
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (element) { element.style.transform=""; element.style.removeProperty("--drag"); element.classList.remove("drag-keep","drag-pass"); }
      decide(decision, rating);
      return;
    }
    swipeExit.current=true;
    setCardExiting(true);
    element.style.transform=decision === "seen" ? "translateY(-10px) scale(.98)" : `translateX(${decision==="keep"?"105%":"-105%"}) rotate(${decision==="keep"?4:-4}deg)`;
    element.style.opacity="0";
    element.style.pointerEvents="none";
    if (source==="control") element.classList.add("control-exit");
    element.classList.remove("drag-keep","drag-pass");
    const handoffDelay=source==="control"?230:150;
    window.setTimeout(()=>{
      swipeExit.current=false;
      setCardExiting(false);
      decide(decision, rating);
    },handoffDelay);
  }
  function undo() {
    const last = session.history.at(-1);
    if (last?.eventId) enqueueLearningEvent("decision_undone", last.id, categoryForId(last.id), null, null, last.eventId, null);
    if (last) setAnnouncement(`Restored ${catalogue.find(candidate => candidate.id === last.id)?.title ?? "the last title"}`);
    keepCardFocus();
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
    showNotice("Back in discovery — your first impression still counts.", { label: "Undo", run: () => {
      enqueueLearningEvent("review_restored", id, categoryForId(id), null, null, targetEventId);
      setSession(current=>({...current, shortlisted:[...new Set([...current.shortlisted,id])], decisions:{...current.decisions,[id]:"keep"}}));
    } });
  }
  function beginReview() {
    const reviewId = createClientUuid();
    enqueueLearningEvent("review_started", null, session.category, null, null, null, reviewId);
    setSession(current=>({...current, reviewId, view:"review"}));
  }
  function leaveReview() {
    enqueueLearningEvent("review_abandoned", null, session.category);
    // Removals stay listed until the shortlist is saved, so leaving review never makes them permanent.
    setSession(current=>({...current, reviewId:null, view:"discover"}));
  }
  function removeFromReview(id:string) {
    const targetEventId = [...session.history].reverse().find(entry => entry.id === id)?.eventId ?? null;
    enqueueLearningEvent("review_removed", id, categoryForId(id), null, null, targetEventId);
    setSession(current=>{ const decisions={...current.decisions}; delete decisions[id]; return {...current, shortlisted:current.shortlisted.filter(value=>value!==id), decisions, reviewRemoved:[...new Set([...current.reviewRemoved,id])]}; });
    showNotice("Removed for now — you can restore it below.", { label: "Undo", run: () => restorePick(id, false) });
  }
  function restorePick(id:string, announce = true) {
    const targetEventId = [...session.history].reverse().find(entry => entry.id === id)?.eventId ?? null;
    enqueueLearningEvent("review_restored", id, categoryForId(id), null, null, targetEventId);
    setSession(current=>({...current, shortlisted:[...new Set([...current.shortlisted,id])], decisions:{...current.decisions,[id]:"keep"}, reviewRemoved:current.reviewRemoved.filter(value=>value!==id)}));
    if (announce) showNotice("Restored to your shortlist");
  }
  /** Withdraw saves; the titles go back to the shortlist when undoing a save, or leave entirely from the Saved list. */
  function withdrawSaved(ids:string[], backToShortlist:boolean, restoredHistory:SessionState["history"] = []) {
    for (const id of ids) enqueueLearningEvent("save_withdrawn", id, categoryForId(id));
    setSession(current=>({...current,
      saved:current.saved.filter(id=>!ids.includes(id)),
      shortlisted:backToShortlist ? [...new Set([...current.shortlisted,...ids])] : current.shortlisted,
      decisions:backToShortlist ? {...current.decisions, ...Object.fromEntries(ids.map(id=>[id,"keep" as const]))} : current.decisions,
      history:backToShortlist ? [...current.history, ...restoredHistory.filter(entry=>!current.history.some(existing=>existing.eventId===entry.eventId))] : current.history,
    }));
  }
  function removeSaved(pick:MediaItem) {
    withdrawSaved([pick.id], false);
    showNotice(`${pick.title} removed from saved`, { label: "Undo", run: () => {
      enqueueLearningEvent("saved", pick.id, pick.category);
      setSession(current=>({...current, saved:[...new Set([...current.saved,pick.id])]}));
    } });
  }
  function savePicks() {
    if (!picks.length) return;
    const count=picks.length;
    const visiblePickIds=picks.map(pick=>pick.id);
    for (const pick of picks) {
      const targetEventId = [...session.history].reverse().find(entry => entry.id === pick.id && entry.decision === "keep")?.eventId ?? null;
      enqueueLearningEvent("review_kept", pick.id, pick.category, null, null, targetEventId);
      enqueueLearningEvent("saved", pick.id, pick.category, null, null, targetEventId);
    }
    // Saved titles leave the swipe history: undoing a save is a separate, explicit action, not a swipe undo.
    const savedHistory = session.history.filter(entry=>visiblePickIds.includes(entry.id));
    setSession(current=>({...current, saved:[...new Set([...current.saved,...visiblePickIds])], shortlisted:current.shortlisted.filter(id=>!visiblePickIds.includes(id)), reviewRemoved:[], history:current.history.filter(entry=>!visiblePickIds.includes(entry.id)), view:"discover"}));
    setSavedOpen(true);
    // The Saved dialog opens with its own Undo: a toast behind an open dialog is outside its focus trap.
    setJustSaved({ ids: visiblePickIds, history: savedHistory });
  }
  function onCardPointerDown(event:PointerEvent<HTMLElement>) {
    if (swipeExit.current || (event.target as HTMLElement).closest("button, input, label, select, textarea, a")) return;
    if (!mediaCard.current) return;
    drag.current={x:event.clientX, y:event.clientY}; event.currentTarget.classList.add("dragging"); event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onCardPointerMove(event:PointerEvent<HTMLElement>) {
    const card = mediaCard.current;
    if (!drag.current || !card) return;
    const dx=event.clientX-drag.current.x;
    dragOffset.current = dx;
    if (dragFrame.current !== null) return;
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = null;
      const offset = dragOffset.current;
      card.style.transform = `translate(${offset}px,${Math.max(-16,Math.abs(offset)*-.025)}px) rotate(${offset*.035}deg)`;
      // -1…1 of the way to the swipe threshold; CSS fades the keep/pass tint and stamp in with it.
      card.style.setProperty("--drag", String(Math.max(-1, Math.min(1, offset / Math.max(80, card.clientWidth * .24)))));
      card.classList.toggle("drag-keep", offset > 20);
      card.classList.toggle("drag-pass", offset < -20);
    });
  }
  function onCardPointerUp(event:PointerEvent<HTMLElement>) {
    const card = mediaCard.current;
    if (!drag.current || !card) return;
    const dx=event.clientX-drag.current.x; const dy=event.clientY-drag.current.y; drag.current=null;
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
    card.classList.remove("dragging");
    const swipeThreshold=Math.max(80,card.clientWidth*.24);
    if (Math.abs(dx)>swipeThreshold) transitionDecision(dx>0?"keep":"pass","drag");
    else {
      card.style.transform="";
      card.style.opacity="";
      card.style.removeProperty("--drag");
      card.classList.remove("drag-keep","drag-pass");
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && item && !ratingSelectorOpen) setDetails(item);
    }
  }

  function onCardPointerCancel() {
    const card = mediaCard.current;
    drag.current=null;
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
    if (!card) return;
    card.classList.remove("dragging");
    card.style.transform="";
    card.style.opacity="";
    card.style.removeProperty("--drag");
    card.classList.remove("drag-keep","drag-pass");
  }

  function moveRatingFocus(event:React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (!step || index < 0) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, index + step))].focus();
  }

  function renderMediaCard(candidate: MediaItem, active: boolean) {
    return <article
      key={candidate.id}
      ref={active ? mediaCard : null}
      className={`media-card ${active ? "card-active" : "card-under"}`}
      tabIndex={active ? 0 : -1}
      aria-hidden={active ? undefined : true}
      aria-label={active ? [candidate.title, candidate.year].filter(Boolean).join(", ") : undefined}
      aria-describedby={active ? "card-controls-hint" : undefined}
      role={active ? "group" : undefined}
      onKeyDown={active ? event => { if ((event.key === "Enter" || event.key === " ") && !ratingSelectorOpen && event.target === event.currentTarget) { event.preventDefault(); setDetails(candidate); } } : undefined}
      onPointerDown={active ? onCardPointerDown : undefined}
      onPointerMove={active ? onCardPointerMove : undefined}
      onPointerUp={active ? onCardPointerUp : undefined}
      onPointerCancel={active ? onCardPointerCancel : undefined}
    >
      <Poster item={candidate} className="card-poster" loading="eager"/>
      <div className="card-poster-tags tag-row">{candidate.genre.slice(0,2).map(genre=><span key={genre}>{genre}</span>)}</div>
      <div className="card-content">
          <div className="card-overline"><span>{displayMetadata(candidate) || "Details unavailable"}</span>{candidate.rating !== "—" && <span><Icon name="spark"/> {candidate.rating}</span>}</div>
          <h2>{candidate.title}</h2>
          <div className="card-footer">
            <div className="card-actions">
              {active && (ratingSelectorOpen ? <fieldset className="seen-rating" aria-label={`Rate ${candidate.title}`}>
                <legend className="sr-only">Rate {candidate.title} with 1 to 10 to continue.</legend>
                <div className="seen-rating-header"><span>Your rating <small>/ 10</small></span><button className="rating-cancel" type="button" onClick={cancelRatingSelector}>Cancel</button></div>
                {/* Buttons, not radios: arrow keys only move focus here, and a rating is saved only on click, Enter, or Space. */}
                <div className="seen-rating-options" onKeyDown={moveRatingFocus}>{[1,2,3,4,5,6,7,8,9,10].map(stars=>
                  <button key={stars} ref={stars===1?ratingInput:undefined} type="button" aria-label={`${stars} out of 10`} onClick={()=>transitionDecision("seen","control",stars)}>{stars}</button>
                )}</div>
              </fieldset> : <><button className="card-details-button" type="button" onClick={()=>setDetails(candidate)} aria-label={`Details for ${candidate.title}`}><Icon name="info"/><span>Details</span></button><button ref={seenButton} className="card-seen-button" type="button" onClick={()=>setRatingSelectorOpen(true)} aria-label={`Seen it: rate ${candidate.title}`}><Icon name="eye"/><span>Seen it</span></button></>)}
            </div>
          </div>
        </div>
      {active && <><div className="swipe-stamp stamp-keep">SHORTLIST</div><div className="swipe-stamp stamp-pass">PASS</div></>}
    </article>;
  }

  // Reassigned every render, so the listener always sees the current card rather than the one from when it was attached.
  windowKeyHandler.current = (event:KeyboardEvent) => {
    if (event.key === "Escape") { if(ratingSelectorOpen)cancelRatingSelector(); else if(savedOpen)setSavedOpen(false); else if(details)setDetails(null); else if(ageOpen)setAgeOpen(false); return; }
    if (!ready || session.view !== "discover" || details || savedOpen || ageOpen || cardExiting) return;
    if (event.target instanceof HTMLElement && event.target.closest("button, input, select, textarea, a, summary, [contenteditable='true']")) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); transitionDecision("pass"); }
    if (event.key === "ArrowRight") { event.preventDefault(); transitionDecision("keep"); }
  };
  useEffect(() => {
    const onKeyDown = (event:KeyboardEvent) => windowKeyHandler.current(event);
    window.addEventListener("keydown",onKeyDown);
    return ()=>window.removeEventListener("keydown",onKeyDown);
  },[]);

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

  useEffect(() => {
    if (!refocusCard.current) return;
    refocusCard.current = false;
    mediaCard.current?.focus();
  }, [item?.id]);

  // The header stays on screen while the session loads, so navigation and sign-out are never hidden.
  function renderTopbar() {
    return <header className="topbar">
      <a className="brand" href="/" aria-label={`${appName} home`}><span className="brand-symbol">✳</span><span>{appName.toLowerCase()}</span></a>
      <nav className="category-nav" aria-label="Media categories">{categories.filter(category=>adultSectionEnabled || category!=="Adult").map(category=>{const index=categories.indexOf(category); return <button key={category} className={`nav-item ${session.category===category?"active":""} ${category==="Adult"?"adult-nav":""}`} onClick={()=>changeCategory(category)} disabled={!ready} aria-pressed={session.category===category}>{category==="Adult"?<><Icon name="lock"/><span>Adult</span></>:<><span className={`nav-dot dot-${index}`}/><span>{category}</span></>}</button>;})}</nav>
      <div className="header-right"><button className="saved-link" onClick={()=>setSavedOpen(true)} disabled={!ready} aria-label={`Saved ${saved.length}` }><Icon name="bookmark"/><span>Saved</span><b>{saved.length}</b></button><details ref={accountMenu} className="account-menu"><summary className="avatar" aria-label={`Account menu for ${userName}`}>{userName.trim().charAt(0).toUpperCase()}</summary><div className="account-dropdown"><strong>{userName}</strong><a href="/account">Account settings</a>{isAdmin&&<a href="/admin?section=services">Service connections</a>}<a href="/credits">About &amp; credits</a>{isAdmin&&<a href="/admin">Admin settings</a>}<button type="button" onClick={handleSignOut}>Sign out</button></div></details></div>
    </header>;
  }

  if (!ready || !loadedProfileCategories.has(session.category)) return <div className="shell">{renderTopbar()}<main className="main"><section className="content-area"><div className="empty-state" role={loadError ? "alert" : "status"}>
    <div className="eyebrow"><span className="live-dot"/> YOUR DISCOVERY SESSION</div>
    <h2>{loadError ? "Your session didn’t load." : "Picking up where you left off…"}</h2>
    <p>{loadError || "Loading your saved choices."}</p>
    {loadError && <button className="button button-dark" onClick={() => setLoadAttempt(value => value + 1)}>Try again <Icon name="rewind"/></button>}
  </div>{!loadError && <div className="card-skeleton" aria-hidden="true"><span/><span/><span/></div>}</section></main></div>;

  return <div className={`shell ${notice ? "has-toast" : ""} ${session.view === "review" ? "in-review" : ""}`}>
    <p className="sr-only" aria-live="polite">{announcement}</p>
    {renderTopbar()}
    <main className={`main ${session.view==="review"?"review-mode":""}`}>
      <section className="content-area">
        {session.view === "review" ? <div className="review-page">
          <div className="review-head"><button className="back-button" onClick={leaveReview}><Icon name="left"/> Back to exploring</button><div className="eyebrow"><span className="live-dot"/> THE SECOND LOOK</div><h1>Review your<br/><em>shortlist.</em></h1><p>Compare your shortlist, remove any titles you’re unsure about, then save the rest.</p></div>
          {picks.length ? <>
            <div className="review-bar"><span>{picks.length} {picks.length===1?"title":"titles"} shortlisted</span><span>Remove any titles you don’t want to save</span></div>
            <div className="review-grid">{picks.map(pick=><article className="review-card" key={pick.id}><Poster item={pick} className="review-poster"/><div className="review-card-info"><div className="card-overline"><span>{pick.category.toUpperCase()} · {pick.year}</span><span><Icon name="spark"/> {pick.rating}</span></div><h3>{pick.title}</h3><div className="tag-row">{pick.genre.slice(0,2).map(genre=><span key={genre}>{genre}</span>)}</div><p>{pick.synopsis}</p><button className="remove-review" onClick={()=>removeFromReview(pick.id)}><Icon name="close"/> Remove from shortlist</button></div></article>)}</div>
            {removed.length>0&&<div className="restored-list"><div><strong>Removed for now</strong><span>Changed your mind? Add any title back.</span></div>{removed.map(pick=><div className="restore-row" key={pick.id}><Poster item={pick} className="restore-poster"/><span>{pick.title}</span><button onClick={()=>restorePick(pick.id)}><Icon name="back"/> Restore</button></div>)}</div>}
            <div className="review-actions"><button className="text-button" onClick={leaveReview}><Icon name="left"/> Keep browsing</button><button className="button button-accent" onClick={savePicks}>Save {picks.length} {picks.length===1?"title":"titles"} <Icon name="arrow"/></button></div>
          </> : removed.length ? <>
            <div className="review-bar"><span>No titles left in your shortlist</span><span>Your removals are reversible</span></div><div className="restored-list">{removed.map(pick=><div className="restore-row" key={pick.id}><Poster item={pick} className="restore-poster"/><span>{pick.title}</span><button onClick={()=>restorePick(pick.id)}><Icon name="back"/> Restore</button></div>)}</div><div className="review-actions"><button className="text-button" onClick={leaveReview}><Icon name="left"/> Keep browsing</button></div>
          </> : <div className="review-empty"><div className="empty-orbit"><Icon name="spark"/></div><h2>Your shortlist is empty.</h2><p>Keep browsing and shortlist anything that catches your eye.</p><button className="button button-dark" onClick={leaveReview}>Keep browsing <Icon name="arrow"/></button></div>}
          <div className="review-footnote">You can keep browsing before saving your shortlist.</div>
        </div> : <div className="discover-layout">
          {catalogueNotice && <p className="catalogue-source-note" role="status">{catalogueNotice}{discoveryPages[session.category].error && <> <button className="text-button" onClick={() => retryCategory(session.category)}>Try now</button></>}</p>}
          <div className="discover-intro"><h1>{session.category}</h1></div>
          {item ? <div className="deck-wrap"><div className="deck-meta"><span>{seenCount} reviewed <small>· {categoryPicks} shortlisted</small></span></div>
            <div className={`card-stack ${nextItem ? "has-stack" : ""}`} aria-label="Media discovery card">
              {nextItem && <><span className="stack-shadow stack-shadow-one" aria-hidden="true"/><span className="stack-shadow stack-shadow-two" aria-hidden="true"/></>}
              {nextItem && renderMediaCard(nextItem, false)}
              {renderMediaCard(item, true)}
            </div>
            <div className="decision-row"><button className="decision-button pass" onClick={()=>transitionDecision("pass")} disabled={cardExiting} aria-keyshortcuts="ArrowLeft"><span><Icon name="left"/></span><small>Don’t want to see</small></button><button className="undo-swipe-button" onClick={undo} disabled={!session.history.length || cardExiting} aria-label="Undo last choice"><Icon name="rewind"/><small>Undo</small></button><button className="decision-button keep" onClick={()=>transitionDecision("keep")} disabled={cardExiting} aria-keyshortcuts="ArrowRight"><small>Want to see</small><span><Icon name="right"/></span></button></div>
            <p id="card-controls-hint" className="sr-only">Press Enter for details. Use the left and right arrow keys to pass or shortlist.</p>
            {showSwipeHint && <p className="swipe-hint" aria-hidden="true">Drag the card, or use <kbd>←</kbd> <kbd>→</kbd></p>}
          </div> : <div className="empty-state" role="status"><div className="empty-orbit"><Icon name={categoryOutcomes[session.category].outcome === "ready" ? "spark" : "info"}/></div>
            {discoveryPages[session.category].loading ? <><h2>Finding more titles…</h2><p>More titles are on the way.</p></> : discoveryPages[session.category].error ? <><h2>{categoryOutcomes[session.category].outcome === "unavailable" ? "This metadata source is temporarily unavailable." : "More titles couldn’t load."}</h2><p>{discoveryPages[session.category].error}</p><button className="button button-dark" onClick={() => retryCategory(session.category)}>Try again <Icon name="rewind"/></button></> : categoryOutcomes[session.category].outcome === "ready" ? <><h2>That’s everything for now.</h2><p>You’ve reached the end of the available {session.category.toLowerCase()} feed.</p><button className="button button-dark" onClick={beginReview}>Review your shortlist <Icon name="arrow"/></button></> : categoryOutcomes[session.category].outcome === "unconfigured" ? <><h2>A metadata source needs setup.</h2><p>{isAdmin ? `Connect the provider for ${session.category.toLowerCase()} in your instance settings to start discovering titles.` : `Ask your instance administrator to configure a metadata source for ${session.category.toLowerCase()}.`}</p>{isAdmin && <a className="button button-dark" href="/admin?section=providers">Configure metadata sources <Icon name="arrow"/></a>}</> : categoryOutcomes[session.category].outcome === "unavailable" ? <><h2>This metadata source is temporarily unavailable.</h2><p>{feedFailureMessage(discoveryPages[session.category].feed.sources)} Your saved choices are safe; try again in a moment.</p><button className="button button-dark" onClick={() => retryCategory(session.category)}>Try again <Icon name="rewind"/></button></> : <><h2>No popular titles are available right now.</h2><p>The provider returned no titles for this category. You can retry to check again.</p><button className="button button-dark" onClick={() => retryCategory(session.category)}>Try again <Icon name="rewind"/></button></>}
          </div>}
          {learningError && <p className="sync-error" role="alert">{learningError}</p>}
          {saveStatus === "error" && <p className="sync-error" role="alert">Couldn’t sync your choices. They’ll retry automatically.</p>}
        </div>}
      </section>
      {session.view==="discover"&&<aside className="shortlist-panel"><div className="panel-heading"><div><div className="eyebrow">YOUR SHORTLIST</div><h2>Your shortlist <span>{picks.length}</span></h2></div><button className="undo-button" onClick={undo} aria-label="Undo last choice" disabled={!session.history.length}><Icon name="rewind"/> Undo</button></div><p className="panel-copy">Titles to compare before saving.</p>
        <div className="tray-list">{picks.length?picks.slice(-4).reverse().map(pick=><div className="tray-item" key={pick.id}><Poster item={pick} className="tray-poster"/><div><strong>{pick.title}</strong><small>{pick.year} · {pick.type}</small></div><button onClick={()=>removePick(pick.id)} aria-label={`Remove ${pick.title} from shortlist`}><Icon name="close"/></button></div>):<div className="tray-empty"><div className="tray-spark">✳</div><span>Shortlisted titles<br/>will appear here.</span></div>}</div>
        {picks.length>4&&<div className="more-picks">+ {picks.length-4} more in your shortlist</div>}
        <div className="panel-bottom"><div className="panel-count"><span className="count-dot"/>{picks.length} {picks.length===1?"title":"titles"} in your shortlist</div><button className="button button-dark review-button" onClick={beginReview} disabled={!picks.length}>Review &amp; compare <Icon name="arrow"/></button></div><div className="privacy-note"><Icon name="spark"/> Synced to your account</div>
      </aside>}
    </main>
    {details&&<Modal className="details-modal" labelledBy="modal-title" onClose={()=>setDetails(null)}><button className="modal-close" onClick={()=>setDetails(null)} aria-label="Close details"><Icon name="close"/></button><DetailsBackdrop key={details.id} item={details}/><div className="modal-info"><div className="eyebrow">{displayMetadata(details, true)}</div><h2 id="modal-title">{details.title}</h2><div className="tag-row">{details.genre.map(genre=><span key={genre}>{genre}</span>)}{details.rating !== "—" && <span>★ {details.rating}</span>}</div><p>{details.synopsis}</p><DetailsPeople key={details.id} item={details}/>{details.age&&<div className="age-note"><Icon name="lock"/> Adults only · 18+</div>}{
      item?.id===details.id&&!session.shortlisted.includes(details.id)&&!session.saved.includes(details.id)
        ? <button className="button button-accent" onClick={()=>{decide("keep");setDetails(null);showNotice("Added to your shortlist");}}>Add to shortlist <Icon name="arrow"/></button>
        : <p className="details-status" role="status">{session.saved.includes(details.id) ? "Saved for later." : session.shortlisted.includes(details.id) ? "Already in your shortlist." : ""}</p>
    }</div></Modal>}
    {ageOpen&&<Modal className="age-modal" labelledBy="age-title" onClose={()=>setAgeOpen(false)}><div className="age-icon"><Icon name="lock"/></div><div className="eyebrow">A PRIVATE SECTION</div><h2 id="age-title">Before you step inside</h2><p>This section is for adults aged 18 and over. It contains mature themes and may display explicit artwork.</p><div className="age-actions"><button className="button button-quiet" onClick={()=>setAgeOpen(false)}>Not now</button><button className="button button-accent" onClick={()=>{setSession(current=>({...current,ageVerified:true,category:"Adult",lockedItemId:null}));setAgeOpen(false);}}>I’m 18 or older <Icon name="arrow"/></button></div><small>Your choice is remembered on your account.</small></Modal>}
    {savedOpen && <Modal className="saved-modal" labelledBy="saved-title" onClose={() => setSavedOpen(false)}>
        <button className="modal-close" onClick={() => setSavedOpen(false)} aria-label="Close saved titles"><Icon name="close" /></button>
        <div className="eyebrow">YOUR SAVED TITLES</div>
        <h2 id="saved-title">Saved for later</h2>
        {justSaved && <p className="saved-undo" role="status">{justSaved.ids.length} {justSaved.ids.length===1?"title":"titles"} saved. <button className="toast-action" type="button" onClick={() => { withdrawSaved(justSaved.ids, true, justSaved.history); setSavedOpen(false); }}>Undo</button></p>}
        <p>These made it through the second look. Your shortlist stays temporary until you save it here.</p>
        {integrationsReadOnly && <p>Service connections are read-only; availability checks are available.</p>}
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
              <button className="saved-remove-button" type="button" onClick={() => removeSaved(pick)} aria-label={`Remove ${pick.title} from saved`}>Remove</button>
            </div>
            {pick.requestable && (seerrConnections.length > 0 || plexConnections.length > 0) ? <div className="saved-actions">
              {seerrConnections.length > 0 && <>
                <button className="saved-availability-button" type="button" onClick={() => void checkSavedAvailability(pick)} disabled={!selectedSeerrId || availabilityCheckingKey !== "" || requestingKey !== "" || plexAvailabilityCheckingKey !== "" || saveStatus === "saving"} aria-label={`Check ${pick.title} in Seerr`}>{availabilityCheckingKey === key ? "Checking…" : "Seerr check"}</button>
                {!integrationsReadOnly && <button className="saved-request-button" type="button" onClick={() => void requestSavedTitle(pick)} disabled={!selectedSeerrId || requestingKey !== "" || availabilityCheckingKey !== "" || plexAvailabilityCheckingKey !== "" || saveStatus === "saving" || tracked}>{saveStatus === "saving" ? "Syncing…" : requestingKey === key ? "Sending…" : tracked ? "Tracked" : "Request"}</button>}
              </>}
              {plexConnections.length > 0 && <button className="saved-availability-button" type="button" onClick={() => void checkSavedPlexAvailability(pick)} disabled={!selectedPlexId || plexAvailabilityCheckingKey !== "" || availabilityCheckingKey !== "" || requestingKey !== "" || saveStatus === "saving"} aria-label={`Check ${pick.title} in Plex`}>{plexAvailabilityCheckingKey === plexKey ? "Checking…" : "Plex check"}</button>}
            </div> : <span className="saved-request-note">{pick.requestable ? "Connect Seerr or Plex" : "TMDB link needed"}</span>}
          </div>;
        })}</div> : <div className="saved-empty">Your saved list is empty. Review a shortlist to keep your favourites here.</div>}
        <button className="button button-dark saved-done" onClick={() => setSavedOpen(false)}>Done</button>
    </Modal>}
    <div className={`toast ${notice?"show":""}`} role="status" aria-live="polite" onMouseEnter={pauseNotice} onMouseLeave={() => { if (notice) scheduleNoticeDismissal(3000); }} onFocus={pauseNotice} onBlur={() => { if (notice) scheduleNoticeDismissal(3000); }}>
      {notice?.message}
      {notice?.action && <button className="toast-action" type="button" onClick={() => { const action = notice.action!; pauseNotice(); setNotice(null); action.run(); }}>{notice.action.label}</button>}
    </div>
  </div>;
}
