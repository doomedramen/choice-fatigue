import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptApplicationSecret, encryptApplicationSecret, isIntegrationEncryptionConfigured } from "@/lib/integrations/crypto";

const GLOBAL_SETTINGS_ID = "global";
const SMTP_PURPOSE = "smtp-url";

export function hashBetaInviteCode(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function getGlobalSettings() {
  const settings = await prisma.globalSettings.findUnique({ where: { id: GLOBAL_SETTINGS_ID } });
  return {
    appName: settings?.appName ?? "Choice Fatigue",
    defaultCategory: settings?.defaultCategory === "TV" ? "Shows" : settings?.defaultCategory ?? "Movies",
    adultSectionEnabled: settings?.adultSectionEnabled === true,
    allowPrivateNetworkTargets: settings?.allowPrivateNetworkTargets === true,
  };
}

export async function getAdminGlobalSettings() {
  const settings = await prisma.globalSettings.findUnique({ where: { id: GLOBAL_SETTINGS_ID } });
  return {
    appName: settings?.appName ?? "Choice Fatigue",
    defaultCategory: settings?.defaultCategory === "TV" ? "Shows" : settings?.defaultCategory ?? "Movies",
    adultSectionEnabled: settings?.adultSectionEnabled === true,
    allowPrivateNetworkTargets: settings?.allowPrivateNetworkTargets === true,
    betaInviteCodeConfigured: Boolean(settings?.betaInviteCodeHash),
    smtpEnabled: settings?.smtpEnabled === true,
    smtpFrom: settings?.smtpFrom ?? "",
    smtpConfigured: Boolean(settings?.encryptedSmtpUrl && settings.smtpFrom),
  };
}

export async function saveAdminGlobalSettings(input: {
  appName: string;
  defaultCategory: string;
  adultSectionEnabled: boolean;
  allowPrivateNetworkTargets: boolean;
  betaInviteCode: string;
  smtpEnabled: boolean;
  smtpFrom: string;
  smtpUrl: string;
  clearSmtpConfig: boolean;
}) {
  const current = await prisma.globalSettings.findUnique({ where: { id: GLOBAL_SETTINGS_ID } });
  const newInviteCode = input.betaInviteCode.trim();
  const betaInviteCodeHash = newInviteCode ? hashBetaInviteCode(newInviteCode) : current?.betaInviteCodeHash ?? null;
  let encryptedSmtpUrl = input.clearSmtpConfig ? null : current?.encryptedSmtpUrl ?? null;
  const smtpUrl = input.smtpUrl.trim();

  if (smtpUrl) {
    let parsedSmtpUrl: URL;
    try { parsedSmtpUrl = new URL(smtpUrl); }
    catch { throw new Error("Enter a valid SMTP connection URL."); }
    if (!(["smtp:", "smtps:"].includes(parsedSmtpUrl.protocol)) || !parsedSmtpUrl.hostname || smtpUrl.length > 2048) {
      throw new Error("Use a valid smtp:// or smtps:// connection URL.");
    }
    if (!isIntegrationEncryptionConfigured()) throw new Error("Secure credential storage is unavailable.");
    encryptedSmtpUrl = encryptApplicationSecret(smtpUrl, SMTP_PURPOSE);
  }

  const smtpFrom = input.clearSmtpConfig ? null : input.smtpFrom.trim() || current?.smtpFrom || null;
  if (input.smtpEnabled && (!encryptedSmtpUrl || !smtpFrom)) {
    throw new Error("Add the SMTP connection URL and sender address before enabling password reset email.");
  }
  if (input.clearSmtpConfig && input.smtpEnabled) throw new Error("Disable password reset email before clearing its settings.");

  await prisma.globalSettings.upsert({
    where: { id: GLOBAL_SETTINGS_ID },
    create: {
      id: GLOBAL_SETTINGS_ID,
      appName: input.appName,
      defaultCategory: input.defaultCategory,
      adultSectionEnabled: input.adultSectionEnabled,
      allowPrivateNetworkTargets: input.allowPrivateNetworkTargets,
      betaInviteCodeHash,
      smtpEnabled: input.smtpEnabled,
      smtpFrom,
      encryptedSmtpUrl,
    },
    update: {
      appName: input.appName,
      defaultCategory: input.defaultCategory,
      adultSectionEnabled: input.adultSectionEnabled,
      allowPrivateNetworkTargets: input.allowPrivateNetworkTargets,
      betaInviteCodeHash,
      smtpEnabled: input.smtpEnabled,
      smtpFrom,
      encryptedSmtpUrl,
    },
  });
  return getAdminGlobalSettings();
}

export async function hasValidBetaInviteCode(candidate: string) {
  const settings = await prisma.globalSettings.findUnique({ where: { id: GLOBAL_SETTINGS_ID }, select: { betaInviteCodeHash: true } });
  if (!settings?.betaInviteCodeHash) return false;
  const candidateHash = Buffer.from(hashBetaInviteCode(candidate), "hex");
  const expectedHash = Buffer.from(settings.betaInviteCodeHash, "hex");
  return candidateHash.byteLength === expectedHash.byteLength && timingSafeEqual(candidateHash, expectedHash);
}

export async function getEnabledSmtpSettings() {
  const settings = await prisma.globalSettings.findUnique({ where: { id: GLOBAL_SETTINGS_ID }, select: { smtpEnabled: true, smtpFrom: true, encryptedSmtpUrl: true } });
  if (!settings?.smtpEnabled || !settings.smtpFrom || !settings.encryptedSmtpUrl) return null;
  return { smtpFrom: settings.smtpFrom, smtpUrl: decryptApplicationSecret(settings.encryptedSmtpUrl, SMTP_PURPOSE) };
}
