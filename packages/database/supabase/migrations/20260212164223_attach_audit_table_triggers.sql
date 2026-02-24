-- Attach event triggers to tables needed for audit logging

-- itemCost - stores cost/pricing data for items (unit price changes)
SELECT attach_event_trigger('itemCost', ARRAY[]::TEXT[]);
