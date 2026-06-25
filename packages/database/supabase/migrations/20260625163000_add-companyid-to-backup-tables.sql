-- Make "a company's data" an explicit, directly-queryable fact for the company
-- backup/export: give a denormalized `companyId` to company-owned CHILD tables
-- that previously derived scope from a parent FK, so the export catalog scopes
-- them with a direct `companyId = $` predicate instead of an inferred FK path.
--
-- Company-SINGLETON config tables (companySettings, terms, AP/AR billing — one
-- row per company, keyed by `id -> company`) are NOT touched here: the export
-- catalog scopes them by their `id` directly (it IS the company id), so they need
-- no redundant `companyId` column. companyPlan is a singleton too but deliberately
-- excluded (Stripe billing identity, must never travel).
--
-- Supersedes PR #946 (`20260625101500_add-companyid-to-child-tables.sql`): this
-- migration covers the FULL set in one place — the contact/location/line-price
-- child tables from #946, PLUS the order/invoice status + activity history and
-- contractor ability links. Close #946 in favor of this. The shared
-- `set_company_id_from_parent` trigger is defined here, so this applies standalone.
--
-- companyId is backfilled from each table's parent and kept populated on INSERT by
-- a BEFORE-INSERT trigger, so no app insert code changes. All parent FK columns are
-- NOT NULL with no orphans, so the backfill fills every row.

-- Shared trigger: derive companyId from a parent. TG_ARGV = (parent_table, fk_column).
-- Reuses the canonical get_company_id_from_foreign_key() helper (same one the RLS
-- policies on these tables use). AUTHORITATIVE — it ALWAYS overwrites companyId
-- from the parent, ignoring any caller-supplied value, so a crafted insert
-- (parentId in my company, companyId of another) can't mis-scope the row across
-- tenants (the RLS INSERT policy gates on the parent, not on this column). The
-- restore/import load runs under session_replication_role='replica' (triggers
-- off) and sets companyId itself; when replica is unavailable the trigger derives
-- the same value from the already-loaded parent, so this is safe on every path.
CREATE OR REPLACE FUNCTION set_company_id_from_parent() RETURNS trigger AS $$
DECLARE
  v_fkval text := to_jsonb(NEW) ->> TG_ARGV[1];
BEGIN
  IF v_fkval IS NOT NULL THEN
    NEW."companyId" := get_company_id_from_foreign_key(v_fkval, TG_ARGV[0]);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── child tables (derive companyId from parent) ────────────────────────────
-- ─── customerContact ← customer ─────────────────────────────────────────────
ALTER TABLE "customerContact" ADD COLUMN "companyId" TEXT;
UPDATE "customerContact" c SET "companyId" = p."companyId" FROM "customer" p WHERE c."customerId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "customerContact" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('customer', 'customerId');
ALTER TABLE "customerContact" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "customerContact" ADD CONSTRAINT "customerContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "customerContact_companyId_idx" ON "customerContact" ("companyId");

-- ─── customerLocation ← customer ────────────────────────────────────────────
ALTER TABLE "customerLocation" ADD COLUMN "companyId" TEXT;
UPDATE "customerLocation" c SET "companyId" = p."companyId" FROM "customer" p WHERE c."customerId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "customerLocation" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('customer', 'customerId');
ALTER TABLE "customerLocation" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "customerLocation" ADD CONSTRAINT "customerLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "customerLocation_companyId_idx" ON "customerLocation" ("companyId");

-- ─── supplierContact ← supplier ─────────────────────────────────────────────
ALTER TABLE "supplierContact" ADD COLUMN "companyId" TEXT;
UPDATE "supplierContact" c SET "companyId" = p."companyId" FROM "supplier" p WHERE c."supplierId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "supplierContact" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('supplier', 'supplierId');
ALTER TABLE "supplierContact" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "supplierContact" ADD CONSTRAINT "supplierContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "supplierContact_companyId_idx" ON "supplierContact" ("companyId");

-- ─── supplierLocation ← supplier ────────────────────────────────────────────
ALTER TABLE "supplierLocation" ADD COLUMN "companyId" TEXT;
UPDATE "supplierLocation" c SET "companyId" = p."companyId" FROM "supplier" p WHERE c."supplierId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "supplierLocation" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('supplier', 'supplierId');
ALTER TABLE "supplierLocation" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "supplierLocation" ADD CONSTRAINT "supplierLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "supplierLocation_companyId_idx" ON "supplierLocation" ("companyId");

-- ─── quoteLinePrice ← quote ─────────────────────────────────────────────────
ALTER TABLE "quoteLinePrice" ADD COLUMN "companyId" TEXT;
UPDATE "quoteLinePrice" c SET "companyId" = p."companyId" FROM "quote" p WHERE c."quoteId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "quoteLinePrice" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('quote', 'quoteId');
ALTER TABLE "quoteLinePrice" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "quoteLinePrice" ADD CONSTRAINT "quoteLinePrice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "quoteLinePrice_companyId_idx" ON "quoteLinePrice" ("companyId");

-- ─── supplierQuoteLinePrice ← supplierQuote ─────────────────────────────────
ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN "companyId" TEXT;
UPDATE "supplierQuoteLinePrice" c SET "companyId" = p."companyId" FROM "supplierQuote" p WHERE c."supplierQuoteId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "supplierQuoteLinePrice" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('supplierQuote', 'supplierQuoteId');
ALTER TABLE "supplierQuoteLinePrice" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "supplierQuoteLinePrice" ADD CONSTRAINT "supplierQuoteLinePrice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "supplierQuoteLinePrice_companyId_idx" ON "supplierQuoteLinePrice" ("companyId");

-- ─── purchaseInvoicePriceChange ← purchaseInvoice ───────────────────────────
ALTER TABLE "purchaseInvoicePriceChange" ADD COLUMN "companyId" TEXT;
UPDATE "purchaseInvoicePriceChange" c SET "companyId" = p."companyId" FROM "purchaseInvoice" p WHERE c."invoiceId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "purchaseInvoicePriceChange" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('purchaseInvoice', 'invoiceId');
ALTER TABLE "purchaseInvoicePriceChange" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "purchaseInvoicePriceChange" ADD CONSTRAINT "purchaseInvoicePriceChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "purchaseInvoicePriceChange_companyId_idx" ON "purchaseInvoicePriceChange" ("companyId");

-- ─── purchaseInvoicePaymentRelation ← purchaseInvoice ───────────────────────
ALTER TABLE "purchaseInvoicePaymentRelation" ADD COLUMN "companyId" TEXT;
UPDATE "purchaseInvoicePaymentRelation" c SET "companyId" = p."companyId" FROM "purchaseInvoice" p WHERE c."invoiceId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "purchaseInvoicePaymentRelation" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('purchaseInvoice', 'invoiceId');
ALTER TABLE "purchaseInvoicePaymentRelation" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "purchaseInvoicePaymentRelation" ADD CONSTRAINT "purchaseInvoicePaymentRelation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "purchaseInvoicePaymentRelation_companyId_idx" ON "purchaseInvoicePaymentRelation" ("companyId");

-- ─── pickingListLineTrackedEntity ← pickingListLine ─────────────────────────
ALTER TABLE "pickingListLineTrackedEntity" ADD COLUMN "companyId" TEXT;
UPDATE "pickingListLineTrackedEntity" c SET "companyId" = p."companyId" FROM "pickingListLine" p WHERE c."pickingListLineId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "pickingListLineTrackedEntity" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('pickingListLine', 'pickingListLineId');
ALTER TABLE "pickingListLineTrackedEntity" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "pickingListLineTrackedEntity" ADD CONSTRAINT "pickingListLineTrackedEntity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "pickingListLineTrackedEntity_companyId_idx" ON "pickingListLineTrackedEntity" ("companyId");

-- ─── employeeShift ← shift (employeeId is a global user, so derive from shift) ─
ALTER TABLE "employeeShift" ADD COLUMN "companyId" TEXT;
UPDATE "employeeShift" c SET "companyId" = p."companyId" FROM "shift" p WHERE c."shiftId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "employeeShift" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('shift', 'shiftId');
ALTER TABLE "employeeShift" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "employeeShift" ADD CONSTRAINT "employeeShift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "employeeShift_companyId_idx" ON "employeeShift" ("companyId");

-- ─── documentLabel ← document ───────────────────────────────────────────────
ALTER TABLE "documentLabel" ADD COLUMN "companyId" TEXT;
UPDATE "documentLabel" c SET "companyId" = p."companyId" FROM "document" p WHERE c."documentId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "documentLabel" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('document', 'documentId');
ALTER TABLE "documentLabel" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "documentLabel" ADD CONSTRAINT "documentLabel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "documentLabel_companyId_idx" ON "documentLabel" ("companyId");

-- ─── contractorAbility ← contractor ─────────────────────────────────────────
ALTER TABLE "contractorAbility" ADD COLUMN "companyId" TEXT;
UPDATE "contractorAbility" c SET "companyId" = p."companyId" FROM "contractor" p WHERE c."contractorId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "contractorAbility" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('contractor', 'contractorId');
ALTER TABLE "contractorAbility" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "contractorAbility" ADD CONSTRAINT "contractorAbility_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "contractorAbility_companyId_idx" ON "contractorAbility" ("companyId");

-- ─── salesOrderStatusHistory ← salesOrder ───────────────────────────────────
ALTER TABLE "salesOrderStatusHistory" ADD COLUMN "companyId" TEXT;
UPDATE "salesOrderStatusHistory" c SET "companyId" = p."companyId" FROM "salesOrder" p WHERE c."salesOrderId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "salesOrderStatusHistory" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('salesOrder', 'salesOrderId');
ALTER TABLE "salesOrderStatusHistory" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "salesOrderStatusHistory" ADD CONSTRAINT "salesOrderStatusHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "salesOrderStatusHistory_companyId_idx" ON "salesOrderStatusHistory" ("companyId");

-- ─── salesOrderTransaction ← salesOrder ─────────────────────────────────────
ALTER TABLE "salesOrderTransaction" ADD COLUMN "companyId" TEXT;
UPDATE "salesOrderTransaction" c SET "companyId" = p."companyId" FROM "salesOrder" p WHERE c."salesOrderId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "salesOrderTransaction" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('salesOrder', 'salesOrderId');
ALTER TABLE "salesOrderTransaction" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "salesOrderTransaction" ADD CONSTRAINT "salesOrderTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "salesOrderTransaction_companyId_idx" ON "salesOrderTransaction" ("companyId");

-- ─── purchaseOrderStatusHistory ← purchaseOrder ─────────────────────────────
ALTER TABLE "purchaseOrderStatusHistory" ADD COLUMN "companyId" TEXT;
UPDATE "purchaseOrderStatusHistory" c SET "companyId" = p."companyId" FROM "purchaseOrder" p WHERE c."purchaseOrderId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "purchaseOrderStatusHistory" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('purchaseOrder', 'purchaseOrderId');
ALTER TABLE "purchaseOrderStatusHistory" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "purchaseOrderStatusHistory" ADD CONSTRAINT "purchaseOrderStatusHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "purchaseOrderStatusHistory_companyId_idx" ON "purchaseOrderStatusHistory" ("companyId");

-- ─── purchaseOrderTransaction ← purchaseOrder ───────────────────────────────
ALTER TABLE "purchaseOrderTransaction" ADD COLUMN "companyId" TEXT;
UPDATE "purchaseOrderTransaction" c SET "companyId" = p."companyId" FROM "purchaseOrder" p WHERE c."purchaseOrderId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "purchaseOrderTransaction" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('purchaseOrder', 'purchaseOrderId');
ALTER TABLE "purchaseOrderTransaction" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "purchaseOrderTransaction" ADD CONSTRAINT "purchaseOrderTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "purchaseOrderTransaction_companyId_idx" ON "purchaseOrderTransaction" ("companyId");

-- ─── purchaseInvoiceStatusHistory ← purchaseInvoice ─────────────────────────
ALTER TABLE "purchaseInvoiceStatusHistory" ADD COLUMN "companyId" TEXT;
UPDATE "purchaseInvoiceStatusHistory" c SET "companyId" = p."companyId" FROM "purchaseInvoice" p WHERE c."invoiceId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "purchaseInvoiceStatusHistory" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('purchaseInvoice', 'invoiceId');
ALTER TABLE "purchaseInvoiceStatusHistory" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "purchaseInvoiceStatusHistory" ADD CONSTRAINT "purchaseInvoiceStatusHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "purchaseInvoiceStatusHistory_companyId_idx" ON "purchaseInvoiceStatusHistory" ("companyId");

-- ─── documentTransaction ← document ─────────────────────────────────────────
ALTER TABLE "documentTransaction" ADD COLUMN "companyId" TEXT;
UPDATE "documentTransaction" c SET "companyId" = p."companyId" FROM "document" p WHERE c."documentId" = p."id";
CREATE TRIGGER "set_company_id" BEFORE INSERT ON "documentTransaction" FOR EACH ROW EXECUTE FUNCTION set_company_id_from_parent('document', 'documentId');
ALTER TABLE "documentTransaction" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "documentTransaction" ADD CONSTRAINT "documentTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
CREATE INDEX "documentTransaction_companyId_idx" ON "documentTransaction" ("companyId");
