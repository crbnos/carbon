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
    i."itemTrackingType",
    i."unitOfMeasureCode",
    i.active,
    i.blocked,
    i.assignee,
    p.*,
    ps."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "part" p
  INNER JOIN "item" i ON i.id = p."itemId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(ps."supplierId") AS "supplierIds"
    FROM "buyMethod" ps
    GROUP BY "itemId"
  )  ps ON ps."itemId" = p."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";


CREATE OR REPLACE VIEW "services" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    i.name,
    i.description,
    i.active,
    i.blocked,
    i.assignee,
    ss."supplierIds"
  FROM "service" s
  INNER JOIN "item" i ON i.id = s."itemId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(ss."supplierId") AS "supplierIds"
    FROM "buyMethod" ss
    GROUP BY "itemId"
  )  ss ON ss."itemId" = s."itemId";

DROP TABLE "serviceSupplier";