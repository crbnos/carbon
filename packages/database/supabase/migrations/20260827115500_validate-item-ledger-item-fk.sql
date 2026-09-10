-- ============================================================================
-- Migration: validate-item-ledger-item-fk
--
-- Follow-up to 20260827112750_prevent-item-delete-with-inventory, which recreated
-- "itemLedger_itemId_fkey" (CASCADE -> NO ACTION) as NOT VALID. That constraint
-- already enforces ON DELETE NO ACTION and checks every new/changed row; this
-- migration validates the pre-existing rows.
--
-- Kept in its OWN migration on purpose. The Supabase CLI runs each migration
-- file in a single transaction, so the ADD ... NOT VALID above holds a
-- write-blocking ShareRowExclusive lock on itemLedger until that file commits.
-- Running VALIDATE in a separate transaction lets its full-table scan take the
-- lighter ShareUpdateExclusive lock instead, which does not block reads or
-- writes -- the point of adding the constraint NOT VALID in the first place.
-- Same deploy, separate transactions: the CLI commits each file before the next.
--
-- Every itemLedger row already references a live item -- the constraint it
-- replaced was ON DELETE CASCADE, so orphaned ledger rows were structurally
-- impossible -- so this VALIDATE is expected to pass without touching any row.
-- (costLedger's FK is deliberately left NOT VALID: past deletions left orphan
-- cost rows, so validating it would fail; it is not validated here.)
-- ============================================================================

ALTER TABLE "itemLedger"
  VALIDATE CONSTRAINT "itemLedger_itemId_fkey";
