# AGENTS.md

This file provides guidance AI Agents when working with code in this repository.

> **This is a living document.** Keep it up to date as part of your work: when you change a command, add or remove a major subsystem, alter a convention, or find that something here is wrong or stale, update this file in the same change. Remove outdated guidance rather than leaving it to mislead the next session.

## What this is

Choice Fatigue: a self-hosted media discovery app (swipe pass/shortlist, review-and-prune, save). Next.js (App Router) + React 19 + TypeScript, PostgreSQL via Prisma 7 (`@prisma/adapter-pg`), auth via better-auth. See `README.md` for product behaviour and `ROADMAP.md` for status; `docs/` holds self-hosting, provider-term, and recommendation-algorithm research/plan notes.

## Commands

Package manager is pnpm (pinned 12.16.1, Node 22+); the README/hooks run it through Volta (`volta run pnpm ...`).

- `pnpm dev` — Next dev server on port 4173 (runs `prisma generate` first). Needs `.env` and `.env.local` (copy `.env.example`; `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `INTEGRATION_CREDENTIALS_KEY`). Local Postgres: `docker compose up -d postgres`, then `pnpm db:setup`.
- `pnpm test` — unit tests (`tsx --test tests/*.test.ts`). Single file: `pnpm exec tsx --test tests/recommendations.test.ts`; filter by name with `--test-name-pattern`.
- `pnpm typecheck` — `prisma generate && next typegen && tsc --noEmit`.
- `pnpm exec prisma validate`, `pnpm build`.
- `pnpm test:e2e` — Playwright against a disposable DB. Set `E2E_DATABASE_URL` to an empty database whose name ends in `_e2e`, run `pnpm db:deploy:e2e` first. The suite wipes that DB; never point it at real data. Provider APIs are mocked by `tests/e2e/metadata-stub.ts` (started by the Playwright config, with `*_API_BASE_URL` env overrides).
- `pnpm db:migrate` (dev migration), `pnpm db:deploy` (apply), `pnpm admin:promote -- email` (grant admin), `pnpm integrations:rotate-key`.
- `pnpm eval:replay -- account-export.json` — offline replay of the ranker against an account export.
- Lefthook: pre-commit runs `git diff --cached --check`, tests, typecheck; pre-push adds prisma validate and build.

`src/generated/prisma` is generated output (`prisma generate`); don't hand-edit it.

## Architecture

**Provider-transient metadata.** There is deliberately no local media catalogue or response cache. Feeds are fetched live from providers on demand (`src/lib/providers/`: TMDB for Movies/Shows, ThePornDB + StashDB for Adult) and only provider IDs, candidate-ID traces, and user actions are persisted. Don't add code that stores provider metadata (titles, artwork, etc.) in the DB or on disk. Categories (Movies, Shows, Adult) are strictly isolated in recommendation profiles; anime lives under Movies/Shows, not its own category.

**Discovery pipeline** (`src/lib/`):
- `discovery-feed.ts` / `catalogue.ts` + `api/discovery-feed` — builds a feed from multiple source/lane "streams" (popular, preference-based, related-to-seed), paginated via an opaque cursor (`FeedCursor`); per-source failures are isolated and reported in `FeedSourceStatus`.
- `recommendations.ts`, `recommendation-profile.ts`, `credit-features.ts` — ranker (confidence shrinkage, feature keys, credits, same-review comparisons). Weights are unvalidated; `recommendation-evaluation.ts` + `scripts/evaluate-recommendation-replay.ts` do offline replay.
- `recommendation-event-validation.ts`, `recommendation-outbox.ts`, `api/recommendation-events` — client emits versioned events (impressions, decisions, review remove/restore, saves, `save_withdrawn`, undo) in bounded batches; the server validates, accepts or rejects per event, and the client outbox settles/quarantines/retries (Adult events refused while access is off are held, not quarantined). Current version is `content-v7`; writes accept v6–v7 only, reads accept every version. Apply corrections through `effectiveRecommendationEvents` (in `recommendations.ts`) rather than re-implementing undo/withdraw handling.
- `recommendation-profile.ts` / `recommendation-profile-query.ts` — profile reads load only preference event types, capped and without trace payloads.
- `feed-cursor.ts` — discovery cursors are HMAC-signed with `BETTER_AUTH_SECRET` and bound to the user.
- `discovery-state.ts`, `discovery-state-merge.ts`, `api/discovery-state` — per-account session state (shortlist vs permanently saved, undo history) persisted server-side and merged across devices; UI lives in `src/app/discovery-client.tsx`.

**Access control.** First account becomes admin; later sign-ups need the admin-set invite code. Adult content requires both the instance master switch (`global-settings.ts`) and a per-account admin grant (`adult-access*.ts`). Auth in `auth.ts`/`auth-session.ts`; `/admin` and admin APIs are role-checked.

**Integrations and secrets.** Provider credentials, SMTP, and shared service connections (Seerr, Plex, Radarr, Sonarr, Whisparr, Stash, Jellyfin, Emby) are configured in the Admin UI and stored AES-encrypted in Postgres using `INTEGRATION_CREDENTIALS_KEY` (`src/lib/integrations/crypto.ts`); losing the key makes them undecryptable. Server-side only — never return secrets to the client.

**Schema/migrations** live in `prisma/` (config in `prisma.config.ts`; `prisma.e2e.config.ts` targets the e2e DB). Deployment: `Dockerfile`, `docker-compose*.yml`, `ct/` + `install/` (Proxmox LXC community-scripts), documented in `docs/self-hosting.md`.

UI: dialogs use `Modal` / `ConfirmDialog` from `src/app/modal.tsx` (focus in, Tab trapped, focus restored; mark the rest of the page `inert`), not `window.confirm` or hand-rolled `role="dialog"` markup. Fonts come from `next/font` via the `--font-dm-sans` / `--font-manrope` CSS variables; don't reference the family names directly. The UI is dark-only.

Path alias `@/*` → `src/*`. `.agents/` and `.claude/skills/` contain vendored Prisma skills, not project code.
