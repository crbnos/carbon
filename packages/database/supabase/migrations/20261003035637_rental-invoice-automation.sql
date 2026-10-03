-- Rental invoice automation (spec .ai/specs/2026-10-02-rental-invoice-automation.md).
-- The mode is shared by every recurring-invoice source: the company default plus a
-- nullable per-document override (NULL = the company default).

DO $$ BEGIN
  CREATE TYPE "invoiceAutomation" AS ENUM ('Draft Only', 'Post', 'Post and Email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "invoiceAutomation" "invoiceAutomation" NOT NULL DEFAULT 'Post and Email',
  ADD COLUMN IF NOT EXISTS "invoiceNotificationGroup" TEXT[] NOT NULL DEFAULT '{}';

-- NULL = the company default
ALTER TABLE "rentalAgreement"
  ADD COLUMN IF NOT EXISTS "invoiceAutomation" "invoiceAutomation";

-- The last invoice this row was billed on that was VOIDED. Set by post-sales-invoice's
-- void step; the rental invoice planner holds a re-bill. No FK, like salesInvoiceLineId.
ALTER TABLE "rentalBillingPeriod"
  ADD COLUMN IF NOT EXISTS "voidedSalesInvoiceId" TEXT;
ALTER TABLE "rentalAgreementCharge"
  ADD COLUMN IF NOT EXISTS "voidedSalesInvoiceId" TEXT;

ALTER TABLE "salesInvoice"
  ADD COLUMN IF NOT EXISTS "automationHoldReason" TEXT,
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "sentTo" TEXT,
  ADD COLUMN IF NOT EXISTS "sendError" TEXT;

-- rentalAgreements: header with the customer name and line / period rollups,
-- plus the invoice automation mode in force.
DROP VIEW IF EXISTS "rentalAgreements";
CREATE VIEW "rentalAgreements" WITH(SECURITY_INVOKER=true) AS
SELECT
  ra.*,
  c.name AS "customerName",
  COALESCE(l."lineCount", 0) AS "lineCount",
  COALESCE(l."onRentCount", 0) AS "onRentCount",
  p."nextDueOn",
  COALESCE(p."unbilledAmount", 0) AS "unbilledAmount",
  COALESCE(ra."invoiceAutomation", cs."invoiceAutomation") AS "effectiveInvoiceAutomation"
FROM "rentalAgreement" ra
INNER JOIN "customer" c ON c.id = ra."customerId"
LEFT JOIN "companySettings" cs ON cs."id" = ra."companyId"
LEFT JOIN LATERAL (
  SELECT
    count(*)::INTEGER AS "lineCount",
    count(*) FILTER (WHERE ral.status = 'On Rent')::INTEGER AS "onRentCount"
  FROM "rentalAgreementLine" ral
  WHERE ral."rentalAgreementId" = ra.id AND ral."companyId" = ra."companyId"
) l ON TRUE
LEFT JOIN LATERAL (
  SELECT
    min(rbp."dueOn") AS "nextDueOn",
    sum(rbp.amount) AS "unbilledAmount"
  FROM "rentalBillingPeriod" rbp
  JOIN "rentalAgreementLine" ral ON ral.id = rbp."rentalAgreementLineId" AND ral."companyId" = rbp."companyId"
  WHERE ral."rentalAgreementId" = ra.id
    AND ral."companyId" = ra."companyId"
    AND rbp.status = 'Pending'
) p ON TRUE;

-- salesInvoices: unchanged from 20260916143022, plus the automation columns and
-- needsReview (a held draft, or a posted invoice whose email failed).
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
      OR (si."status" <> 'Draft' AND si."sendError" IS NOT NULL AND si."sentAt" IS NULL)
    ) AS "needsReview"
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
