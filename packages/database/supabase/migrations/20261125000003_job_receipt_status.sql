-- The ERP caller sweeps lineside stock only once the job has finished. Read
-- the result before the receipt releases its job lock.
CREATE OR REPLACE FUNCTION public.receive_job_to_inventory(
  p_job_id text, p_quantity_complete numeric, p_company_id text, p_user_id text,
  p_location_id text DEFAULT NULL, p_storage_unit_id text DEFAULT NULL,
  p_expected_serials text[] DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_completed boolean;
BEGIN
  -- Production staff can receive jobs even when their role cannot read itemLedger.
  PERFORM public.assert_company_access(p_company_id, 'production_update');
  PERFORM util.post_job_receipt(
    p_job_id, p_quantity_complete, p_storage_unit_id, p_location_id, p_company_id, p_user_id, p_expected_serials, false
  );
  SELECT status IN ('Completed', 'Closed') INTO STRICT v_completed
    FROM public.job WHERE id = p_job_id AND "companyId" = p_company_id;
  RETURN v_completed;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_job_to_inventory(text, numeric, text, text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_job_to_inventory(text, numeric, text, text, text, text, text[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
