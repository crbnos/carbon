-- A journal written before the company's accounting cutover counts nowhere
-- (Provisional). At the cutover, Provisional journals dated before the
-- cutover date become Superseded. See .ai/specs/2026-10-08-accounting-cutover.md.
ALTER TYPE "journalEntryStatus" ADD VALUE IF NOT EXISTS 'Provisional';
ALTER TYPE "journalEntryStatus" ADD VALUE IF NOT EXISTS 'Superseded';
