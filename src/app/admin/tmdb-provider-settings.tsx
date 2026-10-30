"use client";

import { useId, useState, type FormEvent } from "react";
import styles from "./tmdb-provider-settings.module.css";

export interface TmdbProviderStatus {
  credentialConfigured: boolean;
  enabled: boolean;
  encryptionConfigured: boolean;
}

export default function TmdbProviderSettings({ status, onStatusChange }: { status: TmdbProviderStatus; onStatusChange: (status: TmdbProviderStatus) => void }) {
  const tokenId = useId();
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(status.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/providers/tmdb/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: token, enabled }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const data = await response.json() as { status?: TmdbProviderStatus; error?: string };
      if (!response.ok || !data.status) throw new Error(data.error || "TMDB settings could not be saved.");
      onStatusChange(data.status);
      setToken("");
      setMessage("TMDB settings saved. The token is encrypted in the database.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "TMDB settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <section className={styles.root} aria-labelledby="tmdb-provider-title">
    <div className={styles.heading}><div><p className={styles.eyebrow}>CREDENTIALS</p><h3 id="tmdb-provider-title">TMDB API settings</h3><p>Enter the API Read Access Token from your TMDB account. It is encrypted before saving and never sent back to the browser.</p></div><span className={`${styles.status} ${status.enabled ? styles.active : ""}`}>{status.enabled ? "Enabled" : status.credentialConfigured ? "Saved · inactive" : "Not configured"}</span></div>
    {status.credentialConfigured && <p className={styles.savedHint}>A token is saved in the database. Leave this field blank to keep it, or enter a new token to replace it.</p>}
    <form className={styles.form} onSubmit={save}>
      <label className={styles.field} htmlFor={tokenId}><span>API Read Access Token</span><input id={tokenId} type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} value={token} maxLength={2048} required={!status.credentialConfigured} placeholder={status.credentialConfigured ? "Saved · leave blank to keep" : "Paste the long Bearer token from TMDB API settings"} onChange={event => setToken(event.target.value)} /></label>
      <label className={styles.enable}><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span><strong>Enable TMDB Movies and Shows feed</strong><small>Use popular titles for Movies and Shows, including anime series under Shows. Adult titles are kept separate.</small></span></label>
      <button className={styles.save} type="submit" disabled={!status.encryptionConfigured || saving}>{saving ? "Saving…" : "Save TMDB settings"}</button>
    </form>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status" aria-live="polite">{message}</p>}
    <p className={styles.terms}>TMDB artwork can be used for Movies and Shows within this app. Anime films are under Movies; anime series are under Shows. View the <a href="https://developer.themoviedb.org/docs/authentication-application" target="_blank" rel="noreferrer">TMDB token instructions ↗</a>.</p>
  </section>;
}
