CREATE OR REPLACE FUNCTION public.sync_webhook_subscription(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ops TEXT[];
  v_name TEXT;
BEGIN
  IF p_operation = 'DELETE' THEN
    PERFORM delete_event_system_subscriptions_by_name(
      p_old->>'companyId', 'webhook-' || (p_old->>'id')
    );
    RETURN;
  END IF;

  v_name := 'webhook-' || (p_new->>'id');

  -- Clear first: `table` is editable and uniqueness is (companyId, name, table),
  -- so an upsert would strand the old row and fire the webhook twice.
  PERFORM delete_event_system_subscriptions_by_name(p_new->>'companyId', v_name);

  v_ops := ARRAY[]::TEXT[];
  IF (p_new->>'onInsert')::BOOLEAN THEN v_ops := array_append(v_ops, 'INSERT'); END IF;
  IF (p_new->>'onUpdate')::BOOLEAN THEN v_ops := array_append(v_ops, 'UPDATE'); END IF;
  IF (p_new->>'onDelete')::BOOLEAN THEN v_ops := array_append(v_ops, 'DELETE'); END IF;

  IF array_length(v_ops, 1) IS NULL THEN
    RETURN;
  END IF;

  PERFORM create_event_system_subscription(
    v_name,
    p_new->>'table',
    p_new->>'companyId',
    v_ops,
    'WEBHOOK',
    jsonb_build_object('url', p_new->>'url', 'webhookId', p_new->>'id'),
    '{}'::jsonb,
    COALESCE((p_new->>'active')::BOOLEAN, false)
  );
END;
$function$;
