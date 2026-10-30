ALTER TABLE "GlobalSettings"
  ADD COLUMN "betaInviteCodeHash" VARCHAR(64),
  ADD COLUMN "allowPrivateNetworkTargets" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "smtpEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "smtpFrom" TEXT,
  ADD COLUMN "encryptedSmtpUrl" TEXT;
