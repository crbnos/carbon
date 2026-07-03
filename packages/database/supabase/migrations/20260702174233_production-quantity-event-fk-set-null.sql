-- Deleting a production event (time card) must not be blocked by the output
-- quantities that reference it. A productionQuantity records real output that
-- outlives an individual time card, so when its setup/labor/machine event is
-- deleted we clear the link (ON DELETE SET NULL) rather than block the delete
-- or cascade-delete the quantity. The link columns are already nullable.

ALTER TABLE "productionQuantity"
  DROP CONSTRAINT IF EXISTS "productionQuantity_setupProductionEventId_fkey";
ALTER TABLE "productionQuantity"
  ADD CONSTRAINT "productionQuantity_setupProductionEventId_fkey"
  FOREIGN KEY ("setupProductionEventId") REFERENCES "productionEvent"("id")
  ON DELETE SET NULL;

ALTER TABLE "productionQuantity"
  DROP CONSTRAINT IF EXISTS "productionQuantity_laborProductionEventId_fkey";
ALTER TABLE "productionQuantity"
  ADD CONSTRAINT "productionQuantity_laborProductionEventId_fkey"
  FOREIGN KEY ("laborProductionEventId") REFERENCES "productionEvent"("id")
  ON DELETE SET NULL;

ALTER TABLE "productionQuantity"
  DROP CONSTRAINT IF EXISTS "productionQuantity_machineProductionEventId_fkey";
ALTER TABLE "productionQuantity"
  ADD CONSTRAINT "productionQuantity_machineProductionEventId_fkey"
  FOREIGN KEY ("machineProductionEventId") REFERENCES "productionEvent"("id")
  ON DELETE SET NULL;
