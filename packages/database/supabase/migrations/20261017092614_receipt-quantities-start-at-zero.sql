-- Blind receiving: when on, a new receipt's lines start with a received
-- quantity of 0 instead of the outstanding quantity, so the receiver counts
-- each line and a line nothing arrived for stays at 0.
ALTER TABLE "companySettings"
ADD COLUMN IF NOT EXISTS "receiptQuantitiesStartAtZero" BOOLEAN NOT NULL DEFAULT false;
