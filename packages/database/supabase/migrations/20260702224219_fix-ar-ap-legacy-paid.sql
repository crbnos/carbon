-- ============================================================
-- Honor legacy base-status 'Paid' invoices as settled + fix view fork regressions
--
-- Problem: invoices whose BASE-table status is 'Paid' with no invoiceSettlement
-- rows (manually marked pre-payments, or written by the Xero sync, which still
-- sets base status + datePaid directly) fell through the views' status CASE to
-- ELSE (displayed 'Paid') but computed balance = totalAmount − 0, and the
-- aging/tie-out RPCs (filter: status NOT IN ('Draft','Pending','Voided'))
-- counted them fully open — inflating aging buckets, dashboard KPIs, and the
-- tie-out subledger. They also can't be settled via post-payment (it requires
-- base status 'Submitted'/'Open').
--
-- Fix: base-table status 'Paid' is now an authoritative "settled" signal:
--   * views: status 'Paid', balance 0, datePaid = base datePaid
--   * RPCs: excluded from the invoice arms when
--       base status = 'Paid' AND (datePaid IS NULL OR datePaid <= _as_of_date)
--     (an invoice paid AFTER the as-of date still shows open historically).
--     The exclusion keys on the BASE table because view status 'Paid' is also
--     produced for settlement-derived paid invoices, which must keep the
--     existing payment.postingDate as-of math.
--   Base 'Partially Paid' with no settlements stays FULLY OPEN (deliberate:
--   the paid amount is unknowable; remediate via a real payment or write-off).
--
-- Fork sources (full bodies, minimal edits):
--   * both views — 20260702114500_invoice-balance-includes-line-tax.sql
--     (keeps its live line-derived total in the balance/status/datePaid
--     math, memo-aware settled CTE, paymentTermName on salesInvoices, the
--     LEFT JOIN on salesInvoiceShipment, dust forgiveness, and the
--     supplierShippingCost divide with zero-guard). The only view edits here
--     are the base-'Paid' branches and the new baseStatus column.
--   * six RPCs   — 20260630104012_tie-out-aging-from-view-total.sql
-- ============================================================

DROP VIEW IF EXISTS "salesInvoices";
CREATE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    -- Amount applied TO this invoice (as the settlement target): Posted cash
    -- payments, and Posted credit memos once the payment applying them is
    -- Posted (a memo staged through a Draft payment doesn't count yet).
    SELECT
      s."targetSalesInvoiceId",
      SUM(s."appliedAmount" + s."discountAmount" + s."writeOffAmount") AS amount,
      MAX(s."appliedDate") AS "lastSettlementDate"
    FROM "invoiceSettlement" s
    LEFT JOIN "payment" p ON p."id" = s."paymentId"
    LEFT JOIN "memo" m ON m."id" = s."memoId"
    LEFT JOIN "payment" vp ON vp."id" = s."appliedViaPaymentId"
    WHERE s."targetSalesInvoiceId" IS NOT NULL
      AND (
        (s."paymentId" IS NOT NULL AND p."status" = 'Posted')
        OR (
          s."memoId" IS NOT NULL AND m."status" = 'Posted'
          AND (s."appliedViaPaymentId" IS NULL OR vp."status" = 'Posted')
        )
      )
    GROUP BY s."targetSalesInvoiceId"
  )
  SELECT
    si."id",
    si."invoiceId",
    CASE
      WHEN si."status" IN ('Draft','Pending','Voided','Return','Credit Note Issued') THEN si."status"::TEXT
      WHEN si."status" = 'Paid' THEN 'Paid'
      WHEN COALESCE(s.amount, 0) > 0
        AND (COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) > 0
        AND ((COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) - COALESCE(s.amount, 0)) < 0.01 THEN 'Paid'
      WHEN COALESCE(s.amount, 0) > 0 THEN 'Partially Paid'
      WHEN si."dateDue" < CURRENT_DATE AND si."status" = 'Submitted' THEN 'Overdue'
      ELSE si."status"::TEXT
    END AS status,
    si."customerId",
    si."customerReference",
    si."invoiceCustomerId",
    si."invoiceCustomerLocationId",
    si."invoiceCustomerContactId",
    si."paymentTermId",
    si."postingDate",
    si."dateIssued",
    si."dateDue",
    CASE
      WHEN si."status" = 'Paid' THEN si."datePaid"
      WHEN COALESCE(s.amount, 0) > 0
        AND (COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) > 0
        AND ((COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) - COALESCE(s.amount, 0)) < 0.01 THEN COALESCE(s."lastSettlementDate", si."datePaid")
      ELSE si."datePaid"
    END AS "datePaid",
    si."locationId",
    si."currencyCode",
    COALESCE(sil."subtotal", 0) AS "subtotal",
    si."totalDiscount",
    COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0) AS "totalAmount",
    COALESCE(sil."totalTax", 0) AS "totalTax",
    CASE
      WHEN si."status" = 'Paid' THEN 0
      WHEN COALESCE(s.amount, 0) > 0
        AND ((COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) - COALESCE(s.amount, 0)) > 0
        AND ((COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) - COALESCE(s.amount, 0)) < 0.01 THEN 0
      ELSE ((COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) - COALESCE(s.amount, 0))
    END AS "balance",
    si."exchangeRate",
    si."exchangeRateUpdatedAt",
    si."opportunityId",
    si."shipmentId",
    si."assignee",
    si."companyId",
    si."customFields",
    si."internalNotes",
    si."externalNotes",
    si."tags",
    si."createdAt",
    si."createdBy",
    si."updatedAt",
    si."updatedBy",
    sil."thumbnailPath",
    sil."itemType",
    COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0) AS "invoiceTotal",
    sil."lines",
    pt."name" AS "paymentTermName",
    si."status" AS "baseStatus"
  FROM "salesInvoice" si
  LEFT JOIN (
    SELECT
      sil."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        COALESCE(sil."quantity", 0)*COALESCE(sil."unitPrice", 0)
        + COALESCE(sil."addOnCost", 0)
        + COALESCE(sil."nonTaxableAddOnCost", 0)
        + COALESCE(sil."shippingCost", 0)
      ) AS "subtotal",
      SUM(
        COALESCE(sil."taxPercent", 0) * (
          COALESCE(sil."quantity", 0)*COALESCE(sil."unitPrice", 0)
          + COALESCE(sil."addOnCost", 0)
          + COALESCE(sil."shippingCost", 0)
        )
      ) AS "totalTax",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        json_build_object(
          'id', sil.id,
          'invoiceLineType', sil."invoiceLineType",
          'quantity', sil."quantity",
          'unitPrice', sil."unitPrice",
          'itemId', sil."itemId"
        )
      ) AS "lines"
    FROM "salesInvoiceLine" sil
    LEFT JOIN "item" i
      ON i."id" = sil."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY sil."invoiceId"
  ) sil ON sil."invoiceId" = si."id"
  -- LEFT JOIN (was INNER): an invoice missing its shipment row must not
  -- vanish from the view — post-payment would read its balance as 0 and
  -- reject every application. shippingCost is already COALESCEd.
  LEFT JOIN "salesInvoiceShipment" ss ON ss."id" = si."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = si."paymentTermId"
  LEFT JOIN settled s ON s."targetSalesInvoiceId" = si."id";


DROP VIEW IF EXISTS "purchaseInvoices";
CREATE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT
      s."targetPurchaseInvoiceId",
      SUM(s."appliedAmount" + s."discountAmount" + s."writeOffAmount") AS amount,
      MAX(s."appliedDate") AS "lastSettlementDate"
    FROM "invoiceSettlement" s
    LEFT JOIN "payment" p ON p."id" = s."paymentId"
    LEFT JOIN "memo" m ON m."id" = s."memoId"
    LEFT JOIN "payment" vp ON vp."id" = s."appliedViaPaymentId"
    WHERE s."targetPurchaseInvoiceId" IS NOT NULL
      AND (
        (s."paymentId" IS NOT NULL AND p."status" = 'Posted')
        OR (
          s."memoId" IS NOT NULL AND m."status" = 'Posted'
          AND (s."appliedViaPaymentId" IS NULL OR vp."status" = 'Posted')
        )
      )
    GROUP BY s."targetPurchaseInvoiceId"
  )
  SELECT
    pi."id",
    pi."invoiceId",
    pi."supplierId",
    pi."invoiceSupplierId",
    pi."supplierInteractionId",
    pi."supplierReference",
    pi."invoiceSupplierContactId",
    pi."invoiceSupplierLocationId",
    pi."locationId",
    pi."postingDate",
    pi."dateIssued",
    pi."dateDue",
    CASE
      WHEN pi."status" = 'Paid' THEN pi."datePaid"
      WHEN COALESCE(s.amount, 0) > 0
        AND (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) > 0
        AND ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0)) < 0.01 THEN COALESCE(s."lastSettlementDate", pi."datePaid")
      ELSE pi."datePaid"
    END AS "datePaid",
    pi."paymentTermId",
    pi."currencyCode",
    pi."exchangeRate",
    pi."exchangeRateUpdatedAt",
    COALESCE(pl."subtotal", 0) AS "subtotal",
    pi."totalDiscount",
    (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) AS "totalAmount",
    COALESCE(pl."totalTax", 0) AS "totalTax",
    CASE
      WHEN pi."status" = 'Paid' THEN 0
      WHEN COALESCE(s.amount, 0) > 0
        AND ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0)) > 0
        AND ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0)) < 0.01 THEN 0
      ELSE ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0))
    END AS "balance",
    pi."assignee",
    pi."createdBy",
    pi."createdAt",
    pi."updatedBy",
    pi."updatedAt",
    pi."internalNotes",
    pi."customFields",
    pi."companyId",
    pl."thumbnailPath",
    pl."itemType",
    COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END AS "orderTotal",
    CASE
      WHEN pi."status" IN ('Draft','Pending','Voided','Return','Debit Note Issued') THEN pi."status"::TEXT
      WHEN pi."status" = 'Paid' THEN 'Paid'
      WHEN COALESCE(s.amount, 0) > 0
        AND (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) > 0
        AND ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0)) < 0.01 THEN 'Paid'
      WHEN COALESCE(s.amount, 0) > 0 THEN 'Partially Paid'
      WHEN pi."dateDue" < CURRENT_DATE AND pi."status" = 'Open' THEN 'Overdue'
      ELSE pi."status"::TEXT
    END AS status,
    pt."name" AS "paymentTermName",
    pi."status" AS "baseStatus"
  FROM "purchaseInvoice" pi
  LEFT JOIN (
    SELECT
      pol."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        COALESCE(pol."quantity", 0)*COALESCE(pol."unitPrice", 0) + COALESCE(pol."shippingCost", 0)
      ) AS "subtotal",
      SUM(COALESCE(pol."taxAmount", 0)) AS "totalTax",
      SUM(
        COALESCE(pol."quantity", 0)*COALESCE(pol."unitPrice", 0) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)
      ) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseInvoiceLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."invoiceId"
  ) pl ON pl."invoiceId" = pi."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = pi."paymentTermId"
  LEFT JOIN "purchaseInvoiceDelivery" pid ON pid."id" = pi."id"
  LEFT JOIN settled s ON s."targetPurchaseInvoiceId" = pi."id";


-- ============================================================
-- RPCs — forked from 20260630104012, single change per invoice arm:
-- join the BASE invoice table and exclude legacy/base-'Paid' invoices
-- (unless their datePaid is after the as-of date).
-- ============================================================

DROP FUNCTION IF EXISTS get_ar_tie_out(TEXT, DATE);
DROP FUNCTION IF EXISTS get_ap_tie_out(TEXT, DATE);
DROP FUNCTION IF EXISTS get_ar_open_by_customer(TEXT, DATE);
DROP FUNCTION IF EXISTS get_ap_open_by_supplier(TEXT, DATE);
DROP FUNCTION IF EXISTS get_ar_aging(TEXT, DATE, TEXT, INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_ap_aging(TEXT, DATE, TEXT, INTEGER, INTEGER, INTEGER);


-- ============================================================
-- AR tie-out
-- ============================================================

CREATE FUNCTION get_ar_tie_out(
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
      JOIN "salesInvoice" sib ON sib."id" = si."id" AND sib."companyId" = si."companyId"
      WHERE si."companyId" = _company_id
        AND si."postingDate" <= _as_of_date
        AND si."status" NOT IN ('Draft', 'Pending', 'Voided')
        AND NOT (
          sib."status" = 'Paid'
          AND (sib."datePaid" IS NULL OR sib."datePaid" <= _as_of_date)
        )
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

CREATE FUNCTION get_ap_tie_out(
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
      JOIN "purchaseInvoice" pib ON pib."id" = pi."id" AND pib."companyId" = pi."companyId"
      WHERE pi."companyId" = _company_id
        AND pi."postingDate" <= _as_of_date
        AND pi."status" NOT IN ('Draft', 'Pending', 'Voided')
        AND NOT (
          pib."status" = 'Paid'
          AND (pib."datePaid" IS NULL OR pib."datePaid" <= _as_of_date)
        )
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

CREATE FUNCTION get_ar_open_by_customer(
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
  JOIN "salesInvoice" sib ON sib."id" = si."id" AND sib."companyId" = si."companyId"
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
    AND NOT (
      sib."status" = 'Paid'
      AND (sib."datePaid" IS NULL OR sib."datePaid" <= _as_of_date)
    )
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

CREATE FUNCTION get_ap_open_by_supplier(
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
  JOIN "purchaseInvoice" pib ON pib."id" = pi."id" AND pib."companyId" = pi."companyId"
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
    AND NOT (
      pib."status" = 'Paid'
      AND (pib."datePaid" IS NULL OR pib."datePaid" <= _as_of_date)
    )
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

CREATE FUNCTION get_ar_aging(
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
    JOIN "salesInvoice" sib ON sib."id" = si."id" AND sib."companyId" = si."companyId"
    WHERE si."companyId" = _company_id
      AND si."postingDate" <= _as_of_date
      AND si."status" NOT IN ('Draft', 'Pending', 'Voided')
      AND NOT (
        sib."status" = 'Paid'
        AND (sib."datePaid" IS NULL OR sib."datePaid" <= _as_of_date)
      )

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

CREATE FUNCTION get_ap_aging(
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
    JOIN "purchaseInvoice" pib ON pib."id" = pi."id" AND pib."companyId" = pi."companyId"
    WHERE pi."companyId" = _company_id
      AND pi."postingDate" <= _as_of_date
      AND pi."status" NOT IN ('Draft', 'Pending', 'Voided')
      AND NOT (
        pib."status" = 'Paid'
        AND (pib."datePaid" IS NULL OR pib."datePaid" <= _as_of_date)
      )

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
