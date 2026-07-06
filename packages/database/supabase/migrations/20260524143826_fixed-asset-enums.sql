-- Enum additions that must be committed before use in the next migration
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Depreciation';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Disposal';
ALTER TYPE "dimensionEntityType" ADD VALUE IF NOT EXISTS 'WorkCenter';
ALTER TYPE "dimensionEntityType" ADD VALUE IF NOT EXISTS 'Process';
