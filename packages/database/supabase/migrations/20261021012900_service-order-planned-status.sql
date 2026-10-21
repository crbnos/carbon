-- A service order is Planned once its parts and work are released: Draft →
-- Planned → Scheduled → In Progress. A Draft order's Service project is Draft,
-- so its plan-line materials are not MRP demand. The backfill and the views
-- that read the new value are in the next migration: a new enum value cannot
-- be used in the transaction that adds it.
-- Plan: .ai/plans/2026-10-15-project-service-parts-mrp.md

ALTER TYPE "serviceOrderStatus" ADD VALUE IF NOT EXISTS 'Planned' BEFORE 'Scheduled';
