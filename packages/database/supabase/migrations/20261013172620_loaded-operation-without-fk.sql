-- workCenter."loadedJobOperationId" keeps no foreign key. With one, PostgREST
-- saw two relationships between jobOperation and workCenter (this pointer and
-- jobOperation."workCenterId"), so every existing embed of one from the other
-- (`jobOperation` → `workCenter(name)`, …) failed with PGRST201. The pointer is
-- cleared by the sync_unload_work_center_operation interceptor instead: when
-- the operation becomes Done or Canceled, and when it is deleted.
ALTER TABLE "workCenter"
  DROP CONSTRAINT IF EXISTS "workCenter_loadedJobOperationId_fkey";
