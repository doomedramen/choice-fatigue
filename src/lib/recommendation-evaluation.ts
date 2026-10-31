import type { MediaItem } from "@/data";
import type { RecommendationEventInput } from "@/lib/recommendation-event-validation";
import { buildRecommendationProfile, mergeRecommendationEvents, rankRecommendations, recommendationFeatureItemIds, recommendationFeatureKeys } from "@/lib/recommendations";
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

/** Compare two fixed rankings against observed shortlist/save labels within each traced candidate set. */
export function compareRankings(input: Array<{ providerOrder: string[]; rankerOrder: string[]; shortlisted: string[]; saved: string[] }>) {
  return {
    providerOrder: {
      shortlisted: metrics(input.map(row => row.providerOrder), input.map(row => row.shortlisted)),
      saved: metrics(input.map(row => row.providerOrder), input.map(row => row.saved)),
    },
    currentRanker: {
      shortlisted: metrics(input.map(row => row.rankerOrder), input.map(row => row.shortlisted)),
      saved: metrics(input.map(row => row.rankerOrder), input.map(row => row.saved)),
    },
  };
}

/** Every impression is scored with only preceding events and previously fetched candidates. */
export function replayRecommendationEvents(events: RecommendationEventInput[], metadata: Map<string, MediaItem>) {
  const ordered = mergeRecommendationEvents(events);
  return (["Movies", "Shows", "Adult"] as const).map(category => {
    const categoryEvents = ordered.filter(event => event.category === category);
    const prior: RecommendationEventInput[] = [];
    const batches = new Map<string, Array<{ ids: string[]; lane: string; source: string }>>();
    const traces: Parameters<typeof compareRankings>[0] = [];
    const popularTraces: Parameters<typeof compareRankings>[0] = [];
    let candidateIds = 0, resolvedCandidateIds = 0, shown = 0, featureRequested = 0, featureEligible = 0, featureResolved = 0;
    const lanes = new Map<string, { candidateIds: Set<string>; shownIds: Set<string>; shortlistedIds: Set<string>; savedIds: Set<string> }>();
    const outcomes = new Map<string, { shortlisted: Set<string>; saved: Set<string> }>();
    const undone = new Set(categoryEvents.filter(row => row.eventType === "decision_undone").map(row => row.targetEventId));
    const decisionsById = new Map(categoryEvents.filter(event => event.eventType === "decision").map(event => [event.id, event]));
    for (const event of categoryEvents) {
      const result = outcomes.get(event.sessionId) ?? { shortlisted: new Set(), saved: new Set() };
      if (event.itemId && event.eventType === "decision" && event.decision === "keep" && !undone.has(event.id)) result.shortlisted.add(event.itemId);
      if (event.itemId && event.eventType === "saved") result.saved.add(event.itemId);
      outcomes.set(event.sessionId, result);
      if (event.eventType === "saved" && event.itemId && event.targetEventId) {
        const consideration = decisionsById.get(event.targetEventId);
        if (consideration?.itemId === event.itemId && !undone.has(consideration.id)) {
          const original = outcomes.get(consideration.sessionId) ?? { shortlisted: new Set<string>(), saved: new Set<string>() };
          original.saved.add(event.itemId);
          outcomes.set(consideration.sessionId, original);
        }
      }
    }
    for (const event of categoryEvents) {
      if (event.eventType === "candidate_batch" && event.retrievalId && event.candidateIds) {
        const key = `${event.sessionId}:${event.retrievalId}`;
        const group = batches.get(key) ?? [];
        group.push({ ids: event.candidateIds, lane: event.lane!, source: event.source! });
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
        const runGroups = [...batches].filter(([key]) => key.startsWith(`${event.sessionId}:`)).map(([, group]) => group);
        const available = deduplicateTitles(runGroups.flatMap(group => interleaveItems(group.map(batch => batch.ids.flatMap(id => metadata.has(id) ? [metadata.get(id)!] : [])))));
        const availableIds = new Set(available.map(item => item.id));
        const missing = recommendationFeatureItemIds(prior, category).filter(id => !availableIds.has(id));
        const selected = missing.slice(0, 12);
        const featureItems = [...available, ...selected.flatMap(id => metadata.has(id) ? [metadata.get(id)!] : [])];
        const features = Object.fromEntries(featureItems.map(item => [item.id, recommendationFeatureKeys({ genres: item.genre, year: item.year, type: item.type })]));
        featureEligible += missing.length; featureRequested += selected.length; featureResolved += selected.filter(id => metadata.has(id)).length;
        const profile = buildRecommendationProfile(prior, features, category);
        const window = new Set(event.candidateIds);
        const considered = new Set(profile.consideredIds);
        const candidates = available.filter(item => window.has(item.id) && !considered.has(item.id));
        const rankerOrder = rankRecommendations(candidates, profile.signals, profile.comparisons).items.map(item => item.id);
        const labels = outcomes.get(event.sessionId)!;
        const comparison = { providerOrder: candidates.map(item => item.id), rankerOrder, shortlisted: [...labels.shortlisted], saved: [...labels.saved] };
        if (candidates.length) traces.push(comparison);
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
      matchedCandidateMixRanking: compareRankings(traces), matchedPopularityRanking: compareRankings(popularTraces),
      reviewRetention: keeps ? retained / keeps : null, medianObservedCardsToFirstSave: median,
      retrievalLanes: Object.fromEntries([...lanes].map(([key, lane]) => [key, { candidates: lane.candidateIds.size, shown: lane.shownIds.size, shortlisted: lane.shortlistedIds.size, saved: lane.savedIds.size }])),
    };
  });
}
