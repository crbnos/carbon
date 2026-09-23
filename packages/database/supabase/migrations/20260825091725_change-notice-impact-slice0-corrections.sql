-- Slice 0 correction pass.
--
-- This forward migration repairs the already-applied local database while the
-- earlier unshipped migrations are also corrected so a fresh chain never opens
-- a direct Impact business-write window.

-- No Action requires one of the structured reasons. PostgreSQL CHECK expressions
-- otherwise accept NULL as UNKNOWN.
ALTER TABLE "public"."changeOrderImpactDecision"
  DROP CONSTRAINT "changeOrderImpactDecision_noActionReasonCode_check";
ALTER TABLE "public"."changeOrderImpactDecision"
  ADD CONSTRAINT "changeOrderImpactDecision_noActionReasonCode_check"
  CHECK (
    (
      "decisionStatus" = 'No action required'
      AND "noActionReasonCode" IS NOT NULL
      AND "noActionReasonCode" IN (
        'Outside effectivity',
        'Not affected after review',
        'No purchasing intervention remains'
      )
    )
    OR
    ("decisionStatus" <> 'No action required' AND "noActionReasonCode" IS NULL)
  );

-- Current provenance is tenant-scoped and an ended interval cannot precede its
-- start. The relationship identity remains decision + affectedItemId, not the
-- historical source identifier.
ALTER TABLE "public"."changeOrderImpactDecisionAffectedItem"
  DROP CONSTRAINT "changeOrderImpactDecisionAffectedItem_interval_check";
ALTER TABLE "public"."changeOrderImpactDecisionAffectedItem"
  ADD CONSTRAINT "changeOrderImpactDecisionAffectedItem_interval_check"
  CHECK (
    ("endedAt" IS NULL AND "endedBy" IS NULL AND "endedReason" IS NULL)
    OR
    (
      "endedAt" IS NOT NULL
      AND "endedAt" >= "startedAt"
      AND "endedBy" IS NOT NULL
      AND NULLIF(BTRIM("endedReason"), '') IS NOT NULL
    )
  );

DROP INDEX IF EXISTS "changeOrderImpactDecisionAffectedItem_current_key";
CREATE UNIQUE INDEX "changeOrderImpactDecisionAffectedItem_current_key"
  ON "public"."changeOrderImpactDecisionAffectedItem"
    ("companyId", "decisionId", "affectedItemId")
  WHERE "endedAt" IS NULL;

-- Fixed candidate query access paths verified absent under any equivalent name or
-- leading column order before this migration was authored.
CREATE INDEX IF NOT EXISTS "purchaseOrderLine_companyId_itemId_idx"
  ON "public"."purchaseOrderLine" ("companyId", "itemId");
CREATE INDEX IF NOT EXISTS "job_companyId_itemId_idx"
  ON "public"."job" ("companyId", "itemId");
CREATE INDEX IF NOT EXISTS "jobMaterial_companyId_itemId_idx"
  ON "public"."jobMaterial" ("companyId", "itemId");

-- Keep all four named policies visible for each Impact table. SELECT remains the
-- source-aware policy from the earlier migrations; all business writes are
-- supported only through the authorized server/Kysely transaction.
DROP POLICY IF EXISTS "INSERT" ON "public"."changeOrderImpactDecision";
DROP POLICY IF EXISTS "UPDATE" ON "public"."changeOrderImpactDecision";
DROP POLICY IF EXISTS "DELETE" ON "public"."changeOrderImpactDecision";
CREATE POLICY "INSERT" ON "public"."changeOrderImpactDecision"
FOR INSERT WITH CHECK (false);
CREATE POLICY "UPDATE" ON "public"."changeOrderImpactDecision"
FOR UPDATE USING (false);
CREATE POLICY "DELETE" ON "public"."changeOrderImpactDecision"
FOR DELETE USING (false);

DROP POLICY IF EXISTS "INSERT" ON "public"."changeOrderImpactDecisionAffectedItem";
DROP POLICY IF EXISTS "UPDATE" ON "public"."changeOrderImpactDecisionAffectedItem";
DROP POLICY IF EXISTS "DELETE" ON "public"."changeOrderImpactDecisionAffectedItem";
CREATE POLICY "INSERT" ON "public"."changeOrderImpactDecisionAffectedItem"
FOR INSERT WITH CHECK (false);
CREATE POLICY "UPDATE" ON "public"."changeOrderImpactDecisionAffectedItem"
FOR UPDATE USING (false);
CREATE POLICY "DELETE" ON "public"."changeOrderImpactDecisionAffectedItem"
FOR DELETE USING (false);

DROP POLICY IF EXISTS "INSERT" ON "public"."changeOrderImpactDecisionActionTask";
DROP POLICY IF EXISTS "UPDATE" ON "public"."changeOrderImpactDecisionActionTask";
DROP POLICY IF EXISTS "DELETE" ON "public"."changeOrderImpactDecisionActionTask";
CREATE POLICY "INSERT" ON "public"."changeOrderImpactDecisionActionTask"
FOR INSERT WITH CHECK (false);
CREATE POLICY "UPDATE" ON "public"."changeOrderImpactDecisionActionTask"
FOR UPDATE USING (false);
CREATE POLICY "DELETE" ON "public"."changeOrderImpactDecisionActionTask"
FOR DELETE USING (false);

DROP POLICY IF EXISTS "INSERT" ON "public"."changeOrderImpactDecisionHistory";
DROP POLICY IF EXISTS "UPDATE" ON "public"."changeOrderImpactDecisionHistory";
DROP POLICY IF EXISTS "DELETE" ON "public"."changeOrderImpactDecisionHistory";
CREATE POLICY "INSERT" ON "public"."changeOrderImpactDecisionHistory"
FOR INSERT WITH CHECK (false);
CREATE POLICY "UPDATE" ON "public"."changeOrderImpactDecisionHistory"
FOR UPDATE USING (false);
CREATE POLICY "DELETE" ON "public"."changeOrderImpactDecisionHistory"
FOR DELETE USING (false);

NOTIFY pgrst, 'reload schema';
