-- The Sync Activity CSV export pages an integration's whole history newest
-- first with a (createdAt, id) keyset. Without this index every page sorts
-- the tenant's entire history; with it each page is an index range scan.
CREATE INDEX IF NOT EXISTS "accountingSyncOperation_createdAt_idx"
  ON "accountingSyncOperation" ("companyId", "integration", "createdAt" DESC, "id");
