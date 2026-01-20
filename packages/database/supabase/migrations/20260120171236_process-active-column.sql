-- Add active column to process table for soft delete functionality
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;

-- Recreate the processes view to include the new active column
-- (PostgreSQL views with SELECT * don't auto-update when columns are added)
DROP VIEW IF EXISTS "processes";
CREATE OR REPLACE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    wcp."workCenters",
    sp."suppliers"
  FROM "process" p
  LEFT JOIN (
    SELECT
      "processId",
      array_agg("workCenterId"::text) as "workCenters"
    FROM "workCenterProcess" wcp
    INNER JOIN "workCenter" wc ON wcp."workCenterId" = wc.id
    GROUP BY "processId"
  ) wcp ON p.id = wcp."processId"
  LEFT JOIN (
    SELECT
      "processId",
      jsonb_agg(jsonb_build_object('id', sp."id", 'name', s.name)) as "suppliers"
    FROM "supplierProcess" sp
    INNER JOIN "supplier" s ON sp."supplierId" = s.id
    GROUP BY "processId"
  ) sp ON p.id = sp."processId";
