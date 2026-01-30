-- Make externalId nullable in externalIntegrationMapping table
ALTER TABLE "externalIntegrationMapping" ALTER COLUMN "externalId" DROP NOT NULL;

DROP VIEW IF EXISTS "suppliers";
DROP VIEW IF EXISTS "customers";
DROP VIEW IF EXISTS "parts";
DROP VIEW IF EXISTS "materials";
DROP VIEW IF EXISTS "tools";
DROP VIEW IF EXISTS "consumables";
DROP VIEW IF EXISTS "services";
DROP VIEW IF EXISTS "salesOrders";

-- Migration: Convert all externalId JSONB columns to the externalIntegrationMapping table
-- Then drop the old columns and indexes.
--
-- Three data patterns exist:
--   1. Object with "id" field (Xero, Linear):  { "xero": { "id": "...", "provider": "xero", ... } }
--   2. Object with "Part number" field (OnShape): { "onshapeData": { "Part number": "PRT-000587", ... } }
--   3. Plain string value (Paperless Parts):    { "paperlessPartsId": "123" }
--
-- externalId extraction:
--   - string value  → use the string itself
--   - onshapeData   → use "Part number" field (only for items, parts, materials, tools, consumables, services)
--   - other objects  → use "id" field
--
-- metadata: store full object for objects, NULL for strings

-- ============================================================================
-- STEP 1: Migrate tables with direct companyId
-- ============================================================================

-- customer
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'customer',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "customer" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- supplier
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'supplier',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "supplier" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- contact
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'contact',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "contact" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- item
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'item',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "item" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- part
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'part',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "part" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- material
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'material',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "material" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- tool
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'tool',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "tool" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- fixture
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'fixture',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "fixture" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- consumable
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'consumable',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "consumable" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- address
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'address',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "address" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- salesOrder
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'salesOrder',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "salesOrder" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- purchaseOrder
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'purchaseOrder',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "purchaseOrder" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- quote
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'quote',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "quote" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- salesInvoice
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'salesInvoice',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "salesInvoice" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- nonConformanceActionTask (JSON type, cast to JSONB)
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'nonConformanceActionTask',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."companyId"
FROM "nonConformanceActionTask" t,
LATERAL jsonb_each(t."externalId"::jsonb) AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId"::jsonb != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- ============================================================================
-- STEP 2: Migrate tables requiring JOINs for companyId
-- ============================================================================

-- customerLocation (join customer for companyId)
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'customerLocation',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  c."companyId"
FROM "customerLocation" t
JOIN "customer" c ON t."customerId" = c."id",
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- supplierLocation (join supplier for companyId)
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'supplierLocation',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  s."companyId"
FROM "supplierLocation" t
JOIN "supplier" s ON t."supplierId" = s."id",
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- ============================================================================
-- STEP 3: Migrate special tables
-- ============================================================================

-- company (id IS the companyId)
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'company',
  t."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  t."id"
FROM "company" t,
LATERAL jsonb_each(t."externalId") AS kv(key, value)
WHERE t."externalId" IS NOT NULL
  AND t."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- user (many-to-many via userToCompany, one mapping per company membership)
INSERT INTO "externalIntegrationMapping" (
  "entityType", "entityId", "integration", "externalId",
  "metadata", "lastSyncedAt", "companyId"
)
SELECT
  'user',
  u."id",
  kv.key,
  CASE
    WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
    ELSE kv.value->>'id'
  END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN kv.value ELSE NULL END,
  CASE WHEN jsonb_typeof(kv.value) = 'object' THEN (kv.value->>'lastSyncedAt')::timestamptz ELSE NULL END,
  uc."companyId"
FROM "user" u
JOIN "userToCompany" uc ON u."id" = uc."userId",
LATERAL jsonb_each(u."externalId") AS kv(key, value)
WHERE u."externalId" IS NOT NULL
  AND u."externalId" != '{}'::jsonb
  AND (
    CASE
      WHEN jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
      ELSE kv.value->>'id'
    END
  ) IS NOT NULL;

-- ============================================================================
-- STEP 4: Drop old indexes and columns
-- ============================================================================

-- Drop GIN indexes
DROP INDEX IF EXISTS "idx_customer_external_id";
DROP INDEX IF EXISTS "idx_supplier_external_id";
DROP INDEX IF EXISTS "idx_contact_external_id";
DROP INDEX IF EXISTS "idx_item_external_id";
DROP INDEX IF EXISTS "idx_part_external_id";
DROP INDEX IF EXISTS "idx_material_external_id";
DROP INDEX IF EXISTS "idx_tool_external_id";
DROP INDEX IF EXISTS "idx_fixture_external_id";
DROP INDEX IF EXISTS "idx_consumable_external_id";
DROP INDEX IF EXISTS "idx_address_external_id";
DROP INDEX IF EXISTS "idx_customerLocation_external_id";
DROP INDEX IF EXISTS "idx_supplierLocation_external_id";
DROP INDEX IF EXISTS "idx_salesOrder_external_id";
DROP INDEX IF EXISTS "idx_purchaseOrder_external_id";
DROP INDEX IF EXISTS "idx_quote_external_id";
DROP INDEX IF EXISTS "salesInvoice_externalId_idx";
DROP INDEX IF EXISTS "idx_user_external_id";
DROP INDEX IF EXISTS "idx_company_external_id";

-- Drop externalId columns
ALTER TABLE "customer" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "supplier" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "contact" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "item" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "part" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "material" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "tool" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "fixture" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "consumable" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "address" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "customerLocation" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "supplierLocation" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "salesOrder" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "purchaseOrder" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "quote" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "salesInvoice" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "user" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "company" DROP COLUMN IF EXISTS "externalId";
ALTER TABLE "nonConformanceActionTask" DROP COLUMN IF EXISTS "externalId";

-- ============================================================================
-- STEP 4: Recreate RPC functions that referenced item.externalId
-- ============================================================================
DROP FUNCTION get_method_tree;
CREATE OR REPLACE FUNCTION get_method_tree(uid TEXT)
RETURNS TABLE (
    "methodMaterialId" TEXT,
    "makeMethodId" TEXT,
    "materialMakeMethodId" TEXT,  
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "itemType" TEXT,
    "description" TEXT,
    "unitOfMeasureCode" TEXT,
    "unitCost" NUMERIC,
    "quantity" NUMERIC,
    "methodType" "methodType",
    "itemTrackingType" TEXT,
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "operationId" TEXT,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "shelfIds" JSONB
) AS $$
WITH RECURSIVE material AS (
    SELECT 
        "id", 
        "makeMethodId",
        "methodType",
        "materialMakeMethodId",
        "itemId", 
        "itemType",
        "quantity",
        "makeMethodId" AS "parentMaterialId",
        NULL AS "operationId",
        COALESCE("order", 1) AS "order",
        "kit",
        "shelfIds"
    FROM 
        "methodMaterial" 
    WHERE 
        "makeMethodId" = uid
    UNION 
    SELECT 
        child."id", 
        child."makeMethodId",
        child."methodType",
        child."materialMakeMethodId",
        child."itemId", 
        child."itemType",
        child."quantity",
        parent."id" AS "parentMaterialId",
        child."methodOperationId" AS "operationId",
        child."order",
        child."kit",
        child."shelfIds"
    FROM 
        "methodMaterial" child 
        INNER JOIN material parent ON parent."materialMakeMethodId" = child."makeMethodId"
) 
SELECT 
  material.id as "methodMaterialId", 
  material."makeMethodId",
  material."materialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  material."itemType",
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  material."quantity",
  material."methodType",
  item."itemTrackingType",
  material."parentMaterialId",
  material."order",
  material."operationId",
  false AS "isRoot",
  material."kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration", 
        CASE 
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm2."version",
  material."shelfIds"
FROM material 
INNER JOIN item 
  ON material."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
INNER JOIN "makeMethod" mm 
  ON material."makeMethodId" = mm.id
LEFT JOIN "makeMethod" mm2 
  ON material."materialMakeMethodId" = mm2.id
UNION
SELECT
  mm."id" AS "methodMaterialId",
  NULL AS "makeMethodId",
  mm.id AS "materialMakeMethodId",
  mm."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."type"::text,
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  1 AS "quantity",
  'Make' AS "methodType",
  item."itemTrackingType",
  NULL AS "parentMaterialId",
  CAST(1 AS DOUBLE PRECISION) AS "order",
  NULL AS "operationId",
  true AS "isRoot",
  false AS "kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration", 
        CASE 
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm."version",
  '{}'::JSONB AS "shelfIds"
FROM "makeMethod" mm 
INNER JOIN item 
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm.id = uid
ORDER BY "order"
$$ LANGUAGE sql STABLE;





DROP FUNCTION IF EXISTS get_quote_methods_by_method_id;
CREATE OR REPLACE FUNCTION get_quote_methods_by_method_id(mid TEXT)
RETURNS TABLE (
    "quoteId" TEXT,
    "quoteLineId" TEXT,
    "methodMaterialId" TEXT,
    "quoteMakeMethodId" TEXT,
    "quoteMaterialMakeMethodId" TEXT,  
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "description" TEXT,
    "unitOfMeasureCode" TEXT,
    "itemType" TEXT,
    "itemTrackingType" TEXT,
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "shelfId" TEXT
) AS $$
WITH RECURSIVE material AS (
    SELECT 
        "quoteId",
        "quoteLineId",
        "id", 
        "id" AS "quoteMakeMethodId",
        'Make'::"methodType" AS "methodType",
        "id" AS "quoteMaterialMakeMethodId",
        "version",
        "itemId", 
        'Part' AS "itemType",
        1::NUMERIC AS "quantity",
        0::NUMERIC AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot",
        FALSE AS "kit",
        NULL::TEXT AS "shelfId"
    FROM 
        "quoteMakeMethod" 
    WHERE 
        "id" = mid
    UNION 
    SELECT 
        child."quoteId",
        child."quoteLineId",
        child."id", 
        child."quoteMakeMethodId",
        child."methodType",
        child."quoteMaterialMakeMethodId",
        child."version",
        child."itemId", 
        child."itemType",
        child."quantity",
        child."unitCost",
        parent."id" AS "parentMaterialId",
        child."order",
        FALSE AS "isRoot",
        child."kit",
        child."shelfId"
    FROM 
        "quoteMaterialWithMakeMethodId" child 
        INNER JOIN material parent ON parent."quoteMaterialMakeMethodId" = child."quoteMakeMethodId"
    WHERE parent."methodType" = 'Make'
) 
SELECT 
  material."quoteId",
  material."quoteLineId",
  material.id as "methodMaterialId", 
  material."quoteMakeMethodId",
  material."quoteMaterialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."name" AS "description",
  item."unitOfMeasureCode",
  material."itemType",
  item."itemTrackingType",
  material."quantity",
  material."unitCost",
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot",
  material."kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration", 
        CASE 
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  material."version",
  material."shelfId"
FROM material 
INNER JOIN item ON material."itemId" = item.id
ORDER BY "order"
$$ LANGUAGE sql STABLE;


DROP FUNCTION IF EXISTS get_quote_methods;
CREATE OR REPLACE FUNCTION get_quote_methods(qid TEXT)
RETURNS TABLE (
    "quoteId" TEXT,
    "quoteLineId" TEXT,
    "methodMaterialId" TEXT,
    "quoteMakeMethodId" TEXT,
    "quoteMaterialMakeMethodId" TEXT,  
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "description" TEXT,
    "itemType" TEXT,
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "shelfId" TEXT
) AS $$
WITH RECURSIVE material AS (
    SELECT 
        "quoteId",
        "quoteLineId",
        "id", 
        "id" AS "quoteMakeMethodId",
        'Make'::"methodType" AS "methodType",
        "id" AS "quoteMaterialMakeMethodId",
        "itemId", 
        'Part' AS "itemType",
        1::NUMERIC AS "quantity",
        0::NUMERIC AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot",
        FALSE AS "kit",
        "version",
        NULL::TEXT AS "shelfId"
    FROM 
        "quoteMakeMethod" 
    WHERE 
        "quoteId" = qid
        AND "parentMaterialId" IS NULL
    UNION 
    SELECT 
        child."quoteId",
        child."quoteLineId",
        child."id", 
        child."quoteMakeMethodId",
        child."methodType",
        child."quoteMaterialMakeMethodId",
        child."itemId", 
        child."itemType",
        child."quantity",
        child."unitCost",
        parent."id" AS "parentMaterialId",
        child."order",
        FALSE AS "isRoot",
        child."kit",
        child."version",
        child."shelfId"
    FROM 
        "quoteMaterialWithMakeMethodId" child 
        INNER JOIN material parent ON parent."quoteMaterialMakeMethodId" = child."quoteMakeMethodId"
) 
SELECT 
  material."quoteId",
  material."quoteLineId",
  material.id as "methodMaterialId", 
  material."quoteMakeMethodId",
  material."quoteMaterialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."name" AS "description",
  material."itemType",
  material."quantity",
  material."unitCost",
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot",
  material."kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration", 
        CASE 
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  material."version",
  material."shelfId"
FROM material 
INNER JOIN item ON material."itemId" = item.id
WHERE material."quoteId" = qid
ORDER BY "order"
$$ LANGUAGE sql STABLE;


DROP FUNCTION IF EXISTS get_job_method;
CREATE OR REPLACE FUNCTION get_job_method(jid TEXT)
RETURNS TABLE (
    "jobId" TEXT,
    "methodMaterialId" TEXT,
    "jobMakeMethodId" TEXT,
    "jobMaterialMakeMethodId" TEXT,  
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "description" TEXT,
    "itemType" TEXT,
    "quantity" NUMERIC,
    "unitCost" NUMERIC,
    "methodType" "methodType",
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "shelfId" TEXT
) AS $$
WITH RECURSIVE material AS (
    SELECT 
        "jobId",
        "id", 
        "id" AS "jobMakeMethodId",
        'Make'::"methodType" AS "methodType",
        "id" AS "jobMaterialMakeMethodId",
        "itemId", 
        'Part' AS "itemType",
        1::NUMERIC AS "quantity",
        0::NUMERIC AS "unitCost",
        "parentMaterialId",
        CAST(1 AS DOUBLE PRECISION) AS "order",
        TRUE AS "isRoot",
        FALSE AS "kit",
        "version",
        NULL::TEXT AS "shelfId"
    FROM 
        "jobMakeMethod" 
    WHERE 
        "jobId" = jid
        AND "parentMaterialId" IS NULL
    UNION 
    SELECT 
        child."jobId",
        child."id", 
        child."jobMakeMethodId",
        child."methodType",
        child."jobMaterialMakeMethodId",
        child."itemId", 
        child."itemType",
        child."quantity",
        child."unitCost",
        parent."id" AS "parentMaterialId",
        child."order",
        FALSE AS "isRoot",
        child."kit",
        child."version",
        child."shelfId"
    FROM 
        "jobMaterialWithMakeMethodId" child 
        INNER JOIN material parent ON parent."jobMaterialMakeMethodId" = child."jobMakeMethodId"
    WHERE parent."methodType" = 'Make'
) 
SELECT 
  material."jobId",
  material.id as "methodMaterialId", 
  material."jobMakeMethodId",
  material."jobMaterialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."name" AS "description",
  material."itemType",
  material."quantity",
  material."unitCost",
  material."methodType",
  material."parentMaterialId",
  material."order",
  material."isRoot",
  material."kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration", 
        CASE 
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  material."version",
  material."shelfId"
FROM material 
INNER JOIN item ON material."itemId" = item.id
WHERE material."jobId" = jid
ORDER BY "order"
$$ LANGUAGE sql STABLE;


DROP VIEW IF EXISTS "suppliers";
CREATE OR REPLACE VIEW "suppliers" WITH(SECURITY_INVOKER=true) AS
      SELECT
        s.id,
        s.name,
        s."supplierTypeId",
        s."supplierStatusId",
        s."taxId",
        s."accountManagerId",
        s.logo,
        s.assignee,
        s."companyId",
        s."createdAt",
        s."createdBy",
        s."updatedAt",
        s."updatedBy",
        s."customFields",
        s."currencyCode",
        s.website,
        (
          SELECT COALESCE(
            jsonb_object_agg(
              eim."integration", 
              CASE 
                WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
                ELSE to_jsonb(eim."externalId")
              END
            ) FILTER (WHERE eim."externalId" IS NOT NULL),
            '{}'::jsonb
          )
          FROM "externalIntegrationMapping" eim
          WHERE eim."entityType" = 'supplier' AND eim."entityId" = s.id
        ) AS "externalId",
        s.tags,
        s."taxPercent",
        s."purchasingContactId",
        s."invoicingContactId",
        s.embedding,
        st.name AS "type",
        ss.name AS "status",
        po.count AS "orderCount",
        p.count AS "partCount",
        pc."workPhone" AS "phone",
        pc.fax AS "fax"
      FROM "supplier" s
      LEFT JOIN "supplierType" st ON st.id = s."supplierTypeId"
      LEFT JOIN "supplierStatus" ss ON ss.id = s."supplierStatusId"
      LEFT JOIN (
        SELECT
          "supplierId",
          COUNT(*) AS "count"
        FROM "purchaseOrder"
        GROUP BY "supplierId"
      ) po ON po."supplierId" = s.id
      LEFT JOIN (
        SELECT
          "supplierId",
          COUNT(*) AS "count"
        FROM "supplierPart"
        GROUP BY "supplierId"
      ) p ON p."supplierId" = s.id
    LEFT JOIN (
      SELECT DISTINCT ON (sc."supplierId")
        sc."supplierId" AS id,
        co."workPhone",
        co."fax"
      FROM "supplierContact" sc
      JOIN "contact" co
        ON co.id = sc."contactId"
      ORDER BY sc."supplierId", sc.id
    ) pc
      ON pc.id = s.id;



DROP VIEW IF EXISTS "customers";
CREATE OR REPLACE VIEW "customers" WITH(SECURITY_INVOKER=true) AS
  SELECT
    c.id,
    c.name,
    c."customerTypeId",
    c."customerStatusId",
    c."taxId",
    c."accountManagerId",
    c.logo,
    c.assignee,
    c."taxPercent",
    c.website,
    c."companyId",
    c."createdAt",
    c."createdBy",
    c."updatedAt",
    c."updatedBy",
    c."customFields",
    c."currencyCode",
    c."salesContactId",
    c."invoicingContactId",
    (
      SELECT COALESCE(
        jsonb_object_agg(
          eim."integration", 
          CASE 
            WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
            ELSE to_jsonb(eim."externalId")
          END
        ) FILTER (WHERE eim."externalId" IS NOT NULL),
        '{}'::jsonb
      )
      FROM "externalIntegrationMapping" eim
      WHERE eim."entityType" = 'customer' AND eim."entityId" = c.id
    ) AS "externalId",
    ct.name AS "type",
    cs.name AS "status",
    so.count AS "orderCount",
    pc."workPhone" AS "phone",
    pc."fax" AS "fax"
  FROM "customer" c
  LEFT JOIN "customerType" ct ON ct.id = c."customerTypeId"
  LEFT JOIN "customerStatus" cs ON cs.id = c."customerStatusId"
  LEFT JOIN (
    SELECT
      "customerId",
      COUNT(*) AS "count"
    FROM "salesOrder"
    GROUP BY "customerId"
  ) so ON so."customerId" = c.id
  LEFT JOIN (
    SELECT DISTINCT ON (cc."customerId")
      cc."customerId",
      co."workPhone",
      co."fax"
    FROM "customerContact" cc
    INNER JOIN "contact" co ON co.id = cc."contactId"
    ORDER BY cc."customerId"
  ) pc ON pc."customerId" = c.id;

DROP VIEW IF EXISTS "parts";
CREATE OR REPLACE VIEW "parts" WITH (SECURITY_INVOKER=true) AS 
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId") 
    i.*,
    mu.id as "modelUploadId",
    
    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  ORDER BY i."readableId", i."companyId", i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT 
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'name', i."name",
        'description', i."description",
        'active', i."active",
        'createdAt', i."createdAt"
      ) ORDER BY i."createdAt"
      ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
    ELSE li."thumbnailPath"
  END as "thumbnailPath",
  
  li."modelPath",
  li."modelName",
  li."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  p."customFields",
  p."tags",
  ic."itemPostingGroupId",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration", 
        CASE 
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "part" p
INNER JOIN latest_items li ON li."readableId" = p."id" AND li."companyId" = p."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = p."id" AND ir."companyId" = p."companyId"
LEFT JOIN (
  SELECT 
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id;

DROP VIEW IF EXISTS "materials";
CREATE OR REPLACE VIEW "materials" WITH (SECURITY_INVOKER=true) AS 
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId") 
    i.*,
    
    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  ORDER BY i."readableId", i."companyId", i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT 
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY i."createdAt"
      ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId", i."companyId"
)
SELECT
  i."active",
  i."assignee",
  i."defaultMethodType",
  i."description",
  i."itemTrackingType",
  i."name",
  i."replenishmentSystem",
  i."unitOfMeasureCode",
  i."notes",
  i."revision",
  i."readableId",
  i."readableIdWithRevision",
  i."id",
  i."companyId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND i."modelThumbnailPath" IS NOT NULL THEN i."modelThumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  i."modelUploadId",
  i."modelPath",
  i."modelName",
  i."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  mf."name" AS "materialForm",
  ms."name" AS "materialSubstance",
  md."name" AS "dimensions",
  mfin."name" AS "finish",
  mg."name" AS "grade",
  mt."name" AS "materialType",
  m."materialSubstanceId",
  m."materialFormId",
  m."customFields",
  m."tags",
  ic."itemPostingGroupId",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration", 
        CASE 
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = i.id
  ) AS "externalId",
  i."createdBy",
  i."createdAt",
  i."updatedBy",
  i."updatedAt"
FROM "material" m
  INNER JOIN latest_items i ON i."readableId" = m."id" AND i."companyId" = m."companyId"
  LEFT JOIN item_revisions ir ON ir."readableId" = m."id" AND ir."companyId" = i."companyId"
  LEFT JOIN (
    SELECT 
      ps."itemId",
      ps."companyId",
      string_agg(ps."supplierPartId", ',') AS "supplierIds"
    FROM "supplierPart" ps
    GROUP BY ps."itemId", ps."companyId"
  ) ps ON ps."itemId" = i."id" AND ps."companyId" = i."companyId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId"
  LEFT JOIN "materialForm" mf ON mf."id" = m."materialFormId"
  LEFT JOIN "materialSubstance" ms ON ms."id" = m."materialSubstanceId"
  LEFT JOIN "materialDimension" md ON m."dimensionId" = md."id"
  LEFT JOIN "materialFinish" mfin ON m."finishId" = mfin."id"
  LEFT JOIN "materialGrade" mg ON m."gradeId" = mg."id"
  LEFT JOIN "materialType" mt ON m."materialTypeId" = mt."id"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id;


DROP VIEW IF EXISTS "tools";
CREATE OR REPLACE VIEW "tools" WITH (SECURITY_INVOKER=true) AS 
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId") 
    i.*,
    mu.id as "modelUploadId",
    
    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  ORDER BY i."readableId", i."companyId", i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT 
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY i."createdAt"
      ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
    ELSE li."thumbnailPath"
  END as "thumbnailPath",
  
  li."modelPath",
  li."modelName",
  li."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  t."customFields",
  t."tags",
  ic."itemPostingGroupId",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration", 
        CASE 
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "tool" t
  INNER JOIN latest_items li ON li."readableId" = t."id" AND li."companyId" = t."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = t."id" AND ir."companyId" = li."companyId"
LEFT JOIN (
  SELECT 
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id;

DROP VIEW IF EXISTS "consumables";
CREATE OR REPLACE VIEW "consumables" WITH (SECURITY_INVOKER=true) AS 
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId") 
    i.*,
    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  ORDER BY i."readableId", i."companyId", i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT 
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY i."createdAt"
      ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
    ELSE li."thumbnailPath"
  END as "thumbnailPath",
  li."modelUploadId",
  li."modelPath",
  li."modelName",
  li."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  c."customFields",
  c."tags",
  ic."itemPostingGroupId",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration", 
        CASE 
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "consumable" c
  INNER JOIN latest_items li ON li."readableId" = c."id" AND li."companyId" = c."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = c."id" AND ir."companyId" = li."companyId"
LEFT JOIN (
  SELECT 
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id;

CREATE OR REPLACE VIEW "services" WITH(SECURITY_INVOKER=true) AS
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId") 
    i.*
  FROM "item" i
  ORDER BY i."readableId", i."companyId", i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT 
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY i."createdAt"
      ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  li."thumbnailPath",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  s."customFields",
  s."tags",
  ic."itemPostingGroupId",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration", 
        CASE 
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "service" s
  INNER JOIN latest_items li ON li."readableId" = s."id" AND li."companyId" = s."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = s."id" AND ir."companyId" = li."companyId"
LEFT JOIN (
  SELECT 
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id;

DROP VIEW IF EXISTS "salesOrders";
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    sl."thumbnailPath",
    sl."itemType", 
    sl."orderTotal" + COALESCE(ss."shippingCost", 0) AS "orderTotal",
    sl."jobs",
    sl."lines",
    st."name" AS "shippingTermName",
    sp."paymentTermId",
    ss."shippingMethodId",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost",
    (
      SELECT COALESCE(
        jsonb_object_agg(
          eim."integration", 
          CASE 
            WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
            ELSE to_jsonb(eim."externalId")
          END
        ) FILTER (WHERE eim."externalId" IS NOT NULL),
        '{}'::jsonb
      )
      FROM "externalIntegrationMapping" eim
      WHERE eim."entityType" = 'salesOrder' AND eim."entityId" = s.id
    ) AS "externalId"
  FROM "salesOrder" s
  LEFT JOIN (
    SELECT 
      sol."salesOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        DISTINCT (1+COALESCE(sol."taxPercent", 0))*(COALESCE(sol."saleQuantity", 0)*(COALESCE(sol."unitPrice", 0)) + COALESCE(sol."shippingCost", 0) + COALESCE(sol."addOnCost", 0))
      ) AS "orderTotal",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        CASE 
          WHEN j.id IS NOT NULL THEN json_build_object(
            'id', j.id, 
            'jobId', j."jobId", 
            'status', j."status",
            'dueDate', j."dueDate",
            'productionQuantity', j."productionQuantity",
            'quantityComplete', j."quantityComplete",
            'quantityShipped', j."quantityShipped",
            'quantity', j."quantity",
            'scrapQuantity', j."scrapQuantity",
            'salesOrderLineId', sol.id,
            'assignee', j."assignee"
          )
          ELSE NULL 
        END
      ) FILTER (WHERE j.id IS NOT NULL) AS "jobs",
      ARRAY_AGG(
        json_build_object(
          'id', sol.id,
          'methodType', sol."methodType",
          'saleQuantity', sol."saleQuantity"
        )
      ) AS "lines"
    FROM "salesOrderLine" sol
    LEFT JOIN "item" i
      ON i."id" = sol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    LEFT JOIN "job" j ON j."salesOrderId" = sol."salesOrderId" AND j."salesOrderLineId" = sol."id"
    GROUP BY sol."salesOrderId"
  ) sl ON sl."salesOrderId" = s."id"
  LEFT JOIN "salesOrderShipment" ss ON ss."id" = s."id"
  LEFT JOIN "shippingTerm" st ON st."id" = ss."shippingTermId"
  LEFT JOIN "salesOrderPayment" sp ON sp."id" = s."id";
