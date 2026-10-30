export type RankingMetrics = { sessions: number; labeledSessions: number; relevantItems: number; meanReciprocalRank: number | null; recallAt5: number | null; recallAt10: number | null };

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
  let labeledSessions = 0;
  let relevantItems = 0;
  let reciprocalRankTotal = 0;
  let recall5Total = 0;
  let recall10Total = 0;
  for (let index = 0; index < rankings.length; index += 1) {
    const relevant = new Set(relevantBySession[index].filter(id => rankings[index].includes(id)));
    if (!relevant.size) continue;
    labeledSessions += 1;
    relevantItems += relevant.size;
    const firstRank = Math.min(...[...relevant].map(id => rankings[index].indexOf(id) + 1));
    reciprocalRankTotal += 1 / firstRank;
    recall5Total += [...relevant].filter(id => rankings[index].indexOf(id) < 5).length / relevant.size;
    recall10Total += [...relevant].filter(id => rankings[index].indexOf(id) < 10).length / relevant.size;
  }
  return {
    sessions: rankings.length,
    labeledSessions,
    relevantItems,
    meanReciprocalRank: labeledSessions ? Number((reciprocalRankTotal / labeledSessions).toFixed(4)) : null,
    recallAt5: labeledSessions ? Number((recall5Total / labeledSessions).toFixed(4)) : null,
    recallAt10: labeledSessions ? Number((recall10Total / labeledSessions).toFixed(4)) : null,
  };
}

/** Compare two fixed rankings against observed shortlist/save labels within each traced candidate set. */
export function compareSessionRankings(input: Array<{ providerOrder: string[]; rankerOrder: string[]; shortlisted: string[]; saved: string[] }>) {
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
