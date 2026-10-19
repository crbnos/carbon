-- A closed inspection lot keeps the gauge it was measured with.
--
-- `inspectionSamplingPlan.gaugeId` is ON DELETE SET NULL, and deleting a gauge
-- type cascades to its gauges, so deleting either one silently erased the gauge
-- from every Passed / Failed / Partial lot. That record is exactly what a
-- calibration recall reads ("which lots did gauge X measure?").
--
-- Refuse to delete a gauge recorded on a closed lot; a retired gauge is set
-- Inactive instead. Open lots keep SET NULL: their inspector simply picks again.
-- A gauge-type delete reaches this trigger through its cascade, so it is refused
-- the same way.
--
-- A company wipe (template apply / backup restore) sets
-- `app.sync_in_progress` or deletes the lot's plan rows before its gauges, so it
-- is never blocked.

CREATE OR REPLACE FUNCTION prevent_deleting_gauge_recorded_on_closed_inspection()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "inspectionSamplingPlan" p
    JOIN "inspection" i
      ON i."id" = p."inspectionId"
     AND i."companyId" = p."companyId"
    WHERE p."gaugeId" = OLD."id"
      AND p."companyId" = OLD."companyId"
      AND i."status" IN ('Passed', 'Failed', 'Partial')
  ) THEN
    RAISE EXCEPTION 'Gauge % was used on a closed inspection. Set it to Inactive instead of deleting it.',
      COALESCE(OLD."gaugeId", OLD."id")
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS "prevent_deleting_gauge_recorded_on_closed_inspection"
  ON "gauge";

CREATE TRIGGER "prevent_deleting_gauge_recorded_on_closed_inspection"
  BEFORE DELETE ON "gauge"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_deleting_gauge_recorded_on_closed_inspection();
