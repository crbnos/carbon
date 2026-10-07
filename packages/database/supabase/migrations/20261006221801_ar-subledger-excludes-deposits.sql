-- A customer deposit (a payment that references a sales order or rental
-- agreement) books its unapplied cash to the prepayment account
-- (build-payment-journal.ts, CUSTOMER_DEPOSIT_DESCRIPTION), not to
-- receivables. The AR tie-out and aging counted it as on-account AR credit, so
-- every unapplied deposit showed as a tie-out variance and an aging credit.
-- Applying a deposit still reduces the invoice it pays through the invoice's
-- own open amount. Both functions are otherwise unchanged from
-- 20260909174352_account_for_memo_refunds_in_subledger_reports.sql.

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
    SELECT ((CASE WHEN p."paymentType" = 'Receipt' THEN 1 ELSE -1 END)
        * (accounting_round_internal(p."totalAmount" / p."exchangeRate") - COALESCE(c.source_base_amount,0))) AS open_base
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id
      AND p."status" = 'Posted' AND p."postingDate" <= _as_of_date
      -- Party determines the subledger; cash direction determines its sign.
      AND p."customerId" IS NOT NULL
      -- A deposit's unapplied cash sits on the prepayment account, not AR.
      AND p."salesOrderId" IS NULL AND p."rentalAgreementId" IS NULL
  ), subledger AS (
    SELECT COALESCE((SELECT SUM(o."openInBase")
      FROM get_ar_open_by_customer(_company_id, _as_of_date) o), 0)
      - COALESCE((SELECT SUM(open_base) FROM payment_unapplied), 0) AS amount
  ), control_account AS (
    -- A default change affects future postings; historical invoice, payment
    -- and memo control accounts remain part of this company's subledger.
    -- UNION deduplicates repeated control rows and overlap with current defaults.
    SELECT unnest(ARRAY["receivablesAccount", "intercompanyReceivablesAccount"]) AS account_id
    FROM "accountDefault" WHERE "companyId" = _company_id
    UNION
    SELECT line."accountId"
    FROM "journalLine" line
    JOIN "journal" j ON j."id" = line."journalId" AND j."companyId" = line."companyId"
    WHERE line."companyId" = _company_id
      AND j."status" = 'Posted' AND j."postingDate" <= _as_of_date
      AND (
        (j."sourceType" = 'Sales Invoice' AND line."documentType" = 'Invoice'
          AND line."description" = 'Accounts Receivable')
        OR (j."sourceType" = 'Payment' AND line."documentType" = 'Payment'
          AND line."description" IN ('Accounts Receivable',
            'Accounts Receivable (on-account credit)', 'Accounts Receivable (credit applied)'))
        OR (j."sourceType" IN ('Credit Memo', 'Debit Memo') AND line."documentType" = 'Memo'
          AND line."description" = 'Accounts Receivable')
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
$$;

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
  ), open_items AS (
    SELECT o."customerId",
      CASE WHEN o."documentType" = 'Invoice' THEN
        CASE WHEN _aging_method = 'documentDate' THEN COALESCE(i."dateIssued", i."postingDate")
          ELSE o."dateDue" END
        ELSE m."memoDate" END AS age_date,
      o."openInBase" AS open_base
    FROM get_ar_open_by_customer(_company_id, _as_of_date) o
    LEFT JOIN "salesInvoice" i ON i."id" = o."documentId"
      AND i."companyId" = _company_id AND o."documentType" = 'Invoice'
    LEFT JOIN "memo" m ON m."id" = o."documentId"
      AND m."companyId" = _company_id AND o."documentType" <> 'Invoice'
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
    SELECT p."customerId",
      -COALESCE(SUM(((CASE WHEN p."paymentType" = 'Receipt' THEN 1 ELSE -1 END)
        * (accounting_round_internal(p."totalAmount" / p."exchangeRate") - COALESCE(c.source_base_amount,0)))), 0) AS "unapplied"
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id
      AND p."status" = 'Posted' AND p."postingDate" <= _as_of_date
      AND p."customerId" IS NOT NULL
      AND p."salesOrderId" IS NULL AND p."rentalAgreementId" IS NULL
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
