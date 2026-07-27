-- Make inspection-reject and NCR-disposition write-offs first-class GL entries.
-- itemLedgerDocumentType already carries 'Non-Conformance' + 'Inbound Inspection';
-- add the matching journal source type and journal-line document type so the
-- posted journal is traceable to its origin (mirrors 'Asset Disposal' /
-- 'Asset Depreciation' on journalEntrySourceType). ADD VALUE only — no usage in
-- this migration, so it is transaction-safe.

ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Non-Conformance';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Inbound Inspection';

ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Non-Conformance';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Inbound Inspection';
