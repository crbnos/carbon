# Prototype CLIN (part CLIN → Build → Deliver)

Last tested: 2026-10-23
Routes: /x/contract/:id/setup/products, /x/contract/:id/:lineId/details,
/x/project/:projectId/element/:elementId, /x/shipment/:id/details,
/file/shipment/:id.pdf

## Prerequisites
- A Draft project contract (`billingBasis` Project) on a Contract project (demo: OB2).
- A Part item (demo: ADCS-001) and a chargeable task on the project (demo: OB2-6).
- Set the contract to Draft Only invoicing after Confirm, or the nightly run may email
  a real invoice once a delivery brings a billing event due.

## Steps
### 1. Add the part line
Setup Lines step → "Add Line" (covered by a sticky div: click it with `el.click()` in eval).
Billing Method combobox → "Fixed Price". Item combobox → type "ADCS" → option. Quantity and
Unit Price textboxes (fill + blur). requestSubmit the dialog's form.
### 2. Confirm
Review step → "Confirm" button → requestSubmit the dialog's form ("Confirm MOD+ENTER").
### 3. Build
Line page → header "Build" → modal: Task combobox (type the readable id), Quantity textbox,
Location. requestSubmit the dialog's form → redirects to /x/job/:id/details.
### 4. Task
Element page → "Estimated" tab: the plan line card links the job; "Actual" tab: one job card.
Plan tree: `?layout=tree`, badge "J000NN · c of q".
### 5. Deliver
Needs a completed unit (job.quantityComplete). Line page header "Deliver" (a form; requestSubmit)
→ shipment. Serial Number textbox (blur saves). Header "Post" → dialog "Post Shipment" with
"Delivered on" → requestSubmit its form.
### 6. PDF
Open /file/shipment/:id.pdf → "Receiving Report".

### 7. New Job on a task
Element page header → "New Job" → modal: Part combobox (click, type, pick option), Quantity,
Due Date (defaults to the task's target date), Location. requestSubmit the dialog's form →
/x/job/:id/details. The Estimated tab shows the plan line linked to the job.
### 8. Amend with a part
Contract page → "Amend" → "Add Lines" → combobox (type, pick), Escape, click "Add". The row
is One-time, Qty 1. requestSubmit the dialog's form shows the preview step.

## Selector Notes
- The serial textbox is the last textbox on the line row.
- Read form values with `new FormData(dialog.querySelector('form'))` to check hidden inputs.
