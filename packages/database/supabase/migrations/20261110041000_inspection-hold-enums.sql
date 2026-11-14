-- Goods-in inspection hold (spec .ai/specs/2026-11-03-goods-in-inspection-hold.md).
-- Enum values go in their own migration: a new value cannot be used in the
-- transaction that adds it.
ALTER TYPE "inspectionStatusType" ADD VALUE IF NOT EXISTS 'Cancelled';

DO $$ BEGIN
  CREATE TYPE "receiptInspectionStatus" AS ENUM (
    'Not Required',
    'Pending Inspection',
    'Inspection In Progress',
    'Inspection Passed',
    'Inspection Failed',
    'Partially Passed',
    'Put Away'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
