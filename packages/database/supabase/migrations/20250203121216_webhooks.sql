-- we need to store some environment variables for the webhook to work
CREATE TABLE "config" (
  "id" BOOLEAN DEFAULT TRUE,
  "apiUrl" TEXT NOT NULL,
  "anonKey" TEXT NOT NULL,

  CONSTRAINT "config_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "config_id_check" CHECK ("id" = TRUE)
);

ALTER TABLE "config" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "config"
FOR SELECT
USING (
  auth.role() = 'authenticated'
);


CREATE TABLE "webhookTable" (
  "table" TEXT NOT NULL,
  "module" module NOT NULL,
  "name" TEXT NOT NULL,

  CONSTRAINT "webhookTable_pkey" PRIMARY KEY ("table"),
  CONSTRAINT "webhookTable_name_key" UNIQUE ("name")
);

ALTER TABLE "webhookTable" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "webhookTable"
FOR SELECT
USING (
  auth.role() = 'authenticated'
);




CREATE TABLE "webhook" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "table" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "onInsert" BOOLEAN NOT NULL DEFAULT FALSE,
  "onUpdate" BOOLEAN NOT NULL DEFAULT FALSE,
  "onDelete" BOOLEAN NOT NULL DEFAULT FALSE,
  "successCount" BIGINT NOT NULL DEFAULT 0,
  "lastSuccess" TIMESTAMP WITH TIME ZONE,
  "errorCount" BIGINT NOT NULL DEFAULT 0,
  "lastError" TIMESTAMP WITH TIME ZONE,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "webhook_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "webhook_name_key" UNIQUE ("name", "companyId"),
  CONSTRAINT "webhook_table_fkey" FOREIGN KEY ("table") REFERENCES "webhookTable"("table") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "webhook_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE OR REPLACE FUNCTION public.increment_webhook_success(webhook_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE webhook 
  SET 
    "successCount" = "successCount" + 1,
    "lastSuccess" = NOW()
  WHERE "id" = webhook_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_webhook_error(webhook_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE webhook 
  SET 
    "errorCount" = "errorCount" + 1,
    "lastError" = NOW()
  WHERE "id" = webhook_id;
END;
$$;



ALTER TABLE "webhook" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "SELECT" ON "public"."webhook"
FOR SELECT
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."webhook"
FOR INSERT
WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."webhook"
FOR UPDATE
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."webhook"
FOR DELETE
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('settings_delete')
    )::text[]
  )
);

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.webhook_insert ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  webhook_endpoint TEXT;
  api_url TEXT;
  anon_key TEXT;
  webhook_record RECORD;
BEGIN

  FOR webhook_record IN 
    SELECT "url", "id"
    FROM webhook 
    WHERE "companyId" = NEW."companyId"
    AND "onInsert" = true
    AND "table" = TG_TABLE_NAME
    AND "active" = true
  LOOP
    
    DECLARE
      request_id TEXT;
    BEGIN
      IF api_url IS NULL THEN
        SELECT "apiUrl", "anonKey" INTO api_url, anon_key FROM "config" LIMIT 1;
        webhook_endpoint := api_url || '/functions/v1/webhook';
      END IF;


      SELECT net.http_post(
        webhook_endpoint,
        jsonb_build_object(
          'type', 'INSERT', 
          'record', row_to_json(NEW),
          'old', NULL,
          'url', webhook_record.url,
          'companyId', NEW."companyId",
          'table', TG_TABLE_NAME,
          'webhookId', webhook_record.id
        )::jsonb,
        '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key)
      ) INTO request_id;
      
      
    END;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'Error in webhook_insert: % %', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.webhook_update ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  webhook_endpoint TEXT;
  api_url TEXT;
  anon_key TEXT;
  webhook_record RECORD;
BEGIN

  FOR webhook_record IN 
    SELECT "url", "id"
    FROM webhook 
    WHERE "companyId" = NEW."companyId"
    AND "onUpdate" = true
    AND "table" = TG_TABLE_NAME
    AND "active" = true
  LOOP
    
    DECLARE
      request_id TEXT;
    BEGIN
      IF api_url IS NULL THEN
        SELECT "apiUrl", "anonKey" INTO api_url, anon_key FROM "config" LIMIT 1;
        webhook_endpoint := api_url || '/functions/v1/webhook';
      END IF;


      SELECT net.http_post(
        webhook_endpoint,
        jsonb_build_object(
          'type', 'UPDATE', 
          'record', row_to_json(NEW),
          'old', row_to_json(OLD),
          'url', webhook_record.url,
          'companyId', NEW."companyId",
          'table', TG_TABLE_NAME,
          'webhookId', webhook_record.id
        )::jsonb,
        '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key)
      ) INTO request_id;
      
      
    END;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'Error in webhook_insert: % %', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.webhook_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  webhook_endpoint TEXT;
  api_url TEXT;
  anon_key TEXT;
  webhook_record RECORD;
BEGIN

  FOR webhook_record IN 
    SELECT "url", "id"
    FROM webhook 
    WHERE "companyId" = OLD."companyId"
    AND "onDelete" = true
    AND "table" = TG_TABLE_NAME
    AND "active" = true
  LOOP
    
    DECLARE
      request_id TEXT;
    BEGIN
      IF api_url IS NULL THEN
        SELECT "apiUrl", "anonKey" INTO api_url, anon_key FROM "config" LIMIT 1;
        webhook_endpoint := api_url || '/functions/v1/webhook';
      END IF;

      SELECT net.http_post(
        webhook_endpoint,
        jsonb_build_object(
          'type', 'DELETE',
          'record', row_to_json(OLD),
          'url', webhook_record.url,
          'companyId', OLD."companyId",
          'table', TG_TABLE_NAME,
          'webhookId', webhook_record.id
        )::jsonb,
        '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key)
      ) INTO request_id;
      
    END;
  END LOOP;

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'Error in webhook_delete: % %', SQLERRM, SQLSTATE;
  RETURN OLD;
END;
$$;



INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('customer', 'Sales', 'Customer');

CREATE OR REPLACE TRIGGER "customerInsertWebhook"
AFTER INSERT ON "customer"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "customerUpdateWebhook"
AFTER UPDATE ON "customer"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "customerDeleteWebhook"
AFTER DELETE ON "customer"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('quote', 'Sales', 'Quote');

CREATE OR REPLACE TRIGGER "quoteInsertWebhook"
AFTER INSERT ON "quote"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "quoteUpdateWebhook"
AFTER UPDATE ON "quote"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "quoteDeleteWebhook"
AFTER DELETE ON "quote"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('salesOrder', 'Sales', 'Sales Order');

CREATE OR REPLACE TRIGGER "salesOrderInsertWebhook"
AFTER INSERT ON "salesOrder"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "salesOrderUpdateWebhook"
AFTER UPDATE ON "salesOrder"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "salesOrderDeleteWebhook"
AFTER DELETE ON "salesOrder"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('salesRfq', 'Sales', 'Sales RFQ');

CREATE OR REPLACE TRIGGER "salesRfqInsertWebhook"
AFTER INSERT ON "salesRfq"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "salesRfqUpdateWebhook"
AFTER UPDATE ON "salesRfq"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "salesRfqDeleteWebhook"
AFTER DELETE ON "salesRfq"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('job', 'Production', 'Job');

CREATE OR REPLACE TRIGGER "jobInsertWebhook"
AFTER INSERT ON "job"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "jobUpdateWebhook"
AFTER UPDATE ON "job"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "jobDeleteWebhook"
AFTER DELETE ON "job"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('item', 'Items', 'Item');

CREATE OR REPLACE TRIGGER "itemInsertWebhook"
AFTER INSERT ON "item"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "itemUpdateWebhook"
AFTER UPDATE ON "item"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "itemDeleteWebhook"
AFTER DELETE ON "item"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('receipt', 'Inventory', 'Receipt');

CREATE OR REPLACE TRIGGER "receiptInsertWebhook"
AFTER INSERT ON "receipt"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "receiptUpdateWebhook"
AFTER UPDATE ON "receipt"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "receiptDeleteWebhook"
AFTER DELETE ON "receipt"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('purchaseOrder', 'Purchasing', 'Purchase Order');

CREATE OR REPLACE TRIGGER "purchaseOrderInsertWebhook"
AFTER INSERT ON "purchaseOrder"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "purchaseOrderUpdateWebhook"
AFTER UPDATE ON "purchaseOrder"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "purchaseOrderDeleteWebhook"
AFTER DELETE ON "purchaseOrder"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('supplier', 'Purchasing', 'Supplier');

CREATE OR REPLACE TRIGGER "supplierInsertWebhook"
AFTER INSERT ON "supplier"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "supplierUpdateWebhook"
AFTER UPDATE ON "supplier"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "supplierDeleteWebhook"
AFTER DELETE ON "supplier"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('supplierQuote', 'Purchasing', 'Supplier Quote');

CREATE OR REPLACE TRIGGER "supplierQuoteInsertWebhook"
AFTER INSERT ON "supplierQuote"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "supplierQuoteUpdateWebhook"
AFTER UPDATE ON "supplierQuote"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "supplierQuoteDeleteWebhook"
AFTER DELETE ON "supplierQuote"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('purchaseInvoice', 'Invoicing', 'Purchase Invoice');

CREATE OR REPLACE TRIGGER "purchaseInvoiceInsertWebhook"
AFTER INSERT ON "purchaseInvoice"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "purchaseInvoiceUpdateWebhook"
AFTER UPDATE ON "purchaseInvoice"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "purchaseInvoiceDeleteWebhook"
AFTER DELETE ON "purchaseInvoice"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('employee', 'Users', 'Employee');

CREATE OR REPLACE TRIGGER "employeeInsertWebhook"
AFTER INSERT ON "employee"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "employeeUpdateWebhook"
AFTER UPDATE ON "employee"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "employeeDeleteWebhook"
AFTER DELETE ON "employee"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();
