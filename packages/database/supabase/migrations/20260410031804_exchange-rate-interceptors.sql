-- =============================================================================
-- Convert legacy exchange rate triggers on quote and salesOrder to event
-- system interceptors.
--
-- Both are AFTER UPDATE -> sync_functions (BEFORE):
--   sync_update_quote_exchange_rate:
--     When exchangeRate changes on quote, propagates to quoteLinePrice rows.
--   sync_update_sales_order_exchange_rate:
--     When exchangeRate changes on salesOrder, propagates to salesOrderLine rows.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Exchange rate interceptor functions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_update_quote_exchange_rate(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation = 'UPDATE'
    AND (p_old->>'exchangeRate') IS DISTINCT FROM (p_new->>'exchangeRate')
  THEN
    UPDATE "quoteLinePrice"
    SET "exchangeRate" = (p_new->>'exchangeRate')::numeric
    WHERE "quoteId" = p_new->>'id';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sync_update_sales_order_exchange_rate(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation = 'UPDATE'
    AND (p_old->>'exchangeRate') IS DISTINCT FROM (p_new->>'exchangeRate')
  THEN
    UPDATE "salesOrderLine"
    SET "exchangeRate" = (p_new->>'exchangeRate')::numeric
    WHERE "salesOrderId" = p_new->>'id';
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- Drop legacy triggers
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS update_quote_line_price_exchange_rate_trigger ON "quote";
DROP TRIGGER IF EXISTS update_sales_order_line_exchange_rate_trigger ON "salesOrder";


-- -----------------------------------------------------------------------------
-- Attach event triggers with interceptor arrays
-- -----------------------------------------------------------------------------

SELECT attach_event_trigger('quote',
  ARRAY['sync_update_quote_exchange_rate']::TEXT[],
  ARRAY[]::TEXT[]
);

SELECT attach_event_trigger('salesOrder',
  ARRAY['sync_update_sales_order_exchange_rate']::TEXT[],
  ARRAY[]::TEXT[]
);
