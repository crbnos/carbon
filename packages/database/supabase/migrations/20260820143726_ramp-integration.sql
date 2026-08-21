-- ============================================================
-- Ramp Integration — card transaction sync
--
-- Registers the Ramp integration and adds the cardTransaction /
-- cardTransactionLine document family plus its posting-journal enum
-- values, RLS, and per-company numbering sequence.
--
-- cardTransaction is a payment-shaped document (single-column TEXT PK,
-- Draft/Posted/Voided lifecycle, journalId + posted/voided audit) — it
-- deliberately mirrors the `payment` sibling from
-- 20260630093809_ar-ap-payments.sql, NOT the composite-PK table template.
--
-- This migration is NOT run in a transaction by the deploy runner (a
-- mid-file failure leaves committed state behind), and the runner retries
-- a failed file over that partial state — every statement here must be
-- idempotent and safe to re-run.
-- ============================================================


-- ============================================================
-- Phase 1: Integration registry row
-- ============================================================
-- companyIntegration.id has an FK to integration.id, so installing the
-- integration fails without this row. Clone of the rillet registry insert.

INSERT INTO "integration" ("id", "jsonschema")
VALUES ('ramp', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;


-- ============================================================
-- Phase 2: Journal enum values
-- ============================================================
-- Added at the top of the file, and NOT referenced by any DML in this same
-- migration — a value added by ALTER TYPE ... ADD VALUE cannot be used until
-- the adding statement has committed. post-card-transaction writes its journal
-- header with sourceType 'Card Transaction' and its lines with documentType
-- 'Card Transaction'.

ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Card Transaction';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Card Transaction';


-- ============================================================
-- Phase 3: cardTransaction enums
-- ============================================================
-- CREATE TYPE has no IF NOT EXISTS; guard each so a re-run after a partial
-- deploy doesn't trip on an already-created type.

DO $$ BEGIN
  CREATE TYPE "cardTransactionType" AS ENUM ('Charge', 'Credit', 'Payment', 'Cashback', 'Repayment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "cardTransactionStatus" AS ENUM ('Draft', 'Posted', 'Voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================
-- Phase 4: cardTransaction table
-- ============================================================
-- The card spend event. Charge/Credit carry coding lines; Payment/Cashback/
-- Repayment settle against an offset account. Mirrors the `payment` sibling:
-- single-column TEXT PK, Draft-editable / Posted-then-Voided lifecycle.

CREATE TABLE IF NOT EXISTS "cardTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "cardTransactionId" TEXT NOT NULL,
  "type" "cardTransactionType" NOT NULL DEFAULT 'Charge',
  "status" "cardTransactionStatus" NOT NULL DEFAULT 'Draft',
  "integration" TEXT NOT NULL DEFAULT 'ramp',
  "cardAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "offsetAccountId" TEXT REFERENCES "account"("id"),
  "merchantName" TEXT,
  "cardHolderName" TEXT,
  "cardLast4" TEXT,
  "memo" TEXT,
  "transactionDate" DATE NOT NULL,
  "postingDate" DATE,
  "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"("code"),
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1 CHECK ("exchangeRate" > 0),
  "amount" NUMERIC NOT NULL CHECK ("amount" >= 0),
  "journalId" TEXT REFERENCES "journal"("id"),
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"("id"),
  "voidedAt" TIMESTAMP WITH TIME ZONE,
  "voidedBy" TEXT REFERENCES "user"("id"),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "cardTransaction_cardTransactionId_companyId_key" UNIQUE ("cardTransactionId", "companyId"),
  -- Payment/Cashback/Repayment need an offset account; Charge/Credit use lines.
  CONSTRAINT "cardTransaction_offset_check" CHECK (
    "type" IN ('Charge', 'Credit') OR "offsetAccountId" IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS "cardTransaction_companyId_idx" ON "cardTransaction" ("companyId");
CREATE INDEX IF NOT EXISTS "cardTransaction_companyId_status_idx" ON "cardTransaction" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "cardTransaction_companyId_transactionDate_idx" ON "cardTransaction" ("companyId", "transactionDate");
CREATE INDEX IF NOT EXISTS "cardTransaction_journalId_idx" ON "cardTransaction" ("journalId");
CREATE INDEX IF NOT EXISTS "cardTransaction_createdBy_idx" ON "cardTransaction" ("createdBy");


-- ============================================================
-- Phase 5: cardTransactionLine table
-- ============================================================
-- Coding lines for Charge/Credit/Repayment card transactions. Each line codes
-- an amount to a GL account, optionally tagged with a cost center.

CREATE TABLE IF NOT EXISTS "cardTransactionLine" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "cardTransactionId" TEXT NOT NULL REFERENCES "cardTransaction"("id") ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "accountId" TEXT NOT NULL REFERENCES "account"("id"),
  "costCenterId" TEXT REFERENCES "costCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "description" TEXT,
  "amount" NUMERIC NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB
);

CREATE INDEX IF NOT EXISTS "cardTransactionLine_cardTransactionId_idx" ON "cardTransactionLine" ("cardTransactionId");
CREATE INDEX IF NOT EXISTS "cardTransactionLine_companyId_idx" ON "cardTransactionLine" ("companyId");
CREATE INDEX IF NOT EXISTS "cardTransactionLine_accountId_idx" ON "cardTransactionLine" ("accountId");
CREATE INDEX IF NOT EXISTS "cardTransactionLine_createdBy_idx" ON "cardTransactionLine" ("createdBy");


-- ============================================================
-- Phase 6: RLS
-- ============================================================
-- Both tables are gated by the invoicing module permissions, mirroring the
-- `payment` / `invoiceSettlement` policies. DELETE is restricted to Draft; line
-- writes additionally require the parent header to be Draft.

ALTER TABLE "public"."cardTransaction" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."cardTransaction";
CREATE POLICY "SELECT" ON "public"."cardTransaction"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

DROP POLICY IF EXISTS "INSERT" ON "public"."cardTransaction";
CREATE POLICY "INSERT" ON "public"."cardTransaction"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."cardTransaction";
CREATE POLICY "UPDATE" ON "public"."cardTransaction"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);

-- DELETE allowed only on Draft (Posted card transactions must be voided).
DROP POLICY IF EXISTS "DELETE" ON "public"."cardTransaction";
CREATE POLICY "DELETE" ON "public"."cardTransaction"
FOR DELETE USING (
  "status" = 'Draft' AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);


ALTER TABLE "public"."cardTransactionLine" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."cardTransactionLine";
CREATE POLICY "SELECT" ON "public"."cardTransactionLine"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

-- Lines are staged while their parent header is Draft; the post-card-transaction
-- edge function then posts them.
DROP POLICY IF EXISTS "INSERT" ON "public"."cardTransactionLine";
CREATE POLICY "INSERT" ON "public"."cardTransactionLine"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "cardTransaction" ct
    WHERE ct."id" = "cardTransactionId" AND ct."status" = 'Draft'
  ) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."cardTransactionLine";
CREATE POLICY "UPDATE" ON "public"."cardTransactionLine"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "cardTransaction" ct
    WHERE ct."id" = "cardTransactionId" AND ct."status" = 'Draft'
  ) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);

DROP POLICY IF EXISTS "DELETE" ON "public"."cardTransactionLine";
CREATE POLICY "DELETE" ON "public"."cardTransactionLine"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "cardTransaction" ct
    WHERE ct."id" = "cardTransactionId" AND ct."status" = 'Draft'
  ) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);


-- ============================================================
-- Phase 7: Seed cardTransaction sequence for existing companies
-- ============================================================
-- New companies pick this up via seed-company (seed.data.ts); this clause
-- handles companies that already exist.

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'cardTransaction', 'Card Transaction', 'CARD-%{yyyy}-%{mm}-', NULL, 0, 6, 1, c.id
FROM "company" c
ON CONFLICT DO NOTHING;
