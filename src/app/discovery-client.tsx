"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { categories, type Category, type MediaItem } from "@/data";
import { signOut } from "@/lib/auth-client";
import { rankSessionRecommendations } from "@/lib/recommendations";

type Decision = "keep" | "pass" | "seen";
interface SessionState {
  category: Category;
  lockedItemId: string | null;
  decisions: Record<string, Decision>;
  ratings: Record<string, number>;
  shortlisted: string[];
  saved: string[];
  history: Array<{ id: string; decision: Decision; rating?: number }>;
  reviewRemoved: string[];
  view: "discover" | "review";
  ageVerified: boolean;
}
const initialState = (): SessionState => ({ category:"Movies", lockedItemId:null, decisions:{}, ratings:{}, shortlisted:[], saved:[], history:[], reviewRemoved:[], view:"discover", ageVerified:false });
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

type IconName = "spark"|"back"|"close"|"left"|"check"|"bookmark"|"arrow"|"info"|"rewind"|"lock"|"eye";
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    spark:<><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/></>,
    back:<><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></>,
    close:<path d="m18 6-12 12M6 6l12 12"/>,
    left:<path d="m15 18-6-6 6-6"/>,
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
  isAdmin: boolean;
  adultSectionEnabled: boolean;
  mediaItems: MediaItem[];
  catalogueNotice: string;
  seerrConnections: Array<{ id: string; name: string }>;
  plexConnections: Array<{ id: string; name: string }>;
}

export default function DiscoveryClient({ appName, userName, isAdmin, adultSectionEnabled, mediaItems, catalogueNotice, seerrConnections, plexConnections }: DiscoveryClientProps) {
  const [session, setSession] = useState<SessionState>(initialState);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "error">("saving");
  const [details, setDetails] = useState<MediaItem|null>(null);
  const [ratingSelectorOpen, setRatingSelectorOpen] = useState(false);
  const [ageOpen, setAgeOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
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
  const accountMenu = useRef<HTMLDetailsElement|null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveVersion = useRef(0);
  const catalogue = mediaItems.filter(item => adultSectionEnabled || item.category !== "Adult");
  const categoryItems = catalogue.filter(item => item.category === session.category);
  const recommendations = rankSessionRecommendations(categoryItems, session.decisions, session.ratings);
  const items = recommendations.items;
  const remainingItems = items.filter(candidate => !session.decisions[candidate.id]);
  const item = remainingItems.find(candidate => candidate.id === session.lockedItemId) ?? remainingItems[0];
  const nextItem = remainingItems.find(candidate => candidate.id !== item?.id);
  const picks = session.shortlisted.map(id => catalogue.find(candidate => candidate.id === id)).filter((candidate): candidate is MediaItem => Boolean(candidate));
  const removed = session.reviewRemoved.map(id => catalogue.find(candidate => candidate.id === id)).filter((candidate): candidate is MediaItem => Boolean(candidate));
  const saved = session.saved.map(id => catalogue.find(candidate => candidate.id === id)).filter((candidate): candidate is MediaItem => Boolean(candidate));
  const seenCount = categoryItems.length - categoryItems.filter(candidate => !session.decisions[candidate.id]).length;

  useEffect(() => {
    let cancelled = false;
    async function loadState() {
      setLoadError("");
      try {
        const response = await fetch("/api/discovery-state", { cache: "no-store" });
        if (response.status === 401) { window.location.replace("/sign-in"); return; }
        if (!response.ok) throw new Error("The saved session could not be loaded.");
        let stored = await response.json() as Partial<SessionState>;
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
        if ((next.category as string) === "TV") next.category = "Shows";
        if (!adultSectionEnabled && next.category === "Adult") next.category = "Movies";
        const availableIds = new Set(catalogue.map(candidate => candidate.id));
        next.shortlisted = next.shortlisted.filter(id => typeof id === "string" && availableIds.has(id));
        next.saved = next.saved.filter(id => typeof id === "string" && availableIds.has(id));
        next.reviewRemoved = next.reviewRemoved.filter(id => typeof id === "string" && availableIds.has(id));
        const storedRatings = next.ratings ?? {};
        const validRating = (rating: unknown) => typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5;
        next.decisions = Object.fromEntries(Object.entries(next.decisions).filter(([id, decision]) => availableIds.has(id) && (decision === "keep" || decision === "pass" || decision === "seen" && validRating(storedRatings[id]))));
        next.ratings = Object.fromEntries(Object.entries(storedRatings).filter(([id, rating]) => availableIds.has(id) && next.decisions[id] === "seen" && validRating(rating)));
        next.history = next.history.filter(entry => entry && typeof entry.id === "string" && availableIds.has(entry.id) && (entry.decision === "keep" || entry.decision === "pass" || entry.decision === "seen" && validRating(entry.rating)));
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
    if (!ready) return;
    setSaveStatus("saving");
    const version = ++saveVersion.current;
    const snapshot = JSON.stringify(session);
    const timer = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
        const response = await fetch("/api/discovery-state", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: snapshot,
        });
        if (response.status === 401) { window.location.replace("/sign-in"); return; }
        if (!response.ok) throw new Error("Discovery state save failed.");
        try {
          if (localStorage.getItem("choice-fatigue-legacy-pending") === "1") {
            localStorage.removeItem("elsewhere-discovery-v1");
            localStorage.removeItem("choice-fatigue-legacy-pending");
          }
        } catch { /* Browser storage is optional once the server copy is saved. */ }
        if (version === saveVersion.current) setSaveStatus("saved");
      }).catch(() => { if (version === saveVersion.current) setSaveStatus("error"); });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [ready, session]);

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
    const historyEntry = decision === "seen" ? {id:currentItem.id, decision, rating:rating!} : {id:currentItem.id, decision};
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
    setSession(current => {
      const last=current.history.at(-1);
      if (!last) return current;
      const decisions={...current.decisions}; delete decisions[last.id];
      const ratings={...current.ratings}; delete ratings[last.id];
      const restoredCategory=catalogue.find(candidate=>candidate.id===last.id)?.category ?? current.category;
      return {...current, category:restoredCategory, lockedItemId:last.id, view:"discover", decisions, ratings, shortlisted:current.shortlisted.filter(id=>id!==last.id), history:current.history.slice(0,-1)};
    });
    setRatingSelectorOpen(false);
  }
  function changeCategory(category:Category) {
    if (category === "Adult" && !session.ageVerified) { setAgeOpen(true); return; }
    setSession(current=>({...current, category, lockedItemId:category === current.category ? current.lockedItemId : null, view:"discover"})); setDetails(null); setRatingSelectorOpen(false);
  }
  function removePick(id:string) {
    setSession(current=>{ const decisions={...current.decisions}; delete decisions[id]; return {...current, shortlisted:current.shortlisted.filter(value=>value!==id), decisions}; });
    showNotice("Back in discovery — your first impression still counts.");
  }
  function beginReview() { setSession(current=>({...current, reviewRemoved:[], view:"review"})); }
  function leaveReview() { setSession(current=>({...current, reviewRemoved:[], view:"discover"})); }
  function removeFromReview(id:string) {
    setSession(current=>{ const decisions={...current.decisions}; delete decisions[id]; return {...current, shortlisted:current.shortlisted.filter(value=>value!==id), decisions, reviewRemoved:[...new Set([...current.reviewRemoved,id])]}; });
    showNotice("Removed for now — you can restore it below.");
  }
  function restorePick(id:string) {
    setSession(current=>({...current, shortlisted:[...new Set([...current.shortlisted,id])], decisions:{...current.decisions,[id]:"keep"}, reviewRemoved:current.reviewRemoved.filter(value=>value!==id)}));
    showNotice("Restored to your shortlist");
  }
  function savePicks() {
    if (!picks.length) return;
    const count=picks.length;
    const visiblePickIds=picks.map(pick=>pick.id);
    setSession(current=>({...current, saved:[...new Set([...current.saved,...visiblePickIds])], shortlisted:current.shortlisted.filter(id=>!visiblePickIds.includes(id)), reviewRemoved:current.reviewRemoved.filter(id=>!visiblePickIds.includes(id)), view:"discover"}));
    setSavedOpen(true); showNotice(`${count} ${count===1?"title":"titles"} saved for later`);
  }
  function startFresh() {
    setSession(current=>({...current, lockedItemId:null, decisions:{}, ratings:{}, shortlisted:[], history:[], reviewRemoved:[], view:"discover"}));
    setRatingSelectorOpen(false);
    showNotice("Fresh session started");
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
        await fetch("/api/discovery-state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(session) });
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
          <div className="discover-intro"><div><div className="eyebrow"><span className="live-dot"/> YOUR DISCOVERY SESSION</div><h1>{session.category}</h1><p>{session.category==="Adult"?"A private space, for grown-ups only.":recommendations.signalCount?"Shortlists, passes, and your star ratings shape what appears next.":"Pass, shortlist, or mark a title as seen and rate it to shape what comes next."}</p></div><button className="session-chip" onClick={startFresh} title="Start a fresh session"><Icon name="spark"/><span>Current session</span></button></div>
          {item ? <div className="deck-wrap"><div className="deck-meta"><span>{session.category.toUpperCase()} <i>·</i> {item.year}</span><span>{String(seenCount+1).padStart(2,"0")} <small>/ {String(items.length).padStart(2,"0")}</small></span></div>
            <div className={`card-stack ${nextItem ? "has-next-card" : ""}`} aria-label="Media discovery card">
              {nextItem && renderMediaCard(nextItem, false)}
              {renderMediaCard(item, true)}
            </div>
            <div className="decision-row"><button className="decision-button pass" onClick={()=>transitionDecision("pass")} disabled={cardExiting} aria-label="Pass, left arrow key"><span><Icon name="close"/></span><small>PASS <kbd>←</kbd></small></button><button className="undo-inline" onClick={undo} disabled={!session.history.length} aria-label="Undo last choice"><Icon name="rewind"/></button><button className="decision-button keep" onClick={()=>transitionDecision("keep")} disabled={cardExiting} aria-label="Shortlist, right arrow key"><span><Icon name="check"/></span><small>SHORTLIST <kbd>→</kbd></small></button></div>
            <p className="gesture-hint">Drag the card, or use <kbd>←</kbd> pass and <kbd>→</kbd> shortlist</p><div className="progress-track"><span style={{width:`${Math.min(100,seenCount/items.length*100)}%`}}/></div>
          </div> : <div className="empty-state"><div className="empty-orbit"><Icon name="spark"/></div><h2>That’s everything for now.</h2><p>You’ve seen all the {session.category.toLowerCase()} in this little collection.</p><button className="button button-dark" onClick={beginReview}>Review your shortlist <Icon name="arrow"/></button></div>}
          <div className="bottom-note"><Icon name="spark"/><span role="status">{saveStatus === "error" ? "Couldn’t sync your choices. They’ll retry automatically." : saveStatus === "saving" ? "Syncing your choices…" : "Your choices sync to your account."}</span><button onClick={beginReview}>Review picks <b>{picks.length}</b> <Icon name="arrow"/></button></div>
        </div>}
      </section>
      {session.view==="discover"&&<aside className="shortlist-panel"><div className="panel-heading"><div><div className="eyebrow">YOUR SHORTLIST</div><h2>Your shortlist <span>{picks.length}</span></h2></div><button className="small-icon" onClick={undo} aria-label="Undo last choice" disabled={!session.history.length}><Icon name="rewind"/></button></div><p className="panel-copy">Temporary picks to compare before saving.</p>
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
            <div className="saved-item-copy"><strong>{pick.title}</strong><small>{pick.year} · {pick.category}</small>
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
