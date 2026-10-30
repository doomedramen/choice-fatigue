# Metadata provider review

**Reviewed:** 2026-10-30 against the current provider documentation

This is an implementation planning record, not a legal determination. Discovery uses administrator-enabled live provider feeds. Provider credentials are encrypted in PostgreSQL; the admin status endpoint reports only whether a credential is configured and whether its source is enabled. It never returns credentials or validates a provider key.

## TMDB

- TMDB publishes movie and TV APIs and accepts an API Read Access Token as a Bearer token.
- Its FAQ says the developer API is free for non-commercial use with attribution; a project whose primary purpose is revenue is commercial and needs a separate license. TMDB requires an approved logo and the API notice in an About or Credits area.
- Its legal notice prohibits using its data or images in connection with obscene or pornographic content. The FAQ does not define how this applies to a product that also includes a separate Adult section.
- Choice Fatigue fetches popular Movies and Shows from TMDB, including anime series in Shows and anime films in Movies, and excludes adult-flagged results. The Shows category uses TMDB's TV endpoints. Keep those records out of Adult. The categories are isolated in the app, but that does not establish that the provider permits both experiences in one instance.
- TMDB says it has no SLA, maintains changing upper request limits to prevent bulk scraping, and asks clients to respect HTTP 429. Discovery requests current feeds with `no-store` and does not persist feed results. Confirm the current terms and the Adult-content boundary with TMDB before recommending that operators enable TMDB and Adult together.

Sources: [TMDB FAQ and legal notice](https://developer.themoviedb.org/docs/faq), [application authentication](https://developer.themoviedb.org/docs/authentication-application), [rate limits](https://developer.themoviedb.org/docs/rate-limiting), [image basics](https://developer.themoviedb.org/docs/image-basics), [API Terms of Use](https://www.themoviedb.org/documentation/api/terms-of-use).

## ThePornDB and StashDB

The Stash documentation explicitly lists StashDB and ThePornDB as supported Stash-Box sources and explains how to connect either to a user's Stash installation. ThePornDB publishes API docs for scene, movie, performer, and related metadata. Choice Fatigue uses ThePornDB and StashDB for Adult-category feeds, with administrator-managed encrypted credentials and no source artwork.

The Stash guide describes pulling metadata into a local Stash library. It does not document Choice Fatigue's request-volume policy. Review current provider guidance and avoid bulk scraping; the integration makes bounded popularity-feed requests when discovery loads.

Sources: [Stash guide to scraping](https://docs.stashapp.cc/beginner-guides/guide-to-scraping/), [Stash-Box instances](https://docs.stashapp.cc/metadata-sources/stash-box-instances/), [ThePornDB API docs](https://api.theporndb.net/docs), [StashDB access guide](https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/), [StashDB guidelines](https://guidelines.stashdb.org/).
