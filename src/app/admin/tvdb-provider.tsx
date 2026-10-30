"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import styles from "./tvdb-provider.module.css";

type Category = "Movies" | "Shows";
type MediaType = "movie" | "series";
export interface TvdbProviderStatus {
  credentialConfigured: boolean;
  pinConfigured: boolean;
  enabled: boolean;
  encryptionConfigured: boolean;
}
interface SearchResult {
  tvdbId: number;
  mediaType: MediaType;
  title: string;
  year?: number;
  synopsis: string;
}

function resultKey(result: SearchResult) {
  return `${result.mediaType}:${result.tvdbId}`;
}

export default function TvdbProvider({ status, onStatusChange }: { status: TvdbProviderStatus; onStatusChange: (status: TvdbProviderStatus) => void }) {
  const keyId = useId();
  const pinId = useId();
  const categoryId = useId();
  const [apiKey, setApiKey] = useState("");
  const [pin, setPin] = useState("");
  const [clearPin, setClearPin] = useState(false);
  const [enabled, setEnabled] = useState(status.enabled);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("Shows");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [searching, setSearching] = useState(false);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => setEnabled(status.enabled), [status.enabled]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/providers/tvdb/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, subscriberPin: pin, clearPin, enabled }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { status?: TvdbProviderStatus; error?: string };
      if (!response.ok || !data.status) throw new Error(data.error || "TheTVDB settings could not be saved.");
      onStatusChange(data.status);
      setApiKey("");
      setPin("");
      setClearPin(false);
      setMessage("TheTVDB settings saved. Credentials are encrypted in the database.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "TheTVDB settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) { setError("Enter at least two characters to search."); return; }
    setSearching(true);
    setSearched(false);
    setError("");
    setMessage("");
    setResults([]);
    try {
      const params = new URLSearchParams({ query: trimmed, category });
      const response = await fetch(`/api/admin/providers/tvdb/search?${params.toString()}`, { cache: "no-store" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { results?: SearchResult[]; error?: string };
      if (!response.ok || !Array.isArray(data.results)) throw new Error(data.error || "Search could not be completed.");
      setResults(data.results);
      setSearched(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search could not be completed.");
    } finally {
      setSearching(false);
    }
  }

  async function addResult(result: SearchResult) {
    const key = resultKey(result);
    if (importingKey || added.has(key)) return;
    setImportingKey(key);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/providers/tvdb/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tvdbId: result.tvdbId, mediaType: result.mediaType, category }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { entry?: { id: string; title: string; category: Category; hasTmdbArtwork: boolean }; error?: string };
      if (!response.ok || !data.entry) throw new Error(data.error || "This title could not be added.");
      setAdded(current => new Set([...current, key]));
      setMessage(`${data.entry.title} added to ${data.entry.category}.${data.entry.hasTmdbArtwork ? " A matching TMDB poster was attached." : " No exact TMDB poster match was found."}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This title could not be added.");
    } finally {
      setImportingKey(null);
    }
  }

  return <div className={styles.panel}>
    <section className={styles.settings} aria-labelledby="tvdb-settings-title">
      <div className={styles.heading}>
        <div><p className={styles.eyebrow}>SERVER-SIDE ACCESS</p><h3 id="tvdb-settings-title">TheTVDB API settings</h3><p>Enter your project API key here. It is encrypted before being saved to the database and never sent back to the browser.</p></div>
        <span className={`${styles.status} ${status.enabled ? styles.active : ""}`}>{status.enabled ? "Enabled" : status.credentialConfigured ? "Saved · inactive" : "Not configured"}</span>
      </div>
      {status.credentialConfigured && <p className={styles.savedHint}>A project key is saved{status.pinConfigured ? " and a subscriber PIN is saved" : ""}. Leave either field blank to keep its saved value.</p>}
      <form className={styles.settingsForm} onSubmit={saveSettings}>
        <label className={styles.field} htmlFor={keyId}><span>Project API key</span><input id={keyId} type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} value={apiKey} maxLength={512} required={!status.credentialConfigured} placeholder={status.credentialConfigured ? "Saved · leave blank to keep" : "Paste the API key from your TVDB dashboard"} onChange={event => setApiKey(event.target.value)} /></label>
        <label className={styles.field} htmlFor={pinId}><span>Subscriber PIN <small>Optional · only for user-supported keys</small></span><input id={pinId} type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} value={pin} maxLength={128} placeholder={status.pinConfigured ? "Saved · leave blank to keep" : "Enter the PIN if your key requires one"} onChange={event => setPin(event.target.value)} disabled={clearPin} /></label>
        {status.pinConfigured && <label className={styles.clearPin}><input type="checkbox" checked={clearPin} onChange={event => setClearPin(event.target.checked)} /><span>Remove the saved PIN</span></label>}
        <label className={styles.enable}><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span><strong>Enable TheTVDB search</strong><small>Use TVDB metadata for Movies and Shows. TMDB is used for artwork only when a title and year match exactly.</small></span></label>
        <button className={styles.save} type="submit" disabled={!status.encryptionConfigured || saving}>{saving ? "Saving…" : "Save TheTVDB settings"}</button>
      </form>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.success} role="status" aria-live="polite">{message}</p>}
      <p className={styles.terms}>TheTVDB v4 requires a project API key. User-supported access may require a subscriber PIN; do not share your PIN. See <a href="https://thetvdb.com/api-information" target="_blank" rel="noreferrer">TheTVDB API access details ↗</a>.</p>
    </section>

    {status.enabled && <section className={styles.catalogue} aria-labelledby="tvdb-catalogue-title">
      <div className={styles.heading}><div><p className={styles.eyebrow}>CURATE THE CATALOGUE</p><h3 id="tvdb-catalogue-title">Find titles on TheTVDB</h3><p>Search TVDB for text metadata, then add matching titles to the local catalogue.</p></div><span className={styles.sourceBadge}>Movies · Shows</span></div>
      <form className={styles.searchForm} onSubmit={search}>
        <label className={styles.field}><span>Title</span><input value={query} maxLength={80} autoComplete="off" placeholder="Try a film or series name" disabled={searching || importingKey !== null} onChange={event => setQuery(event.target.value)} /></label>
        <label className={styles.field} htmlFor={categoryId}><span>Add to</span><select id={categoryId} value={category} disabled={searching || importingKey !== null} onChange={event => { setCategory(event.target.value as Category); setResults([]); setSearched(false); setError(""); setMessage(""); }}><option value="Shows">Shows</option><option value="Movies">Movies</option></select></label>
        <button className={styles.searchButton} type="submit" disabled={searching || importingKey !== null || query.trim().length < 2}>{searching ? "Searching…" : "Search TVDB"}</button>
      </form>
      {searching && <p className={styles.state} role="status" aria-live="polite">Searching TheTVDB…</p>}
      {searched && results.length === 0 && <p className={styles.state}>No titles found. Try another spelling or category.</p>}
      {results.length > 0 && <><p className={styles.count} aria-live="polite">{results.length} {results.length === 1 ? "result" : "results"} · {category}</p><ul className={styles.results} aria-label={`TheTVDB search results for ${category}`} aria-busy={searching}>
        {results.map(result => {
          const key = resultKey(result);
          const isAdded = added.has(key);
          const isImporting = importingKey === key;
          return <li className={styles.result} key={key}><div className={styles.posterMark} aria-hidden="true">TVDB</div><div className={styles.resultCopy}><h4>{result.title}{result.year && <span> · {result.year}</span>}</h4><p className={styles.meta}>{category === "Shows" ? "Series" : "Movie"}</p>{result.synopsis && <p className={styles.synopsis}>{result.synopsis}</p>}</div><button className={styles.add} type="button" disabled={isAdded || importingKey !== null} onClick={() => void addResult(result)}>{isImporting ? "Adding…" : isAdded ? "Added" : "Add"}</button></li>;
        })}
      </ul></>}
      <p className={styles.attribution}>Text metadata provided by <a href="https://thetvdb.com" target="_blank" rel="noreferrer">TheTVDB ↗</a>. Posters are sourced separately from TMDB when an exact match is available.</p>
    </section>}
  </div>;
}
