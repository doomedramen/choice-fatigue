# Choice Fatigue: product roadmap

**Status:** implementation in progress
**Checkpoint:** server foundation, account data controls, fixture catalogue, protected provider readiness, opt-in TMDB import, and text-only Adult metadata imports are implemented. The local OrbStack PostgreSQL database is migrated and seeded; account-flow validation remains.
**Planning assumption:** begin with a small invite beta; expand after the core discovery loop and provider terms are settled.

## Where the project is today

The app now has invite-only Better Auth accounts, required email verification, password recovery, a PostgreSQL/Prisma schema, per-account discovery persistence, first-use migration from the old browser session, account export and deletion, admin-only settings and account controls, and a normalized server-side catalogue seeded from local fixtures. The local OrbStack PostgreSQL database has both checked-in migrations applied and 12 fixture entries; no provider credentials are configured, so the opt-in external integrations are inactive. Recommendation logic is not connected. Adult remains off by default and its age prompt is self-attested.

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

**Progress:** the auth, account-scoped state, protected admin, export, and deletion paths are implemented. The local PostgreSQL migration and catalogue seed have run successfully. Sign-up, email verification, export/deletion, and cross-session persistence still need end-to-end validation before this phase can be marked complete.

**Exit condition:** an invited user can register, sign in, export or delete their account, and resume their discovery session on another device; an unauthenticated user cannot read or change account data.

### 2. Build one complete metadata path

- Create a normalized media record with an explicit provider and provider ID, category, title, year, runtime, genres, synopsis, artwork reference, and age/content flags.
- Implement provider adapters on the server. Store API keys in server secrets or a secret manager; never expose them to the browser or return them in admin responses.
- Start with a small Movies/TV catalogue and fixture-backed adapter tests, then connect a permitted provider and add attribution in the app’s About/Credits area.
- Add caching, request limits, timeouts, retries, provider health status, and a way to fall back to cached or seeded catalogue data.
- Evaluate Anime coverage against a representative list before adding a dedicated anime provider.

**Progress:** the normalized catalogue model, fixture seeder, server loader, empty-table fallback, protected status reporting, opt-in TMDB search/import for Movies/TV/Anime, and gated text-only ThePornDB/StashDB search/import for Adult are implemented. TMDB attribution is available at `/credits`. Automatic refresh, caching/retention policy, provider health, and full database-backed account-flow validation remain open.

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

Use beta feedback to choose among collaborative sessions, shareable shortlists, recommendation/ranking logic, more catalogue sources, and paid plans. Keep these out of the initial launch unless testing shows they are required for the core product.

## Immediate next steps

1. Exercise sign-up, email verification, account export/deletion, and cross-session discovery persistence against the local OrbStack database.
2. Confirm TMDB's cache/retention terms and the Adult-content boundary; confirm ThePornDB/StashDB request-volume and cache guidance for hosted use.
3. Validate the TMDB and Adult provider flows against configured credentials, respecting each source boundary and keeping credentials server-only.
4. Choose hosting and rehearse database backup restoration before inviting anyone outside local development.
