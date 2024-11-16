CREATE OR REPLACE FUNCTION get_next_sequence(
  sequence_name text,
  company_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_suffix text;
  v_next integer;
  v_size integer;
  v_step integer;
  v_next_value integer;
  v_next_sequence text;
  v_derived_prefix text;
  v_derived_suffix text;
BEGIN
  IF session_user = 'authenticator' THEN
    IF NOT (has_role('employee', company_id) OR has_valid_api_key_for_company(company_id)) THEN
      RAISE EXCEPTION 'Insufficient permissions';
    END IF;
  END IF;

  -- Get sequence details
  SELECT prefix, suffix, next, size, step 
  INTO STRICT v_prefix, v_suffix, v_next, v_size, v_step
  FROM sequence 
  WHERE "table" = sequence_name 
  AND "companyId" = company_id;

  -- Calculate next value
  v_next_value := COALESCE(v_next, 0) + COALESCE(v_step, 1);
  
  -- Format sequence number
  v_next_sequence := lpad(v_next_value::text, COALESCE(v_size, 4), '0');
  
  -- Interpolate date variables in prefix/suffix
  v_derived_prefix := COALESCE(v_prefix, '');
  v_derived_prefix := replace(v_derived_prefix, '%{yyyy}', to_char(current_date, 'YYYY'));
  v_derived_prefix := replace(v_derived_prefix, '%{yy}', to_char(current_date, 'YY'));
  v_derived_prefix := replace(v_derived_prefix, '%{mm}', to_char(current_date, 'MM'));
  v_derived_prefix := replace(v_derived_prefix, '%{dd}', to_char(current_date, 'DD'));
  
  v_derived_suffix := COALESCE(v_suffix, '');
  v_derived_suffix := replace(v_derived_suffix, '%{yyyy}', to_char(current_date, 'YYYY'));
  v_derived_suffix := replace(v_derived_suffix, '%{yy}', to_char(current_date, 'YY'));
  v_derived_suffix := replace(v_derived_suffix, '%{mm}', to_char(current_date, 'MM')); 
  v_derived_suffix := replace(v_derived_suffix, '%{dd}', to_char(current_date, 'DD'));

  -- Update sequence
  UPDATE sequence 
  SET next = v_next_value,
      "updatedBy" = 'system'
  WHERE "table" = sequence_name 
  AND "companyId" = company_id;

  -- Return formatted sequence
  RETURN v_derived_prefix || v_next_sequence || v_derived_suffix;

EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'Sequence not found for table % and company %', sequence_name, company_id;
  WHEN OTHERS THEN
    RAISE;
END;
$$;


