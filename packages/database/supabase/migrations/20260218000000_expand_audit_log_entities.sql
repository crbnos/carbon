-- Expand audit log to cover ~60 tables across 21 entity types
-- Key changes:
--   1. Drop audit_table_to_entity_type() — entity resolution is now in TypeScript
--   2. Update get_entity_audit_log() to query by entityType (not tableName)
--      so child table changes roll up into parent entity views
--   3. Backfill existing entityType values (salesCustomer -> customer, etc.)
--   4. Attach event triggers to all new auditable tables
--   5. Create audit subscriptions for existing companies that have audit enabled


-- ============================================================================
-- 1. Drop audit_table_to_entity_type — entity type resolution is now done
--    entirely in the TypeScript audit event processor using audit.config.ts
-- ============================================================================
DROP FUNCTION IF EXISTS public.audit_table_to_entity_type(TEXT);


-- ============================================================================
-- 2. Backfill existing audit log tables: rename old entity type values
-- ============================================================================
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'auditLog_%'
    AND table_name != 'auditLogArchive'
  LOOP
    EXECUTE format('UPDATE %I SET "entityType" = ''customer'' WHERE "entityType" = ''salesCustomer''', tbl.table_name);
    EXECUTE format('UPDATE %I SET "entityType" = ''supplier'' WHERE "entityType" = ''purchaseSupplier''', tbl.table_name);
  END LOOP;
END;
$$;


-- ============================================================================
-- 3. Update get_entity_audit_log to query by entityType instead of tableName
--    Must DROP first because we renamed the parameter (p_table_name -> p_entity_type)
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_entity_audit_log(TEXT, TEXT, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.get_entity_audit_log(
  p_company_id TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  "id" TEXT,
  "tableName" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "operation" TEXT,
  "actorId" TEXT,
  "diff" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ
) AS $$
DECLARE
  tbl_name TEXT;
BEGIN
  tbl_name := 'auditLog_' || p_company_id;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND information_schema.tables.table_name = tbl_name
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format('
    SELECT "id", "tableName", "entityType", "entityId", "operation", "actorId", "diff", "metadata", "createdAt"
    FROM %I
    WHERE "entityType" = $1 AND "entityId" = $2
    ORDER BY "createdAt" DESC
    LIMIT $3 OFFSET $4
  ', tbl_name)
  USING p_entity_type, p_entity_id, p_limit, p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 4. Attach event triggers to new auditable tables
--    Note: The following already have event triggers from previous migrations:
--      customer, employee, gauge, item, itemCost, job, nonConformance,
--      purchaseInvoice, purchaseOrder, purchaseOrderLine, quote, salesInvoice,
--      salesOrder, salesOrderLine, supplier, supplierQuote, contact, address
-- ============================================================================

-- CRM child tables
SELECT attach_event_trigger('customerPayment', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('customerShipping', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('supplierPayment', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('supplierShipping', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('supplierPart', ARRAY[]::TEXT[]);

-- Item child tables
SELECT attach_event_trigger('itemPlanning', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('itemReplenishment', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('itemUnitSalePrice', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('customerPartToItem', ARRAY[]::TEXT[]);

-- Job child tables
SELECT attach_event_trigger('jobOperation', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('jobMaterial', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('jobMakeMethod', ARRAY[]::TEXT[]);

-- Sales child tables
SELECT attach_event_trigger('salesOrderPayment', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('salesOrderShipment', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('quoteLine', ARRAY[]::TEXT[]);

-- Purchasing child tables
SELECT attach_event_trigger('purchaseOrderPayment', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('purchaseOrderDelivery', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('supplierQuoteLine', ARRAY[]::TEXT[]);

-- Finance child tables
SELECT attach_event_trigger('salesInvoiceLine', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('salesInvoiceShipment', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('purchaseInvoiceLine', ARRAY[]::TEXT[]);

-- Quality child tables
SELECT attach_event_trigger('nonConformanceItem', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('nonConformanceActionTask', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('nonConformanceApprovalTask', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('gaugeCalibrationRecord', ARRAY[]::TEXT[]);

-- Shipping / Receiving (new root entities)
SELECT attach_event_trigger('shipment', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('shipmentLine', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('receipt', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('receiptLine', ARRAY[]::TEXT[]);

-- Inventory movement tables (new root entities)
SELECT attach_event_trigger('warehouseTransfer', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('warehouseTransferLine', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('stockTransfer', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('stockTransferLine', ARRAY[]::TEXT[]);

-- Production tables (new root entities)
SELECT attach_event_trigger('workCenter', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('workCenterProcess', ARRAY[]::TEXT[]);

-- Maintenance tables
SELECT attach_event_trigger('maintenanceSchedule', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('maintenanceScheduleItem', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('maintenanceDispatch', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('maintenanceDispatchEvent', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('maintenanceDispatchComment', ARRAY[]::TEXT[]);

-- HR child tables
SELECT attach_event_trigger('employeeJob', ARRAY[]::TEXT[]);