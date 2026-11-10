-- One open Setup or Labor event per operator per operation. A double-tap, or
-- the same timer started from two devices, opened a second event and counted
-- the labor twice. Machine events are per operation and closed by
-- startMachineProductionEvent before it opens a new one, so they are not
-- covered here.

SET lock_timeout = '5s';

-- Close the duplicates this bug already left open, keeping the earliest. Each
-- later one ends at its own start, so it books no time. Events with no
-- employee are not duplicates under the index and are left alone.
UPDATE "productionEvent" pe
SET "endTime" = pe."startTime"
FROM (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY "jobOperationId", "type", "employeeId"
      ORDER BY "startTime", id
    ) AS rn
  FROM "productionEvent"
  WHERE "endTime" IS NULL
    AND "type" IN ('Setup', 'Labor')
    AND "employeeId" IS NOT NULL
) dup
WHERE pe.id = dup.id
  AND dup.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "productionEvent_one_open_per_operator_idx"
  ON "productionEvent" ("jobOperationId", "type", "employeeId")
  WHERE "endTime" IS NULL AND "type" IN ('Setup', 'Labor');

RESET lock_timeout;
