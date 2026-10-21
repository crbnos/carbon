-- Field Service Phase C: the journal of a refurbishment completion.
-- Spec: .ai/specs/2026-10-08-field-service.md (Accounting → Refurbishment completion).
-- Enum additions live alone: a new enum value cannot be used in the transaction that adds it.

ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Service Order';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Service Order';
