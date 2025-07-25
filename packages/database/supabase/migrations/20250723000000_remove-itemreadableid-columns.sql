DROP VIEW IF EXISTS "jobMaterialWithMakeMethodId";
DROP VIEW IF EXISTS "purchaseInvoiceLines";
DROP VIEW IF EXISTS "purchaseOrderLines";
DROP VIEW IF EXISTS "quoteLines";
DROP VIEW IF EXISTS "quoteLinePrices";
DROP VIEW IF EXISTS "quoteMaterialWithMakeMethodId";
DROP VIEW IF EXISTS "receiptLines";
DROP VIEW IF EXISTS "salesInvoices";
DROP VIEW IF EXISTS "salesInvoiceLines";
DROP VIEW IF EXISTS "salesOrderLines";
DROP VIEW IF EXISTS "shipmentLines";
DROP VIEW IF EXISTS "supplierQuoteLines";


-- Remove stored itemReadableId columns from all tables
-- These will be replaced with lookups from the item table or calculated fields in views

-- costLedger
ALTER TABLE "costLedger" DROP COLUMN IF EXISTS "itemReadableId";

-- itemLedger  
ALTER TABLE "itemLedger" DROP COLUMN IF EXISTS "itemReadableId";

-- jobMaterial
ALTER TABLE "jobMaterial" DROP COLUMN IF EXISTS "itemReadableId";

-- methodMaterial
ALTER TABLE "methodMaterial" DROP COLUMN IF EXISTS "itemReadableId";

-- purchaseInvoiceLine
ALTER TABLE "purchaseInvoiceLine" DROP COLUMN IF EXISTS "itemReadableId";

-- purchaseOrderLine
ALTER TABLE "purchaseOrderLine" DROP COLUMN IF EXISTS "itemReadableId";

-- quoteLine
ALTER TABLE "quoteLine" DROP COLUMN IF EXISTS "itemReadableId";

-- quoteMaterial
ALTER TABLE "quoteMaterial" DROP COLUMN IF EXISTS "itemReadableId";

-- receiptLine
ALTER TABLE "receiptLine" DROP COLUMN IF EXISTS "itemReadableId";

-- salesInvoiceLine
ALTER TABLE "salesInvoiceLine" DROP COLUMN IF EXISTS "itemReadableId";

-- salesOrderLine
ALTER TABLE "salesOrderLine" DROP COLUMN IF EXISTS "itemReadableId";

-- shipmentLine
ALTER TABLE "shipmentLine" DROP COLUMN IF EXISTS "itemReadableId";

-- supplierQuoteLine
ALTER TABLE "supplierQuoteLine" DROP COLUMN IF EXISTS "itemReadableId";

DROP VIEW IF EXISTS "jobMaterialWithMakeMethodId";
CREATE OR REPLACE VIEW "jobMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    jm.*, 
    jmm."id" AS "jobMaterialMakeMethodId",
    jmm.version AS "version",
    i."readableIdWithRevision" as "itemReadableId"
  FROM "jobMaterial" jm 
  LEFT JOIN "jobMakeMethod" jmm 
    ON jmm."parentMaterialId" = jm."id"
  INNER JOIN "item" i ON i.id = jm."itemId";

DROP VIEW IF EXISTS "purchaseInvoiceLines";
CREATE OR REPLACE VIEW "purchaseInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i."readableIdWithRevision" as "itemReadableId",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    sp."supplierPartId"
  FROM "purchaseInvoiceLine" pl
  INNER JOIN "purchaseInvoice" pi ON pi.id = pl."invoiceId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = pi."supplierId" AND sp."itemId" = i.id
);

DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT DISTINCT ON (pl.id)
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i."readableIdWithRevision" as "itemReadableId",
    i.description as "itemDescription",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    sp."supplierPartId"
  FROM "purchaseOrderLine" pl
  INNER JOIN "purchaseOrder" so ON so.id = pl."purchaseOrderId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id
);

DROP VIEW IF EXISTS "quoteLines";
CREATE OR REPLACE VIEW "quoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost"
  FROM "quoteLine" ql
  LEFT JOIN "modelUpload" mu ON ql."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);

DROP VIEW IF EXISTS "quoteLinePrices";
CREATE OR REPLACE VIEW "quoteLinePrices" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    qlp."quantity" as "qty",
    qlp."unitPrice",
    CASE
      WHEN q."revisionId" > 0 THEN q."quoteId" || '-' || q."revisionId"::text
      ELSE q."quoteId"
    END as "quoteReadableId",
    q."createdAt" as "quoteCreatedAt",
    q."customerId"
  FROM "quoteLine" ql
  INNER JOIN "quote" q ON q.id = ql."quoteId"
  LEFT JOIN "modelUpload" mu ON ql."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "quoteLinePrice" qlp ON qlp."quoteLineId" = ql.id
);

DROP VIEW IF EXISTS "quoteMaterialWithMakeMethodId";
CREATE OR REPLACE VIEW "quoteMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    qm.*, 
    qmm."id" AS "quoteMaterialMakeMethodId",
    qmm.version AS "version"
  FROM "quoteMaterial" qm 
  LEFT JOIN "quoteMakeMethod" qmm 
    ON qmm."parentMaterialId" = qm."id";

DROP VIEW IF EXISTS "receiptLines";
CREATE OR REPLACE VIEW "receiptLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    rl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."name" as "description"
  FROM "receiptLine" rl
  INNER JOIN "item" i ON i."id" = rl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId";


DROP VIEW IF EXISTS "salesInvoices";
CREATE OR REPLACE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  SELECT
    si.*,
    sil."thumbnailPath",
    sil."itemType", 
    sil."invoiceTotal" + COALESCE(ss."shippingCost", 0) AS "invoiceTotal",
    sil."lines"
  FROM "salesInvoice" si
  LEFT JOIN (
    SELECT 
      sil."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        DISTINCT (1+COALESCE(sil."taxPercent", 0))*(COALESCE(sil."quantity", 0)*(COALESCE(sil."unitPrice", 0)) + COALESCE(sil."shippingCost", 0) + COALESCE(sil."addOnCost", 0))
      ) AS "invoiceTotal",
      SUM(COALESCE(sil."shippingCost", 0)) AS "shippingCost",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        json_build_object(
          'id', sil.id,
          'invoiceLineType', sil."invoiceLineType",
          'quantity', sil."quantity",
          'unitPrice', sil."unitPrice",
          'itemId', sil."itemId"
        )
      ) AS "lines"
    FROM "salesInvoiceLine" sil
    LEFT JOIN "item" i
      ON i."id" = sil."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY sil."invoiceId"
  ) sil ON sil."invoiceId" = si."id" 
  JOIN "salesInvoiceShipment" ss ON ss."id" = si."id";


DROP VIEW IF EXISTS "salesInvoiceLines";
CREATE OR REPLACE VIEW "salesInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    (SELECT cp."customerPartId" 
     FROM "customerPartToItem" cp 
     WHERE cp."customerId" = si."customerId" AND cp."itemId" = i.id 
     LIMIT 1) as "customerPartId"
  FROM "salesInvoiceLine" sl
  INNER JOIN "salesInvoice" si ON si.id = sl."invoiceId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);


DROP VIEW IF EXISTS "salesOrderLines";
CREATE OR REPLACE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    cp."customerPartId",
    cp."customerPartRevision",
    so."orderDate",
    so."customerId",
    so."salesOrderId" as "salesOrderReadableId"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
);


DROP VIEW IF EXISTS "shipmentLines";
CREATE OR REPLACE VIEW "shipmentLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i."name" as "description"
  FROM "shipmentLine" sl
  INNER JOIN "item" i ON i."id" = sl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId";

DROP VIEW IF EXISTS "supplierQuoteLines";
CREATE OR REPLACE VIEW "supplierQuoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    i."readableIdWithRevision" as "itemReadableId",
    i."type" as "itemType",
    COALESCE(i."thumbnailPath", mu."thumbnailPath") as "thumbnailPath",
    ic."unitCost" as "unitCost"
  FROM "supplierQuoteLine" ql
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
);