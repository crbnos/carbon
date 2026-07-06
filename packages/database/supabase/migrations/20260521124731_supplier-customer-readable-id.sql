-- Add a first-class human-readable identifier to supplier and customer.
--
-- Every supplier/customer gets a readableId — either user-supplied (CSV import
-- "Unique ID" column or the SequenceOrCustomId form field) or auto-generated
-- from a per-company sequence (SUP000001 / CUS000001 style).

-- 1. Add the column (initially nullable so the backfill can run).
ALTER TABLE "supplier" ADD COLUMN IF NOT EXISTS "readableId" TEXT;
ALTER TABLE "customer" ADD COLUMN IF NOT EXISTS "readableId" TEXT;

-- 2. Seed default sequences for every existing company.
-- get_next_sequence() formats as: prefix + zero-padded(size) + suffix.
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId", "updatedBy")
SELECT 'supplier', 'Supplier', 'SUP', NULL, 0, 6, 1, c.id, 'system'
FROM "company" c
ON CONFLICT ("table", "companyId") DO NOTHING;

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId", "updatedBy")
SELECT 'customer', 'Customer', 'CUS', NULL, 0, 6, 1, c.id, 'system'
FROM "company" c
ON CONFLICT ("table", "companyId") DO NOTHING;

-- 3. Backfill existing rows so the column can be tightened to NOT NULL.
-- Each call to get_next_sequence() atomically increments the per-company
-- counter, so two rows in the same company get distinct ids.
UPDATE "supplier"
SET "readableId" = get_next_sequence('supplier', "companyId")
WHERE "readableId" IS NULL;

UPDATE "customer"
SET "readableId" = get_next_sequence('customer', "companyId")
WHERE "readableId" IS NULL;

-- 4. Require the column and enforce per-company uniqueness.
ALTER TABLE "supplier" ALTER COLUMN "readableId" SET NOT NULL;
ALTER TABLE "customer" ALTER COLUMN "readableId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "supplier_readableId_companyId_unique"
  ON "supplier" ("companyId", "readableId");

CREATE UNIQUE INDEX IF NOT EXISTS "customer_readableId_companyId_unique"
  ON "customer" ("companyId", "readableId");

-- 5. BEFORE INSERT trigger: auto-fill readableId via get_next_sequence when
-- the caller didn't provide one (e.g., in-app create with blank ID field).
-- Trigger no-ops if readableId is already set, so explicit values win.
CREATE OR REPLACE FUNCTION set_supplier_readable_id_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."readableId" IS NULL OR NEW."readableId" = '' THEN
    IF EXISTS (
      SELECT 1 FROM "sequence"
      WHERE "table" = 'supplier' AND "companyId" = NEW."companyId"
    ) THEN
      NEW."readableId" := get_next_sequence('supplier', NEW."companyId");
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION set_customer_readable_id_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."readableId" IS NULL OR NEW."readableId" = '' THEN
    IF EXISTS (
      SELECT 1 FROM "sequence"
      WHERE "table" = 'customer' AND "companyId" = NEW."companyId"
    ) THEN
      NEW."readableId" := get_next_sequence('customer', NEW."companyId");
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS set_supplier_readable_id ON "supplier";
CREATE TRIGGER set_supplier_readable_id
  BEFORE INSERT ON "supplier"
  FOR EACH ROW
  EXECUTE PROCEDURE set_supplier_readable_id_on_insert();

DROP TRIGGER IF EXISTS set_customer_readable_id ON "customer";
CREATE TRIGGER set_customer_readable_id
  BEFORE INSERT ON "customer"
  FOR EACH ROW
  EXECUTE PROCEDURE set_customer_readable_id_on_insert();

-- 6. Recreate the suppliers and customers views to expose readableId.
-- Postgres views freeze their column manifest at CREATE time, so adding a
-- column to the base table does not propagate without a DROP/CREATE cycle.

DROP VIEW IF EXISTS "suppliers";
CREATE OR REPLACE VIEW "suppliers" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.id,
    s."readableId",
    s.name,
    s."supplierTypeId",
    s."supplierStatus" as "status",
    stx."taxId",
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
    stx."vatNumber",
    stx."eori",
    s.website,
    (
      SELECT COALESCE(
        jsonb_object_agg(
          eim."integration",
          CASE
            WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
            ELSE to_jsonb(eim."externalId")
          END
        ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
        '{}'::jsonb
      )
      FROM "externalIntegrationMapping" eim
      WHERE eim."entityType" = 'supplier' AND eim."entityId" = s.id
    ) AS "externalId",
    s.tags,
    s."taxPercent",
    s."purchasingContactId",
    s.embedding,
    s."defaultCc",
    st.name AS "type",
    po.count AS "orderCount",
    p.count AS "partCount",
    pc."workPhone" AS "phone",
    pc.fax AS "fax"
  FROM "supplier" s
  LEFT JOIN "supplierTax" stx ON stx."supplierId" = s.id
  LEFT JOIN "supplierType" st ON st.id = s."supplierTypeId"
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
    c."readableId",
    c.name,
    c."customerTypeId",
    c."customerStatusId",
    ctx."taxId",
    c."accountManagerId",
    c.logo,
    c.assignee,
    c."taxPercent",
    c."tags",
    c.website,
    c."companyId",
    c."createdAt",
    c."createdBy",
    c."updatedAt",
    c."updatedBy",
    c."customFields",
    c."currencyCode",
    c."salesContactId",
    c."defaultCc",
    ctx."vatNumber",
    ctx."eori",
    (
      SELECT COALESCE(
        jsonb_object_agg(
          eim."integration",
          CASE
            WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
            ELSE to_jsonb(eim."externalId")
          END
        ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
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
  LEFT JOIN "customerTax" ctx ON ctx."customerId" = c.id
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
