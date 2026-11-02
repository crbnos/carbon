-- What MES does when an operator works on an operation whose process requires
-- an ability they do not hold (no employeeAbility row, or an expired one).
-- 'Warn' shows a banner and lets them work; 'Block' refuses all production
-- work on the operation. Only read while "requiresAbility" is on.
DO $$ BEGIN
  CREATE TYPE "processAbilityPolicy" AS ENUM ('Warn', 'Block');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "process"
  ADD COLUMN IF NOT EXISTS "abilityPolicy" "processAbilityPolicy" NOT NULL DEFAULT 'Warn';

-- Re-declare the processes view so p.* picks up the new column (it lands
-- before the joined columns, so CREATE OR REPLACE cannot add it).
DROP VIEW IF EXISTS "processes";
CREATE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
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
