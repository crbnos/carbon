-- A customer contract bills on its invoice schedule (a service contract) or from
-- project cost and billing events (a project contract). The two share the
-- contract tables and engines; the basis decides which screens and which lines.

DO $$ BEGIN
  CREATE TYPE "contractBillingBasis" AS ENUM ('Schedule', 'Project');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "customerContract"
  ADD COLUMN IF NOT EXISTS "billingBasis" "contractBillingBasis" NOT NULL DEFAULT 'Schedule';

COMMENT ON COLUMN "customerContract"."billingBasis" IS
  'Schedule: a service contract billed on its invoice schedule. Project: a project contract billed from project cost (Time & Materials, Cost Plus) and billing events (Fixed Price).';

-- A contract with a Time & Materials or Cost Plus line is a project contract.
UPDATE "customerContract" c SET "billingBasis" = 'Project'
WHERE c."billingBasis" = 'Schedule'
  AND EXISTS (
    SELECT 1 FROM "customerContractLine" l
    WHERE l."customerContractId" = c."id"
      AND l."companyId" = c."companyId"
      AND l."billingMethod" <> 'Fixed'
  );

-- The view expands c.* when it is created, so it is recreated to carry the column.
DROP VIEW IF EXISTS "customerContracts";
CREATE VIEW "customerContracts" WITH(SECURITY_INVOKER=true) AS
SELECT
  c.*,
  cu."name" AS "customerName",
  COALESCE(c."invoiceAutomation", cs."invoiceAutomation") AS "effectiveInvoiceAutomation",
  (SELECT COUNT(*) FROM "customerContractLine" l
     WHERE l."customerContractId" = c."id" AND l."companyId" = c."companyId") AS "lineCount",
  (SELECT COALESCE(SUM(il."amount"), 0) FROM "customerContractInvoiceLine" il
     WHERE il."customerContractId" = c."id" AND il."companyId" = c."companyId") AS "contractValue",
  (SELECT COALESCE(SUM(il."amount"), 0) FROM "customerContractInvoiceLine" il
     JOIN "customerContractInvoice" ci ON ci."id" = il."customerContractInvoiceId" AND ci."companyId" = il."companyId"
     WHERE il."customerContractId" = c."id" AND il."companyId" = c."companyId" AND ci."status" = 'Invoiced') AS "invoicedToDate",
  (SELECT COALESCE(SUM(r."amount"), 0) FROM "customerContractRevenue" r
     WHERE r."customerContractId" = c."id" AND r."companyId" = c."companyId" AND r."status" = 'Recognized') AS "recognizedToDate",
  (SELECT MIN(ci."invoiceDate") FROM "customerContractInvoice" ci
     WHERE ci."customerContractId" = c."id" AND ci."companyId" = c."companyId" AND ci."status" = 'Planned') AS "nextInvoiceDate"
FROM "customerContract" c
JOIN "customer" cu ON cu."id" = c."customerId"
LEFT JOIN "companySettings" cs ON cs."id" = c."companyId";
