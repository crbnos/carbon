-- Assembly instruction versioning: group sibling versions under an explicit
-- self-referential root pointer. NULL means "I am the root"; a version's group
-- root is COALESCE("rootInstructionId", "id"), and its siblings are the rows
-- whose id = root OR whose "rootInstructionId" = root. Existing instructions
-- stay NULL (each becomes a single-version group) -- no backfill required.

ALTER TABLE "assemblyInstruction"
  ADD COLUMN IF NOT EXISTS "rootInstructionId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assemblyInstruction_rootInstructionId_fkey'
  ) THEN
    ALTER TABLE "assemblyInstruction"
      ADD CONSTRAINT "assemblyInstruction_rootInstructionId_fkey"
        FOREIGN KEY ("rootInstructionId")
        REFERENCES "assemblyInstruction"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "assemblyInstruction_rootInstructionId_idx"
  ON "assemblyInstruction"("rootInstructionId");
