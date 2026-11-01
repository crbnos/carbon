# PO line dates (requested / promised / delivery per line)

Last tested: 2026-10-27
Routes: /x/purchase-order/<id>/details (summary + Shipping card),
/x/purchase-order/<id>/<lineId>/details (line form)

## Prerequisites
- A dev company with a Draft PO and a To Receive PO, each with a line and no
  header or line dates. Find them with
  `select po.id, po."purchaseOrderId", po.status from "purchaseOrder" po` scoped
  to your company; PO numbers differ between databases.
- `SUPABASE_DB_URL` in `.env.local` for psql checks.

## Steps
### 1. Header dates reach the lines
On a Draft PO's details page, in the Shipping card, click the "day" spinbutton of
Requested Date and type `DDMMYYYY` with `agent-browser keyboard type`, same for
Promised Date, then requestSubmit the card's form (find it via
`input[name=receiptPromisedDate]`). Lines with an empty date (or the old order
date) take the new ones; a line with its own date keeps it. Saving the card
again without changing a date moves no line, so a line left empty stays empty.
A Delivery Date reaches only lines that have received something.

### 2. Summary pill
Each non-indirect line shows "Promised" plus a pill under the price badges:
calendar icon only when the line has no date, the date when it has one. Click
`button[aria-label="Promised Date"]` (nth for nth line), pick a gridcell button by
full label (`button "Friday, 20 November 2026"`); it saves on pick. Clear empties
it and it stays empty after reload (no fallback to the order's date).

### 3. Line form
Sections: Details, Receiving, Dates, Tax & Shipping. Dates fields save outside the
form's Save: a typed date saves on blur (Tab away), a calendar pick saves when the
popover closes (Escape). Nothing is saved mid-typing. The form's Save leaves the
line's dates alone.

### 4. New line
"Add Line Item" opens a modal; its Dates section starts on the order's Requested
and Promised dates, and picking an item keeps them. Saved line carries them.

### 5. Released order (To Receive)
Line form: Requested Date disabled, Promised and Delivery enabled. Server refusal:
`fetch('/x/purchase-order/<id>/<lineId>/date', {method:'POST', body})` with
`field=requiredDate` answers `Cannot change the requested date of a confirmed
purchase order.` The pill on a To Invoice order is disabled.

## Selector Notes
- Line Dates spinbuttons are named `day, Requested Date` / `day, Promised Date`.
- Calendar toggles: `button "Toggle Promised Date"`; the popover's Clear is the
  last `button "Clear"` in the snapshot.
- Quantity in the line form is the textbox `Quantity Optional`.
- Opening `/x/purchase-order/<id>/new` directly renders blank; use Add Line Item.

## Cleanup
Restore with SQL: header `receiptRequestedDate`/`receiptPromisedDate` null, line
`requiredDate`/`promisedDate` null, delete any added line. Changing quantity can
re-price the line from supplier price breaks; restore `supplierUnitPrice` too.

## Common Failures
- macOS may intermittently refuse the shell access to ~/Documents
  ("Operation not permitted"); run agent-browser / psql from /private/tmp and
  retry file access.
