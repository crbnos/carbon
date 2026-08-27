# Receipt Serial Tracking Properties

Last tested: 2026-08-26
Route: /x/receipt/{receiptId}/details

Verifies per-serial custom tracking properties on receipts (and the shared
"Tracking Properties" rework across batch/serial/shipment).

## Prerequisites
- A receipt with a **Serial**-tracked line (`receiptLine.requiresSerialTracking = true`,
  `receivedQuantity >= 2`).
- The line's item has ≥1 `batchProperty` definition row (label + `dataType`).
- If none exist, seed via psql (local dev), e.g. for item RW-010:
  ```sql
  INSERT INTO "batchProperty" (id,"itemId",label,"dataType","sortOrder","companyId","createdBy")
  VALUES ('bpX','<itemId>','Heat Number','text',1,'<companyId>','<userId>'),
         ('bpY','<itemId>','Hardness','numeric',2,'<companyId>','<userId>');
  ```
  A serial `receiptLine` can be seeded directly (required cols: receiptId, itemId,
  orderQuantity, unitOfMeasure, unitPrice, companyId, createdBy; set
  requiresSerialTracking=true, receivedQuantity=N).

## Steps
### 1. Navigate — /x/receipt/{receiptId}/details
   Expect a "Tracking Properties" card per serial line, with a Print + "Edit Properties"
   button, then one bordered group **per received unit**: "Serial {n}" input + a
   "Properties" collapsible (expanded when ≤5 units) containing the item's property
   fields (and a per-serial "Expiration Date" when the item's shelf-life mode is
   "Set on Receipt").
### 2. Fill a serial — set the **serial number first** (persistence needs a non-empty
   number), blur it (`input[data-serial-index="{n}"]`), then fill its property fields.
   - Text property: `fill` then blur (click the serial input) — commits on blur.
   - Numeric property: `fill` then blur.
### 3. Verify persistence — no submit button; each field persists on blur via a fetch to
   `path.to.receiptLinesTracking`. Confirm in DB:
   ```sql
   SELECT attributes->>'Receipt Line Index' idx, "readableId",
          attributes->>'<bpId>' FROM "trackedEntity"
   WHERE attributes->>'Receipt Line'='<receiptLineId>' ORDER BY 1;
   ```
   Property values are stored on each serial's own entity under `attributes[batchProperty.id]`.
### 4. Reload — each serial re-seeds its own number + property values independently.

## Selector Notes
- Serial number inputs carry `data-serial-index="{0-based index}"` — use it to blur/focus.
- Property field labels appear duplicated in the a11y tree ("Heat Number Heat Number").
- The "Tracking Properties" heading renders via `<Heading size="h4">` (NOT a literal `<h4>`);
  match by text, not tag.

## Common Failures
- Property value not persisting → the serial NUMBER was empty (persist is gated on a
  non-empty number). Set/blur the number first.
- Numeric fields: value only commits on blur (react-aria) — click another field after fill.
- "Edit Properties" modal does not open under agent-browser synthetic click — this is an
  agent-browser limitation with Carbon's portal modals; it affects the (unchanged) batch
  button identically. The button + handler are present; verify by parity, not by driving it.

## Shipment (read-only) counterpart
- /x/shipment/{shipmentId}/details renders the same "Tracking Properties" card, read-only,
  for each picked batch/serial entity (values inherited from the receipt-time entity).
  Requires an Available entity assigned to a shipment line (posted receipt → SO → shipment
  → pick), so it needs a heavier fixture than the receipt path.
