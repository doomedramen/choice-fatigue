# Choice Fatigue: product roadmap

**Status:** implementation in progress
**Checkpoint:** server foundation, account data controls, fixture catalogue, protected provider readiness, metadata imports, and encrypted per-account integration settings are implemented. The local OrbStack PostgreSQL database is migrated and seeded; account-flow validation and live service actions remain.
**Planning assumption:** begin with a small invite beta; expand after the core discovery loop and provider terms are settled.

## Where the project is today

The app now has invite-only Better Auth accounts after first-run setup, no email verification, password recovery, per-account discovery persistence, account export and deletion, admin-only settings and account controls, and a normalized server-side catalogue. Local fixtures support development but are not displayed in discovery. When TMDB is enabled, its popularity-sorted Movies and Shows pages are imported into the catalogue automatically alongside entries from other metadata providers. A session-scoped content ranker uses shortlist `+1`, pass `−0.5`, seen-title ratings from `−0.5` to `+1`, genres, release decade, title type, and source rating; persistent preference learning remains open. Adult remains off by default and its age prompt is self-attested.

## Product decisions to settle first

1. **Who is the first release for?** Start with individual discovery and shortlist review. Defer shared household or group sessions until individual use is working.
2. **What does “shareable” mean for beta?** The plan assumes people can create accounts and use the app on their own devices through an invite link. Public discovery links and collaborative sessions can follow later.
3. **Is Adult part of the first hosted release?** Keep it disabled in hosted environments until provider permissions, hosting rules, and age-access requirements are confirmed for the launch jurisdictions. A browser checkbox alone is not a production age control.
4. **What is the business model?** Treat the first release as non-commercial while the project is unfunded, but re-check provider terms before adding ads, paid tiers, sponsorships, or other revenue.
5. **Confirm the name.** Check domain, social handles, and trademark conflicts before investing in public branding.

## Phased delivery

### 1. Turn the prototype into a secure foundation

- Choose the initial hosting, authentication, and PostgreSQL providers after checking their policies against the intended content, especially the Adult section.
- Add server-side authentication, session handling, role checks, database migrations, and a staging environment.
- Store account and session records in PostgreSQL; keep each user's discovery decisions, temporary shortlist, removed picks, saved titles, and undo history in their own state row while the catalogue model is still being designed.
- Move session persistence from browser-only storage to the authenticated account so it works across devices. Keep a local migration path for prototype data only if it is useful to beta testers.
- Provide account data export and password-confirmed deletion; define retention, backups, and restore behavior before inviting users.

**Progress:** the auth, account-scoped state, protected admin, export, deletion, and encrypted per-account service settings are implemented. The local PostgreSQL migration and catalogue seed have run successfully. Sign-up, export/deletion, and cross-session persistence still need end-to-end validation before this phase can be marked complete.

**Exit condition:** an invited user can register, sign in, export or delete their account, and resume their discovery session on another device; an unauthenticated user cannot read or change account data.

### 2. Build one complete metadata path

- Create a normalized media record with an explicit provider and provider ID, category, title, year, runtime, genres, synopsis, artwork reference, and age/content flags.
- Implement provider adapters on the server. Store API keys in server secrets or a secret manager; never expose them to the browser or return them in admin responses.
- Start with a small Movies/Shows catalogue and fixture-backed adapter tests, then connect a permitted provider and add attribution in the app’s About/Credits area.
- Cache provider results, add request limits and retries, and show an empty state when no metadata source has available titles. Development fixtures must stay separate from discovery content.
- Evaluate anime coverage in the Movies and Shows searches without creating a separate Anime category.

**Progress:** the normalized catalogue model, fixture seeder, server loader, protected status reporting, opt-in TMDB search/import and automatic popularity-sorted Movies/Shows discovery imports are implemented. TMDB discovery records include genres, ratings, years, and poster paths; responses are cached and saved to PostgreSQL. The gated text-only ThePornDB/StashDB Adult imports remain available. Anime series are found under Shows and anime films under Movies. TMDB attribution is available at `/credits`. Automatic refresh beyond the first two pages, cache/retention policy review, provider health, service connection checks/actions, and full database-backed account-flow validation remain open.

**Provider notes:**

- **TMDB:** its FAQ says the developer API is free for non-commercial use with attribution, and commercial use requires contacting TMDB. It also says its data and images may not be used in connection with pornographic content. This creates an unresolved conflict with a single Choice Fatigue product that includes an Adult section. Get written guidance from TMDB or keep the TMDB-powered experience and Adult experience separate before launch. [TMDB API FAQ](https://developer.themoviedb.org/docs/faq)
- **ThePornDB and StashDB:** Stash's docs list both as supported Stash-Box metadata sources, and ThePornDB publishes API documentation for scenes and movies. Choice Fatigue uses them for Adult metadata, with credentials kept on the server and no explicit artwork in the first integration. The Stash guide describes a local Stash installation, so request-volume and cache behavior still need to be confirmed for the hosted beta. [Stash guide](https://docs.stashapp.cc/beginner-guides/guide-to-scraping/), [Stash-Box instances](https://docs.stashapp.cc/metadata-sources/stash-box-instances/), [ThePornDB API docs](https://api.theporndb.net/docs), [StashDB access guide](https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/)

**Exit condition:** the app can serve a reliable, attributed catalogue through one provider adapter without putting credentials in the client, and provider failures do not break discovery.

### 3. Finish the core Choice Fatigue experience

- Preserve the existing flow: browse, pass/shortlist, undo, review side by side, prune, restore, keep browsing, then permanently save.
- Connect all actions to account-scoped server data and keep temporary shortlist state distinct from permanent saves.
- Add first-run onboarding, clear empty/error/loading states, keyboard and touch support, and screen-reader labels.
- Add privacy controls for saved lists and any future share links. Do not make a user’s list public by default.

**Exit condition:** a user can complete the whole flow repeatedly across devices without losing, duplicating, or confusing temporary and saved choices.

### 4. Replace the admin mockup with real administration

- Require an authenticated admin role on every admin page and server action/API route.
- Start with global settings, feature flags, provider connection status, and user role/status management.
- Configure API credentials through server deployment secrets first. Only add secret editing to the admin UI if the backend encrypts secrets, masks them on read, audits changes, and supports rotation.
- Add an audit trail for admin actions and protect destructive or bulk changes with confirmation and recovery where possible.

**Exit condition:** normal users cannot reach admin data or operations; admins can diagnose integrations and manage accounts without seeing stored secret values.

### 5. Prepare and run an invite beta

- Deploy staging and production with HTTPS, database backups, error reporting, request limits, and an operational rollback path.
- Publish privacy, terms, cookie, and content policies that match the actual data and providers used. Add contact and account support routes.
- Confirm the name and domain, provider rights, hosting acceptable-use rules, and any age/access obligations for the chosen launch regions.
- Invite a small group, observe completion and return rates for the discovery/review loop, and fix the biggest usability failures before opening signups.

**Exit condition:** backup restoration has been rehearsed, account deletion works, provider and hosting terms have been checked, and beta feedback shows users can complete the core flow without help.

### 6. Decide what to build after beta

Use beta feedback to choose among collaborative sessions, shareable shortlists, persistent recommendation profiles, more catalogue sources, and paid plans. Keep these out of the initial launch unless testing shows they are required for the core product.

## Immediate next steps

1. Exercise sign-up, account export/deletion, and cross-session discovery persistence against the local OrbStack database.
2. Implement connection health checks and library lookup through Seerr, then add direct Whisparr v2/v3 and Stash actions for Adult.
3. Add Plex and Trakt OAuth, followed by direct Radarr/Sonarr fallbacks for users who do not use Seerr. Keep connections account-scoped and support multiple instances.
4. Confirm TMDB's cache/retention terms and the Adult-content boundary; confirm ThePornDB/StashDB request-volume and cache guidance for hosted use.
5. Choose hosting and rehearse database backup restoration before inviting anyone outside local development.
