# Accounting Setup Wizard (cutover activation)

Last tested: 2026-10-09 (steps 1–3 PASS on "Company Without Accounting"; the legacy-window
procedure below PASS end to end on "Legacy Window Test")
Route: /x/settings/accounting → /x/accounting/activation/readiness

## Prerequisites
- A company with no `companySettings.accountingCutoverDate`. Once the cutover is set,
  every `/x/accounting/activation/*` URL redirects to `/x/accounting/periods`.
- Log in as test@carbon.ms. The login lands on `/select-company`; pick the company by its button.
- DB access: no host `psql`. Use the stack's container:
  `docker exec -i carbon-carbon-<branch>-postgres-1 psql -U postgres -d postgres -c "…"`.
- Run alone. The agent-browser "default" session and the test company are shared with
  other sessions. Another actor enabled accounting during the 2026-10-09 run.

## Steps
### 1. Invoice before enable — /x/sales-invoice/<id>/details
No journal panel and no badge on the invoice. Post is disabled. Status reads "Submitted".
### 2. Settings → Accounting — /x/settings/accounting
The General Ledger card reads "Accounting is not set up" with a "Set up accounting" link.
The link has no button role, so click it with `eval` by its text.
It opens `/x/accounting/activation/readiness`. The breadcrumb reads "Accounting / Setup / Readiness".
### 3. Readiness
- The cutover date picker defaults to the first day of the current month.
- If "Every account default is set" fails, the item name (for example "Migration Clearing")
  is a link to `/x/accounting/defaults`. It does not scroll to the field.
- Migration Clearing needs an Equity account. The defaults combobox cannot create one.
  Create it at `/x/accounting/charts` → "Add Account": Parent Group "Equity", number "3400",
  name "Migration Clearing". `requestSubmit` the form whose button reads "Save".
- On Default Accounts, find the combobox in the card whose `h3` reads "Migration Clearing".
  Pick "3400 Migration Clearing". `requestSubmit` "Save". The toast reads "Updated default accounts".
- Return to the readiness page. All 6 checks show "Passed" and "Next" becomes a link.
### 4–10. Inventory, Fixed assets, Trial balance, Enable, Journals, Payment
Verified by the legacy-window procedure below. Void is not verified yet.

## Legacy-window procedure (documents posted before journals existed)

Use this to test the enable on documents that are posted, dated on or after the
cutover, and have no journal. Work on a NEW company. Never use an existing company.

### A. Make the company (app)
1. Pick any company on `/select-company`. Open the company switcher in the breadcrumb.
2. Click the menu item "Add Company". A modal opens: "Let's set up your new company".
3. Fill "Company Name", the address line (a combobox — `fill` works), city, state and postal code.
4. `requestSubmit` the modal form (the form that holds `input[name=addressLine1]`).
5. The app switches to the new company. It does not apply a demo template.
6. Read the company id: `select id from company where name = '<name>'`.

### B. Clear the cutover (DB, local only)
A new company gets a cutover at creation (`seed-company`). The trigger
`companySettings_accounting_config_locked` (function `check_accounting_config_locked`)
refuses a change once `accountingActivatedAt` is set. Disable only that trigger:

```sql
BEGIN;
ALTER TABLE "companySettings" DISABLE TRIGGER "companySettings_accounting_config_locked";
UPDATE "companySettings" SET "accountingCutoverDate" = NULL, "accountingActivatedAt" = NULL,
  "accountingActivatedBy" = NULL WHERE id = '<companyId>';
ALTER TABLE "companySettings" ENABLE TRIGGER "companySettings_accounting_config_locked";
COMMIT;
```

Check that `pg_trigger.tgenabled` is `O` for that trigger after the commit.
A new company already has every account default, Migration Clearing included.

### C. Post the documents (app) — each posts a Provisional journal
1. Part: `/x/part/new`. Fill ID, name, and the unit cost field (fill + blur). Costing is FIFO by default.
2. PO: `/x/purchase-order/new`. The supplier combobox shows "Add your first supplier" on a new company.
   Click it, fill the name, `requestSubmit` the modal form. Pick the new supplier from the open list.
3. PO line: "Add Line Item". Pick the part. Fill quantity 10 and unit price 8 (fill + blur). `requestSubmit`.
4. Click "Finalize", then "Finalize" in the dialog. Click "Receive". On the receipt click "Post", then "Post Receipt".
5. Back on the PO, click "Invoice". On the invoice click "Post", then "Post Invoice". Status becomes "Open".
6. SO: `/x/sales-order/new`. Use "Add your first customer" the same way as the supplier.
7. SO line: pick the part, quantity 2. Click the unit price field, `fill` 50, press Tab. Check `input[name=unitPrice]`.
8. "Confirm" twice. "Ship". On the shipment "Post", then "Post Shipment".
9. Back on the SO, "Invoice". On the invoice "Post", then "Post Invoice". Status becomes "Submitted".

### D. Simulate the reset (DB)
Delete the Provisional journals of THIS company only:

```sql
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
DELETE FROM "journalLine" WHERE "companyId" = '<companyId>' AND "journalId" IN (<ids>);
DELETE FROM journal WHERE "companyId" = '<companyId>' AND id IN (<ids>);
COMMIT;
```

Keep the `costLedger` rows. If you made payments, memos or charges, set their `journalId` to NULL.

### E. Run the wizard (app)
1. Readiness: cutover = first day of the current month. All 6 checks pass. Click "Next".
2. Inventory: "No item has stock on hand at the cutover date." (the stock came in after the cutover).
3. Fixed assets: "No fixed asset was acquired before the cutover date."
4. Trial balance: no entry is needed. "Migration Clearing" at the bottom reads $0.00.
   "Save Trial Balance" stays disabled, and "Next" works without a save.
5. Enable: the Summary lists "Documents posted before Carbon kept journals" with one row per family
   (Sales invoices, Purchase invoices, Purchase receipts, Sales shipments).
6. Fill `input[name=confirmation]` with the company name. `requestSubmit` its form ("Enable accounting").
7. The app redirects to `/x/accounting/periods`.

### F. Verify
- DB: every journal of the company is `Posted`. Each legacy document has one journal with a period.
- DB balances (sum of `journalLine.amount` per account; amounts are signed by natural balance):
  AR = sales invoice total, AP = purchase invoice total, GR/IR = 0, inventory = on-hand × cost,
  no line on the Migration Clearing account.
- Sales invoice → "Payment" link → `/x/payments/new?...&amount=<balance>`. The bank account is prefilled.
  `requestSubmit` "Save". Click "Post". Status becomes "Posted" and the invoice "Paid". AR = 0.
- The same works from the purchase invoice (Disbursement). AP = 0.
- `/x/accounting/journals` lists the rebuilt journals as Posted.

## Selector Notes
- The wizard step tabs are links in `navigation "Accounting setup"`.
- "Next" is a link (not a button) once every check passes. It is a disabled button before that.
- The hidden input for Migration Clearing is `input[name=migrationClearingAccount]`.

## Common Failures
- The readiness checks do not list a posted document dated on or after the cutover that
  has no journal. The Enable step lists it under "Documents posted before Carbon kept
  journals", and the enable writes its journal (verified 2026-10-09).
- `agent-browser screenshot` with a RELATIVE path saves to a temp folder. Pass an absolute path.
- After the enable, the cutover period shows Status "Inactive" until the next posting
  marks it "Active" (`get-accounting-period.ts`, mode "current").
- The enable writes no opening journal when every opening balance is zero.
- Every page logs "Hydration failed" on a direct load in dev. This is app-wide, not the wizard.
