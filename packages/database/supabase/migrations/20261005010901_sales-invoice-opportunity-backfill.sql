-- Every sales invoice needs an opportunity: its documents, including the PDF
-- written when it is posted, live under `{companyId}/opportunity/{opportunityId}/`.
-- Rental billing drafted invoices with none, so the documents card crashed and
-- posting wrote the PDF to a literal `opportunity/null/` folder. Give each such
-- invoice its own opportunity, as insertSalesInvoice does.
--
-- Linking an opportunity changes nothing an accounting provider, webhook or
-- workflow cares about, so those events are suppressed.

-- (A DO block, so the transaction-local setting and the update always share
-- one transaction whatever the migration runner does.)

DO $$
BEGIN
  PERFORM set_config('app.sync_in_progress', 'true', true);

  WITH "missing" AS MATERIALIZED (
    SELECT
      "id",
      "companyId",
      "customerId",
      id('opp') AS "opportunityId"
    FROM "salesInvoice"
    WHERE "opportunityId" IS NULL
  ),
  "inserted" AS (
    INSERT INTO "opportunity" ("id", "companyId", "customerId")
    SELECT "opportunityId", "companyId", "customerId" FROM "missing"
    RETURNING "id"
  )
  UPDATE "salesInvoice" si
  SET "opportunityId" = m."opportunityId"
  FROM "missing" m
  WHERE si."id" = m."id";

  PERFORM set_config('app.sync_in_progress', 'false', true);
END $$;
