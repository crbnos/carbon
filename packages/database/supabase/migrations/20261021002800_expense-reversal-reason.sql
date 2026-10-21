-- Why a service order's expense was reversed. The service order screens
-- reverse an expense with a reason, as a timesheet correction carries
-- "correctionReason". Set on a reversal entry ("reversalOfId") only.
ALTER TABLE "projectExpenseEntry" ADD COLUMN IF NOT EXISTS "reversalReason" TEXT;
