-- ============================================================
-- Fix supplierShippingCost currency conversion: divide, not multiply
--
-- currency.exchangeRate stores foreign-units-per-base (see the
-- update-exchange-rates job: EUR-based API rates rebased via
-- value / baseRate), so converting a supplier-currency amount to the
-- company base currency is amount / exchangeRate. The line-level
-- generated columns have divided since 20250807094441
-- (fix-purchasing-conversion-factor), but the header-level
-- "purchaseOrders" / "purchaseInvoices" views still MULTIPLIED
-- supplierShippingCost by exchangeRate — inconsistent with the very
-- lines they sum.
--
-- This was originally fixed in 20260616061244, but that migration was
-- backdated: the 20260630 invoice batch (20260630095023 →
-- 20260630151500) forked its purchaseInvoices body from the pre-fix
-- 20260604120000 and silently reverted the divide. 20260616061244 has
-- since been stripped to its trigger fix only (its view recreation also
-- referenced the purchaseInvoice."balance" column dropped by
-- 20260630095023, which broke `supabase db push` on remotes that had
-- already applied the 20260630 batch).
--
-- Forked verbatim from the newest view definitions:
--   * purchaseOrders   — 20260525120000_po-pdf-buyer-and-optional-state.sql
--   * purchaseInvoices — 20260630151500_invoice-dust-forgiveness.sql
-- Only the supplierShippingCost conversion changes: `* exchangeRate` →
-- `/ CASE WHEN exchangeRate = 0 THEN 1 ELSE exchangeRate END`
-- (zero-guard so a bad rate can't divide by zero).
-- ============================================================

DROP VIEW IF EXISTS "purchaseOrders";
CREATE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    pl."thumbnailPath",
    pl."itemType",
    pl."orderTotal" + pd."supplierShippingCost" / CASE WHEN p."exchangeRate" = 0 THEN 1 ELSE p."exchangeRate" END AS "orderTotal",
    pd."shippingMethodId",
    pd."shippingTermId",
    pd."receiptRequestedDate",
    pd."receiptPromisedDate",
    pd."deliveryDate",
    pd."dropShipment",
    pp."paymentTermId",
    pd."locationId",
    pd."supplierShippingCost",
    pd."incoterm",
    pd."incotermLocation",
    u."fullName"   AS "createdByFullName",
    u."email"      AS "createdByEmail",
    u."phone"      AS "createdByPhone",
    ua."fullName"  AS "assigneeFullName",
    ua."email"     AS "assigneeEmail",
    ua."phone"     AS "assigneePhone",
    uam."fullName" AS "accountManagerFullName",
    uam."email"    AS "accountManagerEmail",
    uam."phone"    AS "accountManagerPhone"
  FROM "purchaseOrder" p
  LEFT JOIN (
    SELECT
      pol."purchaseOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(COALESCE(pol."purchaseQuantity", 0)*(COALESCE(pol."unitPrice", 0)) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseOrderLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."purchaseOrderId"
  ) pl ON pl."purchaseOrderId" = p."id"
  LEFT JOIN "purchaseOrderDelivery" pd ON pd."id" = p."id"
  LEFT JOIN "shippingTerm" st ON st."id" = pd."shippingTermId"
  LEFT JOIN "purchaseOrderPayment" pp ON pp."id" = p."id"
  LEFT JOIN "user" u   ON u."id"   = p."createdBy"
  LEFT JOIN "user" ua  ON ua."id"  = p."assignee"
  LEFT JOIN "supplier" s ON s."id" = p."supplierId"
  LEFT JOIN "user" uam ON uam."id" = s."accountManagerId";


DROP VIEW IF EXISTS "purchaseInvoices";
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
    (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) AS "totalAmount",
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
    COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) / CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END AS "orderTotal",
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
