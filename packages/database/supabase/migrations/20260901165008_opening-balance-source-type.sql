-- Opening Balances tool posts a manual-style GL entry tagged with this source
-- type. ADD VALUE only; no column/usage change. Idempotent for the retrying
-- deploy runner. Postgres disallows using a newly-added enum value later in the
-- same transaction, but this migration only adds it, so it is fine.
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Opening Balance';
