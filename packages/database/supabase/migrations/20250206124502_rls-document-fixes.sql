ALTER POLICY "SELECT" ON "public"."document" 
  USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_permission ('documents_view')
      )::text[]
    )
    AND (
      has_valid_api_key_for_company("companyId") OR 
      (groups_for_user(auth.uid()::text) && "readGroups") = true
    )
  );

ALTER POLICY "INSERT" ON "public"."document" 
  WITH CHECK (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_permission ('documents_create')
      )::text[]
    )
   AND (
      has_valid_api_key_for_company("companyId") OR 
      (groups_for_user(auth.uid()::text) && "writeGroups") = true
    )
  );

ALTER POLICY "UPDATE" ON "public"."document"
  USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_permission ('documents_update')
      )::text[]
    )
    AND (
      has_valid_api_key_for_company("companyId") OR 
      (groups_for_user(auth.uid()::text) && "writeGroups") = true
    )
  );

ALTER POLICY "DELETE" ON "public"."document"
  USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_permission ('documents_delete')
      )::text[]
    )
    AND (
      has_valid_api_key_for_company("companyId") OR 
      (groups_for_user(auth.uid()::text) && "writeGroups") = true
    )
  );