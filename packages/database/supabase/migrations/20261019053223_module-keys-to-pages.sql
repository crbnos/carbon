-- Phase 3 of page-level permissions (.ai/specs/2026-10-18-page-level-permissions.md):
-- no module key decides access. A module key passes only with a module grant,
-- so a person with page grants alone was refused by every check below. Each
-- check now names the page of what it guards; a module grant still covers it.
--
-- The managed functions (get_claims, the audit log functions and
-- util.can_manage_event_subscription) ship in 20261019053151_page-keys-in-functions.
-- This file holds what lives in migrations. It is the last migration that may
-- name a module key (no-module-permission-key, @carbon/checks): it renames the
-- storage policies whose old names held one.

-- Reading another person's claims as the permission editor: Users -> Accounts.
-- From the live definition (20260927225837, plus the search_path of 20261003224019).
CREATE OR REPLACE FUNCTION public.is_claims_admin(company text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
  BEGIN
    IF session_user = 'authenticator' THEN
      IF extract(epoch from now()) > coalesce((current_setting('request.jwt.claims', true)::jsonb)->>'exp', '0')::numeric THEN
        return false; -- jwt expired
      END IF;
      IF (current_setting('request.jwt.claims', true)::jsonb)->>'role' = 'service_role' THEN
        return true;
      END IF;
      RETURN company = ANY (coalesce(get_companies_with_employee_permission('users.accounts_update'), '{}'));
    ELSE -- not a user session (trigger etc.)
      return true;
    END IF;
  END;
$function$;

-- The stock transfer wizard (StockTransferWizard.tsx) is the only caller:
-- Inventory -> Stock Transfers. From the live definitions (20260923134421, plus
-- the search_path of 20261003224019).
CREATE OR REPLACE FUNCTION public.get_item_storage_unit_requirements_by_location(company_id text, location_id text)
 RETURNS TABLE("itemId" text, "itemReadableId" text, name text, description text, "itemTrackingType" "itemTrackingType", type "itemType", "thumbnailPath" text, "unitOfMeasureCode" text, "quantityOnHandInStorageUnit" numeric, "quantityRequiredByStorageUnit" numeric, "quantityIncoming" numeric, "storageUnitId" text, "storageUnitName" text, "isDefaultStorageUnit" boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  BEGIN
    -- Client-callable SECURITY DEFINER RPC: company_id comes from the caller,
    -- so scope it to a company the caller may view inventory for.
    IF NOT (company_id = ANY (get_companies_with_employee_permission('inventory.stockTransfers_view'))) THEN
      RAISE EXCEPTION 'Not authorized to view inventory for company %', company_id
        USING ERRCODE = '42501';
    END IF;
    RETURN QUERY

WITH
  item_shelves AS (
    SELECT DISTINCT
      il."itemId",
      il."storageUnitId"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
  ),
  open_job_requirements_in_storage_unit AS (
    SELECT
      jm."itemId",
      jm."storageUnitId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemandInStorageUnit"
    FROM "jobMaterial" jm
    INNER JOIN "job" j ON jm."jobId" = j."id"
    WHERE j."status" IN (
        'Planned',
        'Ready',
        'In Progress',
        'Paused'
      )
    AND jm."methodType" != 'Make to Order'
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY jm."itemId", jm."storageUnitId"
  ),
  active_stock_transfers_from_storage_unit AS (
    SELECT
      stl."itemId",
      stl."fromStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferFromStorageUnit"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."fromStorageUnitId" IS NOT NULL
    GROUP BY stl."itemId", stl."fromStorageUnitId"
  ),
  active_stock_transfers_to_storage_unit AS (
    SELECT
      stl."itemId",
      stl."toStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferToStorageUnit"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."toStorageUnitId" IS NOT NULL
    GROUP BY stl."itemId", stl."toStorageUnitId"
  ),
  open_jobs AS (
    SELECT
      j."itemId" AS "jobItemId",
      j."storageUnitId",
      SUM(j."productionQuantity" - j."quantityReceivedToInventory") AS "quantityFromProduction"
    FROM job j
    WHERE j."status" IN (
      'Ready',
      'In Progress',
      'Paused',
      'Planned'
    ) AND "salesOrderId" IS NULL
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    GROUP BY j."itemId", j."storageUnitId"
  ),
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      pol."storageUnitId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityFromPurchaseOrder"
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
    WHERE
      po."status" IN (
        'Planned',
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
    GROUP BY pol."itemId", pol."storageUnitId"
  ),
  item_ledgers_in_storage_unit AS (
    SELECT
      il."itemId" AS "ledgerItemId",
      il."storageUnitId",
      SUM(il."quantity") AS "quantityOnHandInStorageUnit"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
    GROUP BY il."itemId", il."storageUnitId"
  ),
  items_with_activity AS (
    SELECT DISTINCT active_items."itemId", active_items."storageUnitId"
    FROM (
      SELECT ils."ledgerItemId" AS "itemId", ils."storageUnitId"
      FROM item_ledgers_in_storage_unit ils
      WHERE ils."quantityOnHandInStorageUnit" <> 0

      UNION

      SELECT ojis."itemId", ojis."storageUnitId"
      FROM open_job_requirements_in_storage_unit ojis
      WHERE ojis."quantityOnProductionDemandInStorageUnit" > 0

      UNION

      SELECT astfs."itemId", astfs."storageUnitId"
      FROM active_stock_transfers_from_storage_unit astfs
      WHERE astfs."quantityOnActiveStockTransferFromStorageUnit" > 0

      UNION

      SELECT astts."itemId", astts."storageUnitId"
      FROM active_stock_transfers_to_storage_unit astts
      WHERE astts."quantityOnActiveStockTransferToStorageUnit" > 0

      UNION

      SELECT oj."jobItemId" AS "itemId", oj."storageUnitId"
      FROM open_jobs oj
      WHERE oj."quantityFromProduction" > 0

      UNION

      SELECT opo."purchaseOrderItemId" AS "itemId", opo."storageUnitId"
      FROM open_purchase_orders opo
      WHERE opo."quantityFromPurchaseOrder" > 0
    ) active_items
  )

SELECT
  ish."itemId",
  i."readableId" AS "itemReadableId",
  i."name",
  i."name" AS "description",
  i."itemTrackingType",
  i."type",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  COALESCE(ils."quantityOnHandInStorageUnit", 0) + COALESCE(astts."quantityOnActiveStockTransferToStorageUnit", 0) AS "quantityOnHandInStorageUnit",
  COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) + COALESCE(astfs."quantityOnActiveStockTransferFromStorageUnit", 0) AS "quantityRequiredByStorageUnit",
  COALESCE(oj."quantityFromProduction", 0) + COALESCE(opo."quantityFromPurchaseOrder", 0) AS "quantityIncoming",
  ish."storageUnitId",
  s."name" AS "storageUnitName",
  COALESCE(pm."defaultStorageUnitId" = ish."storageUnitId", false) AS "isDefaultStorageUnit"
FROM
  items_with_activity ish
  INNER JOIN "item" i ON i."id" = ish."itemId"
  LEFT JOIN "storageUnit" s ON s."id" = ish."storageUnitId"
  LEFT JOIN item_ledgers_in_storage_unit ils ON i."id" = ils."ledgerItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM ils."storageUnitId"
  LEFT JOIN open_job_requirements_in_storage_unit ojis ON i."id" = ojis."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM ojis."storageUnitId"
  LEFT JOIN active_stock_transfers_from_storage_unit astfs ON i."id" = astfs."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM astfs."storageUnitId"
  LEFT JOIN active_stock_transfers_to_storage_unit astts ON i."id" = astts."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM astts."storageUnitId"
  LEFT JOIN open_jobs oj ON i."id" = oj."jobItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM oj."storageUnitId"
  LEFT JOIN open_purchase_orders opo ON i."id" = opo."purchaseOrderItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM opo."storageUnitId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "pickMethod" pm ON pm."itemId" = i."id" AND pm."locationId" = location_id
ORDER BY (COALESCE(ils."quantityOnHandInStorageUnit", 0) + COALESCE(astts."quantityOnActiveStockTransferToStorageUnit", 0) - COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) - COALESCE(astfs."quantityOnActiveStockTransferFromStorageUnit", 0)) ASC;
  END;
$function$;

CREATE OR REPLACE FUNCTION public.get_item_storage_unit_requirements_by_location_and_item(company_id text, location_id text, item_id text DEFAULT NULL::text)
 RETURNS TABLE("itemId" text, "itemReadableId" text, name text, description text, "itemTrackingType" "itemTrackingType", type "itemType", "thumbnailPath" text, "unitOfMeasureCode" text, "quantityOnHandInStorageUnit" numeric, "quantityRequiredByStorageUnit" numeric, "quantityIncoming" numeric, "storageUnitId" text, "storageUnitName" text, "isDefaultStorageUnit" boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  BEGIN
    -- Client-callable SECURITY DEFINER RPC: company_id comes from the caller,
    -- so scope it to a company the caller may view inventory for.
    IF NOT (company_id = ANY (get_companies_with_employee_permission('inventory.stockTransfers_view'))) THEN
      RAISE EXCEPTION 'Not authorized to view inventory for company %', company_id
        USING ERRCODE = '42501';
    END IF;
    RETURN QUERY

WITH
  item_shelves AS (
    SELECT DISTINCT
      il."itemId",
      il."storageUnitId"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
      AND (item_id IS NULL OR il."itemId" = item_id)
  ),
  open_job_requirements_in_storage_unit AS (
    SELECT
      jm."itemId",
      jm."storageUnitId",
      SUM(jm."quantityToIssue") AS "quantityOnProductionDemandInStorageUnit"
    FROM "jobMaterial" jm
    INNER JOIN "job" j ON jm."jobId" = j."id"
    WHERE j."status" IN (
        'Planned',
        'Ready',
        'In Progress',
        'Paused'
      )
    AND jm."methodType" != 'Make to Order'
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    AND (item_id IS NULL OR jm."itemId" = item_id)
    GROUP BY jm."itemId", jm."storageUnitId"
  ),
  active_stock_transfers_from_storage_unit AS (
    SELECT
      stl."itemId",
      stl."fromStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferFromStorageUnit"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."fromStorageUnitId" IS NOT NULL
    AND (item_id IS NULL OR stl."itemId" = item_id)
    GROUP BY stl."itemId", stl."fromStorageUnitId"
  ),
  active_stock_transfers_to_storage_unit AS (
    SELECT
      stl."itemId",
      stl."toStorageUnitId" AS "storageUnitId",
      SUM(stl."outstandingQuantity") AS "quantityOnActiveStockTransferToStorageUnit"
    FROM "stockTransferLine" stl
    INNER JOIN "stockTransfer" st ON stl."stockTransferId" = st."id"
    WHERE st."status" IN ('Released', 'In Progress')
    AND st."companyId" = company_id
    AND st."locationId" = location_id
    AND stl."toStorageUnitId" IS NOT NULL
    AND (item_id IS NULL OR stl."itemId" = item_id)
    GROUP BY stl."itemId", stl."toStorageUnitId"
  ),
  open_jobs AS (
    SELECT
      j."itemId" AS "jobItemId",
      j."storageUnitId",
      SUM(j."productionQuantity" - j."quantityReceivedToInventory") AS "quantityFromProduction"
    FROM job j
    WHERE j."status" IN (
      'Ready',
      'In Progress',
      'Paused',
      'Planned'
    ) AND "salesOrderId" IS NULL
    AND j."companyId" = company_id
    AND j."locationId" = location_id
    AND (item_id IS NULL OR j."itemId" = item_id)
    GROUP BY j."itemId", j."storageUnitId"
  ),
  open_purchase_orders AS (
    SELECT
      pol."itemId" AS "purchaseOrderItemId",
      pol."storageUnitId",
      SUM(pol."quantityToReceive" * pol."conversionFactor") AS "quantityFromPurchaseOrder"
    FROM
      "purchaseOrder" po
      INNER JOIN "purchaseOrderLine" pol
        ON pol."purchaseOrderId" = po."id"
    WHERE
      po."status" IN (
        'Planned',
        'To Receive',
        'To Receive and Invoice'
      )
      AND po."companyId" = company_id
      AND pol."locationId" = location_id
      AND (item_id IS NULL OR pol."itemId" = item_id)
    GROUP BY pol."itemId", pol."storageUnitId"
  ),
  item_ledgers_in_storage_unit AS (
    SELECT
      il."itemId" AS "ledgerItemId",
      il."storageUnitId",
      SUM(il."quantity") AS "quantityOnHandInStorageUnit"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
      AND il."locationId" = location_id
      AND (item_id IS NULL OR il."itemId" = item_id)
    GROUP BY il."itemId", il."storageUnitId"
  ),
  items_with_activity AS (
    SELECT DISTINCT active_items."itemId", active_items."storageUnitId"
    FROM (
      SELECT ils."ledgerItemId" AS "itemId", ils."storageUnitId"
      FROM item_ledgers_in_storage_unit ils
      WHERE ils."quantityOnHandInStorageUnit" <> 0

      UNION

      SELECT ojis."itemId", ojis."storageUnitId"
      FROM open_job_requirements_in_storage_unit ojis
      WHERE ojis."quantityOnProductionDemandInStorageUnit" > 0

      UNION

      SELECT astfs."itemId", astfs."storageUnitId"
      FROM active_stock_transfers_from_storage_unit astfs
      WHERE astfs."quantityOnActiveStockTransferFromStorageUnit" > 0

      UNION

      SELECT astts."itemId", astts."storageUnitId"
      FROM active_stock_transfers_to_storage_unit astts
      WHERE astts."quantityOnActiveStockTransferToStorageUnit" > 0

      UNION

      SELECT oj."jobItemId" AS "itemId", oj."storageUnitId"
      FROM open_jobs oj
      WHERE oj."quantityFromProduction" > 0

      UNION

      SELECT opo."purchaseOrderItemId" AS "itemId", opo."storageUnitId"
      FROM open_purchase_orders opo
      WHERE opo."quantityFromPurchaseOrder" > 0
    ) active_items
  )

SELECT
  ish."itemId",
  i."readableId" AS "itemReadableId",
  i."name",
  i."name" AS "description",
  i."itemTrackingType",
  i."type",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."unitOfMeasureCode",
  COALESCE(ils."quantityOnHandInStorageUnit", 0) + COALESCE(astts."quantityOnActiveStockTransferToStorageUnit", 0) AS "quantityOnHandInStorageUnit",
  COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) + COALESCE(astfs."quantityOnActiveStockTransferFromStorageUnit", 0) AS "quantityRequiredByStorageUnit",
  COALESCE(oj."quantityFromProduction", 0) + COALESCE(opo."quantityFromPurchaseOrder", 0) AS "quantityIncoming",
  ish."storageUnitId",
  s."name" AS "storageUnitName",
  COALESCE(pm."defaultStorageUnitId" = ish."storageUnitId", false) AS "isDefaultStorageUnit"
FROM
  items_with_activity ish
  INNER JOIN "item" i ON i."id" = ish."itemId"
  LEFT JOIN "storageUnit" s ON s."id" = ish."storageUnitId"
  LEFT JOIN item_ledgers_in_storage_unit ils ON i."id" = ils."ledgerItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM ils."storageUnitId"
  LEFT JOIN open_job_requirements_in_storage_unit ojis ON i."id" = ojis."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM ojis."storageUnitId"
  LEFT JOIN active_stock_transfers_from_storage_unit astfs ON i."id" = astfs."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM astfs."storageUnitId"
  LEFT JOIN active_stock_transfers_to_storage_unit astts ON i."id" = astts."itemId" AND ish."storageUnitId" IS NOT DISTINCT FROM astts."storageUnitId"
  LEFT JOIN open_jobs oj ON i."id" = oj."jobItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM oj."storageUnitId"
  LEFT JOIN open_purchase_orders opo ON i."id" = opo."purchaseOrderItemId" AND ish."storageUnitId" IS NOT DISTINCT FROM opo."storageUnitId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "pickMethod" pm ON pm."itemId" = i."id" AND pm."locationId" = location_id
ORDER BY (COALESCE(ils."quantityOnHandInStorageUnit", 0) + COALESCE(astts."quantityOnActiveStockTransferToStorageUnit", 0) - COALESCE(ojis."quantityOnProductionDemandInStorageUnit", 0) - COALESCE(astfs."quantityOnActiveStockTransferFromStorageUnit", 0)) DESC;
  END;
$function$;

-- Storage policies are dropped and created, not renamed: on Supabase the
-- migration role may change a storage policy's expressions but not rename it.

-- Company logos (Settings -> Logos, CompanyLogoForm.tsx) are the public bucket's
-- only uploads: Settings -> Logos.
DROP POLICY IF EXISTS "Anyone with settings_create can insert into the public bucket" ON storage.objects;
CREATE POLICY "Logos create can insert into the public bucket" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'public'
    AND (storage.foldername(name))[1] = ANY ((SELECT get_companies_with_employee_permission('settings.logos_create'))::text[])
  );

DROP POLICY IF EXISTS "Anyone with settings_update can update the public bucket" ON storage.objects;
CREATE POLICY "Logos edit can update the public bucket" ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'public'
    AND (storage.foldername(name))[1] = ANY ((SELECT get_companies_with_employee_permission('settings.logos_update'))::text[])
  );

DROP POLICY IF EXISTS "Anyone with settings_delete can delete from public bucket" ON storage.objects;
CREATE POLICY "Logos full can delete from the public bucket" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'public'
    AND (storage.foldername(name))[1] = ANY ((SELECT get_companies_with_employee_permission('settings.logos_delete'))::text[])
  );

-- Staged CAD models: any item page, as items.createModelUploadUrl and
-- items.insertModelUpload gate (anyOfRule("item", "Edit")).
DROP POLICY IF EXISTS "Employees with parts_create can stage models" ON storage.objects;
CREATE POLICY "Item pages create can stage models" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'temp-staging'
    AND (storage.foldername(name))[1] = ANY ((SELECT
      get_companies_with_employee_permission('parts.parts_create')
      || get_companies_with_employee_permission('parts.materials_create')
      || get_companies_with_employee_permission('parts.tools_create')
      || get_companies_with_employee_permission('parts.consumables_create')
      || get_companies_with_employee_permission('parts.services_create'))::text[])
    AND (storage.foldername(name))[2] = 'models'
  );

DROP POLICY IF EXISTS "Employees with parts_update can update staged models" ON storage.objects;
CREATE POLICY "Item pages edit can update staged models" ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'temp-staging'
    AND (storage.foldername(name))[1] = ANY ((SELECT
      get_companies_with_employee_permission('parts.parts_update')
      || get_companies_with_employee_permission('parts.materials_update')
      || get_companies_with_employee_permission('parts.tools_update')
      || get_companies_with_employee_permission('parts.consumables_update')
      || get_companies_with_employee_permission('parts.services_update'))::text[])
    AND (storage.foldername(name))[2] = 'models'
  );

DROP POLICY IF EXISTS "Employees with parts_delete can delete staged models" ON storage.objects;
CREATE POLICY "Item pages full can delete staged models" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'temp-staging'
    AND (storage.foldername(name))[1] = ANY ((SELECT
      get_companies_with_employee_permission('parts.parts_delete')
      || get_companies_with_employee_permission('parts.materials_delete')
      || get_companies_with_employee_permission('parts.tools_delete')
      || get_companies_with_employee_permission('parts.consumables_delete')
      || get_companies_with_employee_permission('parts.services_delete'))::text[])
    AND (storage.foldername(name))[2] = 'models'
  );

-- Each company's audit log table keeps the read policy secure_audit_log_table
-- wrote when it was made. Write it again with the Audit Logs page.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'auditLog\_%' ESCAPE '\'
  LOOP
    PERFORM secure_audit_log_table(substring(t FROM length('auditLog_') + 1));
  END LOOP;
END $$;
