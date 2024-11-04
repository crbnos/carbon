ALTER TABLE "salesOrder"
  DROP COLUMN IF EXISTS "notes",
  ADD COLUMN "externalNotes" JSON DEFAULT '{}',
  ADD COLUMN "internalNotes" JSON DEFAULT '{}';