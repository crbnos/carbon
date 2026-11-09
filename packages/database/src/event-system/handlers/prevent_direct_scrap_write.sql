CREATE OR REPLACE FUNCTION public.prevent_direct_scrap_write(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Only a client that reaches the database directly: the operations that
  -- apply a scrap approval rule write as the service role or over the
  -- server's connection, after the approval.
  IF COALESCE(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') THEN
    RETURN;
  END IF;
  -- A write another interceptor made, such as the operation totals following
  -- a quantity row. Deleting scrap adds none.
  IF pg_trigger_depth() > 1 OR p_operation = 'DELETE' THEN
    RETURN;
  END IF;

  IF p_table = 'productionQuantity' THEN
    IF p_new->>'type' IS DISTINCT FROM 'Scrap' THEN
      RETURN;
    END IF;
  ELSIF COALESCE((p_new->>'quantityScrapped')::numeric, 0)
    = COALESCE((p_old->>'quantityScrapped')::numeric, 0) THEN
    RETURN;
  END IF;

  -- Any enabled rule, whatever its tier: the database does not value scrap.
  IF EXISTS (
    SELECT 1 FROM "approvalRule"
    WHERE "documentType" = 'scrap'
      AND "companyId" = COALESCE(p_new->>'companyId', p_old->>'companyId')
      AND "enabled"
  ) THEN
    RAISE EXCEPTION 'Scrap approval rules are on for this company. Record scrap on the shop floor or on the job''s quantities, where it can be approved.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$function$;
