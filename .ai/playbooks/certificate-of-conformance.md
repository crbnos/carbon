# Certificate of Conformance (AS9163) — receipt certificates, compliance statements, auto-issue on shipment post

Last tested: 2026-09-26
Routes: /x/receipt/{id}/details, /x/quality/compliance-statements, /x/customer/{id}/shipping, /x/sales-order/new, /x/shipment/{id}/details

## Prerequisites
- A POSTED receipt with a batch-tracked line whose lot is still Available (satellite seed: RE000003 line
  BAT-LIION-48V → lot LOT-BAT-2610; its trackedEntity attributes carry `Receipt Line`).
- A customer with a customer contact that has an email (satellite seed: ORBSEC Defense / Marcus Reyes).
- A customer location with a country — the seeded sales rule "ITAR spacecraft — US ship-to only" blocks
  adding a sales-order line ("Customer country is required") until the SO has a Customer Location.

## Login note
If `/login` with DEV_BYPASS_EMAIL fails with "Bot verification failed" (apps/erp/.env carries a real
Turnstile secret with the always-pass test site key), sign in through Supabase instead:
`POST $SUPABASE_URL/auth/v1/admin/generate_link {"type":"magiclink","email":"test@carbon.ms","redirect_to":"$ERP_URL/callback"}`
with the service-role key, rewrite the returned `action_link` path `/verify` → `/auth/v1/verify`, open it
in the browser, wait ~10 s on `/callback`, then open `/x`. Use an isolated `agent-browser --session <name>`
— the default session can be closed by other agents mid-run.

## Steps
### 1. Receipt line certificate
- Open /x/receipt/{receiptId}/details → the line's "Line options" (⋮) button → menuitem "Certificates".
- Drawer "Certificates": upload via the drawer's own `Choose File` button ref (there are TWO file inputs on
  the page — `input[type=file]` hits the receipt line's normal file upload first).
- Type select defaults to Material (hidden input `type=Material`); fill Certificate Number, Specification,
  Notes; Supplier is prefilled from the receipt.
- requestSubmit the form whose submit button reads "Add Certificate" → toast "Certificate added", row listed.

### 2. Compliance statements
- /x/quality/compliance-statements → "Add Compliance Statement" (drawer /new). Two textboxes (Name, Content),
  switch "Applies to all customers", Customers multi-select, Items multi-select, switch Active.
- requestSubmit the drawer form ("Save") → toast "Compliance statement created".
- Direct `open` of the list URL occasionally showed a chrome "site can't be reached" page; navigating from
  /x/quality via the sidebar link worked.

### 3. Customer requirement
- /x/customer/{id}/shipping → Shipping Contact combobox (third) → pick the contact; switch
  "Requires Certificate of Conformance" → requestSubmit "Save".

### 4. Sales order → shipment → post
- /x/sales-order/new: Customer combobox, Customer Reference textbox (prints as field 6 PO number) →
  Save. On the SO, Properties → Customer Location "+" → pick the location.
- "Add Line Item" → item combobox (type the part number) → Method "Pull from Inventory" → requestSubmit
  the form containing `input[name=itemId]`.
- Confirm → dialog "Confirm SO…" → requestSubmit its Confirm. Then "Ship" → redirects to the new shipment.
- On the shipment line: "Show available batch numbers" → pick the lot.
- Certificate menu on a Draft shipment: Preview enabled, "Issue…" disabled.
- Post → dialog "Post Shipment" → requestSubmit → toast
  "Certificate of Conformance COC000001 issued and emailed to <contact email>".

### 5. Verify
- Certificate ▾ → Preview, Reissue…, Issued list with `COC… Signed <date> · Sent <date>` → submenu
  Download / Send….
- Download URL: /file/shipment/{shipmentId}/certificate/{revision}.pdf (stored PDF);
  Preview URL: /file/shipment/{shipmentId}/certificate.pdf (PREVIEW watermark + "PREVIEW — NOT ISSUED").
- Fetch PDFs in-page (`fetch(url)` → base64) and extract text with PDFKit (swift) — pdftotext is not installed.
- Reissue… → "Reason for Update" textarea → requestSubmit "Reissue" → `COC000001-1` appears; its PDF prints
  the reason in field 13; revision 0's bytes are unchanged.
- DB: `certificateOfConformance` rows (revision, reasonForUpdate, documentId, lastSentAt/To).

## Selector Notes
- CofC menu: button "Certificate" in the shipment header; `find role button --name Certificate` was flaky,
  use the snapshot ref.
- Send… is disabled unless the company has the `email` integration (`integrations.has("email")`), and the
  issue/reissue dialog then shows no "Email to customer" option.

## Common Failures
- Certificate Type options and the Type column render EMPTY (bug — `getCertificateTypeLabel` in
  `modules/quality/ui/Certificates/CertificateForm.tsx`). The value still posts as Material.
- Email: auto-issue sends via `carbon/send-email` even with no email integration; in this dev stack the
  transport is Resend (RESEND_API_KEY in apps/erp/.env / packages/jobs/.env), NOT Inbucket, so the Mail UI
  stays empty. Verify via the Inngest dev API: `GET http://localhost:<INNGEST port>/v1/events?name=carbon/send-email`.
  Do not send more mail to seeded customer addresses.
