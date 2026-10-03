CREATE OR REPLACE FUNCTION public.create_event_system_subscription(p_name text, p_table text, p_company_id text, p_operations text[], p_handler_type text, p_config jsonb DEFAULT '{}'::jsonb, p_filter jsonb DEFAULT '{}'::jsonb, p_active boolean DEFAULT true)
 RETURNS TABLE(id text, name text, "handlerType" text, "table" text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT util.can_manage_event_subscription(p_company_id, p_handler_type) THEN
    RAISE EXCEPTION 'Not authorized to manage % event subscriptions for company %', p_handler_type, p_company_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO "eventSystemSubscription" (
    "name", "table", "companyId", "operations",
    "handlerType", "config", "filter", "active"
  )
  VALUES (
    p_name, p_table, p_company_id, p_operations,
    p_handler_type, p_config, p_filter, p_active
  )
  ON CONFLICT ON CONSTRAINT "unique_subscription_name_per_company"
  DO UPDATE SET
    "operations" = EXCLUDED."operations",
    "filter" = EXCLUDED."filter",
    "handlerType" = EXCLUDED."handlerType",
    "config" = EXCLUDED."config",
    "active" = EXCLUDED."active"
  -- Replacing a subscription also needs the right to manage what it was.
  WHERE util.can_manage_event_subscription(
    p_company_id,
    "eventSystemSubscription"."handlerType"
  )
  RETURNING
    "eventSystemSubscription"."id",
    "eventSystemSubscription"."name",
    "eventSystemSubscription"."handlerType",
    "eventSystemSubscription"."table";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized to replace event subscription "%" for company %', p_name, p_company_id
      USING ERRCODE = '42501';
  END IF;
END;
$function$;
