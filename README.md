# Choice Fatigue

A responsive media discovery app built with Next.js and TypeScript. The server foundation includes invite-only accounts, email verification, password recovery, per-account discovery sessions, account data export and deletion, protected admin pages, and shared global settings. The catalogue uses local fixtures with opt-in TMDB search/import for administrators; recommendation logic is not connected.

## Run locally

Requirements: Node.js 20.9+ and Docker Compose.

```sh
npm install
cp .env.example .env
cp .env.example .env.local
```

Set the same non-empty `BETA_INVITE_CODE` in `.env` and `.env.local` (for example, `local-demo-invite`) for accounts after the initial setup. The first account can be created without an invite and becomes the administrator. The example config uses console email delivery in development, so verification and password reset links appear in the terminal running the app.

To save personal service connections locally, generate one 32-byte key with `openssl rand -base64 32` and set the same value as `INTEGRATION_CREDENTIALS_KEY` in both `.env` and `.env.local`. Keep a secure backup of this key; saved service credentials cannot be recovered if the key is lost.

Start the local database and prepare its schema:

```sh
docker compose up -d postgres
npm run db:setup
npm run db:seed
npm run dev
```

Open [http://localhost:4173](http://localhost:4173), create the first account without an invite, then open the verification link printed in the server terminal. The first account is made administrator automatically. Once verified, sign in and try the discovery flow. The admin page is available to that account. To recover admin access for an existing deployment, promote a verified account from a trusted shell:

```sh
npm run admin:promote -- your-verified-email@example.com
```

For a code check, run `npm run typecheck`. Before `npm run build`, set a non-empty `BETTER_AUTH_SECRET` in the environment.

## What works

- Mouse, touch, and keyboard swipes with pass, shortlist, and undo.
- Details overlays, a review-and-prune flow, restore, keep browsing, and final save.
- Temporary shortlists stay separate from permanently saved titles.
- Discovery state is saved to PostgreSQL per account. Existing browser prototype data is imported once when the account has no saved server session.
- `/account` downloads a JSON copy of the profile and discovery state. Permanent deletion requires the current password and typed confirmation.
- `/admin` is restricted to administrators. Global app defaults are saved in PostgreSQL; admins can list accounts, disable or restore access, and see whether provider credentials exist on the server without exposing their values. `/provider-review` records provider scope and remaining implementation checks.
- `/integrations` lets each account save multiple Seerr, Plex, Radarr, Sonarr, Whisparr v2/v3, Stash, Jellyfin, or Emby instances. Server addresses and credentials are encrypted at rest, scoped per account, and omitted from exports. Seerr, Plex, Radarr, Sonarr, and Whisparr v2/v3 connections can be checked; TMDB-linked movies and shows in the Saved list can be checked against Seerr and Plex, and eligible titles can be sent to Seerr.
- The catalogue is stored in a normalized PostgreSQL table. `npm run db:seed` loads the local fixtures; the app falls back to fixtures if the catalogue table has no entries.
- Admins can search TMDB and import Movies, TV, or Anime into the catalogue when both `TMDB_API_READ_ACCESS_TOKEN` and `TMDB_METADATA_ENABLED=true` are configured. TMDB adult-flagged results are rejected; imported artwork is displayed from TMDB's image CDN. The integration makes no requests while the feature flag is off.
- The proposed personalization approach is documented in [`docs/recommendation-algorithm-plan.md`](docs/recommendation-algorithm-plan.md). It is not implemented; the current discovery order remains catalogue-driven.
- Admins can search and import text-only Adult entries from ThePornDB and StashDB. Each source requires its server credential and `*_METADATA_ENABLED=true`; both server and database Adult settings must also be enabled. No source artwork is shown.
- The first account can sign up without an invite and becomes administrator. Later sign-ups require the configured invite code and email verification. Sign-in and password recovery use the configured email delivery mode.
- Adult is disabled by default and remains unavailable until both the server flag and admin setting enable it. Its confirmation screen is a self-attested age gate, not identity or legal age verification.

All provider calls are opt-in through server environment settings. Provider readiness only reports configured state from protected server-side checks; it never returns secrets to the browser.

## Configuration for a shared deployment

Set `DATABASE_URL`, a unique `BETTER_AUTH_SECRET`, the public `BETTER_AUTH_URL`, and a private `BETA_INVITE_CODE` for later account invites. The first account is created without a code and receives the administrator role. Configure `AUTH_EMAIL_MODE=smtp`, `SMTP_URL`, and `SMTP_FROM` for verification and recovery emails. Apply the checked-in database migration with `npm run db:deploy`. Keep `ADULT_SECTION_ENABLED=false` unless the section has been reviewed and intentionally enabled. To enable TMDB catalogue search, set `TMDB_API_READ_ACCESS_TOKEN` and `TMDB_METADATA_ENABLED=true`; attribution is available at `/credits`. Adult search additionally requires `ADULT_SECTION_ENABLED=true`, the admin Adult setting, a provider credential, and the matching provider feature flag.

See [docs/server-foundation.md](docs/server-foundation.md) for auth routes, environment settings, data ownership, and administrator setup. See [ROADMAP.md](ROADMAP.md) for the staged path to a shareable product.
