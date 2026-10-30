ALTER TABLE "User" ADD COLUMN "adultAllowed" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "RecommendationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "reviewId" TEXT,
    "sequence" INTEGER NOT NULL,
    "itemId" TEXT,
    "category" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "decision" TEXT,
    "rating" INTEGER,
    "targetEventId" TEXT,
    "algorithmVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecommendationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RecommendationEvent_userId_category_createdAt_idx" ON "RecommendationEvent"("userId", "category", "createdAt");
CREATE INDEX "RecommendationEvent_userId_sessionId_sequence_idx" ON "RecommendationEvent"("userId", "sessionId", "sequence");
CREATE INDEX "RecommendationEvent_userId_targetEventId_idx" ON "RecommendationEvent"("userId", "targetEventId");
