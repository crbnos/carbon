-- Supplier prepayments. A supplier payment that references a purchase order
-- is a prepayment: post-payment books its unapplied cash on
-- accountDefault.supplierPrepaymentAccount (1150, an asset) with the
-- description "Supplier Prepayment" (build-payment-journal.ts) instead of as
-- an on-account debit inside payables, and it funds only that order's
-- purchase invoices. The sibling of the customer deposit's payment.salesOrderId
-- (20261006220501_rental-agreements.sql, 20261021012500_contract-financing.sql).

ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "purchaseOrder_id_companyId_key"
  ON "purchaseOrder" ("id", "companyId");

ALTER TABLE "payment" DROP CONSTRAINT IF EXISTS "payment_purchaseOrder_fkey";
ALTER TABLE "payment" ADD CONSTRAINT "payment_purchaseOrder_fkey"
  FOREIGN KEY ("purchaseOrderId", "companyId")
  REFERENCES "purchaseOrder"("id", "companyId")
  ON DELETE SET NULL ("purchaseOrderId");

CREATE INDEX IF NOT EXISTS "payment_purchaseOrderId_idx"
  ON "payment" ("purchaseOrderId", "companyId") WHERE "purchaseOrderId" IS NOT NULL;

-- A payment is held against at most one document.
ALTER TABLE "payment" DROP CONSTRAINT IF EXISTS "payment_deposit_document_check";
ALTER TABLE "payment" ADD CONSTRAINT "payment_deposit_document_check"
  CHECK (num_nonnulls("salesOrderId", "rentalAgreementId", "customerContractId", "purchaseOrderId") <= 1);

-- The AP tie-out counted a prepayment's unapplied cash as on-account AP
-- credit, so every unapplied prepayment showed as a tie-out variance. Its cash
-- sits on the supplier prepayment account, not payables, as the AR tie-out
-- already leaves customer deposits out (20261006221801). Otherwise unchanged
-- from 20261009014620_opening-balance-subledger-readers.sql.
CREATE OR REPLACE FUNCTION public.get_ap_tie_out(_company_id text, _as_of_date date)
 RETURNS TABLE("subledgerBalance" numeric, "glBalance" numeric, variance numeric)
 LANGUAGE sql
AS $function$
  WITH funding_consumed AS (
    SELECT COALESCE(s."sourcePaymentId", s."paymentId") AS source_payment_id,
      SUM(s."appliedAmount" + CASE WHEN applying."paymentType" = 'Receipt'
        THEN s."fxGainLossAmount" ELSE -s."fxGainLossAmount" END) AS source_base_amount
    FROM "invoiceSettlement" s
    JOIN "payment" applying ON applying."id" = s."paymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND s."paymentId" IS NOT NULL
      AND applying."status" = 'Posted'
      AND applying."postingDate" <= _as_of_date
    GROUP BY COALESCE(s."sourcePaymentId", s."paymentId")
  ), payment_unapplied AS (
    SELECT ((CASE WHEN p."paymentType" = 'Disbursement' THEN 1 ELSE -1 END)
        * (accounting_round_internal(p."totalAmount" / p."exchangeRate") - COALESCE(c.source_base_amount,0))) AS open_base
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id
      AND p."status" = 'Posted' AND p."postingDate" <= _as_of_date
      -- Party determines the subledger; cash direction determines its sign.
      AND p."supplierId" IS NOT NULL
      -- A prepayment's unapplied cash sits on the supplier prepayment account, not AP.
      AND p."purchaseOrderId" IS NULL
  ), subledger AS (
    SELECT COALESCE((SELECT SUM(o."openInBase")
      FROM get_ap_open_by_supplier(_company_id, _as_of_date) o), 0)
      - COALESCE((SELECT SUM(open_base) FROM payment_unapplied), 0) AS amount
  ), control_account AS (
    SELECT unnest(ARRAY["payablesAccount", "intercompanyPayablesAccount"]) AS account_id
    FROM "accountDefault" WHERE "companyId" = _company_id
    UNION
    SELECT line."accountId"
    FROM "journalLine" line
    JOIN "journal" j ON j."id" = line."journalId" AND j."companyId" = line."companyId"
    WHERE line."companyId" = _company_id
      AND j."status" = 'Posted' AND j."postingDate" <= _as_of_date
      AND (
        (j."sourceType" IN ('Purchase Invoice', 'Opening Balance') AND line."documentType" = 'Invoice'
          AND line."description" = 'Accounts Payable')
        OR (j."sourceType" IN ('Payment', 'Opening Balance') AND line."documentType" = 'Payment'
          AND line."description" IN ('Accounts Payable',
            'Accounts Payable (on-account credit)', 'Accounts Payable (credit applied)'))
        OR (j."sourceType" IN ('Credit Memo', 'Debit Memo', 'Opening Balance') AND line."documentType" = 'Memo'
          AND line."description" = 'Accounts Payable')
      )
  ), gl AS (
    SELECT COALESCE(SUM(jl."amount"), 0) AS amount
    FROM "journalLine" jl
    JOIN "journal" j ON j."id" = jl."journalId" AND j."companyId" = jl."companyId"
    JOIN control_account a ON a.account_id = jl."accountId"
    WHERE jl."companyId" = _company_id
      AND j."postingDate" <= _as_of_date AND j."status" = 'Posted'
  )
  SELECT subledger.amount AS "subledgerBalance", gl.amount AS "glBalance",
    subledger.amount - gl.amount AS "variance"
  FROM subledger, gl;
$function$;
