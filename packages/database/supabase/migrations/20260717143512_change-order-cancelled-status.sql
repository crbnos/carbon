-- Add a "Cancelled" terminal status to change orders so a CO can be closed
-- (abandoned before release) from any open stage and later reopened to Draft.
-- Mirrors the job lifecycle (Cancel -> Cancelled -> Reopen). Appended at the end
-- of the enum; ADD VALUE IF NOT EXISTS is idempotent across retries / DB resets.
ALTER TYPE "changeOrderStatus" ADD VALUE IF NOT EXISTS 'Cancelled';
