# Receipt Quantities Start at Zero

Last tested: 2026-10-18 (after main's #1937 service-function refactor)
Routes: /x/settings/inventory, /x/purchase-order/<id>/details → Receive, /x/receipt/<id>/details

## Prerequisites
- A seeded dev company (`crbn up` seeds the satellite dataset): POs in "To Receive" /
  "To Receive and Invoice" (PO000010 single line, PO000018 two lines incl. a batch item),
  warehouse transfer WT000002 in "To Ship", RMA000002 in "To Receive", draft PO000003.
- Fixed-asset receipt: add an Asset-tab line to a draft PO (fixed asset FA000003 exists).

## Steps
### 1. Toggle the setting
- `/x/settings/inventory` → section "Receiving" → card "Start Receipt Quantities at Zero"
  → click the switch (the only `switch` in the snapshot). Saves on change, no Save button.
- Verify: toast "Receipt quantities now start at zero"; reload keeps the switch checked;
  `companySettings."receiptQuantitiesStartAtZero"` = true.

### 2. Receive a PO
- PO details → button "Receive" (first receipt) or "Receipts" dropdown → menuitem
  "New Receipt" (later receipts). Redirects to `/x/receipt/<id>/details`.
- Verify: every line's Received textbox reads 0, Ordered/Outstanding unchanged, Post disabled.
  Hovering Post shows "Enter a received quantity, or tick a unit, on at least one line."
  (`agent-browser hover @<Post ref>`); entering a quantity enables Post and drops the tooltip.

### 3. Enter a quantity, post
- `fill` the line's Received textbox, then click another textbox to blur (commits via
  `lines.update`). Batch lines also need "Batch number" filled + blurred.
- Post → modal "Post Receipt" button. Seeded storage rules can raise a "Rule Violation"
  modal first — click "Acknowledge & continue".
- Verify (DB): `itemLedger` has rows only for non-zero lines; PO lines left at 0 keep
  `receivedComplete = false`; a re-receive starts the remaining lines at 0 with
  Outstanding = remainder.

### 4. Other sources
- Transfer: WT000002 → "Ship" → post shipment (shipment lines are NOT zeroed — out of
  scope) → back on the transfer "Receive" → line at 0.
- RMA: `/x/sales-return-order/<id>` → "Receive" → line at 0.
- Fixed asset: the asset checkbox under "Fixed Assets" starts unticked.

## Selector Notes
- If another agent shares the machine, run every command with `agent-browser --session <name>`;
  on the default session two agents' commands interleave and hang.
- The PO/RMA "Receive" button reopens an existing Draft receipt for that source. To test a
  fresh receipt, delete the Draft first (receipt ⋯ → Delete Receipt → Delete).
- Receipt line quantity inputs are unlabeled textboxes in line order; the first
  textbox on the page is External Reference — handy blur target.
- PO line modal: requestSubmit the Save inside `[role=dialog]`, not the first Save on the
  page (that is the PO header form behind the modal).
- The Fixed Asset combobox popover stays open after picking — press Escape before filling
  the price.

## Common Failures
- Fixed Asset PO line silently not saved: Description is required, and the submit hit
  the background form.
