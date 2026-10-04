CREATE OR REPLACE FUNCTION public.prevent_posted_purchase_invoice_deletion(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "company" WHERE id = (p_old->>'companyId')) THEN
      RETURN;
    END IF;
    IF p_old->>'status' IS DISTINCT FROM 'Draft' THEN
      RAISE EXCEPTION 'Cannot delete purchase invoice with status "%". Only Draft invoices can be deleted.', p_old->>'status';
    END IF;
  END IF;
END;
$function$;
