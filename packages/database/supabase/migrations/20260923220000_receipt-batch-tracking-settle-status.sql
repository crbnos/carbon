-- A receipt-line batch write must settle the lot's STATUS with its quantity.
--
-- `update_receipt_line_batch_tracking` upserted the entity with
-- `ON CONFLICT ... DO UPDATE SET "quantity" = EXCLUDED."quantity"` and never
-- touched `status`. Editing a batch line's quantity down to 0 on a receipt
-- whose lot had already gone Available therefore left `quantity = 0` with
-- `status = 'Available'` — exactly the zero-quantity husk the tracked-entity
-- drain rule exists to prevent (shared/entity-drain.ts `settleQuantity`).
--
-- Reproduced against a live lot: 10/Available -> 0/Available after one call
-- with p_quantity = 0. The TypeScript writers were all fixed to drain through
-- settleQuantity; this one is SQL, so neither that helper nor the
-- `no-unrounded-tracked-quantity` conformance check (TypeScript only) covered it.
--
-- The serial twin (`update_receipt_line_serial_tracking`) is unaffected: it
-- always inserts quantity 1 and its UPDATE branch never writes quantity.

CREATE OR REPLACE FUNCTION public.update_receipt_line_batch_tracking(p_receipt_line_id text, p_receipt_id text, p_batch_number text, p_quantity numeric, p_tracked_entity_id text DEFAULT NULL::text, p_properties jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_tracked_entity_id  TEXT;
  v_item_id            TEXT;
  v_item_readable_id   TEXT;
  v_company_id         TEXT;
  v_created_by         TEXT;
  v_supplier_id        TEXT;
  v_attributes         JSONB;
  v_resolved_expiry    DATE;
  v_expiration_date    DATE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_receipt_line_id));

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

  IF p_tracked_entity_id IS NOT NULL THEN
    v_tracked_entity_id := p_tracked_entity_id;
  ELSE
    SELECT id INTO v_tracked_entity_id
    FROM "trackedEntity"
    WHERE attributes->>'Receipt Line' = p_receipt_line_id
      AND "companyId" = v_company_id
    LIMIT 1;

    IF v_tracked_entity_id IS NULL THEN
      v_tracked_entity_id := nanoid();
    END IF;
  END IF;

  v_attributes := jsonb_build_object(
    'Receipt Line', p_receipt_line_id,
    'Receipt', p_receipt_id
  );

  IF v_supplier_id IS NOT NULL THEN
    v_attributes := v_attributes || jsonb_build_object('Supplier', v_supplier_id);
  END IF;

  IF (p_properties ? 'expirationDate') THEN
    BEGIN
      v_expiration_date := (p_properties->>'expirationDate')::DATE;
    EXCEPTION WHEN OTHERS THEN
      v_expiration_date := NULL;
    END;
    v_attributes := v_attributes || (p_properties - 'expirationDate');
  ELSE
    v_attributes := v_attributes || p_properties;
  END IF;

  IF v_expiration_date IS NULL THEN
    v_resolved_expiry := resolve_shelf_life_start_for_receipt(v_item_id, p_receipt_id);
    IF v_resolved_expiry IS NOT NULL THEN
      v_expiration_date := v_resolved_expiry;
    END IF;
  END IF;

  INSERT INTO "trackedEntity" (
    "id",
    "quantity",
    "status",
    "sourceDocument",
    "sourceDocumentId",
    "sourceDocumentReadableId",
    "readableId",
    "attributes",
    "companyId",
    "createdBy",
    "itemId",
    "expirationDate"
  )
  VALUES (
    v_tracked_entity_id,
    p_quantity,
    -- A receipt lot with nothing in it is not a live lot. Same drain rule as
    -- shared/entity-drain.ts: no quantity ⇒ not Available/On Hold.
    CASE WHEN p_quantity > 0 THEN 'On Hold' ELSE 'Consumed' END::"trackedEntityStatus",
    'Item',
    v_item_id,
    v_item_readable_id,
    p_batch_number,
    v_attributes,
    v_company_id,
    v_created_by,
    v_item_id,
    v_expiration_date
  )
  ON CONFLICT (id) DO UPDATE SET
    "quantity" = EXCLUDED."quantity",
    -- Settle the status with the quantity. Without this, editing a batch line
    -- down to 0 overwrote the quantity and left the lot Available — a
    -- zero-quantity husk on every on-hand list. Scrapped/Rejected are
    -- preserved (quality markers, already off on-hand), and re-entering a
    -- quantity revives the lot to On Hold rather than stranding it Consumed
    -- with stock on it; posting the receipt is what makes it Available.
    "status" = CASE
      WHEN EXCLUDED."quantity" <= 0
           AND "trackedEntity"."status" NOT IN ('Scrapped', 'Rejected')
        THEN 'Consumed'
      WHEN EXCLUDED."quantity" > 0
           AND "trackedEntity"."status" = 'Consumed'
        THEN 'On Hold'
      ELSE "trackedEntity"."status"
    END::"trackedEntityStatus",
    "readableId" = EXCLUDED."readableId",
    "attributes" = EXCLUDED."attributes",
    "itemId" = EXCLUDED."itemId",
    "expirationDate" = COALESCE(EXCLUDED."expirationDate", "trackedEntity"."expirationDate");
END;
$function$
