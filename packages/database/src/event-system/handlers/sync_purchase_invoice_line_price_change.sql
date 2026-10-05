CREATE OR REPLACE FUNCTION public.sync_purchase_invoice_line_price_change(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation = 'UPDATE'
     AND ((p_new->>'unitPrice') IS DISTINCT FROM (p_old->>'unitPrice')
       OR (p_new->>'quantity') IS DISTINCT FROM (p_old->>'quantity'))
  THEN
    INSERT INTO "purchaseInvoicePriceChange" (
      "invoiceId", "invoiceLineId", "previousPrice", "newPrice",
      "previousQuantity", "newQuantity", "updatedBy"
    ) VALUES (
      p_new->>'invoiceId', p_new->>'id',
      (p_old->>'unitPrice')::numeric, (p_new->>'unitPrice')::numeric,
      (p_old->>'quantity')::numeric, (p_new->>'quantity')::numeric,
      COALESCE(p_new->>'updatedBy', p_new->>'createdBy')
    );
  END IF;
END;
$function$;
