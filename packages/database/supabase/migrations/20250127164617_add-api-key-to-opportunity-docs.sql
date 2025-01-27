CREATE OR REPLACE FUNCTION get_companies_with_permission(permission text) RETURNS text[]
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
    AS $$
    DECLARE
      permission_companies text[];
      api_key_company text;
    BEGIN
      -- Get companies from user permissions
      SELECT jsonb_to_text_array(coalesce(permissions->permission, '[]')) 
      INTO permission_companies 
      FROM public."userPermission" 
      WHERE id = auth.uid()::text;

      -- Get company from API key if present
      SELECT "companyId"::text INTO api_key_company 
      FROM "apiKey" 
      WHERE "key" = ((current_setting('request.headers'::text, true))::json ->> 'api-key'::text);

      -- If API key exists for a company, add it to results
      IF api_key_company IS NOT NULL THEN
        IF permission_companies IS NULL THEN
          permission_companies := ARRAY[api_key_company];
        ELSE
          permission_companies := array_append(permission_companies, api_key_company);
        END IF;
      END IF;

      -- Handle special case where user has global permission ('0')
      IF permission_companies IS NOT NULL AND '0' = ANY(permission_companies) THEN
        SELECT array_agg(id::text) INTO permission_companies FROM company;
      END IF;

      RETURN permission_companies;
    END;
$$;



ALTER POLICY "Opportunity documents view requires sales_view" ON storage.objects 
USING (
    bucket_id = 'private'
    AND (storage.foldername(name))[1] = ANY((SELECT get_companies_with_permission('sales_view')))
    AND (storage.foldername(name))[2] = 'opportunity'
);

ALTER POLICY "Opportunity documents insert requires sales_create" ON storage.objects 
WITH CHECK (
    bucket_id = 'private'
    AND (storage.foldername(name))[1] = ANY((SELECT get_companies_with_permission('sales_create')))
    AND (storage.foldername(name))[2] = 'opportunity'
);

ALTER POLICY "Opportunity documents update requires sales_update" ON storage.objects 
USING (
    bucket_id = 'private'
    AND (storage.foldername(name))[1] = ANY((SELECT get_companies_with_permission('sales_update')))
    AND (storage.foldername(name))[2] = 'opportunity'
);

ALTER POLICY "Opportunity documents delete requires sales_delete" ON storage.objects 
USING (
    bucket_id = 'private'
    AND (storage.foldername(name))[1] = ANY((SELECT get_companies_with_permission('sales_delete')))
    AND (storage.foldername(name))[2] = 'opportunity'
);

ALTER POLICY "Opportunity line document view requires sales_view" ON storage.objects 
USING (
    bucket_id = 'private'
    AND (storage.foldername(name))[1] = ANY((SELECT get_companies_with_permission('sales_view')))
    AND (storage.foldername(name))[2] = 'opportunity-line'
);

ALTER POLICY "Opportunity line document insert requires sales_create" ON storage.objects 
WITH CHECK (
    bucket_id = 'private'
    AND (storage.foldername(name))[1] = ANY((SELECT get_companies_with_permission('sales_create')))
    AND (storage.foldername(name))[2] = 'opportunity-line'
);

ALTER POLICY "Opportunity line document update requires sales_update" ON storage.objects 
USING (
    bucket_id = 'private'
    AND (storage.foldername(name))[1] = ANY((SELECT get_companies_with_permission('sales_update')))
    AND (storage.foldername(name))[2] = 'opportunity-line'
);

ALTER POLICY "Opportunity line document delete requires sales_delete" ON storage.objects 
USING (
    bucket_id = 'private'
    AND (storage.foldername(name))[1] = ANY((SELECT get_companies_with_permission('sales_delete')))
    AND (storage.foldername(name))[2] = 'opportunity-line'
);