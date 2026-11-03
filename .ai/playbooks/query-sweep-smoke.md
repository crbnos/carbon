# Query sweep smoke (lists, CSV, Get Method, postings)

Last tested: 2026-11-03
Routes: /x/sales/customers · /x/purchasing/suppliers · /x/sales/contracts · /x/sales/quotes · /x/invoicing/sales · /x/invoicing/purchasing · /x/quality/issues · /x/job/{id} · /x/receipt/{id} · /x/shipment/{id} · /x/inventory-count/{id}

## Prerequisites
- The satellite demo dataset. A Draft job (J000004, EPS-001), a Draft receipt with a batch line (RE000002), a Draft shipment (SHP000001), a Draft count (IC000001).
- Drive it with `agent-browser`; the built-in browser pane blocks `*.dev` hosts.

## Steps
### 1. Lists
- Open each route, wait ~5 s, then count `tbody tr` and check the page has no "Something went wrong".
- Search: `?search=Nova` on customers, `?search=J0000` on jobs.

### 2. Customers CSV
- Hook the blob before clicking: override `URL.createObjectURL` to read `blob.text()` into `window.__csv`, and stub `HTMLAnchorElement.prototype.click` so nothing is saved.
- Click "Download CSV", then read `window.__csv`.

### 3. Get Method on a job
- Job page → "Get Method" → "Source Method" combobox: type the job's part, pick the option → `requestSubmit` the form whose button reads "Confirm".
- Verify (DB): `jobOperation` rows have a new `createdAt`, `jo_` ids, same counts.

### 4. Receipt
- Fill the line's Received textbox, blur; a batch line also needs "Batch number" filled and blurred.
- "Post" → "Post Receipt" → seeded storage rules show "Rule Violation": "Acknowledge & continue".
- Verify (DB): status Posted, `itemLedger` Positive Adjmt. with a tracked entity, one `costLedger` row, PO line `quantityReceived`.

### 5. Shipment
- Fill the line's shipped textbox, blur → "Post" → "Post Shipment".
- Verify (DB): status Posted, sales order line `quantitySent`.

### 6. Inventory count
- The counted cells are not plain inputs; the run set `countedQuantity` in the DB (as the database tests do).
- "Confirm" → "Confirm Count" → "Post".
- Verify (DB): status Posted, a Positive/Negative Adjmt. per counted Inventory line, `postedItemLedgerId` on each.

## Selector Notes
- Buttons by label: "Get Method", "Post", "Post Receipt", "Post Shipment", "Confirm", "Confirm Count", "Acknowledge & continue".

## Common Failures
- A Make to Order shipment line on a serial item that the line does not flag writes no item ledger row (only the cost layer). That is the existing rule, not a failure.
- Customers CSV "Type" holds the customer type id: the column has no export value (also on main).
