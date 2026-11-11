# Certificate of Conformance (AS9163) — receipt certificates, compliance statements, issue / reissue / auto-issue

Last tested: 2026-11-11
Routes: /x/receipt/{id}/details, /x/quality/compliance-statements, /x/customer/{id}/shipping,
/x/sales-order/new, /x/sales-invoice/new, /x/shipment/{id}/details, /x/templates/certificateOfConformance

## Prerequisites
- A seeded demo company (satellite dataset): posted shipments, receipts with supplier certificates.
- A batch lot that came in on a receipt line carrying a certificate and is still Available
  (its `trackedEntity.attributes` has `Receipt Line`), so lineage reaches a certificate.
- A customer with a customer location: a seeded sales rule ("ITAR … US ship-to only") refuses a
  sales order or sales invoice line ("Customer country is required") until the document has one
  (sales order: Customer Location; sales invoice: Shipping → Ship To).
- Email integration off locally: Send is disabled and auto-issue says "not emailed".

## Environment notes (read first)
- Use an isolated session (`agent-browser --session <name> …`); other agents share the browser.
- The headless tab reports `document.hidden = true`, so CSS animations never advance:
  - A drawer that closes without leaving its route leaves its portal wrapper (`div.fixed.inset-0`)
    over the page, and every later click is "covered". Reload the page after closing a drawer.
    This is the environment, not the app (route drawers close by navigation and are unaffected).
  - A drawer that just opened is frozen at the start of its slide-in, so a coordinate click on a
    field inside it can land on the backdrop and close the drawer. Drive drawer fields with DOM
    calls: `fill` works; toggle a switch with `element.click()` in `eval`; submit with
    `requestSubmit` on the drawer's own form (`form[action*=…]` — the page often has a second form).
- Fetch PDFs with the session cookies (`agent-browser cookies` → `curl -H "Cookie: …"`), read them
  with PDFKit (a 10-line swift script; pdftotext is not installed).

## Steps
### 1. Receipt line certificate
- /x/receipt/{id}/details → line "Line options for <part>" → menuitem "Certificates".
- Drawer: upload with `agent-browser upload '[role=dialog] input[type=file]' <file>`; Type
  (Material default), Certificate Number, Specification → requestSubmit "Add Certificate" →
  toast "Certificate added", row listed. Empty drawer shows one heading "No certificates on this
  line yet". Reopening reloads the rows.
- Regenerate (Draft receipt): change Location or Source Document ID → requestSubmit the header form.
  A certificate whose PO line is still on the new source keeps its id on the rebuilt line; one whose
  line is gone is deleted and the toast says "Updated receipt. Certificate X was removed: the new
  source has no line it belongs to. Its file is still on the receipt."

### 2. Compliance statements
- /x/quality/compliance-statements → link "Add Compliance Statement" (drawer /new): Name, Content,
  switch "Applies to all customers", Customers, Items, switch Active → requestSubmit the
  `form[action*=compliance-statements]` → toast "Compliance statement created".
- Verify on any shipment preview: field 13 "Compliance Statements" lists "<Name>: <Content>".

### 3. Customer requirement
- /x/customer/{id}/shipping → switch "Requires Certificate of Conformance" → requestSubmit "Save" →
  "Updated customer shipping". A blank Shipping Contact is a valid edge: auto-issue says
  "(not emailed: the customer has no shipping contact)".

### 4. Sales order → shipment → post (auto-issue)
- /x/sales-order/new: Customer, Customer PO Number (prints as field 6), Customer Location → Save.
- "Add Line Item": item (focus the combobox, Enter, type the part), Method "Pull from Inventory" →
  requestSubmit the form holding `input[name=itemId]`. Confirm (dialog → requestSubmit Confirm) →
  Ship → new Draft shipment.
- Shipment line: "Show available batch numbers" → pick the lot.
- Certificate ▾ on Draft: Preview enabled, Issue… disabled. Preview field 11 prints the quantity
  this line ships from the lot, not the lot's stock.
- Post → dialog "Post Shipment" → requestSubmit → toast "Certificate of Conformance COC… issued (…)".

### 5. Sales invoice at two locations (auto-issue per shipment)
- /x/sales-invoice/new: Customer → Save. Shipping → Ship To (needed by the ITAR rule) → its form.
- Two lines of one untracked part, Shipping Location "Manufacturing Plant" and "Headquarters".
- Post → "Post and Ship Invoice" → one shipment per location, one certificate each, both outcomes in
  one toast. Field 5 prints the invoice's Ship To address.

### 6. Issue / reissue / download (posted shipment)
- Certificate ▾ → Issue… → requestSubmit "Issue" → "COC… issued". Double submit and 3 parallel POSTs
  to /x/shipment/{id}/certificate mint ONE number; the rest answer "A reason is required to reissue".
- Reissue… with an empty reason → toast "A reason is required to reissue", dialog stays open; with a
  reason → `COC…-1`; its PDF prints the reason in field 13.
- Download /file/shipment/{id}/certificate/{revision}.pdf is the stored file: hide a block in
  /x/templates/certificateOfConformance and Save, and the stored bytes stay identical while the
  preview changes. Restore the block (section "Not on the page" → "Show block" → Save).
- Send… is disabled without the email integration; a direct POST to
  /x/shipment/{id}/certificate/{certificateId}/send answers "The email integration is not active".
- Without a session, both PDF routes redirect to /login. No share+ route serves certificates.

## Common Failures
- "Customer country is required" rule violation → the document has no customer location / Ship To.
- A sales order created with a scripted flow can stop at the line form; continue by hand.
- New API Key form (Settings → API Keys) did not save in this environment; the API post of a
  shipment runs the same `postShipment` service function the UI does.
