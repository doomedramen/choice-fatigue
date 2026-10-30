import "server-only";
import { prisma } from "@/lib/prisma";
import {
  decryptMetadataProviderConfig,
  encryptMetadataProviderConfig,
  IntegrationEncryptionUnavailableError,
  isIntegrationEncryptionConfigured,
  type MetadataProviderConfig,
} from "@/lib/integrations/crypto";

const PROVIDER = "tvdb";

export class TvdbConfigurationError extends Error {}
export class TvdbNotEnabledError extends Error {}

export interface TvdbProviderStatus {
  credentialConfigured: boolean;
  pinConfigured: boolean;
  enabled: boolean;
  encryptionConfigured: boolean;
}

export async function getTvdbProviderStatus(): Promise<TvdbProviderStatus> {
  const [row, encryptionConfigured] = await Promise.all([
    prisma.metadataProviderCredential.findUnique({ where: { provider: PROVIDER } }),
    Promise.resolve(isIntegrationEncryptionConfigured()),
  ]);

  let pinConfigured = false;
  let credentialReadable = false;
  if (row && encryptionConfigured) {
    try {
      const credentials = decryptMetadataProviderConfig(row.encryptedConfig, PROVIDER);
      credentialReadable = Boolean(credentials.apiKey);
      pinConfigured = Boolean(credentials.subscriberPin);
    } catch {
      credentialReadable = false;
    }
  }

  return {
    credentialConfigured: Boolean(row && credentialReadable),
    pinConfigured,
    enabled: Boolean(row?.enabled && credentialReadable),
    encryptionConfigured,
  };
}

export async function getEnabledTvdbConfig(): Promise<MetadataProviderConfig & { updatedAt: Date }> {
  const row = await prisma.metadataProviderCredential.findUnique({ where: { provider: PROVIDER } });
  if (!row?.enabled) throw new TvdbNotEnabledError();
  try {
    return { ...decryptMetadataProviderConfig(row.encryptedConfig, PROVIDER), updatedAt: row.updatedAt };
  } catch (error) {
    if (error instanceof IntegrationEncryptionUnavailableError) throw new TvdbConfigurationError();
    throw new TvdbConfigurationError();
  }
}

export async function saveTvdbProviderConfig(input: {
  apiKey: string;
  subscriberPin: string;
  clearPin: boolean;
  enabled: boolean;
}) {
  if (!isIntegrationEncryptionConfigured()) throw new TvdbConfigurationError();

  const existing = await prisma.metadataProviderCredential.findUnique({ where: { provider: PROVIDER } });
  let previous: MetadataProviderConfig = { apiKey: "", subscriberPin: "" };
  if (existing) {
    try {
      previous = decryptMetadataProviderConfig(existing.encryptedConfig, PROVIDER);
    } catch {
      throw new TvdbConfigurationError();
    }
  }

  const credentials = {
    apiKey: input.apiKey.trim() || previous.apiKey,
    subscriberPin: input.clearPin ? "" : input.subscriberPin.trim() || previous.subscriberPin,
  };
  if (!credentials.apiKey) throw new TvdbConfigurationError("Enter a TheTVDB project API key.");

  const encryptedConfig = encryptMetadataProviderConfig(credentials, PROVIDER);
  await prisma.metadataProviderCredential.upsert({
    where: { provider: PROVIDER },
    create: { provider: PROVIDER, encryptedConfig, enabled: input.enabled },
    update: { encryptedConfig, enabled: input.enabled },
  });
  return getTvdbProviderStatus();
}

export async function removeTvdbProviderConfig() {
  await prisma.metadataProviderCredential.deleteMany({ where: { provider: PROVIDER } });
  return getTvdbProviderStatus();
}
