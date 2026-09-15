-- Fixed-assets completeness (issue #1041) — enum additions.
--
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as statements that
-- USE the new value, so all new enum values go in this dedicated, strictly-earlier
-- migration (mirrors the 20260524143826_fixed-asset-enums.sql precedent). The main
-- 20260721143208_fixed-asset-completeness.sql migration consumes them.

-- CIP assets sit in a non-depreciating "Under Construction" state until capitalized.
ALTER TYPE "fixedAssetStatus" ADD VALUE IF NOT EXISTS 'Under Construction';

-- New posting source types for the impairment and transfer/capitalization journals.
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Impairment';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Transfer';
