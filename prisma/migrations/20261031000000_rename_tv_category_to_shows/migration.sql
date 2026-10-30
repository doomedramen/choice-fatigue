UPDATE "CatalogueEntry"
SET "category" = 'Shows'
WHERE "category" = 'TV';

UPDATE "CatalogueEntry"
SET "type" = 'Series'
WHERE "category" = 'Shows' AND "type" = 'TV series';

UPDATE "GlobalSettings"
SET "defaultCategory" = 'Shows'
WHERE "defaultCategory" = 'TV';

UPDATE "DiscoveryState"
SET "state" = jsonb_set("state", '{category}', '"Shows"'::jsonb)
WHERE "state"->>'category' = 'TV';
