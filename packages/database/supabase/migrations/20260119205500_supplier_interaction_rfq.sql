-- Update get_supplier_interaction_with_related_records to include purchasingRfq
-- This simplifies the data flow by including the linked RFQ directly in the interaction

DROP FUNCTION IF EXISTS get_supplier_interaction_with_related_records(TEXT);
CREATE FUNCTION get_supplier_interaction_with_related_records(supplier_interaction_id TEXT)
RETURNS TABLE (
  "id" TEXT,
  "companyId" TEXT,
  "supplierId" TEXT,
  "purchasingRfq" JSONB,
  "supplierQuotes" JSONB,
  "purchaseOrders" JSONB,
  "purchaseInvoices" JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    si."id",
    si."companyId",
    si."supplierId",
    -- Get the linked purchasing RFQ (singular) through the junction table
    (
      SELECT to_jsonb(jsonb_build_object(
        'id', rfq."id",
        'rfqId', rfq."rfqId",
        'status', rfq."status"
      ))
      FROM "purchasingRfqToSupplierQuote" link
      JOIN "supplierQuote" sq ON sq."id" = link."supplierQuoteId"
      JOIN "purchasingRfq" rfq ON rfq."id" = link."purchasingRfqId"
      WHERE sq."supplierInteractionId" = si.id
      LIMIT 1
    ) AS "purchasingRfq",
    (
      SELECT COALESCE(jsonb_agg(sq.* ORDER BY sq."supplierQuoteId" DESC), '[]'::jsonb)
      FROM "supplierQuote" sq
      WHERE sq."supplierInteractionId" = si.id
    ) AS "supplierQuotes",
    (
      SELECT COALESCE(jsonb_agg(po.* ORDER BY po."purchaseOrderId" DESC), '[]'::jsonb)
      FROM "purchaseOrder" po
      WHERE po."supplierInteractionId" = si.id
    ) AS "purchaseOrders",
    (
      SELECT COALESCE(jsonb_agg(pi.* ORDER BY pi."invoiceId" DESC), '[]'::jsonb)
      FROM "purchaseInvoice" pi
      WHERE pi."supplierInteractionId" = si.id
    ) AS "purchaseInvoices"
  FROM "supplierInteraction" si
  WHERE si.id = supplier_interaction_id::text;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
