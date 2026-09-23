-- Change Notice Operational Impact — Slice 0 schema/constraint harness.
--
-- Run against the local DB with psql (or execute the SQL as one transaction with
-- a PostgreSQL client). All fixture rows are rolled back.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f packages/database/supabase/tests/change-notice-impact.test.sql

BEGIN;

DO $$
DECLARE
  v_prefix TEXT := 'impact-test-' || id();
  v_company_id TEXT;
  v_other_company_id TEXT;
  v_currency_code TEXT;
  v_user_id TEXT := 'system';
  v_change_notice_id TEXT;
  v_other_notice_id TEXT;
  v_decision_id TEXT;
  v_other_decision_id TEXT;
  v_shared_decision_id TEXT := v_prefix || '-shared-decision';
  v_outside_decision_id TEXT;
  v_rationale_decision_id TEXT;
  v_purchasing_decision_id TEXT;
  v_resolved_decision_id TEXT;
  v_revision_decision_id TEXT;
  v_task_id TEXT;
  v_backlink_item_id TEXT;
  v_backlink_method_id TEXT;
  v_count INTEGER;
  v_column_default TEXT;
BEGIN
  SELECT "id" INTO v_company_id
  FROM "company"
  ORDER BY "createdAt"
  LIMIT 1;
  ASSERT v_company_id IS NOT NULL, 'local DB needs at least one company';

  -- Catalog checks: tables, RLS, indexes, and the deliberately absent source/history FKs.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'changeOrderImpactDecision',
      'changeOrderImpactDecisionAffectedItem',
      'changeOrderImpactDecisionActionTask',
      'changeOrderImpactDecisionHistory'
    );
  ASSERT v_count = 4, 'all four Impact tables must exist';

  SELECT COUNT(*) INTO v_count
  FROM pg_class
  WHERE relnamespace = 'public'::regnamespace
    AND relname IN (
      'changeOrderImpactDecision',
      'changeOrderImpactDecisionAffectedItem',
      'changeOrderImpactDecisionActionTask',
      'changeOrderImpactDecisionHistory'
    )
    AND relrowsecurity;
  ASSERT v_count = 4, 'all four Impact tables must have RLS enabled';

  SELECT column_default INTO v_column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'changeOrderActionTask'
    AND column_name = 'taskOrigin'
    AND is_nullable = 'NO';
  ASSERT v_column_default LIKE '%Manual%', 'taskOrigin must be NOT NULL with Manual default';

  SELECT COUNT(*) INTO v_count
  FROM pg_trigger
  WHERE tgrelid = '"public"."changeOrderActionTask"'::regclass
    AND tgname = 'changeOrderActionTask_taskOrigin_guard'
    AND NOT tgisinternal;
  ASSERT v_count = 1, 'taskOrigin direct-mutation guard must exist';

  SELECT COUNT(*) INTO v_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'changeOrderImpactDecision'
    AND indexname = 'changeOrderImpactDecision_companyId_targetType_targetId_idx';
  ASSERT v_count = 1, 'reverse target lookup index must exist';

  SELECT COUNT(*) INTO v_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN ('purchaseOrderLine', 'job', 'jobMaterial')
    AND indexname IN (
      'purchaseOrderLine_companyId_itemId_idx',
      'job_companyId_itemId_idx',
      'jobMaterial_companyId_itemId_idx'
    )
    AND indexdef LIKE '%("companyId", "itemId")%';
  ASSERT v_count = 3, 'candidate source indexes must have the approved leading columns';

  SELECT COUNT(*) INTO v_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'changeOrderImpactDecisionAffectedItem_current_key'
    AND indexdef LIKE '%("companyId", "decisionId", "affectedItemId")%';
  ASSERT v_count = 1, 'current provenance uniqueness must be tenant-scoped';

  SELECT COUNT(*) INTO v_count
  FROM pg_constraint fk
  JOIN pg_class child ON child.oid = fk.conrelid
  JOIN pg_class parent ON parent.oid = fk.confrelid
  WHERE fk.contype = 'f'
    AND child.relname = 'changeOrderImpactDecision'
    AND parent.relname IN ('purchaseOrderLine', 'job', 'jobMaterial');
  ASSERT v_count = 0, 'decision must not have source FKs';

  -- The service deletes only non-cascading draft references explicitly. Keep the
  -- real database cascade contract visible here: direct Change Notice children
  -- disappear with the parent, while non-cascading item/method backlinks survive.
  -- Compare the complete direct-FK inventory, not only the children this fixture
  -- happens to exercise. The constraint names and delete actions are part of the
  -- parent-delete contract owned by the database.
  WITH expected(child_name, constraint_name, delete_action) AS (
    VALUES
      ('changeOrderAffectedItem', 'changeOrderAffectedItem_changeOrderId_fkey', 'c'),
      ('changeOrderSupersession', 'changeOrderSupersession_changeOrderId_fkey', 'c'),
      ('changeOrderActionTask', 'changeOrderActionTask_changeOrderId_fkey', 'c'),
      ('changeOrderImpactDecision', 'changeOrderImpactDecision_changeNoticeId_fkey', 'c'),
      ('item', 'item_changeOrderId_fkey', 'n'),
      ('makeMethod', 'makeMethod_changeOrderId_fkey', 'n')
  ), actual AS (
    SELECT child.relname::TEXT, fk.conname::TEXT, fk.confdeltype::TEXT
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    WHERE fk.contype = 'f'
      AND fk.confrelid = '"public"."changeOrder"'::regclass
  ), differences AS (
    (
      SELECT * FROM expected
      EXCEPT
      SELECT * FROM actual
    )
    UNION ALL
    (
      SELECT * FROM actual
      EXCEPT
      SELECT * FROM expected
    )
  )
  SELECT COUNT(*) INTO v_count FROM differences;
  ASSERT v_count = 0, 'Change Notice direct FK inventory or delete actions changed';

  WITH expected(child_name, constraint_name, delete_action) AS (
    VALUES ('makeMethod', 'method_itemId_fkey', 'c')
  ), actual AS (
    SELECT child.relname::TEXT, fk.conname::TEXT, fk.confdeltype::TEXT
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    WHERE fk.contype = 'f'
      AND fk.conrelid = '"public"."makeMethod"'::regclass
      AND fk.confrelid = '"public"."item"'::regclass
  ), differences AS (
    (
      SELECT * FROM expected
      EXCEPT
      SELECT * FROM actual
    )
    UNION ALL
    (
      SELECT * FROM actual
      EXCEPT
      SELECT * FROM expected
    )
  )
  SELECT COUNT(*) INTO v_count FROM differences;
  ASSERT v_count = 0, 'item deletion must cascade its methods';

  SELECT COUNT(*) INTO v_count
  FROM pg_constraint fk
  JOIN pg_class child ON child.oid = fk.conrelid
  JOIN pg_class parent ON parent.oid = fk.confrelid
  WHERE fk.contype = 'f'
    AND child.relname = 'changeOrderImpactDecisionAffectedItem'
    AND parent.relname = 'changeOrderAffectedItem';
  ASSERT v_count = 0, 'provenance must not have a live affected-item FK';

  SELECT COUNT(*) INTO v_count
  FROM pg_constraint fk
  JOIN pg_attribute column_ref
    ON column_ref.attrelid = fk.conrelid
   AND column_ref.attnum = ANY (fk.conkey)
  WHERE fk.contype = 'f'
    AND fk.conrelid = '"public"."changeOrderImpactDecisionHistory"'::regclass
    AND column_ref.attname IN ('relatedActionTaskId', 'relatedAffectedItemId');
  ASSERT v_count = 0, 'history related identifiers must not have live FKs';

  -- Final Carbon four-policy shape: source-aware SELECT plus explicit deny writes.
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'changeOrderImpactDecision',
      'changeOrderImpactDecisionAffectedItem',
      'changeOrderImpactDecisionActionTask',
      'changeOrderImpactDecisionHistory'
    )
    AND policyname IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  ASSERT v_count = 16, 'all four named policies must exist on every Impact table';

  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'changeOrderImpactDecision',
      'changeOrderImpactDecisionAffectedItem',
      'changeOrderImpactDecisionActionTask',
      'changeOrderImpactDecisionHistory'
    )
    AND (
      (policyname = 'INSERT' AND cmd = 'INSERT' AND with_check = 'false')
      OR (policyname = 'UPDATE' AND cmd = 'UPDATE' AND qual = 'false')
      OR (policyname = 'DELETE' AND cmd = 'DELETE' AND qual = 'false')
    );
  ASSERT v_count = 12, 'all Impact writes must be explicit deny policies';

  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'changeOrderImpactDecision',
      'changeOrderImpactDecisionAffectedItem',
      'changeOrderImpactDecisionActionTask',
      'changeOrderImpactDecisionHistory'
    )
    AND policyname = 'SELECT'
    AND cmd = 'SELECT';
  ASSERT v_count = 4, 'all Impact SELECT policies must remain source-aware';

  -- Fixture parents. The second company proves tenant-scoped uniqueness without
  -- depending on the global database being empty.
  SELECT "code" INTO v_currency_code FROM "currencyCode" LIMIT 1;
  ASSERT v_currency_code IS NOT NULL, 'local DB needs a currency fixture';

  INSERT INTO "company" ("name", "baseCurrencyCode")
  VALUES (v_prefix || '-other-company', v_currency_code)
  RETURNING "id" INTO v_other_company_id;

  INSERT INTO "changeOrder" (
    "changeOrderId", "name", "openDate", "companyId", "createdBy"
  ) VALUES (
    v_prefix || '-notice', 'Impact Slice 0 Test', CURRENT_DATE, v_company_id, v_user_id
  ) RETURNING "id" INTO v_change_notice_id;

  INSERT INTO "changeOrder" (
    "changeOrderId", "name", "openDate", "companyId", "createdBy"
  ) VALUES (
    v_prefix || '-other-notice', 'Impact Slice 0 Other Tenant Test', CURRENT_DATE,
    v_other_company_id, v_user_id
  ) RETURNING "id" INTO v_other_notice_id;

  -- taskOrigin durable schema behavior is fixture-scoped, not a global assertion.
  INSERT INTO "changeOrderActionTask" (
    "changeOrderId", "name", "companyId", "createdBy"
  ) VALUES (
    v_change_notice_id, 'Impact Slice 0 Default Test', v_company_id, v_user_id
  ) RETURNING "id" INTO v_task_id;
  ASSERT (
    SELECT "taskOrigin" FROM "changeOrderActionTask" WHERE "id" = v_task_id
  ) = 'Manual', 'new ordinary fixture task must default to Manual';

  -- Real backlink fixtures verify that deleting the parent preserves the item and
  -- method while clearing only their Change Notice ownership marker.
  INSERT INTO "item" (
    "readableId", "name", "type", "itemTrackingType", "companyId", "createdBy",
    "changeOrderId"
  ) VALUES (
    v_prefix || '-backlink-item', 'Change Notice backlink item', 'Part', 'Inventory',
    v_company_id, v_user_id, v_change_notice_id
  ) RETURNING "id" INTO v_backlink_item_id;

  -- Part INSERTs run the item's AFTER SYNC interceptor, which creates its
  -- initial Draft makeMethod. Reuse that row instead of inserting a second
  -- method and colliding with the per-item/version uniqueness contract.
  SELECT COUNT(*) INTO v_count
  FROM "makeMethod"
  WHERE "itemId" = v_backlink_item_id
    AND "companyId" = v_company_id;
  ASSERT v_count = 1, 'Part insertion must create one Draft make method';
  SELECT "id" INTO v_backlink_method_id
  FROM "makeMethod"
  WHERE "itemId" = v_backlink_item_id
    AND "companyId" = v_company_id;
  UPDATE "makeMethod"
  SET "changeOrderId" = v_change_notice_id
  WHERE "id" = v_backlink_method_id
    AND "companyId" = v_company_id;

  BEGIN
    INSERT INTO "changeOrderActionTask" (
      "changeOrderId", "name", "companyId", "createdBy", "taskOrigin"
    ) VALUES (
      v_change_notice_id, 'Impact Slice 0 Invalid Origin', v_company_id, v_user_id, 'Invalid'
    );
    ASSERT FALSE, 'invalid taskOrigin must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- No Action requires a non-null structured reason.
  BEGIN
    INSERT INTO "changeOrderImpactDecision" (
      "companyId", "changeNoticeId", "targetType", "targetId",
      "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy"
    ) VALUES (
      v_company_id, v_change_notice_id, 'purchaseOrderLine', v_prefix || '-null-reason',
      'No action required', '{}'::jsonb, v_user_id, v_user_id
    );
    ASSERT FALSE, 'No action required with NULL reason must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "changeOrderImpactDecision" (
      "companyId", "changeNoticeId", "targetType", "targetId",
      "decisionStatus", "noActionReasonCode", "assessmentSnapshot", "assessedBy", "createdBy"
    ) VALUES (
      v_company_id, v_change_notice_id, 'purchaseOrderLine', v_prefix || '-unknown-reason',
      'No action required', 'Unknown reason', '{}'::jsonb, v_user_id, v_user_id
    );
    ASSERT FALSE, 'No action required with unknown reason must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "changeOrderImpactDecision" (
      "companyId", "changeNoticeId", "targetType", "targetId",
      "decisionStatus", "noActionReasonCode", "rationale", "assessmentSnapshot",
      "assessedBy", "createdBy"
    ) VALUES (
      v_company_id, v_change_notice_id, 'job', v_prefix || '-wrong-domain',
      'No action required', 'No purchasing intervention remains', 'Reviewed', '{}',
      v_user_id, v_user_id
    );
    ASSERT FALSE, 'Job with purchasing-only reason must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "changeOrderImpactDecision" (
      "companyId", "changeNoticeId", "targetType", "targetId",
      "decisionStatus", "noActionReasonCode", "assessmentSnapshot", "assessedBy", "createdBy"
    ) VALUES (
      v_company_id, v_change_notice_id, 'job', v_prefix || '-missing-rationale',
      'No action required', 'Not affected after review', '{}', v_user_id, v_user_id
    );
    ASSERT FALSE, 'mandatory-rationale reason with NULL rationale must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "changeOrderImpactDecision" (
      "companyId", "changeNoticeId", "targetType", "targetId",
      "decisionStatus", "noActionReasonCode", "rationale", "assessmentSnapshot",
      "assessedBy", "createdBy"
    ) VALUES (
      v_company_id, v_change_notice_id, 'job', v_prefix || '-empty-rationale',
      'No action required', 'Not affected after review', '   ', '{}', v_user_id, v_user_id
    );
    ASSERT FALSE, 'mandatory-rationale reason with empty rationale must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Action Required and Resolved cannot carry a No Action reason.
  BEGIN
    INSERT INTO "changeOrderImpactDecision" (
      "companyId", "changeNoticeId", "targetType", "targetId",
      "decisionStatus", "noActionReasonCode", "rationale", "assessmentSnapshot",
      "assessedBy", "createdBy"
    ) VALUES (
      v_company_id, v_change_notice_id, 'job', v_prefix || '-action-with-reason',
      'Action required', 'Outside effectivity', 'Reviewed', '{}', v_user_id, v_user_id
    );
    ASSERT FALSE, 'Action required with No Action reason must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "changeOrderImpactDecision" (
      "companyId", "changeNoticeId", "targetType", "targetId",
      "decisionStatus", "noActionReasonCode", "rationale", "assessmentSnapshot",
      "assessedBy", "createdBy"
    ) VALUES (
      v_company_id, v_change_notice_id, 'job', v_prefix || '-resolved-with-reason',
      'Resolved', 'Outside effectivity', 'Reviewed', '{}', v_user_id, v_user_id
    );
    ASSERT FALSE, 'Resolved with No Action reason must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Valid structured reasons remain accepted, including mandatory rationale and
  -- Resolved without a DB-level resolutionNote requirement.
  INSERT INTO "changeOrderImpactDecision" (
    "companyId", "changeNoticeId", "targetType", "targetId",
    "decisionStatus", "noActionReasonCode", "assessmentSnapshot", "assessedBy", "createdBy"
  ) VALUES (
    v_company_id, v_change_notice_id, 'purchaseOrderLine', v_prefix || '-outside-effectivity',
    'No action required', 'Outside effectivity', '{}', v_user_id, v_user_id
  ) RETURNING "id" INTO v_outside_decision_id;
  ASSERT v_outside_decision_id IS NOT NULL, 'valid Outside effectivity must be accepted';

  INSERT INTO "changeOrderImpactDecision" (
    "companyId", "changeNoticeId", "targetType", "targetId",
    "decisionStatus", "noActionReasonCode", "rationale", "assessmentSnapshot",
    "assessedBy", "createdBy"
  ) VALUES (
    v_company_id, v_change_notice_id, 'job', v_prefix || '-not-affected',
    'No action required', 'Not affected after review', 'Reviewed and disproved', '{}',
    v_user_id, v_user_id
  ) RETURNING "id" INTO v_rationale_decision_id;
  ASSERT v_rationale_decision_id IS NOT NULL, 'valid mandatory rationale must be accepted';

  INSERT INTO "changeOrderImpactDecision" (
    "companyId", "changeNoticeId", "targetType", "targetId",
    "decisionStatus", "noActionReasonCode", "rationale", "assessmentSnapshot",
    "assessedBy", "createdBy"
  ) VALUES (
    v_company_id, v_change_notice_id, 'purchaseOrderLine', v_prefix || '-no-purchasing',
    'No action required', 'No purchasing intervention remains', 'Supplier work reviewed', '{}',
    v_user_id, v_user_id
  ) RETURNING "id" INTO v_purchasing_decision_id;
  ASSERT v_purchasing_decision_id IS NOT NULL, 'valid purchasing-only reason must be accepted';

  INSERT INTO "changeOrderImpactDecision" (
    "companyId", "changeNoticeId", "targetType", "targetId",
    "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy"
  ) VALUES (
    v_company_id, v_change_notice_id, 'job', v_prefix || '-resolved',
    'Resolved', '{}', v_user_id, v_user_id
  ) RETURNING "id" INTO v_resolved_decision_id;
  ASSERT v_resolved_decision_id IS NOT NULL, 'Resolved without resolutionNote must be accepted';

  INSERT INTO "changeOrderImpactDecision" (
    "companyId", "changeNoticeId", "targetType", "targetId",
    "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy", "revision"
  ) VALUES (
    v_company_id, v_change_notice_id, 'jobMaterial', v_prefix || '-revision-two',
    'Action required', '{}', v_user_id, v_user_id, 2
  ) RETURNING "id" INTO v_revision_decision_id;
  ASSERT v_revision_decision_id IS NOT NULL, 'positive revision must be accepted';

  BEGIN
    INSERT INTO "changeOrderImpactDecision" (
      "companyId", "changeNoticeId", "targetType", "targetId",
      "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy", "revision"
    ) VALUES (
      v_company_id, v_change_notice_id, 'job', v_prefix || '-revision-zero',
      'Action required', '{}', v_user_id, v_user_id, 0
    );
    ASSERT FALSE, 'non-positive revision must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A valid Action Required decision establishes the target identity and child FK fixtures.
  INSERT INTO "changeOrderImpactDecision" (
    "companyId", "changeNoticeId", "targetType", "targetId",
    "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy"
  ) VALUES (
    v_company_id, v_change_notice_id, 'purchaseOrderLine', v_prefix || '-missing-source-po-line',
    'Action required', '{}', v_user_id, v_user_id
  ) RETURNING "id" INTO v_decision_id;

  BEGIN
    INSERT INTO "changeOrderImpactDecision" (
      "companyId", "changeNoticeId", "targetType", "targetId",
      "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy"
    ) VALUES (
      v_company_id, v_change_notice_id, 'purchaseOrderLine', v_prefix || '-missing-source-po-line',
      'Action required', '{}', v_user_id, v_user_id
    );
    ASSERT FALSE, 'duplicate decision identity must be rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Equivalent decision and affected-item IDs are valid in separate tenants.
  INSERT INTO "changeOrderImpactDecision" (
    "id", "companyId", "changeNoticeId", "targetType", "targetId",
    "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy"
  ) VALUES (
    v_shared_decision_id, v_company_id, v_change_notice_id, 'job', 'shared-target',
    'Action required', '{}', v_user_id, v_user_id
  );
  INSERT INTO "changeOrderImpactDecision" (
    "id", "companyId", "changeNoticeId", "targetType", "targetId",
    "decisionStatus", "assessmentSnapshot", "assessedBy", "createdBy"
  ) VALUES (
    v_shared_decision_id, v_other_company_id, v_other_notice_id, 'job', 'shared-target',
    'Action required', '{}', v_user_id, v_user_id
  ) RETURNING "id" INTO v_other_decision_id;
  ASSERT v_other_decision_id = v_shared_decision_id,
    'equivalent decision IDs must be accepted across tenants';

  INSERT INTO "changeOrderImpactDecisionAffectedItem" (
    "companyId", "decisionId", "affectedItemId", "affectedItemSourceId",
    "affectedItemLabel", "startedBy", "createdBy"
  ) VALUES (
    v_company_id, v_shared_decision_id, 'shared-affected-item', 'shared-source-item',
    'Tenant A provenance', v_user_id, v_user_id
  );
  INSERT INTO "changeOrderImpactDecisionAffectedItem" (
    "companyId", "decisionId", "affectedItemId", "affectedItemSourceId",
    "affectedItemLabel", "startedBy", "createdBy"
  ) VALUES (
    v_other_company_id, v_shared_decision_id, 'shared-affected-item', 'shared-source-item',
    'Tenant B provenance', v_user_id, v_user_id
  );

  -- A readable label may be unavailable, but both persisted identifiers remain required.
  INSERT INTO "changeOrderImpactDecisionAffectedItem" (
    "companyId", "decisionId", "affectedItemId", "affectedItemSourceId",
    "affectedItemLabel", "startedBy", "createdBy"
  ) VALUES (
    v_company_id, v_decision_id, 'nullable-label-item', 'nullable-label-source',
    NULL, v_user_id, v_user_id
  );
  ASSERT (
    SELECT "affectedItemLabel" IS NULL
    FROM "changeOrderImpactDecisionAffectedItem"
    WHERE "decisionId" = v_decision_id
      AND "affectedItemId" = 'nullable-label-item'
  ), 'NULL affectedItemLabel must be accepted';

  BEGIN
    INSERT INTO "changeOrderImpactDecisionAffectedItem" (
      "companyId", "decisionId", "affectedItemId", "affectedItemSourceId",
      "affectedItemLabel", "startedBy", "createdBy"
    ) VALUES (
      v_company_id, v_decision_id, NULL, 'required-source-id', NULL, v_user_id, v_user_id
    );
    ASSERT FALSE, 'affectedItemId must remain NOT NULL';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "changeOrderImpactDecisionAffectedItem" (
      "companyId", "decisionId", "affectedItemId", "affectedItemSourceId",
      "affectedItemLabel", "startedBy", "createdBy"
    ) VALUES (
      v_company_id, v_decision_id, 'required-item-id', NULL, NULL, v_user_id, v_user_id
    );
    ASSERT FALSE, 'affectedItemSourceId must remain NOT NULL';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;

  -- Provenance interval checks and tenant-scoped current uniqueness.
  INSERT INTO "changeOrderImpactDecisionAffectedItem" (
    "companyId", "decisionId", "affectedItemId", "affectedItemSourceId",
    "affectedItemLabel", "startedBy", "createdBy"
  ) VALUES (
    v_company_id, v_decision_id, 'historical-affected-item', 'historical-source-item',
    'Open provenance', v_user_id, v_user_id
  );

  BEGIN
    INSERT INTO "changeOrderImpactDecisionAffectedItem" (
      "companyId", "decisionId", "affectedItemId", "affectedItemSourceId",
      "affectedItemLabel", "startedBy", "createdBy"
    ) VALUES (
      v_company_id, v_decision_id, 'historical-affected-item', 'historical-source-item-2',
      'Duplicate current interval', v_user_id, v_user_id
    );
    ASSERT FALSE, 'duplicate open provenance in one tenant must be rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO "changeOrderImpactDecisionAffectedItem" (
    "companyId", "decisionId", "affectedItemId", "affectedItemSourceId",
    "affectedItemLabel", "startedAt", "endedAt", "endedBy", "endedReason",
    "startedBy", "createdBy"
  ) VALUES (
    v_company_id, v_decision_id, 'closed-affected-item', 'closed-source-item',
    'Closed provenance', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour',
    v_user_id, 'Normal closure', v_user_id, v_user_id
  );

  BEGIN
    INSERT INTO "changeOrderImpactDecisionAffectedItem" (
      "companyId", "decisionId", "affectedItemId", "affectedItemSourceId",
      "affectedItemLabel", "startedAt", "endedAt", "endedBy", "endedReason",
      "startedBy", "createdBy"
    ) VALUES (
      v_company_id, v_decision_id, 'backwards-interval', 'backwards-source',
      'Backwards interval', NOW(), NOW() - INTERVAL '1 minute', v_user_id,
      'Invalid chronology', v_user_id, v_user_id
    );
    ASSERT FALSE, 'endedAt before startedAt must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "changeOrderImpactDecisionAffectedItem" (
      "companyId", "decisionId", "affectedItemId", "affectedItemSourceId",
      "affectedItemLabel", "startedAt", "endedAt", "endedReason",
      "startedBy", "createdBy"
    ) VALUES (
      v_company_id, v_decision_id, 'partial-end', 'partial-source',
      'Partial end metadata', NOW(), NOW(), 'Missing endedBy', v_user_id, v_user_id
    );
    ASSERT FALSE, 'partial end metadata must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO "changeOrderImpactDecisionActionTask" (
    "decisionId", "actionTaskId", "companyId", "createdBy"
  ) VALUES (
    v_decision_id, v_task_id, v_company_id, v_user_id
  );

  BEGIN
    INSERT INTO "changeOrderImpactDecisionActionTask" (
      "decisionId", "actionTaskId", "companyId", "createdBy"
    ) VALUES (
      v_decision_id, v_task_id, v_company_id, v_user_id
    );
    ASSERT FALSE, 'duplicate task link must be rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO "changeOrderImpactDecisionHistory" (
    "companyId", "decisionId", "targetType", "targetId", "eventType",
    "newStatus", "newSnapshot", "relatedActionTaskId", "createdBy"
  ) VALUES (
    v_company_id, v_decision_id, 'purchaseOrderLine', v_prefix || '-missing-source-po-line',
    'Decision created', 'Action required', '{}'::jsonb, v_task_id, v_user_id
  );

  -- Parent deletion follows existing Change Notice cascade for this fixture only.
  DELETE FROM "changeOrder" WHERE "id" = v_change_notice_id;
  SELECT COUNT(*) INTO v_count
  FROM "changeOrderImpactDecision"
  WHERE "id" = v_decision_id;
  ASSERT v_count = 0, 'Change Notice deletion must cascade the Impact decision';
  SELECT COUNT(*) INTO v_count
  FROM "changeOrderImpactDecisionAffectedItem"
  WHERE "decisionId" = v_decision_id;
  ASSERT v_count = 0, 'Change Notice deletion must cascade Impact provenance';
  SELECT COUNT(*) INTO v_count
  FROM "changeOrderImpactDecisionActionTask"
  WHERE "decisionId" = v_decision_id;
  ASSERT v_count = 0, 'Change Notice deletion must cascade Impact task links';
  SELECT COUNT(*) INTO v_count
  FROM "changeOrderImpactDecisionHistory"
  WHERE "decisionId" = v_decision_id;
  ASSERT v_count = 0, 'Change Notice deletion must cascade Impact history';
  SELECT COUNT(*) INTO v_count
  FROM "changeOrderActionTask"
  WHERE "id" = v_task_id;
  ASSERT v_count = 0, 'Change Notice deletion must cascade action tasks';
  ASSERT (
    SELECT "changeOrderId" IS NULL
    FROM "item"
    WHERE "id" = v_backlink_item_id
  ), 'Change Notice deletion must preserve items and clear their backlink';
  ASSERT (
    SELECT "changeOrderId" IS NULL
    FROM "makeMethod"
    WHERE "id" = v_backlink_method_id
  ), 'Change Notice deletion must preserve methods and clear their backlink';
  DELETE FROM "item" WHERE "id" = v_backlink_item_id;
  SELECT COUNT(*) INTO v_count
  FROM "makeMethod"
  WHERE "id" = v_backlink_method_id;
  ASSERT v_count = 0, 'item deletion must cascade its trigger-created method';

  RAISE NOTICE 'ALL CHANGE NOTICE IMPACT SLICE 0 SCHEMA CHECKS PASSED';
END $$;

ROLLBACK;
