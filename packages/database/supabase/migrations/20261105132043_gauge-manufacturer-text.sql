-- A gauge's manufacturer is often not who the company buys it from, so it is
-- plain text, not a supplier. Existing gauges keep the supplier's name.
ALTER TABLE "gauge" ADD COLUMN "manufacturer" TEXT;

UPDATE "gauge" g
SET "manufacturer" = s."name"
FROM "supplier" s
WHERE s."id" = g."supplierId"
  AND s."companyId" = g."companyId";

-- The view's g.* holds supplierId, and it has to pick up manufacturer.
DROP VIEW "gauges";

ALTER TABLE "gauge" DROP COLUMN "supplierId";

CREATE VIEW "gauges" WITH(SECURITY_INVOKER=true) AS
SELECT
  g.*,
  CASE
    WHEN g."gaugeStatus" = 'Inactive' THEN 'Out-of-Calibration'
    WHEN g."nextCalibrationDate" IS NOT NULL AND g."nextCalibrationDate" < CURRENT_DATE THEN 'Out-of-Calibration'
    ELSE g."gaugeCalibrationStatus"
  END as "gaugeCalibrationStatusWithDueDate"
FROM "gauge" g;

-- A saved filter on the dropped column would fail the Gauges list.
UPDATE "tableView"
SET
  "filters" = ARRAY(SELECT f FROM unnest("filters") f WHERE f NOT LIKE 'supplierId:%'),
  "columnOrder" = array_replace("columnOrder", 'supplierId', 'manufacturer'),
  "columnVisibility" = CASE
    WHEN "columnVisibility" ? 'supplierId' THEN
      ("columnVisibility" - 'supplierId')
        || jsonb_build_object('manufacturer', "columnVisibility"->'supplierId')
    ELSE "columnVisibility"
  END
WHERE "table" = 'gauge';
