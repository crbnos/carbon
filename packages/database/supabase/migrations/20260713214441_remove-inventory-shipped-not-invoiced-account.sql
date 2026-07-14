-- Remove the "Inventory Shipped Not Invoiced" default account entirely.
--
-- It was seeded as a liability (2130) while the Account Defaults form filters
-- the field to assets, so it always rendered blank — and no posting code has
-- ever written to it (post-shipment posts COGS / inventory directly). Dead
-- config: drop the accountDefault column and delete the seeded account
-- wherever it has no journal history. Accounts that DO have journal lines or
-- are referenced by other custom config are left in the chart untouched —
-- admins can remove those themselves.
--
-- The name match covers both shapes in the wild: the original 2130 liability
-- and the short-lived 1250 asset reclass that only ever ran on dev branches.

-- ============================================================
-- Step 1: Drop the accountDefault column (config-only, no readers)
-- ============================================================

ALTER TABLE "accountDefault"
  DROP CONSTRAINT IF EXISTS "accountDefault_inventoryShippedNotInvoicedAccount_fkey";
ALTER TABLE "accountDefault"
  DROP COLUMN IF EXISTS "inventoryShippedNotInvoicedAccount";

-- ============================================================
-- Step 2: Delete the seeded account where it is unused
-- ============================================================
-- Deleting a chart-of-accounts row makes Postgres enforce every FK that
-- references "account" (~40 of them, several via ("number","companyId") into
-- salesOrderLine / salesInvoiceLine / purchaseInvoiceLines / journalLine). During
-- a live deploy that delete can block on a lock held by the running app, and the
-- ambient statement_timeout then cancels the whole DO block (SQLSTATE 57014) —
-- which is what happened here (prod data is small, so scan cost is not the cause).
--
-- Fix: lift statement_timeout so the cleanup isn't cancelled, but cap lock waits
-- (lock_timeout) so a held lock bails fast instead of hanging the deploy; a row we
-- can't take cleanly is simply left in the chart. (statement_timeout must be set as
-- a separate top-level statement BEFORE the DO block — the timer is armed when a
-- statement starts, so SET *inside* the block is too late to disarm it.)
--
-- Guarded per row: skip accounts with journal history, and swallow ANY error
-- (a RESTRICT FK, the posted-journal immutability trigger on a stray SET NULL
-- cascade into "journalLine", or a lock_timeout) so one stuck account never aborts
-- the batch — those rows simply stay in the chart for an admin to remove.
--
-- Re-runnable: Step 1 above uses IF EXISTS and this block re-selects live rows,
-- so re-executing the whole file after a mid-file failure is a no-op.

SET statement_timeout = 0;
SET lock_timeout = '15s';

DO $$
DECLARE
  v_account RECORD;
BEGIN
  FOR v_account IN
    SELECT a."id"
    FROM "account" a
    WHERE a."name" = 'Inventory Shipped Not Invoiced'
      AND a."isGroup" = false
      AND NOT EXISTS (
        SELECT 1 FROM "journalLine" jl WHERE jl."accountId" = a."id"
      )
  LOOP
    BEGIN
      DELETE FROM "account" WHERE "id" = v_account."id";
    EXCEPTION WHEN OTHERS THEN
      -- still referenced (RESTRICT FK) or blocked by a trigger — leave it in the chart
      NULL;
    END;
  END LOOP;
END $$;

SET lock_timeout = DEFAULT;
SET statement_timeout = DEFAULT;
