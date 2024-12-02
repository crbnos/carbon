-- remove the use of a cross join
CREATE OR REPLACE FUNCTION get_item_quantities(location_id TEXT)
RETURNS TABLE (
  "itemId" TEXT,
  "companyId" TEXT,
  "locationId" TEXT,
  "quantityOnHand" NUMERIC,
  "quantityOnPurchaseOrder" NUMERIC,
  "quantityOnSalesOrder" NUMERIC,
  "quantityOnProdOrder" NUMERIC,
  "quantityAvailable" NUMERIC,
  "materialSubstanceId" TEXT,
  "materialFormId" TEXT,
  "grade" TEXT,
  "dimensions" TEXT,
  "finish" TEXT,
  "readableId" TEXT,
  "type" "itemType",
  "name" TEXT,
  "active" BOOLEAN,
  "itemTrackingType" "itemTrackingType",
  "thumbnailPath" TEXT,
  "locationName" TEXT,
  "unitOfMeasureCode" TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i."id" AS "itemId",
    i."companyId",
    loc."id" AS "locationId",
    SUM(COALESCE(inv."quantityOnHand", 0)) AS "quantityOnHand",
    SUM(COALESCE(inv."quantityOnPurchase", 0)) AS "quantityOnPurchaseOrder",
    SUM(COALESCE(inv."quantityOnSalesOrder", 0)) AS "quantityOnSalesOrder",
    SUM(COALESCE(inv."quantityOnProductionOrder", 0)) AS "quantityOnProdOrder",
    SUM(COALESCE(inv."quantityOnHand", 0)) - 
      SUM(COALESCE(inv."quantityOnSalesOrder", 0)) - 
      SUM(COALESCE(inv."quantityOnProductionOrder", 0)) AS "quantityAvailable",
    mat."materialSubstanceId",
    mat."materialFormId",
    mat."grade",
    mat."dimensions",
    mat."finish",
    i."readableId",
    i."type",
    i."name",
    i."active",
    i."itemTrackingType",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    loc."name" AS "locationName",
    i."unitOfMeasureCode"
  FROM "item" i
  CROSS JOIN (SELECT * FROM "location" WHERE "id" = location_id) loc
  LEFT JOIN "itemInventory" inv ON i."id" = inv."itemId" AND loc."id" = inv."locationId"
  LEFT JOIN "material" mat ON i."id" = mat."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  WHERE i."itemTrackingType" = 'Inventory'
    AND i."companyId" = loc."companyId"
  GROUP BY 
    i."id",
    i."companyId",
    loc."id",
    mat."materialSubstanceId",
    mat."materialFormId",
    mat."grade",
    mat."dimensions",
    mat."finish",
    i."readableId",
    i."type",
    i."name",
    i."active",
    i."itemTrackingType",
    i."thumbnailPath",
    mu."thumbnailPath",
    loc."name",
    i."unitOfMeasureCode";
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;


