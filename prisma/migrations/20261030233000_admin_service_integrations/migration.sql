CREATE TABLE "AdminServiceIntegration" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedConfig" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminServiceIntegration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminServiceIntegration_service_createdAt_idx"
ON "AdminServiceIntegration"("service", "createdAt");
