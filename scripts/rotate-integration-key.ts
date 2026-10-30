import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  decryptApplicationSecret,
  decryptIntegrationConfig,
  decryptMetadataProviderConfig,
  encryptApplicationSecret,
  encryptIntegrationConfig,
  encryptMetadataProviderConfig,
  parseIntegrationEncryptionKey,
  adminIntegrationEncryptionContext,
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
    const adminIntegrations = await prisma.adminServiceIntegration.findMany({
      select: { id: true, encryptedConfig: true },
    });
    const metadataCredentials = await prisma.metadataProviderCredential.findMany({
      select: { provider: true, encryptedConfig: true },
    });
    const globalSettings = await prisma.globalSettings.findUnique({
      where: { id: "global" },
      select: { encryptedSmtpUrl: true },
    });

    const integrationUpdates = integrations.map(integration => {
      const context = integrationEncryptionContext(integration.userId, integration.id);
      const config = decryptIntegrationConfig(integration.encryptedConfig, context, oldKey);
      return {
        id: integration.id,
        encryptedConfig: encryptIntegrationConfig(config, context, newKey),
      };
    });
    const adminIntegrationUpdates = adminIntegrations.map(integration => {
      const context = adminIntegrationEncryptionContext(integration.id);
      const config = decryptIntegrationConfig(integration.encryptedConfig, context, oldKey);
      return {
        id: integration.id,
        encryptedConfig: encryptIntegrationConfig(config, context, newKey),
      };
    });
    const metadataUpdates = metadataCredentials.map(provider => ({
      provider: provider.provider,
      encryptedConfig: encryptMetadataProviderConfig(
        decryptMetadataProviderConfig(provider.encryptedConfig, provider.provider, oldKey),
        provider.provider,
        newKey,
      ),
    }));
    const encryptedSmtpUrl = globalSettings?.encryptedSmtpUrl
      ? encryptApplicationSecret(decryptApplicationSecret(globalSettings.encryptedSmtpUrl, "smtp-url", oldKey), "smtp-url", newKey)
      : null;

    await prisma.$transaction(async transaction => {
      for (const update of integrationUpdates) {
        await transaction.userIntegration.update({
          where: { id: update.id },
          data: { encryptedConfig: update.encryptedConfig },
        });
      }
      for (const update of adminIntegrationUpdates) {
        await transaction.adminServiceIntegration.update({
          where: { id: update.id },
          data: { encryptedConfig: update.encryptedConfig },
        });
      }
      for (const update of metadataUpdates) {
        await transaction.metadataProviderCredential.update({
          where: { provider: update.provider },
          data: { encryptedConfig: update.encryptedConfig },
        });
      }
      if (encryptedSmtpUrl) {
        await transaction.globalSettings.update({
          where: { id: "global" },
          data: { encryptedSmtpUrl },
        });
      }
    });
    const total = integrationUpdates.length + adminIntegrationUpdates.length + metadataUpdates.length + Number(Boolean(encryptedSmtpUrl));
    console.info(`Rotated encryption for ${total} saved credential${total === 1 ? "" : "s"}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void rotateIntegrationKey().catch(error => {
  console.error("Integration credential key rotation failed.", error instanceof Error ? error.message : "Unknown error.");
  process.exitCode = 1;
});
