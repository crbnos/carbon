ALTER TABLE "companySettings"
ADD COLUMN IF NOT EXISTS "updateLeadTimesOnReceipt" BOOLEAN NOT NULL DEFAULT false;