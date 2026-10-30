import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class IntegrationEncryptionUnavailableError extends Error {
  constructor() {
    super("Integration credential encryption is not configured.");
    this.name = "IntegrationEncryptionUnavailableError";
  }
}

export class IntegrationCiphertextError extends Error {
  constructor() {
    super("Stored integration settings could not be decrypted.");
    this.name = "IntegrationCiphertextError";
  }
}

export interface IntegrationConfig {
  baseUrl: string;
  apiKey: string;
}

export function parseIntegrationEncryptionKey(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new IntegrationEncryptionUnavailableError();
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) throw new IntegrationEncryptionUnavailableError();
  return key;
}

export function isIntegrationEncryptionConfigured() {
  try {
    parseIntegrationEncryptionKey(process.env.INTEGRATION_CREDENTIALS_KEY);
    return true;
  } catch {
    return false;
  }
}

export function encryptIntegrationConfig(config: IntegrationConfig, context: string, value = process.env.INTEGRATION_CREDENTIALS_KEY) {
  const key = parseIntegrationEncryptionKey(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
  return `v1.${payload}`;
}

export function decryptIntegrationConfig(ciphertext: string, context: string, value = process.env.INTEGRATION_CREDENTIALS_KEY): IntegrationConfig {
  try {
    const [version, payload] = ciphertext.split(".");
    if (version !== "v1" || !payload) throw new Error("Unknown ciphertext version.");
    const packed = Buffer.from(payload, "base64");
    if (packed.byteLength < 29) throw new Error("Ciphertext is too short.");
    const key = parseIntegrationEncryptionKey(value);
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const encrypted = packed.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const config = JSON.parse(plaintext) as Partial<IntegrationConfig>;
    if (typeof config.baseUrl !== "string" || typeof config.apiKey !== "string") throw new Error("Invalid config payload.");
    return { baseUrl: config.baseUrl, apiKey: config.apiKey };
  } catch (error) {
    if (error instanceof IntegrationEncryptionUnavailableError) throw error;
    throw new IntegrationCiphertextError();
  }
}

export function integrationEncryptionContext(userId: string, integrationId: string) {
  return `choice-fatigue:user-integration:${userId}:${integrationId}`;
}
