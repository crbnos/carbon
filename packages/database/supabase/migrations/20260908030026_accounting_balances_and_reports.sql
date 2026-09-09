
-- Invoice balances and reporting normalized to the document/source currency contract.
-- Requires new sourceAmount column. No historical fallback/backfill.
-- Currency precision is group configuration, never a hardcoded two decimals.
-- Save/post refuse missing config/rates; the LEFT JOIN keeps operational draft rows visible.
-- Read balances preserve sub-internal-unit foreign remainders; only ledger lines use internal rounding.

-- Latest source: packages/database/supabase/migrations/20260702224219_fix-ar-ap-legacy-paid.sql
CREATE OR REPLACE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT s."targetSalesInvoiceId", s."companyId",
      SUM(COALESCE(s."sourceAmount", 0) + round(
        (s."discountAmount" + s."writeOffAmount") * target."exchangeRate",
        target_currency."decimalPlaces")) AS amount_document,
      MAX(s."appliedDate") AS "lastSettlementDate"
    FROM "invoiceSettlement" s
    JOIN "salesInvoice" target ON target."id" = s."targetSalesInvoiceId"
      AND target."companyId" = s."companyId"
    LEFT JOIN "company" target_company ON target_company."id" = target."companyId"
    LEFT JOIN "currency" target_currency ON target_currency."code" = target."currencyCode"
      AND target_currency."companyGroupId" = target_company."companyGroupId"
    LEFT JOIN "payment" p ON p."id" = s."paymentId" AND p."companyId" = s."companyId"
    LEFT JOIN "memo" m ON m."id" = s."memoId" AND m."companyId" = s."companyId"
    LEFT JOIN "payment" vp ON vp."id" = s."appliedViaPaymentId" AND vp."companyId" = s."companyId"
    WHERE s."targetSalesInvoiceId" IS NOT NULL
      AND ((s."paymentId" IS NOT NULL AND p."status" = 'Posted')
        OR (s."memoId" IS NOT NULL AND m."status" = 'Posted'
          AND (s."appliedViaPaymentId" IS NULL OR vp."status" = 'Posted')))
    GROUP BY s."targetSalesInvoiceId", s."companyId"
  )
  SELECT
    si."id",
    si."invoiceId",
    CASE
      WHEN si."status" IN ('Draft','Pending','Voided','Return','Credit Note Issued') THEN si."status"::TEXT
      WHEN si."status" = 'Paid' THEN 'Paid'
      WHEN COALESCE(s.amount_document, 0) > 0
        AND amounts.total_document > 0 AND remaining.amount_document <= 0 THEN 'Paid'
      WHEN COALESCE(s.amount_document, 0) > 0 THEN 'Partially Paid'
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
      WHEN COALESCE(s.amount_document, 0) > 0
        AND amounts.total_document > 0 AND remaining.amount_document <= 0
        THEN COALESCE(s."lastSettlementDate", si."datePaid")
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
      ELSE remaining.amount_document / NULLIF(si."exchangeRate", 0)
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
  LEFT JOIN settled s ON s."targetSalesInvoiceId" = si."id" AND s."companyId" = si."companyId"
  LEFT JOIN "company" invoice_company ON invoice_company."id" = si."companyId"
  LEFT JOIN "currency" invoice_currency ON invoice_currency."code" = si."currencyCode"
    AND invoice_currency."companyGroupId" = invoice_company."companyGroupId"
  CROSS JOIN LATERAL (
    SELECT round((COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) * si."exchangeRate", invoice_currency."decimalPlaces") AS total_document
  ) amounts
  CROSS JOIN LATERAL (
    SELECT amounts.total_document - COALESCE(s.amount_document, 0) AS amount_document
  ) remaining;

-- Latest source: packages/database/supabase/migrations/20260811123616_widen-purchasing-scale.sql
CREATE OR REPLACE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT s."targetPurchaseInvoiceId", s."companyId",
      SUM(COALESCE(s."sourceAmount", 0) + round(
        (s."discountAmount" + s."writeOffAmount") * target."exchangeRate",
        target_currency."decimalPlaces")) AS amount_document,
      MAX(s."appliedDate") AS "lastSettlementDate"
    FROM "invoiceSettlement" s
    JOIN "purchaseInvoice" target ON target."id" = s."targetPurchaseInvoiceId"
      AND target."companyId" = s."companyId"
    LEFT JOIN "company" target_company ON target_company."id" = target."companyId"
    LEFT JOIN "currency" target_currency ON target_currency."code" = target."currencyCode"
      AND target_currency."companyGroupId" = target_company."companyGroupId"
    LEFT JOIN "payment" p ON p."id" = s."paymentId" AND p."companyId" = s."companyId"
    LEFT JOIN "memo" m ON m."id" = s."memoId" AND m."companyId" = s."companyId"
    LEFT JOIN "payment" vp ON vp."id" = s."appliedViaPaymentId" AND vp."companyId" = s."companyId"
    WHERE s."targetPurchaseInvoiceId" IS NOT NULL
      AND ((s."paymentId" IS NOT NULL AND p."status" = 'Posted')
        OR (s."memoId" IS NOT NULL AND m."status" = 'Posted'
          AND (s."appliedViaPaymentId" IS NULL OR vp."status" = 'Posted')))
    GROUP BY s."targetPurchaseInvoiceId", s."companyId"
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
      WHEN COALESCE(s.amount_document, 0) > 0
        AND amounts.total_document > 0 AND remaining.amount_document <= 0
        THEN COALESCE(s."lastSettlementDate", pi."datePaid")
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
      ELSE remaining.amount_document / NULLIF(pi."exchangeRate", 0)
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
      WHEN COALESCE(s.amount_document, 0) > 0
        AND amounts.total_document > 0 AND remaining.amount_document <= 0 THEN 'Paid'
      WHEN COALESCE(s.amount_document, 0) > 0 THEN 'Partially Paid'
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
  LEFT JOIN settled s ON s."targetPurchaseInvoiceId" = pi."id" AND s."companyId" = pi."companyId"
  LEFT JOIN "company" invoice_company ON invoice_company."id" = pi."companyId"
  LEFT JOIN "currency" invoice_currency ON invoice_currency."code" = pi."currencyCode"
    AND invoice_currency."companyGroupId" = invoice_company."companyGroupId"
  CROSS JOIN LATERAL (
    SELECT round((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) * pi."exchangeRate", invoice_currency."decimalPlaces") AS total_document
  ) amounts
  CROSS JOIN LATERAL (
    SELECT amounts.total_document - COALESCE(s.amount_document, 0) AS amount_document
  ) remaining;

-- Report replacements retain all six RPC signatures.
-- Latest behavior source: 20260702224219_fix-ar-ap-legacy-paid.sql, all six RPCs.
-- CREATE OR REPLACE preserves argument/return signatures, ownership and ACLs.
-- Existing views also need the separate document-remainder/sourceAmount update.
-- No reset, legacy version, historical posted-row backfill, or new public RPC.

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
  WITH effective_settlements AS (
    SELECT s.*
    FROM "invoiceSettlement" s
    LEFT JOIN "payment" p ON p."id" = s."paymentId"
      AND p."companyId" = s."companyId"
    LEFT JOIN "memo" source_memo ON source_memo."id" = s."memoId"
      AND source_memo."companyId" = s."companyId"
    LEFT JOIN "payment" applying ON applying."id" = s."appliedViaPaymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND (
        (s."paymentId" IS NOT NULL AND p."status" = 'Posted'
          AND p."postingDate" <= _as_of_date)
        OR (s."memoId" IS NOT NULL AND source_memo."status" = 'Posted'
          AND source_memo."postingDate" <= _as_of_date
          AND ((s."appliedViaPaymentId" IS NULL AND s."appliedDate" <= _as_of_date) OR
            (applying."status" = 'Posted' AND applying."postingDate" <= _as_of_date)))
      )
  ), invoice_settled AS (
    SELECT s."targetSalesInvoiceId" AS invoice_id,
      SUM(s."appliedAmount" + s."discountAmount" + s."writeOffAmount") AS settled_base,
      SUM(COALESCE(s."sourceAmount", 0) + round(
        (s."discountAmount" + s."writeOffAmount") * target."exchangeRate",
        target_currency."decimalPlaces")) AS settled_document
    FROM effective_settlements s
    JOIN "salesInvoice" target ON target."id" = s."targetSalesInvoiceId"
      AND target."companyId" = s."companyId"
    LEFT JOIN "company" target_company ON target_company."id" = target."companyId"
    LEFT JOIN "currency" target_currency ON target_currency."code" = target."currencyCode"
      AND target_currency."companyGroupId" = target_company."companyGroupId"
    WHERE s."targetSalesInvoiceId" IS NOT NULL
    GROUP BY s."targetSalesInvoiceId"
  ), memo_source_consumed AS (
    SELECT s."memoId" AS memo_id, SUM(s."sourceAmount") AS settled_document,
      bool_and(s."sourceAmount" IS NOT NULL) AS principal_known,
      SUM(s."appliedAmount" + s."fxGainLossAmount") AS settled_base
    FROM effective_settlements s
    WHERE s."memoId" IS NOT NULL
    GROUP BY s."memoId"
  ), memo_target_settled AS (
    -- Preserve existing cash-to-memo rows without adding a new refund workflow.
    -- These fields relieve the TARGET memo in base, unlike sourceAmount.
    SELECT s."targetMemoId" AS memo_id, SUM(s."appliedAmount") AS settled_base
    FROM effective_settlements s
    WHERE s."targetMemoId" IS NOT NULL AND s."paymentId" IS NOT NULL
    GROUP BY s."targetMemoId"
  ), invoice_carrying AS (
    -- Same original control snapshots used by post-payment; a document rate
    -- conversion cannot reconstruct carrying value after document rounding.
    SELECT line."documentId" AS invoice_id, SUM(line."amount") AS original_base
    FROM "journalLine" line
    JOIN "journal" j ON j."id"=line."journalId" AND j."companyId"=line."companyId"
    WHERE line."companyId"=_company_id AND line."documentType"='Invoice'
      AND line."description" IN ('Accounts Receivable','IC Receivables') AND j."sourceType"='Sales Invoice'
      AND j."status"='Posted' AND j."postingDate"<=_as_of_date
    GROUP BY line."documentId"
  ), invoice_open AS (
    SELECT i.*, COALESCE(s.settled_base, 0) AS settled_base,
      amounts.remaining_document,
      COALESCE(c.original_base, round(i."totalAmount",5)) - COALESCE(s.settled_base,0) AS remaining_base
    FROM "salesInvoices" i
    JOIN "salesInvoice" ib ON ib."id" = i."id" AND ib."companyId" = i."companyId"
    LEFT JOIN invoice_settled s ON s.invoice_id = i."id"
    LEFT JOIN invoice_carrying c ON c.invoice_id = i."id"
    LEFT JOIN "company" invoice_company ON invoice_company."id" = i."companyId"
    LEFT JOIN "currency" invoice_currency ON invoice_currency."code" = i."currencyCode"
      AND invoice_currency."companyGroupId" = invoice_company."companyGroupId"
    CROSS JOIN LATERAL (
      SELECT round(i."totalAmount" * i."exchangeRate", invoice_currency."decimalPlaces")
        - COALESCE(s.settled_document, 0) AS remaining_document
    ) amounts
    WHERE i."companyId" = _company_id
      AND i."postingDate" <= _as_of_date
      AND i."status" NOT IN ('Draft', 'Pending', 'Voided')
      AND NOT (ib."status" = 'Paid'
        AND (ib."datePaid" IS NULL OR ib."datePaid" <= _as_of_date))
  ), memo_open AS (
    SELECT m.*,
      round(m."amount"/m."exchangeRate",5) - COALESCE(s.settled_base,0) - COALESCE(t.settled_base,0) AS remaining_base,
      COALESCE(s.settled_document, 0) + COALESCE(t.settled_base, 0) * m."exchangeRate" AS settled_document,
      m."amount" - COALESCE(s.settled_document, 0)
        - COALESCE(t.settled_base, 0) * m."exchangeRate" AS remaining_document
    FROM "memo" m
    LEFT JOIN memo_source_consumed s ON s.memo_id = m."id"
    LEFT JOIN memo_target_settled t ON t.memo_id = m."id"
    WHERE m."companyId" = _company_id AND m."customerId" IS NOT NULL
      AND m."status" = 'Posted' AND m."postingDate" <= _as_of_date
      -- Unknown principal cannot be reconstructed from rounded carrying base.
      AND COALESCE(s.principal_known, true)
  )
  -- Preserve totalAmount/settled's existing per-document denomination:
  -- invoices carry base; memo amount/settled carry memo currency.
  SELECT i."customerId", i."id" AS "documentId", i."invoiceId" AS "documentNumber",
    'Invoice'::TEXT AS "documentType", i."dateDue", i."currencyCode", i."exchangeRate",
    i."totalAmount", i.settled_base AS "settled",
    i.remaining_document AS "openInCurrency",
    i.remaining_base AS "openInBase"
  FROM invoice_open i
  WHERE i.remaining_document <> 0 OR i.remaining_base <> 0
  UNION ALL
  SELECT m."customerId", m."id", m."memoId", m."direction" || ' Memo',
    NULL::DATE, m."currencyCode", m."exchangeRate", m."amount", m.settled_document,
    (CASE WHEN m."direction" = 'Credit' THEN -1 ELSE 1 END) * m.remaining_document,
    (CASE WHEN m."direction" = 'Credit' THEN -1 ELSE 1 END)
      * m.remaining_base
  FROM memo_open m
  WHERE m.remaining_document <> 0 OR m.remaining_base <> 0
  ORDER BY 1, 5 NULLS LAST;
$$;

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
  WITH effective_settlements AS (
    SELECT s.*
    FROM "invoiceSettlement" s
    LEFT JOIN "payment" p ON p."id" = s."paymentId"
      AND p."companyId" = s."companyId"
    LEFT JOIN "memo" source_memo ON source_memo."id" = s."memoId"
      AND source_memo."companyId" = s."companyId"
    LEFT JOIN "payment" applying ON applying."id" = s."appliedViaPaymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND (
        (s."paymentId" IS NOT NULL AND p."status" = 'Posted'
          AND p."postingDate" <= _as_of_date)
        OR (s."memoId" IS NOT NULL AND source_memo."status" = 'Posted'
          AND source_memo."postingDate" <= _as_of_date
          AND ((s."appliedViaPaymentId" IS NULL AND s."appliedDate" <= _as_of_date) OR
            (applying."status" = 'Posted' AND applying."postingDate" <= _as_of_date)))
      )
  ), invoice_settled AS (
    SELECT s."targetPurchaseInvoiceId" AS invoice_id,
      SUM(s."appliedAmount" + s."discountAmount" + s."writeOffAmount") AS settled_base,
      SUM(COALESCE(s."sourceAmount", 0) + round(
        (s."discountAmount" + s."writeOffAmount") * target."exchangeRate",
        target_currency."decimalPlaces")) AS settled_document
    FROM effective_settlements s
    JOIN "purchaseInvoice" target ON target."id" = s."targetPurchaseInvoiceId"
      AND target."companyId" = s."companyId"
    LEFT JOIN "company" target_company ON target_company."id" = target."companyId"
    LEFT JOIN "currency" target_currency ON target_currency."code" = target."currencyCode"
      AND target_currency."companyGroupId" = target_company."companyGroupId"
    WHERE s."targetPurchaseInvoiceId" IS NOT NULL
    GROUP BY s."targetPurchaseInvoiceId"
  ), memo_source_consumed AS (
    SELECT s."memoId" AS memo_id, SUM(s."sourceAmount") AS settled_document,
      bool_and(s."sourceAmount" IS NOT NULL) AS principal_known,
      SUM(s."appliedAmount" - s."fxGainLossAmount") AS settled_base
    FROM effective_settlements s
    WHERE s."memoId" IS NOT NULL
    GROUP BY s."memoId"
  ), memo_target_settled AS (
    -- Preserve existing cash-to-memo rows without adding a new refund workflow.
    -- These fields relieve the TARGET memo in base, unlike sourceAmount.
    SELECT s."targetMemoId" AS memo_id, SUM(s."appliedAmount") AS settled_base
    FROM effective_settlements s
    WHERE s."targetMemoId" IS NOT NULL AND s."paymentId" IS NOT NULL
    GROUP BY s."targetMemoId"
  ), invoice_carrying AS (
    -- Same original control snapshots used by post-payment; a document rate
    -- conversion cannot reconstruct carrying value after document rounding.
    SELECT line."documentId" AS invoice_id, SUM(line."amount") AS original_base
    FROM "journalLine" line
    JOIN "journal" j ON j."id"=line."journalId" AND j."companyId"=line."companyId"
    WHERE line."companyId"=_company_id AND line."documentType"='Invoice'
      AND line."description" IN ('Accounts Payable','IC Payables') AND j."sourceType"='Purchase Invoice'
      AND j."status"='Posted' AND j."postingDate"<=_as_of_date
    GROUP BY line."documentId"
  ), invoice_open AS (
    SELECT i.*, COALESCE(s.settled_base, 0) AS settled_base,
      amounts.remaining_document,
      COALESCE(c.original_base, round(i."totalAmount",5)) - COALESCE(s.settled_base,0) AS remaining_base
    FROM "purchaseInvoices" i
    JOIN "purchaseInvoice" ib ON ib."id" = i."id" AND ib."companyId" = i."companyId"
    LEFT JOIN invoice_settled s ON s.invoice_id = i."id"
    LEFT JOIN invoice_carrying c ON c.invoice_id = i."id"
    LEFT JOIN "company" invoice_company ON invoice_company."id" = i."companyId"
    LEFT JOIN "currency" invoice_currency ON invoice_currency."code" = i."currencyCode"
      AND invoice_currency."companyGroupId" = invoice_company."companyGroupId"
    CROSS JOIN LATERAL (
      SELECT round(i."totalAmount" * i."exchangeRate", invoice_currency."decimalPlaces")
        - COALESCE(s.settled_document, 0) AS remaining_document
    ) amounts
    WHERE i."companyId" = _company_id
      AND i."postingDate" <= _as_of_date
      AND i."status" NOT IN ('Draft', 'Pending', 'Voided')
      AND NOT (ib."status" = 'Paid'
        AND (ib."datePaid" IS NULL OR ib."datePaid" <= _as_of_date))
  ), memo_open AS (
    SELECT m.*,
      round(m."amount"/m."exchangeRate",5) - COALESCE(s.settled_base,0) - COALESCE(t.settled_base,0) AS remaining_base,
      COALESCE(s.settled_document, 0) + COALESCE(t.settled_base, 0) * m."exchangeRate" AS settled_document,
      m."amount" - COALESCE(s.settled_document, 0)
        - COALESCE(t.settled_base, 0) * m."exchangeRate" AS remaining_document
    FROM "memo" m
    LEFT JOIN memo_source_consumed s ON s.memo_id = m."id"
    LEFT JOIN memo_target_settled t ON t.memo_id = m."id"
    WHERE m."companyId" = _company_id AND m."supplierId" IS NOT NULL
      AND m."status" = 'Posted' AND m."postingDate" <= _as_of_date
      -- Unknown principal cannot be reconstructed from rounded carrying base.
      AND COALESCE(s.principal_known, true)
  )
  -- Preserve totalAmount/settled's existing per-document denomination:
  -- invoices carry base; memo amount/settled carry memo currency.
  SELECT i."supplierId", i."id" AS "documentId", i."invoiceId" AS "documentNumber",
    'Invoice'::TEXT AS "documentType", i."dateDue", i."currencyCode", i."exchangeRate",
    i."totalAmount", i.settled_base AS "settled",
    i.remaining_document AS "openInCurrency",
    i.remaining_base AS "openInBase"
  FROM invoice_open i
  WHERE i.remaining_document <> 0 OR i.remaining_base <> 0
  UNION ALL
  SELECT m."supplierId", m."id", m."memoId", m."direction" || ' Memo',
    NULL::DATE, m."currencyCode", m."exchangeRate", m."amount", m.settled_document,
    (CASE WHEN m."direction" = 'Debit' THEN -1 ELSE 1 END) * m.remaining_document,
    (CASE WHEN m."direction" = 'Debit' THEN -1 ELSE 1 END)
      * m.remaining_base
  FROM memo_open m
  WHERE m.remaining_document <> 0 OR m.remaining_base <> 0
  ORDER BY 1, 5 NULLS LAST;
$$;

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
      SUM(s."appliedAmount" + s."fxGainLossAmount") AS source_base_amount
    FROM "invoiceSettlement" s
    JOIN "payment" applying ON applying."id" = s."paymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND s."paymentId" IS NOT NULL
      AND applying."status" = 'Posted'
      AND applying."postingDate" <= _as_of_date
    GROUP BY COALESCE(s."sourcePaymentId", s."paymentId")
  ), payment_unapplied AS (
    SELECT (round(p."totalAmount" / p."exchangeRate",5) - COALESCE(c.source_base_amount,0)) AS open_base
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id AND p."paymentType" = 'Receipt'
      AND p."status" = 'Posted' AND p."postingDate" <= _as_of_date
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
  WITH funding_consumed AS (
    SELECT COALESCE(s."sourcePaymentId", s."paymentId") AS source_payment_id,
      SUM(s."appliedAmount" - s."fxGainLossAmount") AS source_base_amount
    FROM "invoiceSettlement" s
    JOIN "payment" applying ON applying."id" = s."paymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND s."paymentId" IS NOT NULL
      AND applying."status" = 'Posted'
      AND applying."postingDate" <= _as_of_date
    GROUP BY COALESCE(s."sourcePaymentId", s."paymentId")
  ), payment_unapplied AS (
    SELECT (round(p."totalAmount" / p."exchangeRate",5) - COALESCE(c.source_base_amount,0)) AS open_base
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id AND p."paymentType" = 'Disbursement'
      AND p."status" = 'Posted' AND p."postingDate" <= _as_of_date
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
        (j."sourceType" = 'Purchase Invoice' AND line."documentType" = 'Invoice'
          AND line."description" = 'Accounts Payable')
        OR (j."sourceType" = 'Payment' AND line."documentType" = 'Payment'
          AND line."description" IN ('Accounts Payable',
            'Accounts Payable (on-account credit)', 'Accounts Payable (credit applied)'))
        OR (j."sourceType" IN ('Credit Memo', 'Debit Memo') AND line."documentType" = 'Memo'
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
      SUM(s."appliedAmount" + s."fxGainLossAmount") AS source_base_amount
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
      -COALESCE(SUM((round(p."totalAmount" / p."exchangeRate",5) - COALESCE(c.source_base_amount,0))), 0) AS "unapplied"
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id AND p."paymentType" = 'Receipt'
      AND p."status" = 'Posted' AND p."postingDate" <= _as_of_date
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
  WITH funding_consumed AS (
    SELECT COALESCE(s."sourcePaymentId", s."paymentId") AS source_payment_id,
      SUM(s."appliedAmount" - s."fxGainLossAmount") AS source_base_amount
    FROM "invoiceSettlement" s
    JOIN "payment" applying ON applying."id" = s."paymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND s."paymentId" IS NOT NULL
      AND applying."status" = 'Posted'
      AND applying."postingDate" <= _as_of_date
    GROUP BY COALESCE(s."sourcePaymentId", s."paymentId")
  ), open_items AS (
    SELECT o."supplierId",
      CASE WHEN o."documentType" = 'Invoice' THEN
        CASE WHEN _aging_method = 'documentDate' THEN COALESCE(i."dateIssued", i."postingDate")
          ELSE o."dateDue" END
        ELSE m."memoDate" END AS age_date,
      o."openInBase" AS open_base
    FROM get_ap_open_by_supplier(_company_id, _as_of_date) o
    LEFT JOIN "purchaseInvoice" i ON i."id" = o."documentId"
      AND i."companyId" = _company_id AND o."documentType" = 'Invoice'
    LEFT JOIN "memo" m ON m."id" = o."documentId"
      AND m."companyId" = _company_id AND o."documentType" <> 'Invoice'
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
    SELECT p."supplierId",
      -COALESCE(SUM((round(p."totalAmount" / p."exchangeRate",5) - COALESCE(c.source_base_amount,0))), 0) AS "unapplied"
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id AND p."paymentType" = 'Disbursement'
      AND p."status" = 'Posted' AND p."postingDate" <= _as_of_date
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

NOTIFY pgrst, 'reload schema';
