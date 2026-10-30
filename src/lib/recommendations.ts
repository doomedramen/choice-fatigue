import type { MediaItem } from "@/data";

export type RecommendationDecision = "keep" | "pass";

export const recommendationWeights: Record<RecommendationDecision, number> = {
  keep: 1,
  pass: -0.5,
};

interface GenreEvidence {
  total: number;
  count: number;
}

function genreKey(genre: string) {
  return genre.trim().toLowerCase();
}

/** Rank one category using only explicit choices made in the current session. */
export function rankSessionRecommendations(
  items: MediaItem[],
  decisions: Record<string, RecommendationDecision | undefined>,
) {
  const genreEvidence = new Map<string, GenreEvidence>();
  let signalCount = 0;

  for (const item of items) {
    const decision = decisions[item.id];
    if (!decision) continue;

    signalCount += 1;
    const weight = recommendationWeights[decision];
    for (const genre of new Set(item.genre.map(genreKey).filter(Boolean))) {
      const evidence = genreEvidence.get(genre) ?? { total: 0, count: 0 };
      evidence.total += weight;
      evidence.count += 1;
      genreEvidence.set(genre, evidence);
    }
  }

  const genreScores = new Map(
    [...genreEvidence].map(([genre, evidence]) => [genre, evidence.total / evidence.count]),
  );

  const ranked = items
    .map((item, originalIndex) => {
      const genres = [...new Set(item.genre.map(genreKey).filter(Boolean))];
      const score = genres.length
        ? genres.reduce((total, genre) => total + (genreScores.get(genre) ?? 0), 0) / genres.length
        : 0;
      return { item, originalIndex, score };
    })
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);

  return { items: ranked.map(entry => entry.item), signalCount };
}
