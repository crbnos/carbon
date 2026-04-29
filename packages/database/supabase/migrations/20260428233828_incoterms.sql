CREATE TYPE "incoterm" AS ENUM (
  'EXW',
  'FCA',
  'FAS',
  'FOB',
  'CPT',
  'CIP',
  'CFR',
  'CIF',
  'DAP',
  'DPU',
  'DDP'
);

ALTER TABLE "quoteShipment"
  ADD COLUMN "incoterm" "incoterm",
  ADD COLUMN "incotermLocation" TEXT;

ALTER TABLE "salesOrderShipment"
  ADD COLUMN "incoterm" "incoterm",
  ADD COLUMN "incotermLocation" TEXT;

ALTER TABLE "salesInvoiceShipment"
  ADD COLUMN "incoterm" "incoterm",
  ADD COLUMN "incotermLocation" TEXT;

ALTER TABLE "purchaseOrderDelivery"
  ADD COLUMN "incoterm" "incoterm",
  ADD COLUMN "incotermLocation" TEXT;

ALTER TABLE "purchaseInvoiceDelivery"
  ADD COLUMN "incoterm" "incoterm",
  ADD COLUMN "incotermLocation" TEXT;

ALTER TABLE "customerShipping"
  ADD COLUMN "incoterm" "incoterm",
  ADD COLUMN "incotermLocation" TEXT;

ALTER TABLE "supplierShipping"
  ADD COLUMN "incoterm" "incoterm",
  ADD COLUMN "incotermLocation" TEXT;

DROP VIEW IF EXISTS "salesOrders";
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    sl."thumbnailPath",
    sl."itemType",
    sl."orderTotal" + COALESCE(ss."shippingCost", 0) AS "orderTotal",
    sl."jobs",
    sl."lines",
    st."name" AS "shippingTermName",
    sp."paymentTermId",
    ss."shippingMethodId",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost",
    ss."incoterm",
    ss."incotermLocation",
    (
      SELECT COALESCE(
        jsonb_object_agg(
          eim."integration",
          CASE
            WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
            ELSE to_jsonb(eim."externalId")
          END
        ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
        '{}'::jsonb
      )
      FROM "externalIntegrationMapping" eim
      WHERE eim."entityType" = 'salesOrder' AND eim."entityId" = s.id
    ) AS "externalId"
  FROM "salesOrder" s
  LEFT JOIN (
    SELECT
      sol."salesOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        DISTINCT (1+COALESCE(sol."taxPercent", 0))*(COALESCE(sol."saleQuantity", 0)*(COALESCE(sol."unitPrice", 0)) + COALESCE(sol."shippingCost", 0) + COALESCE(sol."addOnCost", 0)) + COALESCE(sol."nonTaxableAddOnCost", 0)
      ) AS "orderTotal",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        CASE
          WHEN j.id IS NOT NULL THEN json_build_object(
            'id', j.id,
            'jobId', j."jobId",
            'status', j."status",
            'dueDate', j."dueDate",
            'productionQuantity', j."productionQuantity",
            'quantityComplete', j."quantityComplete",
            'quantityShipped', j."quantityShipped",
            'quantity', j."quantity",
            'scrapQuantity', j."scrapQuantity",
            'salesOrderLineId', sol.id,
            'assignee', j."assignee"
          )
          ELSE NULL
        END
      ) FILTER (WHERE j.id IS NOT NULL) AS "jobs",
      ARRAY_AGG(
        json_build_object(
          'id', sol.id,
          'methodType', sol."methodType",
          'saleQuantity', sol."saleQuantity"
        )
      ) AS "lines"
    FROM "salesOrderLine" sol
    LEFT JOIN "item" i
      ON i."id" = sol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    LEFT JOIN "job" j ON j."salesOrderId" = sol."salesOrderId" AND j."salesOrderLineId" = sol."id"
    GROUP BY sol."salesOrderId"
  ) sl ON sl."salesOrderId" = s."id"
  LEFT JOIN "salesOrderShipment" ss ON ss."id" = s."id"
  LEFT JOIN "shippingTerm" st ON st."id" = ss."shippingTermId"
  LEFT JOIN "salesOrderPayment" sp ON sp."id" = s."id";

DROP VIEW IF EXISTS "purchaseOrders";
CREATE OR REPLACE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    pl."thumbnailPath",
    pl."itemType",
    pl."orderTotal" + pd."supplierShippingCost" * p."exchangeRate" AS "orderTotal",
    pd."shippingMethodId",
    pd."shippingTermId",
    pd."receiptRequestedDate",
    pd."receiptPromisedDate",
    pd."deliveryDate",
    pd."dropShipment",
    pp."paymentTermId",
    pd."locationId",
    pd."supplierShippingCost",
    pd."incoterm",
    pd."incotermLocation",
    u."fullName" AS "createdByFullName",
    u."email" AS "createdByEmail"
  FROM "purchaseOrder" p
  LEFT JOIN (
    SELECT
      pol."purchaseOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(COALESCE(pol."purchaseQuantity", 0)*(COALESCE(pol."unitPrice", 0)) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseOrderLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."purchaseOrderId"
  ) pl ON pl."purchaseOrderId" = p."id"
  LEFT JOIN "purchaseOrderDelivery" pd ON pd."id" = p."id"
  LEFT JOIN "shippingTerm" st ON st."id" = pd."shippingTermId"
  LEFT JOIN "purchaseOrderPayment" pp ON pp."id" = p."id"
  LEFT JOIN "user" u ON u."id" = p."createdBy";
