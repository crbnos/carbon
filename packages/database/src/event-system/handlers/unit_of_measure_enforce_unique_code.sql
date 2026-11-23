CREATE OR REPLACE FUNCTION public.unit_of_measure_enforce_unique_code(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN
    RETURN;
  END IF;

  -- Codes keep their case (kg, mm), so the unique constraint alone would let
  -- KG and kg name two units. Checked only when the code is set or changed,
  -- so a pair that predates this check can still be edited.
  IF p_operation = 'UPDATE' AND p_new->>'code' IS NOT DISTINCT FROM p_old->>'code' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "unitOfMeasure"
    WHERE "companyId" = p_new->>'companyId'
      AND lower("code") = lower(p_new->>'code')
      AND "id" IS DISTINCT FROM p_new->>'id'
  ) THEN
    RAISE EXCEPTION 'A unit of measure with the code % already exists', p_new->>'code'
      USING ERRCODE = 'unique_violation';
  END IF;
END;
$function$;
