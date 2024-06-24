CREATE OR REPLACE VIEW "parts" AS 
  SELECT
    p.id,
    p."itemId",
    i.name,
    i.description,
    i."itemTrackingType",
    i."unitOfMeasureCode",
    uom.name as "unitOfMeasure",
    i.active,
    i.blocked,
    p."customFields",
    p."companyId",
    array_agg(s."supplierId") AS "supplierIds"
  FROM "part" p
  INNER JOIN "item" i ON i.id = p."itemId"
  LEFT JOIN "buyMethod" s ON s."itemId" = p."itemId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId"
  GROUP BY p.id,
    i.name,
    i.description, 
    i."itemTrackingType",
    i."unitOfMeasureCode",
    i.active,
    i.blocked,
    p."customFields",
    p."companyId",
    uom.name;
  
