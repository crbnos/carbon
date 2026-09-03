-- At most one Posted 'Opening Balance' journal per company, enforced atomically.
-- This closes the check-then-post race: the app guards by reading for an existing
-- Posted entry before posting, but concurrent browser/MCP requests could both
-- pass that check. The partial unique index makes the second flip-to-Posted fail
-- with a unique violation instead (the service rolls its Draft back and surfaces
-- the "already exists" message).
--
-- A reversed opening-balance entry has status='Reversed' (its reversing entry is
-- sourceType='Manual'), so it drops out of this partial index — a fresh set can
-- be posted after a reversal, which is the intended re-entry flow.
CREATE UNIQUE INDEX IF NOT EXISTS "journal_one_posted_opening_balance_per_company"
  ON "journal" ("companyId")
  WHERE "sourceType" = 'Opening Balance' AND "status" = 'Posted';
