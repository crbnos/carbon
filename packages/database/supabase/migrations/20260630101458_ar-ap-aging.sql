-- ============================================================
-- AR & AP aging reports
--
-- Per-counterparty bucketed open amounts derived from the same
-- invoiceSettlement subledger the tie-out uses. Buckets and the
-- age basis (due date vs document date) are parameters so the UI
-- can offer the standard NetSuite/SAP toggles without a schema
-- change.
--
-- Open amount per invoice (base currency) =
--   (totalAmount - settled) * exchangeRate
-- where settled = applied + discount + writeOff across Posted-payment
-- applications dated <= as_of.
--
-- Unapplied Posted payments (on-account credits) are included as a
-- negative amount per counterparty so an overpaid customer shows as
-- a net credit rather than a phantom receivable.
-- ============================================================


-- ============================================================
-- AR aging
-- ============================================================

DROP FUNCTION IF EXISTS get_ar_aging(TEXT, DATE, TEXT, INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION get_ar_aging(
  _company_id TEXT,
  _as_of_date DATE,
  _aging_method TEXT DEFAULT 'dueDate',
  _bucket1 INTEGER DEFAULT 30,
  _bucket2 INTEGER DEFAULT 60,
  _bucket3 INTEGER DEFAULT 90
)
RETURNS TABLE (
  "customerId" TEXT,
  "paymentTerm" TEXT,
  "current" NUMERIC,
  "bucket1" NUMERIC,
  "bucket2" NUMERIC,
  "bucket3" NUMERIC,
  "bucket4" NUMERIC,
  "unapplied" NUMERIC,
  "total" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH open_invoices AS (
    SELECT
      si."customerId",
      CASE
        WHEN _aging_method = 'documentDate'
          THEN COALESCE(si."dateIssued", si."postingDate")
        ELSE si."dateDue"
      END AS age_date,
      (si."totalAmount" - COALESCE((
        SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount")
        FROM "invoiceSettlement" pa
        JOIN "payment" p ON p."id" = pa."paymentId"
        WHERE pa."targetSalesInvoiceId" = si."id"
          AND p."status" = 'Posted'
          -- Reconcile on payment.postingDate (matches the tie-out report),
          -- not the free-form appliedDate.
          AND p."postingDate" <= _as_of_date
      ), 0)) * si."exchangeRate" AS open_base
    FROM "salesInvoice" si
    WHERE si."companyId" = _company_id
      AND si."postingDate" <= _as_of_date
      AND si."status" NOT IN ('Draft', 'Pending', 'Voided')
  ),
  invoice_buckets AS (
    SELECT
      "customerId",
      COALESCE(SUM(open_base) FILTER (
        WHERE age_date IS NULL OR age_date >= _as_of_date
      ), 0) AS "current",
      COALESCE(SUM(open_base) FILTER (
        WHERE age_date < _as_of_date
          AND _as_of_date - age_date BETWEEN 1 AND _bucket1
      ), 0) AS "bucket1",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date BETWEEN _bucket1 + 1 AND _bucket2
      ), 0) AS "bucket2",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date BETWEEN _bucket2 + 1 AND _bucket3
      ), 0) AS "bucket3",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date > _bucket3
      ), 0) AS "bucket4"
    FROM open_invoices
    WHERE open_base <> 0
    GROUP BY "customerId"
  ),
  unapplied AS (
    SELECT
      p."customerId",
      -COALESCE(SUM(
        (p."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount")
          FROM "invoiceSettlement" pa
          WHERE pa."paymentId" = p."id"
        ), 0)) * p."exchangeRate"
      ), 0) AS "unapplied"
    FROM "payment" p
    WHERE p."companyId" = _company_id
      AND p."paymentType" = 'Receipt'
      AND p."status" = 'Posted'
      AND p."postingDate" <= _as_of_date
      AND p."customerId" IS NOT NULL
    GROUP BY p."customerId"
  )
  SELECT
    COALESCE(ib."customerId", u."customerId") AS "customerId",
    pt."name" AS "paymentTerm",
    COALESCE(ib."current", 0) AS "current",
    COALESCE(ib."bucket1", 0) AS "bucket1",
    COALESCE(ib."bucket2", 0) AS "bucket2",
    COALESCE(ib."bucket3", 0) AS "bucket3",
    COALESCE(ib."bucket4", 0) AS "bucket4",
    COALESCE(u."unapplied", 0) AS "unapplied",
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) AS "total"
  FROM invoice_buckets ib
  FULL OUTER JOIN unapplied u ON u."customerId" = ib."customerId"
  LEFT JOIN "customerPayment" cp
    ON cp."customerId" = COALESCE(ib."customerId", u."customerId")
    AND cp."companyId" = _company_id
  LEFT JOIN "paymentTerm" pt ON pt."id" = cp."paymentTermId"
  WHERE
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) <> 0
  ORDER BY "total" DESC;
$$;


-- ============================================================
-- AP aging (mirror — supplier + purchaseInvoice + Disbursement)
-- ============================================================

DROP FUNCTION IF EXISTS get_ap_aging(TEXT, DATE, TEXT, INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION get_ap_aging(
  _company_id TEXT,
  _as_of_date DATE,
  _aging_method TEXT DEFAULT 'dueDate',
  _bucket1 INTEGER DEFAULT 30,
  _bucket2 INTEGER DEFAULT 60,
  _bucket3 INTEGER DEFAULT 90
)
RETURNS TABLE (
  "supplierId" TEXT,
  "paymentTerm" TEXT,
  "current" NUMERIC,
  "bucket1" NUMERIC,
  "bucket2" NUMERIC,
  "bucket3" NUMERIC,
  "bucket4" NUMERIC,
  "unapplied" NUMERIC,
  "total" NUMERIC
)
LANGUAGE SQL
SECURITY INVOKER
AS $$
  WITH open_invoices AS (
    SELECT
      pi."supplierId",
      CASE
        WHEN _aging_method = 'documentDate'
          THEN COALESCE(pi."dateIssued", pi."postingDate")
        ELSE pi."dateDue"
      END AS age_date,
      (pi."totalAmount" - COALESCE((
        SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount")
        FROM "invoiceSettlement" pa
        JOIN "payment" p ON p."id" = pa."paymentId"
        WHERE pa."targetPurchaseInvoiceId" = pi."id"
          AND p."status" = 'Posted'
          -- See AR note: reconcile on payment.postingDate, not appliedDate.
          AND p."postingDate" <= _as_of_date
      ), 0)) * pi."exchangeRate" AS open_base
    FROM "purchaseInvoice" pi
    WHERE pi."companyId" = _company_id
      AND pi."postingDate" <= _as_of_date
      AND pi."status" NOT IN ('Draft', 'Pending', 'Voided')
  ),
  invoice_buckets AS (
    SELECT
      "supplierId",
      COALESCE(SUM(open_base) FILTER (
        WHERE age_date IS NULL OR age_date >= _as_of_date
      ), 0) AS "current",
      COALESCE(SUM(open_base) FILTER (
        WHERE age_date < _as_of_date
          AND _as_of_date - age_date BETWEEN 1 AND _bucket1
      ), 0) AS "bucket1",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date BETWEEN _bucket1 + 1 AND _bucket2
      ), 0) AS "bucket2",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date BETWEEN _bucket2 + 1 AND _bucket3
      ), 0) AS "bucket3",
      COALESCE(SUM(open_base) FILTER (
        WHERE _as_of_date - age_date > _bucket3
      ), 0) AS "bucket4"
    FROM open_invoices
    WHERE open_base <> 0
    GROUP BY "supplierId"
  ),
  unapplied AS (
    SELECT
      p."supplierId",
      -COALESCE(SUM(
        (p."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount")
          FROM "invoiceSettlement" pa
          WHERE pa."paymentId" = p."id"
        ), 0)) * p."exchangeRate"
      ), 0) AS "unapplied"
    FROM "payment" p
    WHERE p."companyId" = _company_id
      AND p."paymentType" = 'Disbursement'
      AND p."status" = 'Posted'
      AND p."postingDate" <= _as_of_date
      AND p."supplierId" IS NOT NULL
    GROUP BY p."supplierId"
  )
  SELECT
    COALESCE(ib."supplierId", u."supplierId") AS "supplierId",
    pt."name" AS "paymentTerm",
    COALESCE(ib."current", 0) AS "current",
    COALESCE(ib."bucket1", 0) AS "bucket1",
    COALESCE(ib."bucket2", 0) AS "bucket2",
    COALESCE(ib."bucket3", 0) AS "bucket3",
    COALESCE(ib."bucket4", 0) AS "bucket4",
    COALESCE(u."unapplied", 0) AS "unapplied",
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) AS "total"
  FROM invoice_buckets ib
  FULL OUTER JOIN unapplied u ON u."supplierId" = ib."supplierId"
  LEFT JOIN "supplierPayment" sp
    ON sp."supplierId" = COALESCE(ib."supplierId", u."supplierId")
    AND sp."companyId" = _company_id
  LEFT JOIN "paymentTerm" pt ON pt."id" = sp."paymentTermId"
  WHERE
    COALESCE(ib."current", 0) + COALESCE(ib."bucket1", 0)
      + COALESCE(ib."bucket2", 0) + COALESCE(ib."bucket3", 0)
      + COALESCE(ib."bucket4", 0) + COALESCE(u."unapplied", 0) <> 0
  ORDER BY "total" DESC;
$$;
