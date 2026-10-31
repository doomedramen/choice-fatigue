# Metadata provider terms and request-volume review

**Reviewed:** 2026-10-31 against public provider documentation

This is an operational review, not legal advice or provider approval. It does not replace account-specific terms or written guidance from a provider. No provider accounts or credentials were used, and no provider was contacted.

## Release decision: TMDB and Adult in one instance

TMDB's current FAQ describes its API as for movie, TV, and actor data in applications. It permits non-commercial use with attribution, defines commercial projects by whether their primary purpose is revenue for the owner, and directs commercial projects to request a separate license. It requires the TMDB logo and the notice “This product uses the TMDB API but is not endorsed or certified by TMDB,” with attribution in an About or Credits section. The same FAQ says TMDB data and images may not be used in connection with obscene, pornographic, abusive, or otherwise offensive content. [TMDB FAQ](https://developer.themoviedb.org/docs/faq)

The FAQ does not define whether this restriction reaches a product that shows TMDB-powered Movies and Shows alongside a distinct, access-gated Adult section using other providers. Choice Fatigue's separate feeds and recommendation histories reduce technical mixing, but public documentation does not establish that this separation is sufficient under TMDB's restriction. The project's current `/credits` page includes the TMDB logo and the required notice when TMDB is enabled; that addresses attribution only, not the unresolved content boundary.

**Release gate:** Do not represent the combined TMDB-plus-Adult experience as permitted based on category isolation alone. Before enabling both in a release configuration, obtain written guidance from TMDB that addresses one Choice Fatigue instance containing both experiences, or ship the TMDB-powered and Adult experiences separately. Also confirm the license path for any operator whose instance is commercial under TMDB's definition. This is a conservative product decision under ambiguity, not a legal conclusion that the current design violates the terms.

## Request volume and availability

TMDB says it has no SLA. Its rate-limit documentation says the former fixed limit of 40 requests per 10 seconds was disabled; it describes an approximate upper limit around 40 requests per second intended to limit needless bulk scraping, says the limit can change, and tells clients to honor HTTP 429. This is not a guaranteed quota. [TMDB FAQ](https://developer.themoviedb.org/docs/faq), [TMDB rate limits](https://developer.themoviedb.org/docs/rate-limiting)

The existing implementation review records six concurrent list/discovery requests for a normal feed load and separately bounded feature enrichment (up to four concurrent lookups and twelve missing IDs). Those request bounds are far below TMDB's published approximate ceiling for ordinary individual loads, but do not establish a quota, permission for bulk use, or capacity for an arbitrarily large self-hosted installation. Keep honoring 429 responses and avoid background harvesting or bulk sync.

The public ThePornDB API documentation describes versioned REST endpoints and bearer-token authentication. It does not publish a request quota, service-level commitment, or generally applicable metadata-retention term in the pages reviewed. Its OpenAPI specification endpoint was not readable by this review tool, so the absence of such policy from the accessible docs is not proof that no policy exists. Check the current terms associated with each operator's ThePornDB account before production use. [ThePornDB API documentation](https://api.theporndb.net/docs)

StashDB's public access guidance says users need an account and API key to access data, and describes connecting StashDB to a local Stash installation to pull scene, performer, and studio data. The public pages reviewed do not set a general API request quota, SLA, or retention policy for a separate third-party product such as Choice Fatigue. That leaves the app's existing bounded on-demand requests as a prudent implementation choice, not a provider-approved limit. Confirm account-specific guidance before production use. [StashDB access guidance](https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/), [Stash guide to scraping](https://docs.stashapp.cc/beginner-guides/guide-to-scraping/)

## Checks before release

- Resolve the TMDB/Adult boundary in writing or separate the experiences.
- Make each operator assess whether their instance is commercial and secure the corresponding TMDB license if needed.
- Retain TMDB's required notice and use an approved, unmodified TMDB logo. The app's existing Credits page contains the notice and logo when TMDB is enabled; verify these remain visible in the shipped UI.
- Keep provider requests on demand and bounded, honor rate-limit responses, and avoid adding bulk/background harvesting without provider guidance.
- Review account-specific terms for ThePornDB and StashDB. Public docs reviewed here do not provide a request quota for Choice Fatigue's third-party use.

## Primary sources

- [TMDB API FAQ](https://developer.themoviedb.org/docs/faq)
- [TMDB rate limits](https://developer.themoviedb.org/docs/rate-limiting)
- [TMDB application authentication](https://developer.themoviedb.org/docs/authentication-application)
- [TMDB API Terms of Use](https://www.themoviedb.org/documentation/api/terms-of-use) (linked from the project provider review; the terms page was not readable by this review tool, so claims above about restriction and attribution rely on TMDB's accessible FAQ)
- [ThePornDB API documentation](https://api.theporndb.net/docs)
- [StashDB access guidance](https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/)
- [Stash guide to scraping](https://docs.stashapp.cc/beginner-guides/guide-to-scraping/)
