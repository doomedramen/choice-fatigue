import type { MediaItem } from "@/data";

export type RecommendationDecision = "keep" | "pass" | "seen";
export interface RecommendationSignal { itemId: string; decision: RecommendationDecision; rating?: number; weight?: number; featureKeys?: string[] }
export interface RecommendationComparison { preferredItemId: string; removedItemId: string; preferredFeatureKeys?: string[]; removedFeatureKeys?: string[] }
export interface RecommendationHistoryEvent {
  id: string; sessionId: string; reviewId?: string | null; itemId: string | null; eventType: string;
  decision: string | null; rating: number | null; targetEventId: string | null; category?: string;
}

export function recommendationComparisonsFromHistory(events: RecommendationHistoryEvent[], excludeSessionId?: string | null, category?: string): Array<Pick<RecommendationComparison, "preferredItemId" | "removedItemId">> {
  const reviews = new Map<string, { removed: Map<string, boolean>; saved: Set<string> }>();
  for (const event of events) {
    if ((excludeSessionId && event.sessionId === excludeSessionId) || (category && event.category !== category) || !event.reviewId) continue;
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

export function recommendationSignalsFromHistory(events: RecommendationHistoryEvent[], excludeSessionId?: string | null, category?: string): RecommendationSignal[] {
  const history = events.filter(event => (!excludeSessionId || event.sessionId !== excludeSessionId) && (!category || event.category === category));
  const withdrawn = new Set(history
    .filter(event => event.eventType === "decision_undone")
    .map(event => event.targetEventId)
    .filter((id): id is string => Boolean(id)));
  // Review removal changes the shortlist, but does not erase the original first-impression signal.
  const decisions = history
    .filter(event => event.eventType === "decision" && event.itemId && (event.decision === "keep" || event.decision === "pass" || event.decision === "seen") && !withdrawn.has(event.id))
    .map(event => ({ itemId: event.itemId!, decision: event.decision as RecommendationDecision, rating: event.rating ?? undefined }));
  const savedItemIds = new Set(history.filter(event => event.eventType === "saved" && event.itemId).map(event => event.itemId!));
  const retention = [...savedItemIds].map(itemId => ({ itemId, decision: "keep" as const, weight: 1.5 }));
  return [...decisions, ...retention];
}

export const recommendationWeights: Record<Exclude<RecommendationDecision, "seen">, number> = {
  keep: 1,
  pass: -0.5,
};

/** A 1–5 star review is explicit preference evidence, centered on neutral. */
export const reviewRatingWeights: Record<number, number> = {
  1: -0.5,
  2: -0.25,
  3: 0,
  4: 0.5,
  5: 1,
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

/** Rank one category using only explicit choices made in the current session. */
export function rankSessionRecommendations(
  items: MediaItem[],
  decisions: Record<string, RecommendationDecision | undefined>,
  ratings: Record<string, number | undefined> = {},
  historicalSignals: RecommendationSignal[] = [],
  historicalComparisons: RecommendationComparison[] = [],
) {
  const featureEvidence = new Map<string, FeatureEvidence>();
  let signalCount = 0;

  for (const item of items) {
    const decision = decisions[item.id];
    if (!decision) continue;

    const weight = decision === "seen"
      ? reviewRatingWeights[ratings[item.id] ?? 0]
      : recommendationWeights[decision];
    if (weight === undefined) continue;

    signalCount += 1;
    for (const feature of featuresFor(item)) {
      const evidence = featureEvidence.get(feature.key) ?? { total: 0, count: 0 };
      evidence.total += weight;
      evidence.count += 1;
      featureEvidence.set(feature.key, evidence);
    }
  }

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

  const neutralPriorStrength = 2;
  const featureScores = new Map([...featureEvidence].map(([feature, evidence]) => [
    feature,
    evidence.total / (evidence.count + neutralPriorStrength),
  ]));

  const comparisons = historicalComparisons.map(comparison => ({
    preferred: itemById.has(comparison.preferredItemId)
      ? featuresFor(itemById.get(comparison.preferredItemId)!).map(feature => feature.key)
      : comparison.preferredFeatureKeys ?? [],
    removed: itemById.has(comparison.removedItemId)
      ? featuresFor(itemById.get(comparison.removedItemId)!).map(feature => feature.key)
      : comparison.removedFeatureKeys ?? [],
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
      const score = preferenceScore + relativeReviewScore * 0.1;
      return { item, originalIndex, score };
    })
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);

  return { items: ranked.map(entry => entry.item), signalCount };
}
