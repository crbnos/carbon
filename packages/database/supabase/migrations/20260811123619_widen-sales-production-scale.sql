-- Widen the sales, production, and master-data value columns still clamping
-- scale below the app's internal precision. Generated converted-price columns
-- that reference the retyped columns are dropped and re-added (bodies forked
-- verbatim from 20250204164256 / 20260321120000); dependent views are dropped
-- and recreated from their newest definitions.

DROP VIEW IF EXISTS "openSalesOrderLines";
DROP VIEW IF EXISTS "salesOrders";
DROP VIEW IF EXISTS "salesOrderLines";
DROP VIEW IF EXISTS "quotes";
DROP VIEW IF EXISTS "quoteLines";
DROP VIEW IF EXISTS "quoteLinePrices";
DROP VIEW IF EXISTS "salesRfqLines";
DROP VIEW IF EXISTS "jobs";
DROP VIEW IF EXISTS "openProductionOrders";
DROP VIEW IF EXISTS "openJobMaterialLines";
DROP VIEW IF EXISTS "jobMaterialWithMakeMethodId";
DROP VIEW IF EXISTS "jobOperationsWithMakeMethods";
DROP VIEW IF EXISTS "jobOperationsWithDependencies";
DROP VIEW IF EXISTS "quoteOperationsWithMakeMethods";
DROP VIEW IF EXISTS "workCenters";
DROP VIEW IF EXISTS "workCentersWithBlockingStatus";

-- salesOrderLine ------------------------------------------------------------

ALTER TABLE "salesOrderLine" DROP COLUMN IF EXISTS "convertedAddOnCost";
ALTER TABLE "salesOrderLine" DROP COLUMN IF EXISTS "convertedShippingCost";
ALTER TABLE "salesOrderLine" DROP COLUMN IF EXISTS "convertedUnitPrice";
ALTER TABLE "salesOrderLine" DROP COLUMN IF EXISTS "convertedNonTaxableAddOnCost";

ALTER TABLE "salesOrderLine"
  ALTER COLUMN "exchangeRate" TYPE NUMERIC;

ALTER TABLE "salesOrderLine"
  ADD COLUMN "convertedAddOnCost" NUMERIC GENERATED ALWAYS AS ("addOnCost" * "exchangeRate") STORED,
  ADD COLUMN "convertedShippingCost" NUMERIC GENERATED ALWAYS AS ("shippingCost" * "exchangeRate") STORED,
  ADD COLUMN "convertedUnitPrice" NUMERIC GENERATED ALWAYS AS ("unitPrice" * "exchangeRate") STORED,
  ADD COLUMN "convertedNonTaxableAddOnCost" NUMERIC GENERATED ALWAYS AS ("nonTaxableAddOnCost" * "exchangeRate") STORED;

-- quoteLinePrice ------------------------------------------------------------

ALTER TABLE "quoteLinePrice"
  DROP COLUMN IF EXISTS "convertedUnitPrice",
  DROP COLUMN IF EXISTS "convertedNetUnitPrice",
  DROP COLUMN IF EXISTS "convertedNetExtendedPrice",
  DROP COLUMN IF EXISTS "convertedShippingCost",
  DROP COLUMN IF EXISTS "netUnitPrice",
  DROP COLUMN IF EXISTS "netExtendedPrice";

ALTER TABLE "quoteLinePrice"
  ALTER COLUMN "exchangeRate" TYPE NUMERIC;

ALTER TABLE "quoteLinePrice"
  ADD COLUMN "convertedUnitPrice" NUMERIC GENERATED ALWAYS AS ("unitPrice" * "exchangeRate") STORED,
  ADD COLUMN "netUnitPrice" NUMERIC GENERATED ALWAYS AS ("unitPrice" * (1 - "discountPercent")) STORED,
  ADD COLUMN "netExtendedPrice" NUMERIC GENERATED ALWAYS AS ("unitPrice" * (1 - "discountPercent") * "quantity") STORED,
  ADD COLUMN "convertedNetUnitPrice" NUMERIC GENERATED ALWAYS AS ("unitPrice" * "exchangeRate" * (1 - "discountPercent")) STORED,
  ADD COLUMN "convertedNetExtendedPrice" NUMERIC GENERATED ALWAYS AS ("unitPrice" * "exchangeRate" * (1 - "discountPercent") * "quantity") STORED,
  ADD COLUMN "convertedShippingCost" NUMERIC GENERATED ALWAYS AS ("shippingCost" * "exchangeRate") STORED;

-- Headers, shipments, quantity ladders --------------------------------------

ALTER TABLE "salesOrder"
  ALTER COLUMN "exchangeRate" TYPE NUMERIC;

ALTER TABLE "quote"
  ALTER COLUMN "exchangeRate" TYPE NUMERIC;

ALTER TABLE "quoteShipment"
  ALTER COLUMN "shippingCost" TYPE NUMERIC;

ALTER TABLE "salesOrderShipment"
  ALTER COLUMN "shippingCost" TYPE NUMERIC;

ALTER TABLE "quoteLine"
  ALTER COLUMN "quantity" TYPE NUMERIC[] USING "quantity"::NUMERIC[];

ALTER TABLE "salesRfqLine"
  ALTER COLUMN "quantity" TYPE NUMERIC[] USING "quantity"::NUMERIC[];

ALTER TABLE "pricingRule"
  ALTER COLUMN "minQuantity" TYPE NUMERIC,
  ALTER COLUMN "maxQuantity" TYPE NUMERIC;

-- The deferrable UNIQUE on (override, quantity) survives a column retype;
-- Postgres rebuilds the backing index with the same attributes.
ALTER TABLE "customerItemPriceOverrideBreak"
  ALTER COLUMN "quantity" TYPE NUMERIC;

-- Production ----------------------------------------------------------------

ALTER TABLE "job" DROP COLUMN IF EXISTS "productionQuantity";

ALTER TABLE "job"
  ALTER COLUMN "quantity" TYPE NUMERIC,
  ALTER COLUMN "scrapQuantity" TYPE NUMERIC,
  ALTER COLUMN "quantityComplete" TYPE NUMERIC,
  ALTER COLUMN "quantityShipped" TYPE NUMERIC,
  ALTER COLUMN "quantityReceivedToInventory" TYPE NUMERIC;

ALTER TABLE "job"
  ADD COLUMN "productionQuantity" NUMERIC GENERATED ALWAYS AS ("quantity" + "scrapQuantity") STORED;

ALTER TABLE "jobMakeMethod"
  ALTER COLUMN "quantityPerParent" TYPE NUMERIC,
  ALTER COLUMN "itemScrapPercentage" TYPE NUMERIC;

ALTER TABLE "quoteMakeMethod"
  ALTER COLUMN "quantityPerParent" TYPE NUMERIC;

ALTER TABLE "jobMaterial"
  ALTER COLUMN "itemScrapPercentage" TYPE NUMERIC;

ALTER TABLE "jobOperation"
  ALTER COLUMN "operationQuantity" TYPE NUMERIC,
  ALTER COLUMN "quantityComplete" TYPE NUMERIC,
  ALTER COLUMN "quantityScrapped" TYPE NUMERIC,
  ALTER COLUMN "quantityReworked" TYPE NUMERIC,
  ALTER COLUMN "laborRate" TYPE NUMERIC,
  ALTER COLUMN "machineRate" TYPE NUMERIC,
  ALTER COLUMN "overheadRate" TYPE NUMERIC,
  ALTER COLUMN "operationMinimumCost" TYPE NUMERIC,
  ALTER COLUMN "operationUnitCost" TYPE NUMERIC;

ALTER TABLE "quoteOperation"
  ALTER COLUMN "laborRate" TYPE NUMERIC,
  ALTER COLUMN "machineRate" TYPE NUMERIC,
  ALTER COLUMN "overheadRate" TYPE NUMERIC,
  ALTER COLUMN "operationMinimumCost" TYPE NUMERIC,
  ALTER COLUMN "operationUnitCost" TYPE NUMERIC;

ALTER TABLE "workCenter"
  ALTER COLUMN "machineRate" TYPE NUMERIC,
  ALTER COLUMN "overheadRate" TYPE NUMERIC;

ALTER TABLE "rework"
  ALTER COLUMN "quantity" TYPE NUMERIC;

ALTER TABLE "pickingListLine" DROP COLUMN IF EXISTS "outstandingQuantity";

ALTER TABLE "pickingListLine"
  ALTER COLUMN "quantityToPick" TYPE NUMERIC,
  ALTER COLUMN "quantityPicked" TYPE NUMERIC;

ALTER TABLE "pickingListLine"
  ADD COLUMN "outstandingQuantity" NUMERIC GENERATED ALWAYS AS (CASE WHEN "quantityToPick" >= "quantityPicked" THEN "quantityToPick" - "quantityPicked" ELSE 0 END) STORED;

ALTER TABLE "pickingListLineTrackedEntity"
  ALTER COLUMN "quantity" TYPE NUMERIC,
  ALTER COLUMN "quantityPicked" TYPE NUMERIC;

ALTER TABLE "nonConformanceItemTrackedEntity"
  ALTER COLUMN "quantity" TYPE NUMERIC;

-- Rate-shaped multipliers (they scale quantities and money) ------------------

ALTER TABLE "itemReplenishment"
  ALTER COLUMN "scrapPercentage" TYPE NUMERIC;

ALTER TABLE "fixedAsset"
  ALTER COLUMN "taxResidualValuePercent" TYPE NUMERIC,
  ALTER COLUMN "bonusDepreciationPercent" TYPE NUMERIC;

ALTER TABLE "fixedAssetClass"
  ALTER COLUMN "taxResidualValuePercent" TYPE NUMERIC,
  ALTER COLUMN "bonusDepreciationPercent" TYPE NUMERIC;

ALTER TABLE "companySettings"
  ALTER COLUMN "assetTaxRate" TYPE NUMERIC;

-- Recreate views (each forked verbatim from its newest definition) ----------

-- Forked from 20260807011742_lateralize-order-list-views.sql
CREATE OR REPLACE VIEW "salesOrders" WITH (security_invoker = true) AS
 SELECT s.id,
    s."salesOrderId",
    s."revisionId",
    s.status,
    s."orderDate",
    s."currencyCode",
    s."customerId",
    s."customerLocationId",
    s."customerContactId",
    s."customerReference",
    s.assignee,
    s."companyId",
    s."closedAt",
    s."closedBy",
    s."customFields",
    s."createdAt",
    s."createdBy",
    s."updatedAt",
    s."updatedBy",
    s."locationId",
    s."exchangeRate",
    s."exchangeRateUpdatedAt",
    s."externalNotes",
    s."internalNotes",
    s."salesPersonId",
    s."sentCompleteDate",
    s."opportunityId",
    s."completedDate",
    s."customerEngineeringContactId",
        CASE
            WHEN (s.status <> ALL (ARRAY['Closed'::"salesOrderStatus", 'Cancelled'::"salesOrderStatus"])) AND (EXISTS ( SELECT 1
               FROM "salesOrderLine" sol
              WHERE sol."salesOrderId" = s.id AND sol."methodType" = 'Make to Order'::"methodType" AND COALESCE(( SELECT sum(j."quantityComplete") AS sum
                       FROM job j
                      WHERE j."salesOrderLineId" = sol.id AND j."salesOrderId" = sol."salesOrderId"), 0::numeric) < sol."saleQuantity")) THEN 'In Progress'::"salesOrderStatus"
            ELSE s.status
        END AS "displayStatus",
    sl."thumbnailPath",
    sl."itemType",
    sl."orderTotal" + COALESCE(ss."shippingCost", 0::numeric) AS "orderTotal",
    sl.jobs,
    sl.lines,
    st.name AS "shippingTermName",
    sp."paymentTermId",
    ss."shippingMethodId",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost",
    ss.incoterm,
    ss."incotermLocation",
    ( SELECT COALESCE(jsonb_object_agg(eim.integration,
                CASE
                    WHEN eim.metadata IS NOT NULL THEN eim.metadata
                    ELSE to_jsonb(eim."externalId")
                END) FILTER (WHERE eim."externalId" IS NOT NULL OR eim.metadata IS NOT NULL), '{}'::jsonb) AS "coalesce"
           FROM "externalIntegrationMapping" eim
          WHERE eim."entityType" = 'salesOrder'::text AND eim."entityId" = s.id) AS "externalId"
   FROM "salesOrder" s
     LEFT JOIN LATERAL ( SELECT
            min(
                CASE
                    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
                    ELSE i."thumbnailPath"
                END) AS "thumbnailPath",
            sum(DISTINCT (1::numeric + COALESCE(sol."taxPercent", 0::numeric)) * (COALESCE(sol."saleQuantity", 0::numeric) * COALESCE(sol."unitPrice", 0::numeric) + COALESCE(sol."shippingCost", 0::numeric) + COALESCE(sol."addOnCost", 0::numeric)) + COALESCE(sol."nonTaxableAddOnCost", 0::numeric)) AS "orderTotal",
            min(i.type) AS "itemType",
            array_agg(
                CASE
                    WHEN j.id IS NOT NULL THEN json_build_object('id', j.id, 'jobId', j."jobId", 'status', j.status, 'dueDate', j."dueDate", 'productionQuantity', j."productionQuantity", 'quantityComplete', j."quantityComplete", 'quantityShipped', j."quantityShipped", 'quantity', j.quantity, 'scrapQuantity', j."scrapQuantity", 'salesOrderLineId', sol.id, 'assignee', j.assignee)
                    ELSE NULL::json
                END ORDER BY sol.id, j.id) FILTER (WHERE j.id IS NOT NULL) AS jobs,
            array_agg(json_build_object('id', sol.id, 'methodType', sol."methodType", 'saleQuantity', sol."saleQuantity") ORDER BY sol.id) AS lines
           FROM "salesOrderLine" sol
             LEFT JOIN item i ON i.id = sol."itemId"
             LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
             LEFT JOIN job j ON j."salesOrderId" = sol."salesOrderId" AND j."salesOrderLineId" = sol.id
          WHERE sol."salesOrderId" = s.id) sl ON true
     LEFT JOIN "salesOrderShipment" ss ON ss.id = s.id
     LEFT JOIN "shippingTerm" st ON st.id = ss."shippingTermId"
     LEFT JOIN "salesOrderPayment" sp ON sp.id = s.id;

-- Forked from 20260726234512_drop-requires-inspection.sql
CREATE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
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
    so."salesOrderId" as "salesOrderReadableId",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
  LEFT JOIN "fixedAsset" fa ON fa.id = sl."assetId"
);

-- Forked from 20260710051147_mto-sales-lines-drive-demand.sql
CREATE VIEW "openSalesOrderLines" WITH (security_invoker=true) AS (
  SELECT
    sol."id",
    sol."salesOrderId",
    sol."itemId",
    sol."promisedDate",
    sol."methodType",
    sol."unitOfMeasureCode",
    CASE
      WHEN sol."methodType" = 'Make to Order' THEN GREATEST(
        sol."quantityToSend" - COALESCE((
          SELECT SUM(GREATEST(j."quantity" - j."quantityReceivedToInventory" - j."quantityShipped", 0))
          FROM "job" j
          WHERE j."salesOrderLineId" = sol."id"
            AND j."companyId" = sol."companyId"
            AND j."status" IN ('Planned', 'Ready', 'In Progress', 'Paused')
        ), 0),
        0
      )
      ELSE sol."quantityToSend"
    END AS "quantityToSend",
    sol."salesOrderLineType",
    sol."companyId",
    COALESCE(sol."locationId", so."locationId") AS "locationId",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime"
  FROM "salesOrderLine" sol
  INNER JOIN "salesOrder" so ON sol."salesOrderId" = so."id"
  INNER JOIN "item" i ON sol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE sol."salesOrderLineType" != 'Service'
    AND so."status" IN ('To Ship', 'To Ship and Invoice')
);

-- Forked from 20260209163250_revert-quote-lead-time.sql
CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT
  q.*,
  ql."thumbnailPath",
  ql."itemType",
  l."name" AS "locationName",
  ql."lines",
  ql."completedLines",
  qs."shippingCost"
  FROM "quote" q
  LEFT JOIN (
    SELECT
      "quoteId",
      COUNT("quoteLine"."id") FILTER (WHERE "quoteLine"."status" != 'No Quote') AS "lines",
      COUNT("quoteLine"."id") FILTER (WHERE "quoteLine"."status" = 'Complete') AS "completedLines",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      MIN(i."type") AS "itemType"
    FROM "quoteLine"
    INNER JOIN "item" i
      ON i."id" = "quoteLine"."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY "quoteId"
  ) ql ON ql."quoteId" = q.id
  LEFT JOIN "quoteShipment" qs ON qs."id" = q."id"
  LEFT JOIN "location" l
    ON l.id = q."locationId";

-- Forked from 20260513120000_line-item-sort-order.sql
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

-- Forked from 20260321143847_method-type-migration.sql
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

-- Forked from 20241021200602_thumbnails.sql
CREATE OR REPLACE VIEW "salesRfqLines" WITH(SECURITY_INVOKER=true) AS
  SELECT
    srl.*,
    mu.id AS "modelId",
    mu."autodeskUrn",
    mu."modelPath",
    mu.name AS "modelName",
    mu.size AS "modelSize",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END AS "thumbnailPath",
    i.name AS "itemName",
    i."defaultMethodType" AS "methodType",
    i."readableId" AS "itemReadableId",
    i.type AS "itemType"
  FROM "salesRfqLine" srl
  LEFT JOIN "item" i ON i.id = srl."itemId"
  LEFT JOIN "modelUpload" mu ON mu.id = srl."modelUploadId";

-- Forked from 20260417000300_storage-unit-recreate-dependents.sql
CREATE OR REPLACE VIEW "jobs" WITH(SECURITY_INVOKER=true) AS
WITH job_model AS (
  SELECT
    j.id AS job_id,
    j."companyId",
    COALESCE(j."modelUploadId", i."modelUploadId") AS model_upload_id
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id" AND j."companyId" = i."companyId"
)
SELECT
  j.*,
  jmm."id" as "jobMakeMethodId",
  i.name,
  i."readableIdWithRevision" as "itemReadableIdWithRevision",
  i.type as "itemType",
  i.name as "description",
  i."itemTrackingType",
  i.active,
  i."replenishmentSystem",
  mu.id as "modelId",
  mu."autodeskUrn",
  mu."modelPath",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  mu."name" as "modelName",
  mu."size" as "modelSize",
  so."salesOrderId" as "salesOrderReadableId",
  qo."quoteId" as "quoteReadableId"
FROM "job" j
LEFT JOIN "jobMakeMethod" jmm ON jmm."jobId" = j.id AND jmm."parentMaterialId" IS NULL
INNER JOIN "item" i ON j."itemId" = i."id" AND j."companyId" = i."companyId"
LEFT JOIN job_model jm ON j.id = jm.job_id AND j."companyId" = jm."companyId"
LEFT JOIN "modelUpload" mu ON mu.id = jm.model_upload_id
LEFT JOIN "salesOrder" so on j."salesOrderId" = so.id AND j."companyId" = so."companyId"
LEFT JOIN "quote" qo ON j."quoteId" = qo.id AND j."companyId" = qo."companyId";

-- Forked from 20260417000300_storage-unit-recreate-dependents.sql
CREATE OR REPLACE VIEW "openProductionOrders"
WITH (security_invoker = true)
AS (
  SELECT
    j."id",
    j."itemId",
    j."jobId",
    j."productionQuantity" - j."quantityReceivedToInventory" AS "quantityToReceive",
    j."unitOfMeasureCode",
    j."companyId",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate",
    j."deadlineType"
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND j."salesOrderId" IS NULL
);

-- Forked from 20260417000300_storage-unit-recreate-dependents.sql
CREATE OR REPLACE VIEW "openJobMaterialLines" AS (
  SELECT
    jm."id",
    jm."jobId",
    jmm."parentMaterialId",
    jm."jobMakeMethodId",
    j."jobId" as "jobReadableId",
    jm."itemId",
    jm."quantityToIssue",
    jm."unitOfMeasureCode",
    jm."companyId",
    i1."replenishmentSystem",
    i1."itemTrackingType",
    ir."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate"
  FROM "jobMaterial" jm
  INNER JOIN "job" j ON jm."jobId" = j."id"
  INNER JOIN "jobMakeMethod" jmm ON jm."jobMakeMethodId" = jmm."id"
  INNER JOIN "item" i1 ON jm."itemId" = i1."id"
  INNER JOIN "item" i2 ON j."itemId" = i2."id"
  INNER JOIN "itemReplenishment" ir ON i2."id" = ir."itemId"
  WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND jm."methodType" != 'Make to Order'
);

-- Forked from 20260417000300_storage-unit-recreate-dependents.sql
CREATE OR REPLACE VIEW "jobMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT
    jm.*,
    s."name" AS "storageUnitName",
    jmm."id" AS "jobMaterialMakeMethodId",
    jmm.version AS "version",
    i."readableIdWithRevision" as "itemReadableId",
    i."readableId" as "itemReadableIdWithoutRevision"
  FROM "jobMaterial" jm
  LEFT JOIN "jobMakeMethod" jmm
    ON jmm."parentMaterialId" = jm."id"
  LEFT JOIN "storageUnit" s ON s.id = jm."storageUnitId"
  INNER JOIN "item" i ON i.id = jm."itemId";

-- Forked from 20260721004140_operation-type-consolidation.sql
CREATE OR REPLACE VIEW "jobOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT
    mm.id AS "makeMethodId",
    jo.*
  FROM "jobOperation" jo
  INNER JOIN "jobMakeMethod" jmm
    ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "makeMethod" mm
    ON jmm."itemId" = mm."itemId" AND jmm."version" = mm."version";

-- Forked from 20260721004140_operation-type-consolidation.sql
CREATE OR REPLACE VIEW "jobOperationsWithDependencies"
WITH (security_invoker = true)
AS
SELECT
  jo.*,
  COALESCE(
    (
      SELECT array_agg(jod."dependsOnId")
      FROM "jobOperationDependency" jod
      WHERE jod."operationId" = jo.id
    ),
    '{}'::text[]
  ) AS "dependencies"
FROM "jobOperation" jo;

-- Forked from 20260721004140_operation-type-consolidation.sql
CREATE OR REPLACE VIEW "quoteOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT
    mm.id AS "makeMethodId",
    qo.*
  FROM "quoteOperation" qo
  INNER JOIN "quoteMakeMethod" qmm
    ON qo."quoteMakeMethodId" = qmm.id
  LEFT JOIN "makeMethod" mm
    ON qmm."itemId" = mm."itemId" AND qmm."version" = mm."version";

-- Forked from 20260524143827_fixed-assets.sql
CREATE OR REPLACE VIEW "workCenters" WITH(SECURITY_INVOKER=true) AS
  SELECT
     wc.*,
     l.name as "locationName",
     d.name as "departmentName",
     wcp.processes
  FROM "workCenter" wc
  LEFT JOIN "location" l
    ON wc."locationId" = l.id
  LEFT JOIN "department" d
    ON wc."departmentId" = d.id
  LEFT JOIN (
    SELECT
      "workCenterId",
      array_agg("processId"::text) as processes
    FROM "workCenterProcess" wcp
    INNER JOIN "process" p ON wcp."processId" = p.id
    GROUP BY "workCenterId"
  ) wcp ON wc.id = wcp."workCenterId";

-- Forked from 20260524143827_fixed-assets.sql
CREATE OR REPLACE VIEW "workCentersWithBlockingStatus" WITH (security_invoker = true) AS
SELECT
  wc.*,
  l.name AS "locationName",
  COALESCE(
    (SELECT COUNT(*) > 0
     FROM "maintenanceDispatch" md
     WHERE md."workCenterId" = wc.id
       AND md.status = 'In Progress'
       AND md."oeeImpact" IN ('Down', 'Planned')
    ), false
  ) AS "isBlocked",
  (
    SELECT md.id
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchId",
  (
    SELECT md."maintenanceDispatchId"
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchReadableId"
FROM "workCenter" wc
LEFT JOIN "location" l ON wc."locationId" = l.id;

-- RPCs whose RETURNS TABLE clamped scale on read (redeclared with bare
-- NUMERIC; bodies forked verbatim from their newest definitions) -------------

-- Forked from 20240927033740_job-operations-for-mes.sql
DROP FUNCTION IF EXISTS get_job_operations_by_work_center(TEXT, TEXT);
CREATE OR REPLACE FUNCTION get_job_operations_by_work_center(
  work_center_id TEXT,
  location_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC,
  "setupUnit" factor,
  "laborTime" NUMERIC,
  "laborUnit" factor,
  "machineTime" NUMERIC,
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "operationStatus" "jobOperationStatus",
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityScrapped" NUMERIC
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH relevant_jobs AS (
    SELECT *
    FROM "job"
    WHERE "locationId" = location_id
    AND ("status" = 'Ready' OR "status" = 'In Progress' OR "status" = 'Paused')
  )
  SELECT
    jo."id",
    jo."jobId",
    jo."order" AS "operationOrder",
    jo."processId",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."operationOrder" AS "operationOrderType",
    rj."jobId" AS "jobReadableId",
    rj."status" AS "jobStatus",
    rj."dueDate" AS "jobDueDate",
    rj."deadlineType" AS "jobDeadlineType",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    CASE
      WHEN rj."status" = 'Paused' THEN 'Paused'
      ELSE jo."status"
    END AS "operationStatus",
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped"
  FROM "jobOperation" jo
  JOIN relevant_jobs rj ON rj.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  WHERE jo."workCenterId" = work_center_id;
END;
$$ LANGUAGE plpgsql;

-- Forked from 20250828115039_portal-steps-use-process-name.sql. The clamped
-- return types truncated portal prices and quantities on read.
DROP FUNCTION IF EXISTS get_sales_order_lines_by_customer_id(TEXT);
CREATE OR REPLACE FUNCTION get_sales_order_lines_by_customer_id(customer_id TEXT)
RETURNS TABLE (
  "customerReference" TEXT,
  "salesOrderId" TEXT,
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
  "jobStatus" "jobStatus"
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    so."customerReference",
    so."salesOrderId",
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
    j."status" AS "jobStatus"
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
