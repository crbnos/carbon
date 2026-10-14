CREATE OR REPLACE FUNCTION public.sync_update_stock_transfer_status(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF NOT ((p_old->>'pickedQuantity') IS DISTINCT FROM (p_new->>'pickedQuantity')
          AND (p_new->>'pickedQuantity')::numeric != 0) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "stockTransferLine"
    WHERE "stockTransferId" = p_new->>'stockTransferId'
      AND ("pickedQuantity" IS NULL OR "pickedQuantity" != "quantity")
  ) THEN
    UPDATE "stockTransfer"
    SET "status" = 'In Progress'
    WHERE "id" = p_new->>'stockTransferId';
  ELSE
    UPDATE "stockTransfer"
    SET "status" = 'Completed', "completedAt" = NOW()
    WHERE "id" = p_new->>'stockTransferId';
  END IF;
END;
$function$;
