-- Existing bug fix
ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Supplier Quote';

-- Remove unused 'Ready for request' from purchasingRfqStatus by recreating the type
-- Drop dependent view
DROP VIEW IF EXISTS "purchasingRfqs";

ALTER TABLE "purchasingRfq" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "purchasingRfq" ALTER COLUMN "status" TYPE TEXT;
DROP TYPE "purchasingRfqStatus";
CREATE TYPE "purchasingRfqStatus" AS ENUM (
  'Draft',
  'Requested',
  'Closed'
);
ALTER TABLE "purchasingRfq" ALTER COLUMN "status" TYPE "purchasingRfqStatus" USING "status"::"purchasingRfqStatus";
ALTER TABLE "purchasingRfq" ALTER COLUMN "status" SET DEFAULT 'Draft';

CREATE OR REPLACE VIEW "purchasingRfqs" WITH(SECURITY_INVOKER=true) AS
  SELECT
    rfq.*,
    l."name" AS "locationName",
    (SELECT COUNT(*) FROM "purchasingRfqSupplier" rs WHERE rs."purchasingRfqId" = rfq.id) AS "supplierCount",
    (SELECT COALESCE(array_agg(s."id" ORDER BY s."id"), ARRAY[]::TEXT[]) FROM "purchasingRfqSupplier" rs JOIN "supplier" s ON s.id = rs."supplierId" WHERE rs."purchasingRfqId" = rfq.id) AS "supplierIds",
    EXISTS(SELECT 1 FROM "purchasingRfqFavorite" rf WHERE rf."rfqId" = rfq.id AND rf."userId" = auth.uid()::text) AS favorite
  FROM "purchasingRfq" rfq
  LEFT JOIN "location" l ON l.id = rfq."locationId";
