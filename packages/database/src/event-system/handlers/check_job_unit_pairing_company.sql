CREATE OR REPLACE FUNCTION public.check_job_unit_pairing_company(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operation = 'DELETE' OR (p_operation = 'UPDATE'
    AND (p_new->>'companyId', p_new->>'jobId', p_new->>'jobMaterialId', p_new->>'sourceId', p_new->>'outputId')
      IS NOT DISTINCT FROM
        (p_old->>'companyId', p_old->>'jobId', p_old->>'jobMaterialId', p_old->>'sourceId', p_old->>'outputId')) THEN
    RETURN;
  END IF;

  -- The older parents have globally unique, single-column keys. Validate
  -- their company and the job material's parent without adding indexes to
  -- every existing tracked unit merely to express composite foreign keys.
  IF NOT EXISTS (
    SELECT 1 FROM job j
    JOIN "trackedEntity" source ON source.id = p_new->>'sourceId' AND source."companyId" = j."companyId"
    JOIN "trackedEntity" output ON output.id = p_new->>'outputId' AND output."companyId" = j."companyId"
    WHERE j.id = p_new->>'jobId' AND j."companyId" = p_new->>'companyId'
      AND (p_new->>'jobMaterialId' IS NULL OR EXISTS (
        SELECT 1 FROM "jobMaterial" m WHERE m.id = p_new->>'jobMaterialId'
          AND m."companyId" = j."companyId" AND m."jobId" = j.id
      ))
  ) THEN
    RAISE EXCEPTION 'The paired units and job material must belong to this job and company.';
  END IF;
END;
$function$;
