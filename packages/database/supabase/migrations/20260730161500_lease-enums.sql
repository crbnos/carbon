-- Lease subledger (ASC 842 / IFRS 16) — enum value additions.
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as statements that
-- use the new value, so value additions to existing enums live in their own
-- migration (fixed-asset precedent: 20260524143826_fixed-asset-enums.sql).
-- Brand-new CREATE TYPE enums are fine within a transaction and live with the
-- tables in 20260730161600_lease-subledger.sql.

ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Lease';
