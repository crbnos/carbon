CREATE OR REPLACE VIEW "parts" AS 
  SELECT
    p.id,
    p."itemId",
    i.name,
    i.description,
    p."partType",
    i."partGroupId",
    pg.name AS "partGroup",
    p."replenishmentSystem",
    i.active,
    i.blocked,
    p."customFields",
    p."companyId",
    array_agg(ps."supplierId") AS "supplierIds"
  FROM "part" p
  INNER JOIN "item" i ON i.id = p."itemId"
  LEFT JOIN "partGroup" pg ON pg.id = i."partGroupId"
  LEFT JOIN "partSupplier" ps ON ps."partId" = p.id
  GROUP BY p.id,
    i.name,
    i.description,
    p."partType",
    i."partGroupId",
    pg.name,
    p."replenishmentSystem",
    i.active,
    i.blocked,
    p."customFields",
    p."companyId";
  
