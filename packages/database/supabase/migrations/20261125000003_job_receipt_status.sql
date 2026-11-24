-- The ERP caller sweeps lineside stock only once the job has finished. Read
-- the result before the receipt releases its job lock.
CREATE FUNCTION public.receive_job_to_inventory(
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
  PERFORM public.complete_job_to_inventory(
    p_job_id, p_quantity_complete, p_storage_unit_id, p_location_id, p_company_id, p_user_id
  );
  -- The MES may have completed another serial while the ERP dialog was open.
  -- Verify what reached inventory under the same job lock. A mismatch rolls
  -- back this receipt. A retry whose named units already arrived succeeds.
  IF p_expected_serials IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(p_expected_serials) AS expected(serial)
    WHERE NOT EXISTS (
      SELECT 1 FROM public."jobUnitPairing" pair
      JOIN public."itemLedger" receipt ON receipt."companyId" = pair."companyId"
        AND receipt."documentId" = pair."jobId" AND receipt."trackedEntityId" = pair."outputId"
        AND receipt."documentType" = 'Job Receipt' AND receipt.quantity = 1
      WHERE pair."companyId" = p_company_id AND pair."jobId" = p_job_id
        AND pair.serial = expected.serial AND pair."releasedAt" IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'The packed serials ready for receipt changed. Reopen the job receipt and verify the serials.';
  END IF;
  SELECT status IN ('Completed', 'Closed') INTO STRICT v_completed
    FROM public.job WHERE id = p_job_id AND "companyId" = p_company_id;
  RETURN v_completed;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_job_to_inventory(text, numeric, text, text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_job_to_inventory(text, numeric, text, text, text, text, text[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
