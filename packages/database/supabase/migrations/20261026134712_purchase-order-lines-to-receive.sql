-- The lines a receiving clerk can receive against: every item line of a purchase
-- order that is waiting to be received. Inventory → Receiving searches it by
-- whatever the packing slip carries, so "searchText" holds each searchable value
-- lower-cased with everything but letters and digits removed (RAB-514 and
-- RAB 514 both read rab514). The values are joined with "|", which a search
-- word never contains, so a match never spans two values.
CREATE OR REPLACE VIEW "purchaseOrderLinesToReceive" WITH(SECURITY_INVOKER=true) AS
SELECT
  pl."id",
  pl."companyId",
  po."id" AS "purchaseOrderId",
  po."purchaseOrderId" AS "purchaseOrderReadableId",
  po."revisionId",
  po."status",
  po."purchaseOrderType",
  po."orderDate",
  po."supplierId",
  s."name" AS "supplierName",
  po."supplierReference",
  pod."trackingNumber",
  COALESCE(pl."locationId", pod."locationId") AS "locationId",
  pl."purchaseOrderLineType",
  pl."itemId",
  i."readableIdWithRevision" AS "itemReadableId",
  i."name" AS "itemName",
  i."type" AS "itemType",
  COALESCE(i."thumbnailPath", mu."thumbnailPath") AS "thumbnailPath",
  pl."description",
  COALESCE(NULLIF(pl."supplierPartId", ''), sp."supplierPartId") AS "supplierPartId",
  pl."purchaseQuantity",
  pl."quantityReceived",
  pl."quantityToReceive",
  pl."purchaseUnitOfMeasureCode",
  pl."receivedComplete",
  COALESCE(pl."promisedDate", pod."receiptPromisedDate") AS "promisedDate",
  pl."sortOrder",
  concat_ws(
    '|',
    regexp_replace(lower(po."purchaseOrderId"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(s."name"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(po."supplierReference"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(pod."trackingNumber"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(po."jobReadableId"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(i."readableIdWithRevision"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(i."name"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(pl."description"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(pl."supplierPartId"), '[^[:alnum:]]+', '', 'g'),
    regexp_replace(lower(sp."supplierPartId"), '[^[:alnum:]]+', '', 'g')
  ) AS "searchText"
FROM "purchaseOrderLine" pl
INNER JOIN "purchaseOrder" po ON po."id" = pl."purchaseOrderId"
INNER JOIN "supplier" s ON s."id" = po."supplierId"
LEFT JOIN "purchaseOrderDelivery" pod ON pod."id" = po."id"
LEFT JOIN "item" i ON i."id" = pl."itemId"
LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
LEFT JOIN LATERAL (
  SELECT sp."supplierPartId"
  FROM "supplierPart" sp
  WHERE sp."supplierId" = po."supplierId"
    AND sp."itemId" = pl."itemId"
    AND sp."companyId" = pl."companyId"
  ORDER BY sp."id"
  LIMIT 1
) sp ON TRUE
WHERE po."status" IN ('To Receive', 'To Receive and Invoice')
  -- The line types a receipt is built from (receiptFromPurchaseOrder).
  AND pl."purchaseOrderLineType" IN ('Part', 'Material', 'Tool', 'Fixture', 'Consumable');
