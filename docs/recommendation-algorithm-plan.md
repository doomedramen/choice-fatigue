# Choice Fatigue recommendation plan

**Status:** Proposed; no recommendation algorithm is implemented yet  
**Date:** 30 October 2026

## Product goal

Help someone find media they still want after comparing alternatives. The system should make a discovery session feel useful and varied, then learn from the user's considered choices. It should not try to maximize swipes, screen time, or the number of titles opened.

The review step is central to this goal. A title can feel promising when it first appears and become less compelling after the user has seen stronger options. That change is useful **relative feedback**, not proof that the title is bad or that the person dislikes its genre.

## What each action means

Keep the kinds of feedback separate. The first version should use only deliberate actions; opening details or spending time on a card should not count as a like.

| User action | Initial interpretation | How to use it |
| --- | --- | --- |
| Pass | Mild negative signal; a quick choice can be noisy | Reduce similar candidates modestly, with low confidence |
| Shortlist during discovery | Tentative positive signal | Increase the weight of the item's features a little |
| Remove before review | The initial interest was withdrawn | Keep distinct from a pass; treat as weak or uncertain evidence |
| Remove during review | The title was promising, but lost out after seeing alternatives | Keep it as a weak positive and compare it against titles retained in the same review |
| Keep through review | The title remained attractive after comparison | Stronger positive signal than the initial shortlist action |
| Restore during review | The user changed their mind and kept the title | Use the final review outcome; do not count the temporary removal as a negative |
| Save permanently | The user chose to keep the title for later | Strongest individual positive signal in the first version |
| Undo | The previous action was accidental or reconsidered | Reverse that action so it does not train the profile |

In particular, a review removal must not be treated like a swipe left. When a review has both retained and removed titles, the retained titles provide a useful within-session comparison set. The algorithm can learn that one set was more compelling *for this user in this session* without turning the removed titles into dislikes.

## First algorithm: understandable and content-based

Start with a deterministic content-based ranker. It needs no recommendation API, model training, or cross-user data, and it can work with the catalogue and explicit actions already planned for the product.

### 1. Build an eligible candidate set

- Respect the selected category and its access rules.
- Exclude titles already seen in the current session, plus titles the user has permanently hidden or saved when that matches their settings.
- Do not let Adult choices affect Movies, TV, or Anime profiles, or the reverse.
- Keep service availability (already in a library or already requested) as an eligibility or display signal, separate from taste.

### 2. Represent user and title interests

Use known catalogue features such as genre, release era, language, runtime, and carefully normalized themes or keywords. Build a separate, small profile for each category. Update it from the event meanings above, with stronger actions contributing more and older evidence gradually contributing less.

Keep a confidence value alongside each preference. A few passes should not make the profile certain that a user dislikes an entire genre. After an undo, restoration, or preference reset, rebuild the profile from the surviving event history rather than trying to patch a stale score.

### 3. Score for two outcomes

Track two distinct estimates:

1. **Initial interest:** likelihood that this title is worth shortlisting.
2. **Second-look retention:** likelihood it remains appealing after comparison and is ultimately saved.

The first release can calculate both with simple weighted feature scores. It should give more weight to confirmed review and save actions for second-look retention. Review keep/remove pairs from the same review can add relative evidence. Do not collapse both estimates into a single “like” score.

### 4. Reorder with variety and exploration

Mix preference-fit candidates with a broad, exploratory set. Limit runs of very similar genres, years, franchises, or themes so the user can discover adjacent interests instead of seeing a narrow loop. **Starting experiment:** use exploration for about one in five shown titles, and compare that with lower and higher shares during the opt-in trial. This is a tuning hypothesis, not a product rule. Keep the share configurable rather than burying an arbitrary constant in code.

At today's catalogue size, rank the eligible catalogue directly. If it grows, add candidate retrieval first (for example, titles related to items the user kept or saved), then rerank that smaller set for expected interest, second-look retention, quality, diversity, and exploration. This staged approach is common in published recommender designs; it avoids making early complexity a prerequisite for a useful first release. [Meta's Instagram Explore write-up](https://engineering.fb.com/2023/08/09/ml-applications/scaling-instagram-explore-recommendations-system/) describes retrieval followed by ranking stages and using selected interaction-history items as similarity seeds.

TikTok's public explanation also supports distinguishing stronger expressed preferences from weaker context signals, and using both positive and negative actions. For Choice Fatigue, explicit decisions should remain the main source of personalization; device or account context should not be used to guess taste. [TikTok's For You explanation](https://newsroom.tiktok.com/how-tiktok-recommends-videos-for-you?lang=en) describes that relative weighting principle.

## Data needed before personalization

The current discovery record is a mutable session snapshot. It is enough to resume the UI, but it does not retain every review change after a save. Before learning preferences, add a per-account event history that can distinguish:

- session and review identifiers;
- the item and category shown;
- the deliberate action and its order in the session;
- whether an action was undone or later restored;
- the algorithm version that selected the item, once ranking is enabled.

Keep the current saved/shortlist snapshot for fast UI restore. Treat the event history as the source for preference learning. Store only the fields needed to explain and reproduce those preferences, and make it possible to delete or reset that history for an account.

## Adult-section boundary

Keep the Adult profile, signals, candidates, and retrieval isolated from general categories. Never use Adult interactions to personalize Movies, TV, or Anime. Do not introduce cross-user collaborative signals for Adult in the first versions. Preserve the existing age gate and provider boundaries at candidate generation, not only in the interface.

## Evaluation and rollout

1. **Instrument first:** record the event types above while keeping the current catalogue order. Confirm that undo, restore, prune, and save are represented correctly.
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

## Decisions to validate before implementation

- Whether saved titles should be excluded from future discovery by default.
- Whether an exploration share near 20% improves satisfaction and review retention compared with lower or higher shares.
- Which catalogue features are consistently available across providers.
- How long event history is retained and how preference reset behaves across categories.
- Whether cross-category personalization is ever allowed; the first version assumes it is not.
