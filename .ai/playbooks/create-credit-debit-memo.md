# Create a Credit / Debit Memo (Credits & Debits)

Last tested: 2026-06-25
Route: `/x/credits/new` (list at `/x/invoicing/credits`, detail at `/x/credits/:id`)

## Prerequisites
- At least one customer (for a credit/debit to a customer) or supplier (for a
  credit/debit to a supplier). The seed DB has none — create one first.
- A GL account to use as the "Reason Account" (any class; e.g. `4010 Sales`).
- To test posting with a GL journal, the company must have `accountingEnabled = true`
  and account defaults configured. The seed "Carbon Development" company has
  accounting DISABLED, so posting succeeds but writes no journal (journalId stays NULL).

## Steps

### 1. Navigate
- URL: `/x/credits/new`
- Expected: "New Credit / Debit Memo" form with fields: Memo ID (Next Sequence),
  Direction (Credit/Debit), Party Type toggle (Customer/Supplier), Customer or
  Supplier selector, Memo Date, Currency, Exchange Rate, Amount, Reason Account,
  Reference, Notes.

### 2. Fill form
- Direction (first combobox): "Credit" or "Debit"
- Party Type (radio toggle): "Customer" or "Supplier" — switches which selector shows
- Customer / Supplier (combobox): pick the party
- Amount: a positive number
- Reason Account (combobox, no class filter — type to search e.g. "Sales"): pick one
- Memo Date / Currency / Exchange Rate default to today / base / 1

### 3. Submit
- Button: "Save"
- The memoId is generated server-side: Credit → `CR-yyyy-mm-NNNNNN`,
  Debit → `DR-yyyy-mm-NNNNNN`.

### 4. Verify
- Redirect to `/x/credits/:id`
- Detail shows the memo header, the form, the "Memo Applications" panel, and (Draft
  only) an "Apply to invoices" table of the party's open invoices.

### 5. Apply + Post
- Apply table lists the party's OPEN invoices (customer → open sales invoices,
  supplier → open purchase invoices). Enter amounts, "Save applications".
- "Post" button → posts via the `post-memo` edge function; status → Posted.
  Applying is GL-neutral; posting books DR/CR control (AR/AP) vs the reason account.

## Selector Notes
- Direction and Party Type are INDEPENDENT controls (all four combos are valid).
  The Party Type toggle is UI-only (not a form field) — it only switches which of
  customerId/supplierId is submitted.
- The Reason Account combobox is unfiltered (any GL account); type to search.

## Common Failures / Harness Notes
- "Reason account is required" / "Amount must be > 0" — a required field is empty.
- **Amount must be blurred to commit.** The Amount field is react-aria: `fill @ref "300"`
  then click another field to blur, so the hidden `input[name=amount]` commits. Verify
  with `eval "document.querySelector('input[name=amount]').value"` → "300".
- **Submit via `requestSubmit`, not a click.** A plain agent-browser click on "Save"
  does NOT fire the native submit `ValidatedForm` needs (it bails on a missing submitter):
  `eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.type==='submit'&&x.textContent.trim()==='Save');b.closest('form').requestSubmit(b)})()"`.
  This was verified end-to-end (created CR-2026-06-000003). See the `/test` skill step 6b.
- **Post / Void** buttons (`fetcher.submit` onClick) also don't fire under a click; POST
  directly to the path (`/x/credits/:id/post`) to exercise the `post-memo` edge function.
