-- ============================================================
-- Invoice sub-cent balance forgiveness — treat dust as Paid
--
-- After applying settlements, FX rounding can leave a tiny residual
-- balance (e.g. 0.003) that will never be collected. Today the
-- `salesInvoices` / `purchaseInvoices` views (20260630095023) show such
-- an invoice as 'Partially Paid' with a balance of 0.003..., which is
-- noise — the invoice is, for all practical purposes, paid.
--
-- This recreates both views to forgive dust below $0.01 (one cent, the
-- smallest representable currency unit). Mirrors the app-layer
-- INVOICE_DUST_THRESHOLD in apps/erp/app/modules/invoicing/invoicing.models.ts.
-- For an invoice with at least one posted settlement whose remaining
-- balance is a positive amount below $0.01:
--   * balance  → 0           (no more 0.001... dust in the column)
--   * status   → 'Paid'      (not 'Partially Paid')
--   * datePaid → last settlement date
--
-- Everything else is preserved verbatim from 20260630095023. Only the
-- `settled` CTE (gains a MAX(appliedDate)), and the `datePaid`,
-- `balance`, and `status` columns change. Fully-paid invoices already
-- satisfy `balance < 0.01` (balance <= 0), so they keep showing 'Paid';
-- fully-unpaid invoices have no settlement (s.amount = 0) and are
-- untouched; invoices with balance >= $0.01 fall through to the existing
-- 'Partially Paid' / 'Overdue' / status branches.
-- ============================================================


-- ============================================================
-- Phase 1: Drop existing views
-- CREATE OR REPLACE VIEW cannot change column expression types
-- (e.g. simple column → CASE expression), so we must drop + recreate.
-- ============================================================

DROP VIEW IF EXISTS "salesInvoices";
DROP VIEW IF EXISTS "purchaseInvoices";


-- ============================================================
-- salesInvoices — derived balance/status/datePaid with dust forgiveness
-- Active state for sales invoices is 'Submitted'.
-- ============================================================

CREATE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT
      pa."targetSalesInvoiceId",
      SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount") AS amount,
      MAX(pa."appliedDate") AS "lastSettlementDate"
    FROM "invoiceSettlement" pa
    JOIN "payment" p ON p."id" = pa."paymentId"
    WHERE p."status" = 'Posted' AND pa."targetSalesInvoiceId" IS NOT NULL
    GROUP BY pa."targetSalesInvoiceId"
  )
  SELECT
    si."id",
    si."invoiceId",
    CASE
      WHEN si."status" IN ('Draft','Pending','Voided','Return','Credit Note Issued') THEN si."status"::TEXT
      WHEN COALESCE(s.amount, 0) > 0 AND si."totalAmount" > 0 AND (si."totalAmount" - COALESCE(s.amount, 0)) < 0.01 THEN 'Paid'
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
      WHEN COALESCE(s.amount, 0) > 0 AND si."totalAmount" > 0 AND (si."totalAmount" - COALESCE(s.amount, 0)) < 0.01 THEN COALESCE(s."lastSettlementDate", si."datePaid")
      ELSE si."datePaid"
    END AS "datePaid",
    si."locationId",
    si."currencyCode",
    COALESCE(sil."subtotal", 0) AS "subtotal",
    si."totalDiscount",
    COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0) AS "totalAmount",
    COALESCE(sil."totalTax", 0) AS "totalTax",
    CASE
      WHEN COALESCE(s.amount, 0) > 0 AND (si."totalAmount" - COALESCE(s.amount, 0)) > 0 AND (si."totalAmount" - COALESCE(s.amount, 0)) < 0.01 THEN 0
      ELSE (si."totalAmount" - COALESCE(s.amount, 0))
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
    sil."lines"
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
  JOIN "salesInvoiceShipment" ss ON ss."id" = si."id"
  LEFT JOIN settled s ON s."targetSalesInvoiceId" = si."id";


-- ============================================================
-- purchaseInvoices — derived balance/status/datePaid with dust forgiveness
-- Active state for purchase invoices is 'Open'.
-- ============================================================

CREATE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT
      pa."targetPurchaseInvoiceId",
      SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount") AS amount,
      MAX(pa."appliedDate") AS "lastSettlementDate"
    FROM "invoiceSettlement" pa
    JOIN "payment" p ON p."id" = pa."paymentId"
    WHERE p."status" = 'Posted' AND pa."targetPurchaseInvoiceId" IS NOT NULL
    GROUP BY pa."targetPurchaseInvoiceId"
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
      WHEN COALESCE(s.amount, 0) > 0 AND pi."totalAmount" > 0 AND (pi."totalAmount" - COALESCE(s.amount, 0)) < 0.01 THEN COALESCE(s."lastSettlementDate", pi."datePaid")
      ELSE pi."datePaid"
    END AS "datePaid",
    pi."paymentTermId",
    pi."currencyCode",
    pi."exchangeRate",
    pi."exchangeRateUpdatedAt",
    COALESCE(pl."subtotal", 0) AS "subtotal",
    pi."totalDiscount",
    (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) AS "totalAmount",
    COALESCE(pl."totalTax", 0) AS "totalTax",
    CASE
      WHEN COALESCE(s.amount, 0) > 0 AND (pi."totalAmount" - COALESCE(s.amount, 0)) > 0 AND (pi."totalAmount" - COALESCE(s.amount, 0)) < 0.01 THEN 0
      ELSE (pi."totalAmount" - COALESCE(s.amount, 0))
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
    COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END AS "orderTotal",
    CASE
      WHEN pi."status" IN ('Draft','Pending','Voided','Return','Debit Note Issued') THEN pi."status"::TEXT
      WHEN COALESCE(s.amount, 0) > 0 AND pi."totalAmount" > 0 AND (pi."totalAmount" - COALESCE(s.amount, 0)) < 0.01 THEN 'Paid'
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
