-- =============================================================================
-- Convert purchaseInvoiceLine AFTER UPDATE trigger to event system interceptor.
--
-- purchaseInvoiceLine_update_price_change -> sync_purchase_invoice_line_price_change
--   BEFORE interceptor: inserts purchaseInvoicePriceChange when unitPrice or
--   quantity changes (FK is to invoice, not line).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Interceptor function
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_purchase_invoice_line_price_change(
  p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
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
      p_new->>'updatedBy'
    );
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- Drop legacy trigger
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS "purchaseInvoiceLine_update_price_change" ON "purchaseInvoiceLine";


-- -----------------------------------------------------------------------------
-- Attach event trigger (BEFORE interceptor only, no AFTER interceptors)
-- -----------------------------------------------------------------------------

SELECT attach_event_trigger('purchaseInvoiceLine',
  ARRAY['sync_purchase_invoice_line_price_change']::TEXT[],
  ARRAY[]::TEXT[]
);
