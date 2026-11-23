-- The MES finds a job's serial units by attribute on every traveler scan
-- (.in("attributes->>Job Make Method", ...)). The GIN index on "attributes"
-- cannot serve a ->> equality, so the read scanned every tracked entity of the
-- company. This partial expression index serves it, like
-- "trackedEntity_companyId_receiptLine_idx" (20261110041024_inspection-hold.sql).
--
-- Plain CREATE INDEX, as every other index migration in this repo: a migration
-- runs in a transaction, where CONCURRENTLY is not allowed. The build takes a
-- SHARE lock and blocks writes to "trackedEntity" while it runs.

CREATE INDEX IF NOT EXISTS "trackedEntity_companyId_jobMakeMethod_idx"
  ON "trackedEntity" ("companyId", ("attributes" ->> 'Job Make Method'))
  WHERE ("attributes" ->> 'Job Make Method') IS NOT NULL;
