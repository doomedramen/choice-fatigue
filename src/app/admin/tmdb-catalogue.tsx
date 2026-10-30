"use client";

import { useId, useState, type FormEvent } from "react";
import styles from "./tmdb-catalogue.module.css";

type Category = "Movies" | "TV";
type MediaType = "movie" | "tv";
interface SearchResult {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year?: number;
  synopsis: string;
  posterUrl?: string;
}

function resultKey(result: SearchResult, category: Category) {
  return `${category}:${result.mediaType}:${result.tmdbId}`;
}

export default function TmdbCatalogue() {
  const queryId = useId();
  const categoryId = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("Movies");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [searching, setSearching] = useState(false);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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
      const params = new URLSearchParams({ query: trimmed, category });
      const response = await fetch(`/api/admin/providers/tmdb/search?${params.toString()}`, { cache: "no-store" });
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
    const key = resultKey(result, category);
    if (importingKey || added.has(key)) return;
    setImportingKey(key);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/providers/tmdb/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tmdbId: result.tmdbId, mediaType: result.mediaType, category }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { entry?: { id: string; title: string; category: Category }; error?: string };
      if (!response.ok || !data.entry) throw new Error(data.error || "This title could not be added.");
      setAdded(current => new Set([...current, key]));
      setMessage(`${data.entry.title} added to ${data.entry.category}. It will appear in discovery the next time it loads.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This title could not be added.");
    } finally {
      setImportingKey(null);
    }
  }

  return <section className={styles.root} aria-labelledby="tmdb-catalogue-title">
    <div className={styles.heading}>
      <div>
        <p className={styles.eyebrow}>CURATE THE CATALOGUE</p>
        <h3 id="tmdb-catalogue-title">Find titles on TMDB</h3>
        <p>Search movies or TV series and add them to the local catalogue. Anime series are found under TV; anime films are found under Movies.</p>
      </div>
      <span className={styles.sourceBadge}>Movies · TV</span>
    </div>

    <form className={styles.searchForm} onSubmit={search}>
      <label className={styles.queryField} htmlFor={queryId}>
        <span>Title</span>
        <input id={queryId} value={query} maxLength={80} autoComplete="off" placeholder="Try a title or series name" disabled={searching || importingKey !== null} onChange={event => setQuery(event.target.value)} />
      </label>
      <label className={styles.categoryField} htmlFor={categoryId}>
        <span>Add to</span>
        <select id={categoryId} value={category} disabled={searching || importingKey !== null} onChange={event => { setCategory(event.target.value as Category); setResults([]); setSearched(false); setError(""); setMessage(""); }}>
          <option value="Movies">Movies</option>
          <option value="TV">TV</option>
        </select>
      </label>
      <button className={styles.searchButton} type="submit" disabled={searching || importingKey !== null || query.trim().length < 2}>
        {searching ? "Searching…" : "Search TMDB"}
      </button>
    </form>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status" aria-live="polite">{message}</p>}
    {searching && <p className={styles.stateMessage} role="status" aria-live="polite">Searching TMDB…</p>}
    {searched && results.length === 0 && <p className={styles.emptyState}>No titles found. Try another spelling or category.</p>}

    {results.length > 0 && <>
      <p className={styles.resultCount} aria-live="polite">{results.length} {results.length === 1 ? "result" : "results"} · {category}</p>
      <ul className={styles.results} aria-label={`TMDB search results for ${category}`} aria-busy={searching}>
        {results.map(result => {
          const key = resultKey(result, category);
          const isAdded = added.has(key);
          const isImporting = importingKey === key;
          return <li className={styles.result} key={key}>
            {result.posterUrl ? <img className={styles.poster} src={result.posterUrl} alt="" width="58" height="84" loading="lazy" /> : <span className={styles.posterPlaceholder} aria-hidden="true">✳</span>}
            <div className={styles.resultCopy}>
              <h4>{result.title}{result.year ? <span> · {result.year}</span> : null}</h4>
              <p className={styles.resultMeta}>{result.mediaType === "movie" ? "Movie" : "TV series"}</p>
              <p className={styles.synopsis}>{result.synopsis || "No overview is available."}</p>
            </div>
            <button className={styles.addButton} type="button" onClick={() => void addResult(result)} disabled={isAdded || importingKey !== null || searching} aria-label={isAdded ? `${result.title} added` : `Add ${result.title} to ${category}`}>
              {isImporting ? "Adding…" : isAdded ? "Added" : "Add"}
            </button>
          </li>;
        })}
      </ul>
    </>}
  </section>;
}
