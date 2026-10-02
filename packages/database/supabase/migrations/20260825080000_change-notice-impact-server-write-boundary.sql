-- Reassert the server-owned business-write boundary for the already-applied
-- development migration state. The checked-in Slice 0 chain already keeps
-- direct PostgREST writes closed; this migration standardizes that state with
-- Carbon's explicit four-policy shape while preserving trusted server writes.
--
-- Trusted Kysely/database paths continue to write through their existing
-- bypass-RLS roles; this migration changes only user-facing RLS.

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
