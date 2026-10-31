-- Profile reads filter by event type; this lets them skip trace rows instead of scanning them.
-- CreateIndex
CREATE INDEX "RecommendationEvent_userId_category_eventType_occurredAt_idx" ON "RecommendationEvent"("userId", "category", "eventType", "occurredAt");
