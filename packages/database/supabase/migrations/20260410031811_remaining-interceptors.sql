-- =============================================================================
-- Convert all remaining legacy triggers to event system interceptors.
--
-- Most tables here are NOT yet on the event system, so attach_event_trigger
-- will set up the full async + sync trigger machinery for each.
-- =============================================================================


-- =============================================================================
-- 1. DOCUMENT triggers (table: document, NOT on event system)
-- =============================================================================

-- upload_document_transaction -> sync_upload_document_transaction (AFTER INSERT)
CREATE OR REPLACE FUNCTION sync_upload_document_transaction(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "documentTransaction" ("documentId", "type", "userId")
  VALUES (p_new->>'id', 'Upload', p_new->>'createdBy');
END;
$$;

-- edit_document_transaction -> sync_edit_document_transaction (BEFORE UPDATE)
CREATE OR REPLACE FUNCTION sync_edit_document_transaction(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  INSERT INTO "documentTransaction" ("documentId", "type", "userId")
  VALUES (p_new->>'id', 'Edit', p_new->>'createdBy');
END;
$$;


-- =============================================================================
-- 2. QUALITY DOCUMENT triggers (table: qualityDocument, NOT on event system)
-- =============================================================================

-- archive_other_quality_documents -> sync_archive_other_quality_documents (BEFORE UPDATE)
CREATE OR REPLACE FUNCTION sync_archive_other_quality_documents(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF NOT ((p_new->>'status') = 'Active' AND ((p_old->>'status') IS NULL OR (p_old->>'status') != 'Active')) THEN
    RETURN;
  END IF;

  UPDATE "qualityDocument"
  SET status = 'Archived'
  WHERE name = p_new->>'name'
    AND "companyId" = p_new->>'companyId'
    AND id != p_new->>'id'
    AND status = 'Active';
END;
$$;


-- =============================================================================
-- 3. PROCEDURE triggers (table: procedure, NOT on event system)
-- =============================================================================

-- archive_other_procedures -> sync_archive_other_procedures (BEFORE UPDATE)
CREATE OR REPLACE FUNCTION sync_archive_other_procedures(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF NOT ((p_new->>'status') = 'Active' AND ((p_old->>'status') IS NULL OR (p_old->>'status') != 'Active')) THEN
    RETURN;
  END IF;

  UPDATE procedure
  SET status = 'Archived'
  WHERE name = p_new->>'name'
    AND "companyId" = p_new->>'companyId'
    AND id != p_new->>'id'
    AND status = 'Active';
END;
$$;


-- =============================================================================
-- 4. STOCK TRANSFER LINE triggers (table: stockTransferLine, already on event system)
-- =============================================================================

-- update_stock_transfer_status -> sync_update_stock_transfer_status (BEFORE UPDATE)
CREATE OR REPLACE FUNCTION sync_update_stock_transfer_status(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF NOT ((p_old->>'pickedQuantity') IS DISTINCT FROM (p_new->>'pickedQuantity')
          AND (p_new->>'pickedQuantity')::numeric != 0) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "stockTransferLine"
    WHERE "stockTransferId" = p_new->>'stockTransferId'
      AND ("pickedQuantity" IS NULL OR "pickedQuantity" != "quantity")
  ) THEN
    UPDATE "stockTransfer"
    SET "status" = 'In Progress'
    WHERE "id" = p_new->>'stockTransferId';
  ELSE
    UPDATE "stockTransfer"
    SET "status" = 'Completed', "completedAt" = NOW()
    WHERE "id" = p_new->>'stockTransferId';
  END IF;
END;
$$;


-- =============================================================================
-- 5. MAINTENANCE DISPATCH triggers (table: maintenanceDispatch, already on event system)
-- =============================================================================

-- on_maintenance_dispatch_complete -> sync_on_maintenance_dispatch_complete (BEFORE UPDATE)
CREATE OR REPLACE FUNCTION sync_on_maintenance_dispatch_complete(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF NOT ((p_new->>'status') = 'Completed' AND ((p_old->>'status') IS NULL OR (p_old->>'status') != 'Completed')) THEN
    RETURN;
  END IF;

  -- End all active events for this dispatch
  UPDATE "maintenanceDispatchEvent"
  SET
    "endTime" = COALESCE((p_new->>'completedAt')::timestamptz, NOW()),
    "updatedBy" = p_new->>'updatedBy',
    "updatedAt" = NOW()
  WHERE
    "maintenanceDispatchId" = p_new->>'id'
    AND "endTime" IS NULL;

  -- Set actualEndTime if not already set
  IF (p_new->>'actualEndTime') IS NULL THEN
    UPDATE "maintenanceDispatch"
    SET
      "actualEndTime" = NOW(),
      "updatedBy" = p_new->>'updatedBy',
      "updatedAt" = NOW()
    WHERE id = p_new->>'id';
  END IF;
END;
$$;


-- =============================================================================
-- 6. NON-CONFORMANCE SUPPLIER triggers (table: nonConformanceSupplier, NOT on event system)
-- =============================================================================

-- create_non_conformance_external_link -> sync_create_nc_external_link (AFTER INSERT)
CREATE OR REPLACE FUNCTION sync_create_nc_external_link(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_external_link_id UUID;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "externalLink" ("documentType", "documentId", "companyId")
  VALUES ('Non-Conformance Supplier', p_new->>'id', p_new->>'companyId')
  ON CONFLICT ("documentId", "documentType", "companyId") DO UPDATE SET
    "documentType" = EXCLUDED."documentType"
  RETURNING "id" INTO v_external_link_id;

  UPDATE "nonConformanceSupplier"
  SET "externalLinkId" = v_external_link_id
  WHERE "id" = p_new->>'id';
END;
$$;


-- =============================================================================
-- 7. COMPANY INTEGRATION triggers (table: companyIntegration, NOT on event system)
-- =============================================================================

-- verify_integration -> sync_verify_integration (BEFORE INSERT/UPDATE)
CREATE OR REPLACE FUNCTION sync_verify_integration(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  integration_schema JSON;
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN RETURN; END IF;

  SELECT jsonschema INTO integration_schema
  FROM public.integration
  WHERE id = p_new->>'id';

  IF (p_new->>'active')::boolean = TRUE
     AND NOT extensions.json_matches_schema(integration_schema, (p_new->'metadata')::json) THEN
    RAISE EXCEPTION 'metadata does not match jsonschema';
  END IF;
END;
$$;


-- =============================================================================
-- 8. NON-CONFORMANCE REQUIRED ACTION triggers (table: nonConformanceRequiredAction, NOT on event system)
-- =============================================================================

-- protect_system_required_actions -> sync_protect_system_required_actions (BEFORE DELETE/UPDATE)
CREATE OR REPLACE FUNCTION sync_protect_system_required_actions(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation = 'DELETE' THEN
    IF (p_old->>'systemType') IS NOT NULL THEN
      -- Allow cascading deletes when the parent company is being deleted
      IF NOT EXISTS (SELECT 1 FROM "company" WHERE id = p_old->>'companyId') THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'Cannot delete a system-defined required action. You may deactivate it instead.';
    END IF;
  END IF;

  IF p_operation = 'UPDATE' THEN
    IF (p_old->>'systemType') IS NOT NULL AND (p_new->>'systemType') IS DISTINCT FROM (p_old->>'systemType') THEN
      RAISE EXCEPTION 'Cannot change the systemType of a system-defined required action.';
    END IF;
    IF (p_old->>'systemType') IS NULL AND (p_new->>'systemType') IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot assign a systemType to a custom required action.';
    END IF;
  END IF;
END;
$$;


-- =============================================================================
-- 9. LOCATION triggers (table: location, NOT on event system)
-- =============================================================================

-- create_related_records_for_location -> sync_create_location_related_records (AFTER INSERT)
CREATE OR REPLACE FUNCTION sync_create_location_related_records(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  item_posting_group RECORD;
  account_defaults RECORD;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- Create itemPlanning records for the new location
  INSERT INTO "itemPlanning" ("itemId", "locationId", "createdBy", "companyId", "createdAt", "updatedAt")
  SELECT
    i.id AS "itemId",
    p_new->>'id' AS "locationId",
    i."createdBy",
    i."companyId",
    NOW(),
    NOW()
  FROM "item" i
  WHERE i."companyId" = p_new->>'companyId';

  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = p_new->>'companyId';

  FOR item_posting_group IN SELECT "id" FROM "itemPostingGroup" WHERE "companyId" = p_new->>'companyId'
  LOOP
    INSERT INTO "postingGroupInventory" (
      "itemPostingGroupId", "locationId",
      "costOfGoodsSoldAccount", "inventoryAccount",
      "inventoryInterimAccrualAccount", "inventoryReceivedNotInvoicedAccount",
      "inventoryInvoicedNotReceivedAccount", "inventoryShippedNotInvoicedAccount",
      "workInProgressAccount", "directCostAppliedAccount",
      "overheadCostAppliedAccount", "purchaseVarianceAccount",
      "inventoryAdjustmentVarianceAccount", "materialVarianceAccount",
      "capacityVarianceAccount", "overheadAccount",
      "companyId", "updatedBy"
    ) VALUES (
      item_posting_group."id", p_new->>'id',
      account_defaults."costOfGoodsSoldAccount", account_defaults."inventoryAccount",
      account_defaults."inventoryInterimAccrualAccount", account_defaults."inventoryReceivedNotInvoicedAccount",
      account_defaults."inventoryInvoicedNotReceivedAccount", account_defaults."inventoryShippedNotInvoicedAccount",
      account_defaults."workInProgressAccount", account_defaults."directCostAppliedAccount",
      account_defaults."overheadCostAppliedAccount", account_defaults."purchaseVarianceAccount",
      account_defaults."inventoryAdjustmentVarianceAccount", account_defaults."materialVarianceAccount",
      account_defaults."capacityVarianceAccount", account_defaults."overheadAccount",
      p_new->>'companyId', p_new->>'createdBy'
    );
  END LOOP;

  -- Insert the null item posting group
  INSERT INTO "postingGroupInventory" (
    "itemPostingGroupId", "locationId",
    "costOfGoodsSoldAccount", "inventoryAccount",
    "inventoryInterimAccrualAccount", "inventoryReceivedNotInvoicedAccount",
    "inventoryInvoicedNotReceivedAccount", "inventoryShippedNotInvoicedAccount",
    "workInProgressAccount", "directCostAppliedAccount",
    "overheadCostAppliedAccount", "purchaseVarianceAccount",
    "inventoryAdjustmentVarianceAccount", "materialVarianceAccount",
    "capacityVarianceAccount", "overheadAccount",
    "companyId", "updatedBy"
  ) VALUES (
    NULL, p_new->>'id',
    account_defaults."costOfGoodsSoldAccount", account_defaults."inventoryAccount",
    account_defaults."inventoryInterimAccrualAccount", account_defaults."inventoryReceivedNotInvoicedAccount",
    account_defaults."inventoryInvoicedNotReceivedAccount", account_defaults."inventoryShippedNotInvoicedAccount",
    account_defaults."workInProgressAccount", account_defaults."directCostAppliedAccount",
    account_defaults."overheadCostAppliedAccount", account_defaults."purchaseVarianceAccount",
    account_defaults."inventoryAdjustmentVarianceAccount", account_defaults."materialVarianceAccount",
    account_defaults."capacityVarianceAccount", account_defaults."overheadAccount",
    p_new->>'companyId', p_new->>'createdBy'
  );
END;
$$;


-- =============================================================================
-- 10. ITEM POSTING GROUP triggers (table: itemPostingGroup, NOT on event system)
-- =============================================================================

-- create_posting_groups_for_item_posting_group -> sync_create_posting_groups_for_item_posting_group (AFTER INSERT)
CREATE OR REPLACE FUNCTION sync_create_posting_groups_for_item_posting_group(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = p_new->>'companyId';

  -- Insert postingGroupSales for all customer types in this company
  FOR rec IN SELECT "id" FROM "customerType" WHERE "companyId" = p_new->>'companyId'
  LOOP
    INSERT INTO "postingGroupSales" (
      "itemPostingGroupId", "customerTypeId",
      "receivablesAccount", "salesAccount", "salesDiscountAccount",
      "salesCreditAccount", "salesPrepaymentAccount", "salesTaxPayableAccount",
      "companyId", "updatedBy"
    ) VALUES (
      p_new->>'id', rec."id",
      account_defaults."receivablesAccount", account_defaults."salesAccount",
      account_defaults."salesDiscountAccount", account_defaults."receivablesAccount",
      account_defaults."prepaymentAccount", account_defaults."salesTaxPayableAccount",
      p_new->>'companyId', p_new->>'createdBy'
    );
  END LOOP;

  -- Insert the null customer type
  INSERT INTO "postingGroupSales" (
    "itemPostingGroupId", "customerTypeId",
    "receivablesAccount", "salesAccount", "salesDiscountAccount",
    "salesCreditAccount", "salesPrepaymentAccount", "salesTaxPayableAccount",
    "companyId", "updatedBy"
  ) VALUES (
    p_new->>'id', NULL,
    account_defaults."receivablesAccount", account_defaults."salesAccount",
    account_defaults."salesDiscountAccount", account_defaults."receivablesAccount",
    account_defaults."prepaymentAccount", account_defaults."salesTaxPayableAccount",
    p_new->>'companyId', p_new->>'createdBy'
  );

  -- Insert postingGroupPurchasing for all supplier types in this company
  FOR rec IN SELECT "id" FROM "supplierType" WHERE "companyId" = p_new->>'companyId'
  LOOP
    INSERT INTO "postingGroupPurchasing" (
      "itemPostingGroupId", "supplierTypeId",
      "payablesAccount", "purchaseAccount", "purchaseDiscountAccount",
      "purchaseCreditAccount", "purchasePrepaymentAccount", "purchaseTaxPayableAccount",
      "companyId", "updatedBy"
    ) VALUES (
      p_new->>'id', rec."id",
      account_defaults."payablesAccount", account_defaults."purchaseAccount",
      account_defaults."purchaseAccount", account_defaults."payablesAccount",
      account_defaults."prepaymentAccount", account_defaults."purchaseTaxPayableAccount",
      p_new->>'companyId', p_new->>'createdBy'
    );
  END LOOP;

  -- Insert the null supplier type
  INSERT INTO "postingGroupPurchasing" (
    "itemPostingGroupId", "supplierTypeId",
    "payablesAccount", "purchaseAccount", "purchaseDiscountAccount",
    "purchaseCreditAccount", "purchasePrepaymentAccount", "purchaseTaxPayableAccount",
    "companyId", "updatedBy"
  ) VALUES (
    p_new->>'id', NULL,
    account_defaults."payablesAccount", account_defaults."purchaseAccount",
    account_defaults."purchaseAccount", account_defaults."payablesAccount",
    account_defaults."prepaymentAccount", account_defaults."purchaseTaxPayableAccount",
    p_new->>'companyId', p_new->>'createdBy'
  );

  -- Insert postingGroupInventory for all locations in this company
  FOR rec IN SELECT "id" FROM "location" WHERE "companyId" = p_new->>'companyId'
  LOOP
    INSERT INTO "postingGroupInventory" (
      "itemPostingGroupId", "locationId",
      "costOfGoodsSoldAccount", "inventoryAccount",
      "inventoryInterimAccrualAccount", "inventoryReceivedNotInvoicedAccount",
      "inventoryInvoicedNotReceivedAccount", "inventoryShippedNotInvoicedAccount",
      "workInProgressAccount", "directCostAppliedAccount",
      "overheadCostAppliedAccount", "purchaseVarianceAccount",
      "inventoryAdjustmentVarianceAccount", "materialVarianceAccount",
      "capacityVarianceAccount", "overheadAccount",
      "companyId", "updatedBy"
    ) VALUES (
      p_new->>'id', rec."id",
      account_defaults."costOfGoodsSoldAccount", account_defaults."inventoryAccount",
      account_defaults."inventoryInterimAccrualAccount", account_defaults."inventoryReceivedNotInvoicedAccount",
      account_defaults."inventoryInvoicedNotReceivedAccount", account_defaults."inventoryShippedNotInvoicedAccount",
      account_defaults."workInProgressAccount", account_defaults."directCostAppliedAccount",
      account_defaults."overheadCostAppliedAccount", account_defaults."purchaseVarianceAccount",
      account_defaults."inventoryAdjustmentVarianceAccount", account_defaults."materialVarianceAccount",
      account_defaults."capacityVarianceAccount", account_defaults."overheadAccount",
      p_new->>'companyId', p_new->>'createdBy'
    );
  END LOOP;

  -- Insert the null location
  INSERT INTO "postingGroupInventory" (
    "itemPostingGroupId", "locationId",
    "costOfGoodsSoldAccount", "inventoryAccount",
    "inventoryInterimAccrualAccount", "inventoryReceivedNotInvoicedAccount",
    "inventoryInvoicedNotReceivedAccount", "inventoryShippedNotInvoicedAccount",
    "workInProgressAccount", "directCostAppliedAccount",
    "overheadCostAppliedAccount", "purchaseVarianceAccount",
    "inventoryAdjustmentVarianceAccount", "materialVarianceAccount",
    "capacityVarianceAccount", "overheadAccount",
    "companyId", "updatedBy"
  ) VALUES (
    p_new->>'id', NULL,
    account_defaults."costOfGoodsSoldAccount", account_defaults."inventoryAccount",
    account_defaults."inventoryInterimAccrualAccount", account_defaults."inventoryReceivedNotInvoicedAccount",
    account_defaults."inventoryInvoicedNotReceivedAccount", account_defaults."inventoryShippedNotInvoicedAccount",
    account_defaults."workInProgressAccount", account_defaults."directCostAppliedAccount",
    account_defaults."overheadCostAppliedAccount", account_defaults."purchaseVarianceAccount",
    account_defaults."inventoryAdjustmentVarianceAccount", account_defaults."materialVarianceAccount",
    account_defaults."capacityVarianceAccount", account_defaults."overheadAccount",
    p_new->>'companyId', p_new->>'createdBy'
  );
END;
$$;


-- =============================================================================
-- 11. COMPANY triggers (table: company, no companyId column -- async will no-op)
-- =============================================================================

-- insert_company_related_records -> sync_insert_company_related_records (AFTER INSERT)
CREATE OR REPLACE FUNCTION sync_insert_company_related_records(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "terms" ("id")
  VALUES (p_new->>'id');

  INSERT INTO "companySettings" ("id")
  VALUES (p_new->>'id');
END;
$$;


-- =============================================================================
-- 12. JOB OPERATION DEPENDENCY triggers (table: jobOperationDependency, NOT on event system)
-- =============================================================================

-- set_initial_dependency_status -> sync_set_initial_dependency_status (BEFORE INSERT)
CREATE OR REPLACE FUNCTION sync_set_initial_dependency_status(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  -- Don't update if operation is already Done, In Progress, or Canceled
  IF EXISTS (
    SELECT 1
    FROM "jobOperation"
    WHERE id = p_new->>'operationId'
      AND status IN ('Done', 'In Progress', 'Canceled')
  ) THEN
    RETURN;
  END IF;

  -- Check if there are any incomplete dependencies
  IF EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep
    JOIN "jobOperation" jo ON jo.id = dep."dependsOnId"
    WHERE dep."operationId" = p_new->>'operationId'
      AND jo.status != 'Done'
  ) THEN
    UPDATE "jobOperation"
    SET status = 'Waiting'
    WHERE id = p_new->>'operationId';
  ELSE
    UPDATE "jobOperation"
    SET status = 'Ready'
    WHERE id = p_new->>'operationId';
  END IF;
END;
$$;


-- =============================================================================
-- Drop legacy triggers
-- =============================================================================

-- document
DROP TRIGGER IF EXISTS upload_document_transaction ON "document";
DROP TRIGGER IF EXISTS edit_document_transaction ON "document";

-- qualityDocument / procedure
DROP TRIGGER IF EXISTS trigger_archive_other_quality_documents ON "qualityDocument";
DROP TRIGGER IF EXISTS trigger_archive_other_procedures ON procedure;

-- stockTransferLine
DROP TRIGGER IF EXISTS update_stock_transfer_status_trigger ON "stockTransferLine";

-- maintenanceDispatch
DROP TRIGGER IF EXISTS on_maintenance_dispatch_complete_trigger ON "maintenanceDispatch";

-- nonConformanceSupplier
DROP TRIGGER IF EXISTS create_non_conformance_external_link_trigger ON "nonConformanceSupplier";

-- companyIntegration
DROP TRIGGER IF EXISTS verify_integration ON "companyIntegration";

-- nonConformanceRequiredAction
DROP TRIGGER IF EXISTS protect_system_required_actions_trigger ON "nonConformanceRequiredAction";

-- location
DROP TRIGGER IF EXISTS create_related_records_for_location ON "location";

-- itemPostingGroup
DROP TRIGGER IF EXISTS create_posting_groups_for_item_posting_group ON "itemPostingGroup";

-- company
DROP TRIGGER IF EXISTS create_company_related_records_after_insert ON "company";

-- jobOperationDependency
DROP TRIGGER IF EXISTS set_initial_dependency_status_trigger ON "jobOperationDependency";


-- =============================================================================
-- Attach event triggers with interceptor arrays
-- =============================================================================

-- document: NOT on event system, BEFORE update + AFTER insert
SELECT attach_event_trigger('document',
  ARRAY['sync_edit_document_transaction']::TEXT[],
  ARRAY['sync_upload_document_transaction']::TEXT[]
);

-- qualityDocument: NOT on event system, BEFORE update only
SELECT attach_event_trigger('qualityDocument',
  ARRAY['sync_archive_other_quality_documents']::TEXT[],
  ARRAY[]::TEXT[]
);

-- procedure: NOT on event system, BEFORE update only
SELECT attach_event_trigger('procedure',
  ARRAY['sync_archive_other_procedures']::TEXT[],
  ARRAY[]::TEXT[]
);

-- stockTransferLine: already on event system, add AFTER update
-- Must be AFTER because the function queries stockTransferLine to check if all
-- lines are picked. In BEFORE, the current row's changes are not yet visible.
SELECT attach_event_trigger('stockTransferLine',
  ARRAY[]::TEXT[],
  ARRAY['sync_update_stock_transfer_status']::TEXT[]
);

-- maintenanceDispatch: already on event system, add AFTER update
-- Must be AFTER because the function updates the same maintenanceDispatch row
-- (setting actualEndTime). In BEFORE, the self-UPDATE is silently ignored by PG.
SELECT attach_event_trigger('maintenanceDispatch',
  ARRAY[]::TEXT[],
  ARRAY['sync_on_maintenance_dispatch_complete']::TEXT[]
);

-- nonConformanceSupplier: NOT on event system, AFTER insert only
SELECT attach_event_trigger('nonConformanceSupplier',
  ARRAY[]::TEXT[],
  ARRAY['sync_create_nc_external_link']::TEXT[]
);

-- companyIntegration: NOT on event system, BEFORE insert/update only
SELECT attach_event_trigger('companyIntegration',
  ARRAY['sync_verify_integration']::TEXT[],
  ARRAY[]::TEXT[]
);

-- nonConformanceRequiredAction: NOT on event system, BEFORE delete/update only
SELECT attach_event_trigger('nonConformanceRequiredAction',
  ARRAY['sync_protect_system_required_actions']::TEXT[],
  ARRAY[]::TEXT[]
);

-- location: NOT on event system, AFTER insert only
SELECT attach_event_trigger('location',
  ARRAY[]::TEXT[],
  ARRAY['sync_create_location_related_records']::TEXT[]
);

-- itemPostingGroup: NOT on event system, AFTER insert only
SELECT attach_event_trigger('itemPostingGroup',
  ARRAY[]::TEXT[],
  ARRAY['sync_create_posting_groups_for_item_posting_group']::TEXT[]
);

-- company: NO companyId column, so we cannot use attach_event_trigger()
-- (dispatch_event_batch would fail with "column companyId does not exist").
-- Manually create only the AFTER ROW trigger for the insert interceptor.
DROP TRIGGER IF EXISTS "trg_event_after_sync_company" ON "company";
CREATE TRIGGER "trg_event_after_sync_company"
AFTER INSERT OR UPDATE OR DELETE ON "company"
FOR EACH ROW
EXECUTE FUNCTION public.dispatch_event_after_interceptors('sync_insert_company_related_records');

-- jobOperationDependency: NOT on event system, AFTER insert only
-- Must be AFTER because the function queries jobOperationDependency for existing
-- dependencies. In BEFORE INSERT, the new row is not yet visible in the table.
SELECT attach_event_trigger('jobOperationDependency',
  ARRAY[]::TEXT[],
  ARRAY['sync_set_initial_dependency_status']::TEXT[]
);
