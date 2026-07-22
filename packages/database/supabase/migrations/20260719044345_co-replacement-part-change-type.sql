-- Rename the 1:1-supersession change type; existing changeOrderAffectedItem rows
-- carry over (they all already write an affected → new itemSupersession, so the
-- relabel is semantically exact). Then re-introduce 'New Part' as the net-new
-- (no-predecessor, no-supersession) type.
--
-- Idempotent / retry-safe: the DO-block guard renames only while 'New Part' still
-- exists and 'Replacement Part' does not; ADD VALUE IF NOT EXISTS re-adds the
-- net-new label on a retry.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'changeOrderChangeType' AND e.enumlabel = 'New Part'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'changeOrderChangeType' AND e.enumlabel = 'Replacement Part'
  ) THEN
    ALTER TYPE "changeOrderChangeType" RENAME VALUE 'New Part' TO 'Replacement Part';
  END IF;
END $$;

ALTER TYPE "changeOrderChangeType" ADD VALUE IF NOT EXISTS 'New Part';
