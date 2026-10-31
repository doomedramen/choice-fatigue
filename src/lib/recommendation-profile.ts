import "server-only";
import { prisma } from "@/lib/prisma";
import { buildRecommendationProfile, recommendationFeatureItemIds, recommendationRetrievalFeatures, recentUnresolvedFeatureIds, type RecommendationFeatures } from "@/lib/recommendations";
import { creditPreferences } from "@/lib/credit-features";
import { parseProviderTitleId } from "@/lib/media-provider-id";
import { getTmdbCreditFeatures, getTmdbRecommendationFeatures } from "@/lib/providers/tmdb";
import { getThePornDBRecommendationFeatures } from "@/lib/providers/theporndb";
import { getStashDbRecommendationMetadata } from "@/lib/providers/stashdb";
import type { RecommendationCategory, RecommendationEventInput } from "@/lib/recommendation-event-validation";
import { recommendationConsideredBeforeQuery, recommendationProfileHistoryLimit, recommendationProfileQuery } from "@/lib/recommendation-profile-query";

/**
 * The caller must authorize Adult access before entering this function.
 * `knownFeatureIds` are titles whose features the caller already holds or already tried to fetch;
 * they still count toward the recent-title budget but are not requested again.
 */
export async function loadRecommendationProfile(userId: string, category: RecommendationCategory, knownFeatureIds: string[] = [], hydrate = true) {
  const rows = (await prisma.recommendationEvent.findMany(recommendationProfileQuery(userId, category))).reverse();
  // Only a full window can have older history; its titles stay excluded from the deck without training it.
  const olderConsideredIds = rows.length >= recommendationProfileHistoryLimit
    ? (await prisma.recommendationEvent.findMany(recommendationConsideredBeforeQuery(userId, category, rows[0].occurredAt))).flatMap(row => row.itemId ? [row.itemId] : [])
    : [];
  const events: RecommendationEventInput[] = rows.map(row => ({
    id: row.id, sessionId: row.sessionId, reviewId: row.reviewId, sequence: row.sequence, itemId: row.itemId,
    candidateIds: null, category, eventType: row.eventType as RecommendationEventInput["eventType"],
    decision: row.decision as RecommendationEventInput["decision"], rating: row.rating, targetEventId: row.targetEventId,
    algorithmVersion: row.algorithmVersion as RecommendationEventInput["algorithmVersion"], occurredAt: row.occurredAt.toISOString(),
    provenance: null, retrievalId: null, source: null, lane: null,
  }));
  const known = new Set(knownFeatureIds);
  const eligibleIds = recommendationFeatureItemIds(events, category);
  const unresolvedIds = eligibleIds.filter(id => !known.has(id));
  // Reuse only within the same recent-history window; cached titles must not expand the budget.
  const requestedIds = hydrate ? recentUnresolvedFeatureIds(eligibleIds, known) : [];
  const featuresByItemId: RecommendationFeatures = {};
  let creditRequested = 0, creditResolved = 0;
  const resolvedCreditItemIds: string[] = [];
  const requestedCreditItemIds: string[] = [];
  const stashTags: Record<string, string> = {};
  for (let index = 0; index < requestedIds.length; index += 4) {
    await Promise.all(requestedIds.slice(index, index + 4).map(async id => {
      try {
        const reference = parseProviderTitleId(id);
        if (!reference || reference.category !== category) return;
        if (reference.provider === "tmdb") {
          creditRequested += 1;
          requestedCreditItemIds.push(id);
          try { featuresByItemId[id] = await getTmdbCreditFeatures(reference.mediaType, reference.sourceId); creditResolved += 1; resolvedCreditItemIds.push(id); }
          catch { featuresByItemId[id] = await getTmdbRecommendationFeatures(reference.mediaType, reference.sourceId); }
        }
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
    coverage: { eligible: unresolvedIds.length, requested: requestedIds.length, resolved: Object.keys(featuresByItemId).length, omittedByLimit: Math.max(0, unresolvedIds.length - requestedIds.length) },
    creditCoverage: { requested: creditRequested, resolved: creditResolved }, resolvedCreditItemIds, requestedCreditItemIds,
    // Successful or not, these were tried; callers pass them back so a failing title is not refetched on every read.
    attemptedFeatureItemIds: requestedIds,
    olderConsideredIds,
    creditFeatures: creditPreferences(profile.signals).filter(feature => feature.positiveTitles >= 2 && feature.score > 0),
    retrievalFeatures, stashTagIds: retrievalFeatures.flatMap(key => stashTags[key] ? [stashTags[key]] : []),
  };
}
