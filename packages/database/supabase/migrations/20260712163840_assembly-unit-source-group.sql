-- Planner-detected groups (e.g. PCB detail swarms, plan.json groups with
-- id "swarm:<hostNodeId>") are materialized as assemblyUnit rows at step
-- generation so the Components tab shows them like authored units.
-- sourceGroupId carries the plan group id; NULL = user-authored.
-- The UNIQUE pair makes re-generation idempotent (upsert DO NOTHING);
-- NULLs are distinct, so authored rows are unaffected.
ALTER TABLE "assemblyUnit" ADD COLUMN "sourceGroupId" TEXT;

ALTER TABLE "assemblyUnit"
  ADD CONSTRAINT "assemblyUnit_modelUploadId_sourceGroupId_key"
  UNIQUE ("modelUploadId", "sourceGroupId");
