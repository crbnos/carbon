-- A process can require an ability. The ability is linked 1:1 to the process
-- (created automatically when "requiresAbility" is toggled on) and employee
-- qualification stays in "employeeAbility" — effectively a map of the
-- processes each person can do.
ALTER TABLE "process" ADD COLUMN "requiresAbility" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ability" ADD COLUMN "processId" TEXT REFERENCES "process"("id") ON DELETE SET NULL;
CREATE INDEX "ability_processId_idx" ON "ability" ("processId");
-- One ability per process per company
CREATE UNIQUE INDEX "ability_processId_companyId_key" ON "ability" ("processId", "companyId")
  WHERE "processId" IS NOT NULL;

-- Eligibility columns: qualification can expire (recertification)
ALTER TABLE "employeeAbility" ADD COLUMN "expiresAt" DATE;
ALTER TABLE "ability" ADD COLUMN "recertifyEveryDays" INTEGER;

-- Surface "requiresAbility" through the processes view (frozen column list)
DROP VIEW IF EXISTS "processes";
CREATE OR REPLACE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.id,
    p.name,
    p."defaultStandardFactor",
    p."companyId",
    p."customFields",
    p."createdBy",
    p."createdAt",
    p."updatedBy",
    p."updatedAt",
    p."processType",
    p.tags,
    p."completeAllOnScan",
    p.active,
    p."requiresAbility",
    wcp."workCenters",
    sp.suppliers
  FROM "process" p
  LEFT JOIN (
    SELECT
      wcp_1."processId",
      array_agg(wcp_1."workCenterId") AS "workCenters"
    FROM "workCenterProcess" wcp_1
      JOIN "workCenter" wc ON wcp_1."workCenterId" = wc.id
    GROUP BY wcp_1."processId"
  ) wcp ON p.id = wcp."processId"
  LEFT JOIN (
    SELECT
      sp_1."processId",
      jsonb_agg(jsonb_build_object('id', sp_1.id, 'name', s.name)) AS suppliers
    FROM "supplierProcess" sp_1
      JOIN "supplier" s ON sp_1."supplierId" = s.id
    GROUP BY sp_1."processId"
  ) sp ON p.id = sp."processId";
