-- Update jobs with releasedDate based on first productionEvent startTime
WITH first_production_events AS (
  SELECT 
    jo."jobId",
    MIN(pe."startTime") as "firstStartTime"
  FROM "productionEvent" pe
  JOIN "jobOperation" jo ON pe."jobOperationId" = jo."id" 
  GROUP BY jo."jobId"
)
UPDATE job
SET "releasedDate" = COALESCE(fpe."firstStartTime", NOW())
FROM first_production_events fpe
WHERE 
  job."id" = fpe."jobId"
  AND job."status" != 'Draft'
  AND job."releasedDate" IS NULL;


UPDATE job
SET "releasedDate" = NOW()
WHERE "status" != 'Draft'
  AND "releasedDate" IS NULL;

-- Update jobs with completedDate based on last productionEvent endTime
WITH last_production_events AS (
  SELECT 
    jo."jobId",
    MAX(pe."endTime") as "lastEndTime"
  FROM "productionEvent" pe
  JOIN "jobOperation" jo ON pe."jobOperationId" = jo."id" 
  GROUP BY jo."jobId"
)
UPDATE job
SET "completedDate" = COALESCE(lpe."lastEndTime", NOW())
FROM last_production_events lpe
WHERE 
  job."id" = lpe."jobId"
  AND job."status" = 'Completed'
  AND job."completedDate" IS NULL;

UPDATE job
SET "completedDate" = NOW()
WHERE "status" = 'Completed'
  AND "completedDate" IS NULL;
