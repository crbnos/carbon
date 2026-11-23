-- Documents saved with a number chosen by the caller (typed by hand, or sent
-- through the API or MCP) never moved their sequence, so get_next_sequence later
-- handed out a number that was already taken and the insert failed on the
-- unique constraint. sync_advance_document_sequence keeps the counter ahead from
-- now on; this moves every counter that is already behind past the highest
-- number in its format.
UPDATE "sequence" s
SET "next" = m."maxNumber"::integer,
    "updatedBy" = 'system'
FROM (
  SELECT n."table", n."companyId",
    max(CASE WHEN length(n."digits") <= 18 THEN n."digits"::bigint END) AS "maxNumber"
  FROM (
    SELECT d."table", d."companyId", substring(d."value" FROM seq."pattern") AS "digits"
    FROM (
      SELECT 'customer' AS "table", "companyId", "readableId" AS "value" FROM "customer"
      UNION ALL SELECT CASE WHEN "direction" = 'Debit' THEN 'debitMemo' ELSE 'creditMemo' END, "companyId", "memoId" FROM "memo"
      UNION ALL SELECT 'changeOrder', "companyId", "changeOrderId" FROM "changeOrder"
      UNION ALL SELECT 'customerContract', "companyId", "customerContractId" FROM "customerContract"
      UNION ALL SELECT 'depreciationRun', "companyId", "depreciationRunId" FROM "depreciationRun"
      UNION ALL SELECT 'fixedAsset', "companyId", "fixedAssetId" FROM "fixedAsset"
      UNION ALL SELECT 'gauge', "companyId", "gaugeId" FROM "gauge"
      UNION ALL SELECT 'inventoryCount', "companyId", "inventoryCountId" FROM "inventoryCount"
      UNION ALL SELECT 'job', "companyId", "jobId" FROM "job"
      UNION ALL SELECT 'journalEntry', "companyId", "journalEntryId" FROM "journal"
      UNION ALL SELECT 'maintenanceDispatch', "companyId", "maintenanceDispatchId" FROM "maintenanceDispatch"
      UNION ALL SELECT 'nonConformance', "companyId", "nonConformanceId" FROM "nonConformance"
      UNION ALL SELECT 'payment', "companyId", "paymentId" FROM "payment"
      UNION ALL SELECT 'pickingList', "companyId", "pickingListId" FROM "pickingList"
      UNION ALL SELECT 'purchaseInvoice', "companyId", "invoiceId" FROM "purchaseInvoice"
      UNION ALL SELECT 'purchaseOrder', "companyId", "purchaseOrderId" FROM "purchaseOrder"
      UNION ALL SELECT 'purchaseReturnOrder', "companyId", "purchaseReturnOrderId" FROM "purchaseReturnOrder"
      UNION ALL SELECT 'purchasingRfq', "companyId", "rfqId" FROM "purchasingRfq"
      UNION ALL SELECT 'quote', "companyId", "quoteId" FROM "quote"
      UNION ALL SELECT 'receipt', "companyId", "receiptId" FROM "receipt"
      UNION ALL SELECT 'rentalAgreement', "companyId", "rentalAgreementId" FROM "rentalAgreement"
      UNION ALL SELECT 'salesInvoice', "companyId", "invoiceId" FROM "salesInvoice"
      UNION ALL SELECT 'salesOrder', "companyId", "salesOrderId" FROM "salesOrder"
      UNION ALL SELECT 'salesReturnOrder', "companyId", "salesReturnOrderId" FROM "salesReturnOrder"
      UNION ALL SELECT 'salesRfq', "companyId", "rfqId" FROM "salesRfq"
      UNION ALL SELECT 'shipment', "companyId", "shipmentId" FROM "shipment"
      UNION ALL SELECT 'stockTransfer', "companyId", "stockTransferId" FROM "stockTransfer"
      UNION ALL SELECT 'supplier', "companyId", "readableId" FROM "supplier"
      UNION ALL SELECT 'supplierQuote', "companyId", "supplierQuoteId" FROM "supplierQuote"
      UNION ALL SELECT 'warehouseTransfer', "companyId", "transferId" FROM "warehouseTransfer"
    ) d
    -- Each sequence's pattern is built once, not once per document.
    JOIN (
      SELECT "table", "companyId", util.document_sequence_pattern("prefix", "suffix", "size") AS "pattern"
      FROM "sequence"
    ) seq ON seq."table" = d."table" AND seq."companyId" = d."companyId"
  ) n
  GROUP BY n."table", n."companyId"
) m
WHERE s."table" = m."table"
  AND s."companyId" = m."companyId"
  AND m."maxNumber" BETWEEN s."next"::bigint + 1 AND 2147483647;
