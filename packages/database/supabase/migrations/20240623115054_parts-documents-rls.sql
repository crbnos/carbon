-- Parts documents
CREATE POLICY "Employees can view internal parts documents" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee')
    AND (storage.foldername(name))[1] = ANY(
            select "companyId" from "userToCompany" where "userId" = auth.uid()::text
        )
    AND (storage.foldername(name))[2] = 'parts'
);

CREATE POLICY "Internal parts documents insert requires parts_create" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee')
    AND (storage.foldername(name))[1] = ANY(
            get_permission_companies('parts_create')
        )
    AND (storage.foldername(name))[2] = 'parts'
);

CREATE POLICY "Internal parts documents update requires parts_update" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee')
    AND (storage.foldername(name))[1] = ANY(
            get_permission_companies('parts_update')
        )
    AND (storage.foldername(name))[2] = 'parts'
);

CREATE POLICY "Internal parts documents delete requires parts_delete" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee')
    AND (storage.foldername(name))[1] = ANY(
            get_permission_companies('parts_delete')
        )
    AND (storage.foldername(name))[2] = 'parts'
);
