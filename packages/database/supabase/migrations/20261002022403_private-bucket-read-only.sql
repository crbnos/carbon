-- The legacy shared `private` bucket stays readable and deletable but takes no
-- new files: no row may be written into it. An UPDATE that moves a file out to
-- the caller's own company bucket still passes "Company bucket access".
ALTER POLICY "Shared Private Bucket" ON storage.objects WITH CHECK (false);
