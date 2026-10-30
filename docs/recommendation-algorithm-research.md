# Recommendation algorithm research for Choice Fatigue

**Status:** Research findings and implementation direction; not a claim that the current ranker is validated.
**Date:** 30 October 2026

## Product objective

Choice Fatigue helps a person find a title they still want after comparing a small set of options. A useful recommendation is one that earns an initial shortlist and remains attractive after review, not one that maximizes swipes, opens, session length, or repeated use. This objective comes from the product brief in [the current algorithm plan](recommendation-algorithm-plan.md).

The experience has unusually valuable feedback compared with passive recommendation feeds: a person deliberately passes or shortlists a shown title, can rate a title they have seen, then can remove or keep shortlist items during a comparison step and save a final selection. These are different outcomes and should not be collapsed into one generic positive/negative label.

## Findings from primary research

### 1. Keep a content profile for cold start, but learn a ranking objective

Content-based recommendation represents each item with attributes, builds a user profile from feedback, and scores new items against that profile. This matches Choice Fatigue's one-account-at-a-time model and its provider metadata feed: a new instance or category can personalize after a few choices without requiring other users' histories. It also works when a future feed includes titles the user has never seen. [Pazzani and Billsus, “Content-Based Recommendation Systems”](https://citeseerx.ist.psu.edu/document?doi=34446adc7d701a2c3a89c2fc5f6d3479eef407b0&repid=rep1&type=pdf)

The current genre/decade/type features are a reasonable small first representation, but current raw feature means are not a well-calibrated preference model. BPR formalizes personalized ranking as pairwise comparisons between items a user prefers and items they prefer less, and optimizes the ordering rather than rating reconstruction. Its original experiments are for implicit-feedback item ranking, not this exact interaction design; the useful transfer is the pairwise objective, not adopting its collaborative matrix-factorization model. [Rendle et al., PMLR 2009](https://proceedings.mlr.press/r7/rendle09a.html)

**Project implication:** use the feed's popularity order as the no-history fallback; after feedback, rank using a small, regularized per-account content model. Do not build collaborative filtering or a neural ranker from the current sparse and private per-account history.

### 2. Treat evidence by what it actually says

Implicit-feedback research distinguishes an observed negative from missing evidence and models confidence in observations rather than treating every unobserved item as disliked. Choice Fatigue's explicit `pass` is stronger evidence than an unseen or merely shown title; shortlist is explicit positive evidence; details-open and time-on-card are not preference labels. [Hu, Koren, and Volinsky, “Collaborative Filtering for Implicit Feedback Datasets”](https://yifanhu.net/PUB/cf.pdf)

The current event model records `item_shown`, but ranking correctly does not turn exposure alone into a negative. Keep that rule. A shown title without a decision means “unknown.” A pass can be a weak negative, because passing may mean “not now” or may be contextual; do not let one pass erase a genre from the profile. A star rating is direct preference evidence for the seen title, but it should not be treated as the same outcome as shortlist retention.

**Project implication:** reconstruct one effective outcome per item/session after undo and correction events. Use a conservative weight for pass, a stronger positive for shortlist, and an explicit neutral center for ratings. Cap duplicate evidence so undo/retry/replay cannot multiply a single decision. Keep exposure counts separate from taste evidence.

### 3. Model short-term intent separately from durable taste

Research on adaptive news profiles explicitly separates short-term and long-term user interests and adapts from both implicit and explicit feedback. That architecture is a close match for Choice Fatigue: current-session decisions should react immediately, while cross-session signals should change more conservatively. [Billsus and Pazzani, “User Modeling for Adaptive News Access”](https://www.ics.uci.edu/~pazzani/Publications/BillsusA.pdf)

Movie recommender research also demonstrates temporal changes in rating behavior, including shifts in a user's rating scale and changes related to an item's age. It warns that indiscriminate time-window truncation can throw away useful history; this argues for validating recency behavior rather than selecting an arbitrary decay constant. [Koren, “Collaborative Filtering with Temporal Dynamics”](https://doi.org/10.1145/1557019.1557072)

**Project implication:** give active-session choices immediate influence and treat older account history as a lower-confidence prior. Initially keep a stable long-term baseline without forced decay; compare it with a small number of time-decay variants in chronological replay. Store/use event timestamps if recency is implemented. The current profile API does not include timestamps in its selected history fields, so it cannot currently calculate principled age-based decay.

### 4. Use review as comparative evidence, not another swipe

The review step supplies within-session comparisons. If the user retains one item and removes another from the same review set, the former is preferred *relative to that comparison*, but removal does not prove a general dislike. Pairwise ranking objectives such as BPR provide an appropriate way to represent a known preference ordering, while the initial shortlist/pass events supply a different, earlier-stage label. [Rendle et al., PMLR 2009](https://proceedings.mlr.press/r7/rendle09a.html)

**Project implication:** learn two outcomes:

1. **Consideration:** probability a shown title earns a shortlist.
2. **Retention:** probability a shortlisted title survives review and/or is saved.

Use `review_kept` and `saved` as stronger retention outcomes than an initial keep. Use `review_removed` only in pairwise comparisons against titles kept in the same review; do not globally penalize its genres. If a review has no retained title, its removals provide no relative winner. Keep corrections and restores effective, so a later restore cancels the earlier prune evidence.

The initial implementation preserves the first-impression signal after shortlist or review removal, retracts it only on an explicit undo, and adds a stronger positive signal for a saved title. A saved title is also compared with removed titles from the same review through a small similarity-difference term; removed titles do not become independent negative swipe evidence.

### 5. Diversify after estimating interest; don't inject a magic exploration percentage

Maximal Marginal Relevance combines relevance to the user's request with novelty relative to items already selected. It was introduced for information retrieval and summarization rather than this media app, so it supports a reranking technique, not a validated choice of features or coefficient. [Goldstein and Carbonell, ACL Anthology 1998](https://aclanthology.org/X98-1025/)

More novelty or variety is not automatically better. A human-centered movie-recommendation study with 445 active users found that deep-learning models could do better on novelty/unexpectedness while doing worse than classic collaborative filtering on diversity, trust, transparency, accuracy, and overall satisfaction. That result does not establish which model Choice Fatigue should use; it does show why a diversity bonus must be tested against user outcomes instead of assumed to help. [Sun et al., “What Are We Optimizing For? A Human-centric Evaluation of Deep Learning-based Movie Recommenders”](https://arxiv.org/abs/2401.11632)

**Project implication:** first score user fit, then construct the visible order greedily so adjacent cards do not all share the same genres/type/decade. Keep similarity features coarse and only use metadata that is consistently present across the relevant source. The Adult profile and reranking remain strictly category-isolated. If explicit exploration is added, expose it as a small, measured policy variant rather than hard-coding the existing plan's unvalidated “one in five” hypothesis.

Contextual bandits such as LinUCB combine feature context, reward estimates, and uncertainty to balance exploitation and exploration. The cited news recommender's reward is clicks, and its setup has abundant repeated users/items; those assumptions do not directly fit this private, sparse, explicit-choice app. Bandit exploration should therefore wait until Choice Fatigue has a defined user-value outcome and logs the selection probability needed for evaluation. [Li et al., “A Contextual-Bandit Approach to Personalized News Article Recommendation”](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/p661.pdf)

## Audit of the current implementation

The implementation in [`src/lib/recommendations.ts`](../src/lib/recommendations.ts) is a deterministic content heuristic: keep is `+1`, pass is `−0.5`, a 1–5 rating maps to a hand-set scale, genre is weighted `1.0`, decade and type `0.25`, and feature evidence is shrunk toward neutral. Provider ratings do not affect ranking. Saved outcomes and same-review comparisons add retention evidence. The score is still uncalibrated and unevaluated against Choice Fatigue's final outcome.

Historical events persist item IDs and actions only, as required by the product's data-retention rule. Profile reads now resolve a bounded set of historic IDs that are absent from the current feed directly through provider APIs, then discard metadata after deriving feature keys. Provider lookup failure degrades personalization without preventing discovery. The bounded lookup means older or unresolved events can still be omitted from an active profile.

Other current limitations:

- Historical signals have no timestamps at the ranker boundary, so they cannot be aged or separated into recent and long-term evidence.
- Neutral shrinkage reduces the effect of low-count features, but its prior strength is hand-set and not validated.
- Genres, decade, and type are averaged separately even when they co-occur on the same item. Their hand-set weights do not account for feature correlation or missing metadata.
- The ranking function ignores provider order after scoring ties, except for stable original order, and has no explicit diversity reranker or repeat suppression policy.
- Review comparison scores are a similarity-based heuristic rather than a trained pairwise ranking model; the coefficient is not validated.
- `signalCount` is a raw count and is only used for UI copy; it does not represent confidence or effective evidence.
- Profile reads limit direct provider hydration to a small bounded set, so older evidence may not contribute on a given read.

## Recommended algorithm shape

This is a project-specific direction to validate, not a demand to adopt a complex model immediately.

### Stage A: reliable, transparent baseline

1. **Candidate generation:** fetch current provider-popular items on demand. With no profile, preserve provider rank. Filter eligibility and Adult access before ranking.
2. **Profile reconstruction:** for the selected category, replay corrected explicit outcomes from the account's history. Keep current-session and cross-session evidence separate. Resolve old IDs through provider ID lookups when they are absent from the current feed; keep metadata only in request memory.
3. **Feature scoring:** use a small content vector (first genres, year bucket, media type, and available provider tags). Normalize provider-specific values into a shared vocabulary only where mappings are reliable. Fit a regularized linear preference model or a confidence-shrunk feature score; start at neutral so one pass cannot create certainty. Do not use exposure alone as negative feedback.
4. **Outcome scoring:** estimate consideration and retention separately. Use explicit pass/keep/rating for consideration; use review-kept/save for retention and within-review kept-over-removed comparisons for relative evidence.
5. **Reranking:** select the next card by user-fit with a modest novelty/diversity penalty against recent cards. Keep stable provider order as a tie-break and cold-start prior. Add exploration only as an explicitly randomized, logged treatment.
6. **State and privacy:** persist provider IDs, category, events, timestamps, correction links, and algorithm/policy version. Do not persist title, genre, rating, synopsis, artwork, embeddings, or provider response snapshots. Fetch metadata transiently for candidate scoring and any historical IDs needed to rebuild the profile.

### Stage B: tune from observed outcomes

After Stage A is stable, compare content scoring variants using chronological replay. A replay at time *t* must use only events before *t* and the candidate IDs/order actually available at *t*; random splits can leak later interactions into earlier predictions. Research documents this leakage and recommends respecting the global timeline. [Ji et al., “A Critical Study on Data Leakage in Recommender System Offline Evaluation”](https://arxiv.org/abs/2010.11060)

Feed-load and shown-item events now log ordered provider item IDs. This supports chronological replay without retaining title metadata. The IDs-only retention rule still limits replay fidelity: current provider lookups recover current metadata for an old ID, not the exact metadata returned years earlier. Treat re-resolved features as current-source approximations. Keep each category separate and report low-activity accounts separately; do not borrow Adult or other users' signals to fill gaps.

The key product metrics should follow the choice funnel:

- **Shortlist quality:** shortlist / shown, split by category and profile confidence.
- **Review retention:** review-kept / shortlisted and saves / shortlisted.
- **Decision usefulness:** sessions with at least one final saved/kept option; optionally ask a lightweight “Did this help?” question after a completed comparison.
- **Choice burden:** cards shown before first shortlist or final save, used as a guardrail for finding a good option with less effort—not as an engagement target.
- **Variety:** genre/type/decade coverage in a short window and repeated-title rate, paired with the retention/satisfaction metrics so variety does not become random noise.
- **Calibration:** among titles assigned similar predicted retention, check whether observed retention is similar; suppress confidence claims when there is too little evidence.

Do not use swipe count, detail opens, dwell time, session duration, or raw return frequency as success metrics. Those can increase while the app makes the choice harder.

For an online comparison, randomize only between safe, understandable policies such as current provider order and profile-aware/diversified order. Candidate IDs/order and shown item positions can now be reconstructed from event traces. Selection probabilities and randomized policy assignment are not logged yet; add them only with a deliberately randomized policy. Position and logging probability matter: research on learning to rank shows that presentation order biases interaction data, and counterfactual evaluation needs randomized exposure or known propensities to correct for it. [Joachims, Swaminathan, and Schnabel, WSDM 2017](https://www.cs.cornell.edu/people/tj/publications/joachims_etal_17a.pdf)

Treat all numeric weights, decay rates, diversity coefficients, and exploration shares as hypotheses. Establish a popularity-order baseline first, evaluate on chronological replay, then run a small opt-in randomized comparison with a reset/disable control. Choose the policy that improves review retention and reported usefulness without unacceptable choice burden or loss of variety.

## Proposed implementation order

1. **Implemented baseline:** corrected swipe semantics, bounded transient provider-ID feature resolution, confidence shrinkage, saved-title retention, same-review comparisons, and ID-only candidate/order traces.
2. **Evaluate before tuning:** compare provider popularity order and the current heuristic using chronological replay, then assess whether the retention and pairwise heuristics improve shortlist survival and choice usefulness.
3. **Add diversity reranking and repeat controls.** Validate against the simple popularity and relevance-only baselines.
4. **Add measurement before exploration.** Selection propensities and randomized policy assignment remain unlogged. Consider a small randomized online comparison only after chronological replay identifies a useful variant. Retain the current behavior as a rollback/control option.

## Primary sources

- Billsus, D. and Pazzani, M. J. (2000). “User Modeling for Adaptive News Access.” *User Modeling and User-Adapted Interaction*. [Author-hosted paper](https://www.ics.uci.edu/~pazzani/Publications/BillsusA.pdf).
- Goldstein, J. and Carbonell, J. (1998). “The Use of MMR, Diversity-Based Reranking for Reordering Documents and Producing Summaries.” [ACL Anthology](https://aclanthology.org/X98-1025/).
- Hu, Y., Koren, Y., and Volinsky, C. (2008). “Collaborative Filtering for Implicit Feedback Datasets.” [Author-hosted paper](https://yifanhu.net/PUB/cf.pdf).
- Joachims, T., Swaminathan, A., and Schnabel, T. (2017). “Unbiased Learning-to-Rank with Biased Feedback.” [Author-hosted paper](https://www.cs.cornell.edu/people/tj/publications/joachims_etal_17a.pdf).
- Koren, Y. (2009). “Collaborative Filtering with Temporal Dynamics.” *KDD*. [DOI](https://doi.org/10.1145/1557019.1557072).
- Li, L. et al. (2010). “A Contextual-Bandit Approach to Personalized News Article Recommendation.” *WWW*. [Microsoft Research paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/p661.pdf).
- Pazzani, M. J. and Billsus, D. (2007). “Content-Based Recommendation Systems.” *The Adaptive Web*. [Paper](https://citeseerx.ist.psu.edu/document?doi=34446adc7d701a2c3a89c2fc5f6d3479eef407b0&repid=rep1&type=pdf).
- Rendle, S. et al. (2009). “BPR: Bayesian Personalized Ranking from Implicit Feedback.” *Proceedings of UAI*. [PMLR](https://proceedings.mlr.press/r7/rendle09a.html).
- Ji, Y., Sun, A., Zhang, J., and Li, C. (2022). “A Critical Study on Data Leakage in Recommender System Offline Evaluation.” [ACM/arXiv](https://arxiv.org/abs/2010.11060).
- Sun, R. et al. (2024). “What Are We Optimizing For? A Human-centric Evaluation of Deep Learning-based Movie Recommenders.” [arXiv](https://arxiv.org/abs/2401.11632).
