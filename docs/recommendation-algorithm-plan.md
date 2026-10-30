# Choice Fatigue recommendation plan

**Status:** The first research-informed content baseline supports confidence shrinkage, transient historical feature lookup, saved-title retention, and same-review comparisons. It remains unvalidated; timestamps, offline evaluation, diversity, and measurement are still open. See the [primary-source research and code audit](recommendation-algorithm-research.md).
**Date:** 30 October 2026

## Product goal

Help someone find media they still want after comparing alternatives. The system should make a discovery session feel useful and varied, then learn from the user's considered choices. It should not try to maximize swipes, screen time, or the number of titles opened.

The review step is central to this goal. A title can feel promising when it first appears and become less compelling after the user has seen stronger options. That change is useful **relative feedback**, not proof that the title is bad or that the person dislikes its genre.

## What each action means

Keep the kinds of feedback separate. The first version should use only deliberate actions; opening details or spending time on a card should not count as a like.

| User action | Initial interpretation | How to use it |
| --- | --- | --- |
| Pass | Explicit negative signal, but weaker than a positive choice | Start at **−0.5**; reduce the weight of matching genres |
| Shortlist during discovery | Explicit positive choice | Start at **+1**; raise the weight of matching genres |
| Seen it + star rating | A watched title with a direct quality/preference judgment | Map 1–5 stars to **−0.5, −0.25, 0, +0.5, +1**; use the score as evidence for matching genres, decade, and type |
| Remove before review | The initial interest was withdrawn | Preserve the original consideration signal; do not count it as a pass |
| Remove during review | The title was promising, but lost out after seeing alternatives | Preserve the initial signal; compare only with a title saved from the same review |
| Keep through review | The title remained attractive after comparison | A saved title adds stronger positive retention evidence |
| Restore during review | The user changed their mind and kept the title | Use the final review outcome; do not count the temporary removal as a negative |
| Save permanently | The user chose to keep the title for later | Stronger positive retention evidence |
| Undo | The previous action was accidental or reconsidered | Reverse that action so it does not train the profile |

In particular, a review removal must not be treated like a swipe left. When a review has both saved and removed titles, the saved titles provide a useful within-session comparison set. The algorithm learns a small relative similarity signal from those pairs without turning removal into an independent negative swipe.

## First algorithm: understandable and content-based

The current implementation is a deterministic content heuristic. It uses **shortlist = +1**, **pass = −0.5**, and a 1–5 star review of a seen title mapped to **−0.5, −0.25, 0, +0.5, +1**. Those numbers are initial hand-set values, not results of an experiment. A seen title leaves the active deck after rating; its rating contributes preference evidence for similar titles. A three-star rating is neutral. The current code has not established that this mapping helps people choose.

### 1. Build an eligible candidate set

- Respect the selected category and its access rules.
- Exclude titles already seen in the current session, plus titles the user has permanently hidden or saved when that matches their settings.
- Do not let Adult choices affect Movies or Shows profiles, or the reverse.
- Keep service availability (already in a library or already requested) as an eligibility or display signal, separate from taste.

### 2. Represent user and title interests

The current ranker uses source genres, release decade, and title type. It shrinks sparse evidence toward neutral; decade and type use smaller hand-set weights (0.25 each), and genre features use 1.0. Provider ratings do not affect preference scores because they are not comparable across sources. These weights and the review comparison coefficient are still unvalidated. Category is a strict candidate boundary: the selected category is ranked on its own, and Adult choices cannot affect Movies or Shows.

Discovery requests provider-ranked feeds directly when the page opens; no background sync or manual catalogue preloading is required. TMDB supplies two popularity-sorted pages each for Movies and Shows, and enabled Adult providers supply their current Adult feeds. Responses use `no-store` and are not copied into PostgreSQL. Stable provider IDs keep account swipe history attached to titles across requests; IDs are the only media data retained in discovery state and recommendation events. Adult-flagged TMDB results are excluded, and Adult feeds are only requested for accounts with access. Local fixture rows remain development-only.

Historical profile reads now resolve features for a bounded set of prior provider IDs that are absent from the current feed. Those lookups are direct, transient, and uncached; only the resulting compact feature keys live in the response and client memory. The profile API still omits event timestamps, so recency weighting cannot be computed.

The baseline represents confidence as well as preference. A few passes are shrunk toward neutral. Profiles are rebuilt from event history after corrections, while current-session decisions are applied separately from durable cross-session taste.

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

Feed-load and shown-item events also retain ordered provider item IDs for chronological replay. They do not retain titles or provider metadata. `content-v2` records these candidate snapshots while the API continues accepting queued `content-v1` events.

Keep the current saved/shortlist snapshot for fast UI restore. Treat the event history as the source for preference learning. Store only the fields needed to explain and reproduce those preferences. The account page can clear this history without deleting the active session snapshot.

Profile reads are category-scoped; durable swipe signals exclude the active session so current decisions are not counted twice. Saved-title signals and same-review comparisons are separate evidence and can affect the active session after a save. Explicit undo retracts the targeted initial decision; shortlist withdrawal and review removal preserve the original consideration signal. Saved and removed titles in the same review contribute a bounded pairwise similarity comparison. Adult choices never influence Movies or Shows. Media metadata must be resolved from provider IDs on demand and remain transient; do not add title, genre, rating, synopsis, artwork, or provider-response snapshots to persistent history.

## Adult-section boundary

Keep the Adult profile, signals, candidates, and retrieval isolated from general categories. Never use Adult interactions to personalize Movies or Shows. Do not introduce cross-user collaborative signals for Adult in the first versions. Preserve the existing age gate and provider boundaries at candidate generation, not only in the interface.

## Evaluation and rollout

1. **Implemented baseline:** corrected swipe semantics, bounded transient provider-ID feature lookup, confidence shrinkage, saved-title retention, and same-review comparisons.
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
