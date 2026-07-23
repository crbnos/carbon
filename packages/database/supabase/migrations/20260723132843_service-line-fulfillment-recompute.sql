-- =============================================================================
-- Recompute a Non-Inventory (Service) sales-order line's fulfillment from its
-- completed jobs, on every completion-boundary crossing.
--
-- Services never ship, so job COMPLETION is the fulfillment event for a
-- Make-to-Order service line (see complete_job_to_inventory, migration
-- 20260714043017). That function fulfills the line on completion, but nothing
-- REVERSED it: reopening a completed service job (Completed -> In Progress) left
-- salesOrderLine.sentComplete/quantitySent/sentDate stale, so the SO line kept
-- reading "Shipped" (getSalesOrderJobStatus) while the job was back In Progress
-- and quantityShipped = 0.
--
-- Fix: make the line's fulfillment a DERIVED function of its completed jobs and
-- recompute it whenever a linked job crosses into or out of a completed state.
-- Completing fulfills; reopening / cancelling un-fulfills. The recompute lives
-- in SQL as a job AFTER-interceptor so every reopen path is covered (today only
-- the status route, but future MES/operation paths get it for free), symmetric
-- with the SQL-centric completion design. job.completedDate (job-local) is
-- cleared in the app route to avoid a job self-UPDATE inside the trigger.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Shared recompute: fulfilled = SUM(quantityComplete) over the line's jobs in a
-- completed state (Completed/Closed). Non-Inventory lines only; physical lines
-- are fulfilled by post-shipment, never by completion, so they are left alone.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recompute_service_line_fulfillment(
  p_sales_order_line_id TEXT,
  p_company_id TEXT,
  p_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_tracking_type "itemTrackingType";
  v_fulfilled NUMERIC;
BEGIN
  IF p_sales_order_line_id IS NULL OR p_company_id IS NULL THEN
    RETURN;
  END IF;

  -- Only service (Non-Inventory) lines fulfill by completion.
  SELECT i."itemTrackingType"
  INTO v_item_tracking_type
  FROM "salesOrderLine" sol
  JOIN "item" i ON i.id = sol."itemId" AND i."companyId" = sol."companyId"
  WHERE sol.id = p_sales_order_line_id
    AND sol."companyId" = p_company_id;

  IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' THEN
    RETURN;
  END IF;

  -- Fulfilled quantity = sum over this line's jobs that are actually completed.
  SELECT COALESCE(SUM("quantityComplete"), 0)
  INTO v_fulfilled
  FROM "job"
  WHERE "salesOrderLineId" = p_sales_order_line_id
    AND "companyId" = p_company_id
    AND status IN ('Completed', 'Closed');

  UPDATE "salesOrderLine" sol
  SET "quantitySent" = v_fulfilled,
      "sentComplete" = (COALESCE(sol."saleQuantity", 0) > 0 AND v_fulfilled >= sol."saleQuantity"),
      "sentDate" = CASE
        WHEN COALESCE(sol."saleQuantity", 0) > 0 AND v_fulfilled >= sol."saleQuantity"
          THEN COALESCE(sol."sentDate", CURRENT_DATE)
        ELSE NULL
      END,
      "updatedBy" = p_user_id,
      "updatedAt" = NOW()
  WHERE sol.id = p_sales_order_line_id
    AND sol."companyId" = p_company_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- Job AFTER-interceptor: recompute the linked service line whenever a job
-- crosses a completion boundary (into or out of Completed/Closed).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_job_recompute_service_line(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'salesOrderLineId') IS NULL THEN RETURN; END IF;

  -- Only when the completion state actually changed.
  IF (p_old->>'status') IS NOT DISTINCT FROM (p_new->>'status') THEN RETURN; END IF;
  IF NOT (
    (p_old->>'status') IN ('Completed', 'Closed')
    OR (p_new->>'status') IN ('Completed', 'Closed')
  ) THEN
    RETURN;
  END IF;

  PERFORM recompute_service_line_fulfillment(
    p_new->>'salesOrderLineId',
    p_new->>'companyId',
    p_new->>'updatedBy'
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- Re-attach job interceptors with the new AFTER function appended. Preserves the
-- arrays set in 20260410031803_job-interceptors.sql (BEFORE:
-- sync_job_complete_or_canceled, AFTER: sync_insert_job_make_method).
-- -----------------------------------------------------------------------------
SELECT attach_event_trigger('job',
  ARRAY['sync_job_complete_or_canceled']::TEXT[],
  ARRAY['sync_insert_job_make_method', 'sync_job_recompute_service_line']::TEXT[]
);
