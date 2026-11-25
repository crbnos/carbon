-- The serials covered by a job-operation lot's acceptance, including WIP
-- that cannot post until Quality releases it. NULL predates the snapshot.
ALTER TABLE "inspection" ADD COLUMN IF NOT EXISTS "acceptedUnitIds" text[];
