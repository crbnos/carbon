-- Posting-sync dispositions (spec: .ai/specs/2026-08-02-accounting-sync-engine-v3.md):
-- 'Excluded' is the terminal status for journals the posting policy decides not to push
-- (doc-backed, family off, source type disabled). Distinct from 'Skipped' (human opt-out).
ALTER TYPE "syncOperationStatus" ADD VALUE IF NOT EXISTS 'Excluded';
