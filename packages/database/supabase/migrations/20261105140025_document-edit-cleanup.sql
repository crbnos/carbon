-- A document's edits go with the record they edit. `documentEdit` has no foreign
-- key, because it points at one of 11 tables, so each record table removes its own
-- row. Nothing else may write this table through the API, so the function runs as
-- its owner.
CREATE FUNCTION public.delete_document_edit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM "documentEdit"
  WHERE "companyId" = OLD."companyId"
    AND "documentType" = TG_ARGV[0]
    AND "documentId" = OLD."id";
  RETURN OLD;
END;
$$;

CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "purchaseOrder"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('purchaseOrder');
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "purchaseReturnOrder"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('purchaseReturnOrder');
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "purchasingRfq"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('purchasingRfq');
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "quote"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('quote');
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "salesOrder"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('salesOrder');
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "salesReturnOrder"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('salesReturnOrder');
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "salesInvoice"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('salesInvoice');
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "shipment"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('packingSlip');
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "stockTransfer"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('stockTransfer');
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "job"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('jobTraveler');
CREATE TRIGGER "delete_document_edit" AFTER DELETE ON "nonConformance"
  FOR EACH ROW EXECUTE FUNCTION public.delete_document_edit('issue');
