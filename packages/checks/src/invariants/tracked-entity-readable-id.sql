-- invariant: every tracked entity has a readableId, once it exists as stock.
-- A Reserved entity is the unit a job will build: the jobMakeMethod interceptor
-- inserts it unnamed, and its serial or batch number comes when it is made.
-- returns rows that VIOLATE the rule (none = healthy)
SELECT "id", "companyId"
FROM "trackedEntity"
WHERE "readableId" IS NULL
  AND "status" <> 'Reserved';
