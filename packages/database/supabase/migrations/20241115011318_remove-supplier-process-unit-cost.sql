DROP VIEW "supplierProcesses";

ALTER TABLE "supplierProcess" DROP COLUMN "unitCost";

CREATE VIEW "supplierProcesses" WITH(SECURITY_INVOKER=true) AS
  SELECT
    sp.*,
    p.name as "processName"
  FROM "supplierProcess" sp
  INNER JOIN "process" p ON sp."processId" = p.id;