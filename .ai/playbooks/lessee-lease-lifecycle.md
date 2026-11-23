# Lessee Lease Lifecycle (create → activate → invoice → post → void)

Last tested: 2026-10-12 (several assets per lease, Duration, open-ended leases)
Route: /x/purchasing/leases → /x/lease/new → /x/lease/<id>/details

## Prerequisites
- A supplier exists (seeded "CelestialElex", "Deep Space RF", "BargainSat Components" used).
- The company has an accounting cutover BEFORE the commencement date, or activation takes the opening-balance path instead of a commencement journal (dev company cutover: 2025-11-01).
- Lessee account defaults mapped (seeded by migration).
- Open-ended test: `companySettings.leaseShortTermExpedient` off to see the refusal, on to activate. The dev company `db5rju8fi0gg2a9stp2g` has it ON; restore it after the test.

## Steps — a fixed-term lease with two assets
### 1. Navigate — /x/purchasing/leases; "Add Lease" (shortcut N) → /x/lease/new: the setup wizard (SetupFrame, steps Details · Assets · Payments · Accounting · Review)
### 2. Details (step 1)
1. First combobox = Supplier: click it, then click the option.
2. Lessor section also holds site, contact and Location.
3. Term: Commencement date, then the Duration combobox (1–5 years, Open-ended, Custom; default 3 years). "Ends <date>" shows under it. Custom adds an End Date picker.
4. requestSubmit the form whose submit button text starts with "Next" → /x/lease/<id>/setup/assets.
### 3. Assets (step 2)
1. Open "Add Asset" by a JS click: `[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Add Asset').click()`. A plain click is covered by another element.
2. The dialog has three textboxes in order: Asset, Serial Number, Payment. Fill Payment, then click another field to blur.
3. requestSubmit the dialog's form (its submit button reads "Add"). Toast "Added asset"; the asset's rows are cut.
4. Grid cell edit: click the cell, fill its textbox, press Enter. A payment change re-cuts only that asset's rows.
5. Row menu (⋮) → "Remove Asset" → confirm. Its rows go with it.
### 4. Payments (step 3) — frequency, timing (find text "Arrears", click) and escalation save on their own and re-cut every asset's rows. The grid has an Asset column when there are several.
### 5. Accounting (step 4) — live classification per asset; the cards count assets per treatment. Asset Inputs grid: click a cell, fill, Enter. Fair value 52,000 on a 1,500/month racking asset flips it to Finance.
### 6. Review (step 5) — footer Back / Save as Draft / Activate. Activate opens a dialog with a leg per asset; requestSubmit its form → /x/lease/<id>/details, Active, one Posted journal with lines per asset.
### 7. Invoice Now — header button; dialog "Invoice" (requestSubmit). One Draft purchase invoice per due date, one Lease line per asset, described with the asset.
### 8. Lease run — /x/accounting/lease-runs → "New Run" → period end → create → "Post". Every run journal line carries the asset in `documentLineReference`.
### 9. Terminate one asset — lease page → the asset's row in the explorer (left), which opens the asset's page (/x/lease/<id>/<lineId>/details) → "Terminate". Date on the last day of a payment period. That asset becomes Terminated; the other stays Active, and so does the lease.
### 10. Post / Void an invoice — open it (/x/purchase-invoice/<id>), "Post" → dialog "Post Invoice". Void: "More options" → "Void" → dialog "Void Invoice"; the payment row returns to Pending.

## Steps — an open-ended lease
1. Turn the expedient off: `update "companySettings" set "leaseShortTermExpedient"=false where id='db5rju8fi0gg2a9stp2g'`.
2. Details: pick a supplier, Duration "Open-ended". The note "Runs until it is ended on notice…" shows. Next.
3. Assets: add one asset with a payment. Two rows are cut: today's period and the next.
4. Review: the red notice "The short-term lease expedient is off" lists both fixes, and Activate is disabled.
5. Click "Short-Term Lease Expedient in Settings → Accounting". It lands on /x/settings/accounting#lease-classification, scrolled to the card.
6. Turn the switch on (`button[role=switch]` in that card's form) and requestSubmit the card's form ("Save").
7. Back on Review, Activate is enabled. The dialog says "Activating fixes the terms. The next payment row is cut as each period comes due." Activate.
8. Check: the lease is Active, the asset is Short-Term with `classificationInputs = {"openEnded": true}`, no journal, no schedule.
9. To see the roll-forward, delete the next Pending row in the DB, then Invoice Now. The job cuts that row again and drafts the due one.

## Selector Notes
- Dialog confirm buttons: find in `[role=dialog] button` by text and `requestSubmit` its form.
- `agent-browser screenshot --full` does not capture the setup body (it scrolls inside a container). Scroll the target into view with `scrollIntoView` and take a normal screenshot.
- A React Router `<Link>` ignores a changed `href` attribute; follow the real link instead.
- The login page shows a Cloudflare widget; filling the email and clicking Continue still works, but the redirect to /x takes ~10 s.

## Common Failures
- Filling the Add Asset dialog with refs from a shell loop (`set -- $refs`) filled the wrong fields. Fill each ref by name.
