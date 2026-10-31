import type { MediaItem } from "@/data";
import { creditBonus, creditPreferences } from "@/lib/credit-features";

export type RecommendationDecision = "keep" | "pass" | "seen";
export interface RecommendationSignal { itemId: string; decision: RecommendationDecision; rating?: number; weight?: number; featureKeys?: string[] }
export interface RecommendationComparison { preferredItemId: string; removedItemId: string; preferredFeatureKeys?: string[]; removedFeatureKeys?: string[] }
export interface RecommendationHistoryEvent {
  id: string; sessionId: string; reviewId?: string | null; itemId: string | null; eventType: string;
  decision: string | null; rating: number | null; targetEventId: string | null; algorithmVersion?: string; category?: string; occurredAt?: string | Date; sequence?: number;
}

export function recommendationComparisonsFromHistory(events: RecommendationHistoryEvent[], category?: string): Array<Pick<RecommendationComparison, "preferredItemId" | "removedItemId">> {
  const reviews = new Map<string, { removed: Map<string, boolean>; saved: Set<string> }>();
  for (const event of events) {
    if ((category && event.category !== category) || !event.reviewId) continue;
    let review = reviews.get(event.reviewId);
    if (!review) {
      review = { removed: new Map(), saved: new Set() };
      reviews.set(event.reviewId, review);
    }
    if (!event.itemId) continue;
    if (event.eventType === "review_removed") review.removed.set(event.itemId, true);
    else if (event.eventType === "review_restored") review.removed.set(event.itemId, false);
    else if (event.eventType === "saved") review.saved.add(event.itemId);
  }

  const comparisons: Array<Pick<RecommendationComparison, "preferredItemId" | "removedItemId">> = [];
  for (const review of [...reviews.values()].reverse()) {
    const preferred = [...review.saved];
    const removed = [...review.removed].filter(([, isRemoved]) => isRemoved).map(([itemId]) => itemId);
    for (const preferredItemId of preferred) {
      for (const removedItemId of removed) {
        if (preferredItemId !== removedItemId) comparisons.push({ preferredItemId, removedItemId });
        if (comparisons.length >= 24) return comparisons;
      }
    }
  }
  return comparisons;
}

export function recommendationSignalsFromHistory(events: RecommendationHistoryEvent[], category?: string): RecommendationSignal[] {
  const history = events.filter(event => (!category || event.category === category));
  const withdrawn = new Set(history
    .filter(event => event.eventType === "decision_undone")
    .map(event => event.targetEventId)
    .filter((id): id is string => Boolean(id)));
  // Review removal changes the shortlist, but does not erase the original first-impression signal.
  const decisions = history
    .filter(event => event.eventType === "decision" && event.itemId && (event.decision === "keep" || event.decision === "pass" || event.decision === "seen") && !withdrawn.has(event.id))
    .map(event => ({ itemId: event.itemId!, decision: event.decision as RecommendationDecision, rating: event.rating == null ? undefined : event.algorithmVersion === "content-v3" ? event.rating * 2 : event.rating }));
  const savedItemIds = new Set(history.filter(event => event.eventType === "saved" && event.itemId).map(event => event.itemId!));
  const retention = [...savedItemIds].map(itemId => ({ itemId, decision: "keep" as const, weight: 1.5 }));
  return [...decisions, ...retention];
}

export const recommendationWeights: Record<Exclude<RecommendationDecision, "seen">, number> = {
  keep: 1,
  pass: -0.5,
};

/** A 1–10 point review is explicit preference evidence, centered on neutral. */
export const reviewRatingWeights: Record<number, number> = {
  1: -0.5, 2: -0.5, 3: -0.375, 4: -0.25, 5: -0.125,
  6: 0, 7: 0.25, 8: 0.5, 9: 0.75, 10: 1,
};

export interface RecommendationPreference {
  key: string;
  score: number;
  evidenceCount: number;
}

/** Summarize the same shrunken feature evidence used by the ranker. */
export function recommendationPreferenceProfile(signals: RecommendationSignal[]): RecommendationPreference[] {
  const evidenceByFeature = new Map<string, FeatureEvidence>();
  for (const signal of signals) {
    const decisionWeight = signal.decision === "seen"
      ? reviewRatingWeights[signal.rating ?? 0]
      : recommendationWeights[signal.decision];
    const weight = signal.weight ?? decisionWeight;
    if (weight === undefined) continue;
    for (const key of signal.featureKeys ?? []) {
      const evidence = evidenceByFeature.get(key) ?? { total: 0, count: 0 };
      evidence.total += weight;
      evidence.count += 1;
      evidenceByFeature.set(key, evidence);
    }
  }
  return [...evidenceByFeature].map(([key, evidence]) => ({
    key,
    score: evidence.total / (evidence.count + 2),
    evidenceCount: evidence.count,
  })).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

interface FeatureEvidence {
  total: number;
  count: number;
}

interface ItemFeature {
  key: string;
  weight: number;
}

export interface RecommendationFeatureMetadata { genres?: string[]; year?: number; type?: string }

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function recommendationFeatureKeys(metadata: RecommendationFeatureMetadata): string[] {
  const genres = [...new Set((metadata.genres ?? []).map(normalized).filter(Boolean))]
    .map(genre => ({ key: `genre:${genre}`, weight: 1 }));
  const decade = typeof metadata.year === "number" ? Math.floor(metadata.year / 10) * 10 : null;
  const type = normalized(metadata.type ?? "");

  return [
    ...genres,
    ...(decade === null ? [] : [{ key: `decade:${decade}`, weight: 0.25 }]),
    ...(type && type !== "title" ? [{ key: `type:${type}`, weight: 0.25 }] : []),
  ].map(feature => feature.key);
}

function featureWeight(key: string) {
  return key.startsWith("genre:") ? 1 : 0.25;
}

function featuresFor(item: MediaItem): ItemFeature[] {
  return recommendationFeatureKeys({ genres: item.genre, year: item.year, type: item.type })
    .map(key => ({ key, weight: featureWeight(key) }));
}

/** Rank one category from the canonical, corrected event profile. */
export function rankRecommendations(
  items: MediaItem[],
  historicalSignals: RecommendationSignal[] = [],
  historicalComparisons: RecommendationComparison[] = [],
  candidateFeatures: RecommendationFeatures = {},
  relatedRanks: Record<string, number> = {},
) {
  const featureEvidence = new Map<string, FeatureEvidence>();
  let signalCount = 0;

  const itemById = new Map(items.map(item => [item.id, item]));
  for (const signal of historicalSignals) {
    const item = itemById.get(signal.itemId);
    const features = item ? featuresFor(item) : (signal.featureKeys ?? []).map(key => ({ key, weight: featureWeight(key) }));
    if (!features.length) continue;
    const decisionWeight = signal.decision === "seen"
      ? reviewRatingWeights[signal.rating ?? 0]
      : recommendationWeights[signal.decision];
    if (decisionWeight === undefined) continue;
    const weight = signal.weight ?? decisionWeight;
    signalCount += 1;
    for (const feature of features) {
      const evidence = featureEvidence.get(feature.key) ?? { total: 0, count: 0 };
      evidence.total += weight;
      evidence.count += 1;
      featureEvidence.set(feature.key, evidence);
    }
  }

  const credits = creditPreferences(historicalSignals);
  const neutralPriorStrength = 2;
  const featureScores = new Map([...featureEvidence].map(([feature, evidence]) => [
    feature,
    evidence.total / (evidence.count + neutralPriorStrength),
  ]));

  const comparisons = historicalComparisons.map(comparison => ({
    preferred: itemById.has(comparison.preferredItemId)
      ? featuresFor(itemById.get(comparison.preferredItemId)!).map(feature => feature.key)
      : (comparison.preferredFeatureKeys ?? []).filter(key => /^(genre|decade|type):/.test(key)),
    removed: itemById.has(comparison.removedItemId)
      ? featuresFor(itemById.get(comparison.removedItemId)!).map(feature => feature.key)
      : (comparison.removedFeatureKeys ?? []).filter(key => /^(genre|decade|type):/.test(key)),
  })).filter(comparison => comparison.preferred.length && comparison.removed.length);
  const similarity = (candidate: Set<string>, other: string[]) => {
    const otherSet = new Set(other);
    let intersection = 0;
    let union = 0;
    for (const key of new Set([...candidate, ...otherSet])) {
      const weight = featureWeight(key);
      union += weight;
      if (candidate.has(key) && otherSet.has(key)) intersection += weight;
    }
    return union ? intersection / union : 0;
  };

  const ranked = items
    .map((item, originalIndex) => {
      const features = featuresFor(item);
      const featureKeys = new Set(features.map(feature => feature.key));
      const featureWeight = features.reduce((total, feature) => total + feature.weight, 0);
      const preferenceScore = featureWeight
        ? features.reduce((total, feature) => total + (featureScores.get(feature.key) ?? 0) * feature.weight, 0) / featureWeight
        : 0;
      const relativeReviewScore = comparisons.length
        ? comparisons.reduce((total, comparison) => total + similarity(featureKeys, comparison.preferred) - similarity(featureKeys, comparison.removed), 0) / comparisons.length
        : 0;
      const rank = relatedRanks[item.id];
      const score = preferenceScore + relativeReviewScore * 0.1 + creditBonus(candidateFeatures[item.id] ?? [], credits) + (rank > 0 ? 0.1 * 61 / (60 + rank) : 0);
      return { item, originalIndex, score };
    })
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);

  return { items: ranked.map(entry => entry.item), signalCount };
}


export type RecommendationFeatures = Record<string, string[]>;

/** The outbox may overlap a server read. Each event is replayed exactly once. */
export function mergeRecommendationEvents<T extends RecommendationHistoryEvent>(...groups: T[][]): T[] {
  const byId = new Map<string, T>();
  for (const events of groups) for (const event of events) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => {
    const time = new Date(a.occurredAt ?? 0).getTime() - new Date(b.occurredAt ?? 0).getTime();
    return time || a.sessionId.localeCompare(b.sessionId) || (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id);
  });
}

export function buildRecommendationProfile(events: RecommendationHistoryEvent[], features: RecommendationFeatures, category: string) {
  const history = mergeRecommendationEvents(events).filter(event => event.category === category);
  const signals = recommendationSignalsFromHistory(history, category).map(signal => ({ ...signal, featureKeys: features[signal.itemId] ?? [] }));
  const comparisons = recommendationComparisonsFromHistory(history, category).map(comparison => ({
    ...comparison,
    preferredFeatureKeys: features[comparison.preferredItemId] ?? [],
    removedFeatureKeys: features[comparison.removedItemId] ?? [],
  }));
  return { signals, comparisons, consideredIds: [...new Set(signals.map(signal => signal.itemId))] };
}

/** Pick confident positive retrieval features; a saved title is still only one distinct title. */
export function recommendationRetrievalFeatures(signals: RecommendationSignal[]): string[] {
  const titlesByFeature = new Map<string, Set<string>>();
  for (const signal of signals) for (const key of signal.featureKeys ?? []) {
    const titles = titlesByFeature.get(key) ?? new Set<string>();
    titles.add(signal.itemId);
    titlesByFeature.set(key, titles);
  }
  return recommendationPreferenceProfile(signals)
    .filter(preference => preference.key.startsWith("genre:") && preference.score > 0 && (titlesByFeature.get(preference.key)?.size ?? 0) >= 3)
    .slice(0, 2).map(preference => preference.key);
}

/** Most recently acted-on usable evidence, independent of review-pair expansion order. */
export function recommendationFeatureItemIds(events: RecommendationHistoryEvent[], category: string): string[] {
  const history = mergeRecommendationEvents(events).filter(event => event.category === category);
  const signals = recommendationSignalsFromHistory(history, category);
  const comparisons = recommendationComparisonsFromHistory(history, category);
  const eligible = new Set([...signals.map(signal => signal.itemId), ...comparisons.flatMap(pair => [pair.preferredItemId, pair.removedItemId])]);
  return [...new Set([...history].reverse().flatMap(event => event.itemId && eligible.has(event.itemId) ? [event.itemId] : []))];
}

/** Cached credits count toward the recent-title budget, even when no request is needed. */
export function recentUnresolvedFeatureIds(eligibleIds: string[], resolvedIds: Set<string>, limit = 12): string[] {
  return eligibleIds.slice(0, limit).filter(id => !resolvedIds.has(id));
}

export function shownCandidateIds(itemId: string, remainingIds: string[]): string[] {
  return [itemId, ...remainingIds.filter(id => id !== itemId)].slice(0, 100);
}


export function relatedShowSeeds(events: RecommendationHistoryEvent[]) {
  const rows = mergeRecommendationEvents(events).filter(event => event.category === "Shows");
  const undone = new Set(rows.filter(event => event.eventType === "decision_undone").map(event => event.targetEventId));
  const latestRating = new Map<string, number>();
  for (const event of rows) if (event.itemId && event.eventType === "decision" && event.decision === "seen" && event.rating != null && !undone.has(event.id)) latestRating.set(event.itemId, event.algorithmVersion === "content-v3" ? event.rating * 2 : event.rating);
  const rated: Array<{ itemId: string; eventId: string }> = [], saved: Array<{ itemId: string; eventId: string }> = [];
  for (const event of [...rows].reverse()) {
    if (!event.itemId || !/^tmdb-tv-[1-9]\d*$/.test(event.itemId) || (latestRating.get(event.itemId) ?? 10) <= 5) continue;
    if (event.eventType === "decision" && event.decision === "seen" && !undone.has(event.id) && (latestRating.get(event.itemId) ?? 0) >= 8 && (event.algorithmVersion === "content-v3" ? (event.rating ?? 0) * 2 : event.rating ?? 0) === latestRating.get(event.itemId)) rated.push({ itemId: event.itemId, eventId: event.id });
    if (event.eventType === "saved" && !(event.targetEventId && undone.has(event.targetEventId))) saved.push({ itemId: event.itemId, eventId: event.id });
  }
  const selected: Array<{ itemId: string; eventId: string }> = [];
  const distinctSaved = saved.find(seed => seed.itemId !== rated[0]?.itemId);
  for (const seed of [rated[0], distinctSaved ?? saved[0], ...rated, ...saved]) if (seed && !selected.some(existing => existing.itemId === seed.itemId) && selected.length < 2) selected.push(seed);
  return selected;
}
