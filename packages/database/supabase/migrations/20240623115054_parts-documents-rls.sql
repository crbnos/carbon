-- Parts documents
CREATE POLICY "Employees with parts_view can view internal parts documents" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('parts_view', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'parts'
);

CREATE POLICY "Internal parts documents insert requires parts_create" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('parts_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'parts'
);

CREATE POLICY "Internal parts documents update requires parts_update" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('parts_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'parts'
);

CREATE POLICY "Internal parts documents delete requires parts_delete" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('parts_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'parts'
);
