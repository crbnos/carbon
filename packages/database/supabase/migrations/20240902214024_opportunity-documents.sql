ALTER TABLE "opportunity"
  ADD COLUMN "purchaseOrderDocumentPath" TEXT,
  ADD COLUMN "requestForQuoteDocumentPath" TEXT;

CREATE POLICY "Opportunity documents view requires sales_view" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_view', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'opportunity'
);

CREATE POLICY "Opportunity documents insert requires sales_create" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'opportunity'
);

CREATE POLICY "Opportunity documents update requires sales_update" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'opportunity'
);

CREATE POLICY "Opportunity documents delete requires sales_delete" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'opportunity'
);

CREATE POLICY "Opportunity line document view requires sales_view" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_view', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'opportunity-line'
);

CREATE POLICY "Opportunity line document insert requires sales_create" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'opportunity-line'
);

CREATE POLICY "Opportunity line document update requires sales_update" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'opportunity-line'
);

CREATE POLICY "Opportunity line document delete requires sales_delete" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'opportunity-line'
);

DROP POLICY IF EXISTS "Sales RFQ documents view requires sales_view" ON storage.objects;

DROP POLICY IF EXISTS "Sales RFQ documents insert requires sales_create" ON storage.objects;

DROP POLICY IF EXISTS "Sales RFQ documents update requires sales_update" ON storage.objects;

DROP POLICY IF EXISTS "Sales RFQ documents delete requires sales_delete" ON storage.objects;

DROP POLICY IF EXISTS "Quote line documents view requires sales_view" ON storage.objects; 

DROP POLICY IF EXISTS "Quote line document insert requires sales_create" ON storage.objects; 

DROP POLICY IF EXISTS "Quote line documents update requires sales_update" ON storage.objects; 

DROP POLICY IF EXISTS "Quote line documents delete requires sales_delete" ON storage.objects; 

DROP POLICY IF EXISTS "Sales RFQ line documents view requires sales_view" ON storage.objects; 

DROP POLICY IF EXISTS "Sales RFQ line documents insert requires sales_create" ON storage.objects; 

DROP POLICY IF EXISTS "Sales RFQ line documents update requires sales_update" ON storage.objects; 

DROP POLICY IF EXISTS "Sales RFQ line documents delete requires sales_delete" ON storage.objects; 

DROP VIEW "salesOrderLines";
CREATE OR REPLACE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."thumbnailPath", imu."thumbnailPath") as "thumbnailPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost"
  FROM "salesOrderLine" sl
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);