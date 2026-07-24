-- Gapless Numbering & Legal Series (readiness finding SD-2)
-- Tracking spec: .ai/specs/2026-07-04-gapless-numbering-legal-series.md
-- Tracking issue: crbnos/carbon#1038
--
-- Additive, backward-compatible foundation for gapless accounting document
-- numbers and the statutory legal-series substrate:
--   1. "sequence" hardening columns + immutable-after-first-use trigger (all roles)
--   2. atomic allocators get_next_sequence_atomic / get_next_legal_series_number
--   3. "legalSeries" statutory-series substrate (table + RLS + immutability trigger)
--   4. draft number columns become NULL-able, backstopped by status CHECKs
--   5. per-company "gaplessFrom" cutover stamp for accounting-active companies
--
-- DEFERRED to the coordinated posting-time PR wave (Decision 15 — needs the DB
-- types regenerated against this migration plus the app-layer draft->post change):
--   * the get_next_sequence RPC RAISE guard for the six accounting sequences, and
--   * moving document-number allocation from draft creation to posting time, and
--   * the draft placeholder / sequence-lock / legal-series settings UI.
-- Enabling the RPC guard *here* would break unmigrated app callers that still
-- allocate at draft creation (invoice/payment/memo creation, reverseJournalEntry,
-- Xero bill sync), so it must land with those callers, not before them. Every
-- change in this file is additive and leaves current flows intact.

-- ============================================================================
-- 1. "sequence" hardening
-- ============================================================================
ALTER TABLE "sequence"
  ADD COLUMN IF NOT EXISTS "isLegalSequence" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "firstUsedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "gaplessFrom" TIMESTAMP WITH TIME ZONE;

-- The six accounting document sequences are gapless/immutable; operational
-- sequences (quote, job, purchaseOrder, ...) keep today's editability.
UPDATE "sequence" SET "isLegalSequence" = true
WHERE "table" IN (
  'journalEntry', 'payment', 'creditMemo', 'debitMemo', 'salesInvoice', 'purchaseInvoice'
) AND "isLegalSequence" = false;

-- Immutable-after-first-use backstop. SECURITY DEFINER so it binds the service
-- role, edge functions, and SECURITY DEFINER posters — not just PostgREST callers
-- (period-close backstop precedent 20260702044133). Once a legal sequence has
-- been used, its format is frozen and "next" may only increase; delete is
-- rejected. This closes the rewind->duplicate and format-fork holes.
CREATE OR REPLACE FUNCTION public."sequenceImmutabilityCheck"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."isLegalSequence" AND OLD."firstUsedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Used accounting sequence % cannot be deleted', OLD."table";
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."isLegalSequence" AND OLD."firstUsedAt" IS NOT NULL THEN
    IF NEW."prefix"    IS DISTINCT FROM OLD."prefix"
    OR NEW."suffix"    IS DISTINCT FROM OLD."suffix"
    OR NEW."size"      IS DISTINCT FROM OLD."size"
    OR NEW."step"      IS DISTINCT FROM OLD."step"
    OR NEW."table"     IS DISTINCT FROM OLD."table"
    OR NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
      RAISE EXCEPTION 'Accounting sequence % format is immutable after first use', OLD."table";
    END IF;
    IF NEW."next" < OLD."next" THEN
      RAISE EXCEPTION 'Accounting sequence % cannot be rewound (% -> %)', OLD."table", OLD."next", NEW."next";
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "sequenceImmutability" ON "sequence";
CREATE TRIGGER "sequenceImmutability"
  BEFORE UPDATE OR DELETE ON "sequence"
  FOR EACH ROW EXECUTE FUNCTION public."sequenceImmutabilityCheck"();

-- ============================================================================
-- 2. Atomic allocators
--
-- A single-statement UPDATE...RETURNING: the ordinary row lock the UPDATE takes
-- is the serialization point (race-free by construction — this kills the current
-- SELECT-then-UPDATE duplicate race — and one round trip). Call these INSIDE the
-- posting transaction (Kysely trx / plpgsql poster) so a rollback reverts the
-- increment together with the document: no gap on failure. The row lock scope is
-- one company x one document type, so different companies never contend.
-- SECURITY DEFINER + the same permission preamble as get_next_sequence.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_next_sequence_atomic(
  sequence_name text,
  company_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_suffix text;
  v_next integer;
  v_size integer;
BEGIN
  IF session_user = 'authenticator' THEN
    IF NOT (
      company_id = ANY ((SELECT get_companies_with_employee_role())::text[])
      OR has_valid_api_key_for_company(company_id)
    ) THEN
      RAISE EXCEPTION 'Insufficient permissions';
    END IF;
  END IF;

  UPDATE "sequence"
     SET "next" = "next" + "step",
         "firstUsedAt" = COALESCE("firstUsedAt", NOW()),
         "updatedAt" = NOW(),
         "updatedBy" = 'system'
   WHERE "table" = sequence_name
     AND "companyId" = company_id
   RETURNING "prefix", "suffix", "next", "size"
   INTO STRICT v_prefix, v_suffix, v_next, v_size;

  -- Interpolate the issuance-date labels exactly as get_next_sequence does; the
  -- integer counter never resets, so numbers stay strictly chronological.
  v_prefix := COALESCE(v_prefix, '');
  v_prefix := replace(v_prefix, '%{yyyy}', to_char(current_date, 'YYYY'));
  v_prefix := replace(v_prefix, '%{yy}',   to_char(current_date, 'YY'));
  v_prefix := replace(v_prefix, '%{mm}',   to_char(current_date, 'MM'));
  v_prefix := replace(v_prefix, '%{dd}',   to_char(current_date, 'DD'));

  v_suffix := COALESCE(v_suffix, '');
  v_suffix := replace(v_suffix, '%{yyyy}', to_char(current_date, 'YYYY'));
  v_suffix := replace(v_suffix, '%{yy}',   to_char(current_date, 'YY'));
  v_suffix := replace(v_suffix, '%{mm}',   to_char(current_date, 'MM'));
  v_suffix := replace(v_suffix, '%{dd}',   to_char(current_date, 'DD'));

  RETURN v_prefix || lpad(v_next::text, COALESCE(v_size, 4), '0') || v_suffix;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'Sequence not found for table % and company %', sequence_name, company_id;
END;
$$;

-- One legal series = one independent gapless counter. Same atomic mechanism,
-- same posting-transaction rule. Increment is always 1 (series have no step);
-- format is prefix || lpad(next, size, '0'). Callers (the e-invoicing spec,
-- #1054) invoke this inside the posting transaction.
CREATE OR REPLACE FUNCTION get_next_legal_series_number(
  series_id text,
  company_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_next integer;
  v_size integer;
BEGIN
  IF session_user = 'authenticator' THEN
    IF NOT (
      company_id = ANY ((SELECT get_companies_with_employee_role())::text[])
      OR has_valid_api_key_for_company(company_id)
    ) THEN
      RAISE EXCEPTION 'Insufficient permissions';
    END IF;
  END IF;

  UPDATE "legalSeries"
     SET "next" = "next" + 1,
         "firstUsedAt" = COALESCE("firstUsedAt", NOW()),
         "updatedAt" = NOW(),
         "updatedBy" = 'system'
   WHERE "id" = series_id
     AND "companyId" = company_id
     AND "isActive" = true
   RETURNING "prefix", "next", "size"
   INTO STRICT v_prefix, v_next, v_size;

  RETURN COALESCE(v_prefix, '') || lpad(v_next::text, COALESCE(v_size, 6), '0');
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'Active legal series not found for id % and company %', series_id, company_id;
END;
$$;

-- ============================================================================
-- 3. "legalSeries" — statutory gapless-series substrate for customer-facing
--    documents (sales invoices, credit memos; journals need gaplessness, not a
--    series). This migration ships the table, allocator, and nullable document
--    columns; series selection, ATCUD / hash-chaining, and format rendering are
--    the e-invoicing spec's job (#1054).
-- ============================================================================
CREATE TABLE IF NOT EXISTS "legalSeries" (
    "id" TEXT NOT NULL DEFAULT id('ls'),
    "companyId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,                    -- ISO 3166-1 alpha-2
    "documentType" TEXT NOT NULL,                   -- 'salesInvoice' | 'creditMemo'
    "code" TEXT NOT NULL,                           -- series code, e.g. 'FT2026A'
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 6 CHECK ("size" >= 1),
    "next" INTEGER NOT NULL DEFAULT 0 CHECK ("next" >= 0),
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstUsedAt" TIMESTAMP WITH TIME ZONE,
    "registrationRef" TEXT,                         -- e.g. PT ATCUD code (opaque here)
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "legalSeries_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "legalSeries_documentType_check"
      CHECK ("documentType" IN ('salesInvoice', 'creditMemo')),
    CONSTRAINT "legalSeries_unique" UNIQUE ("companyId", "countryCode", "documentType", "code"),
    CONSTRAINT "legalSeries_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "legalSeries_companyId_idx" ON "legalSeries" ("companyId");
CREATE INDEX IF NOT EXISTS "legalSeries_createdBy_idx" ON "legalSeries" ("createdBy");
-- At most one active default series per company x country x document type.
CREATE UNIQUE INDEX IF NOT EXISTS "legalSeries_default_key" ON "legalSeries"
  ("companyId", "countryCode", "documentType") WHERE "isDefault" AND "isActive";

ALTER TABLE "public"."legalSeries" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."legalSeries";
CREATE POLICY "SELECT" ON "public"."legalSeries"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."legalSeries";
CREATE POLICY "INSERT" ON "public"."legalSeries"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."legalSeries";
CREATE POLICY "UPDATE" ON "public"."legalSeries"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

DROP POLICY IF EXISTS "DELETE" ON "public"."legalSeries";
CREATE POLICY "DELETE" ON "public"."legalSeries"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- Same immutability family as "sequence": format frozen + "next" monotonic + no
-- delete after first use. Retirement is validTo/isActive, never removal.
CREATE OR REPLACE FUNCTION public."legalSeriesImmutabilityCheck"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."firstUsedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Used legal series % cannot be deleted; deactivate it instead', OLD."code";
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."firstUsedAt" IS NOT NULL THEN
    IF NEW."prefix"       IS DISTINCT FROM OLD."prefix"
    OR NEW."size"         IS DISTINCT FROM OLD."size"
    OR NEW."countryCode"  IS DISTINCT FROM OLD."countryCode"
    OR NEW."documentType" IS DISTINCT FROM OLD."documentType"
    OR NEW."code"         IS DISTINCT FROM OLD."code"
    OR NEW."companyId"    IS DISTINCT FROM OLD."companyId" THEN
      RAISE EXCEPTION 'Legal series % format is immutable after first use', OLD."code";
    END IF;
    IF NEW."next" < OLD."next" THEN
      RAISE EXCEPTION 'Legal series % cannot be rewound (% -> %)', OLD."code", OLD."next", NEW."next";
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "legalSeriesImmutability" ON "legalSeries";
CREATE TRIGGER "legalSeriesImmutability"
  BEFORE UPDATE OR DELETE ON "legalSeries"
  FOR EACH ROW EXECUTE FUNCTION public."legalSeriesImmutabilityCheck"();

-- Nullable legal-number columns on the customer-facing documents. Companies with
-- no series configured are unaffected: the (now gapless) document number remains
-- the identity and "legalNumber" stays NULL. Wiring is #1054's job.
ALTER TABLE "salesInvoice"
  ADD COLUMN IF NOT EXISTS "legalSeriesId" TEXT,
  ADD COLUMN IF NOT EXISTS "legalNumber" TEXT;
ALTER TABLE "memo"
  ADD COLUMN IF NOT EXISTS "legalSeriesId" TEXT,
  ADD COLUMN IF NOT EXISTS "legalNumber" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "salesInvoice_legalNumber_key"
  ON "salesInvoice" ("companyId", "legalSeriesId", "legalNumber") WHERE "legalNumber" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "memo_legalNumber_key"
  ON "memo" ("companyId", "legalSeriesId", "legalNumber") WHERE "legalNumber" IS NOT NULL;

-- ============================================================================
-- 4. Drafts carry no legal number
--
-- The number columns become NULL-able, backstopped by a status CHECK: a row may
-- lack its number only while Draft. Every existing row carries a number, so the
-- CHECK holds immediately and no history changes. The pre-existing
-- UNIQUE (numberCol, companyId) constraints are NULLS-DISTINCT in Postgres, so
-- they already tolerate multiple number-less drafts — no partial index needed.
-- New drafts stay numbered until the coordinated posting-time wave flips
-- allocation to post time (Decision 15); the approvals spec (#1032) later widens
-- the permissive side of each CHECK to include its parked status.
-- ============================================================================
-- ADD CONSTRAINT ... NOT VALID skips the full-table validation scan (which holds
-- a lock that blocks concurrent DML for its duration); the follow-up VALIDATE
-- CONSTRAINT re-checks existing rows under a lighter lock that does not block
-- reads/writes. Every existing row already satisfies the predicate (all rows are
-- numbered today), so validation succeeds immediately.
ALTER TABLE "journal" ALTER COLUMN "journalEntryId" DROP NOT NULL;
ALTER TABLE "journal" ADD CONSTRAINT "journal_posted_requires_number"
  CHECK ("status" = 'Draft' OR "journalEntryId" IS NOT NULL) NOT VALID;
ALTER TABLE "journal" VALIDATE CONSTRAINT "journal_posted_requires_number";

ALTER TABLE "payment" ALTER COLUMN "paymentId" DROP NOT NULL;
ALTER TABLE "payment" ADD CONSTRAINT "payment_posted_requires_number"
  CHECK ("status" = 'Draft' OR "paymentId" IS NOT NULL) NOT VALID;
ALTER TABLE "payment" VALIDATE CONSTRAINT "payment_posted_requires_number";

ALTER TABLE "memo" ALTER COLUMN "memoId" DROP NOT NULL;
ALTER TABLE "memo" ADD CONSTRAINT "memo_posted_requires_number"
  CHECK ("status" = 'Draft' OR "memoId" IS NOT NULL) NOT VALID;
ALTER TABLE "memo" VALIDATE CONSTRAINT "memo_posted_requires_number";

ALTER TABLE "salesInvoice" ALTER COLUMN "invoiceId" DROP NOT NULL;
ALTER TABLE "salesInvoice" ADD CONSTRAINT "salesInvoice_posted_requires_number"
  CHECK ("status" = 'Draft' OR "invoiceId" IS NOT NULL) NOT VALID;
ALTER TABLE "salesInvoice" VALIDATE CONSTRAINT "salesInvoice_posted_requires_number";

ALTER TABLE "purchaseInvoice" ALTER COLUMN "invoiceId" DROP NOT NULL;
ALTER TABLE "purchaseInvoice" ADD CONSTRAINT "purchaseInvoice_posted_requires_number"
  CHECK ("status" = 'Draft' OR "invoiceId" IS NOT NULL) NOT VALID;
ALTER TABLE "purchaseInvoice" VALIDATE CONSTRAINT "purchaseInvoice_posted_requires_number";

-- ============================================================================
-- 5. Forward-only cutover stamp
--
-- Accounting-active companies today assert gaplessness from now; everyone else
-- is stamped at accounting activation (#1057). Earlier gaps predate the control
-- and are documented via this boundary, never repaired — nothing is renumbered.
-- firstUsedAt is still NULL everywhere at this point, so the immutability trigger
-- permits this UPDATE (and gaplessFrom is not a frozen column regardless).
-- ============================================================================
UPDATE "sequence" s
SET "gaplessFrom" = NOW()
WHERE s."isLegalSequence" = true
  AND s."gaplessFrom" IS NULL
  AND EXISTS (
    SELECT 1 FROM "companySettings" cs
    WHERE cs."id" = s."companyId" AND cs."accountingEnabled" = true
  );
