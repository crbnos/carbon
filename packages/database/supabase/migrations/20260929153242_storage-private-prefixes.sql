-- Company buckets: company backups (`exports/`) and audit-log archives
-- (`<companyId>/audit-logs/`) are read and written with the service role only.
DROP POLICY IF EXISTS "Company bucket access" ON storage.objects;
CREATE POLICY "Company bucket access" ON storage.objects
FOR ALL USING (
  bucket_id = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
  AND NOT starts_with(name, 'exports/')
  AND NOT starts_with(name, bucket_id || '/audit-logs/')
);

-- The feedback bucket has no readers or writers in the app.
UPDATE storage.buckets SET public = false WHERE id = 'feedback';
DROP POLICY IF EXISTS "Anyone can read the feedback buckets" ON storage.objects;
DROP POLICY IF EXISTS "Anyone with settings_create can insert into the feedback bucket" ON storage.objects;
