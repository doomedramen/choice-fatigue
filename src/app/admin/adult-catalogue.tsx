"use client";

import { useId, useState, type FormEvent } from "react";
import styles from "./adult-catalogue.module.css";

type Provider = "theporndb" | "stashdb";
type AdultKind = "scene" | "movie";
interface AdultSearchResult {
  sourceId: string;
  kind?: AdultKind;
  title: string;
  year?: number;
  synopsis: string;
  runtime?: string;
  genres: string[];
}

function resultKey(provider: Provider, kind: AdultKind, sourceId: string) {
  return `${provider}:${kind}:${sourceId}`;
}

async function readError(response: Response, fallback: string) {
  try {
    const data = await response.json() as { error?: string };
    if (data.error) return data.error;
  } catch { /* Use the local fallback for non-JSON or empty responses. */ }
  if (response.status === 503) return "This Adult metadata source is not enabled on the server yet.";
  return fallback;
}

export default function AdultCatalogue({ enabledProviders }: { enabledProviders: Record<Provider, boolean> }) {
  const queryId = useId();
  const providerId = useId();
  const kindId = useId();
  const [provider, setProvider] = useState<Provider>(() => enabledProviders.theporndb ? "theporndb" : "stashdb");
  const [kind, setKind] = useState<AdultKind>("scene");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdultSearchResult[]>([]);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [searching, setSearching] = useState(false);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function changeProvider(nextProvider: Provider) {
    setProvider(nextProvider);
    setResults([]);
    setSearched(false);
    setError("");
    setMessage("");
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("Enter at least two characters to search.");
      setMessage("");
      return;
    }

    setSearching(true);
    setSearched(false);
    setError("");
    setMessage("");
    setResults([]);
    try {
      const params = new URLSearchParams({ query: trimmed });
      const endpoint = provider === "theporndb"
        ? `/api/admin/providers/theporndb/search?${new URLSearchParams({ query: trimmed, kind }).toString()}`
        : `/api/admin/providers/stashdb/search?${params.toString()}`;
      const response = await fetch(endpoint, { cache: "no-store" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { results?: AdultSearchResult[]; error?: string };
      if (!response.ok || !Array.isArray(data.results)) throw new Error(data.error || (response.status === 503 ? "This Adult metadata source is not enabled on the server yet." : "Search could not be completed."));
      setResults(data.results);
      setSearched(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search could not be completed.");
    } finally {
      setSearching(false);
    }
  }

  async function addResult(result: AdultSearchResult) {
    const resultKind: AdultKind = provider === "stashdb" ? "scene" : result.kind ?? kind;
    const key = resultKey(provider, resultKind, result.sourceId);
    if (importingKey || added.has(key)) return;
    setImportingKey(key);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/providers/${provider}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(provider === "stashdb" ? { sourceId: result.sourceId } : { sourceId: result.sourceId, kind: resultKind }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { entry?: { id: string; title: string; category: "Adult"; year?: number }; error?: string };
      if (!response.ok || !data.entry) throw new Error(data.error || (response.status === 503 ? "This Adult metadata source is not enabled on the server yet." : "This title could not be added."));
      setAdded(current => new Set([...current, key]));
      setMessage(`${data.entry.title} added to the Adult catalogue. It will appear in discovery the next time it loads.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This title could not be added.");
    } finally {
      setImportingKey(null);
    }
  }

  return <section className={styles.root} aria-labelledby="adult-catalogue-title">
    <div className={styles.heading}>
      <div>
        <p className={styles.eyebrow}>ADULT CATALOGUE</p>
        <h3 id="adult-catalogue-title">Find adult titles</h3>
        <p>Search scene and movie metadata, then add selected entries to the local catalogue. Results contain text only; source imagery is not shown.</p>
      </div>
      <span className={styles.sourceBadge}>18+ · metadata only</span>
    </div>

    <form className={styles.searchForm} onSubmit={search}>
      <label className={styles.providerField} htmlFor={providerId}>
        <span>Provider</span>
        <select id={providerId} value={provider} disabled={searching || importingKey !== null} onChange={event => changeProvider(event.target.value as Provider)}>
          <option value="theporndb" disabled={!enabledProviders.theporndb}>ThePornDB</option>
          <option value="stashdb" disabled={!enabledProviders.stashdb}>StashDB</option>
        </select>
      </label>
      {provider === "theporndb" && <label className={styles.kindField} htmlFor={kindId}>
        <span>Content type</span>
        <select id={kindId} value={kind} disabled={searching || importingKey !== null} onChange={event => { setKind(event.target.value as AdultKind); setResults([]); setSearched(false); setError(""); setMessage(""); }}>
          <option value="scene">Scenes</option>
          <option value="movie">Movies</option>
        </select>
      </label>}
      <label className={styles.queryField} htmlFor={queryId}>
        <span>{provider === "theporndb" ? "Title or scene" : "Scene, performer, or studio"}</span>
        <input id={queryId} value={query} maxLength={80} autoComplete="off" placeholder="Enter a title or name" disabled={searching || importingKey !== null} onChange={event => setQuery(event.target.value)} />
      </label>
      <button className={styles.searchButton} type="submit" disabled={searching || importingKey !== null || query.trim().length < 2}>
        {searching ? "Searching…" : "Search source"}
      </button>
    </form>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status" aria-live="polite">{message}</p>}
    {searching && <p className={styles.stateMessage} role="status" aria-live="polite">Searching {provider === "theporndb" ? "ThePornDB" : "StashDB"}…</p>}
    {searched && results.length === 0 && <p className={styles.emptyState}>No results found. Try another spelling or content type.</p>}

    {results.length > 0 && <>
      <p className={styles.resultCount} aria-live="polite">{results.length} {results.length === 1 ? "result" : "results"} · {provider === "theporndb" ? (kind === "scene" ? "Scenes" : "Movies") : "StashDB scenes"}</p>
      <ul className={styles.results} aria-label={`Adult metadata search results from ${provider === "theporndb" ? "ThePornDB" : "StashDB"}`} aria-busy={searching}>
        {results.map(result => {
          const resultKind: AdultKind = provider === "stashdb" ? "scene" : result.kind ?? kind;
          const key = resultKey(provider, resultKind, result.sourceId);
          const isAdded = added.has(key);
          const isImporting = importingKey === key;
          const meta = [provider === "stashdb" ? "StashDB scene" : `ThePornDB ${resultKind}`, result.year, result.runtime].filter(Boolean).join(" · ");
          return <li className={styles.result} key={key}>
            <div className={styles.resultCopy}>
              <h4>{result.title}{result.year ? <span> · {result.year}</span> : null}</h4>
              <p className={styles.resultMeta}>{meta}</p>
              <p className={styles.synopsis}>{result.synopsis || "No description is available."}</p>
              {result.genres.length > 0 && <ul className={styles.genres} aria-label="Genres">{result.genres.slice(0, 5).map(genre => <li key={genre}>{genre}</li>)}</ul>}
            </div>
            <button className={styles.addButton} type="button" onClick={() => void addResult(result)} disabled={isAdded || importingKey !== null || searching} aria-label={isAdded ? `${result.title} added` : `Add ${result.title} to Adult catalogue`}>
              {isImporting ? "Adding…" : isAdded ? "Added" : "Add"}
            </button>
          </li>;
        })}
      </ul>
    </>}
  </section>;
}
