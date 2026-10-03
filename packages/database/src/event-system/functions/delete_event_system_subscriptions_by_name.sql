CREATE OR REPLACE FUNCTION public.delete_event_system_subscriptions_by_name(p_company_id text, p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_handler_type TEXT;
BEGIN
  -- A (companyId, name) group is one handler type in practice; if any matching
  -- row is WEBHOOK, require the stricter WEBHOOK gate. NULL (no rows) falls
  -- through to the membership gate on a delete that affects nothing.
  SELECT CASE WHEN bool_or("handlerType" = 'WEBHOOK') THEN 'WEBHOOK' ELSE max("handlerType") END
  INTO v_handler_type
  FROM "eventSystemSubscription"
  WHERE "companyId" = p_company_id AND "name" = p_name;

  IF NOT util.can_manage_event_subscription(p_company_id, COALESCE(v_handler_type, '')) THEN
    RAISE EXCEPTION 'Not authorized to manage event subscriptions for company %', p_company_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM "eventSystemSubscription"
  WHERE "companyId" = p_company_id AND "name" = p_name;
END;
$function$;
