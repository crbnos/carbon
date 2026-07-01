-- ============================================================
-- Defer credit-memo applications to the payment that applies them.
--
-- A credit/debit memo is itself Posted, so a memo-sourced invoiceSettlement row
-- went live the instant it was written — even while the cash payment driving the
-- composer was still Draft. That made "apply credit" take effect immediately and
-- show in the invoice's applied card before posting, inconsistent with cash
-- applications (which stay Draft until the payment posts).
--
-- Fix: tie each credit application to the payment it was applied through
-- (`appliedViaPaymentId`) and only count it once THAT payment is Posted. Cash
-- applications are unchanged (source = paymentId, already gated on payment status).
-- ============================================================

-- Idempotent: the deploy runner does not wrap a migration in a transaction, so
-- every step must be safe to re-run after a partial commit.
ALTER TABLE "invoiceSettlement"
  ADD COLUMN IF NOT EXISTS "appliedViaPaymentId" TEXT;

-- Only memo-sourced settlements (credits) are "applied via" a payment; a cash
-- settlement's source IS the payment.
ALTER TABLE "invoiceSettlement"
  DROP CONSTRAINT IF EXISTS "invoiceSettlement_appliedViaPaymentId_check";
ALTER TABLE "invoiceSettlement"
  ADD CONSTRAINT "invoiceSettlement_appliedViaPaymentId_check"
  CHECK ("appliedViaPaymentId" IS NULL OR "memoId" IS NOT NULL);

-- Deleting the draft payment releases its staged credit applications.
ALTER TABLE "invoiceSettlement"
  DROP CONSTRAINT IF EXISTS "invoiceSettlement_appliedViaPaymentId_fkey";
ALTER TABLE "invoiceSettlement"
  ADD CONSTRAINT "invoiceSettlement_appliedViaPaymentId_fkey"
  FOREIGN KEY ("appliedViaPaymentId") REFERENCES "payment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "invoiceSettlement_appliedViaPaymentId_idx"
  ON "invoiceSettlement" ("appliedViaPaymentId")
  WHERE "appliedViaPaymentId" IS NOT NULL;

-- ============================================================
-- Redefine the invoice views: a memo-sourced settlement now counts only when its
-- memo is Posted AND (it isn't applied via a payment, or that payment is Posted).
-- Everything else matches 20260628151204 verbatim.
-- ============================================================

CREATE OR REPLACE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    -- Amount applied TO this invoice (as the settlement target): Posted cash
    -- payments, and Posted credit memos once the payment applying them is Posted.
    SELECT
      s."targetSalesInvoiceId" AS "salesInvoiceId",
      SUM(s."appliedAmount" + s."discountAmount" + s."writeOffAmount") AS amount,
      MAX(COALESCE(p."postingDate", vp."postingDate", m."postingDate")) AS "lastPaymentDate"
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
      WHEN COALESCE(s.amount, 0) >= (COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0))
        AND (COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) > 0 THEN 'Paid'
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
    -- A fully-settled invoice's "Paid" status is derived; the base datePaid
    -- column is never written, so derive it from the latest posted settlement
    -- date when fully settled, otherwise pass the base column through.
    CASE
      WHEN COALESCE(s.amount, 0) >= (COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0))
        AND (COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) > 0
        THEN COALESCE(si."datePaid", s."lastPaymentDate")
      ELSE si."datePaid"
    END AS "datePaid",
    si."locationId",
    si."currencyCode",
    COALESCE(sil."subtotal", 0) AS "subtotal",
    si."totalDiscount",
    COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0) AS "totalAmount",
    COALESCE(sil."totalTax", 0) AS "totalTax",
    ((COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) - COALESCE(s.amount, 0)) AS "balance",
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
  JOIN "salesInvoiceShipment" ss ON ss."id" = si."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = si."paymentTermId"
  LEFT JOIN settled s ON s."salesInvoiceId" = si."id";


CREATE OR REPLACE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT
      s."targetPurchaseInvoiceId" AS "purchaseInvoiceId",
      SUM(s."appliedAmount" + s."discountAmount" + s."writeOffAmount") AS amount,
      MAX(COALESCE(p."postingDate", vp."postingDate", m."postingDate")) AS "lastPaymentDate"
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
      WHEN COALESCE(s.amount, 0) >= (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END)
        AND (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) > 0
        THEN COALESCE(pi."datePaid", s."lastPaymentDate")
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
    ((COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) - COALESCE(s.amount, 0)) AS "balance",
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
      WHEN COALESCE(s.amount, 0) >= (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END)
        AND (COALESCE(pl."orderTotal", 0) + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END) > 0 THEN 'Paid'
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
  LEFT JOIN settled s ON s."purchaseInvoiceId" = pi."id";
