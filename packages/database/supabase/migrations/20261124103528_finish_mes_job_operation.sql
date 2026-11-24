-- Finish can close timers and receive the job from its operation status trigger.
-- Take the same job lock as receipt and terminal production/scrap before that update.
CREATE OR REPLACE FUNCTION public.finish_mes_job_operation(
  p_job_operation_id text, p_company_id text, p_user_id text
) RETURNS TABLE(id text, "jobId" text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE
  v_job_id text;
BEGIN
  SELECT j.id INTO v_job_id
  FROM "jobOperation" op
  JOIN job j ON j.id = op."jobId" AND j."companyId" = op."companyId"
  WHERE op.id = p_job_operation_id AND op."companyId" = p_company_id
  FOR NO KEY UPDATE OF j;

  RETURN QUERY
    UPDATE "jobOperation" op
    SET status = 'Done', "updatedBy" = p_user_id
    WHERE op.id = p_job_operation_id AND op."companyId" = p_company_id
      AND op."jobId" = v_job_id
    RETURNING op.id, op."jobId";
END;
$$;

REVOKE ALL ON FUNCTION public.finish_mes_job_operation(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_mes_job_operation(text, text, text) TO service_role;
