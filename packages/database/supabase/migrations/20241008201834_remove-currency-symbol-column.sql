DROP VIEW IF EXISTS "currencies";

ALTER TABLE "currencyCode" DROP COLUMN "symbol";

-- Create a currencies view with all of the columns from the currency table, joined with the currencyCode table
CREATE OR REPLACE VIEW "currencies" WITH(SECURITY_INVOKER=true) AS
  SELECT c.*, cc."name"
  FROM "currency" c
  INNER JOIN "currencyCode" cc
    ON cc."code" = c."code";