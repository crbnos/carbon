CREATE OR REPLACE VIEW "activeMakeMethods" 
WITH (security_invoker = true)
AS
WITH ranked_make_methods AS (
  SELECT 
    *,
    ROW_NUMBER() OVER (PARTITION BY "itemId" ORDER BY 
      CASE 
        WHEN "status" = 'Active' THEN 1
        ELSE 2
      END,
      "version" DESC
    ) as rn
  FROM "makeMethod"
  WHERE "status" != 'Archived'
)
SELECT * FROM ranked_make_methods WHERE rn = 1;

ALTER TABLE "employeeTypePermission" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "fulfillment" ENABLE ROW LEVEL SECURITY;

DROP VIEW IF EXISTS "jobOperationsWithDependencies";
CREATE VIEW "jobOperationsWithDependencies" 
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



-- add parentMaterialId, jobMakeMethodId, and jobReadableId to openJobMaterialLines
DROP VIEW IF EXISTS "openJobMaterialLines";
CREATE OR REPLACE VIEW "openJobMaterialLines" 
WITH (security_invoker = true)
AS (
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
  AND jm."methodType" != 'Make'
);


DROP VIEW IF EXISTS "openProductionOrders";
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


ALTER TABLE "purchaseInvoiceDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salesInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salesInvoiceLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salesInvoiceShipment" ENABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS "task";

ALTER TABLE "nonConformance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceActionTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceApprovalTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceCustomer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceInvestigationTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceJobOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformancePurchaseOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceReceiptLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceReviewer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceSalesOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceShipmentLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceSupplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceTrackedEntity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceWorkflow" ENABLE ROW LEVEL SECURITY;
