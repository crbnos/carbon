-- Which part numbers a document line prints (.ai/specs/2026-11-19-part-number-display.md):
-- the stamp on a new line, the copy of the other party's number, the restamp on a
-- party change, and the skip for a backup load.
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/part-number-display.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_group text; v_company text; v_item text; v_other_item text;
  v_supplier text; v_override_supplier text; v_plain_supplier text;
  v_interaction text; v_po text; v_other_po text;
  v_line text; v_kept_line text; v_display "partNumberDisplay"; v_part text;
  v_customer text; v_override_customer text; v_quote text; v_so text;
  v_invoice text; v_shipment text; v_legacy_line text; v_revision text;
  v_invoice_line text; v_invoice_shipment text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Part number display test', 'system') RETURNING id INTO v_group;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Part number display test', v_group, 'USD', 'UTC') RETURNING id INTO v_company;
  INSERT INTO "companySettings" (id) VALUES (v_company) ON CONFLICT (id) DO NOTHING;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('PND-1', 'Bracket', 'Part', 'Inventory', 'EA', v_company, 'system') RETURNING id INTO v_item;
  INSERT INTO item ("readableId", name, type, "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('PND-2', 'Fastener', 'Part', 'Inventory', 'EA', v_company, 'system') RETURNING id INTO v_other_item;

  -- The defaults a new company starts with.
  ASSERT (SELECT "supplierPartNumberDisplay" FROM "companySettings" WHERE id = v_company) = 'Theirs First',
    'New purchase order lines start as Theirs First';
  ASSERT (SELECT "customerPartNumberDisplay" FROM "companySettings" WHERE id = v_company) = 'Ours First',
    'New sales lines start as Ours First';

  -- A supplier with a supplier part, one with an override, and one with neither.
  INSERT INTO supplier (name, "readableId", "companyId") VALUES ('Plain supplier', 'PND-S1', v_company) RETURNING id INTO v_supplier;
  INSERT INTO supplier (name, "readableId", "companyId", "partNumberDisplay")
    VALUES ('Override supplier', 'PND-S2', v_company, 'Ours Only') RETURNING id INTO v_override_supplier;
  INSERT INTO supplier (name, "readableId", "companyId") VALUES ('No parts supplier', 'PND-S3', v_company) RETURNING id INTO v_plain_supplier;
  INSERT INTO "supplierPart" ("itemId", "supplierId", "supplierPartId", "companyId", "createdBy")
    VALUES (v_item, v_supplier, 'SUP-100', v_company, 'system');
  INSERT INTO "supplierPart" ("itemId", "supplierId", "supplierPartId", "companyId", "createdBy")
    VALUES (v_item, v_override_supplier, 'OVR-100', v_company, 'system');
  INSERT INTO "supplierPart" ("itemId", "supplierId", "supplierPartId", "companyId", "createdBy")
    VALUES (v_other_item, v_supplier, 'SUP-200', v_company, 'system');
  INSERT INTO "supplierInteraction" ("companyId", "supplierId") VALUES (v_company, v_supplier) RETURNING id INTO v_interaction;
  INSERT INTO "purchaseOrder" ("purchaseOrderId", "supplierId", "supplierInteractionId", "companyId", "createdBy")
    VALUES ('PND-PO', v_supplier, v_interaction, v_company, 'system') RETURNING id INTO v_po;

  -- A new line takes the company default and copies the supplier part number.
  INSERT INTO "purchaseOrderLine" ("purchaseOrderId", "purchaseOrderLineType", "itemId", "companyId", "createdBy")
    VALUES (v_po, 'Part', v_item, v_company, 'system') RETURNING id INTO v_line;
  SELECT "partNumberDisplay", "supplierPartId" INTO v_display, v_part FROM "purchaseOrderLine" WHERE id = v_line;
  ASSERT v_display = 'Theirs First', format('A new PO line takes the company default, got %s', v_display);
  ASSERT v_part = 'SUP-100', format('A new PO line copies the supplier part number, got %s', v_part);

  -- A later edit of the supplier part leaves the line's copy as it was.
  UPDATE "supplierPart" SET "supplierPartId" = 'SUP-101' WHERE "supplierId" = v_supplier AND "itemId" = v_item;
  ASSERT (SELECT "supplierPartId" FROM "purchaseOrderLine" WHERE id = v_line) = 'SUP-100',
    'An edit of the supplier part does not change the line';

  -- An item change copies the new item's number, unless the same write sets one.
  UPDATE "purchaseOrderLine" SET "itemId" = v_other_item WHERE id = v_line;
  ASSERT (SELECT "supplierPartId" FROM "purchaseOrderLine" WHERE id = v_line) = 'SUP-200',
    'An item change copies the new item''s supplier part number';
  UPDATE "purchaseOrderLine" SET "itemId" = v_item, "supplierPartId" = 'TYPED-1' WHERE id = v_line;
  ASSERT (SELECT "supplierPartId" FROM "purchaseOrderLine" WHERE id = v_line) = 'TYPED-1',
    'An item change that sets the number keeps it';
  UPDATE "purchaseOrderLine" SET "supplierPartId" = 'SUP-101' WHERE id = v_line;

  -- A value the insert sets wins over the stamp and the copy.
  INSERT INTO "purchaseOrderLine" ("purchaseOrderId", "purchaseOrderLineType", "itemId", "partNumberDisplay", "supplierPartId", "companyId", "createdBy")
    VALUES (v_po, 'Part', v_other_item, 'Theirs Only', 'GIVEN-1', v_company, 'system') RETURNING id INTO v_kept_line;
  SELECT "partNumberDisplay", "supplierPartId" INTO v_display, v_part FROM "purchaseOrderLine" WHERE id = v_kept_line;
  ASSERT v_display = 'Theirs Only' AND v_part = 'GIVEN-1', 'An explicit choice and number are kept';

  -- A legacy line keeps its null when the supplier changes; a stamped line takes
  -- the new supplier's override, and every line takes the new supplier's numbers.
  UPDATE "purchaseOrderLine" SET "partNumberDisplay" = NULL WHERE id = v_kept_line;
  UPDATE "purchaseOrder" SET "supplierId" = v_override_supplier WHERE id = v_po;
  SELECT "partNumberDisplay", "supplierPartId" INTO v_display, v_part FROM "purchaseOrderLine" WHERE id = v_line;
  ASSERT v_display = 'Ours Only', format('A supplier change gives a stamped line the new supplier''s choice, got %s', v_display);
  ASSERT v_part = 'OVR-100', format('A supplier change copies the new supplier''s part number, got %s', v_part);
  SELECT "partNumberDisplay", "supplierPartId" INTO v_display, v_part FROM "purchaseOrderLine" WHERE id = v_kept_line;
  ASSERT v_display IS NULL, 'A supplier change keeps a legacy line legacy';
  ASSERT v_part IS NULL, 'A supplier change replaces a typed number with the new supplier''s, here none';

  -- A new line under the override supplier takes the override.
  INSERT INTO "purchaseOrderLine" ("purchaseOrderId", "purchaseOrderLineType", "itemId", "companyId", "createdBy")
    VALUES (v_po, 'Part', v_item, v_company, 'system') RETURNING id INTO v_line;
  ASSERT (SELECT "partNumberDisplay" FROM "purchaseOrderLine" WHERE id = v_line) = 'Ours Only',
    'A new line takes the supplier''s override';

  -- A supplier change that changes nothing on a line does not write it.
  INSERT INTO "purchaseOrder" ("purchaseOrderId", "supplierId", "supplierInteractionId", "companyId", "createdBy")
    VALUES ('PND-PO-2', v_plain_supplier, v_interaction, v_company, 'system') RETURNING id INTO v_other_po;
  INSERT INTO "purchaseOrderLine" ("purchaseOrderId", "purchaseOrderLineType", "itemId", "companyId", "createdBy")
    VALUES (v_other_po, 'Part', v_other_item, v_company, 'system') RETURNING id INTO v_line;
  UPDATE "supplierPart" SET "supplierPartId" = NULL WHERE "supplierId" = v_supplier AND "itemId" = v_other_item;
  UPDATE "purchaseOrder" SET "supplierId" = v_supplier, "updatedBy" = 'system' WHERE id = v_other_po;
  ASSERT (SELECT "updatedAt" IS NULL FROM "purchaseOrderLine" WHERE id = v_line),
    'A supplier change leaves a line with the same values unwritten';

  -- Sales: a customer with a cross-reference, and one with an override.
  INSERT INTO customer (name, "readableId", "companyId") VALUES ('Plain customer', 'PND-C1', v_company) RETURNING id INTO v_customer;
  INSERT INTO customer (name, "readableId", "companyId", "partNumberDisplay")
    VALUES ('Override customer', 'PND-C2', v_company, 'Theirs Only') RETURNING id INTO v_override_customer;
  INSERT INTO "customerPartToItem" ("customerId", "itemId", "customerPartId", "customerPartRevision", "companyId")
    VALUES (v_customer, v_item, 'C-100', '3', v_company);
  INSERT INTO "customerPartToItem" ("customerId", "itemId", "customerPartId", "companyId")
    VALUES (v_override_customer, v_item, 'C-200', v_company);
  INSERT INTO "customerPartToItem" ("customerId", "itemId", "customerPartId", "companyId")
    VALUES (v_customer, v_other_item, 'C-300', v_company);

  -- Quote lines: the stamp, and a customer change copies the new customer's
  -- choice and numbers onto the stamped lines.
  INSERT INTO quote ("quoteId", "customerId", "companyId", "createdBy")
    VALUES ('PND-Q', v_customer, v_company, 'system') RETURNING id INTO v_quote;
  INSERT INTO "quoteLine" ("quoteId", "itemId", description, "customerPartId", "customerPartRevision", "companyId", "createdBy")
    VALUES (v_quote, v_item, 'Bracket', 'C-100', '3', v_company, 'system') RETURNING id INTO v_line;
  ASSERT (SELECT "partNumberDisplay" FROM "quoteLine" WHERE id = v_line) = 'Ours First',
    'A new quote line takes the company default';
  UPDATE quote SET "customerId" = v_override_customer, "updatedBy" = 'system' WHERE id = v_quote;
  SELECT "partNumberDisplay", "customerPartId", "customerPartRevision" INTO v_display, v_part, v_revision
    FROM "quoteLine" WHERE id = v_line;
  ASSERT v_display = 'Theirs Only' AND v_part = 'C-200' AND coalesce(v_revision, '') = '',
    format('A quote customer change gives the line the new customer''s choice and number, got %s %s %s', v_display, v_part, v_revision);

  -- Sales order lines: the stamp and the copy of the customer's number.
  INSERT INTO "salesOrder" ("salesOrderId", "currencyCode", "customerId", "companyId", "createdBy")
    VALUES ('PND-SO', 'USD', v_customer, v_company, 'system') RETURNING id INTO v_so;
  INSERT INTO "salesOrderLine" ("salesOrderId", "salesOrderLineType", "itemId", "companyId", "createdBy")
    VALUES (v_so, 'Part', v_item, v_company, 'system') RETURNING id INTO v_line;
  SELECT "partNumberDisplay", "customerPartId", "customerPartRevision" INTO v_display, v_part, v_revision
    FROM "salesOrderLine" WHERE id = v_line;
  ASSERT v_display = 'Ours First', format('A new order line takes the company default, got %s', v_display);
  ASSERT v_part = 'C-100' AND v_revision = '3', 'A new order line copies the customer part number and revision';

  -- An item change copies the new item's number, unless the same write sets one.
  UPDATE "salesOrderLine" SET "itemId" = v_other_item WHERE id = v_line;
  ASSERT (SELECT "customerPartId" FROM "salesOrderLine" WHERE id = v_line) = 'C-300',
    'An item change copies the new item''s customer part number';
  UPDATE "salesOrderLine" SET "itemId" = v_item, "customerPartId" = 'C-100', "customerPartRevision" = '3' WHERE id = v_line;
  ASSERT (SELECT "customerPartId" FROM "salesOrderLine" WHERE id = v_line) = 'C-100',
    'An item change that sets the number keeps it';

  -- The view reads the copy, and the live cross-reference under its own name.
  UPDATE "customerPartToItem" SET "customerPartId" = 'C-101' WHERE "customerId" = v_customer AND "itemId" = v_item;
  ASSERT (SELECT "customerPartId" FROM "salesOrderLines" WHERE id = v_line) = 'C-100',
    'salesOrderLines returns the line copy';
  ASSERT (SELECT "customerPartIdFromCustomer" FROM "salesOrderLines" WHERE id = v_line) = 'C-101',
    'salesOrderLines returns the live cross-reference as customerPartIdFromCustomer';

  -- A legacy order line keeps its null through a customer change, and still takes the numbers.
  INSERT INTO "salesOrderLine" ("salesOrderId", "salesOrderLineType", "itemId", "companyId", "createdBy")
    VALUES (v_so, 'Part', v_item, v_company, 'system') RETURNING id INTO v_legacy_line;
  UPDATE "salesOrderLine" SET "partNumberDisplay" = NULL WHERE id = v_legacy_line;
  UPDATE "salesOrder" SET "customerId" = v_override_customer WHERE id = v_so;
  SELECT "partNumberDisplay", "customerPartId", "customerPartRevision" INTO v_display, v_part, v_revision
    FROM "salesOrderLine" WHERE id = v_line;
  ASSERT v_display = 'Theirs Only', format('A customer change restamps the line, got %s', v_display);
  ASSERT v_part = 'C-200' AND coalesce(v_revision, '') = '', format('A customer change copies the new customer''s number, got %s %s', v_part, v_revision);
  SELECT "partNumberDisplay", "customerPartId" INTO v_display, v_part FROM "salesOrderLine" WHERE id = v_legacy_line;
  ASSERT v_display IS NULL AND v_part = 'C-200', 'A customer change keeps a legacy order line legacy and copies the number';

  -- Invoice and shipment lines: the stamp, and the views read the order line's
  -- copy while the document's customer is the order's, else the cross-reference.
  UPDATE "customerPartToItem" SET "customerPartId" = 'C-201' WHERE "customerId" = v_override_customer AND "itemId" = v_item;
  INSERT INTO "salesInvoice" ("invoiceId", "customerId", "currencyCode", "companyId", "createdBy")
    VALUES ('PND-INV', v_override_customer, 'USD', v_company, 'system') RETURNING id INTO v_invoice;
  INSERT INTO "salesInvoiceLine" ("invoiceId", "invoiceLineType", "itemId", "unitOfMeasureCode", "salesOrderLineId", "companyId", "createdBy")
    VALUES (v_invoice, 'Part', v_item, 'EA', v_line, v_company, 'system') RETURNING id INTO v_invoice_line;
  ASSERT (SELECT "partNumberDisplay" FROM "salesInvoiceLine" WHERE id = v_invoice_line) = 'Theirs Only',
    'A new invoice line takes the customer''s choice';
  ASSERT (SELECT "customerPartId" FROM "salesInvoiceLines" WHERE id = v_invoice_line) = 'C-200',
    'salesInvoiceLines reads the order line''s copy';
  INSERT INTO "salesInvoiceLine" ("invoiceId", "invoiceLineType", "itemId", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES (v_invoice, 'Part', v_item, 'EA', v_company, 'system') RETURNING id INTO v_kept_line;
  ASSERT (SELECT "customerPartId" FROM "salesInvoiceLines" WHERE id = v_kept_line) = 'C-201',
    'salesInvoiceLines reads the cross-reference when no order line holds a copy';
  UPDATE "salesInvoice" SET "customerId" = v_customer WHERE id = v_invoice;
  ASSERT (SELECT "partNumberDisplay" FROM "salesInvoiceLine" WHERE id = v_invoice_line) = 'Ours First',
    'An invoice customer change restamps its lines';
  ASSERT (SELECT "customerPartId" FROM "salesInvoiceLines" WHERE id = v_invoice_line) = 'C-101',
    'salesInvoiceLines reads the new customer''s cross-reference once it is not the order''s';
  UPDATE "salesInvoice" SET "customerId" = v_override_customer WHERE id = v_invoice;

  INSERT INTO shipment ("shipmentId", "customerId", "sourceDocument", "sourceDocumentId", "companyId", "createdBy")
    VALUES ('PND-SH', v_override_customer, 'Sales Order', v_so, v_company, 'system') RETURNING id INTO v_shipment;
  INSERT INTO "shipmentLine" ("shipmentId", "itemId", "unitOfMeasure", "unitPrice", "lineId", "companyId", "createdBy")
    VALUES (v_shipment, v_item, 'EA', 0, v_line, v_company, 'system') RETURNING id INTO v_kept_line;
  ASSERT (SELECT "partNumberDisplay" FROM "shipmentLine" WHERE id = v_kept_line) = 'Theirs Only',
    'A new shipment line takes the customer''s choice';
  ASSERT (SELECT "customerPartId" FROM "shipmentLines" WHERE id = v_kept_line) = 'C-200',
    'shipmentLines reads the order line''s copy';

  -- A shipment a posted invoice made names the invoice line; the view follows it to the order line.
  INSERT INTO shipment ("shipmentId", "customerId", "sourceDocument", "sourceDocumentId", "companyId", "createdBy")
    VALUES ('PND-SH-INV', v_override_customer, 'Sales Invoice', v_invoice, v_company, 'system') RETURNING id INTO v_invoice_shipment;
  INSERT INTO "shipmentLine" ("shipmentId", "itemId", "unitOfMeasure", "unitPrice", "lineId", "companyId", "createdBy")
    VALUES (v_invoice_shipment, v_item, 'EA', 0, v_invoice_line, v_company, 'system') RETURNING id INTO v_legacy_line;
  ASSERT (SELECT "customerPartId" FROM "shipmentLines" WHERE id = v_legacy_line) = 'C-200',
    'shipmentLines reads the order line''s copy through the invoice line';

  -- A customer change that changes nothing on a line does not write it.
  UPDATE "customer" SET "partNumberDisplay" = 'Theirs Only' WHERE id = v_customer;
  UPDATE "shipmentLine" SET "updatedAt" = NULL WHERE id = v_kept_line;
  UPDATE shipment SET "customerId" = v_customer WHERE id = v_shipment;
  ASSERT (SELECT "updatedAt" IS NULL FROM "shipmentLine" WHERE id = v_kept_line),
    'A customer change leaves a line with the same choice unwritten';

  -- A backup load brings its own values: no stamp, no copy, no restamp.
  PERFORM set_config('app.backup_load', 'on', true);
  INSERT INTO "purchaseOrderLine" ("purchaseOrderId", "purchaseOrderLineType", "itemId", "companyId", "createdBy")
    VALUES (v_po, 'Part', v_item, v_company, 'system') RETURNING id INTO v_line;
  ASSERT (SELECT "partNumberDisplay" IS NULL AND "supplierPartId" IS NULL FROM "purchaseOrderLine" WHERE id = v_line),
    'A backup load keeps a line''s nulls';
  UPDATE "purchaseOrderLine" SET "itemId" = v_other_item WHERE id = v_line;
  ASSERT (SELECT "supplierPartId" IS NULL FROM "purchaseOrderLine" WHERE id = v_line),
    'A backup load does not copy on an item change';
  UPDATE "purchaseOrder" SET "supplierId" = v_supplier WHERE id = v_po;
  ASSERT (SELECT "partNumberDisplay" FROM "purchaseOrderLine" WHERE "purchaseOrderId" = v_po AND "partNumberDisplay" IS NOT NULL LIMIT 1) = 'Ours Only',
    'A backup load does not restamp on a supplier change';
  INSERT INTO "salesOrderLine" ("salesOrderId", "salesOrderLineType", "itemId", "companyId", "createdBy")
    VALUES (v_so, 'Part', v_item, v_company, 'system') RETURNING id INTO v_line;
  ASSERT (SELECT "partNumberDisplay" IS NULL AND "customerPartId" IS NULL FROM "salesOrderLine" WHERE id = v_line),
    'A backup load keeps a sales order line''s nulls';
  PERFORM set_config('app.backup_load', '', true);

  -- A dataset apply and an accounting sync are not backup loads: their lines are
  -- stamped. The order is back on the plain supplier, so the company default applies.
  PERFORM set_config('app.dataset_apply', 'true', true);
  PERFORM set_config('app.sync_in_progress', 'true', true);
  INSERT INTO "purchaseOrderLine" ("purchaseOrderId", "purchaseOrderLineType", "itemId", "companyId", "createdBy")
    VALUES (v_po, 'Part', v_item, v_company, 'system') RETURNING id INTO v_line;
  SELECT "partNumberDisplay", "supplierPartId" INTO v_display, v_part FROM "purchaseOrderLine" WHERE id = v_line;
  ASSERT v_display = 'Theirs First' AND v_part = 'SUP-101',
    format('A dataset apply or sync line is stamped and copied, got %s %s', v_display, v_part);
  INSERT INTO "salesOrderLine" ("salesOrderId", "salesOrderLineType", "itemId", "companyId", "createdBy")
    VALUES (v_so, 'Part', v_item, v_company, 'system') RETURNING id INTO v_line;
  SELECT "partNumberDisplay", "customerPartId" INTO v_display, v_part FROM "salesOrderLine" WHERE id = v_line;
  ASSERT v_display = 'Theirs Only' AND v_part = 'C-201',
    format('A dataset apply or sync sales order line is stamped and copied, got %s %s', v_display, v_part);
  PERFORM set_config('app.dataset_apply', '', true);
  PERFORM set_config('app.sync_in_progress', '', true);

  RAISE NOTICE 'part-number-display: all assertions passed';
END
$$;

ROLLBACK;
