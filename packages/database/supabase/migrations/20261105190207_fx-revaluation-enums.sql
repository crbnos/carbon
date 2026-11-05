-- Enum additions live alone: ADD VALUE cannot be used in the same transaction as the value.
-- Spec: .ai/specs/2026-10-26-fx-revaluation-and-cta-posting.md
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Currency Revaluation';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Currency Translation';
