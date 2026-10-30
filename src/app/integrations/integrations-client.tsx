"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { integrationServices, type IntegrationService } from "@/lib/integrations/registry";
import styles from "./integrations.module.css";

interface Integration {
  id: string;
  service: IntegrationService;
  name: string;
  baseUrl: string | null;
  credentialSaved: true;
  createdAt: string;
  updatedAt: string;
}

interface FormFields {
  service: IntegrationService;
  name: string;
  baseUrl: string;
  apiKey: string;
}

const blankForm: FormFields = { service: "seerr", name: "", baseUrl: "", apiKey: "" };
const serviceName = (id: IntegrationService) => integrationServices.find(service => service.id === id)?.name ?? id;

export default function IntegrationsClient({ adultSectionEnabled }: { adultSectionEnabled: boolean }) {
  const [connections, setConnections] = useState<Integration[] | null>(null);
  const [encryptionConfigured, setEncryptionConfigured] = useState(false);
  const [form, setForm] = useState<FormFields>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [connectionChecks, setConnectionChecks] = useState<Record<string, { message: string; ok: boolean }>>({});
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedService = useMemo(() => integrationServices.find(service => service.id === form.service), [form.service]);
  const adultUnavailable = selectedService?.adultOnly === true && !adultSectionEnabled;

  async function loadConnections() {
    setLoadError("");
    try {
      const response = await fetch("/api/integrations", { cache: "no-store" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const data = await response.json() as { integrations?: Integration[]; encryptionConfigured?: boolean; error?: string };
      if (!response.ok || !Array.isArray(data.integrations)) throw new Error(data.error || "Connections could not be loaded.");
      setConnections(data.integrations);
      setEncryptionConfigured(data.encryptionConfigured === true);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Connections could not be loaded.");
    }
  }

  useEffect(() => { void loadConnections(); }, []);

  function resetForm() {
    setForm(blankForm);
    setEditingId(null);
    setError("");
    setNotice("");
  }

  function beginEdit(connection: Integration) {
    setForm({ service: connection.service, name: connection.name, baseUrl: connection.baseUrl ?? "", apiKey: "" });
    setEditingId(connection.id);
    setError("");
    setNotice("");
    window.setTimeout(() => document.getElementById("connection-service")?.focus(), 0);
  }

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || adultUnavailable) return;
    if (!editingId && !form.apiKey.trim()) { setError(`Enter the ${selectedService?.credentialLabel.toLowerCase() ?? "credential"}.`); return; }
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(editingId ? `/api/integrations/${editingId}` : "/api/integrations", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const data = await response.json() as { integration?: Integration; error?: string };
      if (!response.ok || !data.integration) throw new Error(data.error || "Connection could not be saved.");
      setConnectionChecks({});
      setNotice(editingId ? "Connection settings updated. The service has not been checked yet." : "Connection saved securely. The service has not been checked yet.");
      setForm(blankForm);
      setEditingId(null);
      await loadConnections();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connection could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function removeConnection(connection: Integration) {
    if (pending || !window.confirm(`Remove the saved ${serviceName(connection.service)} connection “${connection.name}”?`)) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/integrations/${connection.id}`, { method: "DELETE" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Connection could not be removed.");
      if (editingId === connection.id) resetForm();
      setNotice(`${serviceName(connection.service)} connection removed.`);
      await loadConnections();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connection could not be removed.");
    } finally {
      setPending(false);
    }
  }

  async function checkConnection(connection: Integration) {
    if (checkingId || pending) return;
    setCheckingId(connection.id);
    setConnectionChecks(current => ({ ...current, [connection.id]: { message: "Checking…", ok: false } }));
    try {
      const response = await fetch(`/api/integrations/${connection.id}/test`, { method: "POST" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const data = await response.json() as { connected?: boolean; error?: string };
      if (!response.ok || data.connected !== true) throw new Error(data.error || "Connection could not be checked.");
      setConnectionChecks(current => ({ ...current, [connection.id]: { message: "Connected", ok: true } }));
    } catch (cause) {
      setConnectionChecks(current => ({ ...current, [connection.id]: { message: cause instanceof Error ? cause.message : "Connection could not be checked.", ok: false } }));
    } finally {
      setCheckingId(null);
    }
  }

  return <div className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.brand}><span aria-hidden="true">✳</span> Choice Fatigue</Link><Link href="/account" className={styles.back}>← Account settings</Link></header>
    <main className={styles.main}>
      <div className={styles.intro}><p className={styles.eyebrow}>YOUR SERVICES</p><h1>Connections</h1><p>Connect your media setup to your own account. You can save more than one instance of each service.</p></div>

      <section className={styles.noticePanel} aria-label="Connection security">
        <span className={styles.lockIcon} aria-hidden="true">⌑</span>
        <div><strong>Your credentials stay yours</strong><p>Server addresses and keys are encrypted before storage, are scoped to your account, and are never shown again after saving. Saving a connection does not call or verify the service.</p></div>
      </section>

      {!encryptionConfigured && connections !== null && <div className={styles.alert} role="alert"><strong>Secure storage is not ready</strong><span>The server needs an `INTEGRATION_CREDENTIALS_KEY` before it can save service credentials.</span></div>}
      {loadError && <div className={styles.alert} role="alert"><strong>Couldn’t load connections</strong><span>{loadError}</span><button type="button" onClick={() => void loadConnections()}>Try again</button></div>}

      <section className={styles.panel} aria-labelledby="connection-form-title">
        <div className={styles.panelHead}><div><p className={styles.eyebrow}>{editingId ? "EDIT SERVICE" : "ADD A SERVICE"}</p><h2 id="connection-form-title">{editingId ? "Update connection" : "New connection"}</h2></div>{editingId && <button className={styles.cancelButton} type="button" onClick={resetForm} disabled={pending}>Cancel edit</button>}</div>
        <form className={styles.form} onSubmit={saveConnection}>
          <label className={styles.field} htmlFor="connection-service"><span>Service</span><select id="connection-service" value={form.service} disabled={pending || Boolean(editingId)} onChange={event => setForm({ ...form, service: event.target.value as IntegrationService })}>{integrationServices.map(service => <option key={service.id} value={service.id} disabled={service.adultOnly && !adultSectionEnabled}>{service.name}{service.adultOnly && !adultSectionEnabled ? " · Adult section off" : ""}</option>)}</select></label>
          <label className={styles.field} htmlFor="connection-name"><span>Connection name</span><input id="connection-name" value={form.name} maxLength={60} autoComplete="off" placeholder={selectedService?.name ?? "My server"} required disabled={pending} onChange={event => setForm({ ...form, name: event.target.value })}/><small>Use a label such as “Living room” or “Anime library”.</small></label>
          <label className={styles.field} htmlFor="connection-url"><span>Server address</span><input id="connection-url" type="url" inputMode="url" value={form.baseUrl} maxLength={2048} autoComplete="url" placeholder="https://media.example.com" required disabled={pending} onChange={event => setForm({ ...form, baseUrl: event.target.value })}/><small>Enter the address this app can reach, including any URL path or port. Do not include a username or password. Shared servers use public HTTPS addresses; self-hosted admins can opt in to private-network access.</small></label>
          <label className={styles.field} htmlFor="connection-key"><span>{selectedService?.credentialLabel ?? "API key"}</span><input id="connection-key" type="password" value={form.apiKey} maxLength={4096} autoComplete="new-password" placeholder={editingId ? "Leave blank to keep the saved credential" : "Enter credential"} required={!editingId} disabled={pending} onChange={event => setForm({ ...form, apiKey: event.target.value })}/><small>{editingId ? "Leave this blank to keep the current credential, or enter a replacement." : "Only this connection’s owner can replace or remove this credential."}</small></label>
          {adultUnavailable && <p className={styles.formNote}>Whisparr and Stash connections are available after the Adult section is enabled for this instance.</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.saveButton} type="submit" disabled={pending || !encryptionConfigured || adultUnavailable}>{pending ? "Saving…" : editingId ? "Save changes" : "Save connection"}</button>
        </form>
      </section>

      <section className={styles.connections} aria-labelledby="saved-connections-title">
        <div className={styles.panelHead}><div><p className={styles.eyebrow}>PRIVATE TO YOUR ACCOUNT</p><h2 id="saved-connections-title">Saved connections{connections && <span className={styles.count}>{connections.length}</span>}</h2></div></div>
        {connections === null && !loadError && <p className={styles.empty}>Loading your connections…</p>}
        {connections?.length === 0 && <p className={styles.empty}>No services connected yet. Saved connections will appear here.</p>}
        {connections && connections.length > 0 && <ul className={styles.list}>{connections.map(connection => <li key={connection.id} className={styles.connection}>
          <div className={styles.connectionBody}><div className={styles.connectionTitle}><span className={styles.serviceMark} aria-hidden="true">{serviceName(connection.service).slice(0, 1)}</span><div><h3>{connection.name}</h3><p>{serviceName(connection.service)} · Credential saved · {connectionChecks[connection.id]?.message ?? "Not checked"}</p></div></div><p className={styles.url}>{connection.baseUrl ?? "Server address hidden until secure storage is configured"}</p>{connectionChecks[connection.id] && <p className={connectionChecks[connection.id].ok ? styles.checkSuccess : styles.checkError} role="status">{connectionChecks[connection.id].message}</p>}</div>
          <div className={styles.connectionActions}>{connection.service === "seerr" && <button type="button" onClick={() => void checkConnection(connection)} disabled={pending || checkingId !== null || !encryptionConfigured}>{checkingId === connection.id ? "Checking…" : "Test"}</button>}<button type="button" onClick={() => beginEdit(connection)} disabled={pending || checkingId !== null || !encryptionConfigured}>Edit</button><button type="button" onClick={() => void removeConnection(connection)} disabled={pending || checkingId !== null}>Remove</button></div>
        </li>)}</ul>}
      </section>

      <section className={styles.futurePanel} aria-labelledby="trakt-title"><p className={styles.eyebrow}>COMING NEXT</p><h2 id="trakt-title">Trakt watch history</h2><p>Trakt uses a user-authorized sign-in flow, so it will connect separately from the server-key services above. Your watch history will stay private to your account.</p></section>

      <p className={styles.status} role="status" aria-live="polite">{notice}</p>
      <p className={styles.nextStep}>Seerr connections can be checked here. TMDB-linked movies and shows in your Saved list can be sent to Seerr. Library lookups and the other service actions are coming later.</p>
    </main>
  </div>;
}
