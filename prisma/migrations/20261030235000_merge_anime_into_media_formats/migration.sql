UPDATE "CatalogueEntry"
SET "category" = CASE
    WHEN "sourceId" LIKE 'movie:%' OR "type" = 'Movie' THEN 'Movies'
    ELSE 'TV'
END
WHERE "category" = 'Anime';

UPDATE "GlobalSettings"
SET "defaultCategory" = 'TV'
WHERE "defaultCategory" = 'Anime';

UPDATE "DiscoveryState"
SET "state" = jsonb_set("state", '{category}', '"TV"'::jsonb)
WHERE "state"->>'category' = 'Anime';
