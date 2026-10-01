-- Sales-type lease journals (commencement, end of term) post under their own
-- source type. Enum additions live alone: ADD VALUE cannot be used in the same
-- transaction as the value.
-- Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §4
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Lease';
