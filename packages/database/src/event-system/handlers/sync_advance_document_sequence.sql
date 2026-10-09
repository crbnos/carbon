CREATE OR REPLACE FUNCTION public.sync_advance_document_sequence(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_column text;
  v_sequence text;
  v_value text;
BEGIN
  -- A document saved with a number in its sequence's format (typed by hand,
  -- sent through the API or MCP, imported) moves the counter past it, so
  -- get_next_sequence never hands that number out again.
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN
    RETURN;
  END IF;

  -- A new numbered table is added here and attached in attachments.ts.
  v_column := CASE p_table
    WHEN 'changeOrder' THEN 'changeOrderId'
    WHEN 'customer' THEN 'readableId'
    WHEN 'customerContract' THEN 'customerContractId'
    WHEN 'depreciationRun' THEN 'depreciationRunId'
    WHEN 'fixedAsset' THEN 'fixedAssetId'
    WHEN 'gauge' THEN 'gaugeId'
    WHEN 'inventoryCount' THEN 'inventoryCountId'
    WHEN 'job' THEN 'jobId'
    WHEN 'journal' THEN 'journalEntryId'
    WHEN 'maintenanceDispatch' THEN 'maintenanceDispatchId'
    WHEN 'memo' THEN 'memoId'
    WHEN 'nonConformance' THEN 'nonConformanceId'
    WHEN 'payment' THEN 'paymentId'
    WHEN 'pickingList' THEN 'pickingListId'
    WHEN 'purchaseInvoice' THEN 'invoiceId'
    WHEN 'purchaseOrder' THEN 'purchaseOrderId'
    WHEN 'purchaseReturnOrder' THEN 'purchaseReturnOrderId'
    WHEN 'purchasingRfq' THEN 'rfqId'
    WHEN 'quote' THEN 'quoteId'
    WHEN 'receipt' THEN 'receiptId'
    WHEN 'rentalAgreement' THEN 'rentalAgreementId'
    WHEN 'salesInvoice' THEN 'invoiceId'
    WHEN 'salesOrder' THEN 'salesOrderId'
    WHEN 'salesReturnOrder' THEN 'salesReturnOrderId'
    WHEN 'salesRfq' THEN 'rfqId'
    WHEN 'shipment' THEN 'shipmentId'
    WHEN 'stockTransfer' THEN 'stockTransferId'
    WHEN 'supplier' THEN 'readableId'
    WHEN 'supplierQuote' THEN 'supplierQuoteId'
    WHEN 'warehouseTransfer' THEN 'transferId'
  END;

  IF v_column IS NULL THEN
    RETURN;
  END IF;

  v_value := p_new->>v_column;
  IF v_value IS NULL
    OR (p_operation = 'UPDATE' AND v_value IS NOT DISTINCT FROM p_old->>v_column)
  THEN
    RETURN;
  END IF;

  -- The sequence is named after its table, except these.
  v_sequence := CASE
    WHEN p_table = 'journal' THEN 'journalEntry'
    WHEN p_table = 'memo' AND p_new->>'direction' = 'Debit' THEN 'debitMemo'
    WHEN p_table = 'memo' THEN 'creditMemo'
    ELSE p_table
  END;

  UPDATE "sequence"
  SET "next" = util.document_sequence_number(v_value, "prefix", "suffix", "size")::integer,
      "updatedBy" = 'system'
  WHERE "table" = v_sequence
    AND "companyId" = p_new->>'companyId'
    AND util.document_sequence_number(v_value, "prefix", "suffix", "size")
      BETWEEN "next"::bigint + 1 AND 2147483647;
END;
$function$;
