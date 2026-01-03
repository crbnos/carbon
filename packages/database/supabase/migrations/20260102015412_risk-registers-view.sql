DROP VIEW IF EXISTS "riskRegisters";
CREATE VIEW "riskRegisters" 
WITH (security_invoker = on)
AS
SELECT
  r.*,
  wc."name" as "workCenterName",
  wc."id" as "workCenterId"
FROM
  "riskRegister" r
LEFT JOIN "workCenter" wc ON r."sourceId" = wc."id"
