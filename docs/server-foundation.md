# Server foundation contract

This is the first server-side foundation for Choice Fatigue. Discovery data now persists per account in PostgreSQL. Metadata providers and recommendation logic are still out of scope.

## Local setup

Copy `.env.example` to `.env` for Prisma commands and `.env.local` for Next.js. The example explicitly enables development-only console email delivery, which prints verification and password-reset links to the server terminal. Start PostgreSQL with `docker compose up -d postgres`, then run `npm run db:setup`.

Set a unique `BETTER_AUTH_SECRET` and the canonical `BETTER_AUTH_URL` for shared deployments. Configure `BETA_INVITE_CODE`; signup is denied in every environment when it is absent. The signup request must include `x-beta-invite-code`, which is checked by a server-side Better Auth hook and is never stored.

Shared deployments must set `AUTH_EMAIL_MODE=smtp`, `SMTP_URL` (a Nodemailer SMTP connection URL), and `SMTP_FROM` (the verified sender address). Signup is denied unless email delivery is configured. Development can explicitly use `AUTH_EMAIL_MODE=console`; this mode is rejected outside `NODE_ENV=development`. Unverified accounts cannot obtain sessions. Verification is sent at signup and sign-in; password resets revoke existing sessions.

`ADULT_SECTION_ENABLED` defaults to `false`. Adult access is available only when this server setting and `GlobalSettings.adultSectionEnabled` in PostgreSQL are both true. The discovery-state endpoint rejects selecting Adult while disabled and avoids returning a saved Adult selection when the feature is off.

## Authentication routes and recovery

Better Auth is mounted at `/api/auth/*`:

- `POST /api/auth/sign-up/email` creates an account. Include `x-beta-invite-code`; a verification email is required before the account can start a session.
- `POST /api/auth/sign-in/email` signs in a verified account. An unverified account receives a verification email.
- `POST /api/auth/request-password-reset` accepts an email and redirect URL; Better Auth emails the reset link.
- `POST /api/auth/reset-password` accepts the reset token and new password and revokes existing sessions.
- Email verification uses Better Auth's generated `/api/auth/verify-email` link.

The frontend includes `/forgot-password` and `/reset-password` screens. The reset email callback redirects back with a short-lived token, and the reset form submits the new password through Better Auth.

## Account data and deletion

- `GET /api/account/export` downloads the signed-in account's profile and discovery state as JSON, with catalogue labels for referenced local titles. It excludes password hashes, sessions, verification tokens, and provider credentials.
- `/account` provides the export link and account deletion flow. Deletion requires the current password in both the UI and the Better Auth server hook. The deletion hook protects the last active administrator; account-owned discovery state is deleted with its user row, Better Auth removes accounts and sessions, and the post-delete hook removes remaining verification records for that user.
- Account deletion is permanent. The user should download their export before confirming deletion if they want a copy.

## Discovery API

- `GET /api/discovery-state` returns the authenticated user's saved discovery state, or the default state on first use.
- `PUT /api/discovery-state` accepts the same JSON state shape, validates size and fields, and writes it for the authenticated user.

Both methods require a verified Better Auth session. The account ID always comes from the session cookie; request bodies cannot choose another user's row. Requests are limited to 256 KiB. Writes require a matching same-origin `Origin` header.

`GET` and `PUT /api/admin/settings` require an administrator session and read or update the singleton global settings. Adult can only be enabled when both the server flag and database setting allow it. `GET /api/admin/users` returns a limited account list; same-origin `PATCH /api/admin/users` disables or restores an account, revokes sessions when disabling, and protects the current and last active administrator.

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
