ALTER TABLE "companySettings" 
  ADD COLUMN "rfqReadyNotificationGroup" TEXT[] NOT NULL DEFAULT '{}';
