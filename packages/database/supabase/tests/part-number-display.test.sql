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

  -- The default a new company starts with.
  ASSERT (SELECT "supplierPartNumberDisplay" FROM "companySettings" WHERE id = v_company) = 'Theirs First',
    'New purchase order lines start as Theirs First';

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
  PERFORM set_config('app.dataset_apply', '', true);
  PERFORM set_config('app.sync_in_progress', '', true);

  RAISE NOTICE 'part-number-display: all assertions passed';
END
$$;

ROLLBACK;
