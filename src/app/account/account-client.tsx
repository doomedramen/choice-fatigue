"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { recommendationPreferenceProfile, type RecommendationSignal } from "@/lib/recommendations";
import "./account.css";

type PreferenceCategory = "Movies" | "Shows" | "Adult";
type PreferenceProfile = { category: PreferenceCategory; signals: RecommendationSignal[]; failed: boolean };

function preferenceName(key: string) {
  const [kind, value = ""] = key.split(":");
  if (kind === "decade") return `${value}s`;
  if (kind === "type") return value === "tv" ? "Series" : value.charAt(0).toUpperCase() + value.slice(1);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function PreferenceList({ title, preferences }: { title: string; preferences: ReturnType<typeof recommendationPreferenceProfile> }) {
  if (!preferences.length) return null;
  return <div className="preference-group"><h4>{title}</h4><ul>{preferences.map(preference => <li key={preference.key}><span>{preferenceName(preference.key)}</span><small>{preference.evidenceCount} {preference.evidenceCount === 1 ? "signal" : "signals"}</small></li>)}</ul></div>;
}

function TasteProfile({ revision }: { revision: number }) {
  const [profiles, setProfiles] = useState<PreferenceProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    async function loadProfiles() {
      const loaded: PreferenceProfile[] = [];
      for (const category of ["Movies", "Shows", "Adult"] as const) {
        try {
          const query = new URLSearchParams({ category, profile: "1" });
          const response = await fetch(`/api/recommendation-events?${query}`, { cache: "no-store" });
          if (response.status === 401) { window.location.replace("/sign-in"); return; }
          if (category === "Adult" && response.status === 403) continue;
          if (!response.ok) {
            loaded.push({ category, signals: [], failed: true });
            continue;
          }
          const data = await response.json() as { signals?: RecommendationSignal[] };
          loaded.push({ category, signals: Array.isArray(data.signals) ? data.signals : [], failed: false });
        } catch {
          loaded.push({ category, signals: [], failed: true });
        }
      }
      if (!cancelled) setProfiles(loaded);
      if (!cancelled) setLoading(false);
    }
    void loadProfiles();
    return () => { cancelled = true; };
  }, [revision]);

  return <section className="account-panel taste-profile" aria-labelledby="taste-profile-title">
    <div className="account-panel-heading"><div><p className="account-eyebrow">PERSONALISATION</p><h2 id="taste-profile-title">What we’re learning about your taste</h2><p>Your profile shows patterns from your choices, with each category learned separately.</p></div></div>
    <p className="taste-profile-method">Shortlists, passes, and star ratings shape these signals. Saved titles count more. Genres have more influence than era and format. Shortlist comparisons add a small ranking nudge that isn’t summarized here. Provider ratings don’t affect this profile.</p>
    {loading ? <p className="taste-profile-status" role="status">Loading your preference profile…</p> : <div className="taste-profile-categories">
      {profiles.map(profile => {
        const usableSignals = profile.signals.filter(signal => signal.featureKeys?.length);
        const titleCount = new Set(usableSignals.map(signal => signal.itemId)).size;
        const preferences = recommendationPreferenceProfile(profile.signals);
        const leaning = preferences.filter(preference => preference.score >= 0.12).slice(0, 4);
        const passing = preferences.filter(preference => preference.score <= -0.12).sort((a, b) => a.score - b.score).slice(0, 4);
        return <article className="taste-category" key={profile.category}>
          <div className="taste-category-heading"><h3>{profile.category}</h3>{titleCount > 0 && <span>{titleCount} recent {titleCount === 1 ? "title" : "titles"}</span>}</div>
          {profile.failed ? <p className="taste-profile-status">We couldn’t load these signals just now. Try again later.</p> : titleCount === 0 ? profile.signals.length > 0 ? <p className="taste-profile-status">Your choices are saved, but title details aren’t available to build a profile right now.</p> : <p className="taste-profile-status">Your profile is taking shape. Shortlist, pass on, or rate a few titles to get started.</p> : <>
            {titleCount < 3 && <p className="taste-profile-status">Early hints only—more choices will make this profile clearer.</p>}
            <div className="taste-profile-groups">
              <PreferenceList title="Leans toward" preferences={leaning}/>
              <PreferenceList title="Often passes on" preferences={passing}/>
              {!leaning.length && !passing.length && <p className="taste-profile-status">No strong pattern yet. Keep browsing and your profile will take shape.</p>}
            </div>
          </>}
        </article>;
      })}
    </div>}
    <p className="taste-profile-footnote">Title details are fetched when needed and aren’t saved as a local catalogue. Each category summarizes up to four recent titles whose details are available.</p>
  </section>;
}

export default function AccountClient({ userId, name, email, isAdmin }: { userId: string; name: string; email: string; isAdmin: boolean }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resettingRecommendations, setResettingRecommendations] = useState(false);
  const [recommendationNotice, setRecommendationNotice] = useState("");
  const [profileRevision, setProfileRevision] = useState(0);
  const canDelete = password.length > 0 && confirmation === "DELETE" && !pending;

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDelete) return;
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const result = await authClient.deleteUser({ password });
      if (result.error) {
        setError(result.error.message || "Your account could not be deleted. Please try again.");
        setPending(false);
        return;
      }
      setSuccess("Your account was deleted. Taking you to sign in…");
      window.setTimeout(() => window.location.replace("/sign-in"), 800);
    } catch {
      setError("We couldn’t reach Choice Fatigue. Check your connection and try again.");
      setPending(false);
    }
  }

  async function clearRecommendationHistory() {
    if (!window.confirm("Clear your saved recommendation history? Your current discovery session will continue to influence this session only.")) return;
    setResettingRecommendations(true);
    setRecommendationNotice("");
    try {
      const response = await fetch("/api/recommendation-events", { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Recommendation history could not be cleared.");
      try { localStorage.removeItem(`choice-fatigue-learning-${userId}`); } catch { /* Local storage is optional. */ }
      setProfileRevision(revision => revision + 1);
      setRecommendationNotice("Saved recommendation history cleared. Current-session choices still apply until you start a fresh session.");
    } catch (cause) {
      setRecommendationNotice(cause instanceof Error ? cause.message : "Recommendation history could not be cleared.");
    } finally {
      setResettingRecommendations(false);
    }
  }

  return <div className="account-page">
    <header className="account-header"><Link href="/" className="account-brand"><span aria-hidden="true">✳</span> Choice Fatigue</Link><Link href="/" className="account-back">← Back to discovery</Link></header>
    <main className="account-main">
      <div className="account-heading"><p className="account-eyebrow">YOUR PROFILE</p><h1>Account settings</h1><p>Manage your profile and your Choice Fatigue data.</p></div>
      <section className="account-panel" aria-labelledby="profile-title"><div className="account-panel-heading"><div><p className="account-eyebrow">PROFILE DETAILS</p><h2 id="profile-title">Your information</h2></div></div><dl className="profile-details"><div><dt>Name</dt><dd>{name}</dd></div><div><dt>Email address</dt><dd>{email}</dd></div></dl></section>
      <TasteProfile revision={profileRevision} />
      <section className="account-panel" aria-labelledby="data-title"><div className="account-panel-heading"><div><p className="account-eyebrow">YOUR DATA</p><h2 id="data-title">Take your choices with you</h2><p>Download a copy of your profile and discovery data.</p></div></div><a className="account-download" href="/api/account/export">Download my data <span aria-hidden="true">↓</span></a></section>
      <section className="account-panel" aria-labelledby="recommendation-title"><div className="account-panel-heading"><div><p className="account-eyebrow">PERSONALISATION</p><h2 id="recommendation-title">Recommendation history</h2><p>Earlier choices help shape future sessions. Adult choices are kept separate from Movies and Shows.</p></div></div><button className="account-download" type="button" onClick={() => void clearRecommendationHistory()} disabled={resettingRecommendations}>{resettingRecommendations ? "Clearing…" : "Clear recommendation history"}</button>{recommendationNotice && <p role="status" className="account-success">{recommendationNotice}</p>}</section>
      <section className="account-panel" aria-labelledby="connections-title"><div className="account-panel-heading"><div><p className="account-eyebrow">INSTANCE SERVICES</p><h2 id="connections-title">Shared services</h2><p>Media services are configured for this instance and shared with all accounts.</p></div></div>{isAdmin && <Link className="account-download" href="/admin?section=services">Manage services <span aria-hidden="true">→</span></Link>}</section>
      <section className="account-danger" aria-labelledby="delete-title"><div className="account-panel-heading"><div><p className="account-eyebrow">DANGER ZONE</p><h2 id="delete-title">Delete your account</h2><p>This permanently deletes your account and saved discovery data. You’ll be signed out immediately.</p></div></div><form className="delete-form" onSubmit={deleteAccount}>
        <label className="account-field">Confirm your password<input type="password" name="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)} /></label>
        <label className="account-field">Type <code>DELETE</code> to confirm<input type="text" name="confirmation" autoComplete="off" autoCapitalize="characters" spellCheck={false} required value={confirmation} onChange={event=>setConfirmation(event.target.value)} aria-describedby="delete-confirm-help" /><span className="account-field-hint" id="delete-confirm-help">Enter the word DELETE in capital letters.</span></label>
        {error && <p className="account-error" role="alert">{error}</p>}{success && <p className="account-success" role="status">{success}</p>}
        <button className="account-delete-button" type="submit" disabled={!canDelete}>{pending ? "Deleting account…" : "Permanently delete account"}</button>
      </form></section>
    </main>
  </div>;
}
