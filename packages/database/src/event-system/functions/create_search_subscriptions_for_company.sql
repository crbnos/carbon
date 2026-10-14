CREATE OR REPLACE FUNCTION public.create_search_subscriptions_for_company(p_company_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_tables TEXT[] := ARRAY[
    'employee', 'customer', 'supplier', 'item', 'job', 
    'purchaseOrder', 'salesInvoice', 'purchaseInvoice', 
    'nonConformance', 'gauge', 'quote', 'salesRfq', 
    'salesOrder', 'supplierQuote'
  ];
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    INSERT INTO "eventSystemSubscription" (
      "name", 
      "table", 
      "companyId", 
      "operations", 
      "handlerType", 
      "config", 
      "filter", 
      "active"
    )
    VALUES (
      'search-index-' || v_table,
      v_table,
      p_company_id,
      ARRAY['INSERT', 'UPDATE', 'DELETE'],
      'SEARCH',
      '{}'::jsonb,
      '{}'::jsonb,
      TRUE
    )
    ON CONFLICT ON CONSTRAINT "unique_subscription_name_per_company" 
    DO UPDATE SET
      "operations" = EXCLUDED."operations",
      "handlerType" = EXCLUDED."handlerType",
      "active" = EXCLUDED."active";
  END LOOP;
END;
$function$;
