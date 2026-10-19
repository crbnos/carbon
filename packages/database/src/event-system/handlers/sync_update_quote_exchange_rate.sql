CREATE OR REPLACE FUNCTION public.sync_update_quote_exchange_rate(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation = 'UPDATE'
    AND (p_old->>'exchangeRate') IS DISTINCT FROM (p_new->>'exchangeRate')
  THEN
    UPDATE "quoteLinePrice"
    SET "exchangeRate" = (p_new->>'exchangeRate')::numeric
    WHERE "quoteId" = p_new->>'id';
  END IF;
END;
$function$;
