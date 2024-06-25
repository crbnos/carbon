-- Internal purchasing documents

CREATE POLICY "Internal purchasing documents view requires purchasing_view" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_view', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing'
    AND (storage.foldername(name))[3] = 'internal'
);

CREATE POLICY "Internal purchasing documents insert requires purchasing_create" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing'
    AND (storage.foldername(name))[3] = 'internal'
);

CREATE POLICY "Internal purchasing documents update requires purchasing_update" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing'
    AND (storage.foldername(name))[3] = 'internal'
);

CREATE POLICY "Internal purchasing documents delete requires purchasing_delete" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing'
    AND (storage.foldername(name))[3] = 'internal'
);

-- External purchasing documents

CREATE POLICY "External purchasing documents view requires purchasing_view" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_view', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing'
    AND (storage.foldername(name))[3] = 'external'
);

CREATE POLICY "External purchasing documents insert requires purchasing_create" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing'
    AND (storage.foldername(name))[3] = 'external'
);

CREATE POLICY "External purchasing documents update requires purchasing_update" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing'
    AND (storage.foldername(name))[3] = 'external'
);

CREATE POLICY "External purchasing documents delete requires purchasing_delete" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'purchasing'
    AND (storage.foldername(name))[3] = 'external'
);