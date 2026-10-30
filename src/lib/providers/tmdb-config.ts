import "server-only";
import { prisma } from "@/lib/prisma";
import {
  decryptMetadataProviderConfig,
  encryptMetadataProviderConfig,
  isIntegrationEncryptionConfigured,
  type MetadataProviderConfig,
} from "@/lib/integrations/crypto";

const PROVIDER = "tmdb";

export class TmdbConfigurationError extends Error {}
export class TmdbNotEnabledError extends Error {}

export interface TmdbProviderStatus {
  credentialConfigured: boolean;
  enabled: boolean;
  encryptionConfigured: boolean;
}

export async function getTmdbProviderStatus(): Promise<TmdbProviderStatus> {
  const [row, encryptionConfigured] = await Promise.all([
    prisma.metadataProviderCredential.findUnique({ where: { provider: PROVIDER } }),
    Promise.resolve(isIntegrationEncryptionConfigured()),
  ]);

  if (row) {
    let credentialConfigured = false;
    if (encryptionConfigured) {
      try { credentialConfigured = Boolean(decryptMetadataProviderConfig(row.encryptedConfig, PROVIDER).apiKey); } catch { credentialConfigured = false; }
    }
    return { credentialConfigured, enabled: row.enabled && credentialConfigured, encryptionConfigured };
  }
  return { credentialConfigured: false, enabled: false, encryptionConfigured };
}

export async function getEnabledTmdbToken() {
  const row = await prisma.metadataProviderCredential.findUnique({ where: { provider: PROVIDER } });
  if (row) {
    if (!row.enabled) throw new TmdbNotEnabledError();
    try {
      const token = decryptMetadataProviderConfig(row.encryptedConfig, PROVIDER).apiKey;
      if (token) return token;
    } catch {
      throw new TmdbConfigurationError();
    }
    throw new TmdbConfigurationError();
  }

  throw new TmdbNotEnabledError();
}

export async function saveTmdbProviderConfig(input: { apiKey: string; enabled: boolean }) {
  if (!isIntegrationEncryptionConfigured()) throw new TmdbConfigurationError();

  const existing = await prisma.metadataProviderCredential.findUnique({ where: { provider: PROVIDER } });
  let previous: MetadataProviderConfig = { apiKey: "", subscriberPin: "" };
  if (existing) {
    try { previous = decryptMetadataProviderConfig(existing.encryptedConfig, PROVIDER); } catch { throw new TmdbConfigurationError(); }
  }
  const credentials = { apiKey: input.apiKey.trim() || previous.apiKey, subscriberPin: "" };
  if (!credentials.apiKey) throw new TmdbConfigurationError("Enter the TMDB API Read Access Token.");

  await prisma.metadataProviderCredential.upsert({
    where: { provider: PROVIDER },
    create: { provider: PROVIDER, encryptedConfig: encryptMetadataProviderConfig(credentials, PROVIDER), enabled: input.enabled },
    update: { encryptedConfig: encryptMetadataProviderConfig(credentials, PROVIDER), enabled: input.enabled },
  });
  return getTmdbProviderStatus();
}
