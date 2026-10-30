"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import "./account.css";

export default function AccountClient({ name, email }: { name: string; email: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
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

  return <div className="account-page">
    <header className="account-header"><Link href="/" className="account-brand"><span aria-hidden="true">✳</span> Choice Fatigue</Link><Link href="/" className="account-back">← Back to discovery</Link></header>
    <main className="account-main">
      <div className="account-heading"><p className="account-eyebrow">YOUR PROFILE</p><h1>Account settings</h1><p>Manage your profile and your Choice Fatigue data.</p></div>
      <section className="account-panel" aria-labelledby="profile-title"><div className="account-panel-heading"><div><p className="account-eyebrow">PROFILE DETAILS</p><h2 id="profile-title">Your information</h2></div></div><dl className="profile-details"><div><dt>Name</dt><dd>{name}</dd></div><div><dt>Email address</dt><dd>{email}</dd></div></dl></section>
      <section className="account-panel" aria-labelledby="data-title"><div className="account-panel-heading"><div><p className="account-eyebrow">YOUR DATA</p><h2 id="data-title">Take your choices with you</h2><p>Download a copy of your profile and discovery data.</p></div></div><a className="account-download" href="/api/account/export">Download my data <span aria-hidden="true">↓</span></a></section>
      <section className="account-danger" aria-labelledby="delete-title"><div className="account-panel-heading"><div><p className="account-eyebrow">DANGER ZONE</p><h2 id="delete-title">Delete your account</h2><p>This permanently deletes your account and saved discovery data. You’ll be signed out immediately.</p></div></div><form className="delete-form" onSubmit={deleteAccount}>
        <label className="account-field">Confirm your password<input type="password" name="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)} /></label>
        <label className="account-field">Type <code>DELETE</code> to confirm<input type="text" name="confirmation" autoComplete="off" autoCapitalize="characters" spellCheck={false} required value={confirmation} onChange={event=>setConfirmation(event.target.value)} aria-describedby="delete-confirm-help" /><span className="account-field-hint" id="delete-confirm-help">Enter the word DELETE in capital letters.</span></label>
        {error && <p className="account-error" role="alert">{error}</p>}{success && <p className="account-success" role="status">{success}</p>}
        <button className="account-delete-button" type="submit" disabled={!canDelete}>{pending ? "Deleting account…" : "Permanently delete account"}</button>
      </form></section>
    </main>
  </div>;
}
