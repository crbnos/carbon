

ALTER POLICY "Users with documents can view documents where they are in the readGroups" ON "document" USING (
  has_company_permission ('documents_view', "companyId")
  AND (
    SELECT
      groups_for_user (auth.uid ()::text)
  ) && "readGroups"
);

ALTER POLICY "Users with documents_create can create documents where they are in the writeGroups" ON "document"
WITH
  CHECK (
    has_company_permission ('documents_create', "companyId")
    AND (
      SELECT
        groups_for_user (auth.uid ()::text)
    ) && "writeGroups"
  );

ALTER POLICY "Users with documents_update can update documents where they are in the writeGroups" ON "document" USING (
  has_company_permission ('documents_update', "companyId")
  AND (
    SELECT
      groups_for_user (auth.uid ()::text)
  ) && "writeGroups"
);

ALTER POLICY "Users with documents_delete can delete documents where they are in the writeGroups" ON "document" USING (
  has_company_permission ('documents_delete', "companyId")
  AND (
    SELECT
      groups_for_user (auth.uid ()::text)
  ) && "writeGroups"
);