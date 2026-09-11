-- Returnable receipt lines for a supplier, searched + paginated in SQL.
--
-- Replaces the TypeScript getReturnableLinesForSupplier fan-out, which loaded
-- every posted receipt and every receipt line for the supplier and returned the
-- whole set. This computes received - already-authorized > 0, applies the search,
-- orders by receipt recency, and paginates in one round trip so the "Add lines
-- from receipt" modal stays responsive with thousands of receipt lines.
--
-- SECURITY DEFINER: bypasses RLS, so every table is scoped by company_id here.
-- The route gates the caller with requirePermissions({ view: "purchasing" }).
--
-- totalCount is COUNT(*) OVER () of the returnable set BEFORE limit/offset, so
-- the UI can show "n of N" and page through the rest.

CREATE OR REPLACE FUNCTION get_returnable_receipt_lines(
  company_id TEXT,
  supplier_id TEXT,
  purchase_order_id TEXT DEFAULT NULL,
  search TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 5,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  "receiptLineId" TEXT,
  "receiptReadableId" TEXT,
  "purchaseOrderReadableId" TEXT,
  "purchaseOrderLineId" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "itemName" TEXT,
  "itemTrackingType" TEXT,
  "receivedQuantity" NUMERIC,
  "alreadyReturned" NUMERIC,
  "returnableQuantity" NUMERIC,
  "unitPrice" NUMERIC,
  "unitOfMeasureCode" TEXT,
  "totalCount" BIGINT
)
AS $$
  WITH candidate AS (
    SELECT
      rl.id AS receipt_line_id,
      r."receiptId" AS receipt_readable_id,
      r."sourceDocumentReadableId" AS po_readable_id,
      rl."lineId" AS po_line_id,
      rl."itemId" AS item_id,
      i."readableIdWithRevision" AS item_readable_id,
      i."name" AS item_name,
      i."itemTrackingType"::text AS item_tracking_type,
      rl."receivedQuantity" AS received_quantity,
      rl."unitOfMeasure" AS unit_of_measure_code,
      r."postingDate" AS posting_date,
      r."createdAt" AS created_at,
      -- supplierUnitPrice is per purchase unit; the return order + credit memo
      -- are in inventory units, so divide by the conversion factor.
      COALESCE(pol."supplierUnitPrice", 0)
        / NULLIF(COALESCE(pol."conversionFactor", 1), 0) AS unit_price,
      COALESCE(auth.total_authorized, 0) AS already_returned
    FROM "receiptLine" rl
    JOIN "receipt" r
      ON r.id = rl."receiptId" AND r."companyId" = rl."companyId"
    JOIN "item" i
      ON i.id = rl."itemId"
    LEFT JOIN "purchaseOrderLine" pol
      ON pol.id = rl."lineId" AND pol."companyId" = rl."companyId"
    LEFT JOIN (
      SELECT prol."receiptLineId", SUM(prol."quantity") AS total_authorized
      FROM "purchaseReturnOrderLine" prol
      JOIN "purchaseReturnOrder" pro
        ON pro.id = prol."purchaseReturnOrderId"
        AND pro."companyId" = prol."companyId"
      WHERE prol."companyId" = company_id
        AND prol."receiptLineId" IS NOT NULL
        AND pro."status" <> 'Cancelled'
      GROUP BY prol."receiptLineId"
    ) auth ON auth."receiptLineId" = rl.id
    WHERE rl."companyId" = company_id
      AND r."supplierId" = supplier_id
      AND r."sourceDocument" = 'Purchase Order'
      AND r."status" = 'Posted'
      AND (purchase_order_id IS NULL OR r."sourceDocumentId" = purchase_order_id)
      AND (
        search IS NULL OR search = '' OR
        r."receiptId" ILIKE '%' || search || '%' OR
        r."sourceDocumentReadableId" ILIKE '%' || search || '%' OR
        i."readableIdWithRevision" ILIKE '%' || search || '%' OR
        i."name" ILIKE '%' || search || '%'
      )
  ),
  returnable AS (
    SELECT *, (received_quantity - already_returned) AS returnable_quantity
    FROM candidate
    WHERE (received_quantity - already_returned) > 0.000001
  )
  SELECT
    receipt_line_id,
    receipt_readable_id,
    po_readable_id,
    po_line_id,
    item_id,
    item_readable_id,
    item_name,
    item_tracking_type,
    received_quantity,
    already_returned,
    returnable_quantity,
    unit_price,
    unit_of_measure_code,
    COUNT(*) OVER () AS total_count
  FROM returnable
  ORDER BY posting_date DESC NULLS LAST, created_at DESC, receipt_line_id
  LIMIT limit_count OFFSET offset_count;
$$ LANGUAGE sql SECURITY DEFINER;


-- Returnable shipment lines for a customer, searched + paginated in SQL.
--
-- The sales-return (RMA) mirror of get_returnable_receipt_lines. Replaces the
-- TypeScript getReturnableLinesForCustomer fan-out, which loaded every posted
-- shipment and every shipment line for the customer and returned the whole set.
-- This computes shipped - already-authorized > 0, applies the search, orders by
-- shipment recency, and paginates in one round trip so the "Add lines from
-- shipment" modal stays responsive with thousands of shipment lines.
--
-- SECURITY DEFINER: bypasses RLS, so every table is scoped by company_id here.
-- The route gates the caller with requirePermissions({ view: "sales" }).
--
-- Sales semantics differ from the receipt RPC by design: the credit basis is the
-- linked sales order line's unitPrice (no purchase-unit conversion factor), and
-- the unit of measure prefers the sales order line's over the shipment line's.

CREATE OR REPLACE FUNCTION get_returnable_shipment_lines(
  company_id TEXT,
  customer_id TEXT,
  sales_order_id TEXT DEFAULT NULL,
  search TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 5,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  "shipmentLineId" TEXT,
  "shipmentReadableId" TEXT,
  "salesOrderReadableId" TEXT,
  "salesOrderLineId" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "itemName" TEXT,
  "itemTrackingType" TEXT,
  "shippedQuantity" NUMERIC,
  "alreadyReturned" NUMERIC,
  "returnableQuantity" NUMERIC,
  "unitPrice" NUMERIC,
  "unitOfMeasureCode" TEXT,
  "totalCount" BIGINT
)
AS $$
  WITH candidate AS (
    SELECT
      sl.id AS shipment_line_id,
      s."shipmentId" AS shipment_readable_id,
      s."sourceDocumentReadableId" AS so_readable_id,
      sl."lineId" AS so_line_id,
      sl."itemId" AS item_id,
      i."readableIdWithRevision" AS item_readable_id,
      i."name" AS item_name,
      i."itemTrackingType"::text AS item_tracking_type,
      sl."shippedQuantity" AS shipped_quantity,
      COALESCE(sol."unitOfMeasureCode", sl."unitOfMeasure") AS unit_of_measure_code,
      s."postingDate" AS posting_date,
      s."createdAt" AS created_at,
      COALESCE(sol."unitPrice", 0) AS unit_price,
      COALESCE(auth.total_authorized, 0) AS already_returned
    FROM "shipmentLine" sl
    JOIN "shipment" s
      ON s.id = sl."shipmentId" AND s."companyId" = sl."companyId"
    JOIN "item" i
      ON i.id = sl."itemId"
    LEFT JOIN "salesOrderLine" sol
      ON sol.id = sl."lineId" AND sol."companyId" = sl."companyId"
    LEFT JOIN (
      SELECT srol."shipmentLineId", SUM(srol."quantity") AS total_authorized
      FROM "salesReturnOrderLine" srol
      JOIN "salesReturnOrder" sro
        ON sro.id = srol."salesReturnOrderId"
        AND sro."companyId" = srol."companyId"
      WHERE srol."companyId" = company_id
        AND srol."shipmentLineId" IS NOT NULL
        AND sro."status" <> 'Cancelled'
      GROUP BY srol."shipmentLineId"
    ) auth ON auth."shipmentLineId" = sl.id
    WHERE sl."companyId" = company_id
      AND s."customerId" = customer_id
      AND s."sourceDocument" = 'Sales Order'
      AND s."status" = 'Posted'
      AND (sales_order_id IS NULL OR s."sourceDocumentId" = sales_order_id)
      AND (
        search IS NULL OR search = '' OR
        s."shipmentId" ILIKE '%' || search || '%' OR
        s."sourceDocumentReadableId" ILIKE '%' || search || '%' OR
        i."readableIdWithRevision" ILIKE '%' || search || '%' OR
        i."name" ILIKE '%' || search || '%'
      )
  ),
  returnable AS (
    SELECT *, (shipped_quantity - already_returned) AS returnable_quantity
    FROM candidate
    WHERE (shipped_quantity - already_returned) > 0.000001
  )
  SELECT
    shipment_line_id,
    shipment_readable_id,
    so_readable_id,
    so_line_id,
    item_id,
    item_readable_id,
    item_name,
    item_tracking_type,
    shipped_quantity,
    already_returned,
    returnable_quantity,
    unit_price,
    unit_of_measure_code,
    COUNT(*) OVER () AS total_count
  FROM returnable
  ORDER BY posting_date DESC NULLS LAST, created_at DESC, shipment_line_id
  LIMIT limit_count OFFSET offset_count;
$$ LANGUAGE sql SECURITY DEFINER;
