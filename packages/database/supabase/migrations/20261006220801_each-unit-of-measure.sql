-- The "Each" unit of measure (code EA) is relied on by the app: a service is
-- always counted in Each (upsertService, the CSV import, the order line forms),
-- and EA is the fallback unit throughout. Make sure every company has one, and
-- that it can no longer be renamed, deactivated or deleted. Deleting it would
-- otherwise cascade-delete every purchase/sales order line in EA, and changing
-- its code would cascade into every item counted in it.

INSERT INTO "unitOfMeasure" ("code", "name", "companyId", "createdBy")
SELECT 'EA', 'Each', c."id", 'system'
FROM "company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "unitOfMeasure" u
  WHERE u."companyId" = c."id" AND u."code" = 'EA'
)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION prevent_each_unit_of_measure_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The company itself is being deleted; let the cascade through.
    IF OLD."code" = 'EA'
      AND EXISTS (SELECT 1 FROM "company" WHERE "id" = OLD."companyId") THEN
      RAISE EXCEPTION 'The Each (EA) unit of measure cannot be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."code" = 'EA' AND (
    NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."active" IS DISTINCT FROM OLD."active"
  ) THEN
    RAISE EXCEPTION 'The Each (EA) unit of measure cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER prevent_each_unit_of_measure_change_trigger
BEFORE UPDATE OR DELETE ON "unitOfMeasure"
FOR EACH ROW EXECUTE FUNCTION prevent_each_unit_of_measure_change();

-- A service is always counted in Each, bought and sold 1:1.
UPDATE "item"
SET "unitOfMeasureCode" = 'EA'
WHERE "type" = 'Service'
  AND "unitOfMeasureCode" IS DISTINCT FROM 'EA';

UPDATE "itemReplenishment" r
SET "purchasingUnitOfMeasureCode" = 'EA', "conversionFactor" = 1
FROM "item" i
WHERE i."id" = r."itemId"
  AND i."type" = 'Service'
  AND (r."purchasingUnitOfMeasureCode" IS DISTINCT FROM 'EA'
    OR r."conversionFactor" IS DISTINCT FROM 1);

UPDATE "itemUnitSalePrice" p
SET "salesUnitOfMeasureCode" = 'EA'
FROM "item" i
WHERE i."id" = p."itemId"
  AND i."type" = 'Service'
  AND p."salesUnitOfMeasureCode" IS DISTINCT FROM 'EA';

UPDATE "supplierPart" s
SET "supplierUnitOfMeasureCode" = 'EA', "conversionFactor" = 1
FROM "item" i
WHERE i."id" = s."itemId"
  AND i."type" = 'Service'
  AND (s."supplierUnitOfMeasureCode" IS DISTINCT FROM 'EA'
    OR s."conversionFactor" IS DISTINCT FROM 1);
