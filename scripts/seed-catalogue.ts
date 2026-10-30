import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { media } from "../src/data";

const databaseURL = process.env.DATABASE_URL;

if (!databaseURL) {
  throw new Error("DATABASE_URL is required. Set it in .env before seeding the catalogue.");
}

async function seedCatalogue() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });

  try {
    for (const [displayOrder, item] of media.entries()) {
      const source = "local";
      const sourceId = item.id;
      const contentFlags = item.category === "Adult" ? ["mature"] : [];
      const content = {
        title: item.title,
        category: item.category,
        year: item.year,
        type: item.type,
        runtime: item.runtime,
        rating: Number(item.rating),
        genres: item.genre,
        synopsis: item.synopsis,
        palette: [...item.palette],
        art: item.art,
        label: item.label,
        artworkUrl: null,
        ageRestriction: item.age ?? null,
        contentFlags,
      };

      await prisma.catalogueEntry.upsert({
        where: { source_sourceId: { source, sourceId } },
        create: {
          id: item.id,
          source,
          sourceId,
          ...content,
          active: true,
          displayOrder,
        },
        // Keep admin-managed visibility and ordering when fixture metadata is refreshed.
        update: content,
      });
    }

    console.info(`Seeded ${media.length} local catalogue entries.`);
  } finally {
    await prisma.$disconnect();
  }
}

void seedCatalogue().catch(error => {
  console.error("Catalogue seeding failed.", error);
  process.exitCode = 1;
});
