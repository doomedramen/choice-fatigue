# Choice Fatigue

A responsive media discovery app built with Next.js and TypeScript. The server foundation includes invite-only accounts, email verification, password recovery, per-account discovery sessions, account data export and deletion, protected admin pages, and shared global settings. The media catalogue is still mocked locally; metadata APIs and recommendation logic are not connected.

## Run locally

Requirements: Node.js 20.9+ and Docker Compose.

```sh
npm install
cp .env.example .env
cp .env.example .env.local
```

Set the same non-empty `BETA_INVITE_CODE` in `.env` and `.env.local` (for example, `local-demo-invite`). The example config uses console email delivery in development, so verification and password reset links appear in the terminal running the app.

Start the local database and prepare its schema:

```sh
docker compose up -d postgres
npm run db:setup
npm run dev
```

Open [http://localhost:4173](http://localhost:4173), create an account with the invite code, then open the verification link printed in the server terminal. Once verified, sign in and try the discovery flow. The admin page is available after promoting a verified account:

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
- `/admin` is restricted to administrators. Global app defaults are saved in PostgreSQL; admins can list accounts and disable or restore access.
- Sign-up is invite-only and requires email verification. Sign-in and password recovery use the configured email delivery mode.
- Adult is disabled by default and remains unavailable until both the server flag and admin setting enable it. Its confirmation screen is a self-attested age gate, not identity or legal age verification.

Metadata source cards are planning placeholders. No provider API calls or real API credentials are used. The example catalogue and artwork are local.

## Configuration for a shared deployment

Set `DATABASE_URL`, a unique `BETTER_AUTH_SECRET`, the public `BETTER_AUTH_URL`, and a private `BETA_INVITE_CODE`. Configure `AUTH_EMAIL_MODE=smtp`, `SMTP_URL`, and `SMTP_FROM` for verification and recovery emails. Apply the checked-in database migration with `npm run db:deploy`. Keep `ADULT_SECTION_ENABLED=false` unless the section has been reviewed and intentionally enabled.

See [docs/server-foundation.md](docs/server-foundation.md) for auth routes, environment settings, data ownership, and administrator setup. See [ROADMAP.md](ROADMAP.md) for the staged path to a shareable product.
