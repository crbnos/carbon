-- The Service module: permissions, the Warranty Expense account and default, the
-- service order sequence, and the customer asset backfill.
-- Spec: .ai/specs/2026-10-08-field-service.md (Data Model Changes: seeds and backfills; Q1)

-- 1) The modules view lists the new enum value.
DROP VIEW IF EXISTS "modules";
CREATE VIEW "modules" WITH (security_invoker = true) AS
  SELECT unnest(enum_range(NULL::module)) AS name;

-- 2) Permissions (Q1). The Admin employee type gets full Service rights; Management does not.
INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "create", "delete", "update", "view")
SELECT et.id, 'Service'::module, ARRAY[et."companyId"], ARRAY[et."companyId"], ARRAY[et."companyId"], ARRAY[et."companyId"]
FROM "employeeType" et
WHERE et.name = 'Admin'
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;

-- Customer service can look up warranty and order status: sales_view gives service_view.
-- No salesperson gets create, update or delete.
UPDATE "userPermission"
SET "permissions" = "permissions" || jsonb_build_object(
  'service_view', COALESCE("permissions"->'sales_view', '[]'::jsonb)
)
WHERE NOT ("permissions" ? 'service_view');

-- Existing Admin employees get the Admin type's rights now, in each company they belong to.
WITH admin AS (
  SELECT e."id" AS "userId", jsonb_agg(DISTINCT e."companyId") AS "companies"
  FROM "employee" e
  JOIN "employeeType" et ON et."id" = e."employeeTypeId" AND et."name" = 'Admin'
  JOIN "userToCompany" uc ON uc."userId" = e."id" AND uc."companyId" = e."companyId"
  GROUP BY e."id"
)
UPDATE "userPermission" up
SET "permissions" = up."permissions" || (
  SELECT jsonb_object_agg(
    k,
    (SELECT jsonb_agg(DISTINCT v)
     FROM jsonb_array_elements_text(COALESCE(up."permissions"->k, '[]'::jsonb) || a."companies") AS v)
  )
  FROM unnest(ARRAY['service_view', 'service_create', 'service_update', 'service_delete']) AS k
)
FROM admin a
WHERE a."userId" = up."id";

-- 3) Account default: Warranty Expense.
ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "warrantyExpenseAccount" TEXT;
DO $fsfk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"accountDefault"'::regclass AND conname = 'accountDefault_warrantyExpenseAccount_fkey'
  ) THEN
    ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_warrantyExpenseAccount_fkey"
      FOREIGN KEY ("warrantyExpenseAccount") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $fsfk$;
CREATE INDEX IF NOT EXISTS "accountDefault_warrantyExpenseAccount_idx" ON "accountDefault" ("warrantyExpenseAccount");

-- 4) Account 6120 Warranty Expense, one per company group that has a chart.
-- Re-runnable: a group that already holds the number OR the name keeps its account (the
-- name is unique per group). The parent is the "Operating Expenses" group by name, else
-- the group holding the sibling 6010, else the chart root with a NOTICE.
DO $fsaccount$
DECLARE
  grp TEXT;
  parent_id TEXT;
BEGIN
  FOR grp IN SELECT DISTINCT a."companyGroupId" FROM "account" a LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM "account" a
      WHERE a."companyGroupId" = grp AND (a.number = '6120' OR a.name = 'Warranty Expense')
    );

    SELECT g.id INTO parent_id
    FROM "account" g
    WHERE g."companyGroupId" = grp AND g."isGroup" = TRUE AND g.name = 'Operating Expenses'
    LIMIT 1;

    IF parent_id IS NULL THEN
      SELECT p.id INTO parent_id
      FROM "account" a
      JOIN "account" p ON p.id = a."parentId" AND p."isGroup" = TRUE
      WHERE a."companyGroupId" = grp AND a.number = '6010'
      LIMIT 1;
    END IF;

    IF parent_id IS NULL THEN
      RAISE NOTICE 'field-service-module: company group % has no "Operating Expenses" group; account 6120 Warranty Expense is at the chart root', grp;
    END IF;

    INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
    VALUES (
      id('acct'), '6120', 'Warranty Expense', 'Expense'::"glAccountClass", 'Expense'::"accountType",
      'Income Statement'::"glIncomeBalance", 'Average'::"glConsolidatedRate",
      parent_id, false, true, false, grp, 'system'
    );
  END LOOP;
END $fsaccount$;

-- 5) Backfill the default by number, then by leaf name for a group that renumbered it.
UPDATE "accountDefault" ad
SET "warrantyExpenseAccount" = a."id", "updatedBy" = 'system'
FROM "company" c
JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a."number" = '6120' AND a."isGroup" = FALSE
WHERE ad."companyId" = c."id" AND ad."warrantyExpenseAccount" IS NULL;

UPDATE "accountDefault" ad
SET "warrantyExpenseAccount" = a."id", "updatedBy" = 'system'
FROM "company" c
JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a."name" = 'Warranty Expense' AND a."isGroup" = FALSE
WHERE ad."companyId" = c."id" AND ad."warrantyExpenseAccount" IS NULL;

-- A Warranty charge on a service order posts to this account, so every company must leave
-- with an Expense leaf account as its Warranty Expense default.
DO $fsdefault$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "accountDefault" ad
    LEFT JOIN "account" a ON a.id = ad."warrantyExpenseAccount"
    WHERE a.id IS NULL OR a.class <> 'Expense' OR a."isGroup"
  ) THEN
    RAISE EXCEPTION 'field-service-module: a company has no Warranty Expense default, or it is not an Expense leaf account';
  END IF;
END $fsdefault$;

-- 6) Readable-id sequence for existing companies (new companies: seed-data.ts).
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'serviceOrder', 'Service Order', 'SVC', NULL, 0, 6, 1, c."id"
FROM "company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "sequence" s WHERE s."companyId" = c."id" AND s."table" = 'serviceOrder'
);

-- 7) Customer assets for every serial already shipped on a posted sales shipment.
-- The site is the sales order's, or the drop shipment's ship-to. Warranty dates stay null.
INSERT INTO "customerAsset" ("trackedEntityId", "itemId", "customerId", "customerLocationId", "shippedDate", "shipmentId", "source", "companyId", "createdBy")
SELECT te."id", te."itemId", COALESCE(s."customerId", so."customerId"),
       CASE WHEN sos."dropShipment" THEN sos."customerLocationId" ELSE so."customerLocationId" END,
       s."postingDate", s."id", 'Shipment', te."companyId", 'system'
FROM "trackedEntity" te
JOIN "item" i ON i."id" = te."itemId" AND i."itemTrackingType" = 'Serial'
JOIN "shipment" s ON s."id" = te."attributes"->>'Shipment' AND s."companyId" = te."companyId"
  AND s."status" = 'Posted' AND s."sourceDocument" = 'Sales Order'
JOIN "salesOrder" so ON so."id" = s."sourceDocumentId" AND so."companyId" = s."companyId"
LEFT JOIN "salesOrderShipment" sos ON sos."id" = so."id"
WHERE te."status" = 'Consumed'
  AND COALESCE(s."customerId", so."customerId") IS NOT NULL
ON CONFLICT ("trackedEntityId", "companyId") DO NOTHING;
