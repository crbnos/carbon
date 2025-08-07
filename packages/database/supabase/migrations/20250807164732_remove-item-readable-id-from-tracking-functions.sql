-- Update functions that use xid() to use nanoid() instead
CREATE OR REPLACE FUNCTION update_receipt_line_batch_tracking(
  p_receipt_line_id TEXT,
  p_receipt_id TEXT,
  p_batch_number TEXT,
  p_quantity NUMERIC,
  p_tracked_entity_id TEXT DEFAULT NULL,
  p_properties JSONB DEFAULT '{}'
) RETURNS void AS $$
DECLARE
  v_tracked_entity_id TEXT;
  v_item_id TEXT;
  v_item_readable_id TEXT;
  v_company_id TEXT;
  v_created_by TEXT;
  v_supplier_id TEXT;
  v_attributes JSONB;
BEGIN
  v_tracked_entity_id := COALESCE(p_tracked_entity_id, nanoid());
  -- Rest of function remains the same
  -- Get receipt line details
  SELECT 
    rl."itemId",  
    i."readableIdWithRevision",
    rl."companyId",
    rl."createdBy",
    r."supplierId"
  INTO
    v_item_id,
    v_item_readable_id,
    v_company_id,
    v_created_by,
    v_supplier_id
  FROM "receiptLine" rl
  JOIN "receipt" r ON r.id = rl."receiptId"
  JOIN "item" i ON i.id = rl."itemId"
  WHERE rl.id = p_receipt_line_id;

  -- Build attributes JSONB
  v_attributes := jsonb_build_object(
    'Batch Number', p_batch_number,
    'Receipt Line', p_receipt_line_id,
    'Receipt', p_receipt_id
  );
  
  -- Add supplier if available
  IF v_supplier_id IS NOT NULL THEN
    v_attributes := v_attributes || jsonb_build_object('Supplier', v_supplier_id);
  END IF;
  
  -- Merge any additional properties
  v_attributes := v_attributes || p_properties;

  -- Upsert the tracked entity with attributes
  INSERT INTO "trackedEntity" (
    "id", 
    "quantity", 
    "status",
    "sourceDocument", 
    "sourceDocumentId", 
    "sourceDocumentReadableId", 
    "attributes",
    "companyId", 
    "createdBy"
  )
  VALUES (
    v_tracked_entity_id,
    p_quantity,
    'On Hold',
    'Item',
    v_item_id,
    v_item_readable_id,
    v_attributes,
    v_company_id,
    v_created_by
  )
  ON CONFLICT (id) DO UPDATE SET
    "quantity" = EXCLUDED."quantity",
    "attributes" = EXCLUDED."attributes";
    
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_receipt_line_serial_tracking(
  p_receipt_line_id TEXT,
  p_receipt_id TEXT,
  p_serial_number TEXT,
  p_index INTEGER,
  p_tracked_entity_id TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_item_id TEXT;
  v_item_readable_id TEXT;
  v_serial_id TEXT;
  v_company_id TEXT;
  v_created_by TEXT;
  v_supplier_id TEXT;
  v_attributes JSONB;
BEGIN
  -- Get receipt line details
  SELECT 
    rl."itemId",
    i."readableIdWithRevision",
    rl."companyId",
    rl."createdBy",
    r."supplierId"
  INTO
    v_item_id,
    v_item_readable_id,
    v_company_id,
    v_created_by,
    v_supplier_id
  FROM "receiptLine" rl
  JOIN "receipt" r ON r.id = rl."receiptId"
  JOIN "item" i ON i.id = rl."itemId"
  WHERE rl.id = p_receipt_line_id;

  -- First create the tracked entity for this serial number
  v_serial_id := COALESCE(p_tracked_entity_id, nanoid());
  
  -- Build attributes JSONB
  v_attributes := jsonb_build_object(
    'Serial Number', p_serial_number,
    'Receipt Line', p_receipt_line_id,
    'Receipt', p_receipt_id,
    'Receipt Line Index', p_index
  );
  
  -- Add supplier if available
  IF v_supplier_id IS NOT NULL THEN
    v_attributes := v_attributes || jsonb_build_object('Supplier', v_supplier_id);
  END IF;
  
  INSERT INTO "trackedEntity" (
    "id", 
    "quantity", 
    "status",
    "sourceDocument", 
    "sourceDocumentId", 
    "sourceDocumentReadableId", 
    "attributes",
    "companyId", 
    "createdBy"
  )
  VALUES (
    v_serial_id,
    1,
    'On Hold',
    'Item',
    v_item_id,
    v_item_readable_id,
    v_attributes,
    v_company_id,
    v_created_by
  )
  ON CONFLICT (id) DO UPDATE SET
    "quantity" = EXCLUDED."quantity",
    "attributes" = EXCLUDED."attributes";

END;
$$ LANGUAGE plpgsql;
