---
paths: ["apps/erp/app/modules/inventory/ui/Receipts/ReceiptLines.tsx"]
triggers: ["setReceiptLineSerial", "saveReceiptSerialBox", "planReceiptSerialRelease", "receiptLineSplit"]
promoted: null
---
# What a document posts must be what its form shows

**Context:** Receipt serial entry (2026-10-16). Each serial box saved on blur, keyed on the serial number.

**Problem:** A box emptied, refused (a duplicate) or pushed out of range by a lower received quantity kept its saved serial. The post check reads what is saved, so the receipt posted a serial the user could no longer see.

**Rule:** Key a per-field save on the field's position (here the box: receipt line + index), not on its value. An empty value, a refused value and a removed field each clear what is saved for it. And a removal never deletes a record with stock history: a sales return re-tags real shipped units, so those only lose their receipt link (`planReceiptSerialRelease`).

**Applies to:** `setReceiptLineSerial` / `saveReceiptSerialBox`, `updateReceiptLines`, `ReceiptLines` `SerialForm`, the receipt line split (`receiptLineSplit` in `shared.service.ts`), and any autosaved list of tracked values (shipment serials, batch numbers).
