# Accounting Setup Wizard (cutover activation)

Last tested: 2026-10-09 (steps 1–3 PASS; steps 4–10 not reached — see Common Failures)
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
### 4–10. Inventory, Fixed assets, Trial balance, Enable, Journals, Payment, Void
Not verified yet.

## Selector Notes
- The wizard step tabs are links in `navigation "Accounting setup"`.
- "Next" is a link (not a button) once every check passes. It is a disabled button before that.
- The hidden input for Migration Clearing is `input[name=migrationClearingAccount]`.

## Common Failures
- The readiness checks do NOT catch a posted document dated on or after the cutover that
  has no journal (for example an invoice posted before Provisional journals existed).
  After enable, that receivable or payable is missing from the GL.
- Every page logs "Hydration failed" on a direct load in dev. This is app-wide, not the wizard.
