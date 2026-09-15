-- Fixed-assets completeness (issue #1041) — schema foundation.
--
-- Spec: .ai/specs/2026-07-04-fixed-assets-completeness.md
--
-- Scope of THIS migration (additive, idempotent — safe to retry over a partially
-- applied state): the schema for the still-missing fixed-asset capabilities —
-- partial disposals, impairment, construction-in-progress (CIP), component assets,
-- and class transfers. Disposal-with-proceeds gain/loss posting already shipped in
-- 20260717031529_split-asset-gain-loss-disposal-accounts.sql (Gain/Loss on Disposal
-- accounts + the postDisposal / post-sales-invoice rewrites), so it is NOT re-done
-- here.
--
-- The service/posting/edge/UI layers that consume this schema, the CIP class seed,
-- and every journal-level behavior are follow-up work — see the tracking issue.
--
-- Enum values used below (`Under Construction`, `Asset Impairment`, `Asset
-- Transfer`) are added in 20260721143207_fixed-asset-completeness-enums.sql.
--
-- Convention note: the existing fixed-asset tables predate the current table
-- convention (they use xid() defaults + single-column ("id") PKs). The NEW tables
-- here follow the CURRENT convention (id('prefix') default, composite PK
-- ("id","companyId"), audit columns incl. updatedBy, four accounting_* RLS
-- policies), per spec decision 9. FKs still target the existing single-column
-- ("id") PKs on fixedAsset / fixedAssetClass.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. fixedAsset: component assets + impairment tracking
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "fixedAsset"
  ADD COLUMN IF NOT EXISTS "parentFixedAssetId" TEXT REFERENCES "fixedAsset"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "accumulatedImpairment" NUMERIC NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "fixedAsset_parentFixedAssetId_idx"
  ON "fixedAsset" ("parentFixedAssetId");

-- One-level components only (IAS 16.43): a component cannot itself have children,
-- and an asset that already has children cannot become a component. Purpose-built
-- integrity trigger (no generic boilerplate trigger exists in this codebase).
CREATE OR REPLACE FUNCTION check_fixed_asset_component_depth() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."parentFixedAssetId" IS NOT NULL THEN
    IF NEW."parentFixedAssetId" = NEW."id" THEN
      RAISE EXCEPTION 'A fixed asset cannot be its own parent';
    END IF;
    -- The chosen parent must not itself be a component.
    IF EXISTS (
      SELECT 1 FROM "fixedAsset"
      WHERE "id" = NEW."parentFixedAssetId" AND "parentFixedAssetId" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'A component cannot be nested under another component (one level only)';
    END IF;
    -- This asset must not already have components of its own.
    IF EXISTS (
      SELECT 1 FROM "fixedAsset" WHERE "parentFixedAssetId" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'An asset that already has components cannot itself become a component';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_fixed_asset_component_depth_trigger ON "fixedAsset";
CREATE TRIGGER check_fixed_asset_component_depth_trigger
  BEFORE INSERT OR UPDATE OF "parentFixedAssetId" ON "fixedAsset"
  FOR EACH ROW EXECUTE FUNCTION check_fixed_asset_component_depth();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. fixedAssetClass: construction-in-progress flag
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "fixedAssetClass"
  ADD COLUMN IF NOT EXISTS "isConstructionInProgress" BOOLEAN NOT NULL DEFAULT FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. fixedAssetDisposal: proceeds linkage + partial-disposal snapshots (additive)
-- ─────────────────────────────────────────────────────────────────────────────
-- disposalFraction = 1 reproduces today's full disposal. The disposed* snapshot
-- columns freeze cost / accumulated balances at posting time so a partial-disposal
-- row stays self-auditing after the asset's live balances shrink.

ALTER TABLE "fixedAssetDisposal"
  ADD COLUMN IF NOT EXISTS "salesInvoiceLineId" TEXT REFERENCES "salesInvoiceLine"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "proceedsAccountId" TEXT REFERENCES "account"("id"),
  ADD COLUMN IF NOT EXISTS "disposalFraction" NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "disposedCost" NUMERIC,
  ADD COLUMN IF NOT EXISTS "disposedAccumulatedDepreciation" NUMERIC,
  ADD COLUMN IF NOT EXISTS "disposedAccumulatedImpairment" NUMERIC;

CREATE INDEX IF NOT EXISTS "fixedAssetDisposal_salesInvoiceLineId_idx"
  ON "fixedAssetDisposal" ("salesInvoiceLineId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. fixedAssetImpairment — impairment document (header + lines), Draft → Posted
-- ─────────────────────────────────────────────────────────────────────────────
-- Loss = max(0, NBV − recoverable); NBV = acquisitionCost − accumulatedDepreciation
-- − accumulatedImpairment. Posting (follow-up) books Dr class writeDownAccountId /
-- Cr class accumulatedDepreciationAccountId (contra), tracking the slice on
-- fixedAsset.accumulatedImpairment — no new account FK on fixedAssetClass.

CREATE TABLE IF NOT EXISTS "fixedAssetImpairment" (
  "id" TEXT NOT NULL DEFAULT id('faim'),
  "companyId" TEXT NOT NULL,
  "impairmentId" TEXT NOT NULL,
  "scope" TEXT NOT NULL CHECK ("scope" IN ('Asset', 'Class')),
  "fixedAssetClassId" TEXT REFERENCES "fixedAssetClass"("id") ON DELETE RESTRICT,
  "testDate" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft', 'Posted')),
  "notes" TEXT,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"("id"),

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "fixedAssetImpairment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "fixedAssetImpairment_id_key" UNIQUE ("id"),
  CONSTRAINT "fixedAssetImpairment_impairmentId_companyId_key" UNIQUE ("impairmentId", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "fixedAssetImpairment_companyId_idx" ON "fixedAssetImpairment" ("companyId");
CREATE INDEX IF NOT EXISTS "fixedAssetImpairment_fixedAssetClassId_idx" ON "fixedAssetImpairment" ("fixedAssetClassId");
CREATE INDEX IF NOT EXISTS "fixedAssetImpairment_createdBy_idx" ON "fixedAssetImpairment" ("createdBy");

CREATE TABLE IF NOT EXISTS "fixedAssetImpairmentLine" (
  "id" TEXT NOT NULL DEFAULT id('fail'),
  "companyId" TEXT NOT NULL,
  "impairmentId" TEXT NOT NULL REFERENCES "fixedAssetImpairment"("id") ON DELETE CASCADE,
  "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
  "netBookValue" NUMERIC NOT NULL,
  "recoverableAmount" NUMERIC NOT NULL,
  "impairmentLoss" NUMERIC NOT NULL,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "fixedAssetImpairmentLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "fixedAssetImpairmentLine_asset_key" UNIQUE ("impairmentId", "fixedAssetId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "fixedAssetImpairmentLine_companyId_idx" ON "fixedAssetImpairmentLine" ("companyId");
CREATE INDEX IF NOT EXISTS "fixedAssetImpairmentLine_impairmentId_idx" ON "fixedAssetImpairmentLine" ("impairmentId");
CREATE INDEX IF NOT EXISTS "fixedAssetImpairmentLine_fixedAssetId_idx" ON "fixedAssetImpairmentLine" ("fixedAssetId");
CREATE INDEX IF NOT EXISTS "fixedAssetImpairmentLine_createdBy_idx" ON "fixedAssetImpairmentLine" ("createdBy");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. fixedAssetCipCost — append-only CIP cost ledger
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per accumulated cost onto a CIP asset (Fixed Asset PO line or job cost).
-- Append-only: updatedBy exists (mandatory) but stays NULL.

CREATE TABLE IF NOT EXISTS "fixedAssetCipCost" (
  "id" TEXT NOT NULL DEFAULT id('facc'),
  "companyId" TEXT NOT NULL,
  "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
  "sourceType" TEXT NOT NULL CHECK ("sourceType" IN ('Purchase Invoice', 'Receipt', 'Job', 'Manual')),
  "sourceDocumentId" TEXT,
  "sourceDocumentLineId" TEXT,
  "jobId" TEXT REFERENCES "job"("id") ON DELETE SET NULL,
  "amount" NUMERIC NOT NULL,
  "costDate" DATE NOT NULL,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "fixedAssetCipCost_pkey" PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_companyId_idx" ON "fixedAssetCipCost" ("companyId");
CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_fixedAssetId_idx" ON "fixedAssetCipCost" ("fixedAssetId");
CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_jobId_idx" ON "fixedAssetCipCost" ("jobId");
CREATE INDEX IF NOT EXISTS "fixedAssetCipCost_createdBy_idx" ON "fixedAssetCipCost" ("createdBy");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. fixedAssetTransfer — capitalization + reclassification, Draft → Posted
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "fixedAssetTransfer" (
  "id" TEXT NOT NULL DEFAULT id('fatr'),
  "companyId" TEXT NOT NULL,
  "transferId" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('Capitalization', 'Reclassification')),
  "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
  "fromClassId" TEXT NOT NULL REFERENCES "fixedAssetClass"("id") ON DELETE RESTRICT,
  "toClassId" TEXT NOT NULL REFERENCES "fixedAssetClass"("id") ON DELETE RESTRICT,
  "transferDate" DATE NOT NULL,
  "inServiceDate" DATE,
  "transferredCost" NUMERIC NOT NULL,
  "transferredAccumulatedDepreciation" NUMERIC NOT NULL DEFAULT 0,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft', 'Posted')),
  "notes" TEXT,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"("id"),

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "fixedAssetTransfer_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "fixedAssetTransfer_transferId_companyId_key" UNIQUE ("transferId", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_companyId_idx" ON "fixedAssetTransfer" ("companyId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_fixedAssetId_idx" ON "fixedAssetTransfer" ("fixedAssetId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_fromClassId_idx" ON "fixedAssetTransfer" ("fromClassId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_toClassId_idx" ON "fixedAssetTransfer" ("toClassId");
CREATE INDEX IF NOT EXISTS "fixedAssetTransfer_createdBy_idx" ON "fixedAssetTransfer" ("createdBy");

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS — four accounting_* policies per new table
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT gated on accounting_view to match the existing fixed-asset tables (which
-- read via accounting_view rather than get_companies_with_employee_role()). Drop-
-- before-create keeps the block idempotent across deploy retries.

ALTER TABLE "public"."fixedAssetImpairment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."fixedAssetImpairment";
CREATE POLICY "SELECT" ON "public"."fixedAssetImpairment"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."fixedAssetImpairment";
CREATE POLICY "INSERT" ON "public"."fixedAssetImpairment"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."fixedAssetImpairment";
CREATE POLICY "UPDATE" ON "public"."fixedAssetImpairment"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."fixedAssetImpairment";
CREATE POLICY "DELETE" ON "public"."fixedAssetImpairment"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

ALTER TABLE "public"."fixedAssetImpairmentLine" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."fixedAssetImpairmentLine";
CREATE POLICY "SELECT" ON "public"."fixedAssetImpairmentLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."fixedAssetImpairmentLine";
CREATE POLICY "INSERT" ON "public"."fixedAssetImpairmentLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."fixedAssetImpairmentLine";
CREATE POLICY "UPDATE" ON "public"."fixedAssetImpairmentLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."fixedAssetImpairmentLine";
CREATE POLICY "DELETE" ON "public"."fixedAssetImpairmentLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

ALTER TABLE "public"."fixedAssetCipCost" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."fixedAssetCipCost";
CREATE POLICY "SELECT" ON "public"."fixedAssetCipCost"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."fixedAssetCipCost";
CREATE POLICY "INSERT" ON "public"."fixedAssetCipCost"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."fixedAssetCipCost";
CREATE POLICY "UPDATE" ON "public"."fixedAssetCipCost"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."fixedAssetCipCost";
CREATE POLICY "DELETE" ON "public"."fixedAssetCipCost"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

ALTER TABLE "public"."fixedAssetTransfer" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."fixedAssetTransfer";
CREATE POLICY "SELECT" ON "public"."fixedAssetTransfer"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."fixedAssetTransfer";
CREATE POLICY "INSERT" ON "public"."fixedAssetTransfer"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."fixedAssetTransfer";
CREATE POLICY "UPDATE" ON "public"."fixedAssetTransfer"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."fixedAssetTransfer";
CREATE POLICY "DELETE" ON "public"."fixedAssetTransfer"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Readable-id sequences for the two documents (mirrors the fixedAsset seed)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'fixedAssetImpairment', 'Asset Impairment', 'IMP', NULL, 1, 6, 1, "id" FROM "company"
ON CONFLICT DO NOTHING;

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'fixedAssetTransfer', 'Asset Transfer', 'FAT', NULL, 1, 6, 1, "id" FROM "company"
ON CONFLICT DO NOTHING;
