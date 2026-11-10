ALTER TABLE "companySettings"
ADD COLUMN IF NOT EXISTS "receiptQuantitiesStartAtZero" BOOLEAN NOT NULL DEFAULT false;
