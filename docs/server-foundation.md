# Server foundation contract

This is the server-side foundation for Choice Fatigue. Discovery data persists per account in PostgreSQL. The admin can optionally search and import TMDB titles; automatic recommendations are not connected.

## Local setup

Copy `.env.example` to `.env` for Prisma commands and `.env.local` for Next.js. The example explicitly enables development-only console email delivery, which prints verification and password-reset links to the server terminal. Start PostgreSQL with `docker compose up -d postgres`, then run `npm run db:setup`.

Set a unique `BETTER_AUTH_SECRET` and the canonical `BETTER_AUTH_URL` for shared deployments. Configure `BETA_INVITE_CODE`; signup is denied in every environment when it is absent. The signup request must include `x-beta-invite-code`, which is checked by a server-side Better Auth hook and is never stored.

Shared deployments must set `AUTH_EMAIL_MODE=smtp`, `SMTP_URL` (a Nodemailer SMTP connection URL), and `SMTP_FROM` (the verified sender address). Signup is denied unless email delivery is configured. Development can explicitly use `AUTH_EMAIL_MODE=console`; this mode is rejected outside `NODE_ENV=development`. Unverified accounts cannot obtain sessions. Verification is sent at signup and sign-in; password resets revoke existing sessions.

`ADULT_SECTION_ENABLED` defaults to `false`. Adult access is available only when this server setting and `GlobalSettings.adultSectionEnabled` in PostgreSQL are both true. The discovery-state endpoint rejects selecting Adult while disabled and avoids returning a saved Adult selection when the feature is off.

Per-user service connections require a separate `INTEGRATION_CREDENTIALS_KEY` containing 32 random bytes encoded as base64. Generate one with `openssl rand -base64 32`; keep it in the deployment secret store, separate from the database, and keep a secure backup because losing it makes saved credentials unrecoverable. Connection addresses and API credentials are encrypted with AES-256-GCM before storage, bound to the owning user and connection ID, and never returned by the API. The connections page currently saves and audits settings; service health checks and request/library actions are a later slice.

## Authentication routes and recovery

Better Auth is mounted at `/api/auth/*`:

- `POST /api/auth/sign-up/email` creates an account. Include `x-beta-invite-code`; a verification email is required before the account can start a session.
- `POST /api/auth/sign-in/email` signs in a verified account. An unverified account receives a verification email.
- `POST /api/auth/request-password-reset` accepts an email and redirect URL; Better Auth emails the reset link.
- `POST /api/auth/reset-password` accepts the reset token and new password and revokes existing sessions.
- Email verification uses Better Auth's generated `/api/auth/verify-email` link.

The frontend includes `/forgot-password` and `/reset-password` screens. The reset email callback redirects back with a short-lived token, and the reset form submits the new password through Better Auth.

## Account data and deletion

- `GET /api/account/export` downloads the signed-in account's profile and discovery state as JSON, with catalogue labels for referenced local titles and non-secret service connection labels. It excludes password hashes, sessions, verification tokens, server addresses, and provider credentials.
- `/account` provides the export link and account deletion flow. Deletion requires the current password in both the UI and the Better Auth server hook. The deletion hook protects the last active administrator; account-owned discovery state is deleted with its user row, Better Auth removes accounts and sessions, and the post-delete hook removes remaining verification records for that user.
- Account deletion is permanent. The user should download their export before confirming deletion if they want a copy.

## Discovery API

- `GET /api/discovery-state` returns the authenticated user's saved discovery state, or the default state on first use.
- `PUT /api/discovery-state` accepts the same JSON state shape, validates size and fields, and writes it for the authenticated user.

Both methods require a verified Better Auth session. The account ID always comes from the session cookie; request bodies cannot choose another user's row. Requests are limited to 256 KiB. Writes require a matching same-origin `Origin` header.

## Catalogue boundary

`CatalogueEntry` is the normalized server-side catalogue table. It stores a stable local ID, source and source ID, category, display fields, genres, artwork reference, age restriction, content flags, visibility, and display order. `npm run db:seed` idempotently loads the current local fixtures. The discovery page reads active entries from PostgreSQL and falls back to the bundled fixtures if the table is empty or unavailable. Adult rows are filtered before they reach the browser unless both Adult gates are enabled.

TMDB search and import are available only when `TMDB_API_READ_ACCESS_TOKEN` and `TMDB_METADATA_ENABLED=true` are set on the server. Requests require an administrator session, use `include_adult=false`, reject adult-flagged results, and are not cached by the app. Imports re-fetch selected details server-side and store them in `CatalogueEntry`; imported records are limited to Movies, TV, or Anime. Anime search is narrowed to Japanese-language/origin animation. `/credits` contains TMDB attribution. Check provider retention terms before enabling this path in a hosted environment.

ThePornDB and StashDB search/import require their server credential, their matching `*_METADATA_ENABLED=true` flag, `ADULT_SECTION_ENABLED=true`, and the Adult setting in PostgreSQL. Routes require an administrator session and re-fetch selected records before import. Records are stored only in the Adult category with an age restriction and adult flag; provider images are not requested or displayed. `GET /api/admin/providers/theporndb/search` and `/api/admin/providers/stashdb/search` search their respective sources. `POST` to each matching `/import` route adds a selected record.

`GET /api/admin/providers` requires an administrator session and returns only whether configured credentials exist plus provider feature-flag states. `GET /api/admin/providers/tmdb/search` searches TMDB; `POST /api/admin/providers/tmdb/import` imports one selected record and requires same-origin JSON.

`GET` and `PUT /api/admin/settings` require an administrator session and read or update the singleton global settings. Adult can only be enabled when both the server flag and database setting allow it. `GET /api/admin/users` returns a limited account list; same-origin `PATCH /api/admin/users` disables or restores an account, revokes sessions when disabling, and protects the current and last active administrator.

`/integrations` and `/api/integrations` are account-scoped. The API accepts same-origin create/update/delete requests, limits each account to 24 instances, encrypts configuration, and stores audit events with action, service, and connection name only. When the encryption key is available, `GET` returns service, name, and the owning account's server address, but never its credential. Adult connections require both Adult gates. `npm run integrations:rotate-key` rotates stored credentials atomically: stop the app, set `INTEGRATION_CREDENTIALS_OLD_KEY` to the old key and `INTEGRATION_CREDENTIALS_KEY` to a new key, run the command, then remove the old key and restart.

## Server helpers

Import these only from server code:

- `getSession(): Promise<AuthSession | null>` reads the current request cookies and returns the authenticated user/session or `null`.
- `requireSession(): Promise<AuthSession>` returns the current session or throws `AuthenticationError` (HTTP status 401).
- `requireAdmin(): Promise<AuthSession>` returns an administrator session or throws `AuthenticationError` / `AuthorizationError` (HTTP status 401/403).
- `getDiscoveryState(): Promise<Prisma.JsonValue | null>` reads the current signed-in user's JSON state.
- `saveDiscoveryState(state: Prisma.InputJsonValue): Promise<Prisma.JsonValue>` upserts the current signed-in user's state. The user ID always comes from the verified session, never caller input.
- `getGlobalSettings()` returns public display settings with Adult enabled only if both the server flag and database setting are true.

## Database models and administrator bootstrap

Better Auth owns the `User`, `Session`, `Account`, and `Verification` records. `User.role` defaults to `user`, and signup never assigns an administrator role. After the first account has verified its email, bootstrap an administrator from a trusted shell with:

```sh
npm run admin:promote -- exact-verified-email@example.com
```

The command requires an exact existing email and refuses unverified accounts. It does not accept email or role values from signup requests.

`DiscoveryState` stores the UI state as one JSON row per user, keyed by `userId`; it keeps decisions, temporary shortlist, saved titles, undo history, and review state together while the data model is evolving. `GlobalSettings` is a singleton row for app name, default category, and the Adult feature flag.

## Reference documentation

- [Better Auth with Next.js](https://better-auth.com/docs/integrations/next)
- [Better Auth Prisma adapter](https://better-auth.com/docs/adapters/prisma)
- [Better Auth email and password](https://better-auth.com/docs/concepts/email)
- [Better Auth email verification](https://better-auth.com/docs/concepts/email#email-verification)
