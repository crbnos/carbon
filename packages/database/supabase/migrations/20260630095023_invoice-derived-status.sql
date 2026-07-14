-- ============================================================
-- Invoice status + balance derived from invoiceSettlement
--
-- Today `balance` is a cached NUMERIC column on salesInvoice and
-- purchaseInvoice that is never decremented by anything, and the
-- `Paid` / `Partially Paid` status values are set by hand via
-- updateSalesInvoiceStatus / updatePurchaseInvoiceStatus. The
-- payment + invoiceSettlement tables now make this derivable: a
-- Posted payment's applications sum exactly equals the AR/AP
-- reduction. This migration drops the cached column and recomputes
-- balance + status in the views.
--
-- This forks the view bodies from 20260604120000 (which moved
-- subtotal/totalTax/totalAmount onto live, line-derived computation)
-- and changes only two columns per view: `balance` and `status`.
-- Everything else (the computed totals, thumbnailPath, lines, etc.)
-- is preserved verbatim from that migration.
--
-- Balance/status key off the STORED `totalAmount` (the amount actually
-- invoiced to the counterparty), NOT the live computed display total,
-- so the open balance reconciles with the AR/AP tie-out RPCs (which
-- also use stored totalAmount) and with the apply table.
--
-- Precedence in the status CASE (Paid > Overdue): a paid invoice can
-- never be overdue.
-- ============================================================


-- ============================================================
-- Phase 1: Drop the existing views (they project `balance` from the
-- base table, so the column can't be dropped while they exist)
-- ============================================================

DROP VIEW IF EXISTS "salesInvoices";
DROP VIEW IF EXISTS "purchaseInvoices";


-- ============================================================
-- Phase 2: Drop the cached `balance` column from the base tables
-- ============================================================
-- The views were the only consumers in apps/erp; they're recreated
-- below with a derived balance. The convert edge function and the
-- packages/ee Xero sync providers (bill.ts / invoice.ts) also touched
-- the base column directly and were updated alongside this migration
-- to insert without it / read it from the views.

ALTER TABLE "salesInvoice" DROP COLUMN IF EXISTS "balance";
ALTER TABLE "purchaseInvoice" DROP COLUMN IF EXISTS "balance";


-- ============================================================
-- Phase 3: Recreate salesInvoices with derived balance + status
-- (computed subtotal/totalTax/totalAmount preserved from 20260604120000)
-- ============================================================
-- Active state for sales invoices is 'Submitted'.

CREATE OR REPLACE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT
      pa."targetSalesInvoiceId",
      SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount") AS amount
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
      WHEN COALESCE(s.amount, 0) >= si."totalAmount" AND si."totalAmount" > 0 THEN 'Paid'
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
    si."datePaid",
    si."locationId",
    si."currencyCode",
    COALESCE(sil."subtotal", 0) AS "subtotal",
    si."totalDiscount",
    COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0) AS "totalAmount",
    COALESCE(sil."totalTax", 0) AS "totalTax",
    (si."totalAmount" - COALESCE(s.amount, 0)) AS "balance",
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
-- Phase 4: Recreate purchaseInvoices with derived balance + status
-- (computed subtotal/totalTax/totalAmount preserved from 20260604120000)
-- ============================================================
-- Active state for purchase invoices is 'Open' (renamed from
-- 'Submitted' in 20260422004200).

CREATE OR REPLACE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT
      pa."targetPurchaseInvoiceId",
      SUM(pa."appliedAmount" + pa."discountAmount" + pa."writeOffAmount") AS amount
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
    pi."datePaid",
    pi."paymentTermId",
    pi."currencyCode",
    pi."exchangeRate",
    pi."exchangeRateUpdatedAt",
    COALESCE(pl."subtotal", 0) AS "subtotal",
    pi."totalDiscount",
    (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) AS "totalAmount",
    COALESCE(pl."totalTax", 0) AS "totalTax",
    (pi."totalAmount" - COALESCE(s.amount, 0)) AS "balance",
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
      WHEN COALESCE(s.amount, 0) >= pi."totalAmount" AND pi."totalAmount" > 0 THEN 'Paid'
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
