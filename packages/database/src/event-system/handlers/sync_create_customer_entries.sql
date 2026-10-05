CREATE OR REPLACE FUNCTION public.sync_create_customer_entries(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "customerPayment"("customerId", "invoiceCustomerId", "companyId")
  VALUES (p_new->>'id', p_new->>'id', p_new->>'companyId');

  INSERT INTO "customerShipping"("customerId", "shippingCustomerId", "companyId")
  VALUES (p_new->>'id', p_new->>'id', p_new->>'companyId');

  INSERT INTO "customerTax"("customerId", "companyId")
  VALUES (p_new->>'id', p_new->>'companyId');
END;
$function$;
