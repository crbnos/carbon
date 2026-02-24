-- Add webhook support for salesInvoice table

INSERT INTO "webhookTable" ("table", "module", "name") VALUES
('salesInvoice', 'Invoicing', 'Sales Invoice');

CREATE OR REPLACE TRIGGER "salesInvoiceInsertWebhook"
AFTER INSERT ON "salesInvoice"
FOR EACH ROW EXECUTE FUNCTION public.webhook_insert();

CREATE OR REPLACE TRIGGER "salesInvoiceUpdateWebhook"
AFTER UPDATE ON "salesInvoice"
FOR EACH ROW EXECUTE FUNCTION public.webhook_update();

CREATE OR REPLACE TRIGGER "salesInvoiceDeleteWebhook"
AFTER DELETE ON "salesInvoice"
FOR EACH ROW EXECUTE FUNCTION public.webhook_delete();
