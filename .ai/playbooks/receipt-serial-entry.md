# Receipt Serial Entry (clear / edit / post refusal)

Last tested: 2026-10-16
Route: /x/receipt/<id>/details

## Prerequisites
- A Serial-tracked part. Create at /x/part/new: Part ID + Name, "Tracking Type"
  combobox (second combobox after Replenishment) → "Serial", requestSubmit Save.
- A finalized PO for that part (see create-purchase-order.md). Then on the PO,
  click "Receive" → lands on the receipt with one "Serial N" textbox per unit.
- Satellite seed data has storage/sales rules that raise a "Rule Violation"
  dialog on post — click "Acknowledge & continue". When POSTing the post route
  directly, send `acknowledged=true` or the rule warnings stop it first.

## Steps
### 1. Clear a saved serial (the original bug)
- Click "Serial 1", type `123`, click the "Receipt Lines" heading (blur saves).
- Click back in, press End, Backspace until empty (Ctrl+A does NOT select on
  macOS), click the heading again.
- Verify DB: no trackedEntity left at `Receipt Line Index` 0.
### 2. Edit a serial
- Change a saved value and blur → the same trackedEntity id is renamed (one row).
### 3. Post with a box empty
- Click "Post" → dialog shows "Missing Information … Serial numbers are missing",
  Post Receipt disabled.
### 4. Server refusal (stale dialog)
- Fill all boxes, open the Post dialog, then clear one box out of band
  (fetch POST /x/receipt/lines/tracking with serialNumber=''), click Post Receipt,
  acknowledge rules → toast "Serial numbers are missing", receipt stays Draft.
### 5. Quantity change
- Received 3 → 2 → 3: box 3 comes back empty AND its saved serial is gone.
### 6. Happy path
- Fill all boxes, Post → receipt Posted, entities Available, inputs disabled.

## Selector Notes
- Serial inputs: `input[placeholder="Serial N"]`. Received quantity: the
  textbox just under the "Receipt Lines" heading.
- Read-only DB check:
  `select "readableId", status, attributes->>'Receipt Line Index' from "trackedEntity" where attributes->>'Receipt' = '<receipt id>'`

### 7. Refused values empty the box
- A duplicate within the form, a serial on another receipt's box, a job's
  reserved serial, or the serial of an existing unit with stock history (e.g.
  one shipped to a customer: "already belongs to an existing unit") shows an
  error AND leaves nothing saved for the box; the Post dialog then blocks.
### 8. Enter
- Enter moves focus to the next box (one save via blur); on the last box it blurs.
### 9. Line split and sales returns
- Split a serial PO line: its unposted serials are deleted, boxes show empty.
- Split / lower the quantity on a sales-return line with picked units: the units
  are kept (stock history) and only lose their receipt link.

## Browser session
- Other agents may drive the shared default agent-browser session. Use
  `export AGENT_BROWSER_SESSION=<name>` in every command (and log in again in it).

## Common Failures
- A flash from a redirect is never shown after the post dialog submits (fetcher
  redirect to the same page does not reload root) — the post route returns
  `{ error: { message } }` instead.
- Sales returns: RMA "Add Line Item" → "Add from shipment"; the customer needs a
  US Customer Location on the SO header or the ITAR rule blocks the SO line.
