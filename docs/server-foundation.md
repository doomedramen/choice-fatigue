# Server foundation contract

Choice Fatigue stores account discovery state, app settings, metadata-provider credentials, and shared media-service connections in PostgreSQL. Application configuration is managed through the administrator UI. Environment variables are reserved for server infrastructure and runtime secrets.

## Local setup

Requirements: Node.js 20.9+, pnpm 12.16.1, and Docker Compose. The project declares pnpm 12.16.1 in `package.json`; with Volta, install it using `volta install pnpm@12.16.1` and run project commands with `volta run pnpm`.

Copy `.env.example` to `.env` for Prisma and `.env.local` for Next.js. The supported environment settings are:

- `DATABASE_URL` for PostgreSQL.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` for authentication runtime configuration.
- `INTEGRATION_CREDENTIALS_KEY`, a private 32-byte base64 key used to encrypt saved provider, SMTP, and media-service credentials.

Generate the encryption key with `openssl rand -base64 32`. Keep a secure backup: saved encrypted credentials cannot be recovered without it. Do not put invite codes, SMTP settings, Adult access, provider credentials, or service URLs in environment variables; administrators set those in the UI.

Start PostgreSQL and prepare the database:

```sh
docker compose up -d postgres
volta run pnpm db:setup
volta run pnpm db:seed
volta run pnpm dev
```

For a shared deployment, run `volta run pnpm db:deploy` before starting the app. `volta run pnpm dev` starts Next.js in live development mode; production deployments use the package `build` and `start` scripts.

## Authentication and invitations

Better Auth is mounted at `/api/auth/*`:

- `POST /api/auth/sign-up/email` creates and signs in an account. When no accounts exist, the first account does not need an invite and receives the administrator role. Later accounts must provide the invitation code configured in Admin settings.
- `POST /api/auth/sign-in/email` signs in without checking email ownership.
- `POST /api/auth/request-password-reset` accepts an email and redirect URL; Better Auth sends the reset link only when SMTP is enabled in Admin settings.
- `POST /api/auth/reset-password` accepts the reset token and new password and revokes existing sessions.

Email is not used for account creation, verification, or sign-in. SMTP is optional and is used only for password recovery. Admins can enable it and enter the connection URL and sender address in Global settings. The URL is encrypted before storage. In development, when SMTP is disabled, reset links are printed in the server terminal.

## Account data and deletion

- `GET /api/discovery-state` returns the authenticated user's saved discovery state, or the default state on first use.
- `PUT /api/discovery-state` validates and writes the state for the authenticated user. The account ID comes from the session cookie; the request body cannot choose another user's row. Writes require a matching same-origin `Origin` header and are limited to 256 KiB.
- `GET /api/account/export` downloads the signed-in account's profile and discovery state as JSON. It excludes password hashes, sessions, verification tokens, server addresses, and credentials.
- `/account` provides the export link and account deletion flow. Deletion requires the current password and typed confirmation. The server protects the last active administrator and removes the account's discovery state and sessions.

## Administrator settings

`GET` and `PUT /api/admin/settings` require an administrator session and read or update the singleton `GlobalSettings` row. It stores the app name, default category, Adult-section flag, hashed invite code, private-network access flag, and optional SMTP configuration. Adult entries and Adult-only services remain unavailable until the administrator enables the section.

`GET /api/admin/users` returns a limited account list. Same-origin `PATCH /api/admin/users` disables or restores an account, revokes sessions when disabling, and protects the current and last active administrator. Administrator roles are managed from a trusted shell:

```sh
volta run pnpm admin:promote -- exact-account-email@example.com
```

## Metadata sources

Metadata provider keys and enablement are saved through Admin → Metadata sources. The keys and optional TVDB PIN are encrypted before storage. The API reports only configured and enabled status; secrets are never returned to the browser.

- TMDB search/import supports Movies and TV. Anime series are included in TV search; anime films are included in Movies search. It uses `include_adult=false`, rejects adult-flagged results, and stores imported titles in `CatalogueEntry`. `/credits` contains TMDB attribution.
- TheTVDB v4 search is configured with a project API key and optional subscriber PIN. TMDB artwork may be matched only when title and year match exactly.
- ThePornDB and StashDB can be used for text-only Adult entries. Source artwork is not imported or displayed. Adult imports are marked age-restricted and stored in the Adult category.

All provider calls require an administrator session, an enabled provider, and saved credentials. No provider-specific environment flags are used. Review [provider-review.md](provider-review.md) before enabling provider calls on a hosted instance.

## Shared media services

Seerr, Plex, Radarr, Sonarr, Whisparr v2/v3, Stash, Jellyfin, and Emby are configured by administrators in Admin → Services. Each saved connection has an encrypted address and credential in `AdminServiceIntegration`; the key is never returned to the browser. Service settings are shared across the instance. Private and local network addresses are blocked by default; the administrator can allow them in Global settings for trusted homelab deployments.

- `GET /api/admin/integrations` lists saved shared connections for administrators and returns a server address, but never a credential.
- `POST /api/admin/integrations`, `PATCH /api/admin/integrations/:id`, and `DELETE /api/admin/integrations/:id` require an administrator session and a same-origin request.
- `POST /api/admin/integrations/:id/test` checks supported services server-side. Seerr, Plex, Radarr, Sonarr, and Whisparr v2/v3 checks are available; connection tests do not expose raw service responses.
- `GET /api/integrations` returns only the shared service names and IDs to signed-in users so the discovery UI can offer configured Seerr and Plex services. It never returns an address or credential.
- `POST /api/integrations/:id/availability` checks the signed-in user's permanently saved, non-Adult, TMDB-linked title against a configured Seerr or Plex service.
- `POST /api/integrations/:id/request` requires the title to be saved by the signed-in user, rejects Adult or non-TMDB entries, checks for an existing item or request, then sends the title to Seerr.

Connection checks, availability checks, and requests run server-side, pin DNS resolution per request, do not follow redirects, and limit response size and time. Raw service response bodies are not forwarded to the browser. Since a Seerr API key may grant administrative API access, use a dedicated least-privilege service account where possible.

To rotate the encryption key, stop the app, set the temporary `INTEGRATION_CREDENTIALS_OLD_KEY` to the current key and `INTEGRATION_CREDENTIALS_KEY` to a new key, then run `volta run pnpm integrations:rotate-key`. Remove the old key and restart the app after the rotation succeeds.

## Catalogue and recommendation boundary

`CatalogueEntry` is the normalized server-side catalogue table. `volta run pnpm db:seed` idempotently loads local fixtures. The discovery page reads active entries from PostgreSQL and falls back to fixtures when the table is empty or unavailable. Adult rows are filtered before they reach the browser unless Adult access is enabled.

The planned recommendation approach and required event data are in [recommendation-algorithm-plan.md](recommendation-algorithm-plan.md). The current discovery state is a UI snapshot, not a preference-learning event history; do not turn on personalization until the action history can distinguish pass, shortlist, review keep/remove/restore, save, and undo.

## Server helpers

Import these only from server code:

- `getSession()` reads the current request cookies and returns the authenticated user/session or `null`.
- `requireSession()` returns the current session or throws `AuthenticationError` (HTTP 401).
- `requireAdmin()` returns an administrator session or throws `AuthenticationError` / `AuthorizationError` (HTTP 401/403).
- `getDiscoveryState()` reads the current signed-in user's JSON state.
- `saveDiscoveryState(state)` upserts the current signed-in user's state using the verified session ID.
- `getGlobalSettings()` returns public display settings from the database, including the Adult-section flag.

## Database models

Better Auth owns `User`, `Session`, `Account`, and `Verification`. On an empty installation, a serialized server-side hook promotes the first account to administrator. `DiscoveryState` stores per-account discovery data. `GlobalSettings` stores shared application options. `MetadataProviderCredential` stores encrypted metadata-provider keys. `AdminServiceIntegration` stores encrypted shared media-service connections.
