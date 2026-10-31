import type { MediaItem } from "@/data";
import { isRelatedProvenance, type RecommendationEventInput, type RelatedProvenance } from "@/lib/recommendation-event-validation";
import { buildRecommendationProfile, effectiveRecommendationEvents, mergeRecommendationEvents, rankRecommendations, recommendationFeatureItemIds, recommendationFeatureKeys, relatedShowSeeds } from "@/lib/recommendations";
import { deduplicateTitles, interleaveItems } from "@/lib/discovery-feed";

export type RankingMetrics = { traces: number; labeledTraces: number; relevantItems: number; meanReciprocalRank: number | null; recallAt5: number | null; recallAt10: number | null };

export function summarizeMetadataCoverage(eligible: number, requested: number, resolved: number) {
  const boundedEligible = Math.max(0, eligible);
  const boundedRequested = Math.max(0, Math.min(requested, boundedEligible));
  const boundedResolved = Math.max(0, Math.min(resolved, boundedRequested));
  return {
    eligible: boundedEligible,
    requested: boundedRequested,
    resolved: boundedResolved,
    omittedByLimit: boundedEligible - boundedRequested,
    resolutionRate: boundedEligible ? Number((boundedResolved / boundedEligible).toFixed(4)) : null,
    attemptedResolutionRate: boundedRequested ? Number((boundedResolved / boundedRequested).toFixed(4)) : null,
  };
}

function metrics(rankings: string[][], relevantBySession: string[][]): RankingMetrics {
  let labeledTraces = 0;
  let relevantItems = 0;
  let reciprocalRankTotal = 0;
  let recall5Total = 0;
  let recall10Total = 0;
  for (let index = 0; index < rankings.length; index += 1) {
    const relevant = new Set(relevantBySession[index].filter(id => rankings[index].includes(id)));
    if (!relevant.size) continue;
    labeledTraces += 1;
    relevantItems += relevant.size;
    const firstRank = Math.min(...[...relevant].map(id => rankings[index].indexOf(id) + 1));
    reciprocalRankTotal += 1 / firstRank;
    recall5Total += [...relevant].filter(id => rankings[index].indexOf(id) < 5).length / relevant.size;
    recall10Total += [...relevant].filter(id => rankings[index].indexOf(id) < 10).length / relevant.size;
  }
  return {
    traces: rankings.length,
    labeledTraces,
    relevantItems,
    meanReciprocalRank: labeledTraces ? Number((reciprocalRankTotal / labeledTraces).toFixed(4)) : null,
    recallAt5: labeledTraces ? Number((recall5Total / labeledTraces).toFixed(4)) : null,
    recallAt10: labeledTraces ? Number((recall10Total / labeledTraces).toFixed(4)) : null,
  };
}

/** Deterministic PRNG (mulberry32) so replay reports, baselines, and intervals are reproducible. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(ids: string[], random: () => number) {
  const result = [...ids];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

const round4 = (value: number) => Number(value.toFixed(4));

/** Share of (kept, passed) pairs in the same window where the kept title ranks first. */
function pairwiseAccuracy(rankings: string[][], positives: string[][], negatives: string[][]) {
  let correct = 0, total = 0;
  rankings.forEach((ranking, index) => {
    const position = new Map(ranking.map((id, rank) => [id, rank]));
    for (const positive of positives[index]) for (const negative of negatives[index] ?? []) {
      if (!position.has(positive) || !position.has(negative)) continue;
      total += 1;
      if (position.get(positive)! < position.get(negative)!) correct += 1;
    }
  });
  return total ? round4(correct / total) : null;
}

/**
 * Recall@10 where each relevant title is weighted by the inverse of an approximate exposure
 * propensity, 1/log2(shown position + 2), using the position in the logged shown order. Titles the production order showed late were less likely
 * to be chosen at all, so recovering them counts for more. This is a rough position-bias model.
 */
function exposureWeightedRecallAt10(rankings: string[][], relevant: string[][], shownOrders: string[][]) {
  let found = 0, total = 0;
  rankings.forEach((ranking, index) => {
    for (const id of relevant[index]) {
      const shown = shownOrders[index].indexOf(id);
      if (shown < 0 || !ranking.includes(id)) continue;
      const weight = Math.log2(shown + 2);
      total += weight;
      if (ranking.indexOf(id) < 10) found += weight;
    }
  });
  return total ? round4(found / total) : null;
}

/** Session-level bootstrap of a mean over per-trace values: traces in one session are correlated, so sessions are resampled whole. */
function bootstrapSessionMean(valuesBySession: Map<string, number[]>, seed: number, resamples = 1000): { mean: number; interval: [number, number] } | null {
  const sessions = [...valuesBySession.values()].filter(values => values.length);
  if (sessions.length < 2) return null;
  const all = sessions.flat();
  const random = seededRandom(seed);
  const means: number[] = [];
  for (let sample = 0; sample < resamples; sample++) {
    let sum = 0, count = 0;
    for (let draw = 0; draw < sessions.length; draw++) {
      const values = sessions[Math.floor(random() * sessions.length)];
      for (const value of values) { sum += value; count += 1; }
    }
    means.push(sum / count);
  }
  means.sort((a, b) => a - b);
  return { mean: round4(all.reduce((sum, value) => sum + value, 0) / all.length), interval: [round4(means[Math.floor(resamples * 0.025)]), round4(means[Math.ceil(resamples * 0.975) - 1])] };
}

function reciprocalRank(ranking: string[], relevant: string[]) {
  const ranks = relevant.map(id => ranking.indexOf(id)).filter(rank => rank >= 0);
  return ranks.length ? 1 / (Math.min(...ranks) + 1) : null;
}

function bootstrapMeanReciprocalRank(rankings: string[][], relevant: string[][], sessionIds: string[], seed: number): [number, number] | null {
  const bySession = new Map<string, number[]>();
  rankings.forEach((ranking, index) => {
    const value = reciprocalRank(ranking, relevant[index]);
    if (value !== null) bySession.set(sessionIds[index], [...(bySession.get(sessionIds[index]) ?? []), value]);
  });
  return bootstrapSessionMean(bySession, seed)?.interval ?? null;
}

/**
 * Paired comparison: per trace, the difference in reciprocal rank between two orders over the same
 * candidates, bootstrapped by session. Separate intervals for each order overlap even when one order
 * is reliably better; the interval of the difference is what says whether it is.
 */
function pairedReciprocalRankDifference(left: string[][], right: string[][], relevant: string[][], sessionIds: string[], seed: number) {
  const bySession = new Map<string, number[]>();
  left.forEach((ranking, index) => {
    const a = reciprocalRank(ranking, relevant[index]), b = reciprocalRank(right[index], relevant[index]);
    if (a !== null && b !== null) bySession.set(sessionIds[index], [...(bySession.get(sessionIds[index]) ?? []), a - b]);
  });
  return bootstrapSessionMean(bySession, seed);
}

/**
 * Pointwise check on the card actually shown: where does each order place it within its window, and
 * does that position separate cards the user kept from cards they passed (AUC; 0.5 is chance)? Unlike
 * list metrics this does not reward an order for agreeing with whichever ranker chose what was shown,
 * because every impression contributes exactly one logged card and its observed outcome.
 */
function shownCardAuc(rankings: string[][], shown: Array<{ itemId: string; outcome: "keep" | "pass" } | null>) {
  const kept: number[] = [], passed: number[] = [];
  rankings.forEach((ranking, index) => {
    const card = shown[index];
    const position = card ? ranking.indexOf(card.itemId) : -1;
    if (!card || position < 0 || ranking.length < 2) return;
    (card.outcome === "keep" ? kept : passed).push(1 - position / (ranking.length - 1));
  });
  if (!kept.length || !passed.length) return null;
  let wins = 0;
  for (const k of kept) for (const p of passed) wins += k > p ? 1 : k === p ? 0.5 : 0;
  return round4(wins / (kept.length * passed.length));
}

export type RankingComparisonRow = {
  providerOrder: string[]; rankerOrder: string[]; shortlisted: string[]; saved: string[]; passed?: string[]; sessionId?: string;
  /** The logged window, in the order cards were actually shown (shown card first). */
  shownOrder?: string[];
  /** The card shown at this impression and what the user did with it, when they decided. */
  shownCard?: { itemId: string; outcome: "keep" | "pass" } | null;
};

/**
 * Compare fixed rankings against observed shortlist/save labels within each traced candidate set.
 * A seeded random order is the floor any ranker must beat; intervals resample whole sessions, and
 * ranker-versus-baseline differences are paired per trace.
 */
export function compareRankings(input: RankingComparisonRow[], seed = 1) {
  const random = seededRandom(seed);
  const orders = {
    providerOrder: input.map(row => row.providerOrder),
    currentRanker: input.map(row => row.rankerOrder),
    randomOrder: input.map(row => shuffled(row.providerOrder, random)),
  };
  const shortlisted = input.map(row => row.shortlisted), saved = input.map(row => row.saved), passed = input.map(row => row.passed ?? []);
  const sessionIds = input.map((row, index) => row.sessionId ?? String(index));
  const shownOrders = input.map(row => row.shownOrder ?? row.providerOrder);
  const shownCards = input.map(row => row.shownCard ?? null);
  const report = <T>(score: (rankings: string[][]) => T) => ({ providerOrder: score(orders.providerOrder), currentRanker: score(orders.currentRanker), randomOrder: score(orders.randomOrder) });
  return {
    ...report(rankings => ({ shortlisted: metrics(rankings, shortlisted), saved: metrics(rankings, saved) })),
    keptOverPassedAccuracy: report(rankings => pairwiseAccuracy(rankings, shortlisted, passed)),
    exposureWeightedShortlistRecallAt10: report(rankings => exposureWeightedRecallAt10(rankings, shortlisted, shownOrders)),
    shownCardAuc: report(rankings => shownCardAuc(rankings, shownCards)),
    shortlistedMeanReciprocalRank95: report(rankings => bootstrapMeanReciprocalRank(rankings, shortlisted, sessionIds, seed)),
    shortlistedReciprocalRankDifference95: {
      currentRankerMinusProvider: pairedReciprocalRankDifference(orders.currentRanker, orders.providerOrder, shortlisted, sessionIds, seed),
      currentRankerMinusRandom: pairedReciprocalRankDifference(orders.currentRanker, orders.randomOrder, shortlisted, sessionIds, seed),
    },
  };
}

/**
 * Chooses which IDs a replay may look up when its budget is smaller than the history. Whole sessions
 * are taken in a seeded random order, each with the titles it decided or saved and the windows of
 * impressions whose card was decided, so covered sessions are evaluated fully rather than every
 * session thinly or only the earliest. Sessions that do not fit are skipped and reported.
 */
export function replayMetadataPlan(events: RecommendationEventInput[], isEligible: (id: string) => boolean, maxIds = 500, seed = 1) {
  const ordered = mergeRecommendationEvents(events);
  const decided = new Set(effectiveRecommendationEvents(ordered).flatMap(event => event.eventType === "decision" && event.itemId ? [event.itemId] : []));
  const bySession = new Map<string, Set<string>>();
  for (const event of ordered) {
    const ids = bySession.get(event.sessionId) ?? new Set<string>();
    if ((event.eventType === "decision" || event.eventType === "saved") && event.itemId) ids.add(event.itemId);
    if (event.eventType === "item_shown" && event.itemId && decided.has(event.itemId)) (event.candidateIds ?? []).forEach(id => ids.add(id));
    bySession.set(event.sessionId, ids);
  }
  const chosen = new Set<string>();
  let sessionsWithLabels = 0, sessionsCovered = 0;
  for (const sessionId of shuffled([...bySession.keys()].sort(), seededRandom(seed))) {
    const needed = [...bySession.get(sessionId)!].filter(id => isEligible(id) && !chosen.has(id));
    if (!bySession.get(sessionId)!.size) continue;
    sessionsWithLabels += 1;
    if (chosen.size + needed.length > maxIds) continue;
    needed.forEach(id => chosen.add(id));
    sessionsCovered += 1;
  }
  return { ids: [...chosen], sessionsWithLabels, sessionsCovered };
}

/** Every impression is scored with only preceding events and previously fetched candidates. */
export function replayRecommendationEvents(events: RecommendationEventInput[], metadata: Map<string, MediaItem>) {
  const ordered = mergeRecommendationEvents(events);
  return (["Movies", "Shows", "Adult"] as const).map(category => {
    const categoryEvents = ordered.filter(event => event.category === category);
    const prior: RecommendationEventInput[] = [];
    const batches = new Map<string, Array<{ ids: string[]; lane: string; source: string; provenance?: RelatedProvenance | null; version: string }>>();
    const snapshots = new Map<string, string[]>();
    const creditsBySession = new Map<string, Set<string>>();
    const attemptedBySession = new Map<string, Set<string>>();
    let snapshotCount = 0, incompleteImpressions = 0;
    const traces: Parameters<typeof compareRankings>[0] = [];
    const contentTraces: Parameters<typeof compareRankings>[0] = [];
    const popularTraces: Parameters<typeof compareRankings>[0] = [];
    let candidateIds = 0, resolvedCandidateIds = 0, shown = 0, featureRequested = 0, featureEligible = 0, featureResolved = 0;
    let relatedSeedBatches = 0, matchingRelatedSeedBatches = 0;
    const creditRequested = new Set<string>(), recordedCreditRequested = new Set<string>(), recordedCreditResolved = new Set<string>();
    const lanes = new Map<string, { candidateIds: Set<string>; shownIds: Set<string>; shortlistedIds: Set<string>; savedIds: Set<string> }>();
    const outcomes = new Map<string, { shortlisted: Set<string>; saved: Set<string>; passed: Set<string> }>();
    // Labels come from the same corrected history the ranker trains on.
    const effective = effectiveRecommendationEvents(categoryEvents);
    const decisionsById = new Map(effective.filter(event => event.eventType === "decision").map(event => [event.id, event]));
    for (const event of categoryEvents) outcomes.set(event.sessionId, outcomes.get(event.sessionId) ?? { shortlisted: new Set(), saved: new Set(), passed: new Set() });
    for (const event of effective) {
      const result = outcomes.get(event.sessionId)!;
      if (event.itemId && event.eventType === "decision" && event.decision === "keep") result.shortlisted.add(event.itemId);
      if (event.itemId && event.eventType === "decision" && event.decision === "pass") result.passed.add(event.itemId);
      if (event.itemId && event.eventType === "saved") result.saved.add(event.itemId);
      if (event.eventType === "saved" && event.itemId && event.targetEventId) {
        const consideration = decisionsById.get(event.targetEventId);
        if (consideration?.itemId === event.itemId) {
          const original = outcomes.get(consideration.sessionId) ?? { shortlisted: new Set<string>(), saved: new Set<string>(), passed: new Set<string>() };
          original.saved.add(event.itemId);
          outcomes.set(consideration.sessionId, original);
        }
      }
    }
    for (const event of categoryEvents) {
      if (event.eventType === "retrieval_snapshot" && event.retrievalId && event.provenance && !isRelatedProvenance(event.provenance)) {
        const snapshotKey = `${event.sessionId}:${event.retrievalId}`;
        const feedSnapshot = batches.has(snapshotKey);
        const credits = creditsBySession.get(event.sessionId) ?? new Set<string>();
        for (const id of [...event.provenance.candidateResolvedIds, ...(feedSnapshot ? [] : event.provenance.historicalResolvedIds)]) credits.add(id);
        creditsBySession.set(event.sessionId, credits);
        event.provenance.candidateRequestedIds.forEach(id => creditRequested.add(id));
        event.provenance.candidateRequestedIds.forEach(id => recordedCreditRequested.add(id));
        event.provenance.candidateResolvedIds.forEach(id => recordedCreditResolved.add(id));
        if (feedSnapshot) { snapshots.set(snapshotKey, event.candidateIds ?? []); snapshotCount++; }
      }
      if (event.eventType === "candidate_batch" && event.retrievalId && event.candidateIds) {
        if (event.lane === "related" && isRelatedProvenance(event.provenance) && event.provenance.page === 1) {
          relatedSeedBatches += 1;
          const provenance = event.provenance;
          if (relatedShowSeeds(prior).some(seed => seed.itemId === provenance.seedItemId && seed.eventId === provenance.seedEventId)) matchingRelatedSeedBatches += 1;
        }
        const key = `${event.sessionId}:${event.retrievalId}`;
        const group = batches.get(key) ?? [];
        group.push({ ids: event.candidateIds, lane: event.lane!, source: event.source!, provenance: isRelatedProvenance(event.provenance) ? event.provenance : null, version: event.algorithmVersion });
        batches.set(key, group);
        candidateIds += event.candidateIds.length;
        resolvedCandidateIds += event.candidateIds.filter(id => metadata.has(id)).length;
        const laneKey = `${event.source}:${event.lane}`;
        const lane = lanes.get(laneKey) ?? { candidateIds: new Set<string>(), shownIds: new Set<string>(), shortlistedIds: new Set<string>(), savedIds: new Set<string>() };
        event.candidateIds.forEach(id => lane.candidateIds.add(id));
        lanes.set(laneKey, lane);
      }
      if (event.eventType === "item_shown" && event.itemId && event.candidateIds) {
        shown += 1;
        const runEntries = [...batches].filter(([key]) => key.startsWith(`${event.sessionId}:`));
        const runGroups = runEntries.map(([, group]) => group);
        if (runEntries.some(([key]) => !snapshots.has(key))) incompleteImpressions++;
        const available = deduplicateTitles(runEntries.flatMap(([key, group]) => snapshots.has(key) ? snapshots.get(key)!.flatMap(id => metadata.has(id) ? [metadata.get(id)!] : []) : interleaveItems(group.map(batch => batch.ids.flatMap(id => metadata.has(id) ? [metadata.get(id)!] : [])))));
        for (const group of runGroups) if (group.some(batch => batch.version === "content-v5")) {
          const ids: string[] = [];
          for (let index = 0; index < Math.max(0, ...group.map(batch => batch.ids.length)) && ids.length < 10; index++) {
            for (const batch of group) {
              const id = batch.ids[index];
              if (id && !ids.includes(id) && ids.length < 10) ids.push(id);
            }
          }
          ids.forEach(id => creditRequested.add(id));
        }
        const availableIds = new Set(available.map(item => item.id));
        const missing = recommendationFeatureItemIds(prior, category).filter(id => !availableIds.has(id));
        // v7 clients rotate the twelve-title window across reads and keep what they fetched; older versions refetched the newest twelve.
        const attempted = attemptedBySession.get(event.sessionId) ?? new Set<string>();
        const rotating = event.algorithmVersion === "content-v7";
        const selected = rotating ? missing.filter(id => !attempted.has(id)).slice(0, 12) : missing.slice(0, 12);
        selected.forEach(id => attempted.add(id));
        attemptedBySession.set(event.sessionId, attempted);
        const held = rotating ? missing.filter(id => attempted.has(id)) : selected;
        const featureItems = [...available, ...held.flatMap(id => metadata.has(id) ? [metadata.get(id)!] : [])];
        const resolved = creditsBySession.get(event.sessionId) ?? new Set<string>();
        const features = Object.fromEntries(featureItems.map(item => [item.id, [...recommendationFeatureKeys({ genres: item.genre, year: item.year, type: item.type, pairing: item.pairing }), ...((["content-v6", "content-v7"].includes(event.algorithmVersion) ? resolved.has(item.id) : !availableIds.has(item.id) || creditRequested.has(item.id)) ? ((item as MediaItem & { creditKeys?: string[] }).creditKeys ?? []) : [])]]));
        featureEligible += missing.length; featureRequested += selected.length; featureResolved += selected.filter(id => metadata.has(id)).length;
        const profile = buildRecommendationProfile(prior, features, category);
        const window = new Set(event.candidateIds);
        const considered = new Set(profile.consideredIds);
        const candidates = available.filter(item => window.has(item.id) && !considered.has(item.id));
        const relatedRanks: Record<string, number> = {};
        for (const group of runGroups) for (const batch of group) if (batch.lane === "related" && batch.provenance) batch.ids.forEach((id, index) => {
          const rank = (batch.provenance!.page - 1) * 20 + batch.provenance!.positions[index];
          relatedRanks[id] = Math.min(relatedRanks[id] ?? Infinity, rank);
        });
        const contentOrder = rankRecommendations(candidates, profile.signals, profile.comparisons).items.map(item => item.id);
        const rankerOrder = rankRecommendations(candidates, profile.signals, profile.comparisons, features, relatedRanks).items.map(item => item.id);
        const labels = outcomes.get(event.sessionId)!;
        const candidateIds = new Set(candidates.map(item => item.id));
        const shownOutcome = labels.shortlisted.has(event.itemId) ? "keep" as const : labels.passed.has(event.itemId) ? "pass" as const : null;
        const comparison = {
          providerOrder: candidates.map(item => item.id), rankerOrder, shortlisted: [...labels.shortlisted], saved: [...labels.saved], passed: [...labels.passed], sessionId: event.sessionId,
          // The logged window keeps the order cards were really shown; derived traces below reuse it rather than their own baseline order.
          shownOrder: event.candidateIds.filter(id => candidateIds.has(id)),
          shownCard: shownOutcome && candidateIds.has(event.itemId) ? { itemId: event.itemId, outcome: shownOutcome } : null,
        };
        if (candidates.length) { traces.push(comparison); contentTraces.push({ ...comparison, providerOrder: contentOrder }); }
        const popularIds = new Set(runGroups.flatMap(group => group.filter(batch => batch.lane === "popular").flatMap(batch => batch.ids)));
        const popularOrder = comparison.providerOrder.filter(id => popularIds.has(id));
        if (popularOrder.length) popularTraces.push({ ...comparison, providerOrder: popularOrder, rankerOrder: rankerOrder.filter(id => popularIds.has(id)) });
        const originKeys = new Set(runGroups.flatMap(group => group.filter(batch => batch.ids.includes(event.itemId!)).map(batch => `${batch.source}:${batch.lane}`)));
        for (const key of originKeys) {
          const lane = lanes.get(key)!;
          lane.shownIds.add(event.itemId);
          if (labels.shortlisted.has(event.itemId)) lane.shortlistedIds.add(event.itemId);
          if (labels.saved.has(event.itemId)) lane.savedIds.add(event.itemId);
        }
      }
      prior.push(event);
    }
    const sessions = [...new Set(categoryEvents.filter(event => event.eventType !== "saved" || event.sessionId !== "saved-seed").map(event => event.sessionId))];
    const cardsToSave = sessions.flatMap(sessionId => {
      const run = categoryEvents.filter(event => event.sessionId === sessionId);
      const firstSave = run.findIndex(event => event.eventType === "saved");
      return firstSave < 0 ? [] : [run.slice(0, firstSave).filter(event => event.eventType === "item_shown").length];
    }).sort((a, b) => a - b);
    const middle = Math.floor(cardsToSave.length / 2);
    const median = !cardsToSave.length ? null : cardsToSave.length % 2 ? cardsToSave[middle] : (cardsToSave[middle - 1] + cardsToSave[middle]) / 2;
    const keeps = [...outcomes].filter(([id]) => id !== "saved-seed").reduce((count, [, value]) => count + value.shortlisted.size, 0);
    const retained = [...outcomes].filter(([id]) => id !== "saved-seed").reduce((count, [, value]) => count + [...value.shortlisted].filter(id => value.saved.has(id)).length, 0);
    return {
      category, sessions: sessions.length, impressions: shown,
      candidateMetadataCoverage: summarizeMetadataCoverage(candidateIds, candidateIds, resolvedCandidateIds),
      historicalFeatureCoverage: summarizeMetadataCoverage(featureEligible, featureRequested, featureResolved),
      matchedCandidateMixRanking: compareRankings(traces), matchedContentVsNewRanking: compareRankings(contentTraces), creditCoverage: summarizeMetadataCoverage(creditRequested.size, creditRequested.size, [...creditRequested].filter(id => Boolean((metadata.get(id) as (MediaItem & { creditKeys?: string[] }) | undefined)?.creditKeys)).length), matchedPopularityRanking: compareRankings(popularTraces),
      reviewRetention: keeps ? retained / keeps : null, medianObservedCardsToFirstSave: median,
      relatedSeedBatches, matchingRelatedSeedBatches, snapshotCoverage: { snapshots: snapshotCount, incompleteImpressions },
      recordedCreditCoverage: summarizeMetadataCoverage(recordedCreditRequested.size, recordedCreditRequested.size, recordedCreditResolved.size),
      replayLimitations: "Older traces lack retrieval snapshots. Features come from provider metadata fetched today, which may differ from what the user saw; storing the original metadata would break the provider-transient rule. Users could only choose among titles the production order showed, so the exposure-weighted metric uses an approximate 1/log2(position+2) propensity model rather than logged propensities. Intervals resample whole sessions.",
      retrievalLanes: Object.fromEntries([...lanes].map(([key, lane]) => [key, { candidates: lane.candidateIds.size, shown: lane.shownIds.size, shortlisted: lane.shortlistedIds.size, saved: lane.savedIds.size }])),
    };
  });
}
