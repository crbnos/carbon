DROP FUNCTION IF EXISTS get_sales_order_lines_by_customer_id(TEXT);
CREATE OR REPLACE FUNCTION get_sales_order_lines_by_customer_id(customer_id TEXT)
RETURNS TABLE (
  "customerReference" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "customerContactName" TEXT,
  "customerEngineeringContactName" TEXT,
  "saleQuantity" NUMERIC,
  "quantityToSend" NUMERIC,
  "quantitySent" NUMERIC,
  "quantityInvoiced" NUMERIC,
  "unitPrice" NUMERIC,
  "unitOfMeasureCode" TEXT,
  "locationId" TEXT,
  "orderDate" DATE,
  "promisedDate" DATE,
  "receiptRequestedDate" DATE,
  "receiptPromisedDate" DATE,
  "salesOrderStatus" "salesOrderStatus",
  "readableId" TEXT,
  "revision" TEXT,
  "readableIdWithRevision" TEXT,
  "customerId" TEXT,
  "thumbnailPath" TEXT,
  "jobOperations" JSONB,
  "jobQuantityShipped" NUMERIC,
  "jobQuantityComplete" NUMERIC,
  "jobProductionQuantity" NUMERIC,
  "jobStatus" "jobStatus",
  "portalLateReason" TEXT,
  "portalDeliveryUpdate" TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    so."customerReference",
    so."salesOrderId",
    sol."id" AS "salesOrderLineId",
    COALESCE(pc."fullName", pc."email") AS "customerContactName",
    COALESCE(ec."fullName", ec."email") AS "customerEngineeringContactName",
    sol."saleQuantity",
    sol."quantityToSend",
    sol."quantitySent",
    sol."quantityInvoiced",
    sol."unitPrice",
    sol."unitOfMeasureCode",
    sol."locationId",
    so."orderDate",
    sol."promisedDate",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    so."status" AS "salesOrderStatus",
    i."readableId",
    i."revision",
    i."readableIdWithRevision",
    so."customerId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    COALESCE(
      (
        SELECT jsonb_agg(DISTINCT
          jsonb_build_object(
            'id', jo.id,
            'jobId', jo."jobId",
            'order', jo."order",
            'status', jo.status,
            'description', p."name",
            'operationType', jo."operationType",
            'operationQuantity', jo."operationQuantity",
            'quantityComplete', jo."quantityComplete"
          )
        )
        FROM "jobOperation" jo
        INNER JOIN "jobMakeMethod" jmm ON jmm."id" = jo."jobMakeMethodId"
        INNER JOIN "process" p ON p."id" = jo."processId"
        WHERE jo."jobId" = j.id AND jmm."parentMaterialId" IS NULL
      ),
      '[]'::jsonb
    ) AS "jobOperations",
    j."quantityShipped" AS "jobQuantityShipped",
    j."quantityComplete" AS "jobQuantityComplete",
    j."productionQuantity" AS "jobProductionQuantity",
    j."status" AS "jobStatus",
    sol."portalLateReason",
    sol."portalDeliveryUpdate"
  FROM "salesOrderLine" sol
  INNER JOIN "salesOrder" so
    ON so."id" = sol."salesOrderId"
  LEFT JOIN "salesOrderShipment" ss
    ON ss."id" = so."id"
  INNER JOIN "item" i
    ON i."id" = sol."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "job" j
    ON j."salesOrderLineId" = sol."id"
  LEFT JOIN "customerContact" pcc
    ON pcc."id" = so."customerContactId"
  LEFT JOIN "contact" pc
    ON pc."id" = pcc."contactId"
  LEFT JOIN "customerContact" ecc
    ON ecc."id" = so."customerEngineeringContactId"
  LEFT JOIN "contact" ec
    ON ec."id" = ecc."contactId"
  WHERE so."customerId" = customer_id;
END;
$$ LANGUAGE plpgsql;
