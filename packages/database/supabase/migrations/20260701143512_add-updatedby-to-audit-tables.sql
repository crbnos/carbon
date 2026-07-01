-- Convention: every table that tracks `createdBy` must also carry `updatedBy`
-- (mirrors the earlier `companyId`-on-all-tables fix). This closes the gap for
-- the tables that were created with `createdBy` but never got an `updatedBy`
-- column, so the shared audit-injection path (MCP `direct-executor`, service
-- writes) can stamp `updatedBy` uniformly instead of erroring with
-- `column "updatedBy" does not exist` on the tables that lacked it.
--
-- `updatedBy` follows the standard audit pattern: nullable TEXT referencing
-- `"user"("id")` inline (same as `createdBy`), no index (updatedBy is not
-- indexed anywhere in the schema). Append-only ledger tables (e.g. itemLedger)
-- get the column for schema uniformity; an "edit" is still a new offsetting row,
-- so the column simply stays NULL there.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) per the migration convention.

ALTER TABLE "apiKey" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "contractorAbility" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "depreciationRun" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "externalIntegrationMapping" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "fixedAssetDisposal" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "fixedAssetUsageLog" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "fulfillment" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "inboundInspectionHistory" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "invite" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "invoiceSettlement" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "itemLedger" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "nonConformanceInboundInspection" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "note" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "purchaseOrderStatusHistory" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "purchasingRfqSupplier" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "salesOrderStatusHistory" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "storageRuleItemAssignment" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "storageRuleWorkCenterAssignment" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "tag" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "trackedActivity" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "trackedActivityInput" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "trackedActivityOutput" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
ALTER TABLE "trackedEntity" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT REFERENCES "user"("id");
