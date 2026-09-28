-- Project as a journal dimension. valueId on journalLineDimension is polymorphic
-- (points at project.id for this entity type). A newly-added enum value cannot be
-- consumed in the same transaction that adds it, so the group-level dimension row
-- backfill lives in a separate, later migration (accounting-projects).
ALTER TYPE "dimensionEntityType" ADD VALUE IF NOT EXISTS 'Project';
