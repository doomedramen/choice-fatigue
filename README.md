# Choice Fatigue

A responsive media discovery app built with Next.js and TypeScript. It includes manually shared invite codes, password recovery, per-account discovery sessions and persistent preference learning, account export and deletion, protected admin settings, shared media service connections, and database-backed metadata provider settings. Adult access is off by default and granted per account by an administrator.

For self-hosting, see [Docker Compose and Proxmox LXC setup](docs/self-hosting.md).

## Install on Proxmox VE

From a root shell on the Proxmox VE host, run this command to create a new Debian 13 LXC and install Choice Fatigue with the Community Scripts tooling:

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/doomedramen/choice-fatigue/main/ct/choicefatigue.sh)"
```

The installer detects the container IPv4 address and starts with local-network access at `http://<LXC-IP>:4173`; no domain or reverse proxy is required for initial setup. It uses the Community Scripts defaults of 2 CPU cores, 4 GB RAM, and 6 GB disk. Read [the Proxmox setup notes](docs/self-hosting.md) before running it.

## Deploy with Docker Compose

For a deployment that pulls the published image from GitHub Container Registry (GHCR), copy `deploy/env.compose.example` to `deploy/env.compose`, replace its example secrets, and save this file as `docker-compose.ghcr.yml` in the repository root:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: choice_fatigue
      POSTGRES_USER: choice_fatigue
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in deploy/env.compose}
    volumes:
      - choice_fatigue_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U choice_fatigue -d choice_fatigue"]
      interval: 5s
      timeout: 3s
      retries: 20

  app:
    image: ghcr.io/doomedramen/choice-fatigue:${CHOICE_FATIGUE_VERSION:-latest}
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://choice_fatigue:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in deploy/env.compose}@postgres:5432/choice_fatigue?schema=public
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?Set BETTER_AUTH_SECRET in deploy/env.compose}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:?Set BETTER_AUTH_URL in deploy/env.compose}
      INTEGRATION_CREDENTIALS_KEY: ${INTEGRATION_CREDENTIALS_KEY:?Set INTEGRATION_CREDENTIALS_KEY in deploy/env.compose}
    ports:
      - "${APP_PORT:-4173}:4173"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4173/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s

volumes:
  choice_fatigue_data:
```

Start it from the repository root with:

```sh
docker compose --env-file deploy/env.compose -f docker-compose.ghcr.yml up -d
```

The GHCR image reference is ready for the planned GitHub Actions publishing workflow; it cannot be pulled until that workflow publishes the image. For now, the existing [`docker-compose.release.yml`](docker-compose.release.yml) builds the app image locally from source.

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

For checks, run `volta run pnpm test`, `volta run pnpm typecheck`, and `volta run pnpm exec prisma validate`. Playwright uses disposable PostgreSQL and local mocked metadata providers; set `E2E_DATABASE_URL` to an empty database whose name ends in `_e2e`, apply migrations with `volta run pnpm db:deploy:e2e`, install Chromium with `volta run pnpm exec playwright install chromium`, then run `volta run pnpm test:e2e`. The browser suite clears only that explicitly named test database before each attempt. Never point it at a real account database.

Lefthook installs Git hooks when dependencies are installed. Pre-commit runs whitespace checks, unit tests, and typecheck. Pre-push runs unit tests, typecheck, Prisma validation, and a production build through the pinned Volta toolchain; it does not need Docker or a test database. GitHub Actions runs the full release checks, including PostgreSQL migrations and the Playwright browser suite, on pushes and pull requests.

To compare matched provider order with the current ranker at each impression on an authorized account export, run `volta run pnpm eval:replay -- account-export.json` with database and encryption settings available in `.env`. The evaluator resolves current provider features transiently, makes at most 500 detail lookups (spent on whole sessions) with four concurrent requests, and never writes metadata to disk or the database. Version 6 captures candidate order and lookup outcomes; older events are incomplete, and all results remain approximate because provider metadata can change. These comparisons do not establish causal lift. Shown-card and candidate traces are kept for 180 days, so replay covers about the last six months; choices and saves are kept until the account clears them. See [the replay method](docs/recommendation-algorithm-plan.md#historical-replay).

## What works

- Mouse, touch, and keyboard swipes with pass, shortlist, and undo. Removing a pick, removing it in review, and saving all offer an Undo in the notice; saved titles can be removed from the Saved list.
- Details overlays, a review-and-prune flow, restore, keep browsing, and final save. Dialogs keep keyboard focus inside and return it when closed.
- The interface is dark-only by design; there is no light theme. Fonts are self-hosted at build time, so pages make no requests to Google Fonts.
- Temporary shortlists stay separate from permanently saved titles.
- Discovery state is saved to PostgreSQL per account. Existing browser prototype data is imported once when the account has no saved server session.
- `/account` downloads a JSON copy of the profile and discovery state. Permanent deletion requires the current password and typed confirmation.
- `/admin` is restricted to administrators. Global app defaults, the Adult master switch, invitation code, optional SMTP delivery, and private-network access are stored in PostgreSQL. Admins can manage accounts, grant Adult access per account, configure metadata providers, and manage shared service connections.
- TMDB, ThePornDB, and StashDB credentials are encrypted in PostgreSQL. TMDB supplies Movies and Shows, including anime series under Shows and anime films under Movies. Adult-flagged TMDB results are rejected. ThePornDB and StashDB supply text-only Adult metadata; source artwork is not displayed.
- Seerr, Plex, Radarr, Sonarr, Whisparr v2/v3, Stash, Jellyfin, and Emby connections are configured once in Admin settings and shared by the instance. Their server addresses and credentials are encrypted at rest. Admins can test supported connections; users can check TMDB-linked saved titles against Seerr and Plex and request eligible titles through Seerr.
- Discovery loads popular titles plus qualified preference-based candidates directly from provider APIs when the site opens; nobody has to search for or preload titles. TMDB supplies Movies and Shows. Enabled ThePornDB and StashDB sources supply paginated Adult scenes and movies. TMDB genre and StashDB tag lanes can retrieve niche candidates; source failures are isolated. Provider responses are not cached or written to a local media catalogue. Only provider IDs, candidate ID traces, and user actions are persisted.
- The development v3 migration resets old learning traces and mutable deck decisions, preserves saved provider IDs, and seeds their retention evidence. Legacy event formats are not supported.
- Discovery uses choices and ten-point ratings to learn category-specific preferences. Movies and Shows also use bounded people and studio signals, and Shows can draw candidates related to highly rated or saved shows. Sparse evidence shrinks toward neutral, and Adult signals remain isolated. Provider metadata is fetched transiently. See [`docs/recommendation-algorithm-plan.md`](docs/recommendation-algorithm-plan.md).
- The first account can sign up without an invite and becomes administrator. Later sign-ups require the invite code saved by an administrator. Signup and sign-in do not send or require email verification.
- Adult is disabled by default. An administrator must enable the instance master switch and grant access separately to each account. Its confirmation screen is a self-attested age gate, not identity or legal age verification.

All application configuration is managed through Admin settings. Environment variables are limited to database connectivity, authentication runtime settings, and the server encryption key.

## Shared deployment

Set `DATABASE_URL`, a unique `BETTER_AUTH_SECRET`, the public `BETTER_AUTH_URL`, and a private `INTEGRATION_CREDENTIALS_KEY`. Run `volta run pnpm db:deploy` to apply checked-in migrations, then start the app with `volta run pnpm start`. The first account becomes administrator; no invite code or email configuration is needed for initial setup. Configure later invites, provider credentials, Adult access, optional password-reset SMTP, and shared media services in Admin settings.

See [docs/server-foundation.md](docs/server-foundation.md) for authentication routes, configuration storage, data ownership, and administrator setup. See [docs/provider-review.md](docs/provider-review.md) for metadata source boundaries and review notes, and [ROADMAP.md](ROADMAP.md) for the staged path to a shareable product.
