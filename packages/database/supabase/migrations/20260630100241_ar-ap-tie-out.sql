-- ============================================================
-- AR & AP subledger-to-GL tie-out RPCs
--
-- The subledger (payment + invoiceSettlement + invoice) must
-- equal the GL control account balance for the same as-of date.
-- These RPCs return that comparison.
--
-- Subledger calculation (base currency):
--   SUM((invoice.totalAmount - settled) * invoice.exchangeRate)
--     where settled = sum of applied + discount + writeOff
--     across Posted-payment applications dated <= as_of
--   - SUM(payment unapplied * payment.exchangeRate)
--     where unapplied = totalAmount - sum of applications applied
--     across Posted payments dated <= as_of
--
-- GL calculation:
--   SUM(journalLine.amount) over the control account
--   (receivablesAccount for AR, payablesAccount for AP)
--   where journal.postingDate <= as_of
--
-- Both should equal in base currency. A non-zero variance
-- indicates a break — manual journal entry, voided payment with
-- stale applications, or a posting bug.
-- ============================================================


-- ============================================================
-- AR tie-out
-- ============================================================

CREATE OR REPLACE FUNCTION get_ar_tie_out(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "subledgerBalance" NUMERIC,
  "glBalance" NUMERIC,
  "variance" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH
    -- Active invoices' open amount in invoice currency.
    invoice_open AS (
      SELECT
        si."id",
        si."totalAmount",
        si."exchangeRate",
        si."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount")
          FROM "invoiceSettlement" pa
          JOIN "payment" p ON p."id" = pa."paymentId"
          WHERE pa."targetSalesInvoiceId" = si."id"
            AND p."status" = 'Posted'
            -- Cut on the payment's posting date (= the journal postingDate
            -- the GL side uses), NOT the free-form appliedDate, so the
            -- subledger and GL reconcile as of the same clock.
            AND p."postingDate" <= _as_of_date
        ), 0) AS open_inv_ccy
      FROM "salesInvoice" si
      WHERE si."companyId" = _company_id
        AND si."postingDate" <= _as_of_date
        AND si."status" NOT IN ('Draft', 'Pending', 'Voided')
    ),
    -- Unapplied portion of Posted Receipts, in payment currency.
    payment_unapplied AS (
      SELECT
        p."id",
        p."totalAmount",
        p."exchangeRate",
        p."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount")
          FROM "invoiceSettlement" pa
          WHERE pa."paymentId" = p."id"
        ), 0) AS unapplied_pay_ccy
      FROM "payment" p
      WHERE p."companyId" = _company_id
        AND p."paymentType" = 'Receipt'
        AND p."status" = 'Posted'
        AND p."postingDate" <= _as_of_date
    ),
    subledger AS (
      SELECT
        COALESCE(SUM(open_inv_ccy * "exchangeRate"), 0)
        -
        COALESCE((SELECT SUM(unapplied_pay_ccy * "exchangeRate") FROM payment_unapplied), 0)
        AS amount
      FROM invoice_open
    ),
    ar_account AS (
      SELECT "receivablesAccount" AS account_id
      FROM "accountDefault"
      WHERE "companyId" = _company_id
    ),
    gl AS (
      SELECT COALESCE(SUM(jl."amount"), 0) AS amount
      FROM "journalLine" jl
      JOIN "journal" j ON j."id" = jl."journalId"
      JOIN ar_account a ON jl."accountId" = a.account_id
      WHERE jl."companyId" = _company_id
        AND j."postingDate" <= _as_of_date
        AND j."status" = 'Posted'
    )
  SELECT
    subledger.amount AS "subledgerBalance",
    gl.amount AS "glBalance",
    subledger.amount - gl.amount AS "variance"
  FROM subledger, gl;
$$;


-- ============================================================
-- AP tie-out (mirror of AR)
-- ============================================================
-- Active state for purchase invoices is 'Open'.

CREATE OR REPLACE FUNCTION get_ap_tie_out(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "subledgerBalance" NUMERIC,
  "glBalance" NUMERIC,
  "variance" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH
    invoice_open AS (
      SELECT
        pi."id",
        pi."totalAmount",
        pi."exchangeRate",
        pi."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount")
          FROM "invoiceSettlement" pa
          JOIN "payment" p ON p."id" = pa."paymentId"
          WHERE pa."targetPurchaseInvoiceId" = pi."id"
            AND p."status" = 'Posted'
            -- See AR note: reconcile on payment.postingDate, not appliedDate.
            AND p."postingDate" <= _as_of_date
        ), 0) AS open_inv_ccy
      FROM "purchaseInvoice" pi
      WHERE pi."companyId" = _company_id
        AND pi."postingDate" <= _as_of_date
        AND pi."status" NOT IN ('Draft', 'Pending', 'Voided')
    ),
    payment_unapplied AS (
      SELECT
        p."id",
        p."totalAmount",
        p."exchangeRate",
        p."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount")
          FROM "invoiceSettlement" pa
          WHERE pa."paymentId" = p."id"
        ), 0) AS unapplied_pay_ccy
      FROM "payment" p
      WHERE p."companyId" = _company_id
        AND p."paymentType" = 'Disbursement'
        AND p."status" = 'Posted'
        AND p."postingDate" <= _as_of_date
    ),
    subledger AS (
      SELECT
        COALESCE(SUM(open_inv_ccy * "exchangeRate"), 0)
        -
        COALESCE((SELECT SUM(unapplied_pay_ccy * "exchangeRate") FROM payment_unapplied), 0)
        AS amount
      FROM invoice_open
    ),
    ap_account AS (
      SELECT "payablesAccount" AS account_id
      FROM "accountDefault"
      WHERE "companyId" = _company_id
    ),
    gl AS (
      SELECT COALESCE(SUM(jl."amount"), 0) AS amount
      FROM "journalLine" jl
      JOIN "journal" j ON j."id" = jl."journalId"
      JOIN ap_account a ON jl."accountId" = a.account_id
      WHERE jl."companyId" = _company_id
        AND j."postingDate" <= _as_of_date
        AND j."status" = 'Posted'
    )
  SELECT
    subledger.amount AS "subledgerBalance",
    gl.amount AS "glBalance",
    subledger.amount - gl.amount AS "variance"
  FROM subledger, gl;
$$;


-- ============================================================
-- Drill-down: open AR invoices per customer (as-of date)
-- ============================================================

CREATE OR REPLACE FUNCTION get_ar_open_by_customer(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "customerId" TEXT,
  "invoiceId" TEXT,
  "invoiceNumber" TEXT,
  "dateDue" DATE,
  "currencyCode" TEXT,
  "exchangeRate" NUMERIC,
  "totalAmount" NUMERIC,
  "settled" NUMERIC,
  "openInCurrency" NUMERIC,
  "openInBase" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  SELECT
    si."customerId",
    si."id" AS "invoiceId",
    si."invoiceId" AS "invoiceNumber",
    si."dateDue",
    si."currencyCode",
    si."exchangeRate",
    si."totalAmount",
    COALESCE(s.settled, 0) AS "settled",
    (si."totalAmount" - COALESCE(s.settled, 0)) AS "openInCurrency",
    (si."totalAmount" - COALESCE(s.settled, 0)) * si."exchangeRate" AS "openInBase"
  FROM "salesInvoice" si
  LEFT JOIN LATERAL (
    SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount") AS settled
    FROM "invoiceSettlement" pa
    JOIN "payment" p ON p."id" = pa."paymentId"
    WHERE pa."targetSalesInvoiceId" = si."id"
      AND p."status" = 'Posted'
      AND p."postingDate" <= _as_of_date
  ) s ON true
  WHERE si."companyId" = _company_id
    AND si."postingDate" <= _as_of_date
    AND si."status" NOT IN ('Draft', 'Pending', 'Voided')
    AND (si."totalAmount" - COALESCE(s.settled, 0)) <> 0
  ORDER BY si."customerId", si."dateDue" NULLS LAST;
$$;


-- ============================================================
-- Drill-down: open AP invoices per supplier (as-of date)
-- ============================================================

CREATE OR REPLACE FUNCTION get_ap_open_by_supplier(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "supplierId" TEXT,
  "invoiceId" TEXT,
  "invoiceNumber" TEXT,
  "dateDue" DATE,
  "currencyCode" TEXT,
  "exchangeRate" NUMERIC,
  "totalAmount" NUMERIC,
  "settled" NUMERIC,
  "openInCurrency" NUMERIC,
  "openInBase" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  SELECT
    pi."supplierId",
    pi."id" AS "invoiceId",
    pi."invoiceId" AS "invoiceNumber",
    pi."dateDue",
    pi."currencyCode",
    pi."exchangeRate",
    pi."totalAmount",
    COALESCE(s.settled, 0) AS "settled",
    (pi."totalAmount" - COALESCE(s.settled, 0)) AS "openInCurrency",
    (pi."totalAmount" - COALESCE(s.settled, 0)) * pi."exchangeRate" AS "openInBase"
  FROM "purchaseInvoice" pi
  LEFT JOIN LATERAL (
    SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount") AS settled
    FROM "invoiceSettlement" pa
    JOIN "payment" p ON p."id" = pa."paymentId"
    WHERE pa."targetPurchaseInvoiceId" = pi."id"
      AND p."status" = 'Posted'
      AND p."postingDate" <= _as_of_date
  ) s ON true
  WHERE pi."companyId" = _company_id
    AND pi."postingDate" <= _as_of_date
    AND pi."status" NOT IN ('Draft', 'Pending', 'Voided')
    AND (pi."totalAmount" - COALESCE(s.settled, 0)) <> 0
  ORDER BY pi."supplierId", pi."dateDue" NULLS LAST;
$$;
