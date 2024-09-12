CREATE OR REPLACE VIEW "itemQuantities" AS 
  SELECT 
    i."id" AS "itemId", 
    i."companyId",
    loc."id" AS "locationId",
    COALESCE(SUM(
      CASE 
        WHEN il."entryType" = 'Positive Adjmt.' THEN il."quantity"
        WHEN il."entryType" = 'Negative Adjmt.' THEN -il."quantity"
        ELSE il."quantity"
      END
    ), 0) AS "quantityOnHand",
    COALESCE(pol."quantityToReceive", 0) AS "quantityOnPurchaseOrder",
    0 AS "quantityOnSalesOrder",
    0 AS "quantityOnProdOrder",
    0 AS "quantityAvailable",
    i."readableId",
    i."type",
    i."name",
    i."active",
    i."itemTrackingType",
    m."thumbnailPath",
    loc."name" AS "locationName"
  FROM "item" i
  CROSS JOIN "location" loc
  LEFT JOIN "modelUpload" m ON m."id" = i."modelUploadId"
  LEFT JOIN "itemLedger" il
    ON il."itemId" = i."id" AND il."locationId" = loc."id"
  LEFT JOIN (
    -- TODO: multiply by conversion factor
    SELECT 
        pol."itemId",
        pol."locationId",
        COALESCE(SUM(GREATEST(pol."quantityToReceive", 0)), 0) AS "quantityToReceive"
      FROM "purchaseOrderLine" pol 
      INNER JOIN "purchaseOrder" po 
        ON pol."purchaseOrderId" = po."id"
      WHERE po."status" != 'Draft' 
        AND po."status" != 'Rejected'
        AND po."status" != 'Closed'
      GROUP BY 
        pol."itemId",
        pol."locationId"
  ) pol ON pol."itemId" = i."id" AND pol."locationId" = loc."id"
  GROUP BY 
    i."id",
    i."companyId",
    i."type",
    i."name",
    loc."id",
    pol."quantityToReceive",
    m."thumbnailPath"