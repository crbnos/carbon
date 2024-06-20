DROP VIEW "parts";
DROP VIEW "services";
DROP VIEW "materials";
DROP VIEW "tools";
DROP VIEW "consumables";
DROP VIEW "fixtures";
ALTER TABLE "item" DROP COLUMN "blocked";

CREATE OR REPLACE VIEW "parts" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemGroupId",
    i."itemInventoryType",
    i."unitOfMeasureCode",
    i.active,
    i."pullFromInventory",
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
    FROM "buyMethod" ps
    GROUP BY "itemId"
  )  ps ON ps."itemId" = p."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";


CREATE OR REPLACE VIEW "services" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    i.name,
    i.description,
    i."itemGroupId",
    i.active,
    i."pullFromInventory",
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
    FROM "buyMethod" ss
    GROUP BY "itemId"
  )  ss ON ss."itemId" = s."itemId";

CREATE OR REPLACE VIEW "materials" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemGroupId",
    i."itemInventoryType",
    i."unitOfMeasureCode",
    i.active,
    i."pullFromInventory",
    i.assignee,
    m.*,
    mf."name" AS "materialForm",
    ms."name" AS "materialSubstance",
    ig.name AS "itemGroup",
    s."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "material" m
  INNER JOIN "item" i ON i.id = m."itemId"
  LEFT JOIN "itemGroup" ig ON ig.id = i."itemGroupId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "buyMethod" s
    GROUP BY "itemId"
  )  s ON s."itemId" = m."itemId"
  LEFT JOIN "materialForm" mf ON mf.id = m."materialFormId"
  LEFT JOIN "materialSubstance" ms ON ms.id = m."materialSubstanceId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";

CREATE OR REPLACE VIEW "tools" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemGroupId",
    i."itemInventoryType",
    i.active,
    i."pullFromInventory",
    i.assignee,
    i."unitOfMeasureCode",
    t.*,
    ig.name AS "itemGroup",
    s."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "tool" t
  INNER JOIN "item" i ON i.id = t."itemId"
  LEFT JOIN "itemGroup" ig ON ig.id = i."itemGroupId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "buyMethod" s
    GROUP BY "itemId"
  )  s ON s."itemId" = t."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";

CREATE OR REPLACE VIEW "consumables" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemGroupId",
    i."itemInventoryType",
    i."unitOfMeasureCode",
    i.active,
    i."pullFromInventory",
    i.assignee,
    c.*,
    ig.name AS "itemGroup",
    s."supplierIds",
    uom.name as "unitOfMeasure"
  FROM "consumable" c
  INNER JOIN "item" i ON i.id = c."itemId"
  LEFT JOIN "itemGroup" ig ON ig.id = i."itemGroupId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "buyMethod" s
    GROUP BY "itemId"
  )  s ON s."itemId" = c."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId";

CREATE OR REPLACE VIEW "fixtures" WITH(SECURITY_INVOKER=true) AS 
  SELECT
    i.name,
    i.description,
    i."itemGroupId",
    i."itemInventoryType",
    i.active,
    i."pullFromInventory",
    i.assignee,
    f.*,
    ig.name AS "itemGroup",
    s."supplierIds",
    c.name as "customer"
  FROM "fixture" f
  INNER JOIN "item" i ON i.id = f."itemId"
  LEFT JOIN "itemGroup" ig ON ig.id = i."itemGroupId"
  LEFT JOIN (
    SELECT 
      "itemId",
      array_agg(s."supplierId") AS "supplierIds"
    FROM "buyMethod" s
    GROUP BY "itemId"
  )  s ON s."itemId" = f."itemId"
  LEFT JOIN "customer" c ON c.id = f."customerId";
