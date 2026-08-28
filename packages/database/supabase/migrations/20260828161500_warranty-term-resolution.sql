-- Decouple the warranty term from the part.
--
-- A term on the item is a DEFAULT, not a rule: the same battery can carry two
-- years for one customer and one for another, and whoever ships it must be able
-- to say so on the day. This adds the two layers that make that possible, and
-- leaves item."warrantyTermId" as the fallback.
--
-- Resolution at stamping time, most specific first:
--   1. shipmentLine."warrantyTermId"      — what the shipper chose, on the day
--   2. customerWarrantyTerm (customer + item)
--   3. customerWarrantyTerm (customer, itemId IS NULL — all their items)
--   4. item."warrantyTermId"              — the product's default
--   5. none                               — no registration is stamped
--
-- Note this is per-ENTITY assignment (a named customer, optionally a named
-- item), not a group×group posting matrix — the pattern `.ai/lessons.md`
-- rejects. There are no customer groups or item groups involved.

CREATE TABLE IF NOT EXISTS "customerWarrantyTerm" (
    "id" TEXT NOT NULL DEFAULT id('cwt'),
    "customerId" TEXT NOT NULL REFERENCES "customer"("id") ON DELETE CASCADE,
    -- NULL means "every item this customer buys"; a value narrows it to one.
    "itemId" TEXT REFERENCES "item"("id") ON DELETE CASCADE,
    "warrantyTermId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "customerWarrantyTerm_warrantyTermId_fkey"
      FOREIGN KEY ("warrantyTermId", "companyId")
      REFERENCES "warrantyTerm"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "customerWarrantyTerm_companyId_idx" ON "customerWarrantyTerm" ("companyId");
CREATE INDEX IF NOT EXISTS "customerWarrantyTerm_customerId_idx" ON "customerWarrantyTerm" ("customerId");
CREATE INDEX IF NOT EXISTS "customerWarrantyTerm_itemId_idx" ON "customerWarrantyTerm" ("itemId");
CREATE INDEX IF NOT EXISTS "customerWarrantyTerm_warrantyTermId_idx" ON "customerWarrantyTerm" ("warrantyTermId");
CREATE INDEX IF NOT EXISTS "customerWarrantyTerm_createdBy_idx" ON "customerWarrantyTerm" ("createdBy");

-- One rule per customer+item, and one catch-all per customer. Postgres treats
-- NULLs as distinct, so the catch-all needs its own partial index.
CREATE UNIQUE INDEX IF NOT EXISTS "customerWarrantyTerm_customer_item_idx"
  ON "customerWarrantyTerm" ("companyId", "customerId", "itemId")
  WHERE "itemId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "customerWarrantyTerm_customer_all_idx"
  ON "customerWarrantyTerm" ("companyId", "customerId")
  WHERE "itemId" IS NULL;

-- The per-shipment override. Nullable: unset means "fall through to the rules".
ALTER TABLE "shipmentLine" ADD COLUMN IF NOT EXISTS "warrantyTermId" TEXT;

DO $$ BEGIN
ALTER TABLE "shipmentLine" ADD CONSTRAINT "shipmentLine_warrantyTermId_fkey"
  FOREIGN KEY ("warrantyTermId", "companyId")
  REFERENCES "warrantyTerm"("id", "companyId")
  ON DELETE SET NULL ("warrantyTermId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "shipmentLine_warrantyTermId_idx" ON "shipmentLine" ("warrantyTermId");

-- RLS
ALTER TABLE "public"."customerWarrantyTerm" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."customerWarrantyTerm"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."customerWarrantyTerm"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."customerWarrantyTerm"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."customerWarrantyTerm"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

-- Readable list for the customer's Warranties panel.
DROP VIEW IF EXISTS "customerWarrantyTerms";
CREATE VIEW "customerWarrantyTerms" WITH (security_invoker = true) AS
SELECT
  cwt.*,
  wt."name" AS "warrantyTermName",
  wt."coversParts",
  wt."partsDurationMonths",
  wt."coversLabor",
  wt."laborDurationMonths",
  wt."startBasis",
  i."readableIdWithRevision" AS "itemReadableId",
  i."name" AS "itemName",
  c."name" AS "customerName"
FROM "customerWarrantyTerm" cwt
INNER JOIN "warrantyTerm" wt
  ON wt."id" = cwt."warrantyTermId" AND wt."companyId" = cwt."companyId"
INNER JOIN "customer" c ON c."id" = cwt."customerId"
LEFT JOIN "item" i ON i."id" = cwt."itemId";

-- The shipmentLines view selects sl.*, which Postgres expanded to a fixed
-- column list when the view was created — it does NOT pick up the new
-- warrantyTermId. CREATE OR REPLACE cannot reorder columns, so drop and
-- recreate. Forked from the newest definition
-- (20260417000300_storage-unit-recreate-dependents.sql); nothing depends on
-- this view, checked via pg_depend.
DROP VIEW IF EXISTS "shipmentLines";
CREATE VIEW "shipmentLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."name" as "description"
  FROM "shipmentLine" sl
  INNER JOIN "item" i ON i."id" = sl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId";
