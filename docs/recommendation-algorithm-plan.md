# Choice Fatigue recommendation plan

**Status:** `content-v3` implements a single corrected event history, reliable per-event delivery, profile-aware candidate retrieval, paginated Adult feeds, and chronological impression replay. Ranking weights and retrieval thresholds remain engineering defaults, not validated improvements in user outcomes.
**Updated:** 31 October 2026

## Product goal

Help someone find media they still want after comparing alternatives. The system should make a discovery session feel useful and varied, then learn from the user's considered choices. It should not try to maximize swipes, screen time, or the number of titles opened.

The review step is central to this goal. A title can feel promising when it first appears and become less compelling after the user has seen stronger options. That change is useful **relative feedback**, not proof that the title is bad or that the person dislikes its genre.

## What each action means

Keep the kinds of feedback separate. The first version should use only deliberate actions; opening details or spending time on a card should not count as a like.

| User action | Initial interpretation | How to use it |
| --- | --- | --- |
| Pass | Explicit negative signal, but weaker than a positive choice | Start at **−0.5**; reduce the weight of matching genres |
| Shortlist during discovery | Explicit positive choice | Start at **+1**; raise the weight of matching genres |
| Seen it + rating | A watched title with a direct quality/preference judgment | Map scores 2, 4, 6, 8, and 10 to **−0.5, −0.25, 0, +0.5, +1**, interpolating between them; use the score as evidence for matching genres, decade, and type |
| Remove before review | The initial interest was withdrawn | Preserve the original consideration signal; do not count it as a pass |
| Remove during review | The title was promising, but lost out after seeing alternatives | Preserve the initial signal; compare only with a title saved from the same review |
| Keep through review | The title remained attractive after comparison | A saved title adds stronger positive retention evidence |
| Restore during review | The user changed their mind and kept the title | Use the final review outcome; do not count the temporary removal as a negative |
| Save permanently | The user chose to keep the title for later | Stronger positive retention evidence |
| Undo | The previous action was accidental or reconsidered | Reverse that action so it does not train the profile |

In particular, a review removal must not be treated like a swipe left. When a review has both saved and removed titles, the saved titles provide a useful within-session comparison set. The algorithm learns a small relative similarity signal from those pairs without turning removal into an independent negative swipe.

## First algorithm: understandable and content-based

The current implementation is a deterministic content heuristic. It uses **shortlist = +1**, **pass = −0.5**, and a 1–10 review of a seen title, interpolated between the previous five-point weights. Those numbers are initial hand-set values, not results of an experiment. A seen title leaves the active deck after rating; its rating contributes preference evidence for similar titles. A score of 6 is neutral, preserving the meaning of an earlier three-star rating. Existing five-point event ratings are interpreted at twice their original value. The current code has not established that this mapping helps people choose.

### 1. Build an eligible candidate set

- Respect the selected category and its access rules.
- Exclude previously considered or saved provider IDs across the account history, plus current deck decisions. Undo retracts consideration and makes a title eligible again.
- Do not let Adult choices affect Movies or Shows profiles, or the reverse.
- Keep service availability (already in a library or already requested) as an eligibility or display signal, separate from taste.

### 2. Represent user and title interests

The current ranker uses source genres, release decade, and title type. It shrinks sparse evidence toward neutral; decade and type use smaller hand-set weights (0.25 each), and genre features use 1.0. Provider ratings do not affect preference scores because they are not comparable across sources. These weights and the review comparison coefficient are still unvalidated. Category is a strict candidate boundary: the selected category is ranked on its own, and Adult choices cannot affect Movies or Shows.

Discovery uses the same category-and-cursor retrieval path for initial loading and pagination. Each enabled source supplies one page per lane on each refill. Cold start uses only provider popularity order; once a genre/tag has positive evidence from at least three distinct titles, up to two such features can seed an additional personalized lane. This threshold and the deterministic lane interleaving are unvalidated defaults. Passes never become hard genre exclusions.

TMDB supplies popular Movies and Shows plus an OR-filtered genre lane. Genre names map to the provider's current genre IDs. StashDB supplies popular scenes plus an OR-filtered tag lane using that provider's own transient tag IDs. ThePornDB scene and movie feeds paginate independently and are ranked locally; no undocumented tag-filter parameters are sent. Sources interleave deterministically before local scoring, with stable-ID and conservative title/year deduplication. Lane queries stay fixed through pagination and refresh after a saved review; popular pagination is retained. The continuation cursor preserves completed lanes and `hasMore` distinguishes whether further pages remain.

Responses use `no-store` and are not copied into PostgreSQL. Stable provider IDs attach account history to titles across requests. Adult-flagged TMDB results are excluded; Adult feeds and hydration require both instance enablement and the account grant. Local fixtures are test/development-only.

Historical profile reads prioritize the most recently acted-on distinct titles, including saves and review comparison participants. Up to twelve missing IDs are hydrated per category read. All provider requests share a four-request process concurrency limit and eight-second request timeouts. Failed lanes preserve their page; successful lanes remain usable. HTTP 429 establishes a provider cooldown from `Retry-After`, with a thirty-second fallback. There is no background metadata polling. Compact feature keys and source tag mappings remain transient; response coverage distinguishes unresolved or budget-omitted evidence from neutral taste.

### Historical replay

Run `pnpm eval:replay -- account-export.json` on a user-authorized account export while the app's `DATABASE_URL` and `INTEGRATION_CREDENTIALS_KEY` are available in `.env`. The evaluator reads only provider IDs, categories, timestamps, decisions, and ordered candidate-ID traces from the export. It resolves current source features transiently from enabled providers, with at most 500 lookups and four concurrent requests, and never writes title metadata to disk or the database. Adult metadata is resolved only when both the exported account grant and instance Adult switch are enabled.

Replay accepts `content-v3` and `content-v4` events. At each shown-item event it reconstructs the preceding event history and fetched candidate batches, applies the same correction reducer and twelve-ID historical feature budget, and compares rankings on matched candidate sets. It includes later pagination and within-run learning rather than evaluating only the first deck. The report distinguishes the mixed candidate pool from its popularity-only subset; personalized retrieval yield is descriptive and cannot estimate causal improvements from unobserved alternative titles.

Reports include shortlist/save mean reciprocal rank and recall at 5/10, review retention, observed cards before the first save, per-category metadata coverage, historical lookup-budget coverage, and per-source/lane unique candidate and outcome counts. Low or unresolved metadata coverage excludes predictions and must be considered when reading metrics. Provider metadata is current, browser clocks are approximate, and historical choices reflect the displayed policy. These comparisons are observational, not causal. Do not tune weights from low-coverage traces or pool accounts without appropriate consent.

The baseline represents confidence as well as preference. A few passes are shrunk toward neutral. The same corrected event reducer serves discovery, the account profile, and replay; pending client events merge with persisted events by ID and never count twice.

### 3. Score for two outcomes

The design should track two distinct outcomes:

1. **Initial interest:** likelihood that this title is worth shortlisting.
2. **Second-look retention:** likelihood it remains appealing after comparison and is ultimately saved.

The current ranker estimates a rough initial content fit, not calibrated interest. Saved titles add a stronger retention signal; within one review, retained titles can provide pairwise evidence against removed titles. Do not collapse both outcomes into a single “like” score.

### 4. Reorder with variety and exploration

Cold start should preserve the provider's current popularity order. Once a profile exists, estimate user fit first, then consider a modest diversity reranker to avoid runs of near-duplicate titles. There is no evidence for a fixed exploration percentage here; measure any exploration policy as a variant and do not adopt one until the product outcome and evaluation method are defined. The research review explains the evidence and limits of diversity reranking and contextual bandits.

For the evidence, applicability limits, and primary sources behind the proposed stages, see [recommendation algorithm research](recommendation-algorithm-research.md).

## Persistent personalization data

The discovery record remains a mutable session snapshot for UI restore. A separate append-only per-account event history retains action corrections and review outcomes. It distinguishes:

- session and review identifiers;
- the item and category shown;
- the deliberate action and its order in the session;
- whether an action was undone or later restored;
- the algorithm version that ordered the item.

`content-v4` records ten-point ratings; older `content-v3` ratings remain on a five-point scale. Both record occurrence timestamps separately from receipt timestamps. `candidate_batch` events record provider, popular/personalized lane, retrieval-group ID, and up to 100 ordered provider IDs per fetched batch. `item_shown` records the actual locked card first and up to 99 remaining candidates. No event contains titles or provider metadata. Each browser run has a fresh event session ID independent of the restored UI snapshot; there is no active-session exclusion.

`POST /api/recommendation-events` acknowledges valid events individually and identifies rejected events by ID/index/code. The client bounds batches by encoded bytes, splits oversized requests, retries transient failures, and quarantines permanently rejected events with a visible error so they cannot block later choices. The outbox uses `choice-fatigue-learning-v3-<userId>`; quarantine uses `choice-fatigue-learning-quarantine-<userId>`.

The development migration `20261031050000_recommendations_v3` replaces old learning traces and mutable discovery decisions, preserves saved provider IDs, and seeds saved retention events. No legacy event contract is accepted. It is intentionally a breaking development migration, not a production-history conversion.

Keep the current saved/shortlist snapshot for fast UI restore. Treat the event history as the source for preference learning. Store only the fields needed to explain and reproduce those preferences. The account page can clear this history without deleting saved titles or the active UI snapshot. Those retained IDs no longer train taste until new deliberate actions provide evidence.

Profile reads return category-scoped events, transient features by item ID, and coverage. All preference evidence comes from events; UI decisions only restore/filter the deck. Saved-title signals and same-review comparisons are separate evidence and can affect the active session after a save. Explicit undo retracts the targeted initial decision; shortlist withdrawal and review removal preserve the original consideration signal. Saved and removed titles in the same review contribute a bounded pairwise similarity comparison. Adult choices never influence Movies or Shows. Media metadata must be resolved from provider IDs on demand and remain transient; do not add title, genre, rating, synopsis, artwork, or provider-response snapshots to persistent history.

## Adult-section boundary

Keep the Adult profile, signals, candidates, and retrieval isolated from general categories. Never use Adult interactions to personalize Movies or Shows. Do not introduce cross-user collaborative signals for Adult in the first versions. Preserve the existing age gate and provider boundaries at candidate generation, not only in the interface.

## Evaluation and rollout

1. **Implemented baseline:** one corrected history, bounded provider hydration, confidence shrinkage, saved retention, same-review comparisons, profile-aware retrieval, and independent source pagination/failures.
2. **Establish baselines:** candidate and shown-order IDs are now logged. Compare provider popularity order, the current heuristic, and confidence-aware variants using chronological replay. Avoid future leakage and re-resolve features only as current-source approximations.
3. **Measure the choice funnel:** shortlist rate, review retention, saves, cards before first shortlist/final save, variety, and a lightweight satisfaction response. Check calibration only when there are enough examples.
4. **Run an opt-in randomized comparison** after logs capture policy assignment, shown positions, and selection probabilities; retain a reset/disable control.
5. **Add collaborative learning only when justified:** require enough diverse users and catalogue coverage, use privacy-preserving aggregates, and keep it opt-in. It should complement content features, not override a user's explicit preferences.

Do not optimize one action in isolation. A ranker that increases shortlists but also increases review pruning may be presenting more weak contenders rather than helping people decide.

## Later options, not launch requirements

- Add richer title themes or embeddings if catalogue licensing and quality support them.
- Replace the initial similarity-based review comparison with a learned pairwise model only after there are enough trustworthy events to evaluate it.
- Add privacy-preserving collaborative filtering only after scale, consent, and Adult-section boundaries are settled.
- Add user-facing controls for “show me more like this”, “less like this”, “why this title”, and clearing a category profile.

## Decisions to validate as ranking matures

- Whether saved titles should be excluded from future discovery by default.
- Whether a measured exploration policy improves satisfaction and review retention for this task.
- Which catalogue features are consistently available across providers.
- How long event history is retained and how preference reset behaves across categories.
- Whether cross-category personalization is ever allowed; the first version assumes it is not.
