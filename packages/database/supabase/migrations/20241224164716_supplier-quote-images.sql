DROP VIEW IF EXISTS "supplierQuoteLines";
CREATE OR REPLACE VIEW "supplierQuoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    i."type" as "itemType",
    COALESCE(i."thumbnailPath", mu."thumbnailPath") as "thumbnailPath",
    ic."unitCost" as "unitCost"
  FROM "supplierQuoteLine" ql
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
);