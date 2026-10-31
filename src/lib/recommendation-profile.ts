import "server-only";
import { prisma } from "@/lib/prisma";
import { buildRecommendationProfile, recommendationFeatureItemIds, recommendationRetrievalFeatures, type RecommendationFeatures } from "@/lib/recommendations";
import { parseProviderTitleId } from "@/lib/media-provider-id";
import { getTmdbRecommendationFeatures } from "@/lib/providers/tmdb";
import { getThePornDBRecommendationFeatures } from "@/lib/providers/theporndb";
import { getStashDbRecommendationMetadata } from "@/lib/providers/stashdb";
import type { RecommendationCategory, RecommendationEventInput } from "@/lib/recommendation-event-validation";

/** The caller must authorize Adult access before entering this function. */
export async function loadRecommendationProfile(userId: string, category: RecommendationCategory, candidateIds: string[] = []) {
  const rows = await prisma.recommendationEvent.findMany({
    where: { userId, category, algorithmVersion: { in: ["content-v3", "content-v4"] } },
    orderBy: [{ occurredAt: "asc" }, { sessionId: "asc" }, { sequence: "asc" }, { id: "asc" }],
  });
  const events: RecommendationEventInput[] = rows.map(row => ({
    id: row.id, sessionId: row.sessionId, reviewId: row.reviewId, sequence: row.sequence, itemId: row.itemId,
    candidateIds: row.candidateIds as string[] | null, category, eventType: row.eventType as RecommendationEventInput["eventType"],
    decision: row.decision as RecommendationEventInput["decision"], rating: row.rating, targetEventId: row.targetEventId,
    algorithmVersion: row.algorithmVersion as RecommendationEventInput["algorithmVersion"], occurredAt: row.occurredAt.toISOString(),
    retrievalId: row.retrievalId, source: row.source as RecommendationEventInput["source"], lane: row.lane as RecommendationEventInput["lane"],
  }));
  const known = new Set(candidateIds);
  const eligibleIds = recommendationFeatureItemIds(events, category).filter(id => !known.has(id));
  const requestedIds = eligibleIds.slice(0, 12);
  const featuresByItemId: RecommendationFeatures = {};
  const stashTags: Record<string, string> = {};
  for (let index = 0; index < requestedIds.length; index += 4) {
    await Promise.all(requestedIds.slice(index, index + 4).map(async id => {
      try {
        const reference = parseProviderTitleId(id);
        if (!reference || reference.category !== category) return;
        if (reference.provider === "tmdb") featuresByItemId[id] = await getTmdbRecommendationFeatures(reference.mediaType, reference.sourceId);
        else if (reference.provider === "theporndb") featuresByItemId[id] = await getThePornDBRecommendationFeatures(reference.kind, reference.sourceId);
        else {
          const metadata = await getStashDbRecommendationMetadata(reference.sourceId);
          featuresByItemId[id] = metadata.featureKeys;
          Object.assign(stashTags, metadata.retrievalTags);
        }
      } catch { /* Failed metadata stays distinguishable from neutral evidence in coverage. */ }
    }));
  }
  const profile = buildRecommendationProfile(events, featuresByItemId, category);
  const retrievalFeatures = recommendationRetrievalFeatures(profile.signals);
  return {
    events, featuresByItemId,
    coverage: { eligible: eligibleIds.length, requested: requestedIds.length, resolved: Object.keys(featuresByItemId).length, omittedByLimit: Math.max(0, eligibleIds.length - requestedIds.length) },
    retrievalFeatures, stashTagIds: retrievalFeatures.flatMap(key => stashTags[key] ? [stashTags[key]] : []),
  };
}
