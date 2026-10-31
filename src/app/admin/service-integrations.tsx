"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { integrationServices, type IntegrationService } from "@/lib/integrations/registry";
import styles from "../integrations/integrations.module.css";

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

export default function ServiceIntegrations({ adultSectionEnabled, allowPrivateNetworkTargets }: { adultSectionEnabled: boolean; allowPrivateNetworkTargets: boolean }) {
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
      const response = await fetch("/api/admin/integrations", { cache: "no-store" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { integrations?: Integration[]; encryptionConfigured?: boolean; error?: string };
      if (!response.ok || !Array.isArray(data.integrations)) throw new Error(data.error || "Service connections could not be loaded.");
      setConnections(data.integrations);
      setEncryptionConfigured(data.encryptionConfigured === true);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Service connections could not be loaded.");
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
    const payload = editingId ? { name: form.name, baseUrl: form.baseUrl, apiKey: form.apiKey } : form;
    try {
      const response = await fetch(editingId ? `/api/admin/integrations/${editingId}` : "/api/admin/integrations", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { integration?: Integration; error?: string };
      if (!response.ok || !data.integration) throw new Error(data.error || "Service connection could not be saved.");
      setConnectionChecks({});
      setNotice(editingId ? "Shared service settings updated." : "Service added for everyone using this instance.");
      setForm(blankForm);
      setEditingId(null);
      await loadConnections();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Service connection could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function removeConnection(connection: Integration) {
    if (pending || !window.confirm(`Remove the shared ${serviceName(connection.service)} connection “${connection.name}”?`)) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/integrations/${connection.id}`, { method: "DELETE" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Service connection could not be removed.");
      if (editingId === connection.id) resetForm();
      setNotice(`${serviceName(connection.service)} removed for everyone using this instance.`);
      await loadConnections();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Service connection could not be removed.");
    } finally {
      setPending(false);
    }
  }

  async function checkConnection(connection: Integration) {
    if (checkingId || pending) return;
    setCheckingId(connection.id);
    setConnectionChecks(current => ({ ...current, [connection.id]: { message: "Checking…", ok: false } }));
    try {
      const response = await fetch(`/api/admin/integrations/${connection.id}/test`, { method: "POST" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { connected?: boolean; error?: string };
      if (!response.ok || data.connected !== true) throw new Error(data.error || "Service connection could not be checked.");
      setConnectionChecks(current => ({ ...current, [connection.id]: { message: "Connected", ok: true } }));
    } catch (cause) {
      setConnectionChecks(current => ({ ...current, [connection.id]: { message: cause instanceof Error ? cause.message : "Service connection could not be checked.", ok: false } }));
    } finally {
      setCheckingId(null);
    }
  }

  return <div className={styles.adminEmbedded}>
    <div className={styles.intro}><p className={styles.eyebrow}>INSTANCE SERVICES</p><h2 id="admin-section-title">Service connections</h2><p>Configure the services shared by everyone using this instance. Saved credentials are encrypted and never shown again.</p></div>
    <section className={styles.noticePanel} aria-label="Shared service access">
      <span className={styles.lockIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/></svg></span>
      <div><strong>Managed once for the whole instance</strong><p>Only administrators can add or change connections. Members can use configured Seerr and Plex services from their Saved list.</p></div>
    </section>
    {!encryptionConfigured && connections !== null && <div className={styles.alert} role="alert"><strong>Secure storage is not ready</strong><span>Credential storage is unavailable, so new service keys cannot be saved yet.</span></div>}
    {loadError && <div className={styles.alert} role="alert"><strong>Couldn’t load service connections</strong><span>{loadError}</span><button type="button" onClick={() => void loadConnections()}>Try again</button></div>}

    <section className={styles.panel} aria-labelledby="connection-form-title">
      <div className={styles.panelHead}><div><p className={styles.eyebrow}>{editingId ? "EDIT SERVICE" : "ADD A SERVICE"}</p><h3 id="connection-form-title">{editingId ? "Update shared connection" : "New shared connection"}</h3></div>{editingId && <button className={styles.cancelButton} type="button" onClick={resetForm} disabled={pending}>Cancel edit</button>}</div>
      <form className={styles.form} onSubmit={saveConnection}>
        <label className={styles.field} htmlFor="connection-service"><span>Service</span><select id="connection-service" value={form.service} disabled={pending || Boolean(editingId)} onChange={event => setForm({ ...form, service: event.target.value as IntegrationService })}>{integrationServices.map(service => <option key={service.id} value={service.id} disabled={service.adultOnly && !adultSectionEnabled}>{service.name}{service.adultOnly && !adultSectionEnabled ? " · Adult section off" : ""}</option>)}</select></label>
        <label className={styles.field} htmlFor="connection-name"><span>Connection name</span><input id="connection-name" value={form.name} maxLength={60} autoComplete="off" placeholder={selectedService?.name ?? "My server"} required disabled={pending} onChange={event => setForm({ ...form, name: event.target.value })}/><small>Choose a label members will recognise, such as “Living room” or “Shows library”.</small></label>
        <label className={styles.field} htmlFor="connection-url"><span>Server address</span><input id="connection-url" type="url" inputMode="url" value={form.baseUrl} maxLength={2048} autoComplete="url" placeholder="https://media.example.com" required disabled={pending} onChange={event => setForm({ ...form, baseUrl: event.target.value })}/><small>Enter the address this server can reach, including any URL path or port. {allowPrivateNetworkTargets ? "Private network addresses are allowed by Global settings." : "Private network addresses are currently blocked in Global settings."}</small></label>
        <label className={styles.field} htmlFor="connection-key"><span>{selectedService?.credentialLabel ?? "API key"}</span><input id="connection-key" type="password" value={form.apiKey} maxLength={4096} autoComplete="new-password" placeholder={editingId ? "Leave blank to keep the saved credential" : "Enter credential"} required={!editingId} disabled={pending} onChange={event => setForm({ ...form, apiKey: event.target.value })}/><small>{editingId ? "Leave blank to keep the current credential, or enter a replacement." : "The credential is encrypted before storage and kept on the server."}</small></label>
        {adultUnavailable && <p className={styles.formNote}>Whisparr and Stash connections are available after the Adult section is enabled in Global settings.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.saveButton} type="submit" disabled={pending || !encryptionConfigured || adultUnavailable}>{pending ? "Saving…" : editingId ? "Save changes" : "Save connection"}</button>
      </form>
    </section>

    <section className={styles.connections} aria-labelledby="saved-connections-title">
      <div className={styles.panelHead}><div><p className={styles.eyebrow}>SHARED WITH THIS INSTANCE</p><h3 id="saved-connections-title">Configured services{connections && <span className={styles.count}>{connections.length}</span>}</h3></div></div>
      {connections === null && !loadError && <p className={styles.empty}>Loading configured services…</p>}
      {connections?.length === 0 && <p className={styles.empty}>No shared services configured yet.</p>}
      {connections && connections.length > 0 && <ul className={styles.list}>{connections.map(connection => <li key={connection.id} className={styles.connection}>
        <div className={styles.connectionBody}><div className={styles.connectionTitle}><span className={styles.serviceMark} aria-hidden="true">{serviceName(connection.service).slice(0, 1)}</span><div><h4>{connection.name}</h4><p>{serviceName(connection.service)} · Credential saved · {connectionChecks[connection.id]?.message ?? "Not checked"}</p></div></div><p className={styles.url}>{connection.baseUrl ?? "Server address hidden while secure storage is unavailable"}</p>{connectionChecks[connection.id] && <p className={connectionChecks[connection.id].ok ? styles.checkSuccess : styles.checkError} role="status">{connectionChecks[connection.id].message}</p>}</div>
        <div className={styles.connectionActions}>{["seerr", "plex", "radarr", "sonarr", "whisparr-v2", "whisparr-v3"].includes(connection.service) && <button type="button" onClick={() => void checkConnection(connection)} disabled={pending || checkingId !== null || !encryptionConfigured || (connection.service.startsWith("whisparr") && !adultSectionEnabled)}>{checkingId === connection.id ? "Checking…" : "Test"}</button>}<button type="button" onClick={() => beginEdit(connection)} disabled={pending || checkingId !== null || !encryptionConfigured}>Edit</button><button type="button" onClick={() => void removeConnection(connection)} disabled={pending || checkingId !== null}>Remove</button></div>
      </li>)}</ul>}
    </section>
    <p className={styles.status} role="status" aria-live="polite">{notice}</p>
    <p className={styles.nextStep}>Members can check a saved title against configured Plex or Seerr services, or send eligible titles to Seerr. Connection tests are available here for Seerr, Plex, Radarr, Sonarr, and Whisparr.</p>
  </div>;
}
