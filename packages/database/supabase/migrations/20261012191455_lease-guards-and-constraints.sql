-- Lessee leases: what the API may write, and the constraints the lease tables
-- were missing. Spec: .ai/specs/2026-10-11-lessee-leases.md.
-- Plan: .ai/plans/2026-10-12-lessee-leases-review-fixes.md (C, decision D1).
--
-- 1) The API writes a lease only while it is Draft. The `purchasing_*` policies
--    (packages/database/src/authz/manifest.ts) let a purchasing user write
--    `lease`, `leaseLine` and `leasePayment` in any status, but activation cuts
--    the payment rows, the classification and the measurement from the terms,
--    and the commencement journal is posted from them: an edit after it would
--    leave the books describing a lease that no longer exists. For an API role
--    (anon / authenticated — the idiom of check_accounting_config_locked) these
--    triggers refuse any write to a lease that is not Draft, except a started
--    lease's name, notes, owner, notice date and custom fields, and refuse any
--    change to the status, the commencement journal and an asset's
--    classification and measurement in every status. The classification
--    override route writes with the service role; the server functions write
--    over a direct connection (Kysely): neither is an API role.
--    A write the database makes itself (a cascade from a Draft lease's delete,
--    the release in 2) runs at trigger depth > 1: the statement that caused it
--    was already allowed.
-- 2) Deleting a purchase invoice line returns the lease payment row it billed
--    to Pending. `leasePayment.purchaseInvoiceLineId` has no foreign key (a
--    lease line can be on any invoice), so a delete that missed the ERP's
--    release left the row Invoiced against nothing and it was never billed
--    again. A row is Invoiced exactly when it names its invoice line.
-- 3) Constraints: asset inputs, the escalation, a payment row / schedule line /
--    event belongs to an asset of its OWN lease, a lease run row names its lease
--    and its schedule line together, an event's fixed asset exists.
-- 4) The `leases` view: no next due date for a Draft or Cancelled lease; the
--    count, payment and classification of a running lease cover its active
--    assets (an ended lease: all of them); one lateral aggregate.

-- 1) The API writes only a Draft lease ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.lease_api_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- A started lease keeps these editable: who owns it, when to give notice,
  -- what it is called. Everything else was measured at activation.
  lease_notes CONSTANT text[] := ARRAY[
    'name', 'description', 'assignee', 'noticeDate', 'customFields',
    'updatedAt', 'updatedBy'
  ];
  lease_ids text[];
  company_id text;
  started boolean;
BEGIN
  IF coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
     OR pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'lease' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW."status" <> 'Draft' OR NEW."commencementJournalId" IS NOT NULL THEN
        RAISE EXCEPTION 'A lease is created as a Draft and activated in Carbon'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
      IF OLD."status" <> 'Draft' THEN
        RAISE EXCEPTION 'Only a Draft lease can be deleted; cancel an active lease instead'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN OLD;
    END IF;
    IF NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."commencementJournalId" IS DISTINCT FROM OLD."commencementJournalId" THEN
      RAISE EXCEPTION 'A lease''s status changes only by activating, modifying, terminating, purchasing or cancelling it'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD."status" <> 'Draft'
       AND (to_jsonb(NEW) - lease_notes) IS DISTINCT FROM (to_jsonb(OLD) - lease_notes) THEN
      RAISE EXCEPTION 'Only a Draft lease''s terms can change; modify an active lease instead'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- leaseLine / leasePayment: the lease (both of them, when a row moves) must
  -- be Draft.
  IF TG_TABLE_NAME = 'leaseLine' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW."status" <> 'Active'
         OR num_nonnulls(
           NEW."classificationOverride", NEW."classificationOverrideReason",
           NEW."lesseeClassification", NEW."classificationInputs",
           NEW."initialLiability", NEW."initialRouAsset", NEW."rouAssetCost",
           NEW."fixedAssetId"
         ) > 0 THEN
        RAISE EXCEPTION 'A leased asset''s classification and measurement are set by activation'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    -- Activation and the lifecycle actions own these on an asset.
    ELSIF TG_OP = 'UPDATE' AND (
         NEW."classificationOverride" IS DISTINCT FROM OLD."classificationOverride"
      OR NEW."classificationOverrideReason" IS DISTINCT FROM OLD."classificationOverrideReason"
      OR NEW."lesseeClassification" IS DISTINCT FROM OLD."lesseeClassification"
      OR NEW."classificationInputs" IS DISTINCT FROM OLD."classificationInputs"
      OR NEW."initialLiability" IS DISTINCT FROM OLD."initialLiability"
      OR NEW."initialRouAsset" IS DISTINCT FROM OLD."initialRouAsset"
      OR NEW."rouAssetCost" IS DISTINCT FROM OLD."rouAssetCost"
      OR NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."fixedAssetId" IS DISTINCT FROM OLD."fixedAssetId"
    ) THEN
      RAISE EXCEPTION 'A leased asset''s classification and measurement are set by activation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    lease_ids := ARRAY[NEW."leaseId"];
    company_id := NEW."companyId";
  ELSIF TG_OP = 'DELETE' THEN
    lease_ids := ARRAY[OLD."leaseId"];
    company_id := OLD."companyId";
  ELSE
    lease_ids := ARRAY[OLD."leaseId", NEW."leaseId"];
    company_id := OLD."companyId";
    IF NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
      RAISE EXCEPTION 'A lease row cannot move to another company'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- A missing lease reads as started: the row is refused, never let through.
  SELECT coalesce(bool_or(l."status" IS DISTINCT FROM 'Draft'), true)
       OR count(*) < cardinality(ARRAY(SELECT DISTINCT unnest(lease_ids)))
    INTO started
  FROM "lease" l
  WHERE l."id" = ANY (lease_ids) AND l."companyId" = company_id;
  IF started THEN
    RAISE EXCEPTION '% changes only while the lease is Draft; modify an active lease instead',
      CASE WHEN TG_TABLE_NAME = 'leaseLine' THEN 'A leased asset' ELSE 'A payment row' END
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS "lease_api_write_guard" ON "lease";
CREATE TRIGGER "lease_api_write_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "lease"
  FOR EACH ROW EXECUTE FUNCTION public.lease_api_write_guard();

DROP TRIGGER IF EXISTS "leaseLine_api_write_guard" ON "leaseLine";
CREATE TRIGGER "leaseLine_api_write_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "leaseLine"
  FOR EACH ROW EXECUTE FUNCTION public.lease_api_write_guard();

DROP TRIGGER IF EXISTS "leasePayment_api_write_guard" ON "leasePayment";
CREATE TRIGGER "leasePayment_api_write_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "leasePayment"
  FOR EACH ROW EXECUTE FUNCTION public.lease_api_write_guard();

-- 2) A deleted invoice line releases its payment row --------------------------------------

CREATE OR REPLACE FUNCTION public.release_lease_payment_of_invoice_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE "leasePayment"
  SET "status" = 'Pending', "purchaseInvoiceLineId" = NULL, "updatedAt" = now()
  WHERE "purchaseInvoiceLineId" = OLD."id"
    AND "companyId" = OLD."companyId"
    AND "status" = 'Invoiced';
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS "purchaseInvoiceLine_release_lease_payment" ON "purchaseInvoiceLine";
CREATE TRIGGER "purchaseInvoiceLine_release_lease_payment"
  AFTER DELETE ON "purchaseInvoiceLine"
  FOR EACH ROW WHEN (OLD."leaseId" IS NOT NULL)
  EXECUTE FUNCTION public.release_lease_payment_of_invoice_line();

-- A row left Invoiced by a delete before this trigger existed is owed again.
UPDATE "leasePayment" p
SET "status" = 'Pending', "purchaseInvoiceLineId" = NULL, "updatedAt" = now()
WHERE p."status" = 'Invoiced'
  AND (
    p."purchaseInvoiceLineId" IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM "purchaseInvoiceLine" il
      WHERE il."id" = p."purchaseInvoiceLineId" AND il."companyId" = p."companyId"
    )
  );

ALTER TABLE "leasePayment" DROP CONSTRAINT IF EXISTS "leasePayment_invoiced_check";
ALTER TABLE "leasePayment" ADD CONSTRAINT "leasePayment_invoiced_check"
  CHECK (("status" = 'Invoiced') = ("purchaseInvoiceLineId" IS NOT NULL));

-- 3) Constraints ------------------------------------------------------------------------------

ALTER TABLE "leaseLine"
  DROP CONSTRAINT IF EXISTS "leaseLine_fairValue_check",
  DROP CONSTRAINT IF EXISTS "leaseLine_economicLifeMonths_check",
  DROP CONSTRAINT IF EXISTS "leaseLine_purchaseOptionAmount_check";
ALTER TABLE "leaseLine"
  ADD CONSTRAINT "leaseLine_fairValue_check" CHECK ("fairValue" IS NULL OR "fairValue" > 0),
  ADD CONSTRAINT "leaseLine_economicLifeMonths_check"
    CHECK ("economicLifeMonths" IS NULL OR "economicLifeMonths" > 0),
  ADD CONSTRAINT "leaseLine_purchaseOptionAmount_check"
    CHECK ("purchaseOptionAmount" IS NULL OR "purchaseOptionAmount" >= 0);

ALTER TABLE "lease" DROP CONSTRAINT IF EXISTS "lease_annualEscalationPercent_check";
ALTER TABLE "lease" ADD CONSTRAINT "lease_annualEscalationPercent_check"
  CHECK ("annualEscalationPercent" > -100);

-- A payment row, schedule line or event names an asset of its own lease. The
-- composite key replaces the (leaseLineId, companyId) one under the same name,
-- so a PostgREST embed of `leaseLine` still has exactly one relationship.
ALTER TABLE "leaseLine" DROP CONSTRAINT IF EXISTS "leaseLine_id_leaseId_companyId_key";
ALTER TABLE "leaseLine" ADD CONSTRAINT "leaseLine_id_leaseId_companyId_key"
  UNIQUE ("id", "leaseId", "companyId");

ALTER TABLE "leasePayment" DROP CONSTRAINT IF EXISTS "leasePayment_leaseLine_fkey";
ALTER TABLE "leasePayment" ADD CONSTRAINT "leasePayment_leaseLine_fkey"
  FOREIGN KEY ("leaseLineId", "leaseId", "companyId")
  REFERENCES "leaseLine"("id", "leaseId", "companyId") ON DELETE CASCADE;

ALTER TABLE "leaseScheduleLine" DROP CONSTRAINT IF EXISTS "leaseScheduleLine_leaseLine_fkey";
ALTER TABLE "leaseScheduleLine" ADD CONSTRAINT "leaseScheduleLine_leaseLine_fkey"
  FOREIGN KEY ("leaseLineId", "leaseId", "companyId")
  REFERENCES "leaseLine"("id", "leaseId", "companyId") ON DELETE CASCADE;

ALTER TABLE "leaseEvent" DROP CONSTRAINT IF EXISTS "leaseEvent_leaseLine_fkey";
ALTER TABLE "leaseEvent" ADD CONSTRAINT "leaseEvent_leaseLine_fkey"
  FOREIGN KEY ("leaseLineId", "leaseId", "companyId")
  REFERENCES "leaseLine"("id", "leaseId", "companyId") ON DELETE CASCADE;

-- An event's fixed asset (a Purchase's, or a terminated finance asset's) exists.
ALTER TABLE "leaseEvent" DROP CONSTRAINT IF EXISTS "leaseEvent_fixedAssetId_fkey";
ALTER TABLE "leaseEvent" ADD CONSTRAINT "leaseEvent_fixedAssetId_fkey"
  FOREIGN KEY ("fixedAssetId") REFERENCES "fixedAsset"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "leaseEvent_fixedAssetId_idx" ON "leaseEvent" ("fixedAssetId");

-- A lease run row posts one schedule line of one lease: it names both or neither.
ALTER TABLE "revenueRecognitionSchedule"
  DROP CONSTRAINT IF EXISTS "revenueRecognitionSchedule_lease_pairing_check";
ALTER TABLE "revenueRecognitionSchedule"
  ADD CONSTRAINT "revenueRecognitionSchedule_lease_pairing_check"
  CHECK (("leaseId" IS NULL) = ("leaseScheduleLineId" IS NULL));

-- 4) The lease list ------------------------------------------------------------------------
-- Forked from 20261012015739 (section 6). `currentLiability` is unchanged: over
-- the Active assets, the closing liability of the last schedule line a lease
-- run (or an opening balance) has put on the books, else the initial
-- liability; a Draft or Cancelled lease owes nothing. A running lease's count,
-- payment and classification are its Active assets'; an ended lease's (Expired,
-- Terminated, Purchased) are all of its assets'. A Draft or Cancelled lease has
-- no next payment due.
DROP VIEW IF EXISTS "leases";
CREATE VIEW "leases" WITH(SECURITY_INVOKER=true) AS
SELECT
  l.*,
  s."name" AS "supplierName",
  COALESCE(a."assetCount", 0) AS "assetCount",
  COALESCE(a."paymentAmount", 0) AS "paymentAmount",
  a."classification",
  CASE WHEN l."status" IN ('Draft', 'Cancelled') THEN NULL ELSE a."nextDueDate" END
    AS "nextDueDate",
  CASE WHEN l."status" IN ('Draft', 'Cancelled') THEN 0
    ELSE COALESCE(a."currentLiability", 0) END AS "currentLiability"
FROM "lease" l
JOIN "supplier" s ON s."id" = l."supplierId"
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE counted.yes)::INTEGER AS "assetCount",
    SUM(ll."paymentAmount") FILTER (WHERE counted.yes) AS "paymentAmount",
    CASE
      WHEN COUNT(DISTINCT ll."lesseeClassification") FILTER (WHERE counted.yes) = 1
        THEN MIN(ll."lesseeClassification"::TEXT) FILTER (WHERE counted.yes)
      WHEN COUNT(DISTINCT ll."lesseeClassification") FILTER (WHERE counted.yes) > 1
        THEN 'Mixed'
    END AS "classification",
    SUM(COALESCE(posted."closingLiability", ll."initialLiability", 0))
      FILTER (WHERE ll."status" = 'Active') AS "currentLiability",
    (
      SELECT MIN(p."dueDate") FROM "leasePayment" p
      WHERE p."leaseId" = l."id" AND p."companyId" = l."companyId"
        AND p."status" = 'Pending'
    ) AS "nextDueDate"
  FROM "leaseLine" ll
  CROSS JOIN LATERAL (
    SELECT l."status" IN ('Expired', 'Terminated', 'Purchased') OR ll."status" = 'Active' AS yes
  ) counted
  LEFT JOIN LATERAL (
    SELECT sl."closingLiability" FROM "leaseScheduleLine" sl
    WHERE sl."leaseLineId" = ll."id" AND sl."companyId" = ll."companyId"
      AND sl."postedAt" IS NOT NULL
    ORDER BY sl."periodDate" DESC
    LIMIT 1
  ) posted ON ll."status" = 'Active'
  WHERE ll."leaseId" = l."id" AND ll."companyId" = l."companyId"
) a ON TRUE;

NOTIFY pgrst, 'reload schema';
