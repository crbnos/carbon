ALTER TABLE "productionEvent"
  DROP COLUMN "notes";

ALTER TABLE "productionEvent"
  ADD COLUMN "notes" TEXT;
