CREATE POLICY "Requests with an API key can view part models" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_valid_api_key_for_company((storage.foldername(name))[1])
    AND ((storage.foldername(name))[2] = 'models' OR (storage.foldername(name))[2] = 'thumbnails')
);

CREATE POLICY "Requests with an API key can upload models" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_valid_api_key_for_company((storage.foldername(name))[1])
    AND ((storage.foldername(name))[2] = 'models' OR (storage.foldername(name))[2] = 'thumbnails')
);

CREATE POLICY "Requests with an API key can update models" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_valid_api_key_for_company((storage.foldername(name))[1])
    AND ((storage.foldername(name))[2] = 'models' OR (storage.foldername(name))[2] = 'thumbnails')
);

CREATE POLICY "Requests with an API key can delete models" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_valid_api_key_for_company((storage.foldername(name))[1])
    AND ((storage.foldername(name))[2] = 'models' OR (storage.foldername(name))[2] = 'thumbnails')
);

