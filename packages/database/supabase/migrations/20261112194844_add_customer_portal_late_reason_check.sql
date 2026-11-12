-- Enforce new values immediately without scanning the existing sales order lines
-- while holding an ACCESS EXCLUSIVE lock. Validation follows in its own
-- migration, after this transaction releases the table lock.
SET lock_timeout = '5s';
DO $migration$
BEGIN
  -- A development database may have applied the earlier draft of the PR,
  -- which already added the validated constraint in a prior migration.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."salesOrderLine"'::regclass
      AND conname = 'salesOrderLine_portalLateReason_check'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE "salesOrderLine"
        ADD CONSTRAINT "salesOrderLine_portalLateReason_check"
          CHECK ("portalLateReason" IS NULL OR "portalLateReason" IN
            ('Production', 'Supplier', 'Export licence', 'Your change')) NOT VALID
    $sql$;
  END IF;
END
$migration$;
RESET lock_timeout;
