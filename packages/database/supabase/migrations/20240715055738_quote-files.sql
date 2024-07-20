-- Internal quote documents

CREATE POLICY "Quote documents view requires sales_view" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_view', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'quote'
);

CREATE POLICY "Quote line documents view requires sales_view" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_view', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'quote-line'
);

CREATE POLICY "Quote documents insert requires sales_create" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'quote'
);

CREATE POLICY "Quote line document insert requires sales_create" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'quote-line'
);

CREATE POLICY "Quote documents update requires sales_update" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'quote'
);

CREATE POLICY "Quote line documents update requires sales_update" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'quote-line'
);

CREATE POLICY "Quote documents delete requires sales_delete" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'quote'
);

CREATE POLICY "Quote line documents delete requires sales_delete" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'quote-line'
);
