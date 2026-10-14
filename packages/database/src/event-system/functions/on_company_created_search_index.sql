CREATE OR REPLACE FUNCTION public.on_company_created_search_index()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM create_company_search_index(NEW.id);
  PERFORM create_search_subscriptions_for_company(NEW.id);
  PERFORM create_embedding_subscriptions_for_company(NEW.id);
  RETURN NEW;
END;
$function$;
