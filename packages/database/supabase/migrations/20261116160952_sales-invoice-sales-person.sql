-- The sales rep on a sales invoice, copied from the sales order, rental agreement or
-- contract the invoice is made from. Accounting sync sends it to the provider (Rillet:
-- a "Sales Rep" field on each invoice item).
ALTER TABLE "salesInvoice" ADD COLUMN IF NOT EXISTS "salesPersonId" TEXT;

ALTER TABLE "salesInvoice"
  ADD CONSTRAINT "salesInvoice_salesPersonId_fkey" FOREIGN KEY ("salesPersonId")
  REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "salesInvoice_salesPersonId_idx" ON "salesInvoice" ("salesPersonId");

-- Backfill: an invoice whose lines all come from one sales order takes that order's rep.
UPDATE "salesInvoice" si
SET "salesPersonId" = src."salesPersonId"
FROM (
  SELECT sil."invoiceId", sil."companyId", MIN(so."salesPersonId") AS "salesPersonId"
  FROM "salesInvoiceLine" sil
  JOIN "salesOrder" so ON so."id" = sil."salesOrderId" AND so."companyId" = sil."companyId"
  WHERE sil."salesOrderId" IS NOT NULL
  GROUP BY sil."invoiceId", sil."companyId"
  HAVING COUNT(DISTINCT sil."salesOrderId") = 1
) src
WHERE si."id" = src."invoiceId"
  AND si."companyId" = src."companyId"
  AND si."salesPersonId" IS NULL
  AND src."salesPersonId" IS NOT NULL;

-- Backfill: a contract invoice takes the contract's rep.
UPDATE "salesInvoice" si
SET "salesPersonId" = cc."salesPersonId"
FROM "customerContract" cc
WHERE cc."id" = si."customerContractId"
  AND cc."companyId" = si."companyId"
  AND si."salesPersonId" IS NULL
  AND cc."salesPersonId" IS NOT NULL;

-- salesInvoices: unchanged from 20261006221401_sales-invoice-discount-and-ship-to.sql,
-- plus salesPersonId appended at the end of the select list.
CREATE OR REPLACE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  WITH settled AS (
    SELECT s."targetSalesInvoiceId", s."companyId",
      SUM(COALESCE(s."sourceAmount", s."appliedAmount", 0) + round(
        (COALESCE(s."discountAmount", 0) + COALESCE(s."writeOffAmount", 0)) * target."exchangeRate",
        COALESCE(target_currency."decimalPlaces", 2))) AS amount_document,
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
  , si."automationHoldReason"
  , si."sentAt"
  , si."sentTo"
  , si."sendError"
  , (
      (si."status" = 'Draft' AND si."automationHoldReason" IS NOT NULL)
      OR (si."status" NOT IN ('Draft', 'Pending', 'Voided') AND si."sendError" IS NOT NULL AND si."sentAt" IS NULL)
    ) AS "needsReview"
  , si."salesPersonId"
  FROM "salesInvoice" si
  LEFT JOIN (
    SELECT
      sil."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        COALESCE(sil."quantity", 0)*COALESCE(sil."unitPrice", 0)*(1 - COALESCE(sil."discountPercent", 0))
        + COALESCE(sil."addOnCost", 0)
        + COALESCE(sil."nonTaxableAddOnCost", 0)
        + COALESCE(sil."shippingCost", 0)
      ) AS "subtotal",
      SUM(
        COALESCE(sil."taxPercent", 0) * (
          COALESCE(sil."quantity", 0)*COALESCE(sil."unitPrice", 0)*(1 - COALESCE(sil."discountPercent", 0))
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
          'discountPercent', sil."discountPercent",
          'itemId', sil."itemId"
        )
      ) AS "lines"
    FROM "salesInvoiceLine" sil
    LEFT JOIN "item" i
      ON i."id" = sil."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY sil."invoiceId"
  ) sil ON sil."invoiceId" = si."id"
  LEFT JOIN "salesInvoiceShipment" ss ON ss."id" = si."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = si."paymentTermId"
  LEFT JOIN settled s ON s."targetSalesInvoiceId" = si."id" AND s."companyId" = si."companyId"
  LEFT JOIN "company" invoice_company ON invoice_company."id" = si."companyId"
  LEFT JOIN "currency" invoice_currency ON invoice_currency."code" = si."currencyCode"
    AND invoice_currency."companyGroupId" = invoice_company."companyGroupId"
  CROSS JOIN LATERAL (
    SELECT round((COALESCE(sil."subtotal", 0) + COALESCE(sil."totalTax", 0) + COALESCE(ss."shippingCost", 0)) * si."exchangeRate", COALESCE(invoice_currency."decimalPlaces", 2)) AS total_document
  ) amounts
  CROSS JOIN LATERAL (
    SELECT amounts.total_document - COALESCE(s.amount_document, 0) AS amount_document
  ) remaining;

NOTIFY pgrst, 'reload schema';
