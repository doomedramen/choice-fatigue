"use client";

import { useEffect, useState } from "react";
import "./admin.css";

type Tab = "providers" | "settings" | "users";
type Settings = { appName: string; defaultCategory: string; adultSectionEnabled: boolean; adultCanBeEnabled: boolean };
type User = { id: string; name: string; email: string; role: string; disabled: boolean; createdAt: string };
type ProviderStatus = { credentialConfigured: boolean; integration: "not-built" };
type ProviderStatuses = { tmdb: ProviderStatus; theporndb: ProviderStatus; stashdb: ProviderStatus };
const initialSettings: Settings = { appName: "Choice Fatigue", defaultCategory: "Movies", adultSectionEnabled: false, adultCanBeEnabled: false };
const providers = [
  { id: "tmdb", name: "TMDB", purpose: "Movies, TV, and Anime metadata", env: "TMDB_API_READ_ACCESS_TOKEN", note: "API calls are not implemented. Confirm non-commercial or licensed use, attribution, retention terms, and keep TMDB content separate from Adult." },
  { id: "theporndb", name: "ThePornDB", purpose: "Adult scene and movie metadata", env: "THEPORNDB_API_TOKEN", note: "Stash documents ThePornDB as a supported Stash-Box source. Integration is planned; keep the token on the server and follow its API usage guidance." },
  { id: "stashdb", name: "StashDB", purpose: "Adult scene, performer, and studio metadata", env: "STASHDB_API_KEY", note: "Stash documents StashDB as a supported metadata source alongside ThePornDB. Integration is planned; keep the key on the server and follow its API usage guidance." },
] as const;

export default function AdminClient({ userName, userId }: { userName: string; userId: string }) {
  const [tab, setTab] = useState<Tab>("providers");
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
        setSettings(settingsData);
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

  async function saveSettings() {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appName: settings.appName, defaultCategory: settings.defaultCategory, adultSectionEnabled: settings.adultSectionEnabled }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      if (response.status === 403) { window.location.replace("/"); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Settings could not be saved.");
      setSettings(data);
      setNotice("Global settings saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
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
      <div className="admin-heading"><div><p className="admin-eyebrow">CHOICE FATIGUE / ADMIN</p><h1>Admin settings</h1><p>Manage the app defaults, accounts, and metadata plans.</p></div><span className="admin-badge">ADMIN ONLY</span></div>
      {loadError && <div className="admin-alert" role="alert"><strong>Couldn’t load settings</strong><span>{loadError}</span><button type="button" onClick={()=>window.location.reload()}>Retry</button></div>}
      <div className="admin-layout"><nav className="admin-nav" aria-label="Admin sections">{([['providers','Metadata sources'],['settings','Global settings'],['users','Users']] as const).map(([id,label]) => <button key={id} type="button" className={tab===id?'selected':''} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);setNotice("");}}>{label}<span aria-hidden="true">→</span></button>)}</nav>
        <section className="admin-content" aria-labelledby="admin-section-title">
          {tab === "providers" && <><div className="admin-section-head"><div><p className="admin-eyebrow">INTEGRATIONS</p><h2 id="admin-section-title">Metadata sources</h2><p>Connection status is checked on the server. API requests are not active yet.</p></div></div><div className="provider-list">{providers.map(provider=>{const status=providerStatuses?.[provider.id];const label=!status?"Checking…":status.credentialConfigured?"Key set · inactive":"Not configured";return <article className="provider" key={provider.name}><div className="provider-top"><div><h3>{provider.name}</h3><p>{provider.purpose}</p></div><span className="status-pill status-inactive">{label}</span></div><p className="provider-note">{provider.note}</p><div className="env-row"><span>{status?.credentialConfigured?"Server credential":"Server variable"}</span><code>{provider.env}</code></div></article>})}</div><p className="admin-help">Credentials stay in deployment environment variables. This page only reports whether a value exists; it never returns a secret to the browser. See the <a href="/provider-review">provider review notes</a> for the decision record.</p></>}
          {tab === "settings" && <><div className="admin-section-head"><div><p className="admin-eyebrow">PREFERENCES</p><h2 id="admin-section-title">Global settings</h2><p>These defaults are shared by everyone using the app.</p></div></div><div className="admin-card"><label className="field"><span>App name</span><input value={settings.appName} maxLength={50} onChange={e=>setSettings({...settings,appName:e.target.value})}/></label><label className="field"><span>Default category</span><select value={settings.defaultCategory} onChange={e=>setSettings({...settings,defaultCategory:e.target.value})}><option>Movies</option><option>TV</option><option>Anime</option></select></label><label className={`check-row ${!settings.adultCanBeEnabled?'disabled':''}`}><input type="checkbox" checked={settings.adultSectionEnabled} disabled={!ready || !settings.adultCanBeEnabled} onChange={e=>setSettings({...settings,adultSectionEnabled:e.target.checked})}/><span><strong>Enable the Adult section</strong><small>{settings.adultCanBeEnabled ? "Adults only, with an age gate in the app." : "Unavailable until ADULT_SECTION_ENABLED is enabled on the server."}</small></span></label></div><button className="admin-primary" type="button" onClick={saveSettings} disabled={!ready || saving || Boolean(loadError)}>{saving ? "Saving…" : "Save settings"}</button><p className="admin-notice" role="status" aria-live="polite">{notice}</p></>}
          {tab === "users" && <><div className="admin-section-head"><div><p className="admin-eyebrow">ACCESS</p><h2 id="admin-section-title">Accounts</h2><p>Registered accounts in this instance.</p></div><span className="admin-count">{users.length} {users.length===1?'account':'accounts'}</span></div><div className="admin-card user-list">{users.length ? users.map(user=><article className="user-row" key={user.id}><div className="user-info"><strong>{user.name}{user.id===userId?" · You":""}</strong><span>{user.email}</span></div><span className={`role-pill ${user.role === "admin" ? "role-admin" : ""}`}>{user.role === "admin" ? "Admin" : "Member"}</span><span className={`account-status ${user.disabled ? "account-disabled" : ""}`}>{user.disabled ? "Disabled" : "Active"}</span><span className="user-created">Joined {new Date(user.createdAt).toLocaleDateString()}</span><button className={`account-toggle ${user.disabled ? "restore-account" : "disable-account"}`} type="button" disabled={updatingUserId !== null || (user.id===userId && !user.disabled)} onClick={()=>void setUserDisabled(user)} aria-label={`${user.disabled ? "Restore" : "Disable"} ${user.name} account`} title={user.id===userId&&!user.disabled?"You cannot disable your own account":undefined}>{updatingUserId === user.id ? "Saving…" : user.id===userId&&!user.disabled ? "You" : user.disabled ? "Restore" : "Disable"}</button></article>) : <p className="admin-help">No accounts are registered yet.</p>}</div><div className="admin-alert"><strong>Account controls</strong><span>Disabled accounts can’t sign in or use account features. Disabling an account revokes its current sessions. Admin roles remain managed through the trusted server command.</span></div></>}
          {tab !== "settings" && <p className="admin-notice" role="status" aria-live="polite">{notice}</p>}
        </section></div>
    </main>
  </div>;
}
