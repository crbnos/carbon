-- ============================================================
-- Invoice balance/status must derive from the LIVE line total (incl. tax)
--
-- Bug: tax added on a purchase invoice line that wasn't on the PO is posted
-- to AP tax-inclusive (with correct PPV), but the payment could only be made
-- for the pre-tax amount. Cause: the views' `balance`, derived `Paid` status,
-- and `datePaid` keyed off the STORED header `totalAmount` — written pre-tax
-- at PO→invoice conversion and deprecated/frozen since 20260604120000 — while
-- the views' own `totalAmount`/`orderTotal` outputs are line-derived and
-- tax-inclusive. post-payment caps applications at the view `balance`, so the
-- tax portion was stranded as an un-relievable AP credit and the invoice
-- flipped to 'Paid' at the pre-tax amount.
--
-- This was fixed in 20260630102736 (balance from live line total), but
-- 20260630151500 (dust forgiveness) forked its view bodies verbatim from the
-- pre-fix 20260630095023 and silently reverted it; 20260702061504 forked from
-- 151500 and perpetuated it. The same fork also reverted:
--   * 20260630105334 — memo-aware `settled` CTE (posted credit/debit memo
--     settlements gated on the applying payment) — memo settlements stopped
--     reducing the view balance.
--   * 20260629120000 — `paymentTermName` on `salesInvoices`.
--
-- Forked verbatim from the newest definitions:
--   * purchaseInvoices — 20260702061504 (keeps the supplierShippingCost
--     divide with zero-guard)
--   * salesInvoices    — 20260630151500 (keeps dust forgiveness)
-- Only the `settled` CTE, the `datePaid`/`balance`/`status` expressions
-- (stored total → live line-derived total), and the restored
-- `paymentTermName` column on salesInvoices change.
--
-- Side effect (correct, but visible): invoices previously derived-'Paid' at
-- the pre-tax amount reopen with a balance equal to the unpaid tax.
-- ============================================================

DROP VIEW IF EXISTS "salesInvoices";
DROP VIEW IF EXISTS "purchaseInvoices";


-- ============================================================
-- salesInvoices — balance/status/datePaid from the live line total,
-- memo-aware settlements, dust forgiveness below $0.01
-- ============================================================

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
    pt."name" AS "paymentTermName"
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


-- ============================================================
-- purchaseInvoices — balance/status/datePaid from the live line total,
-- memo-aware settlements, dust forgiveness below $0.01
-- ============================================================

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
      WHEN COALESCE(s.amount, 0) > 0
        AND (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) > 0
        AND ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0)) < 0.01 THEN 'Paid'
      WHEN COALESCE(s.amount, 0) > 0 THEN 'Partially Paid'
      WHEN pi."dateDue" < CURRENT_DATE AND pi."status" = 'Open' THEN 'Overdue'
      ELSE pi."status"::TEXT
    END AS status,
    pt."name" AS "paymentTermName"
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
