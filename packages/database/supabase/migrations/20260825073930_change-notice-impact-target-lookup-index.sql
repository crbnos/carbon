-- Reverse target lookup for source reconciliation across Change Notices. The
-- decision identity UNIQUE index is Change Notice-leading; refresh/reconciliation
-- starts from a source target and needs this company/type/target access path.
CREATE INDEX "changeOrderImpactDecision_companyId_targetType_targetId_idx"
  ON "changeOrderImpactDecision" ("companyId", "targetType", "targetId");

NOTIFY pgrst, 'reload schema';
