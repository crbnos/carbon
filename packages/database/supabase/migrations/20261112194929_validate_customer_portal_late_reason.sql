-- Validate existing rows with the lighter SHARE UPDATE EXCLUSIVE lock.
-- Kept separate from ADD ... NOT VALID because each migration is one transaction.
ALTER TABLE "salesOrderLine"
  VALIDATE CONSTRAINT "salesOrderLine_portalLateReason_check";
