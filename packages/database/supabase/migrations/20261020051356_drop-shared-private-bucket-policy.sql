-- The legacy shared `private` bucket is retired: every company's files live in
-- its own bucket, and nothing reads or writes `private` any more. Drop its
-- storage policy so the bucket itself can be emptied and deleted.
--
-- The bucket is not deleted here: Storage owns its objects, so it is emptied
-- and removed from the dashboard (or the Storage API) after this ships.
--
-- `company_id_not_reserved_bucket_id` still reserves the id `private`, so no
-- company can ever be created with that id and claim a bucket of that name.
DROP POLICY IF EXISTS "Shared Private Bucket" ON storage.objects;
