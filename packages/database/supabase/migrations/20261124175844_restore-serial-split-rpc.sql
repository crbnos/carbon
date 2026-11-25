-- The split runs under the caller's RLS. Read exclusions as the owner because
-- an integration can call this RPC without access to issues or the stock ledger.
CREATE OR REPLACE FUNCTION util.lock_serial_split_exclusions(
  p_job_id text, p_make_method_id text, p_company_id text
) RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM assert_company_access(p_company_id);
  PERFORM 1 FROM "job" j WHERE j.id = p_job_id AND j."companyId" = p_company_id FOR UPDATE;
  PERFORM te.id FROM "trackedEntity" te
    WHERE te."companyId" = p_company_id AND te.attributes->>'Job Make Method' = p_make_method_id
    ORDER BY te.id FOR UPDATE;

  -- Read after waiting for dispositions and receipts. A previous stock receipt
  -- remains attached to its original seed, even if no issue holds it.
  RETURN ARRAY(
    SELECT te.id FROM "trackedEntity" te JOIN "unitQualityHold" h
      ON h."trackedEntityId" = te.id AND h."companyId" = te."companyId"
    WHERE te."companyId" = p_company_id AND te.attributes->>'Job Make Method' = p_make_method_id
    UNION
    SELECT il."trackedEntityId" FROM "itemLedger" il
    WHERE il."companyId" = p_company_id AND il."documentId" = p_job_id
      AND il."documentType" = 'Job Receipt' AND il."trackedEntityId" IS NOT NULL
  );
END;
$function$;

-- Forked from 20261124083716_close_quality_hold_write_paths.sql. BEGIN ATOMIC
-- resolves the private helper names at creation. API roles need EXECUTE on the
-- helpers but no USAGE on util; the writes retain the original invoker rights.
CREATE OR REPLACE FUNCTION public.split_serial_units_for_completion(
  p_job_id text, p_make_method_id text, p_company_id text, p_count integer
) RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path TO 'public'
BEGIN ATOMIC
  SELECT COALESCE((
    SELECT util.split_receivable_serial_units(p_job_id, m.id, p_company_id, p_count,
      util.lock_serial_split_exclusions(p_job_id, m.id, p_company_id))
    FROM "jobMakeMethod" m
    WHERE m.id = p_make_method_id AND m."jobId" = p_job_id AND m."companyId" = p_company_id
      AND p_count > 0
  ), 0);
END;

COMMENT ON FUNCTION public.split_serial_units_for_completion(text, text, text, integer) IS
  'Deprecated. Splits eligible units for completion, keeping held and previously received units intact. Job receipt now splits units automatically.';

NOTIFY pgrst, 'reload schema';
