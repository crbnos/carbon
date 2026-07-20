-- temp-staging bucket — raw CAD uploads that may exceed the served-bucket size
-- cap land here first (high size limit). The optimizer reads the raw via a signed
-- URL, writes the gated (<=50 MB) optimised GLB to `private`, then the staged raw
-- is dropped (keep-raw-if-<=50MB happens in `private`; only genuinely-too-big raws
-- are stage-and-dropped). Browser uploads use the normal resumable storage path —
-- nothing streams through the assembler.
--
-- Design: .ai/specs/2026-07-15-assembler-model-pipeline.md (slice 2).
-- TTL/cleanup: a scheduled job prunes staged objects older than the retention
-- window as an orphan backstop (a failed drop-after-optimise never leaks storage);
-- wired separately, not in this migration.
--
-- Limits (Supabase enforces effective = min(global FILE_SIZE_LIMIT, per-bucket);
-- the global ceiling is set to 2.5 GB so these per-bucket caps take effect):
--   * temp-staging = 2.5 GB — raw CAD staging
--   * private      = 50 MB  — served artifacts only
--
-- Raw CAD uploads route to `temp-staging` (slice 2 flow-wiring, done): uploads,
-- the optimise/assembly jobs, and the document download links all read the raw
-- from this bucket, so a >50 MB raw no longer hits the `private` 50 MB cap.
--
-- CAVEAT (still pending): the lossless assembly-convert GLB (glbPath) is written
-- to `private`, so an assembly whose GLB exceeds 50 MB will 413 until the
-- structure-preserving assembly tier (slice 3) gates it.

-- 2.5 GB per-bucket cap for raw staged CAD. Private, company-scoped by the object
-- key's first path segment.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('temp-staging', 'temp-staging', false, 2500000000);

-- Served bucket holds only gated artifacts → cap at 50 MB per-bucket.
UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'private';

-- RLS mirrors the `private` model policies but with the current helpers
-- (`get_companies_with_employee_role` / `_permission`, per the RLS refactor —
-- the old `has_role`/`has_company_permission` pattern is deprecated). Scoped to
-- the temp-staging bucket + the `${companyId}/models/...` key layout, so the same
-- authenticated client that uploads a model can stage its raw. SELECT gates on
-- employee role; writes gate on the parts_* permission (which already implies
-- employee membership of that company).
CREATE POLICY "Employees can view staged models" ON storage.objects
FOR SELECT USING (
    bucket_id = 'temp-staging'
    AND (storage.foldername(name))[1] = ANY ((SELECT get_companies_with_employee_role())::text[])
    AND (storage.foldername(name))[2] = 'models'
);

CREATE POLICY "Employees with parts_create can stage models" ON storage.objects
FOR INSERT WITH CHECK (
    bucket_id = 'temp-staging'
    AND (storage.foldername(name))[1] = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
    AND (storage.foldername(name))[2] = 'models'
);

CREATE POLICY "Employees with parts_update can update staged models" ON storage.objects
FOR UPDATE USING (
    bucket_id = 'temp-staging'
    AND (storage.foldername(name))[1] = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
    AND (storage.foldername(name))[2] = 'models'
);

CREATE POLICY "Employees with parts_delete can delete staged models" ON storage.objects
FOR DELETE USING (
    bucket_id = 'temp-staging'
    AND (storage.foldername(name))[1] = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
    AND (storage.foldername(name))[2] = 'models'
);
