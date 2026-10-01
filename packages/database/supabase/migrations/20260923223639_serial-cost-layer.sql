-- Specific identification for serialized units. A cost layer booked for ONE
-- serial unit (a fixed asset returned to stock at its net book value, a
-- sales-type lease residual returned at its closing net investment, an
-- unscrap, a positive adjustment of a serial) records that unit, and
-- calculateCOGS relieves the unit leaving from its own layer instead of the
-- oldest one. NULL for every layer that covers many units (receipts, job
-- output), which keep FIFO / LIFO order.
ALTER TABLE "costLedger" ADD COLUMN "trackedEntityId" TEXT;

ALTER TABLE "costLedger" ADD CONSTRAINT "costLedger_trackedEntityId_fkey"
  FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "costLedger_trackedEntityId_idx" ON "costLedger" ("trackedEntityId")
  WHERE "trackedEntityId" IS NOT NULL;
