-- The Send Via picked when the quote was finalized: true for Email, false
-- for None. Winning the quote starts its order email choice from it.
ALTER TABLE "quote"
  ADD COLUMN IF NOT EXISTS "sendViaEmail" BOOLEAN NOT NULL DEFAULT true;
