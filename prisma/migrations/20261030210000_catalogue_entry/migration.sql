-- CreateTable
CREATE TABLE "CatalogueEntry" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'local',
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "year" INTEGER,
    "type" TEXT,
    "runtime" TEXT,
    "rating" DOUBLE PRECISION,
    "genres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "synopsis" TEXT,
    "palette" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "art" TEXT,
    "label" TEXT,
    "artworkUrl" TEXT,
    "ageRestriction" INTEGER,
    "contentFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueEntry_source_sourceId_key" ON "CatalogueEntry"("source", "sourceId");

-- CreateIndex
CREATE INDEX "CatalogueEntry_category_active_displayOrder_idx" ON "CatalogueEntry"("category", "active", "displayOrder");
