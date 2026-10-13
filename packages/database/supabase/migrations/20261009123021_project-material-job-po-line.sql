-- Projects Phase 1b: a plan-line material remembers the job or purchase order line
-- created from it (Create Job, Create PO line). The spec named both columns; the
-- Phase 1a migration left them out.
-- Spec: .ai/specs/2026-10-03-projects.md (Plan, budget, actuals)

ALTER TABLE "projectElementMaterial"
  ADD COLUMN IF NOT EXISTS "jobId" TEXT REFERENCES "job"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "purchaseOrderLineId" TEXT REFERENCES "purchaseOrderLine"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "projectElementMaterial_jobId_idx" ON "projectElementMaterial" ("jobId");
CREATE INDEX IF NOT EXISTS "projectElementMaterial_purchaseOrderLineId_idx" ON "projectElementMaterial" ("purchaseOrderLineId");
