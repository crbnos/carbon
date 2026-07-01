-- ============================================================
-- Tie-out + aging RPCs on the unified invoiceSettlement model, accounting for
-- credit/debit memos (now their own `memo` documents, NOT invoice rows).
--
-- Invoice totals come from the salesInvoices / purchaseInvoices views
-- ("totalAmount" = live line total). The subledger control balance =
--   Σ open invoices (+)
--   + Σ open memos (signed by what they do to the control account)
--   − Σ unapplied cash.
--
-- Memo sign on the control account:
--   AR: Credit -> CR receivables (−),  Debit -> DR receivables (+)
--   AP: Debit  -> DR payables    (−),  Credit -> CR payables    (+)
--
-- Each document's "open" is reduced only by CASH (payment-sourced settlement):
-- invoice payments, or refunds against a memo. Memo→invoice credit applications
-- (memoId-sourced) are GL-neutral and net to zero in the signed total (they
-- lower the invoice's open and the memo's remaining by the same amount), so they
-- are intentionally excluded. Cash cuts on payment.postingDate so the subledger
-- reconciles to the GL as of one clock.
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
    invoice_open AS (
      SELECT
        si."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount")
          FROM "invoiceSettlement" pa
          JOIN "payment" p ON p."id" = pa."paymentId"
          WHERE pa."targetSalesInvoiceId" = si."id"
            AND p."status" = 'Posted'
            AND p."postingDate" <= _as_of_date
        ), 0) AS open_inv_ccy,
        si."exchangeRate"
      FROM "salesInvoices" si
      WHERE si."companyId" = _company_id
        AND si."postingDate" <= _as_of_date
        AND si."status" NOT IN ('Draft', 'Pending', 'Voided')
    ),
    -- Posted AR memos, signed: Credit reduces AR (−), Debit increases AR (+).
    -- Open = amount − cash applied against the memo (refund / settlement).
    memo_open AS (
      SELECT
        (CASE WHEN m."direction" = 'Credit' THEN -1 ELSE 1 END)
        * (m."amount" - COALESCE((
            SELECT SUM(pa."appliedAmount")
            FROM "invoiceSettlement" pa
            JOIN "payment" p ON p."id" = pa."paymentId"
            WHERE pa."targetMemoId" = m."id"
              AND p."status" = 'Posted'
              AND p."postingDate" <= _as_of_date
          ), 0))
        * m."exchangeRate" AS open_base
      FROM "memo" m
      WHERE m."companyId" = _company_id
        AND m."customerId" IS NOT NULL
        AND m."status" = 'Posted'
        AND m."postingDate" <= _as_of_date
    ),
    -- Unapplied portion of Posted Receipts, in payment currency.
    payment_unapplied AS (
      SELECT
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
        COALESCE((SELECT SUM(open_inv_ccy * "exchangeRate") FROM invoice_open), 0)
        + COALESCE((SELECT SUM(open_base) FROM memo_open), 0)
        - COALESCE((SELECT SUM(unapplied_pay_ccy * "exchangeRate") FROM payment_unapplied), 0)
        AS amount
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
        pi."totalAmount" - COALESCE((
          SELECT SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount")
          FROM "invoiceSettlement" pa
          JOIN "payment" p ON p."id" = pa."paymentId"
          WHERE pa."targetPurchaseInvoiceId" = pi."id"
            AND p."status" = 'Posted'
            AND p."postingDate" <= _as_of_date
        ), 0) AS open_inv_ccy,
        pi."exchangeRate"
      FROM "purchaseInvoices" pi
      WHERE pi."companyId" = _company_id
        AND pi."postingDate" <= _as_of_date
        AND pi."status" NOT IN ('Draft', 'Pending', 'Voided')
    ),
    -- Posted AP memos, signed: Debit reduces AP (−), Credit increases AP (+).
    memo_open AS (
      SELECT
        (CASE WHEN m."direction" = 'Debit' THEN -1 ELSE 1 END)
        * (m."amount" - COALESCE((
            SELECT SUM(pa."appliedAmount")
            FROM "invoiceSettlement" pa
            JOIN "payment" p ON p."id" = pa."paymentId"
            WHERE pa."targetMemoId" = m."id"
              AND p."status" = 'Posted'
              AND p."postingDate" <= _as_of_date
          ), 0))
        * m."exchangeRate" AS open_base
      FROM "memo" m
      WHERE m."companyId" = _company_id
        AND m."supplierId" IS NOT NULL
        AND m."status" = 'Posted'
        AND m."postingDate" <= _as_of_date
    ),
    payment_unapplied AS (
      SELECT
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
        COALESCE((SELECT SUM(open_inv_ccy * "exchangeRate") FROM invoice_open), 0)
        + COALESCE((SELECT SUM(open_base) FROM memo_open), 0)
        - COALESCE((SELECT SUM(unapplied_pay_ccy * "exchangeRate") FROM payment_unapplied), 0)
        AS amount
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
-- Drill-down: open AR items per customer (invoices + memos)
-- ============================================================
-- `documentType` is 'Invoice' | 'Credit Memo' | 'Debit Memo'. openInCurrency /
-- openInBase carry the control-account sign, so the drill-down sums to the
-- tie-out subledger.

DROP FUNCTION IF EXISTS get_ar_open_by_customer(TEXT, DATE);
CREATE OR REPLACE FUNCTION get_ar_open_by_customer(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "customerId" TEXT,
  "documentId" TEXT,
  "documentNumber" TEXT,
  "documentType" TEXT,
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
  -- Invoices (+open)
  SELECT
    si."customerId",
    si."id" AS "documentId",
    si."invoiceId" AS "documentNumber",
    'Invoice' AS "documentType",
    si."dateDue",
    si."currencyCode",
    si."exchangeRate",
    si."totalAmount",
    COALESCE(s.settled, 0) AS "settled",
    (si."totalAmount" - COALESCE(s.settled, 0)) AS "openInCurrency",
    (si."totalAmount" - COALESCE(s.settled, 0)) * si."exchangeRate" AS "openInBase"
  FROM "salesInvoices" si
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

  UNION ALL

  -- Memos (Credit −, Debit +)
  SELECT
    m."customerId",
    m."id" AS "documentId",
    m."memoId" AS "documentNumber",
    (m."direction" || ' Memo') AS "documentType",
    NULL::DATE AS "dateDue",
    m."currencyCode",
    m."exchangeRate",
    m."amount" AS "totalAmount",
    COALESCE(s.settled, 0) AS "settled",
    (CASE WHEN m."direction" = 'Credit' THEN -1 ELSE 1 END)
      * (m."amount" - COALESCE(s.settled, 0)) AS "openInCurrency",
    (CASE WHEN m."direction" = 'Credit' THEN -1 ELSE 1 END)
      * (m."amount" - COALESCE(s.settled, 0)) * m."exchangeRate" AS "openInBase"
  FROM "memo" m
  LEFT JOIN LATERAL (
    SELECT SUM(pa."appliedAmount") AS settled
    FROM "invoiceSettlement" pa
    JOIN "payment" p ON p."id" = pa."paymentId"
            WHERE pa."targetMemoId" = m."id"
              AND p."status" = 'Posted'
              AND p."postingDate" <= _as_of_date
  ) s ON true
  WHERE m."companyId" = _company_id
    AND m."customerId" IS NOT NULL
    AND m."status" = 'Posted'
    AND m."postingDate" <= _as_of_date
    AND (m."amount" - COALESCE(s.settled, 0)) <> 0
  ORDER BY 1, 5 NULLS LAST;
$$;


-- ============================================================
-- Drill-down: open AP items per supplier (invoices + memos)
-- ============================================================

DROP FUNCTION IF EXISTS get_ap_open_by_supplier(TEXT, DATE);
CREATE OR REPLACE FUNCTION get_ap_open_by_supplier(
  _company_id TEXT,
  _as_of_date DATE
)
RETURNS TABLE (
  "supplierId" TEXT,
  "documentId" TEXT,
  "documentNumber" TEXT,
  "documentType" TEXT,
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
    pi."id" AS "documentId",
    pi."invoiceId" AS "documentNumber",
    'Invoice' AS "documentType",
    pi."dateDue",
    pi."currencyCode",
    pi."exchangeRate",
    pi."totalAmount",
    COALESCE(s.settled, 0) AS "settled",
    (pi."totalAmount" - COALESCE(s.settled, 0)) AS "openInCurrency",
    (pi."totalAmount" - COALESCE(s.settled, 0)) * pi."exchangeRate" AS "openInBase"
  FROM "purchaseInvoices" pi
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

  UNION ALL

  SELECT
    m."supplierId",
    m."id" AS "documentId",
    m."memoId" AS "documentNumber",
    (m."direction" || ' Memo') AS "documentType",
    NULL::DATE AS "dateDue",
    m."currencyCode",
    m."exchangeRate",
    m."amount" AS "totalAmount",
    COALESCE(s.settled, 0) AS "settled",
    (CASE WHEN m."direction" = 'Debit' THEN -1 ELSE 1 END)
      * (m."amount" - COALESCE(s.settled, 0)) AS "openInCurrency",
    (CASE WHEN m."direction" = 'Debit' THEN -1 ELSE 1 END)
      * (m."amount" - COALESCE(s.settled, 0)) * m."exchangeRate" AS "openInBase"
  FROM "memo" m
  LEFT JOIN LATERAL (
    SELECT SUM(pa."appliedAmount") AS settled
    FROM "invoiceSettlement" pa
    JOIN "payment" p ON p."id" = pa."paymentId"
            WHERE pa."targetMemoId" = m."id"
              AND p."status" = 'Posted'
              AND p."postingDate" <= _as_of_date
  ) s ON true
  WHERE m."companyId" = _company_id
    AND m."supplierId" IS NOT NULL
    AND m."status" = 'Posted'
    AND m."postingDate" <= _as_of_date
    AND (m."amount" - COALESCE(s.settled, 0)) <> 0
  ORDER BY 1, 5 NULLS LAST;
$$;


-- ============================================================
-- AR aging (invoices + memos bucketed by age; unapplied cash separate)
-- ============================================================

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
  WITH open_items AS (
    -- Invoices (+open)
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
          AND p."postingDate" <= _as_of_date
      ), 0)) * si."exchangeRate" AS open_base
    FROM "salesInvoices" si
    WHERE si."companyId" = _company_id
      AND si."postingDate" <= _as_of_date
      AND si."status" NOT IN ('Draft', 'Pending', 'Voided')

    UNION ALL

    -- Memos (Credit −, Debit +), aged by their own date
    SELECT
      m."customerId",
      CASE WHEN _aging_method = 'documentDate' THEN m."memoDate" ELSE m."memoDate" END AS age_date,
      (CASE WHEN m."direction" = 'Credit' THEN -1 ELSE 1 END)
      * (m."amount" - COALESCE((
          SELECT SUM(pa."appliedAmount")
          FROM "invoiceSettlement" pa
          JOIN "payment" p ON p."id" = pa."paymentId"
            WHERE pa."targetMemoId" = m."id"
              AND p."status" = 'Posted'
              AND p."postingDate" <= _as_of_date
        ), 0)) * m."exchangeRate" AS open_base
    FROM "memo" m
    WHERE m."companyId" = _company_id
      AND m."customerId" IS NOT NULL
      AND m."status" = 'Posted'
      AND m."postingDate" <= _as_of_date
  ),
  buckets AS (
    SELECT
      "customerId",
      COALESCE(SUM(open_base) FILTER (WHERE age_date IS NULL OR age_date >= _as_of_date), 0) AS "current",
      COALESCE(SUM(open_base) FILTER (WHERE age_date < _as_of_date AND _as_of_date - age_date BETWEEN 1 AND _bucket1), 0) AS "bucket1",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date BETWEEN _bucket1 + 1 AND _bucket2), 0) AS "bucket2",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date BETWEEN _bucket2 + 1 AND _bucket3), 0) AS "bucket3",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date > _bucket3), 0) AS "bucket4"
    FROM open_items
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
  FROM buckets ib
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
  WITH open_items AS (
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
          AND p."postingDate" <= _as_of_date
      ), 0)) * pi."exchangeRate" AS open_base
    FROM "purchaseInvoices" pi
    WHERE pi."companyId" = _company_id
      AND pi."postingDate" <= _as_of_date
      AND pi."status" NOT IN ('Draft', 'Pending', 'Voided')

    UNION ALL

    SELECT
      m."supplierId",
      m."memoDate" AS age_date,
      (CASE WHEN m."direction" = 'Debit' THEN -1 ELSE 1 END)
      * (m."amount" - COALESCE((
          SELECT SUM(pa."appliedAmount")
          FROM "invoiceSettlement" pa
          JOIN "payment" p ON p."id" = pa."paymentId"
            WHERE pa."targetMemoId" = m."id"
              AND p."status" = 'Posted'
              AND p."postingDate" <= _as_of_date
        ), 0)) * m."exchangeRate" AS open_base
    FROM "memo" m
    WHERE m."companyId" = _company_id
      AND m."supplierId" IS NOT NULL
      AND m."status" = 'Posted'
      AND m."postingDate" <= _as_of_date
  ),
  buckets AS (
    SELECT
      "supplierId",
      COALESCE(SUM(open_base) FILTER (WHERE age_date IS NULL OR age_date >= _as_of_date), 0) AS "current",
      COALESCE(SUM(open_base) FILTER (WHERE age_date < _as_of_date AND _as_of_date - age_date BETWEEN 1 AND _bucket1), 0) AS "bucket1",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date BETWEEN _bucket1 + 1 AND _bucket2), 0) AS "bucket2",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date BETWEEN _bucket2 + 1 AND _bucket3), 0) AS "bucket3",
      COALESCE(SUM(open_base) FILTER (WHERE _as_of_date - age_date > _bucket3), 0) AS "bucket4"
    FROM open_items
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
  FROM buckets ib
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
