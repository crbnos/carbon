# Company Timezone — differential date test

Last tested: 2026-08-05
Route: /x/settings/company (+ /x/purchase-order/new, inventory adjustment)

## Purpose
Prove business dates (orderDate, itemLedger postingDate) derive in the COMPANY
timezone, not UTC — by setting a timezone whose calendar day differs from UTC.

## Prerequisites
- Migrations through 20260805152353 applied (company.timezone, get_timezone_names, validity CHECKs)
- A supplier and a part exist (create inline/SQL if missing)
- Company address fields filled — the settings form validates city/postal/country,
  so an incomplete seed company blocks saving ANY settings change until filled

## Steps
### 1. Pick a differential zone
- If UTC time is 10:00 OR LATER, `Pacific/Kiritimati` (UTC+14) is already tomorrow.
- If UTC time is BEFORE 11:00, `Pacific/Niue` (UTC-11) is still yesterday.
- (So one of the two always differs; between 10:00-11:00 UTC both do.)
- Confirm in SQL: `SELECT now()::date, company_today('<companyId>');` — they must differ.

### 2. Set company timezone
- Settings → Company; timezone field is a searchable combobox (options come from
  the DB via api/timezones — labels look like "Pacific/Kiritimati (UTC+14:00)").
- Open the picker, type into the popover's "Search..." input, click the single match.
- requestSubmit the form whose button reads "Save" (NOT a click).
- Verify: `SELECT timezone FROM company WHERE id='<companyId>';`

### 3. Create a PO
- /x/purchase-order/new → select supplier (first combobox) → requestSubmit "Save".
- Verify: `SELECT "orderDate", "createdAt" FROM "purchaseOrder" WHERE "companyId"='<companyId>' ORDER BY "createdAt" DESC LIMIT 1;`
  → orderDate must be the COMPANY's day, createdAt shows the UTC instant.

### 4. Post an inventory adjustment (Deno edge-fn path)
- /x/inventory/quantities → click the item row → "Update Inventory" button →
  modal is prefilled (Set Quantity, HQ location) → requestSubmit "Save".
- Verify: `SELECT "postingDate", "createdAt" FROM "itemLedger" WHERE "companyId"='<companyId>' ORDER BY "createdAt" DESC LIMIT 1;`
  → postingDate = company day (proves functions/lib/datetime.ts + getCompanyTimeZoneDb).

### 5. Accounting period + journal (accounting enabled)
- Enable: `UPDATE "companySettings" SET "accountingEnabled"=true WHERE id='<companyId>';`
- The item's `itemCost.costingMethod` must be 'Average' with a non-zero `unitCost`
  for the adjustment to post a non-zero journal (FIFO/LIFO increases cost from
  empty layers = 0 = no journal). `UPDATE "itemCost" SET "costingMethod"='Average',"unitCost"=25 WHERE ...`.
- Post an Increase adjustment (as in step 4).
- Verify: `SELECT j."postingDate", ap."startDate", ap."endDate", ap."periodNumber", j.status FROM journal j JOIN "accountingPeriod" ap ON ap.id=j."accountingPeriodId" AND ap."companyId"=j."companyId" WHERE j."companyId"='<companyId>' ORDER BY j."createdAt" DESC LIMIT 1;`
  → journal.postingDate = company day; the period is lazily created for the
  company's month (proves getCurrentAccountingPeriod uses companyToday.year/month).
- **costLedger must match itemLedger**: `SELECT "postingDate" FROM "costLedger" WHERE "companyId"='<companyId>' ORDER BY "createdAt" DESC LIMIT 1;`
  must equal the itemLedger postingDate (both = company day). If costLedger shows
  the UTC day, a costLedger insert is missing `postingDate:` and fell back to
  `DEFAULT CURRENT_DATE` — regression guard.

### 6. Revert
- Set the company timezone back (UI or constraint-checked SQL UPDATE).
- `UPDATE "companySettings" SET "accountingEnabled"=false WHERE id='<companyId>';` if you enabled it.

## Selector Notes
- Timezone/search comboboxes are cmdk: popover search input has placeholder "Search...";
  set its value via the native-setter + input-event trick if fill misses.
- Company settings comboboxes (in order): country ("Select"/country name),
  Base Currency (disabled), Timezone.
- The AddressAutocomplete combobox on the company form is EXPANDED by default —
  stray typing lands in it (writes addressLine1). Check input[name=addressLine1] after.
- Adjustment modal: all fields prefilled via hidden inputs; just requestSubmit its Save.

## Common Failures
- Save "does nothing" on Settings → Company: the seed company has empty
  city/postalCode/countryCode → validation errors below the fields. Fill address first.
- `agent-browser type "text"` without a ref treats the text as a selector and
  times out — always pass the element ref, or use the native-setter eval.
- Constraint check: `UPDATE company SET timezone='Fake/Zone' WHERE id='<companyId>'`
  must FAIL (company_timezone_valid) — use this as a negative test.
