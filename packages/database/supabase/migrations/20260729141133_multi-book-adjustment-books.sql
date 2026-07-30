-- Multi-Book Adjustment Books (GAP-5) — crbnos/carbon#1052
-- Tracking spec: .ai/specs/2026-07-04-multi-book.md
--
-- NetSuite-style adjustment-only books on a header-level journal.bookId. The
-- PRIMARY book receives 100% of operational postings; adjustment books hold
-- only deltas (manual JEs, book depreciation deltas, generator adjustments).
--
-- The first block ("accountingBook" / "accountingBookCompany" / journal.bookId)
-- is the SHARED book DDL contract co-owned with #1047 (record integrity). Both
-- specs cite this DDL; whichever migration lands first creates these, so every
-- statement guards with IF NOT EXISTS / DROP-then-CREATE and is safe to re-run.
--
-- The deploy runner does NOT wrap a migration in a transaction (see
-- 20260630093809_ar-ap-payments.sql), so a mid-file failure leaves committed
-- state behind — every statement here is idempotent. The new enum value
-- 'Book Adjustment' is never used as an enum literal in this file (the guard
-- trigger compares "sourceType"::text against text literals), so it is also
-- safe under a runner that DOES wrap the file in a transaction.

-- ============================================================
-- Enum: journalEntrySourceType += 'Book Adjustment'
-- ============================================================
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Book Adjustment';

-- ============================================================
-- Shared with #1047: accountingBook (group-scoped, like "account")
-- ============================================================
CREATE TABLE IF NOT EXISTS "accountingBook" (
  "id" TEXT NOT NULL DEFAULT id('book'),
  "companyGroupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'Adjustment',              -- 'Primary' | 'Adjustment'
  "accountingPrinciple" TEXT NOT NULL DEFAULT 'Local',    -- 'US-GAAP' | 'IFRS' | 'Local' | 'Tax'
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "accountingBook_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accountingBook_companyGroupId_fkey" FOREIGN KEY ("companyGroupId")
    REFERENCES "companyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "accountingBook_name_key" UNIQUE ("name", "companyGroupId"),
  CONSTRAINT "accountingBook_type_check" CHECK ("type" IN ('Primary', 'Adjustment')),
  CONSTRAINT "accountingBook_principle_check"
    CHECK ("accountingPrinciple" IN ('US-GAAP', 'IFRS', 'Local', 'Tax'))
);

-- Exactly one Primary book per company group.
CREATE UNIQUE INDEX IF NOT EXISTS "accountingBook_one_primary_idx"
  ON "accountingBook" ("companyGroupId") WHERE "type" = 'Primary';
CREATE INDEX IF NOT EXISTS "accountingBook_companyGroupId_idx"
  ON "accountingBook" ("companyGroupId");
CREATE INDEX IF NOT EXISTS "accountingBook_createdBy_idx"
  ON "accountingBook" ("createdBy");

ALTER TABLE "public"."accountingBook" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."accountingBook";
CREATE POLICY "SELECT" ON "public"."accountingBook"
  FOR SELECT USING (
    "companyGroupId" = ANY ((SELECT get_company_groups_for_employee())::text[])
  );

DROP POLICY IF EXISTS "INSERT" ON "public"."accountingBook";
CREATE POLICY "INSERT" ON "public"."accountingBook"
  FOR INSERT WITH CHECK (
    "companyGroupId" = ANY ((SELECT get_company_groups_for_root_permission('accounting_create'))::text[])
  );

DROP POLICY IF EXISTS "UPDATE" ON "public"."accountingBook";
CREATE POLICY "UPDATE" ON "public"."accountingBook"
  FOR UPDATE USING (
    "companyGroupId" = ANY ((SELECT get_company_groups_for_root_permission('accounting_update'))::text[])
  );

DROP POLICY IF EXISTS "DELETE" ON "public"."accountingBook";
CREATE POLICY "DELETE" ON "public"."accountingBook"
  FOR DELETE USING (
    "companyGroupId" = ANY ((SELECT get_company_groups_for_root_permission('accounting_delete'))::text[])
  );

-- Seed: one Primary (US-GAAP) book per existing company group.
INSERT INTO "accountingBook" ("companyGroupId", "name", "type", "accountingPrinciple", "createdBy")
SELECT cg."id", 'Primary', 'Primary', 'US-GAAP', 'system'
FROM "companyGroup" cg
WHERE NOT EXISTS (
  SELECT 1 FROM "accountingBook" ab
  WHERE ab."companyGroupId" = cg."id" AND ab."type" = 'Primary'
);

-- ============================================================
-- Shared with #1047: accountingBookCompany (per-company enablement)
-- ============================================================
CREATE TABLE IF NOT EXISTS "accountingBookCompany" (
  "id" TEXT NOT NULL DEFAULT id('bkco'),
  "companyId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL REFERENCES "accountingBook"("id") ON DELETE CASCADE,
  "effectiveFrom" DATE,                                   -- book adoption date (mid-life catch-up anchor)
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "accountingBookCompany_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "accountingBookCompany_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "accountingBookCompany_book_company_key" UNIQUE ("bookId", "companyId")
);

CREATE INDEX IF NOT EXISTS "accountingBookCompany_companyId_idx"
  ON "accountingBookCompany" ("companyId");
CREATE INDEX IF NOT EXISTS "accountingBookCompany_bookId_idx"
  ON "accountingBookCompany" ("bookId");
CREATE INDEX IF NOT EXISTS "accountingBookCompany_createdBy_idx"
  ON "accountingBookCompany" ("createdBy");

ALTER TABLE "public"."accountingBookCompany" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."accountingBookCompany";
CREATE POLICY "SELECT" ON "public"."accountingBookCompany"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "INSERT" ON "public"."accountingBookCompany";
CREATE POLICY "INSERT" ON "public"."accountingBookCompany"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
  );

DROP POLICY IF EXISTS "UPDATE" ON "public"."accountingBookCompany";
CREATE POLICY "UPDATE" ON "public"."accountingBookCompany"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
  );

DROP POLICY IF EXISTS "DELETE" ON "public"."accountingBookCompany";
CREATE POLICY "DELETE" ON "public"."accountingBookCompany"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
  );

-- Seed: enable each group's Primary book for every company in that group.
INSERT INTO "accountingBookCompany" ("companyId", "bookId", "createdBy")
SELECT c."id", ab."id", 'system'
FROM "company" c
JOIN "accountingBook" ab
  ON ab."companyGroupId" = c."companyGroupId" AND ab."type" = 'Primary'
WHERE c."companyGroupId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "accountingBookCompany" abc
    WHERE abc."bookId" = ab."id" AND abc."companyId" = c."id"
  );

-- ============================================================
-- Shared with #1047: journal.bookId
-- ============================================================
ALTER TABLE "journal" ADD COLUMN IF NOT EXISTS "bookId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_bookId_fkey'
  ) THEN
    ALTER TABLE "journal" ADD CONSTRAINT "journal_bookId_fkey"
      FOREIGN KEY ("bookId") REFERENCES "accountingBook"("id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "journal_bookId_idx" ON "journal" ("bookId", "companyId");

-- Backfill existing journals to their company group's Primary book.
UPDATE "journal" j
SET "bookId" = (
  SELECT ab."id"
  FROM "accountingBook" ab
  JOIN "company" c ON c."companyGroupId" = ab."companyGroupId"
  WHERE c."id" = j."companyId" AND ab."type" = 'Primary'
  LIMIT 1
)
WHERE j."bookId" IS NULL;
-- NOTE: bookId intentionally stays NULLABLE. A static SET NOT NULL would fail
-- on a company whose companyGroupId is NULL (companyGroup FK is ON DELETE SET
-- NULL). The journal_default_book trigger below stamps the Primary book on
-- every future insert, and reporting treats NULL bookId as Primary mode.

-- ============================================================
-- Default-book resolver: stamp the group's Primary book when bookId is NULL.
-- (design decision 4 — a static column DEFAULT can't point at per-group rows)
-- ============================================================
CREATE OR REPLACE FUNCTION public.journal_default_book()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW."bookId" IS NULL THEN
    SELECT ab."id" INTO NEW."bookId"
    FROM "accountingBook" ab
    JOIN "company" c ON c."companyGroupId" = ab."companyGroupId"
    WHERE c."id" = NEW."companyId" AND ab."type" = 'Primary'
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "journal_default_book" ON "journal";
CREATE TRIGGER "journal_default_book"
  BEFORE INSERT ON "journal"
  FOR EACH ROW EXECUTE FUNCTION public.journal_default_book();

-- ============================================================
-- Guardrail: adjustment books only accept accounting-sourced journals for a
-- company that has the book enabled. Operational posters (bookId NULL -> stamped
-- Primary) are unaffected. Binds the service role (SECURITY DEFINER).
-- ============================================================
CREATE OR REPLACE FUNCTION public.journal_adjustment_book_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_book_type TEXT;
BEGIN
  IF NEW."bookId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "type" INTO v_book_type FROM "accountingBook" WHERE "id" = NEW."bookId";

  IF v_book_type = 'Adjustment' THEN
    -- Comparing ::text against text literals keeps 'Book Adjustment' out of the
    -- enum-literal path, so this file is safe even under a txn-wrapping runner.
    IF NEW."sourceType" IS NULL
       OR NEW."sourceType"::text NOT IN ('Manual', 'Book Adjustment', 'Asset Depreciation') THEN
      RAISE EXCEPTION
        'Adjustment book journals must be Manual, Book Adjustment, or Asset Depreciation (got %)',
        NEW."sourceType";
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "accountingBookCompany"
      WHERE "bookId" = NEW."bookId" AND "companyId" = NEW."companyId"
    ) THEN
      RAISE EXCEPTION 'Accounting book % is not enabled for company %',
        NEW."bookId", NEW."companyId";
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "journal_adjustment_book_guard" ON "journal";
CREATE TRIGGER "journal_adjustment_book_guard"
  BEFORE INSERT OR UPDATE OF "bookId", "sourceType", "companyId" ON "journal"
  FOR EACH ROW EXECUTE FUNCTION public.journal_adjustment_book_guard();

-- ============================================================
-- This spec: fixedAssetBook (per-asset, per-book depreciation settings)
-- ============================================================
CREATE TABLE IF NOT EXISTS "fixedAssetBook" (
  "id" TEXT NOT NULL DEFAULT id('fab'),
  "companyId" TEXT NOT NULL,
  "fixedAssetId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL REFERENCES "accountingBook"("id") ON DELETE CASCADE,
  "depreciationMethod" "depreciationMethod" NOT NULL DEFAULT 'Straight Line',
  "usefulLifeMonths" INTEGER NOT NULL,
  "residualValuePercent" NUMERIC NOT NULL DEFAULT 0,
  "depreciationStartDate" DATE,
  "accumulatedDepreciation" NUMERIC NOT NULL DEFAULT 0,   -- full book-basis accumulated depreciation
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "fixedAssetBook_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "fixedAssetBook_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fixedAssetBook_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId")
    REFERENCES "fixedAsset"("id") ON DELETE CASCADE,
  CONSTRAINT "fixedAssetBook_asset_book_key" UNIQUE ("fixedAssetId", "bookId", "companyId"),
  -- Mirror fixedAssetBookValidator bounds (accounting.models.ts)
  CONSTRAINT "fixedAssetBook_usefulLifeMonths_check" CHECK ("usefulLifeMonths" > 0),
  CONSTRAINT "fixedAssetBook_residualValuePercent_check"
    CHECK ("residualValuePercent" >= 0 AND "residualValuePercent" <= 100),
  CONSTRAINT "fixedAssetBook_accumulatedDepreciation_check"
    CHECK ("accumulatedDepreciation" <> 'NaN'::numeric AND "accumulatedDepreciation" >= 0)
);

CREATE INDEX IF NOT EXISTS "fixedAssetBook_companyId_idx"
  ON "fixedAssetBook" ("companyId");
CREATE INDEX IF NOT EXISTS "fixedAssetBook_fixedAssetId_idx"
  ON "fixedAssetBook" ("fixedAssetId");
CREATE INDEX IF NOT EXISTS "fixedAssetBook_bookId_idx"
  ON "fixedAssetBook" ("bookId");
CREATE INDEX IF NOT EXISTS "fixedAssetBook_createdBy_idx"
  ON "fixedAssetBook" ("createdBy");

ALTER TABLE "public"."fixedAssetBook" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."fixedAssetBook";
CREATE POLICY "SELECT" ON "public"."fixedAssetBook"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "INSERT" ON "public"."fixedAssetBook";
CREATE POLICY "INSERT" ON "public"."fixedAssetBook"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
  );

DROP POLICY IF EXISTS "UPDATE" ON "public"."fixedAssetBook";
CREATE POLICY "UPDATE" ON "public"."fixedAssetBook"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
  );

DROP POLICY IF EXISTS "DELETE" ON "public"."fixedAssetBook";
CREATE POLICY "DELETE" ON "public"."fixedAssetBook"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
  );

-- ============================================================
-- This spec: depreciationRun.bookId (NULL = Primary run, unchanged)
-- ============================================================
ALTER TABLE "depreciationRun" ADD COLUMN IF NOT EXISTS "bookId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'depreciationRun_bookId_fkey'
  ) THEN
    ALTER TABLE "depreciationRun" ADD CONSTRAINT "depreciationRun_bookId_fkey"
      FOREIGN KEY ("bookId") REFERENCES "accountingBook"("id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "depreciationRun_bookId_idx"
  ON "depreciationRun" ("bookId", "companyId");

-- ============================================================
-- This spec: bookAdjustmentRun (generator idempotency + close evidence)
-- ============================================================
CREATE TABLE IF NOT EXISTS "bookAdjustmentRun" (
  "id" TEXT NOT NULL DEFAULT id('bar'),
  "companyId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL REFERENCES "accountingBook"("id"),
  "accountingPeriodId" TEXT NOT NULL REFERENCES "accountingPeriod"("id"),
  "generatorKey" TEXT NOT NULL,                           -- registry key
  "status" TEXT NOT NULL DEFAULT 'Draft',                 -- 'Draft' | 'Posted' | 'Skipped'
  "journalIds" TEXT[] NOT NULL DEFAULT '{}',
  "skippedReason" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "bookAdjustmentRun_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "bookAdjustmentRun_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bookAdjustmentRun_unique_key"
    UNIQUE ("accountingPeriodId", "bookId", "generatorKey", "companyId"),
  CONSTRAINT "bookAdjustmentRun_status_check" CHECK ("status" IN ('Draft', 'Posted', 'Skipped'))
);

CREATE INDEX IF NOT EXISTS "bookAdjustmentRun_companyId_idx"
  ON "bookAdjustmentRun" ("companyId");
CREATE INDEX IF NOT EXISTS "bookAdjustmentRun_bookId_idx"
  ON "bookAdjustmentRun" ("bookId");
CREATE INDEX IF NOT EXISTS "bookAdjustmentRun_accountingPeriodId_idx"
  ON "bookAdjustmentRun" ("accountingPeriodId");
CREATE INDEX IF NOT EXISTS "bookAdjustmentRun_createdBy_idx"
  ON "bookAdjustmentRun" ("createdBy");

ALTER TABLE "public"."bookAdjustmentRun" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."bookAdjustmentRun";
CREATE POLICY "SELECT" ON "public"."bookAdjustmentRun"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  );

DROP POLICY IF EXISTS "INSERT" ON "public"."bookAdjustmentRun";
CREATE POLICY "INSERT" ON "public"."bookAdjustmentRun"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
  );

DROP POLICY IF EXISTS "UPDATE" ON "public"."bookAdjustmentRun";
CREATE POLICY "UPDATE" ON "public"."bookAdjustmentRun"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
  );

DROP POLICY IF EXISTS "DELETE" ON "public"."bookAdjustmentRun";
CREATE POLICY "DELETE" ON "public"."bookAdjustmentRun"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
  );
