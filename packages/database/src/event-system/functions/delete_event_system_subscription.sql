CREATE OR REPLACE FUNCTION public.delete_event_system_subscription(p_subscription_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id TEXT;
  v_handler_type TEXT;
BEGIN
  SELECT "companyId", "handlerType" INTO v_company_id, v_handler_type
  FROM "eventSystemSubscription"
  WHERE "id" = p_subscription_id;

  -- Nothing to delete (missing id, or already gone) — no-op, as before.
  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT util.can_manage_event_subscription(v_company_id, v_handler_type) THEN
    RAISE EXCEPTION 'Not authorized to manage % event subscriptions for company %', v_handler_type, v_company_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM "eventSystemSubscription" WHERE "id" = p_subscription_id;
END;
$function$;
