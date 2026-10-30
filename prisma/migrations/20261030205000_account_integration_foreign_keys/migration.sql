DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserIntegration_userId_fkey') THEN
    ALTER TABLE "UserIntegration" ADD CONSTRAINT "UserIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IntegrationAuditLog_userId_fkey') THEN
    ALTER TABLE "IntegrationAuditLog" ADD CONSTRAINT "IntegrationAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
