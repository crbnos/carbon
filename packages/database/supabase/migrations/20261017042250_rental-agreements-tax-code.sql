-- Expose rentalAgreement.taxCodeId (added by 20261017032853_multi-jurisdiction-tax):
-- the view selects ra.*, which Postgres froze when the view was created.

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
