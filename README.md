# Choice Fatigue

A responsive media discovery app built with Next.js and TypeScript. It includes manually shared invite codes, password recovery, per-account discovery sessions and persistent preference learning, account export and deletion, protected admin settings, shared media service connections, and database-backed metadata provider settings. Adult access is off by default and granted per account by an administrator.

For self-hosting, see [Docker Compose and Proxmox LXC setup](docs/self-hosting.md).

## Run locally

Requirements: Node.js 22 or newer, pnpm 12.16.1, and Docker Compose. If you use Volta, install the project tool versions with:

```sh
volta install node@22
volta install pnpm@12.16.1
```

Copy the example settings for Prisma and Next.js:

```sh
cp .env.example .env
cp .env.example .env.local
```

Set `DATABASE_URL`, a unique `BETTER_AUTH_SECRET`, the public `BETTER_AUTH_URL`, and a private `INTEGRATION_CREDENTIALS_KEY` in both files. Generate the encryption key with `openssl rand -base64 32`; saved provider, mail, and service credentials cannot be decrypted if this key is lost. These are core server settings. Application options and provider credentials are managed in the Admin UI and stored in PostgreSQL.

Start the local database and prepare the schema:

```sh
docker compose up -d postgres
volta run pnpm db:setup
volta run pnpm dev
```

Open [http://localhost:4173](http://localhost:4173) and create the first account without an invite. It becomes the administrator and signs in immediately. The admin can set an invite code in Global settings for later sign-ups. Signup and sign-in do not require email. Configure SMTP in Global settings only if password-reset emails are wanted.

To recover admin access for an existing deployment, promote an account from a trusted shell:

```sh
volta run pnpm admin:promote -- account-email@example.com
```

For checks, run `volta run pnpm test`, `volta run pnpm typecheck`, and `volta run pnpm exec prisma validate`. Playwright uses disposable PostgreSQL and local mocked metadata providers; set `E2E_DATABASE_URL` to an empty test database, apply migrations with `volta run pnpm db:deploy`, install Chromium with `volta run pnpm exec playwright install chromium`, then run `volta run pnpm test:e2e`. GitHub Actions runs these checks and a production build. Never point the browser suite at a real account database.

To compare provider order with the current ranker on an authorized account export, run `volta run pnpm eval:replay -- account-export.json` with database and encryption settings available in `.env`. The evaluator resolves current provider features transiently, makes at most 500 detail lookups with four concurrent requests, and never writes metadata to disk or the database. Results use current provider metadata and historical choices, so they are offline descriptive comparisons rather than causal lift estimates. See [the replay method](docs/recommendation-algorithm-plan.md#historical-replay).

## What works

- Mouse, touch, and keyboard swipes with pass, shortlist, and undo.
- Details overlays, a review-and-prune flow, restore, keep browsing, and final save.
- Temporary shortlists stay separate from permanently saved titles.
- Discovery state is saved to PostgreSQL per account. Existing browser prototype data is imported once when the account has no saved server session.
- `/account` downloads a JSON copy of the profile and discovery state. Permanent deletion requires the current password and typed confirmation.
- `/admin` is restricted to administrators. Global app defaults, the Adult master switch, invitation code, optional SMTP delivery, and private-network access are stored in PostgreSQL. Admins can manage accounts, grant Adult access per account, configure metadata providers, and manage shared service connections.
- TMDB, ThePornDB, and StashDB credentials are encrypted in PostgreSQL. TMDB supplies Movies and Shows, including anime series under Shows and anime films under Movies. Adult-flagged TMDB results are rejected. ThePornDB and StashDB supply text-only Adult metadata; source artwork is not displayed.
- Seerr, Plex, Radarr, Sonarr, Whisparr v2/v3, Stash, Jellyfin, and Emby connections are configured once in Admin settings and shared by the instance. Their server addresses and credentials are encrypted at rest. Admins can test supported connections; users can check TMDB-linked saved titles against Seerr and Plex and request eligible titles through Seerr.
- Discovery loads currently popular titles directly from provider APIs when the site opens; nobody has to search for or preload titles. TMDB supplies Movies and Shows. Enabled ThePornDB and StashDB sources supply Adult scenes and movies. Provider responses are not cached or written to a local media catalogue. Only provider IDs, candidate ID traces, and user actions are persisted.
- Discovery ranks using explicit choices and seen-title ratings across genre, release decade, and media type. Sparse evidence shrinks toward neutral, saved choices add retention evidence, and removals only compare within their review. Provider ratings do not affect rank, and Adult signals remain isolated from Movies and Shows. See [`docs/recommendation-algorithm-plan.md`](docs/recommendation-algorithm-plan.md).
- The first account can sign up without an invite and becomes administrator. Later sign-ups require the invite code saved by an administrator. Signup and sign-in do not send or require email verification.
- Adult is disabled by default. An administrator must enable the instance master switch and grant access separately to each account. Its confirmation screen is a self-attested age gate, not identity or legal age verification.

All application configuration is managed through Admin settings. Environment variables are limited to database connectivity, authentication runtime settings, and the server encryption key.

## Shared deployment

Set `DATABASE_URL`, a unique `BETTER_AUTH_SECRET`, the public `BETTER_AUTH_URL`, and a private `INTEGRATION_CREDENTIALS_KEY`. Run `volta run pnpm db:deploy` to apply checked-in migrations, then start the app with `volta run pnpm start`. The first account becomes administrator; no invite code or email configuration is needed for initial setup. Configure later invites, provider credentials, Adult access, optional password-reset SMTP, and shared media services in Admin settings.

See [docs/server-foundation.md](docs/server-foundation.md) for authentication routes, configuration storage, data ownership, and administrator setup. See [docs/provider-review.md](docs/provider-review.md) for metadata source boundaries and review notes, and [ROADMAP.md](ROADMAP.md) for the staged path to a shareable product.
