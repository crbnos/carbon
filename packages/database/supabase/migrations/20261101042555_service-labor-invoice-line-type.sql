-- A Labor sales invoice line: service job labor billed as hours × the job's
-- bill rate, with no item.
-- Enum additions live alone: ADD VALUE cannot be used in the same transaction
-- as the value. The next migration and the code use it.
-- Spec: .ai/specs/2026-10-31-service-labor-rates-and-time-posting.md

ALTER TYPE "salesInvoiceLineType" ADD VALUE IF NOT EXISTS 'Labor';
