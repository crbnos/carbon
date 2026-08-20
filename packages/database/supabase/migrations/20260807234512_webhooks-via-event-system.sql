-- Move webhooks off their own pg_net dispatch path (39 webhook_* triggers -> the
-- `webhook` edge function) and onto the event system. All 13 tables already
-- carried trg_event_async_* triggers, so every write was being observed twice.
-- A webhook is now an eventSystemSubscription with handlerType 'WEBHOOK'.
--
-- Delivery moves from on-commit to queued (~3-5s) and from at-most-once to
-- at-least-once; the customer-facing body is unchanged (see toWebhookBody).
-- Also retires 3 of the ~7 net.http_post call sites, which pg_net blocks on RDS.

-- ── 1. Derive a subscription from a webhook row ──────────────────────────────
-- AFTER-ROW interceptor rather than a bespoke trigger: attach_event_trigger is
-- how derived-row maintenance is wired here (cf. sync_create_customer_entries).
-- AFTER because the subscription references the webhook row.

CREATE OR REPLACE FUNCTION sync_webhook_subscription(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ops TEXT[];
  v_name TEXT;
BEGIN
  IF p_operation = 'DELETE' THEN
    PERFORM delete_event_system_subscriptions_by_name(
      p_old->>'companyId', 'webhook-' || (p_old->>'id')
    );
    RETURN;
  END IF;

  v_name := 'webhook-' || (p_new->>'id');

  -- Clear first: `table` is editable and uniqueness is (companyId, name, table),
  -- so an upsert would strand the old row and fire the webhook twice.
  PERFORM delete_event_system_subscriptions_by_name(p_new->>'companyId', v_name);

  v_ops := ARRAY[]::TEXT[];
  IF (p_new->>'onInsert')::BOOLEAN THEN v_ops := array_append(v_ops, 'INSERT'); END IF;
  IF (p_new->>'onUpdate')::BOOLEAN THEN v_ops := array_append(v_ops, 'UPDATE'); END IF;
  IF (p_new->>'onDelete')::BOOLEAN THEN v_ops := array_append(v_ops, 'DELETE'); END IF;

  IF array_length(v_ops, 1) IS NULL THEN
    RETURN;
  END IF;

  PERFORM create_event_system_subscription(
    v_name,
    p_new->>'table',
    p_new->>'companyId',
    v_ops,
    'WEBHOOK',
    jsonb_build_object('url', p_new->>'url', 'webhookId', p_new->>'id'),
    '{}'::jsonb,
    COALESCE((p_new->>'active')::BOOLEAN, false)
  );
END;
$$;

-- Also attaches the async statement triggers to `webhook`; harmless, since
-- dispatch_event_batch() enqueues nothing unless a subscription watches it.
SELECT attach_event_trigger(
  'webhook',
  ARRAY[]::TEXT[],
  ARRAY['sync_webhook_subscription']::TEXT[]
);

-- ── 2. Backfill subscriptions for existing webhooks ──────────────────────────
-- A no-op update fires the interceptor, so the backfill can't drift from it.

UPDATE "webhook" SET "url" = "url";

-- ── 3. Retire the old dispatch path ──────────────────────────────────────────

DROP TRIGGER IF EXISTS "customerInsertWebhook" ON "customer";
DROP TRIGGER IF EXISTS "customerUpdateWebhook" ON "customer";
DROP TRIGGER IF EXISTS "customerDeleteWebhook" ON "customer";
DROP TRIGGER IF EXISTS "employeeInsertWebhook" ON "employee";
DROP TRIGGER IF EXISTS "employeeUpdateWebhook" ON "employee";
DROP TRIGGER IF EXISTS "employeeDeleteWebhook" ON "employee";
DROP TRIGGER IF EXISTS "itemInsertWebhook" ON "item";
DROP TRIGGER IF EXISTS "itemUpdateWebhook" ON "item";
DROP TRIGGER IF EXISTS "itemDeleteWebhook" ON "item";
DROP TRIGGER IF EXISTS "jobInsertWebhook" ON "job";
DROP TRIGGER IF EXISTS "jobUpdateWebhook" ON "job";
DROP TRIGGER IF EXISTS "jobDeleteWebhook" ON "job";
DROP TRIGGER IF EXISTS "purchaseInvoiceInsertWebhook" ON "purchaseInvoice";
DROP TRIGGER IF EXISTS "purchaseInvoiceUpdateWebhook" ON "purchaseInvoice";
DROP TRIGGER IF EXISTS "purchaseInvoiceDeleteWebhook" ON "purchaseInvoice";
DROP TRIGGER IF EXISTS "purchaseOrderInsertWebhook" ON "purchaseOrder";
DROP TRIGGER IF EXISTS "purchaseOrderUpdateWebhook" ON "purchaseOrder";
DROP TRIGGER IF EXISTS "purchaseOrderDeleteWebhook" ON "purchaseOrder";
DROP TRIGGER IF EXISTS "quoteInsertWebhook" ON "quote";
DROP TRIGGER IF EXISTS "quoteUpdateWebhook" ON "quote";
DROP TRIGGER IF EXISTS "quoteDeleteWebhook" ON "quote";
DROP TRIGGER IF EXISTS "receiptInsertWebhook" ON "receipt";
DROP TRIGGER IF EXISTS "receiptUpdateWebhook" ON "receipt";
DROP TRIGGER IF EXISTS "receiptDeleteWebhook" ON "receipt";
DROP TRIGGER IF EXISTS "salesInvoiceInsertWebhook" ON "salesInvoice";
DROP TRIGGER IF EXISTS "salesInvoiceUpdateWebhook" ON "salesInvoice";
DROP TRIGGER IF EXISTS "salesInvoiceDeleteWebhook" ON "salesInvoice";
DROP TRIGGER IF EXISTS "salesOrderInsertWebhook" ON "salesOrder";
DROP TRIGGER IF EXISTS "salesOrderUpdateWebhook" ON "salesOrder";
DROP TRIGGER IF EXISTS "salesOrderDeleteWebhook" ON "salesOrder";
DROP TRIGGER IF EXISTS "salesRfqInsertWebhook" ON "salesRfq";
DROP TRIGGER IF EXISTS "salesRfqUpdateWebhook" ON "salesRfq";
DROP TRIGGER IF EXISTS "salesRfqDeleteWebhook" ON "salesRfq";
DROP TRIGGER IF EXISTS "supplierInsertWebhook" ON "supplier";
DROP TRIGGER IF EXISTS "supplierUpdateWebhook" ON "supplier";
DROP TRIGGER IF EXISTS "supplierDeleteWebhook" ON "supplier";
DROP TRIGGER IF EXISTS "supplierQuoteInsertWebhook" ON "supplierQuote";
DROP TRIGGER IF EXISTS "supplierQuoteUpdateWebhook" ON "supplierQuote";
DROP TRIGGER IF EXISTS "supplierQuoteDeleteWebhook" ON "supplierQuote";

DROP FUNCTION IF EXISTS webhook_insert() CASCADE;
DROP FUNCTION IF EXISTS webhook_update() CASCADE;
DROP FUNCTION IF EXISTS webhook_delete() CASCADE;
