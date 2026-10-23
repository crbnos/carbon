-- Enum values for service jobs (.ai/specs/2026-10-22-service-jobs-and-returns.md).
-- A new enum value cannot be used in the transaction that adds it, so this migration
-- holds nothing else; the tables come in the next one.
--
-- 'Service Job Consumption': parts issued to a service job (copies 'Maintenance Consumption').
-- 'Service Job': the completion journal (copies 'Maintenance Event').
-- 'In Progress': an RMA that is fully received but still has unresolved lines.

ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Service Job Consumption';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Service Job Consumption';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Service Job';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Service Job';
ALTER TYPE "salesReturnOrderStatus" ADD VALUE IF NOT EXISTS 'In Progress' BEFORE 'Completed';
