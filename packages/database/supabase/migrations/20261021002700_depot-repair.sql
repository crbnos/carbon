-- Field Service Phase B: depot repair through the RMA.
-- Spec: .ai/specs/2026-10-08-field-service.md (Depot Repair through the RMA).
--
-- A Depot Repair order names the RMA line its unit came back on. The link is on
-- the order, not on the line: one RMA line can return several serials, and each
-- serial gets its own order (plan decision B1).
--
-- The foreign key is NO ACTION, not SET NULL: a Depot Repair order must keep its
-- line (serviceOrder_depot_check), so a SET NULL could only fail. Deleting an RMA
-- line that has a depot order is refused instead.

ALTER TABLE "serviceOrder" ADD COLUMN IF NOT EXISTS "salesReturnOrderLineId" TEXT;

ALTER TABLE "serviceOrder" ADD CONSTRAINT "serviceOrder_rmaLine_fkey"
  FOREIGN KEY ("salesReturnOrderLineId", "companyId")
  REFERENCES "salesReturnOrderLine"("id", "companyId");

CREATE INDEX IF NOT EXISTS "serviceOrder_rmaLine_idx" ON "serviceOrder" ("salesReturnOrderLineId", "companyId")
  WHERE "salesReturnOrderLineId" IS NOT NULL;

ALTER TABLE "serviceOrder" ADD CONSTRAINT "serviceOrder_depot_check"
  CHECK ("type" <> 'Depot Repair' OR "salesReturnOrderLineId" IS NOT NULL);
