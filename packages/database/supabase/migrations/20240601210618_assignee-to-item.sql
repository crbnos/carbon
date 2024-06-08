ALTER TABLE "item" ADD COLUMN "assignee" TEXT;
ALTER TABLE "item" ADD CONSTRAINT "item_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL;

DROP VIEW "parts";
DROP VIEW "services";

ALTER TABLE "part" DROP CONSTRAINT "part_assignee_fkey";
ALTER TABLE "part" DROP COLUMN "assignee";
ALTER TABLE "service" DROP CONSTRAINT "service_assignee_fkey";
ALTER TABLE "service" DROP COLUMN "assignee";

CREATE OR REPLACE VIEW "parts" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemGroupId",
    i."itemInventoryType",
    i.active,
    i.blocked,
    i.assignee,
    p.*,
    pg.name AS "itemGroup",
    ps."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "part" p
  INNER JOIN "item" i ON i.id = p."itemId"
  LEFT JOIN "itemGroup" pg ON pg.id = i."itemGroupId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(ps."supplierId") AS "supplierIds"
    FROM "itemSupplier" ps
    GROUP BY "itemId"
  )  ps ON ps."itemId" = p."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = p."unitOfMeasureCode" AND uom."companyId" = p."companyId";


CREATE OR REPLACE VIEW "services" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    i.name,
    i.description,
    i."itemGroupId",
    i.active,
    i.blocked,
    i.assignee,
    pg.name AS "itemGroup",
    ss."supplierIds"
  FROM "service" s
  INNER JOIN "item" i ON i.id = s."itemId"
  LEFT JOIN "itemGroup" pg ON pg.id = i."itemGroupId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(ss."supplierId") AS "supplierIds"
    FROM "itemSupplier" ss
    GROUP BY "itemId"
  )  ss ON ss."itemId" = s."itemId";

DROP TABLE "serviceSupplier";