import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  decryptIntegrationConfig,
  encryptIntegrationConfig,
  parseIntegrationEncryptionKey,
  integrationEncryptionContext,
} from "../src/lib/integrations/crypto";

const databaseURL = process.env.DATABASE_URL;
const oldKey = process.env.INTEGRATION_CREDENTIALS_OLD_KEY;
const newKey = process.env.INTEGRATION_CREDENTIALS_KEY;

if (!databaseURL) throw new Error("DATABASE_URL is required to rotate integration credentials.");
if (!oldKey || !newKey) throw new Error("Set INTEGRATION_CREDENTIALS_OLD_KEY and INTEGRATION_CREDENTIALS_KEY before rotating.");

const oldKeyBytes = parseIntegrationEncryptionKey(oldKey);
const newKeyBytes = parseIntegrationEncryptionKey(newKey);
if (oldKeyBytes.equals(newKeyBytes)) throw new Error("The old and new integration encryption keys must be different.");

async function rotateIntegrationKey() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
  try {
    const integrations = await prisma.userIntegration.findMany({
      select: { id: true, userId: true, encryptedConfig: true },
    });
    const updates = integrations.map(integration => {
      const context = integrationEncryptionContext(integration.userId, integration.id);
      const config = decryptIntegrationConfig(integration.encryptedConfig, context, oldKey);
      return {
        id: integration.id,
        encryptedConfig: encryptIntegrationConfig(config, context, newKey),
      };
    });

    await prisma.$transaction(async transaction => {
      for (const update of updates) {
        await transaction.userIntegration.update({
          where: { id: update.id },
          data: { encryptedConfig: update.encryptedConfig },
        });
      }
    });
    console.info(`Rotated encryption for ${updates.length} saved integration${updates.length === 1 ? "" : "s"}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void rotateIntegrationKey().catch(error => {
  console.error("Integration credential key rotation failed.", error instanceof Error ? error.message : "Unknown error.");
  process.exitCode = 1;
});
