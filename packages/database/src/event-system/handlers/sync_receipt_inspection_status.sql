CREATE OR REPLACE FUNCTION public.sync_receipt_inspection_status(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
-- Keeps receipt."inspectionStatus" in step with the receipt's inspection lots
-- and its putaway transfers (spec .ai/specs/2026-11-03-goods-in-inspection-hold.md).
BEGIN
  IF p_table = 'inspection' THEN
    IF COALESCE(p_new->>'sourceDocument', p_old->>'sourceDocument') IS DISTINCT FROM 'Receipt' THEN
      RETURN;
    END IF;
    IF p_operation = 'UPDATE'
       AND p_new->>'status' IS NOT DISTINCT FROM p_old->>'status'
       AND p_new->>'acceptedQuantity' IS NOT DISTINCT FROM p_old->>'acceptedQuantity' THEN
      RETURN;
    END IF;
    PERFORM public.refresh_receipt_inspection_status(
      COALESCE(p_new->>'sourceDocumentId', p_old->>'sourceDocumentId')
    );
  ELSIF p_table = 'stockTransfer' THEN
    IF p_operation <> 'UPDATE' OR p_new->>'receiptId' IS NULL THEN
      RETURN;
    END IF;
    IF p_new->>'status' IS NOT DISTINCT FROM p_old->>'status' THEN
      RETURN;
    END IF;
    PERFORM public.refresh_receipt_inspection_status(p_new->>'receiptId');
  END IF;
END;
$function$;
