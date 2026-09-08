# Accounting Posting Corrections — Financial Reports

Last tested: 2026-09-08
Route: `/x/reports/balance-sheet`
Plan: `.ai/plans/2026-09-07-accounting-posting-corrections.md`, Task 18, Workflow C

## Prerequisites

- A running, migrated local ERP stack; resolve `ERP_URL` from `.env.local`.
- Authenticate with the auth skill. Keep browser sessions sequential when investigating local login problems, and compare host/runtime UTC clocks after laptop sleep.
- An owned test parent and subsidiary sharing a chart. The parent has no posted activity; the subsidiary has one balanced journal with Cash debit 80 and Sales credit 80, posted through the actual journal form.
- The parent's `accountDefault.currencyTranslationAccount` points to custom posting leaf **3998 Report Test Custom CTA**, beneath **Report Test Translation Reserve** beneath Equity. The subsidiary retains the seeded default, proving translated reports resolve the parent's mapping.
- Identity case: both companies use the same currency. Foreign case: subsidiary-to-parent closing rate 2 and average rate 1.5.
- `getConsolidationRates` reads the global daily currency pairs; company overrides do not affect this report. This run created unused test codes XXX/XTS only after verifying no existing codes, companies, or rates used them. Existing currency feeds were not changed. Rates: XXX=1 and XTS=1 on 2026-08-01; XXX=2 and XTS=1 on 2026-08-31. The mean pair rate is 1.5. Group historical rate is 1.

## Steps

### 1. Post the source journal

Open `/x/journal-entry/{journalId}/details`. Confirm Cash debit 80, Sales credit 80, posting date 2026-08-15, and balanced totals. Submit the Post button's form with `form.requestSubmit(postButton)`. Verify POSTED status, disabled amount inputs, and the success toast. Independently read the journal and lines to confirm both stored natural amounts are 80 and status is Posted.

### 2. Verify identity reports

Open `/x/reports/balance-sheet?companies={subsidiaryId}&startDate=2026-07-01&endDate=2026-08-31`. Use Monthly columns. July is zero throughout; August Cash and Cash & Bank/Assets are 80, Net Income and Equity are 80, custom CTA and its subgroup are zero, and the Balance Sheet root is zero.

Open the report's company selector, snapshot the menu, and select All Companies. Confirm the same values. Click Download in both scope selections and compare every exported account and both monthly columns with the report loader's displayed measure.

### 3. Verify foreign reports

Set only the owned subsidiary's base currency to the test source currency. Confirm the rate RPC resolves closing 2 and average 1.5. Reopen the subsidiary report and click **Show in XXX** (the reporting parent's currency).

Expected August values: Cash/Cash & Bank/Assets 160; Net Income 120; custom CTA 40; its subgroup 40; Equity 160; Balance Sheet root zero. Seeded account 3200 remains zero. July remains zero.

Collapse Assets to bring Equity into view. Click Equity's disclosure chevron to collapse, then expand it; confirm Net Income, the custom subgroup, and account 3998 remain correct. Switch to All Companies through the report selector and repeat. Download both CSVs and compare every account and column with the loader.

## Selector Notes

- The breadcrumb company selector and report company selector share the subsidiary name. Use the selector beside the Search accounts field, not the breadcrumb.
- Company options are `menuitemradio` roles: All Companies, the parent name, and the subsidiary name.
- A tree row's center does not toggle expansion; click its disclosure chevron. The tree virtualizes rows, so collapse Assets or scroll to reveal lower Equity leaves.
- Actual exports include the full account tree even when groups are collapsed or rows are outside the virtualizer's viewport.
- For evidence, capture only the relevant report entry in `window.__reactRouterDataRouter.state.loaderData`; never dump the root loader or authentication state.
- In agent-browser 0.20.7, `screenshot body {path}` reliably writes the specified path. The download command used a directory/UUID file; an already-finished download followed by `wait --download` stalled. Capturing the generated Blob while clicking the real Download button preserved the exact exported CSV without rebuilding it.

## Verified Results and Evidence

All four cases passed: identity subsidiary, identity All Companies, translated subsidiary, translated All Companies. Each CSV had 54 account rows; all rows matched both monthly loader columns. Expanded Equity showed the parent-configured custom CTA exactly once.

Local fixture identifiers and rate ownership: `.context/accounting/report-browser-fixture.json`.

- Parent: `2835329ce4aa40a68e6c`; subsidiary: `e238bd65d92849e89152`; group: `cg_M4AGJ1Q4ToQRGc8McncJep`.
- Posted source journal: `je_UX5A93t6WudGLmNXYSTzXX` (`REPORT-TEST-80`).
- Custom CTA: `acct_QpURLHR8Evs5vxokzbZsR6`; subgroup: `acct_Mw3MZJTn4itkgzU2uh5Lk9`.
- Screenshots: `.context/accounting/report-browser-source-posted.png`, and `report-browser-{identity,foreign}-{subsidiary,all}.png` in the same directory.
- Exact CSVs: `.context/accounting/report-browser-{identity,foreign}-{subsidiary,all}-export.csv`.
- Browser loader/export evidence: corresponding `-evidence.json` files. Source status and rates: `report-browser-source-and-rates.json`.
- Verification command: `python3 .context/accounting/report-browser-verify.py`; result: four PASS cases, `csvChecked: true`, 54 accounts each. Output saved to `report-browser-verification.json`.

The fixture is left foreign-configured (XTS subsidiary, XXX parent); all created company/account/rate IDs are retained for owned-fixture cleanup. No posted journals were deleted. The authenticated accounting-reports session was handed back to the parent agent for sequential workflow testing.

## Environment Failure Observed

During this run, laptop deep idle left Docker about three hours behind the host. Fresh auth tokens appeared expired and Chrome showed `ERR_TOO_MANY_REDIRECTS`. Restarting the runtime without resetting volumes synchronized the clocks; login and the same report flows then passed. Diagnostic captures are `.ai/scratch/e2e/accounting-reports/report-20260908-{foreign-all-error,reauth-error}.{png,txt}`. No authentication or report source changes were needed.
