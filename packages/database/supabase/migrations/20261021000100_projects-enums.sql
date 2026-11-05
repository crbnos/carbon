-- Enums for Projects Phase 1a.
-- Enum additions live alone: ADD VALUE cannot be used in the same transaction as the value.
-- Spec: .ai/specs/2026-10-03-projects.md

ALTER TYPE "module" ADD VALUE IF NOT EXISTS 'Projects';
ALTER TYPE "dimensionEntityType" ADD VALUE IF NOT EXISTS 'ProjectElement';
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Project Issue';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Project Issue';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Timesheet';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Project Issue';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Timesheet';
