"use client";

import { useEffect, useId, useState, type FormEvent } from "react";

export interface AdultProviderStatus {
  credentialConfigured: boolean;
  enabled: boolean;
  encryptionConfigured: boolean;
}

export default function AdultProviderSettings({
  provider,
  title,
  description,
  status,
  onStatusChange,
}: {
  provider: "theporndb" | "stashdb";
  title: string;
  description: string;
  status: AdultProviderStatus;
  onStatusChange: (status: AdultProviderStatus) => void;
}) {
  const keyId = useId();
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(status.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => setEnabled(status.enabled), [status.enabled]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/providers/${provider}/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, enabled }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { status?: AdultProviderStatus; error?: string };
      if (!response.ok || !data.status) throw new Error(data.error || `${title} settings could not be saved.`);
      onStatusChange(data.status);
      setApiKey("");
      setMessage(`${title} settings saved. The key is encrypted in the database.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${title} settings could not be saved.`);
    } finally {
      setSaving(false);
    }
  }

  async function removeCredential() {
    if (!status.credentialConfigured || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/providers/${provider}/config`, { method: "DELETE" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { status?: AdultProviderStatus; error?: string };
      if (!response.ok || !data.status) throw new Error(data.error || `${title} key could not be removed.`);
      onStatusChange(data.status);
      setEnabled(false);
      setMessage(`${title} key removed.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${title} key could not be removed.`);
    } finally {
      setSaving(false);
    }
  }

  return <article className="provider">
    <div className="provider-top">
      <div><h3>{title}</h3><p>{description}</p></div>
      <span className="status-pill">{status.enabled ? "Enabled" : status.credentialConfigured ? "Saved · inactive" : "Not configured"}</span>
    </div>
    {status.credentialConfigured && <p className="admin-help">An API key is saved in the database. Leave the field blank to keep it or enter a new key to replace it.</p>}
    <form className="admin-card" style={{ marginTop: 14 }} onSubmit={save}>
      <label className="field" htmlFor={keyId}><span>API key</span><input id={keyId} type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} value={apiKey} maxLength={4096} required={enabled && !status.credentialConfigured} placeholder={status.credentialConfigured ? "Saved · leave blank to keep" : "Paste the provider API key"} onChange={event => setApiKey(event.target.value)} /></label>
      <label className="check-row"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span><strong>Enable {title}</strong><small>Include this provider in the live Adult feed. The Adult section must also be enabled in Global settings.</small></span></label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}><button className="admin-primary" type="submit" disabled={!status.encryptionConfigured || saving}>{saving ? "Saving…" : `Save ${title} settings`}</button>{status.credentialConfigured && <button className="admin-secondary" type="button" onClick={() => void removeCredential()} disabled={saving}>Remove key</button>}</div>
    </form>
    {error && <p className="admin-notice" role="alert">{error}</p>}
    {message && <p className="admin-notice" role="status" aria-live="polite">{message}</p>}
  </article>;
}
