# Rental Shipments and Receipts

Last tested: 2026-10-08
Routes: /x/rental-agreement/:id/details, /x/rental-agreement/:id/:lineId/details,
/x/shipment/:id/details, /x/receipt/:id/details, /x/inventory/shipments,
/x/accounting/fleet, /file/shipment/:id.pdf, /x/fixed-asset/:id/sell

## Prerequisites
- Fleet units: serial part SAT-1000 → Part → Inventory → "Update Inventory"
  (fill `[role=dialog] input[name=readableId]`, requestSubmit the dialog form),
  then `/x/fixed-asset/capitalize?itemId=…&trackedEntityId=…&locationId=…`
  → requestSubmit the form whose button contains "Capitalize".
- Agreement: see `rental-agreement-setup-wizard.md`. Backdate the start date
  (month spinbutton → `keyboard type "09282026"` → Tab) so a backdated
  Delivered on is inside the term.
- Isolated session (`AGENT_BROWSER_SESSION=<name>`), viewport 1440x1000.
- Other sessions may test RA000001 concurrently — create your own agreements.

## Steps
1. Agreement header "Deliver" → Draft rental shipment, all Pending units ticked.
   After the first shipment the button is a "Shipments" dropdown: "New
   Shipment" opens the existing Draft instead of creating one.
2. Unit rows: tick = `button[role=checkbox]` inside the row whose text has the
   serial (rows can reorder after a save — locate by serial, not index). Meter =
   input labelled "Meter"; fill + Tab saves.
3. Post → modal "Delivered on" date group (month spinbutton, type MMDDYYYY,
   Tab) → click "Post Shipment" (a plain click works here).
4. Header "Return" (later a "Receipts" dropdown → "New Receipt") → Draft
   receipt: On Rent ticked, Pending unticked. Location combobox → option,
   requestSubmit the Save form. "Take out of service" switch reveals "Reason".
   Post → "Returned on" → "Post Receipt".
5. Unit page "Return" → one-unit Draft receipt → Post → Post Receipt.
6. Void: shipment ⋮ (More options) → "Void" → "Void Shipment".
7. Release: unit page "Release unit" → date group → requestSubmit the dialog
   form ("Release unit"). Reload before reading the Billing Periods card.
8. PDF: fetch `/file/shipment/<id>.pdf` in the page, save, `qlmanage -t` to PNG.
9. Regression: `/x/fixed-asset/<id>/sell` → customer → "Create Sales Order" →
   Confirm → Confirm → Ship → Post → Post Shipment.

## Common Failures
- `agent-browser open` sometimes lands on a hydration failure with an empty
  body and dead header buttons — reload once.
- Posting a Draft shipment that still ticks a Returned unit fails with only
  "Failed to post shipment".
