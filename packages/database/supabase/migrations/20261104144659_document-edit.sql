-- Edits to one document: how one purchase order, invoice, quote (and so on)
-- prints, on top of the company's document template. Only the changes are
-- stored, in the template's own shape, so a word left alone still follows the
-- template.
CREATE TABLE IF NOT EXISTS "documentEdit" (
    "id" TEXT NOT NULL DEFAULT id('dedit'),
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    -- The record the document prints (a purchaseOrder, a shipment for a packing
    -- slip, a job for a traveler...). No FK: it points at one of 11 tables.
    "documentId" TEXT NOT NULL,
    -- Per block id: { text?, hide?, show?, visible?, content? }.
    "blocks" JSONB NOT NULL DEFAULT '{}',
    -- The document's own texts and changed values: { text?, hide?, show?, valueEdits? }.
    "settings" JSONB NOT NULL DEFAULT '{}',

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "documentEdit_documentType_check" CHECK ("documentType" IN (
      'purchaseOrder', 'purchaseReturnOrder', 'purchasingRfq', 'quote',
      'salesOrder', 'salesReturnOrder', 'salesInvoice', 'packingSlip',
      'stockTransfer', 'jobTraveler', 'issue'
    ))
);

CREATE INDEX IF NOT EXISTS "documentEdit_companyId_idx" ON "documentEdit" ("companyId");
CREATE INDEX IF NOT EXISTS "documentEdit_createdBy_idx" ON "documentEdit" ("createdBy");
CREATE INDEX IF NOT EXISTS "documentEdit_updatedBy_idx" ON "documentEdit" ("updatedBy");

-- One set of edits per document.
ALTER TABLE "documentEdit" DROP CONSTRAINT IF EXISTS "documentEdit_companyId_documentType_documentId_key";
ALTER TABLE "documentEdit" ADD CONSTRAINT "documentEdit_companyId_documentType_documentId_key"
    UNIQUE ("companyId", "documentType", "documentId");

ALTER TABLE "public"."documentEdit" ENABLE ROW LEVEL SECURITY;

-- A document's edits go with the record they edit. `documentEdit` has no foreign
-- key, because it points at one of 11 tables, so each record table removes its own
-- row. Nothing else may write this table through the API, so the function runs as
-- its owner.
CREATE OR REPLACE FUNCTION public.delete_document_edit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM "documentEdit"
  WHERE "companyId" = OLD."companyId"
    AND "documentType" = TG_ARGV[0]
    AND "documentId" = OLD."id";
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS "delete_document_edit" ON "purchaseOrder";
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "purchaseOrder"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('purchaseOrder');
DROP TRIGGER IF EXISTS "delete_document_edit" ON "purchaseReturnOrder";
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "purchaseReturnOrder"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('purchaseReturnOrder');
DROP TRIGGER IF EXISTS "delete_document_edit" ON "purchasingRfq";
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "purchasingRfq"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('purchasingRfq');
DROP TRIGGER IF EXISTS "delete_document_edit" ON "quote";
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "quote"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('quote');
DROP TRIGGER IF EXISTS "delete_document_edit" ON "salesOrder";
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "salesOrder"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('salesOrder');
DROP TRIGGER IF EXISTS "delete_document_edit" ON "salesReturnOrder";
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "salesReturnOrder"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('salesReturnOrder');
DROP TRIGGER IF EXISTS "delete_document_edit" ON "salesInvoice";
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "salesInvoice"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('salesInvoice');
DROP TRIGGER IF EXISTS "delete_document_edit" ON "shipment";
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "shipment"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('packingSlip');
DROP TRIGGER IF EXISTS "delete_document_edit" ON "stockTransfer";
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "stockTransfer"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('stockTransfer');
DROP TRIGGER IF EXISTS "delete_document_edit" ON "job";
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "job"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('jobTraveler');
DROP TRIGGER IF EXISTS "delete_document_edit" ON "nonConformance";
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "nonConformance"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('issue');
