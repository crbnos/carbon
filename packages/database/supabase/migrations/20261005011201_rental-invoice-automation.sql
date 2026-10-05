-- Rental invoice automation (spec .ai/specs/2026-10-02-rental-invoice-automation.md).
-- The mode is shared by every recurring-invoice source: the company default plus a
-- nullable per-document override (NULL = the company default).

DO $$ BEGIN
  CREATE TYPE "invoiceAutomation" AS ENUM ('Draft Only', 'Post', 'Post and Email', 'Post and Send via Stripe');
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

-- The salesInvoices view gains these columns (and needsReview) in
-- 20261005011501_sales-invoice-discount-and-ship-to.sql.
