# Choice Fatigue recommendation plan

**Status:** A session-scoped content ranker and automatic TMDB starter catalogue are implemented; persistent preference learning and more advanced diversity ranking remain planned
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
| Remove before review | The initial interest was withdrawn | Remove that title's positive contribution; do not count it as a pass |
| Remove during review | The title was promising, but lost out after seeing alternatives | Do not count it as a pass; relative comparison can be added when review events are retained |
| Keep through review | The title remained attractive after comparison | Potentially stronger than an initial shortlist; the current ranker does not yet distinguish the two |
| Restore during review | The user changed their mind and kept the title | Use the final review outcome; do not count the temporary removal as a negative |
| Save permanently | The user chose to keep the title for later | Positive evidence; later versions can distinguish this from a tentative shortlist |
| Undo | The previous action was accidental or reconsidered | Reverse that action so it does not train the profile |

In particular, a review removal must not be treated like a swipe left. When a review has both retained and removed titles, the retained titles provide a useful within-session comparison set. The algorithm can learn that one set was more compelling *for this user in this session* without turning the removed titles into dislikes.

## First algorithm: understandable and content-based

The first implementation is a deterministic, content-based ranker. It needs no recommendation API, model training, or cross-user data, and it can work with the catalogue and explicit actions already planned for the product. The initial signal weights are **shortlist = +1** and **pass = −0.5**: a pass lowers similar candidates, but less than a shortlist raises them.

### 1. Build an eligible candidate set

- Respect the selected category and its access rules.
- Exclude titles already seen in the current session, plus titles the user has permanently hidden or saved when that matches their settings.
- Do not let Adult choices affect Movies or TV profiles, or the reverse.
- Keep service availability (already in a library or already requested) as an eligibility or display signal, separate from taste.

### 2. Represent user and title interests

The current ranker uses source genres, release decade, and title type. Genre affinity uses the average of the +1 and −0.5 signals from current-session decisions. Decade and type use smaller weights (0.25 each); genre features use 1.0. The source rating adds a small quality prior, bounded from −0.05 to +0.05, so it helps order close candidates without overriding explicit choices. Category is a strict candidate boundary: the selected category is ranked on its own, and Adult choices cannot affect Movies or TV.

The main catalogue combines imported metadata-source entries with an automatic TMDB starter pool: two popularity-sorted discovery pages each for Movies and TV, with source genres, ratings, years, and poster paths. TMDB responses are cached for six hours and genre names for a day; discovered records are stored in PostgreSQL so session and saved-title IDs remain stable. Adult-flagged TMDB results are excluded. Local fixture rows are for development seeding and are not presented as discovery content. If no metadata source has available titles, the app shows its existing empty state.

This is a within-session first pass, not a lasting taste profile. Starting a fresh session clears the signals used by the ranker. Persisting preferences across sessions requires the per-account event history described below. Later versions can add well-supported features such as language, runtime, and carefully normalized themes or keywords, and can decay older evidence.

Keep a confidence value alongside each preference. A few passes should not make the profile certain that a user dislikes an entire genre. After an undo, restoration, or preference reset, rebuild the profile from the surviving event history rather than trying to patch a stale score.

### 3. Score for two outcomes

The longer-term design should track two distinct estimates:

1. **Initial interest:** likelihood that this title is worth shortlisting.
2. **Second-look retention:** likelihood it remains appealing after comparison and is ultimately saved.

The current ranker only estimates initial content fit from current-session swipes. It does not yet predict second-look retention. Once review outcomes are recorded as durable events, estimate that separately and give confirmed review and save actions more weight. Review keep/remove pairs from the same review can add relative evidence. Do not collapse both estimates into a single “like” score.

### 4. Reorder with variety and exploration

The session ranker currently sorts by content fit and uses source rating and catalogue popularity order as small priors. The next reranking step should mix preference-fit candidates with a broad, exploratory set and limit runs of very similar genres, years, franchises, or themes. **Starting experiment:** use exploration for about one in five shown titles, and compare that with lower and higher shares during the opt-in trial. This is a tuning hypothesis, not a product rule. Keep the share configurable rather than burying an arbitrary constant in code.

At today's catalogue size, rank the eligible catalogue directly. If it grows, add candidate retrieval first (for example, titles related to items the user kept or saved), then rerank that smaller set for expected interest, second-look retention, quality, diversity, and exploration. This staged approach is common in published recommender designs; it avoids making early complexity a prerequisite for a useful first release. [Meta's Instagram Explore write-up](https://engineering.fb.com/2023/08/09/ml-applications/scaling-instagram-explore-recommendations-system/) describes retrieval followed by ranking stages and using selected interaction-history items as similarity seeds.

TikTok's public explanation supports using both expressed positive and negative actions, while giving less weight to passive context. Instagram describes a retrieval-and-ranking pipeline with diversity-aware reranking. YouTube describes combining multiple signals to predict whether a recommendation will satisfy the viewer, rather than relying on clicks alone. These are design inspirations, not implementation details to copy: Choice Fatigue should use explicit choices, optimize for titles people still want after comparison, and avoid maximizing time spent. [TikTok's For You explanation](https://newsroom.tiktok.com/how-tiktok-recommends-videos-for-you?lang=en), [Instagram Explore ranking](https://engineering.fb.com/2023/08/09/ml-applications/scaling-instagram-explore-recommendations-system/), [YouTube's recommendation system](https://blog.youtube/inside-youtube/on-youtubes-recommendation-system/).

## Data needed before persistent personalization

The current discovery record is a mutable session snapshot. It is enough to resume the UI and reorder titles within that session, but it does not retain every review change after a save or keep a learned profile after a fresh session. Before persisting preferences across sessions, add a per-account event history that can distinguish:

- session and review identifiers;
- the item and category shown;
- the deliberate action and its order in the session;
- whether an action was undone or later restored;
- the algorithm version that ordered the item.

Keep the current saved/shortlist snapshot for fast UI restore. Treat the event history as the source for preference learning. Store only the fields needed to explain and reproduce those preferences, and make it possible to delete or reset that history for an account.

## Adult-section boundary

Keep the Adult profile, signals, candidates, and retrieval isolated from general categories. Never use Adult interactions to personalize Movies or TV. Do not introduce cross-user collaborative signals for Adult in the first versions. Preserve the existing age gate and provider boundaries at candidate generation, not only in the interface.

## Evaluation and rollout

1. **Instrument persistent history:** record the event types above and confirm that undo, restore, prune, and save are represented correctly before carrying preference signals across sessions.
2. **Replay offline:** evaluate recommendations using earlier sessions only to predict later actions. Do not let future choices leak into the profile used for a past recommendation.
3. **Run a small opt-in trial:** compare the ranker with a balanced, non-personalized catalogue order. Keep a control group and expose a way to reset or turn off personalization.
4. **Tune using several measures:** shortlist rate, share of shortlisted titles kept after review, permanent saves per session, title diversity, repeat rate, and a simple user satisfaction prompt. Check calibration too: if the system says an item is likely to survive review, that should happen at a similar rate over time.
5. **Add collaborative learning only when justified:** require enough diverse users and catalogue coverage, use privacy-preserving aggregates, and keep it opt-in. It should complement content features, not override a user's explicit preferences.

Do not optimize one action in isolation. A ranker that increases shortlists but also increases review pruning may be presenting more weak contenders rather than helping people decide.

## Later options, not launch requirements

- Add richer title themes or embeddings if catalogue licensing and quality support them.
- Add a model that learns from review comparisons after there are enough trustworthy events.
- Add privacy-preserving collaborative filtering only after scale, consent, and Adult-section boundaries are settled.
- Add user-facing controls for “show me more like this”, “less like this”, “why this title”, and clearing a category profile.

## Decisions to validate as ranking matures

- Whether saved titles should be excluded from future discovery by default.
- Whether an exploration share near 20% improves satisfaction and review retention compared with lower or higher shares.
- Which catalogue features are consistently available across providers.
- How long event history is retained and how preference reset behaves across categories.
- Whether cross-category personalization is ever allowed; the first version assumes it is not.
