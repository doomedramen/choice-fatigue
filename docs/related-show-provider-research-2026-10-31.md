# Provider-supplied related shows: research

**Reviewed:** 31 October 2026

**Scope:** TMDB TV relationship endpoints, corresponding movie APIs, Adult-provider capabilities, and implications for Choice Fatigue's current v3 pipeline. Verified provider facts and project-specific design judgments are separated below. The contract review used public documentation and StashDB schema introspection. The separate, bounded authenticated TMDB probe below used the already-enabled development credential; it did not use private account taste history or persist raw provider metadata.

## Verified provider contracts

### TMDB exposes two distinct TV relationship sources

| Source | Endpoint | What its official reference establishes |
| --- | --- | --- |
| Similar TV shows | `GET /3/tv/{series_id}/similar` | Returns similar TV shows; supports `language` and `page`. |
| TV recommendations | `GET /3/tv/{series_id}/recommendations` | A separate series-specific recommendations endpoint; supports `language` and `page`. |

Both default to `en-US` and page 1. Neither reviewed TV reference explains its ranking algorithm or establishes that one source is more accurate. The recommendations OpenAPI operation has an empty description. We cannot call it collaborative filtering, audience co-viewing, embedding similarity, or a guaranteed improvement based on these documents. These endpoints are anchored to one show, rather than the user's Choice Fatigue profile. [TV similar reference](https://developer.themoviedb.org/reference/tv-series-similar), [TV recommendations reference](https://developer.themoviedb.org/reference/tv-series-recommendations), [official OpenAPI](https://developer.themoviedb.org/openapi/tmdb-api.json).

**Correction to the earlier conversation:** the explicit statement that similarity uses genres and plot keywords belongs to the **movie** `/similar` documentation. The reviewed TV reference does not repeat that explanation; applying it to TV as a verified fact would overstate the evidence. Movie recommendations also have a separate endpoint. [Movie similar](https://developer.themoviedb.org/reference/movie-similar), [movie recommendations](https://developer.themoviedb.org/reference/movie-recommendations).

### Responses are usable candidates, not probability estimates

The TV operation schemas/examples contain `page`, `results`, `total_pages`, and `total_results`. Items include stable numeric IDs, names, dates, `genre_ids`, artwork paths, overviews, and `adult`; recommendation results also show `media_type`. Genres arrive as IDs; full plot keyword lists are not supplied in these result schemas. They expose ordinary popularity/vote statistics, not a documented pairwise relevance probability. Preserve the returned ordering, but do not interpret vote average or list position as a calibrated relationship score. Examples are not guarantees of minimum coverage, relevance, or fixed page size. [Official OpenAPI](https://developer.themoviedb.org/openapi/tmdb-api.json).

The documented TV query parameters are language and page; an `include_adult` filter is not documented for these routes. Our client must therefore enforce its own eligibility on returned items and retain the non-Adult category boundary. A schema property is not proof it will always be present: missing safety metadata should trigger bounded verification or exclusion, not an assumption of safety. [TV similar](https://developer.themoviedb.org/reference/tv-series-similar), [TV recommendations](https://developer.themoviedb.org/reference/tv-series-recommendations), [OpenAPI](https://developer.themoviedb.org/openapi/tmdb-api.json).

Application authentication can use the existing API Read Access Token as a Bearer credential. Adding item-to-item retrieval does not require creating a TMDB account for each Choice Fatigue user. TMDB's account-personalized v4 recommendations are a different capability and should not be confused with these series-specific v3 APIs. TMDB also documents appending supported same-namespace subrequests to detail responses; that is a possible first-page optimization, not evidence that all pages or failure modes are independent. [Application authentication](https://developer.themoviedb.org/docs/authentication-application), [v4 account TV recommendations](https://developer.themoviedb.org/v4/reference/account-tv-recommendations), [append-to-response](https://developer.themoviedb.org/docs/append-to-response).

Request-volume defaults are not an entitlement: TMDB asks clients to respect 429 and says its upper limits can change. Keep the existing process concurrency, timeout, and cooldown controls. [Rate limits](https://developer.themoviedb.org/docs/rate-limiting).

### Adult providers do not establish the same capability

StashDB's public deployed GraphQL schema was introspected on the review date for `Query`, `Scene`, and `SceneQueryInput`. No native related/similar/recommendations scene field appeared. Its scene query supports tags, studios, performers, and other filters; the upstream schema corroborates these fields. This establishes a content-filtering building block, not a provider-supplied item-to-item ranking model. The live instance and upstream master differ in some unrelated fields, so the deployed schema remains the compatibility authority. [Deployed schema endpoint](https://stashdb.org/graphql), [upstream Query schema](https://github.com/stashapp/stash-box/blob/master/graphql/schema/schema.graphql), [scene/filter schema](https://github.com/stashapp/stash-box/blob/master/graphql/schema/types/scene.graphql).

ThePornDB's public documentation returned HTTP 403; attempted public OpenAPI paths were also unreadable. Search did not establish an official related-items contract. Its capability is **unverified**, rather than proven absent. Do not add guessed endpoint names or extrapolate StashDB's deployed schema to ThePornDB. Keep its current paginated feeds until an accessible first-party contract or authenticated schema check is available. [ThePornDB docs](https://api.theporndb.net/docs).

## Implications for this codebase — design judgments

These are implementation recommendations inferred from our product semantics and code, not provider promises:

- **Add item-to-item retrieval as a separate candidate source.** Current TMDB retrieval calls `/discover/tv` with popularity and optional broad genre filters. A specific show can seed a related list after one credible positive action; the existing three-distinct-titles threshold for inferring a genre preference need not block that lookup.
- **Keep seed meanings distinct.** A high seen-title rating indicates enjoyed content. Saving an unwatched show indicates strong future interest, not demonstrated satisfaction. Both can seed discovery, but should have distinguishable provenance/confidence. An initial shortlist is weaker; passive exposure, neutral ratings, passes, and undone choices should not become positive seeds. Resolve conflicting later feedback before selecting seeds.
- **Avoid dependence on one favourite.** Start with a small bounded selection of seeds, retain which seed produced each result, and prevent one long provider list from consuming the whole deck. Empty or exhausted related lists must fall back to existing discovery.
- **Do not erase the new relationship information during reranking.** `rankRecommendations` currently sorts by coarse genre/decade/type fit and only preserves original order on score ties. Fetching richer related candidates and then sorting solely by those same coarse features can bury the provider's strongest associations. Evaluate an order-aware fusion or bounded provider-rank prior alongside local fit. Provider relevance and provider vote average are different concepts.
- **Record enough ID-only provenance.** Current `FeedStream`, `CandidateBatch`, and event lane types only distinguish popular/personalized. Related retrieval needs source mode, seed provider ID, original result order, and a policy version, preserved through cursors, deduplication, and traces. A candidate returned by multiple seeds or sources should retain those origins without multiplying its taste evidence. Do not overload undo/correction links with seed provenance.
- **Keep request and eligibility rules intact.** Advance each seed/source page independently; freeze seed selection through pagination and refresh at a deliberate boundary. Apply the existing considered/saved exclusions, stable IDs, provider/category isolation, no-store behavior, and independent failure handling. Show detail resolution is not a requirement for every result when a valid response already carries needed fields.
- **Evaluate retrieval and ordering separately.** Existing v3 traces cannot tell us how users would have reacted to related candidates never shown. First compare endpoint coverage, novel eligible yield, overlap, and source ranks on the same seeds. Then collect new provenance-aware traces and assess shortlist retention, final saves, and choice burden. A single-account development trial can guide product judgment; it is not evidence of a population-wide causal improvement.

Relevant implementation seams: [retrieval orchestration](../src/lib/catalogue.ts), [stream/candidate contracts](../src/lib/discovery-feed.ts), [event contract](../src/lib/recommendation-event-validation.ts), [local ranker](../src/lib/recommendations.ts), and [chronological evaluation](../src/lib/recommendation-evaluation.ts).

## Recommendation from the contract review

TMDB is ready for a bounded related-show candidate experiment. Compare `/recommendations` and `/similar` empirically instead of choosing a winner from their names or attributing an undocumented algorithm. Preserve the relationships through ranking and logging; otherwise we may pay for richer retrieval while discarding its useful ordering. Keep broad discovery as an additional source, and leave Adult-provider native related retrieval unresolved until its actual contract is established.


## Bounded live TMDB probe

**Method:** two deliberately selected public TV seeds, `tmdb-tv-70523` and `tmdb-tv-95396`; 15 authenticated GET requests total on the review date. The first eleven requests read one popular-TV page, each seed's details, each seed's first similar/recommendations page, and the first two popularity-sorted discover pages matching an OR of that seed's genres. Four additional relationship-page reads compared cross-seed overlap and allowed transient qualitative inspection. Requests used the existing no-store, timeout, concurrency, and cooldown helper. No account preference history, raw responses, descriptions, artwork, or candidate metadata were written to disk. Only aggregate observations and stable seed IDs are retained here.

| Seed TV ID | Similar first-page count | Recommendations first-page count | Similar/recommendations top-20 intersection | Similar candidates outside genre top 40 | Recommendation candidates outside genre top 40 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 70523 | 20 | 20 | 0 | 20 | 20 |
| 95396 | 20 | 20 | 0 | 20 | 20 |

All four native top-20 lists were also entirely outside the sampled popular-TV top 20. Across the two seeds, the similar lists overlapped on two IDs and the recommendation lists also overlapped on two IDs. The two endpoint families therefore exposed different candidates in this sample, including candidates outside the shallow genre-popularity pool. This is **retrieval coverage evidence**, not a relevance, satisfaction, or causal-lift measurement. It does not establish that all 80 positions represent distinct candidates across all lists.

All 20 results in each sampled list carried `genre_ids` and explicit `adult=false`. No sampled result exposed a relationship-specific `score`, `relevance`, or `similarity` value; the recommendation results also included ordinary media type/popularity/vote fields. These observations are not guarantees for other responses. Similar feeds reported 1,001 total pages for both seeds, versus 44 and 28 for the corresponding recommendation feeds. Those large reported counts are a reason to cap retrieval, not an instruction to exhaust either catalogue.

Reproduce with the same paths and parameters: `/3/tv/{id}`, `/3/tv/{id}/similar?language=en-US&page=1`, `/3/tv/{id}/recommendations?language=en-US&page=1`, and `/3/discover/tv?include_adult=false&include_null_first_air_dates=false&language=en-US&sort_by=popularity.desc&page={1|2}&with_genres={OR-separated-seed-genre-IDs}`. The baseline popular page omits `with_genres`. Current provider data can change, so historical counts may not reproduce exactly. Endpoint contracts: [TV similar](https://developer.themoviedb.org/reference/tv-series-similar), [TV recommendations](https://developer.themoviedb.org/reference/tv-series-recommendations), [TV discover](https://developer.themoviedb.org/reference/discover-tv).

## Deeper design recommendation

### Retrieve by a show the person chose, then retain that relationship through ordering

The evidence supports adding item-seeded candidates before building a more complicated model. Candidate retrieval and final ranking are distinct stages: Google's recommendation-system paper describes a separate generator and ranker, although its scale, neural models, and engagement objective are not a prescription for this private app. The transferable point is that a ranker cannot promote an item retrieval never supplied. [Covington, Adams and Sargin, 2016](https://research.google/pubs/deep-neural-networks-for-youtube-recommendations/).

The opposite failure also matters here: retrieving an item because it is highly placed for a specific show, then discarding that relationship and ordering it using genres alone. Our current ranker has no seed identity or native rank input. A source-aware change must cover both retrieval and final ordering.

I would start with TV `/recommendations` as the first implementation candidate, keep `/similar` independently measurable, and preserve the existing broad discovery source. This is a practical development choice informed by the small live inspection and explicit endpoint purpose, **not proof that recommendations is superior**. Do not routinely fetch both endpoint families for every historical show; compare them on selected seeds first and add only the useful request cost.

### Choose seeds from the action's meaning

- A corrected 4–5-star seen rating supplies direct positive enjoyment evidence. A saved, potentially unwatched show supplies intended future interest. Keep those seed reasons distinct; do not reuse the saved-retention coefficient as an assumed seed-confidence probability.
- One credible positive seed is sufficient to request its related items. The three-title threshold still makes sense as a separate guard for learning broad genre preferences, but it should not block item-seeded retrieval.
- Start with at most two distinct seeds, drawing from enjoyed content and recent retained interest when both exist. This request cap is an engineering default to validate. Rotate seeds across completed reviews to avoid repeatedly expanding one favourite or franchise.
- Reconstruct corrections first. Undone choices and explicitly poor seen ratings should not remain positive seeds. Review removal is relative feedback and should not blacklist every show related to the removed item. Never expand passes into a blanket negative similarity graph.
- The current app has no search/import flow for choosing an arbitrary favourite. Enjoyment seeds only exist when a show has appeared and been rated. Saved-interest seeds make this useful within today's flow; an explicit favourite-picker or “more like this” action is a later way to provide more direct intent.

### Preserve rank and multiple origins without multiplying taste evidence

Treat each seed/endpoint response as an ordered candidate list, not a set or a probability vector. Compare three orderings on the same expanded candidate set: untouched provider order, today's content-only ranking, and a source-aware rank fusion. A weighted reciprocal-rank approach is a reasonable simple experiment because it combines rank positions without requiring comparable score scales. The original RRF paper evaluates information retrieval; its constants and gains are not validated for this app. [Cormack, Clarke and Büttcher, 2009](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf).

For a fused model, keep the total influence of one seed bounded, and avoid treating its `/similar` and `/recommendations` responses as independent votes. Keep provider relationship rank separate from popularity and vote averages. Use local preference fit as additional evidence, while measuring whether it improves on the provider list rather than automatically letting it dominate. Keep existing exclusions authoritative. Duplicate retrieval from several seeds may strengthen retrieval confidence, but must not create several copies of the user's original decision.

Cursors and ID-only trace batches need the seed provider ID, seed action/event ID, endpoint mode, page/order context, and policy version. Preserve every origin when deduplicating candidate IDs. Save these identifiers and ordered IDs, not provider response bodies or relationship graphs. The current lane enum and four-stream cursor contract need deliberate extension; just adding another adapter call is insufficient. Keep at most one page per active seed in a refill, preserve the current four-request limit and independent failure behavior, and refresh seeds at a review boundary without moving the locked card. Empty native lists fall back to existing discovery.

### Make the decision with a development comparison

1. Compare a deliberately varied small seed set: different genres, newer/older shows, and both mainstream and less-popular examples. Record eligible novel yield, overlaps, response failures, and whether different seeds actually yield meaningfully different decks. The two-seed probe above only establishes feasibility.
2. Review the first candidates from each endpoint and the current baseline with source labels hidden, recording whether they look worth shortlisting. This is a useful single-developer product judgment, not a representative user study.
3. Exercise the normal shortlist/review/save flow with provenance-aware traces. Compare final saves, review retention, variety, and observed cards before a useful save; do not optimize initial shortlists alone.
4. Replay new traces using only seed evidence available before retrieval. Old v3 logs cannot supply outcomes for related candidates never shown, and current source lookups do not reproduce historical relationships exactly. Record original returned IDs and ordering at retrieval time so provider changes do not force replay to invent old lists.

No rollout framework or additional external account integration is needed for this development-only comparison. Outcome-driven tuning can follow once the added candidates have actually been used.
