-- Change Notice Operational Impact — Slice 0 persistence and source-aware RLS.
--
-- This migration deliberately stores source identifiers as historical values. The
-- Impact decision must remain renderable after a PO line, Job, or Job Material is
-- deleted, so none of those source identifiers has a live FK.

-- Existing tasks predate Impact and have no reliable origin information. The
-- conservative prospective label is Manual; actionTypeId remains template linkage.
ALTER TABLE "changeOrderActionTask"
  ADD COLUMN "taskOrigin" TEXT NOT NULL DEFAULT 'Manual',
  ADD CONSTRAINT "changeOrderActionTask_taskOrigin_check"
    CHECK ("taskOrigin" IN ('Template-owned', 'Manual', 'Impact follow-up'));

-- One current assessment per supported operational target.
CREATE TABLE "changeOrderImpactDecision" (
  "id" TEXT NOT NULL DEFAULT id('coid'),
  "companyId" TEXT NOT NULL,
  "changeNoticeId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "decisionStatus" TEXT NOT NULL,
  "noActionReasonCode" TEXT,
  "rationale" TEXT,
  "resolutionNote" TEXT,
  "assessmentSnapshot" JSONB NOT NULL,
  "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
  "assessedBy" TEXT NOT NULL REFERENCES "user"("id"),
  "assessedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("changeNoticeId") REFERENCES "changeOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderImpactDecision_targetType_check"
    CHECK ("targetType" IN ('purchaseOrderLine', 'job', 'jobMaterial')),
  CONSTRAINT "changeOrderImpactDecision_decisionStatus_check"
    CHECK ("decisionStatus" IN ('No action required', 'Action required', 'Resolved')),
  CONSTRAINT "changeOrderImpactDecision_noActionReasonCode_check"
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
    ),
  CONSTRAINT "changeOrderImpactDecision_noPurchasingReason_targetType_check"
    CHECK (
      "noActionReasonCode" <> 'No purchasing intervention remains'
      OR "targetType" = 'purchaseOrderLine'
    ),
  CONSTRAINT "changeOrderImpactDecision_reason_rationale_check"
    CHECK (
      "noActionReasonCode" NOT IN (
        'Not affected after review',
        'No purchasing intervention remains'
      )
      OR NULLIF(BTRIM("rationale"), '') IS NOT NULL
    ),
  CONSTRAINT "changeOrderImpactDecision_snapshotVersion_check"
    CHECK ("snapshotVersion" > 0),
  CONSTRAINT "changeOrderImpactDecision_revision_check"
    CHECK ("revision" > 0),
  CONSTRAINT "changeOrderImpactDecision_target_key"
    UNIQUE ("companyId", "changeNoticeId", "targetType", "targetId")
);

CREATE INDEX "changeOrderImpactDecision_companyId_idx"
  ON "changeOrderImpactDecision" ("companyId");
CREATE INDEX "changeOrderImpactDecision_changeNoticeId_idx"
  ON "changeOrderImpactDecision" ("changeNoticeId");
CREATE INDEX "changeOrderImpactDecision_companyId_changeNoticeId_status_idx"
  ON "changeOrderImpactDecision" ("companyId", "changeNoticeId", "decisionStatus");
CREATE INDEX "changeOrderImpactDecision_createdBy_idx"
  ON "changeOrderImpactDecision" ("createdBy");
CREATE INDEX "changeOrderImpactDecision_updatedBy_idx"
  ON "changeOrderImpactDecision" ("updatedBy");
CREATE INDEX "changeOrderImpactDecision_assessedBy_idx"
  ON "changeOrderImpactDecision" ("assessedBy");

-- Persisted provenance is owned by the decision, but its source identifiers are
-- historical. Ending an interval updates the row; it never follows a deleted
-- changeOrderAffectedItem row through a live FK.
CREATE TABLE "changeOrderImpactDecisionAffectedItem" (
  "id" TEXT NOT NULL DEFAULT id('coipa'),
  "companyId" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "affectedItemId" TEXT NOT NULL,
  "affectedItemSourceId" TEXT NOT NULL,
  "affectedItemLabel" TEXT NOT NULL,
  "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "startedBy" TEXT NOT NULL REFERENCES "user"("id"),
  "endedAt" TIMESTAMP WITH TIME ZONE,
  "endedBy" TEXT REFERENCES "user"("id"),
  "endedReason" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("decisionId", "companyId")
    REFERENCES "changeOrderImpactDecision"("id", "companyId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderImpactDecisionAffectedItem_interval_check"
    CHECK (
      ("endedAt" IS NULL AND "endedBy" IS NULL AND "endedReason" IS NULL)
      OR
      (
        "endedAt" IS NOT NULL
        AND "endedAt" >= "startedAt"
        AND "endedBy" IS NOT NULL
        AND NULLIF(BTRIM("endedReason"), '') IS NOT NULL
      )
    )
);

CREATE INDEX "changeOrderImpactDecisionAffectedItem_companyId_idx"
  ON "changeOrderImpactDecisionAffectedItem" ("companyId");
CREATE INDEX "changeOrderImpactDecisionAffectedItem_decision_idx"
  ON "changeOrderImpactDecisionAffectedItem" ("decisionId", "companyId", "startedAt" DESC);
CREATE INDEX "changeOrderImpactDecisionAffectedItem_affectedItemSource_idx"
  ON "changeOrderImpactDecisionAffectedItem" ("companyId", "affectedItemSourceId");
CREATE INDEX "changeOrderImpactDecisionAffectedItem_startedBy_idx"
  ON "changeOrderImpactDecisionAffectedItem" ("startedBy");
CREATE INDEX "changeOrderImpactDecisionAffectedItem_endedBy_idx"
  ON "changeOrderImpactDecisionAffectedItem" ("endedBy");
CREATE INDEX "changeOrderImpactDecisionAffectedItem_createdBy_idx"
  ON "changeOrderImpactDecisionAffectedItem" ("createdBy");
CREATE INDEX "changeOrderImpactDecisionAffectedItem_updatedBy_idx"
  ON "changeOrderImpactDecisionAffectedItem" ("updatedBy");
CREATE UNIQUE INDEX "changeOrderImpactDecisionAffectedItem_current_key"
  ON "changeOrderImpactDecisionAffectedItem" ("companyId", "decisionId", "affectedItemId")
  WHERE "endedAt" IS NULL;

-- The live many-to-many relationship. Task content/status remains on the task;
-- historical task references belong in changeOrderImpactDecisionHistory instead.
CREATE TABLE "changeOrderImpactDecisionActionTask" (
  "decisionId" TEXT NOT NULL,
  "actionTaskId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("decisionId", "actionTaskId", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("decisionId", "companyId")
    REFERENCES "changeOrderImpactDecision"("id", "companyId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("actionTaskId") REFERENCES "changeOrderActionTask"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "changeOrderImpactDecisionActionTask_companyId_idx"
  ON "changeOrderImpactDecisionActionTask" ("companyId");
CREATE INDEX "changeOrderImpactDecisionActionTask_decision_idx"
  ON "changeOrderImpactDecisionActionTask" ("decisionId", "companyId");
CREATE INDEX "changeOrderImpactDecisionActionTask_actionTask_idx"
  ON "changeOrderImpactDecisionActionTask" ("actionTaskId", "companyId");
CREATE INDEX "changeOrderImpactDecisionActionTask_createdBy_idx"
  ON "changeOrderImpactDecisionActionTask" ("createdBy");
CREATE INDEX "changeOrderImpactDecisionActionTask_updatedBy_idx"
  ON "changeOrderImpactDecisionActionTask" ("updatedBy");

-- Feature-owned history is append-only by the application contract. Related task
-- and affected-item IDs are intentionally raw historical references, with no live
-- FKs, so events remain renderable after those source rows are removed.
CREATE TABLE "changeOrderImpactDecisionHistory" (
  "id" TEXT NOT NULL DEFAULT id('coih'),
  "companyId" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "previousStatus" TEXT,
  "newStatus" TEXT,
  "previousReasonCode" TEXT,
  "newReasonCode" TEXT,
  "previousSnapshot" JSONB,
  "newSnapshot" JSONB,
  "rationale" TEXT,
  "resolutionNote" TEXT,
  "relatedActionTaskId" TEXT,
  "relatedAffectedItemId" TEXT,
  "priorAssessmentWasChanged" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("decisionId", "companyId")
    REFERENCES "changeOrderImpactDecision"("id", "companyId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "changeOrderImpactDecisionHistory_targetType_check"
    CHECK ("targetType" IN ('purchaseOrderLine', 'job', 'jobMaterial')),
  CONSTRAINT "changeOrderImpactDecisionHistory_status_check"
    CHECK (
      ("previousStatus" IS NULL OR "previousStatus" IN ('No action required', 'Action required', 'Resolved'))
      AND
      ("newStatus" IS NULL OR "newStatus" IN ('No action required', 'Action required', 'Resolved'))
    )
);

CREATE INDEX "changeOrderImpactDecisionHistory_companyId_idx"
  ON "changeOrderImpactDecisionHistory" ("companyId");
CREATE INDEX "changeOrderImpactDecisionHistory_decision_createdAt_idx"
  ON "changeOrderImpactDecisionHistory" ("decisionId", "companyId", "createdAt" DESC);
CREATE INDEX "changeOrderImpactDecisionHistory_createdBy_idx"
  ON "changeOrderImpactDecisionHistory" ("createdBy");
CREATE INDEX "changeOrderImpactDecisionHistory_updatedBy_idx"
  ON "changeOrderImpactDecisionHistory" ("updatedBy");

-- -----------------------------------------------------------------------------
-- Source-aware RLS
--
-- A decision's targetType is the authorization discriminator. These policies do
-- not join targetId to the live source table: source deletion is a valid state.
-- Impact writes are server-owned so lifecycle, snapshot, provenance, history, and
-- atomicity checks are not exposed as ordinary PostgREST mutations. The four
-- standardized write policies are explicit denies; parent cleanup remains service/
-- parent-cascade behavior.
-- -----------------------------------------------------------------------------

ALTER TABLE "public"."changeOrderImpactDecision" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderImpactDecision"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
  AND EXISTS (
    SELECT 1
    FROM "changeOrder" co
    WHERE co."id" = "changeNoticeId"
      AND co."companyId" = "changeOrderImpactDecision"."companyId"
  )
  AND (
    ("targetType" = 'purchaseOrderLine'
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[]))
    OR
    ("targetType" IN ('job', 'jobMaterial')
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::text[]))
  )
);

CREATE POLICY "INSERT" ON "public"."changeOrderImpactDecision"
FOR INSERT WITH CHECK (false);

CREATE POLICY "UPDATE" ON "public"."changeOrderImpactDecision"
FOR UPDATE USING (false);

CREATE POLICY "DELETE" ON "public"."changeOrderImpactDecision"
FOR DELETE USING (false);

ALTER TABLE "public"."changeOrderImpactDecisionAffectedItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderImpactDecisionAffectedItem"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
  AND EXISTS (
    SELECT 1
    FROM "changeOrderImpactDecision" d
    WHERE d."id" = "changeOrderImpactDecisionAffectedItem"."decisionId"
      AND d."companyId" = "changeOrderImpactDecisionAffectedItem"."companyId"
      AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
      AND (
        (d."targetType" = 'purchaseOrderLine'
          AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[]))
        OR
        (d."targetType" IN ('job', 'jobMaterial')
          AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::text[]))
      )
  )
);

CREATE POLICY "INSERT" ON "public"."changeOrderImpactDecisionAffectedItem"
FOR INSERT WITH CHECK (false);

CREATE POLICY "UPDATE" ON "public"."changeOrderImpactDecisionAffectedItem"
FOR UPDATE USING (false);

CREATE POLICY "DELETE" ON "public"."changeOrderImpactDecisionAffectedItem"
FOR DELETE USING (false);

ALTER TABLE "public"."changeOrderImpactDecisionActionTask" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderImpactDecisionActionTask"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
  AND EXISTS (
    SELECT 1
    FROM "changeOrderImpactDecision" d
    WHERE d."id" = "changeOrderImpactDecisionActionTask"."decisionId"
      AND d."companyId" = "changeOrderImpactDecisionActionTask"."companyId"
      AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
      AND (
        (d."targetType" = 'purchaseOrderLine'
          AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[]))
        OR
        (d."targetType" IN ('job', 'jobMaterial')
          AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::text[]))
      )
  )
);

CREATE POLICY "INSERT" ON "public"."changeOrderImpactDecisionActionTask"
FOR INSERT WITH CHECK (false);

CREATE POLICY "UPDATE" ON "public"."changeOrderImpactDecisionActionTask"
FOR UPDATE USING (false);

CREATE POLICY "DELETE" ON "public"."changeOrderImpactDecisionActionTask"
FOR DELETE USING (false);

ALTER TABLE "public"."changeOrderImpactDecisionHistory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderImpactDecisionHistory"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
  AND EXISTS (
    SELECT 1
    FROM "changeOrderImpactDecision" d
    WHERE d."id" = "changeOrderImpactDecisionHistory"."decisionId"
      AND d."companyId" = "changeOrderImpactDecisionHistory"."companyId"
      AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_view'))::text[])
      AND (
        (d."targetType" = 'purchaseOrderLine'
          AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[]))
        OR
        (d."targetType" IN ('job', 'jobMaterial')
          AND d."companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::text[]))
      )
  )
);

CREATE POLICY "INSERT" ON "public"."changeOrderImpactDecisionHistory"
FOR INSERT WITH CHECK (false);

CREATE POLICY "UPDATE" ON "public"."changeOrderImpactDecisionHistory"
FOR UPDATE USING (false);

CREATE POLICY "DELETE" ON "public"."changeOrderImpactDecisionHistory"
FOR DELETE USING (false);

NOTIFY pgrst, 'reload schema';
