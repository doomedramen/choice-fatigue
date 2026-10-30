import type { MediaItem } from "@/data";

export type RecommendationDecision = "keep" | "pass" | "seen";

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

interface FeatureEvidence {
  total: number;
  count: number;
}

interface ItemFeature {
  key: string;
  weight: number;
}

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function featuresFor(item: MediaItem): ItemFeature[] {
  const genres = [...new Set(item.genre.map(normalized).filter(Boolean))]
    .map(genre => ({ key: `genre:${genre}`, weight: 1 }));
  const decade = typeof item.year === "number" ? Math.floor(item.year / 10) * 10 : null;
  const type = normalized(item.type);

  return [
    ...genres,
    ...(decade === null ? [] : [{ key: `decade:${decade}`, weight: 0.25 }]),
    ...(type && type !== "title" ? [{ key: `type:${type}`, weight: 0.25 }] : []),
  ];
}

function ratingPrior(rating: string) {
  const parsed = Number.parseFloat(rating);
  if (!Number.isFinite(parsed)) return 0;
  const normalizedRating = Math.min(10, Math.max(0, parsed)) / 10;
  return (normalizedRating - 0.5) * 0.1;
}

/** Rank one category using only explicit choices made in the current session. */
export function rankSessionRecommendations(
  items: MediaItem[],
  decisions: Record<string, RecommendationDecision | undefined>,
  ratings: Record<string, number | undefined> = {},
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

  const featureScores = new Map(
    [...featureEvidence].map(([feature, evidence]) => [feature, evidence.total / evidence.count]),
  );

  const ranked = items
    .map((item, originalIndex) => {
      const features = featuresFor(item);
      const featureWeight = features.reduce((total, feature) => total + feature.weight, 0);
      const preferenceScore = featureWeight
        ? features.reduce((total, feature) => total + (featureScores.get(feature.key) ?? 0) * feature.weight, 0) / featureWeight
        : 0;
      const score = preferenceScore + ratingPrior(item.rating);
      return { item, originalIndex, score };
    })
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);

  return { items: ranked.map(entry => entry.item), signalCount };
}
