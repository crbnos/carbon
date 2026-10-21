-- A training's content can be one PDF, and a completion can carry the
-- certificate an admin attached.
ALTER TABLE "training"
  ADD COLUMN IF NOT EXISTS "guidePath" TEXT;

ALTER TABLE "trainingCompletion"
  ADD COLUMN IF NOT EXISTS "certificatePath" TEXT;
