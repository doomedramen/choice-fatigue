ALTER TABLE "RecommendationEvent" ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "retrievalId" TEXT, ADD COLUMN "source" TEXT, ADD COLUMN "lane" TEXT;
DROP INDEX "RecommendationEvent_userId_category_createdAt_idx";
CREATE INDEX "RecommendationEvent_userId_category_occurredAt_idx" ON "RecommendationEvent"("userId", "category", "occurredAt");

-- Development-only contract replacement. Retain saved provider IDs as retention evidence.
DELETE FROM "RecommendationEvent";
INSERT INTO "RecommendationEvent" ("id", "userId", "sessionId", "sequence", "itemId", "category", "eventType", "algorithmVersion")
SELECT 'saved-seed-' || md5(d."userId" || ':' || s.id), d."userId", 'saved-seed', s.ordinality::integer,
  s.id, CASE WHEN s.id ~ '^tmdb-movie-[1-9][0-9]{0,9}$' THEN 'Movies'
             WHEN s.id ~ '^tmdb-tv-[1-9][0-9]{0,9}$' THEN 'Shows' ELSE 'Adult' END,
  'saved', 'content-v3'
FROM "DiscoveryState" d CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(d.state->'saved', '[]'::jsonb)) WITH ORDINALITY s(id, ordinality)
WHERE s.id ~ '^(tmdb-(movie|tv)-[1-9][0-9]{0,9}|theporndb-(scene|movie)-[A-Za-z0-9][A-Za-z0-9_-]{0,127}|stashdb-[A-Za-z0-9][A-Za-z0-9_-]{0,159})$'
ON CONFLICT DO NOTHING;
UPDATE "DiscoveryState" SET state = jsonb_build_object(
  'category', COALESCE(state->>'category', 'Movies'), 'lockedItemId', NULL,
  'decisions', '{}'::jsonb, 'ratings', '{}'::jsonb, 'shortlisted', '[]'::jsonb,
  'saved', COALESCE(state->'saved', '[]'::jsonb), 'history', '[]'::jsonb,
  'reviewRemoved', '[]'::jsonb, 'view', 'discover', 'ageVerified', COALESCE((state->>'ageVerified')::boolean, false)
), revision = revision + 1;
