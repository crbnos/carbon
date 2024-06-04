CREATE OR REPLACE VIEW "parts" AS 
  SELECT
    p.id,
    p."itemId",
    i.name,
    i.description,
    p."partType",
    i."itemGroupId",
    pg.name AS "itemGroup",
    p."replenishmentSystem",
    i.active,
    i.blocked,
    p."customFields",
    p."companyId",
    array_agg(s."supplierId") AS "supplierIds"
  FROM "part" p
  INNER JOIN "item" i ON i.id = p."itemId"
  LEFT JOIN "itemGroup" pg ON pg.id = i."itemGroupId"
  LEFT JOIN "itemSupplier" s ON s."itemId" = p."itemId"
  GROUP BY p.id,
    i.name,
    i.description,
    p."partType",
    i."itemGroupId",
    pg.name,
    p."replenishmentSystem",
    i.active,
    i.blocked,
    p."customFields",
    p."companyId";
  
