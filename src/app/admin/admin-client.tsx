"use client";

import { useEffect, useState } from "react";
import TmdbCatalogue from "./tmdb-catalogue";
import TmdbProviderSettings, { type TmdbProviderStatus } from "./tmdb-provider-settings";
import TvdbProvider, { type TvdbProviderStatus } from "./tvdb-provider";
import AdultProviderSettings, { type AdultProviderStatus } from "./adult-provider-settings";
import AdultCatalogue from "./adult-catalogue";
import ServiceIntegrations from "./service-integrations";
import "./admin.css";

type Tab = "providers" | "services" | "settings" | "users";
type Settings = {
  appName: string;
  defaultCategory: string;
  adultSectionEnabled: boolean;
  allowPrivateNetworkTargets: boolean;
  betaInviteCodeConfigured: boolean;
  betaInviteCode: string;
  smtpEnabled: boolean;
  smtpFrom: string;
  smtpUrl: string;
  smtpConfigured: boolean;
  clearSmtpConfig: boolean;
};
type User = { id: string; name: string; email: string; role: string; disabled: boolean; createdAt: string };
type ProviderStatuses = {
  tmdb: TmdbProviderStatus;
  tvdb: TvdbProviderStatus;
  theporndb: AdultProviderStatus;
  stashdb: AdultProviderStatus;
};

const initialSettings: Settings = {
  appName: "Choice Fatigue",
  defaultCategory: "Movies",
  adultSectionEnabled: false,
  allowPrivateNetworkTargets: false,
  betaInviteCodeConfigured: false,
  betaInviteCode: "",
  smtpEnabled: false,
  smtpFrom: "",
  smtpUrl: "",
  smtpConfigured: false,
  clearSmtpConfig: false,
};

export default function AdminClient({ userName, userId, initialTab = "providers" }: { userName: string; userId: string; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [users, setUsers] = useState<User[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatuses | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [settingsResponse, usersResponse, providersResponse] = await Promise.all([
          fetch("/api/admin/settings", { cache: "no-store" }),
          fetch("/api/admin/users", { cache: "no-store" }),
          fetch("/api/admin/providers", { cache: "no-store" }),
        ]);
        if ([settingsResponse, usersResponse, providersResponse].some(response => response.status === 401)) { window.location.replace("/sign-in"); return; }
        if ([settingsResponse, usersResponse, providersResponse].some(response => response.status === 403)) { window.location.replace("/"); return; }
        if (!settingsResponse.ok || !usersResponse.ok || !providersResponse.ok) throw new Error("Admin information could not be loaded.");
        const [settingsData, usersData, providersData] = await Promise.all([settingsResponse.json(), usersResponse.json(), providersResponse.json()]) as [Settings, { users: User[] }, { providers: ProviderStatuses }];
        if (cancelled) return;
        setSettings({ ...settingsData, betaInviteCode: "", smtpUrl: "", clearSmtpConfig: false });
        setUsers(usersData.users);
        setProviderStatuses(providersData.providers);
        setReady(true);
      } catch {
        if (!cancelled) { setLoadError("Couldn’t load admin information. Check the database connection and try again."); setReady(true); }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  function updateProviderStatus<K extends keyof ProviderStatuses>(provider: K, status: ProviderStatuses[K]) {
    setProviderStatuses(current => current ? { ...current, [provider]: status } : current);
  }

  async function saveSettings() {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appName: settings.appName,
          defaultCategory: settings.defaultCategory,
          adultSectionEnabled: settings.adultSectionEnabled,
          allowPrivateNetworkTargets: settings.allowPrivateNetworkTargets,
          betaInviteCode: settings.betaInviteCode,
          smtpEnabled: settings.smtpEnabled,
          smtpFrom: settings.smtpFrom,
          smtpUrl: settings.smtpUrl,
          clearSmtpConfig: settings.clearSmtpConfig,
        }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Settings could not be saved.");
      setSettings({ ...data, betaInviteCode: settings.betaInviteCode, smtpUrl: "", clearSmtpConfig: false });
      setNotice("Global settings saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function generateInviteCode() {
    const code = `cf-${crypto.randomUUID().replaceAll("-", "")}`;
    setSettings(current => ({ ...current, betaInviteCode: code }));
    setNotice("New invite code generated. Save settings to activate it, then copy it to share.");
  }

  async function setUserDisabled(user: User) {
    const disabled = !user.disabled;
    setUpdatingUserId(user.id);
    setNotice("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id, disabled }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json() as { user?: User; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || "Account could not be updated.");
      setUsers(current => current.map(item => item.id === data.user!.id ? data.user! : item));
      setNotice(disabled ? "Account disabled and active sessions revoked." : "Account restored.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Account could not be updated.");
    } finally {
      setUpdatingUserId(null);
    }
  }

  return <div className="admin-shell">
    <header className="admin-header"><a className="admin-brand" href="/">✳ <span>{settings.appName.toLowerCase()}</span></a><div className="admin-header-actions"><span className="admin-user">{userName}</span><a className="admin-back" href="/">← Back to discovery</a></div></header>
    <main className="admin-main">
      <div className="admin-heading"><div><p className="admin-eyebrow">CHOICE FATIGUE / ADMIN</p><h1>Admin settings</h1><p>Manage app defaults, metadata sources, shared services, and accounts.</p></div><span className="admin-badge">ADMIN ONLY</span></div>
      {loadError && <div className="admin-alert" role="alert"><strong>Couldn’t load settings</strong><span>{loadError}</span><button type="button" onClick={() => window.location.reload()}>Retry</button></div>}
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="Admin sections">{([['providers', 'Metadata sources'], ['services', 'Services'], ['settings', 'Global settings'], ['users', 'Users']] as const).map(([id, label]) => <button key={id} type="button" className={tab === id ? "selected" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); setNotice(""); }}>{label}<span aria-hidden="true">→</span></button>)}</nav>
        <section className="admin-content" aria-labelledby="admin-section-title">
          {tab === "providers" && <>
            <div className="admin-section-head"><div><p className="admin-eyebrow">CATALOGUE SETUP</p><h2 id="admin-section-title">Metadata sources</h2><p>Manage provider keys and turn sources on or off here. Credentials are encrypted in the database; titles imported from any enabled source join the shared catalogue used by discovery.</p></div></div>
            <div className="provider-list">
              <TmdbProviderSettings status={providerStatuses?.tmdb ?? { credentialConfigured: false, enabled: false, encryptionConfigured: false }} onStatusChange={status => updateProviderStatus("tmdb", status)} />
              {providerStatuses?.tmdb.enabled && <TmdbCatalogue />}
              <TvdbProvider status={providerStatuses?.tvdb ?? { credentialConfigured: false, pinConfigured: false, enabled: false, encryptionConfigured: false }} onStatusChange={status => updateProviderStatus("tvdb", status)} />
              <AdultProviderSettings provider="theporndb" title="ThePornDB" description="Adult scene and movie text metadata. Source artwork is not imported or displayed." status={providerStatuses?.theporndb ?? { credentialConfigured: false, enabled: false, encryptionConfigured: false }} onStatusChange={status => updateProviderStatus("theporndb", status)} />
              <AdultProviderSettings provider="stashdb" title="StashDB" description="Adult scene, performer, and studio text metadata. Source artwork is not imported or displayed." status={providerStatuses?.stashdb ?? { credentialConfigured: false, enabled: false, encryptionConfigured: false }} onStatusChange={status => updateProviderStatus("stashdb", status)} />
              {settings.adultSectionEnabled && (providerStatuses?.theporndb.enabled || providerStatuses?.stashdb.enabled) && <AdultCatalogue enabledProviders={{ theporndb: providerStatuses?.theporndb.enabled === true, stashdb: providerStatuses?.stashdb.enabled === true }} />}
              {!settings.adultSectionEnabled && <p className="admin-help">Adult metadata stays unavailable until you enable the Adult section in Global settings.</p>}
            </div>
            <p className="admin-help">Credentials are encrypted before storage. See the <a href="/provider-review">provider review notes</a> for source boundaries and remaining checks.</p>
          </>}
          {tab === "services" && <ServiceIntegrations adultSectionEnabled={settings.adultSectionEnabled} allowPrivateNetworkTargets={settings.allowPrivateNetworkTargets} />}
          {tab === "settings" && <>
            <div className="admin-section-head"><div><p className="admin-eyebrow">PREFERENCES</p><h2 id="admin-section-title">Global settings</h2><p>These defaults are shared by everyone using the app.</p></div></div>
            <div className="admin-card">
              <label className="field"><span>App name</span><input value={settings.appName} maxLength={50} onChange={event => setSettings({ ...settings, appName: event.target.value })} /></label>
              <label className="field"><span>Default category</span><select value={settings.defaultCategory} onChange={event => setSettings({ ...settings, defaultCategory: event.target.value })}><option>Movies</option><option>Shows</option></select></label>
              <label className="check-row"><input type="checkbox" checked={settings.adultSectionEnabled} disabled={!ready} onChange={event => setSettings({ ...settings, adultSectionEnabled: event.target.checked })} /><span><strong>Enable the Adult section</strong><small>Enables the age-gated Adult category for this instance.</small></span></label>
            </div>
            <section className="admin-card" aria-labelledby="invite-settings-title">
              <div><h3 id="invite-settings-title">Invitation code</h3><p className="admin-help">The first account can register without an invite and becomes admin. Later sign-ups require this code. Only a secure hash is stored.</p></div>
              <label className="field"><span>{settings.betaInviteCodeConfigured ? "Replace invitation code" : "Set invitation code"}</span><input type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} value={settings.betaInviteCode} placeholder={settings.betaInviteCodeConfigured ? "Configured · leave blank to keep" : "Enter a code or generate one"} onChange={event => setSettings({ ...settings, betaInviteCode: event.target.value })} /></label>
              <button className="admin-secondary" type="button" onClick={generateInviteCode}>Generate a new code</button>
            </section>
            <section className="admin-card" aria-labelledby="email-settings-title">
              <div><h3 id="email-settings-title">Password reset email</h3><p className="admin-help">Email is not used for signup or verification. Configure SMTP only if you want password reset links delivered by email.</p></div>
              <label className="check-row"><input type="checkbox" checked={settings.smtpEnabled} disabled={!ready || settings.clearSmtpConfig} onChange={event => setSettings({ ...settings, smtpEnabled: event.target.checked })} /><span><strong>Enable password reset email</strong><small>SMTP connection details are encrypted in the database.</small></span></label>
              <label className="field"><span>SMTP connection URL</span><input type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={2048} value={settings.smtpUrl} placeholder={settings.smtpConfigured ? "Saved · leave blank to keep" : "smtps://user:password@mail.example.com:465"} onChange={event => setSettings({ ...settings, smtpUrl: event.target.value })} /></label>
              <label className="field"><span>Sender address</span><input type="text" autoComplete="off" maxLength={254} value={settings.smtpFrom} placeholder="Choice Fatigue <noreply@example.com>" onChange={event => setSettings({ ...settings, smtpFrom: event.target.value })} /></label>
              {settings.smtpConfigured && <label className="check-row"><input type="checkbox" checked={settings.clearSmtpConfig} onChange={event => setSettings({ ...settings, clearSmtpConfig: event.target.checked, smtpEnabled: event.target.checked ? false : settings.smtpEnabled })} /><span><strong>Remove saved SMTP settings</strong><small>This clears the saved URL and sender address.</small></span></label>}
            </section>
            <section className="admin-card" aria-labelledby="network-settings-title">
              <div><h3 id="network-settings-title">Service network access</h3><p className="admin-help">Allow connections to private and local network addresses for services such as Radarr, Plex, or Seerr on your homelab.</p></div>
              <label className="check-row"><input type="checkbox" checked={settings.allowPrivateNetworkTargets} disabled={!ready} onChange={event => setSettings({ ...settings, allowPrivateNetworkTargets: event.target.checked })} /><span><strong>Allow private network service addresses</strong><small>Only enable this when you trust the accounts allowed to configure services.</small></span></label>
            </section>
            <button className="admin-primary" type="button" onClick={() => void saveSettings()} disabled={!ready || saving || Boolean(loadError)}>{saving ? "Saving…" : "Save settings"}</button><p className="admin-notice" role="status" aria-live="polite">{notice}</p>
          </>}
          {tab === "users" && <>
            <div className="admin-section-head"><div><p className="admin-eyebrow">ACCESS</p><h2 id="admin-section-title">Accounts</h2><p>Registered accounts in this instance.</p></div><span className="admin-count">{users.length} {users.length === 1 ? "account" : "accounts"}</span></div>
            <div className="admin-card user-list">{users.length ? users.map(user => <article className="user-row" key={user.id}><div className="user-info"><strong>{user.name}{user.id === userId ? " · You" : ""}</strong><span>{user.email}</span></div><span className={`role-pill ${user.role === "admin" ? "role-admin" : ""}`}>{user.role === "admin" ? "Admin" : "Member"}</span><span className={`account-status ${user.disabled ? "account-disabled" : ""}`}>{user.disabled ? "Disabled" : "Active"}</span><span className="user-created">Joined {new Date(user.createdAt).toLocaleDateString()}</span><button className={`account-toggle ${user.disabled ? "restore-account" : "disable-account"}`} type="button" disabled={updatingUserId !== null || (user.id === userId && !user.disabled)} onClick={() => void setUserDisabled(user)} aria-label={`${user.disabled ? "Restore" : "Disable"} ${user.name} account`} title={user.id === userId && !user.disabled ? "You cannot disable your own account" : undefined}>{updatingUserId === user.id ? "Saving…" : user.id === userId && !user.disabled ? "You" : user.disabled ? "Restore" : "Disable"}</button></article>) : <p className="admin-help">No accounts are registered yet.</p>}</div>
            <div className="admin-alert"><strong>Account controls</strong><span>Disabled accounts can’t sign in or use account features. Disabling an account revokes its current sessions. Admin roles remain managed through the trusted server command.</span></div>
          </>}
          {tab !== "settings" && <p className="admin-notice" role="status" aria-live="polite">{notice}</p>}
        </section>
      </div>
    </main>
  </div>;
}
