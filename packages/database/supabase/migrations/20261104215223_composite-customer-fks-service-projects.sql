-- A customer reference stays in its row's company. These three foreign keys
-- arrived after 20260703143904_composite-tenant-fks.sql converted the others, so
-- the database would accept another company's customer here, and the company
-- export then refuses the row. Each keeps its name, because PostgREST embeds
-- name them. None of these columns holds data from before this release.

ALTER TABLE "customerAsset"
  DROP CONSTRAINT "customerAsset_customerId_fkey",
  ADD CONSTRAINT "customerAsset_customerId_fkey"
    FOREIGN KEY ("customerId", "companyId") REFERENCES "customer"("id", "companyId");

ALTER TABLE "serviceJob"
  DROP CONSTRAINT "serviceJob_customerId_fkey",
  ADD CONSTRAINT "serviceJob_customerId_fkey"
    FOREIGN KEY ("customerId", "companyId") REFERENCES "customer"("id", "companyId")
    ON DELETE RESTRICT;

-- SET NULL clears the customer only, never "companyId".
ALTER TABLE "project"
  DROP CONSTRAINT "project_customer_fkey",
  ADD CONSTRAINT "project_customer_fkey"
    FOREIGN KEY ("customerId", "companyId") REFERENCES "customer"("id", "companyId")
    ON DELETE SET NULL ("customerId");
