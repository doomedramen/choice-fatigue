import "server-only";
import { prisma } from "@/lib/prisma";
import {
  decryptMetadataProviderConfig,
  encryptMetadataProviderConfig,
  isIntegrationEncryptionConfigured,
  type MetadataProviderConfig,
} from "@/lib/integrations/crypto";

export const adultMetadataProviders = ["theporndb", "stashdb"] as const;
export type AdultMetadataProvider = (typeof adultMetadataProviders)[number];

export class AdultMetadataProviderConfigurationError extends Error {}
export class AdultMetadataProviderNotEnabledError extends Error {}

export interface AdultMetadataProviderStatus {
  credentialConfigured: boolean;
  enabled: boolean;
  encryptionConfigured: boolean;
}

export async function getAdultMetadataProviderStatus(provider: AdultMetadataProvider): Promise<AdultMetadataProviderStatus> {
  const [row, encryptionConfigured] = await Promise.all([
    prisma.metadataProviderCredential.findUnique({ where: { provider } }),
    Promise.resolve(isIntegrationEncryptionConfigured()),
  ]);
  let credentialConfigured = false;
  if (row && encryptionConfigured) {
    try { credentialConfigured = Boolean(decryptMetadataProviderConfig(row.encryptedConfig, provider).apiKey); }
    catch { credentialConfigured = false; }
  }
  return { credentialConfigured, enabled: Boolean(row?.enabled && credentialConfigured), encryptionConfigured };
}

export async function getEnabledAdultMetadataProviderConfig(provider: AdultMetadataProvider): Promise<MetadataProviderConfig> {
  const row = await prisma.metadataProviderCredential.findUnique({ where: { provider } });
  if (!row?.enabled) throw new AdultMetadataProviderNotEnabledError();
  try {
    const config = decryptMetadataProviderConfig(row.encryptedConfig, provider);
    if (!config.apiKey) throw new AdultMetadataProviderNotEnabledError();
    return config;
  } catch (error) {
    if (error instanceof AdultMetadataProviderNotEnabledError) throw error;
    throw new AdultMetadataProviderConfigurationError();
  }
}

export async function saveAdultMetadataProviderConfig(provider: AdultMetadataProvider, input: { apiKey: string; enabled: boolean }) {
  if (!isIntegrationEncryptionConfigured()) throw new AdultMetadataProviderConfigurationError("Credential encryption is unavailable. Check secure server storage and try again.");

  const existing = await prisma.metadataProviderCredential.findUnique({ where: { provider } });
  let previous: MetadataProviderConfig = { apiKey: "", subscriberPin: "" };
  if (existing) {
    try { previous = decryptMetadataProviderConfig(existing.encryptedConfig, provider); }
    catch { throw new AdultMetadataProviderConfigurationError("The saved credential could not be read. Re-enter the key to replace it."); }
  }
  const config = { apiKey: input.apiKey.trim() || previous.apiKey, subscriberPin: "" };
  if (input.enabled && !config.apiKey) throw new AdultMetadataProviderConfigurationError("Enter an API key before enabling this metadata source.");

  if (!config.apiKey && !input.enabled) {
    if (existing) await prisma.metadataProviderCredential.delete({ where: { provider } });
    return getAdultMetadataProviderStatus(provider);
  }

  const encryptedConfig = encryptMetadataProviderConfig(config, provider);
  await prisma.metadataProviderCredential.upsert({
    where: { provider },
    create: { provider, encryptedConfig, enabled: input.enabled },
    update: { encryptedConfig, enabled: input.enabled },
  });
  return getAdultMetadataProviderStatus(provider);
}
