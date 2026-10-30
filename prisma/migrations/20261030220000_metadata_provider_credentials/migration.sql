-- CreateTable
CREATE TABLE "MetadataProviderCredential" (
    "provider" TEXT NOT NULL,
    "encryptedConfig" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetadataProviderCredential_pkey" PRIMARY KEY ("provider")
);
