-- ============================================================
-- AR & AP Payments and Cash Application
--
-- Replaces the unused purchasePayment/purchaseInvoicePaymentRelation
-- stubs with a unified payment + invoiceSettlement model
-- (type-discriminated for AR vs AP, NetSuite-style settlements
-- carrying principal/discount/write-off, multi-currency-aware).
--
-- invoiceSettlement is the ONE settlement primitive: it nets a funding
-- source (a cash payment OR a credit/debit memo) against a target document
-- (an invoice, or a memo when settling/refunding an increaser memo).
-- A memo is its own payment-shaped document (the `memo` table) — party +
-- amount + reason GL account — NOT an invoice row. Applying a balance-reducing
-- memo to an invoice is a subledger row here (GL-neutral except realized FX).
--
-- Also adds four new accountDefault columns (customer/supplier
-- write-off, realized FX gain/loss) and one new chart-of-accounts
-- entry (4130 Vendor Write-Off Income). The remaining defaults
-- map to existing accounts (6050 Bad Debts Expense, 4120 FX Gains,
-- 7060 FX Losses).
-- ============================================================


-- ============================================================
-- Phase 1: Drop the unused AP stubs
-- ============================================================
-- The relation table has no amount/discount/write-off columns and
-- is unused in app code; the purchasePayment table is referenced
-- only by metadata (customFieldTable). DROP TABLE cascades to its
-- policies and any FK-attached customField rows.

DELETE FROM "customFieldTable" WHERE "table" = 'purchasePayment';

DROP TABLE IF EXISTS "purchaseInvoicePaymentRelation";
DROP TABLE IF EXISTS "purchasePayment";


-- ============================================================
-- Phase 2: New chart-of-accounts entry 4130 (Vendor Write-Off Income)
-- ============================================================
-- AR write-off uses existing 6050 Bad Debts Expense.
-- Realized FX gain/loss use existing 4120 / 7060.
-- AP write-off needs a new Other Income account.

DO $$
DECLARE
  cg RECORD;
  parent_id TEXT;
BEGIN
  FOR cg IN SELECT id FROM "companyGroup"
  LOOP
    -- Other Income group header has isGroup=TRUE and number IS NULL.
    SELECT id INTO parent_id
    FROM "account"
    WHERE "companyGroupId" = cg.id AND "isGroup" = TRUE AND name = 'Other Income'
    LIMIT 1;

    INSERT INTO "account" (
      number, name, "isGroup", "accountType", "incomeBalance", class,
      "parentId", "isSystem", "companyGroupId", "createdBy"
    )
    SELECT
      '4130', 'Vendor Write-Off Income', FALSE,
      'Other Income'::"accountType",
      'Income Statement'::"glIncomeBalance",
      'Revenue'::"glAccountClass",
      parent_id, FALSE, cg.id, 'system'
    WHERE NOT EXISTS (
      SELECT 1 FROM "account"
      WHERE "companyGroupId" = cg.id AND number = '4130'
    );
  END LOOP;
END $$;


-- ============================================================
-- Phase 3: Extend accountDefault with the four new mappings
-- ============================================================
-- Add nullable, backfill, then SET NOT NULL to match existing
-- column nullability convention on this table. Idempotent: this
-- migration is not run in a transaction by the deploy runner, so
-- a mid-file failure leaves committed state behind — every step
-- here must be safe to re-run.

ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "customerWriteOffAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "supplierWriteOffAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "realizedExchangeGainAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "realizedExchangeLossAccount" TEXT;

-- Backfill: look up the account.id for each company's group by account.number.
-- These numbers (6050/4130/4120/7060) are only guaranteed present if the COA
-- was seeded/reset cleanly; a group can be missing one (renumbered/deleted
-- accounts, or a NULL companyGroupId). When the lookup misses, COALESCE to an
-- existing, always-NOT-NULL default of the same nature so no NULL survives and
-- SET NOT NULL below can never fail. Admins override these in account settings.
UPDATE "accountDefault" ad
SET
  "customerWriteOffAccount" = COALESCE(
    (SELECT a.id FROM "account" a
      INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
      WHERE c.id = ad."companyId" AND a.number = '6050' LIMIT 1),
    ad."salesDiscountAccount"            -- contra-revenue fallback for an AR write-off
  ),
  "supplierWriteOffAccount" = COALESCE(
    (SELECT a.id FROM "account" a
      INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
      WHERE c.id = ad."companyId" AND a.number = '4130' LIMIT 1),
    ad."salesAccount"                    -- income fallback for an AP write-off
  ),
  "realizedExchangeGainAccount" = COALESCE(
    (SELECT a.id FROM "account" a
      INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
      WHERE c.id = ad."companyId" AND a.number = '4120' LIMIT 1),
    ad."salesAccount"                    -- income fallback for an FX gain
  ),
  "realizedExchangeLossAccount" = COALESCE(
    (SELECT a.id FROM "account" a
      INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
      WHERE c.id = ad."companyId" AND a.number = '7060' LIMIT 1),
    ad."interestAccount"                 -- financial-expense fallback for an FX loss
  );

ALTER TABLE "accountDefault"
  ALTER COLUMN "customerWriteOffAccount" SET NOT NULL,
  ALTER COLUMN "supplierWriteOffAccount" SET NOT NULL,
  ALTER COLUMN "realizedExchangeGainAccount" SET NOT NULL,
  ALTER COLUMN "realizedExchangeLossAccount" SET NOT NULL;

-- DROP IF EXISTS before ADD so re-running after a partial deploy doesn't trip
-- on an already-created constraint.
ALTER TABLE "accountDefault"
  DROP CONSTRAINT IF EXISTS "accountDefault_customerWriteOffAccount_fkey",
  DROP CONSTRAINT IF EXISTS "accountDefault_supplierWriteOffAccount_fkey",
  DROP CONSTRAINT IF EXISTS "accountDefault_realizedExchangeGainAccount_fkey",
  DROP CONSTRAINT IF EXISTS "accountDefault_realizedExchangeLossAccount_fkey";

ALTER TABLE "accountDefault"
  ADD CONSTRAINT "accountDefault_customerWriteOffAccount_fkey"
    FOREIGN KEY ("customerWriteOffAccount") REFERENCES "account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accountDefault_supplierWriteOffAccount_fkey"
    FOREIGN KEY ("supplierWriteOffAccount") REFERENCES "account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accountDefault_realizedExchangeGainAccount_fkey"
    FOREIGN KEY ("realizedExchangeGainAccount") REFERENCES "account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accountDefault_realizedExchangeLossAccount_fkey"
    FOREIGN KEY ("realizedExchangeLossAccount") REFERENCES "account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- Phase 4: Enums
-- ============================================================

-- CREATE TYPE has no IF NOT EXISTS; guard each so a re-run after a partial
-- deploy doesn't trip on an already-created type.
DO $$ BEGIN
  CREATE TYPE "paymentType" AS ENUM ('Receipt', 'Disbursement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "paymentStatus" AS ENUM ('Draft', 'Posted', 'Voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A credit/debit memo is a standalone, payment-shaped document (Phase 5b) — NOT
-- an invoice row. `direction` is whether it credits or debits the party's
-- control account (Credit ⇒ DR reason / CR control; Debit ⇒ DR control / CR
-- reason); status mirrors payment's lifecycle.
DO $$ BEGIN
  CREATE TYPE "memoDirection" AS ENUM ('Credit', 'Debit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "memoStatus" AS ENUM ('Draft', 'Posted', 'Voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Payment';
-- post-memo writes its journal lines with documentType 'Memo'.
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Memo';
-- journal.sourceType: post-payment writes 'Payment'; post-memo writes
-- 'Credit Memo' / 'Debit Memo'.
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Payment';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Credit Memo';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Debit Memo';


-- ============================================================
-- Phase 5: payment table
-- ============================================================
-- The cash event. Receipt (AR cash-in) or Disbursement (AP cash-out)
-- discriminated by paymentType. customerId xor supplierId enforced
-- by check matching the type.

CREATE TABLE IF NOT EXISTS "payment" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "paymentId" TEXT NOT NULL,
  "paymentType" "paymentType" NOT NULL,
  "status" "paymentStatus" NOT NULL DEFAULT 'Draft',
  "customerId" TEXT,
  "supplierId" TEXT,
  "paymentDate" DATE NOT NULL,
  "postingDate" DATE,
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
  "totalAmount" NUMERIC NOT NULL,
  "bankAccount" TEXT NOT NULL,
  "reference" TEXT,
  "memo" TEXT,
  "journalId" TEXT,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT,
  "voidedAt" TIMESTAMP WITH TIME ZONE,
  "voidedBy" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  -- Exactly one counterparty. Direction (paymentType) is intentionally decoupled
  -- from the party so refunds work: a Disbursement can pay a CUSTOMER (refund of
  -- an AR credit) and a Receipt can come from a SUPPLIER (refund of an AP debit).
  -- The per-flow type↔party↔target pairing is enforced by the posting functions.
  CONSTRAINT "payment_party_check" CHECK (
    ("customerId" IS NOT NULL AND "supplierId" IS NULL) OR
    ("customerId" IS NULL AND "supplierId" IS NOT NULL)
  ),
  -- 0 is allowed: a receipt/payment can be a pure credit-application (apply the
  -- party's posted credits to invoices with no cash changing hands).
  CONSTRAINT "payment_totalAmount_check" CHECK ("totalAmount" >= 0),
  CONSTRAINT "payment_exchangeRate_check" CHECK ("exchangeRate" > 0),
  CONSTRAINT "payment_paymentId_companyId_key" UNIQUE ("paymentId", "companyId"),

  CONSTRAINT "payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_bankAccount_fkey" FOREIGN KEY ("bankAccount") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_postedBy_fkey" FOREIGN KEY ("postedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_voidedBy_fkey" FOREIGN KEY ("voidedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "payment_companyId_idx" ON "payment" ("companyId");
CREATE INDEX IF NOT EXISTS "payment_customerId_idx" ON "payment" ("customerId") WHERE "customerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "payment_supplierId_idx" ON "payment" ("supplierId") WHERE "supplierId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "payment_status_idx" ON "payment" ("status");
CREATE INDEX IF NOT EXISTS "payment_paymentDate_idx" ON "payment" ("paymentDate");

ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."payment";
CREATE POLICY "SELECT" ON "public"."payment"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

DROP POLICY IF EXISTS "INSERT" ON "public"."payment";
CREATE POLICY "INSERT" ON "public"."payment"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);

-- Mutability ties to status: Draft is freely editable, Posted only
-- transitions to Voided (via post-payment edge function), Voided is
-- terminal. App-side service rejects illegal transitions.
DROP POLICY IF EXISTS "UPDATE" ON "public"."payment";
CREATE POLICY "UPDATE" ON "public"."payment"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);

-- DELETE allowed only on Draft (Posted payments must be voided).
DROP POLICY IF EXISTS "DELETE" ON "public"."payment";
CREATE POLICY "DELETE" ON "public"."payment"
FOR DELETE USING (
  "status" = 'Draft' AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);


-- ============================================================
-- Phase 5b: memo table (credit / debit memos — payment-shaped)
-- ============================================================
-- A non-cash adjustment to a party's AR/AP balance. Mirrors `payment` but the
-- offset is a GL account instead of a bank account. The offset account is NOT a
-- user choice: it's derived deterministically at posting from the company's
-- account defaults by party side (customer -> salesDiscountAccount, supplier ->
-- supplierPaymentDiscountAccount), and stored on `reasonAccount` for audit. The
-- four combos:
--   Customer + Credit  -> AR down  (DR reason / CR receivables)
--   Customer + Debit   -> AR up    (DR receivables / CR reason)
--   Supplier + Debit   -> AP down  (DR payables / CR reason)
--   Supplier + Credit  -> AP up    (DR reason / CR payables)
-- Balance-reducing memos (Customer Credit, Supplier Debit) are applied to open
-- invoices via invoiceSettlement (source = memoId). Balance-increasing memos are
-- themselves open items, settled via invoiceSettlement (target = targetMemoId).

CREATE TABLE IF NOT EXISTS "memo" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "memoId" TEXT NOT NULL,
  "direction" "memoDirection" NOT NULL,
  "status" "memoStatus" NOT NULL DEFAULT 'Draft',
  "customerId" TEXT,
  "supplierId" TEXT,
  "memoDate" DATE NOT NULL,
  "postingDate" DATE,
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
  "amount" NUMERIC NOT NULL,
  -- Derived at posting from account defaults (party side); null while Draft.
  "reasonAccount" TEXT,
  "reference" TEXT,
  "notes" TEXT,
  "journalId" TEXT,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT,
  "voidedAt" TIMESTAMP WITH TIME ZONE,
  "voidedBy" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "memo_party_check" CHECK (
    ("customerId" IS NOT NULL AND "supplierId" IS NULL) OR
    ("customerId" IS NULL AND "supplierId" IS NOT NULL)
  ),
  CONSTRAINT "memo_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "memo_exchangeRate_check" CHECK ("exchangeRate" > 0),
  CONSTRAINT "memo_memoId_companyId_key" UNIQUE ("memoId", "companyId"),

  CONSTRAINT "memo_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "memo_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "memo_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "memo_reasonAccount_fkey" FOREIGN KEY ("reasonAccount") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "memo_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "memo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "memo_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "memo_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "memo_postedBy_fkey" FOREIGN KEY ("postedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "memo_voidedBy_fkey" FOREIGN KEY ("voidedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "memo_companyId_idx" ON "memo" ("companyId");
CREATE INDEX IF NOT EXISTS "memo_customerId_idx" ON "memo" ("customerId") WHERE "customerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "memo_supplierId_idx" ON "memo" ("supplierId") WHERE "supplierId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "memo_status_idx" ON "memo" ("status");
CREATE INDEX IF NOT EXISTS "memo_memoDate_idx" ON "memo" ("memoDate");

ALTER TABLE "memo" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."memo";
CREATE POLICY "SELECT" ON "public"."memo"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."memo";
CREATE POLICY "INSERT" ON "public"."memo"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_create'))::text[])
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."memo";
CREATE POLICY "UPDATE" ON "public"."memo"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_update'))::text[])
);

-- DELETE allowed only on Draft (Posted memos must be voided).
DROP POLICY IF EXISTS "DELETE" ON "public"."memo";
CREATE POLICY "DELETE" ON "public"."memo"
FOR DELETE USING (
  "status" = 'Draft' AND
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_delete'))::text[])
);


-- ============================================================
-- Phase 6: invoiceSettlement table (unified settlement primitive)
-- ============================================================
-- ONE table nets a funding SOURCE against a TARGET document:
--   * source = exactly one of:
--       - paymentId (a cash receipt/disbursement), or
--       - memoId    (a credit/debit memo).
--   * target = exactly one of targetSalesInvoiceId / targetPurchaseInvoiceId /
--     targetMemoId (the open item being settled — an invoice, or a
--     balance-increasing memo being paid/credited down).
--
-- Carries principal/discount/write-off in the source/target currency.
-- fxGainLoss is a stored generated column on the settled principal
-- (appliedAmount): discount/write-off are invoice-currency reliefs that carry
-- no FX, and only cash payments carry them (memos do not).
--
-- Party/side consistency (an AR source only settles AR targets, same
-- counterparty) is enforced by the posting/apply functions — the source's
-- AR/AP side lives in the payment/memo row, not structurally here.

CREATE TABLE IF NOT EXISTS "invoiceSettlement" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  -- funding source (exactly one): a cash payment OR a memo
  "paymentId" TEXT,
  "memoId" TEXT,
  -- target document (exactly one): an invoice, or a memo (settling / refunding
  -- a balance-increasing memo)
  "targetSalesInvoiceId" TEXT,
  "targetPurchaseInvoiceId" TEXT,
  "targetMemoId" TEXT,
  "appliedAmount" NUMERIC NOT NULL,
  "discountAmount" NUMERIC NOT NULL DEFAULT 0,
  "writeOffAmount" NUMERIC NOT NULL DEFAULT 0,
  -- rate of the funding source and of the target invoice at application time
  "sourceExchangeRate" NUMERIC NOT NULL,
  "targetExchangeRate" NUMERIC NOT NULL,
  -- Realized FX on this settlement, in base currency. FX accrues only on the
  -- settled principal (appliedAmount): discount and write-off are
  -- invoice-currency reliefs booked at the target rate and carry no FX. Bare
  -- NUMERIC keeps this exact so it reconciles to the GL FX plug with no
  -- fixed-scale rounding drift. Presentation rounds at the edge, not in storage.
  "fxGainLossAmount" NUMERIC GENERATED ALWAYS AS (
    "appliedAmount" * ("sourceExchangeRate" - "targetExchangeRate")
  ) STORED,
  "appliedDate" DATE NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "invoiceSettlement_source_check" CHECK (
    (("paymentId" IS NOT NULL)::int + ("memoId" IS NOT NULL)::int) = 1
  ),
  CONSTRAINT "invoiceSettlement_target_check" CHECK (
    (("targetSalesInvoiceId" IS NOT NULL)::int
      + ("targetPurchaseInvoiceId" IS NOT NULL)::int
      + ("targetMemoId" IS NOT NULL)::int) = 1
  ),
  -- A memo cannot settle itself. (Party/side consistency between the source's
  -- AR/AP side and the target — e.g. an AR memo can only settle an AR invoice or
  -- AR memo — is enforced by the posting/apply functions, since the memo's party
  -- lives in the `memo` table and isn't structurally visible here.)
  CONSTRAINT "invoiceSettlement_self_check" CHECK (
    NOT ("memoId" IS NOT NULL AND "memoId" = "targetMemoId")
  ),
  -- Discount/write-off are cash-payment reliefs; memo sources carry neither.
  CONSTRAINT "invoiceSettlement_memoSource_noReliefs_check" CHECK (
    "paymentId" IS NOT NULL OR ("discountAmount" = 0 AND "writeOffAmount" = 0)
  ),
  CONSTRAINT "invoiceSettlement_amounts_nonnegative" CHECK (
    "appliedAmount" >= 0 AND "discountAmount" >= 0 AND "writeOffAmount" >= 0
  ),
  CONSTRAINT "invoiceSettlement_anyComponent_check" CHECK (
    "appliedAmount" + "discountAmount" + "writeOffAmount" > 0
  ),
  CONSTRAINT "invoiceSettlement_sourceExchangeRate_check" CHECK ("sourceExchangeRate" > 0),
  CONSTRAINT "invoiceSettlement_targetExchangeRate_check" CHECK ("targetExchangeRate" > 0),

  CONSTRAINT "invoiceSettlement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invoiceSettlement_memoId_fkey" FOREIGN KEY ("memoId") REFERENCES "memo"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invoiceSettlement_targetSalesInvoiceId_fkey" FOREIGN KEY ("targetSalesInvoiceId") REFERENCES "salesInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoiceSettlement_targetPurchaseInvoiceId_fkey" FOREIGN KEY ("targetPurchaseInvoiceId") REFERENCES "purchaseInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoiceSettlement_targetMemoId_fkey" FOREIGN KEY ("targetMemoId") REFERENCES "memo"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoiceSettlement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invoiceSettlement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "invoiceSettlement_paymentId_idx" ON "invoiceSettlement" ("paymentId") WHERE "paymentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "invoiceSettlement_memoId_idx" ON "invoiceSettlement" ("memoId") WHERE "memoId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "invoiceSettlement_targetSalesInvoiceId_idx" ON "invoiceSettlement" ("targetSalesInvoiceId") WHERE "targetSalesInvoiceId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "invoiceSettlement_targetPurchaseInvoiceId_idx" ON "invoiceSettlement" ("targetPurchaseInvoiceId") WHERE "targetPurchaseInvoiceId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "invoiceSettlement_targetMemoId_idx" ON "invoiceSettlement" ("targetMemoId") WHERE "targetMemoId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "invoiceSettlement_appliedDate_idx" ON "invoiceSettlement" ("appliedDate");
CREATE INDEX IF NOT EXISTS "invoiceSettlement_companyId_idx" ON "invoiceSettlement" ("companyId");

ALTER TABLE "invoiceSettlement" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."invoiceSettlement";
CREATE POLICY "SELECT" ON "public"."invoiceSettlement"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

-- Settlement rows are staged while their parent source (payment OR memo) is
-- Draft; the post-payment / post-memo edge function then posts them. Exactly one
-- of paymentId/memoId is set, so the other gate is a NULL no-op.
DROP POLICY IF EXISTS "INSERT" ON "public"."invoiceSettlement";
CREATE POLICY "INSERT" ON "public"."invoiceSettlement"
FOR INSERT WITH CHECK (
  ("paymentId" IS NULL OR EXISTS (
    SELECT 1 FROM "payment" p WHERE p.id = "paymentId" AND p.status = 'Draft'
  )) AND
  ("memoId" IS NULL OR EXISTS (
    SELECT 1 FROM "memo" m WHERE m.id = "memoId" AND m.status = 'Draft'
  )) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."invoiceSettlement";
CREATE POLICY "UPDATE" ON "public"."invoiceSettlement"
FOR UPDATE USING (
  ("paymentId" IS NULL OR EXISTS (
    SELECT 1 FROM "payment" p WHERE p.id = "paymentId" AND p.status = 'Draft'
  )) AND
  ("memoId" IS NULL OR EXISTS (
    SELECT 1 FROM "memo" m WHERE m.id = "memoId" AND m.status = 'Draft'
  )) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);

DROP POLICY IF EXISTS "DELETE" ON "public"."invoiceSettlement";
CREATE POLICY "DELETE" ON "public"."invoiceSettlement"
FOR DELETE USING (
  ("paymentId" IS NULL OR EXISTS (
    SELECT 1 FROM "payment" p WHERE p.id = "paymentId" AND p.status = 'Draft'
  )) AND
  ("memoId" IS NULL OR EXISTS (
    SELECT 1 FROM "memo" m WHERE m.id = "memoId" AND m.status = 'Draft'
  )) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);


-- ============================================================
-- Phase 7: Custom field registry
-- ============================================================

INSERT INTO "customFieldTable" ("table", "name", "module") VALUES
  ('payment', 'Payment', 'Invoicing'),
  ('memo', 'Memo', 'Invoicing'),
  ('invoiceSettlement', 'Invoice Settlement', 'Invoicing')
ON CONFLICT ("table") DO NOTHING;


-- ============================================================
-- Phase 8: Seed payment sequence for existing companies
-- ============================================================
-- New companies pick this up via seed-company/index.ts; this clause
-- handles companies that already exist.

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'payment', 'Payment', 'PAY-%{yyyy}-%{mm}-', NULL, 0, 6, 1, c.id
FROM "company" c
ON CONFLICT DO NOTHING;

-- Credit/debit memos number independently; the insert path picks the sequence
-- by direction (Credit -> CR-, Debit -> DR-).
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'creditMemo', 'Credit Memo', 'CR-%{yyyy}-%{mm}-', NULL, 0, 6, 1, c.id
FROM "company" c
ON CONFLICT DO NOTHING;

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'debitMemo', 'Debit Memo', 'DR-%{yyyy}-%{mm}-', NULL, 0, 6, 1, c.id
FROM "company" c
ON CONFLICT DO NOTHING;
