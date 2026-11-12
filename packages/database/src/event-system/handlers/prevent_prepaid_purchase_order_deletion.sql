CREATE OR REPLACE FUNCTION public.prevent_prepaid_purchase_order_deletion(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation = 'DELETE'
    AND EXISTS (SELECT 1 FROM "company" WHERE "id" = p_old->>'companyId') THEN
    -- A payment writer may hold its row while waiting for this order's lock.
    PERFORM 1 FROM "payment" WHERE "companyId" = p_old->>'companyId'
      AND "purchaseOrderId" = p_old->>'id' ORDER BY "id" FOR UPDATE NOWAIT;
  END IF;
  IF (p_operation = 'DELETE' OR (p_operation = 'UPDATE' AND p_new->>'supplierId' IS DISTINCT FROM p_old->>'supplierId'))
    AND EXISTS (SELECT 1 FROM "company" WHERE "id" = p_old->>'companyId')
    AND EXISTS (SELECT 1 FROM "payment" WHERE "companyId" = p_old->>'companyId'
      AND "purchaseOrderId" = p_old->>'id' AND "status" = 'Posted') THEN
    RAISE EXCEPTION 'Cannot delete or change the supplier of a purchase order with posted prepayments';
  END IF;
END;
$function$;
