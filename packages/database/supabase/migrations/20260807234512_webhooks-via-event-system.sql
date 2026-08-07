-- Move webhooks off the bespoke pg_net triggers and onto the event system.
--
-- Until now webhooks ran on their own dispatch path: 39 triggers (13 tables x
-- INSERT/UPDATE/DELETE) calling webhook_insert/_update/_delete, each of which
-- looked up matching `webhook` rows and net.http_post-ed the `webhook` edge
-- function, which then POSTed the customer. That duplicated infrastructure the
-- event system already provides -- every one of those 13 tables ALREADY carries
-- trg_event_async_ins/upd/del_* feeding dispatch_event_batch(), so the writes
-- were being observed twice.
--
-- After this migration a webhook is just an eventSystemSubscription with
-- handlerType 'WEBHOOK', drained by the existing queue and delivered by
-- packages/jobs/.../events/webhook.ts.
--
-- The customer-facing body is unchanged: the handler maps the queue event back
-- to {type, record, old?} (see toWebhookBody, contract-tested), including the
-- DELETE case where `record` comes from OLD. Delivery counters
-- (increment_webhook_success/_error) are preserved by the handler.
--
-- What DOES change is timing: pg_net fired on commit, the event system is
-- queued -- typically ~3-5s, worst case ~1 min if a wake is lost and the
-- pg_cron sweeper picks it up. Accepted deliberately; webhooks are
-- notifications, not synchronous integrations.
--
-- Subscriptions are DERIVED from the `webhook` table by trigger rather than
-- maintained in app code. The webhook table stays the single source of truth,
-- and every writer -- UI, public API, MCP -- is covered without duplicating
-- lifecycle logic across call sites that could silently drift.
--
-- Removing these triggers also retires 3 of the ~7 net.http_post call sites,
-- which is direct progress on the RDS compatibility work (pg_net is one of only
-- two extensions blocking RDS/Aurora) -- see
-- .ai/research/enterprise-iac-byoc-deployment.md section 3.

-- ── 1. Derive a subscription from a webhook row ──────────────────────────────

CREATE OR REPLACE FUNCTION sync_webhook_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ops TEXT[];
  v_name TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM delete_event_system_subscriptions_by_name(OLD."companyId", 'webhook-' || OLD.id);
    RETURN OLD;
  END IF;

  v_name := 'webhook-' || NEW.id;

  -- Always clear first: `table` is editable, and the subscription's uniqueness
  -- is (companyId, name, table), so an in-place upsert would strand the old
  -- row under the previous table and fire the webhook twice.
  PERFORM delete_event_system_subscriptions_by_name(NEW."companyId", v_name);

  v_ops := ARRAY[]::TEXT[];
  IF NEW."onInsert" THEN v_ops := array_append(v_ops, 'INSERT'); END IF;
  IF NEW."onUpdate" THEN v_ops := array_append(v_ops, 'UPDATE'); END IF;
  IF NEW."onDelete" THEN v_ops := array_append(v_ops, 'DELETE'); END IF;

  -- A webhook with no operations selected has nothing to subscribe to; leaving
  -- the row deleted is correct rather than creating an unreachable subscription.
  IF array_length(v_ops, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM create_event_system_subscription(
    v_name,
    NEW."table",
    NEW."companyId",
    v_ops,
    'WEBHOOK',
    jsonb_build_object('url', NEW.url, 'webhookId', NEW.id),
    '{}'::jsonb,
    COALESCE(NEW.active, false)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "syncWebhookSubscription" ON "webhook";
CREATE TRIGGER "syncWebhookSubscription"
AFTER INSERT OR UPDATE OR DELETE ON "webhook"
FOR EACH ROW EXECUTE FUNCTION sync_webhook_subscription();

-- ── 2. Backfill subscriptions for existing webhooks ──────────────────────────

DO $$
DECLARE w RECORD;
BEGIN
  FOR w IN SELECT * FROM "webhook" LOOP
    DECLARE
      v_ops TEXT[] := ARRAY[]::TEXT[];
    BEGIN
      IF w."onInsert" THEN v_ops := array_append(v_ops, 'INSERT'); END IF;
      IF w."onUpdate" THEN v_ops := array_append(v_ops, 'UPDATE'); END IF;
      IF w."onDelete" THEN v_ops := array_append(v_ops, 'DELETE'); END IF;

      IF array_length(v_ops, 1) IS NOT NULL THEN
        PERFORM delete_event_system_subscriptions_by_name(w."companyId", 'webhook-' || w.id);
        PERFORM create_event_system_subscription(
          'webhook-' || w.id, w."table", w."companyId", v_ops, 'WEBHOOK',
          jsonb_build_object('url', w.url, 'webhookId', w.id),
          '{}'::jsonb, COALESCE(w.active, false)
        );
      END IF;
    END;
  END LOOP;
END $$;

-- ── 3. Retire the old dispatch path ──────────────────────────────────────────
-- 39 triggers across the 13 tables in `webhookTable`. Dropped by name rather
-- than by loop so the set is auditable in review.

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
