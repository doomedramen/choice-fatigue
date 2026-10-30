# Metadata provider review

**Reviewed:** 2026-10-30

This is an implementation planning record, not a legal determination. None of the provider APIs are connected in Choice Fatigue. The admin status endpoint only reports whether a server environment variable is present; it never returns credentials or makes a provider request.

## TMDB

- TMDB publishes movie and TV APIs and accepts an API Read Access Token as a Bearer token.
- Its FAQ says the API is free for non-commercial use with attribution. Commercial projects need a separate license. TMDB requires its approved logo and a notice in an About or Credits area.
- Its legal notice prohibits using its data or images in connection with obscene or pornographic content. How this applies to the planned Adult section is not defined in the FAQ.
- Keep TMDB out of an instance with Adult enabled until TMDB provides written guidance or the experiences are hosted separately. Confirm current API terms, especially cache and retention rules, before retaining provider responses.

Sources: [TMDB FAQ](https://developer.themoviedb.org/docs/faq), [application authentication](https://developer.themoviedb.org/docs/authentication-application), [image basics](https://developer.themoviedb.org/docs/image-basics), [API Terms of Use](https://www.themoviedb.org/documentation/api/terms-of-use).

## ThePornDB and StashDB

The Stash documentation explicitly lists StashDB and ThePornDB as supported Stash-Box sources and explains how to connect either to a user's Stash installation. ThePornDB also publishes API docs for scene, movie, performer, and related metadata. Choice Fatigue will use ThePornDB and StashDB as Adult-category providers, with server-side credentials and no explicit artwork in the first integration.

The Stash guide describes pulling metadata into a local Stash library. It does not document Choice Fatigue's hosted deployment, request-volume, or cache policy, so those details remain a launch check. This does not block building the server adapters against the documented endpoints.

Sources: [Stash guide to scraping](https://docs.stashapp.cc/beginner-guides/guide-to-scraping/), [Stash-Box instances](https://docs.stashapp.cc/metadata-sources/stash-box-instances/), [ThePornDB API docs](https://api.theporndb.net/docs), [StashDB access guide](https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/), [StashDB guidelines](https://guidelines.stashdb.org/).
