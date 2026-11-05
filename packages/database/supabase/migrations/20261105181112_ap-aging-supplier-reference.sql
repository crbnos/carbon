-- Add the vendor's own invoice reference to the AP open-invoice reader so AP Aging can show it.
-- The return type changes, so drop first; get_ap_tie_out resolves this function at call time.
DROP FUNCTION IF EXISTS public.get_ap_open_by_supplier(text, date);

CREATE FUNCTION public.get_ap_open_by_supplier(_company_id text, _as_of_date date)
 RETURNS TABLE("supplierId" text, "documentId" text, "documentNumber" text, "documentType" text, "dateDue" date, "currencyCode" text, "exchangeRate" numeric, "totalAmount" numeric, settled numeric, "openInCurrency" numeric, "openInBase" numeric, "supplierReference" text)
 LANGUAGE sql
AS $function$
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
    SELECT s."targetMemoId" AS memo_id,
      SUM(s."sourceAmount") AS settled_document,
      bool_and(s."sourceAmount" IS NOT NULL) AS principal_known,
      SUM(s."appliedAmount") AS settled_base
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
      AND line."description" IN ('Accounts Payable','IC Payables') AND j."sourceType" IN ('Purchase Invoice','Opening Balance')
      AND j."status"='Posted' AND j."postingDate"<=_as_of_date
    GROUP BY line."documentId"
  ), invoice_open AS (
    SELECT i.*, COALESCE(s.settled_base, 0) AS settled_base,
      amounts.remaining_document,
      COALESCE(c.original_base, accounting_round_internal(i."totalAmount")) - COALESCE(s.settled_base,0) AS remaining_base
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
      accounting_round_internal(m."amount"/m."exchangeRate") - COALESCE(s.settled_base,0) - COALESCE(t.settled_base,0) AS remaining_base,
      COALESCE(s.settled_document, 0) + COALESCE(t.settled_document, 0) AS settled_document,
      m."amount" - COALESCE(s.settled_document, 0)
        - COALESCE(t.settled_document, 0) AS remaining_document
    FROM "memo" m
    LEFT JOIN memo_source_consumed s ON s.memo_id = m."id"
    LEFT JOIN memo_target_settled t ON t.memo_id = m."id"
    WHERE m."companyId" = _company_id AND m."supplierId" IS NOT NULL
      AND m."status" = 'Posted' AND m."postingDate" <= _as_of_date
      -- Unknown principal cannot be reconstructed from rounded carrying base.
      AND COALESCE(s.principal_known, true) AND COALESCE(t.principal_known, true)
  )
  -- Preserve totalAmount/settled's existing per-document denomination:
  -- invoices carry base; memo amount/settled carry memo currency.
  SELECT i."supplierId", i."id" AS "documentId", i."invoiceId" AS "documentNumber",
    'Invoice'::TEXT AS "documentType", i."dateDue", i."currencyCode", i."exchangeRate",
    i."totalAmount", i.settled_base AS "settled",
    i.remaining_document AS "openInCurrency",
    i.remaining_base AS "openInBase",
    i."supplierReference"
  FROM invoice_open i
  WHERE i.remaining_document <> 0 OR i.remaining_base <> 0
  UNION ALL
  SELECT m."supplierId", m."id", m."memoId", m."direction" || ' Memo',
    NULL::DATE, m."currencyCode", m."exchangeRate", m."amount", m.settled_document,
    (CASE WHEN m."direction" = 'Debit' THEN -1 ELSE 1 END) * m.remaining_document,
    (CASE WHEN m."direction" = 'Debit' THEN -1 ELSE 1 END)
      * m.remaining_base,
    NULL::TEXT
  FROM memo_open m
  WHERE m.remaining_document <> 0 OR m.remaining_base <> 0
  ORDER BY 1, 5 NULLS LAST;
$function$;
