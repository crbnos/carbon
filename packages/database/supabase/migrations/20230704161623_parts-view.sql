CREATE OR REPLACE VIEW "parts" AS 
  SELECT
    p.id,
    p."itemId",
    i.name,
    i.description,
    i."itemGroupId",
    i."itemInventoryType",
    i."unitOfMeasureCode",
    pg.name AS "itemGroup",
    uom.name as "unitOfMeasure",
    p."replenishmentSystem",
    i.active,
    i.blocked,
    p."customFields",
    p."companyId",
    array_agg(s."supplierId") AS "supplierIds"
  FROM "part" p
  INNER JOIN "item" i ON i.id = p."itemId"
  LEFT JOIN "itemGroup" pg ON pg.id = i."itemGroupId"
  LEFT JOIN "buyMethod" s ON s."itemId" = p."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId"
  GROUP BY p.id,
    i.name,
    i.description,
    i."itemGroupId",
    i."itemInventoryType",
    i."unitOfMeasureCode",
    pg.name,
    p."replenishmentSystem",
    i.active,
    i.blocked,
    p."customFields",
    p."companyId",
    uom.name;
  
