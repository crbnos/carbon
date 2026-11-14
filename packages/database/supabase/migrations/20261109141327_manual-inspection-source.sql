-- A manual inspection: one a person creates for specific tracked entities,
-- not one a receipt or a job operation made.
--
-- The enum addition lives alone: ADD VALUE cannot be used in the same
-- transaction that adds it.
ALTER TYPE "inspectionSourceDocument" ADD VALUE IF NOT EXISTS 'Manual';
