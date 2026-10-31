# Choice Fatigue: product roadmap

**Status:** v1 release hardening in progress
**Checkpoint:** authentication, account data controls, live provider feeds, admin settings, shared service configuration, and Docker Compose/LXC packaging are implemented. Package version is 1.0.0. Local unit, type, schema, production build, clean migration, and mocked-browser checks pass. Clean Compose install and backup/restore are rehearsed. A real Proxmox LXC run, reverse-proxy and upgrade rehearsals, historical trace evaluation, live-provider checks, and provider-term determination remain open.
**Version 1 scope:** multi-account instances with a manually shared reusable invite code, instance-wide media services, per-account Adult grants behind an instance master switch, and persistent category-isolated recommendation profiles.

## Where the project is today

The app has first-account administrator setup, manually shared invitation codes, password recovery, per-account discovery persistence, account export and deletion, and protected admin controls. Discovery fetches popular feeds directly with no background sync, response cache, search, import, or media catalogue table. Persisted discovery and recommendation data retain provider IDs and user actions only. TMDB supplies Movies and Shows; ThePornDB and StashDB supply Adult. The ranker includes confidence shrinkage, bounded transient provider lookups, saved-title retention, same-review comparisons, profile-aware retrieval, paginated Adult sources, reliable v3 event delivery, and ID-only batch/impression traces. Its weights remain unvalidated. See [the algorithm research and implementation order](docs/recommendation-algorithm-research.md). Mocked browser coverage exercises account flows, durable events, provider failures, and Adult grants. The replay tool now compares provider order and the current ranker against observed shortlist/save labels; representative real-world results await sufficient traces.

## Version 1 decisions

1. **Audience:** self-hosters running one private instance; shared household sessions and public discovery links are later work.
2. **Install targets:** Docker Compose and a Proxmox LXC install path following community-scripts conventions.
3. **Accounts and services:** reusable manually shared invite code, administrator-managed accounts, and instance-wide service connections.
4. **Adult access:** off by default; both the instance switch and an explicit per-account administrator grant are required. The age prompt remains self-attested.
5. **Recommendation learning:** persistent account-owned history with strict category isolation; no cross-user collaborative signals.

## Phased delivery

### 1. Turn the prototype into a secure foundation

- Choose the initial hosting, authentication, and PostgreSQL providers after checking their policies against the intended content, especially the Adult section.
- Add server-side authentication, session handling, role checks, database migrations, and a staging environment.
- Store account and session records in PostgreSQL; persist each user's discovery decisions, temporary shortlist, removed picks, saved provider IDs, and undo history without a title catalogue.
- Move session persistence from browser-only storage to the authenticated account so it works across devices. Keep a local migration path for prototype data only if it is useful to beta testers.
- Provide account data export and password-confirmed deletion; define retention, backups, and restore behavior before inviting users.

**Progress:** authentication, account-scoped state, protected admin, export, deletion, and encrypted instance-wide service settings are implemented and covered by mocked browser flows, including cross-account isolation and unauthorized access.

**Exit condition:** an invited user can register, sign in, export or delete their account, and resume their discovery session on another device; an unauthenticated user cannot read or change account data.

### 2. Build one complete metadata path

- Create a normalized media record with an explicit provider and provider ID, category, title, year, runtime, genres, synopsis, artwork reference, and age/content flags.
- Implement provider adapters on the server. Store API keys in server secrets or a secret manager; never expose them to the browser or return them in admin responses.
- Connect on-demand Movies/Shows and Adult feeds directly to their selected providers, with source attribution in the app’s About/Credits area.
- Request provider feeds on demand without persisting media metadata; bound request counts and show a clear retry state when a provider is unavailable. Development fixtures must stay separate from discovery content.
- Evaluate anime coverage in the Movies and Shows feeds without creating a separate Anime category.

**Progress:** protected provider settings and on-demand popular Movies/Shows feeds are implemented. The gated Adult feed combines enabled ThePornDB scene/movie results and StashDB popularity-ranked scenes; stable provider IDs keep swipe history attached across requests. Provider metadata is transient. The release migration drops the legacy catalogue cache and obsolete TVDB credential. Anime series are found under Shows and anime films under Movies. TMDB attribution is available at `/credits`. Mocked provider failure and malformed-response coverage, migration validation, and a clean Compose backup/restore rehearsal pass. Live-provider smoke checks and complete provider-term guidance remain open.

**Provider notes:**

- **TMDB:** its FAQ says the developer API is free for non-commercial use with attribution, and commercial use requires contacting TMDB. It also says its data and images may not be used in connection with pornographic content. This creates an unresolved conflict with a single Choice Fatigue product that includes an Adult section. Get written guidance from TMDB or keep the TMDB-powered experience and Adult experience separate before launch. [TMDB API FAQ](https://developer.themoviedb.org/docs/faq)
- **ThePornDB and StashDB:** Stash's docs list both as supported Stash-Box metadata sources, and ThePornDB publishes API documentation for scenes and movies. Choice Fatigue uses them for Adult metadata, with credentials kept on the server and no explicit artwork in the first integration. The Stash guide describes a local Stash installation, so request-volume and cache guidance remain a 1.0 review item. [Stash guide](https://docs.stashapp.cc/beginner-guides/guide-to-scraping/), [Stash-Box instances](https://docs.stashapp.cc/metadata-sources/stash-box-instances/), [ThePornDB API docs](https://api.theporndb.net/docs), [StashDB access guide](https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/)

**Exit condition:** the app can serve reliable, attributed provider feeds without putting credentials in the client, and provider failures do not break available discovery.

### 3. Finish the core Choice Fatigue experience

- Preserve the existing flow: browse, pass/shortlist, undo, review side by side, prune, restore, keep browsing, then permanently save.
- Connect all actions to account-scoped server data and keep temporary shortlist state distinct from permanent saves.
- Add first-run onboarding, clear empty/error/loading states, keyboard and touch support, and screen-reader labels.
- Add privacy controls for saved lists and any future share links. Do not make a user’s list public by default.

**Exit condition:** a user can complete the whole flow repeatedly across devices without losing, duplicating, or confusing temporary and saved choices.

### 4. Complete administrator controls

- Require an authenticated admin role on every admin page and server action/API route.
- Start with global settings, feature flags, provider connection status, and user role/status management.
- The admin UI already encrypts provider and service credentials, masks them on read, and supports key rotation. Add the per-account Adult grant and verify access changes are enforced by server routes.
- Keep role promotion as a trusted-shell operation and protect account disablement with the existing last-admin safeguards.

**Exit condition:** normal users cannot reach admin data or operations; admins can diagnose integrations and manage accounts without seeing stored secret values.

### 5. Prepare the self-hosted 1.0 release

- Provide Docker Compose and Proxmox LXC setup, upgrade, secret-handling, and database restore instructions.
- Verify provider terms, request-volume expectations, and Adult access responsibilities for the supported private-instance use.
- Complete account, discovery, service, recommendation, backup, and restore checks against a clean installation before tagging 1.0.

**Exit condition:** backup restoration has been rehearsed, account deletion works, provider and hosting terms have been checked, and beta feedback shows users can complete the core flow without help.

### 6. Decide what to build after beta

After 1.0, use self-hosted feedback to choose among collaborative sessions, shareable shortlists, more catalogue sources, and paid plans. Keep these out of the initial release.

## Immediate next steps

1. [x] Confirm the pushed GitHub Actions run passes the browser suite on a clean PostgreSQL service (commit `408dfede`, run [41097370113](https://github.com/doomedramen/choice-fatigue/actions/runs/41097370113)).
2. Run the chronological provider-order/current-ranker comparison on enough ID-only traces; report coverage and descriptive metrics without causal claims or unsupported weight changes. This requires an authorized account export with sufficient traces; none is present in the project files.
3. Rehearse an app upgrade and HTTPS reverse-proxy setup. The LXC installer now uses the Community Scripts `ct/` and `install/` pair; run it in a Debian 13 Proxmox environment before upstream submission.
4. [x] Review provider terms and request volume ([review](docs/provider-term-review-2026-10-31.md)). Before release, get written TMDB guidance on a combined TMDB-plus-Adult instance or separate those experiences, confirm account-specific ThePornDB and StashDB terms, and run live smoke checks with operator credentials.
5. Tag and push `v1.0.0` only after automated checks and external release gates pass.
6. Add GitHub Actions publishing for GHCR images, then validate the image-based Compose deployment documented in `README.md`.
