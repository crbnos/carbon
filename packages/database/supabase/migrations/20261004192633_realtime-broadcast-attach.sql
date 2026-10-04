-- Realtime moves from postgres_changes to broadcast.
--
-- The broadcast functions and the realtime.messages policies are in the
-- generated migration 20261004191247_realtime-broadcast.sql (authz manifest +
-- event-system/functions). This file attaches them and removes the old path.
--
-- The table lists mirror packages/database/src/realtime-tables.ts
-- (REALTIME_TABLES, REALTIME_REFERENCE_TABLES, REALTIME_USER_TABLES).

-- 1. Per-table topics: company:<companyId>:<table>
SELECT attach_statement_handler('assemblyPlanJob', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('changeOrder', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('customField', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('customer', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('documentExtraction', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('documentTemplate', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('employee', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('implementationCheckState', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('implementationFieldValue', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('implementationHub', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('implementationRow', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('inspection', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('inventoryCount', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('item', ARRAY['broadcast_table_changes']);
-- attach_statement_handler replaces a table's handlers, so itemLedger restates its own.
SELECT attach_statement_handler('itemLedger', ARRAY['apply_item_stock_quantities', 'broadcast_table_changes']);
SELECT attach_statement_handler('itemStockQuantities', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('itemSupersession', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('job', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('jobMakeMethod', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('jobMaterial', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('jobOperation', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('jobOperationNote', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('jobOperationStep', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('jobOperationStepRecord', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('journal', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('maintenanceDispatch', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('material', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('materialForm', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('materialSubstance', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('modelUpload', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('nonConformance', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('nonConformanceActionTask', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('part', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('pickingList', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('pickingListLine', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('printJob', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('productionEvent', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('productionQuantity', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('purchaseInvoice', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('purchaseInvoiceLine', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('purchaseOrder', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('purchaseOrderLine', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('purchaseReturnOrder', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('purchasingRfq', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('quote', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('quoteLine', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('quoteMaterial', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('quoteOperation', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('receipt', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('receiptLine', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('salesInvoice', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('salesInvoiceLine', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('salesOrder', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('salesOrderLine', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('salesReturnOrder', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('salesRfq', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('salesRfqLine', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('shipment', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('shipmentLine', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('stockTransfer', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('supplier', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('supplierQuote', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('trackedEntity', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('warehouseTransfer', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('workflowRun', ARRAY['broadcast_table_changes']);
SELECT attach_statement_handler('workflowStepRun', ARRAY['broadcast_table_changes']);

-- 2. Reference lists share one topic: company:<companyId>:reference
SELECT attach_statement_handler('ability', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('customerContact', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('customerLocation', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('customerType', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('itemPostingGroup', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('location', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('materialType', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('nonConformanceType', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('paymentTerm', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('procedure', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('process', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('qualityDocument', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('shippingMethod', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('storageUnit', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('supplierContact', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('supplierLocation', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('supplierProcess', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('supplierType', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('unitOfMeasure', ARRAY['broadcast_reference_changes']);
SELECT attach_statement_handler('workCenter', ARRAY['broadcast_reference_changes']);

-- 3. Per-user topics: user:<userId>:<table>
SELECT attach_statement_handler('notification', ARRAY['broadcast_user_changes']);

-- 4. Nothing subscribes to postgres_changes any more: empty the publication.
DO $$
DECLARE
  published RECORD;
BEGIN
  FOR published IN
    SELECT schemaname, tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
  LOOP
    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I',
      published.schemaname, published.tablename
    );
  END LOOP;
END $$;

-- 5. One hash per live list, over the rows the caller can read (SECURITY INVOKER,
-- so table RLS applies exactly as it does to the list fetch). The client compares
-- it with the hash stored beside its IndexedDB copy and skips the fetch on a match.
-- The columns are the ones each list selects (useLiveList definitions).
CREATE OR REPLACE FUNCTION public.list_checksums(p_company_id TEXT)
RETURNS TABLE (list TEXT, checksum TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT 'items', md5(coalesce(string_agg(md5(row(
      i."id", i."readableId", i."revision", i."readableIdWithRevision",
      i."unitOfMeasureCode", i."name", i."type", i."replenishmentSystem",
      i."active", i."itemTrackingType", s."supersessionMode", s."successorItemId"
    )::text), '' ORDER BY i."id"), ''))
  FROM "item" i
  LEFT JOIN "itemSupersession" s ON s."itemId" = i."id"
  WHERE i."companyId" = p_company_id
  UNION ALL
  SELECT 'mesItems', md5(coalesce(string_agg(md5(row(
      i."id", i."readableIdWithRevision", i."name", i."type",
      i."replenishmentSystem", i."itemTrackingType", i."active",
      i."thumbnailPath", m."thumbnailPath"
    )::text), '' ORDER BY i."id"), ''))
  FROM "item" i
  LEFT JOIN "modelUpload" m ON m."id" = i."modelUploadId"
  WHERE i."companyId" = p_company_id
  UNION ALL
  SELECT 'customers', md5(coalesce(string_agg(md5(row(
      "id", "name", "website", "readableId")::text), '' ORDER BY "id"), ''))
  FROM "customer" WHERE "companyId" = p_company_id
  UNION ALL
  SELECT 'suppliers', md5(coalesce(string_agg(md5(row(
      "id", "name", "website", "supplierStatus", "readableId")::text), '' ORDER BY "id"), ''))
  FROM "supplier" WHERE "companyId" = p_company_id
  UNION ALL
  SELECT 'people', md5(coalesce(string_agg(md5(row(
      "id", "name", "email", "avatarUrl", "active")::text), '' ORDER BY "id"), ''))
  FROM "employees" WHERE "companyId" = p_company_id;
$$;

REVOKE ALL ON FUNCTION public.list_checksums(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_checksums(TEXT) TO authenticated;
