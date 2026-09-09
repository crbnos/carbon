# Accounting Posting Corrections — Financial Reports

Last tested: 2026-09-09
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


## September 9 repeat: subsidiary-only access and large datasets

Use a new test employee with membership and accounting permissions **only in the subsidiary**. Seed the parent and subsidiary through `seed-company`, with a custom parent CTA mapping distinct from the subsidiary's default. Verify that the employee's RLS client cannot read the parent's `accountDefault` row, then use that employee's real authenticated browser session for the report tests.

This run used parent `0ddff794ec6b4b01a1b6`, child `c0803a4c7e8c4aac94b8`, group `cg_Y11kpKnKtErRFt64toa1cy`, and child-only employee `34507169-9e13-458d-81a3-03ee5bb7812d`. Source journal `je_C9wnNom8SpGvxJFKyf91ji` was posted through the real journal form, with Historical Cash debit 80 and Sales credit 80. The custom parent CTA and its group have the prefix `ACCT-E2E-20260909-REPORTS`.

Identity child and All Companies reports passed with Assets 80, Net Income 80, CTA zero, and Balance Sheet zero. Foreign child and All Companies reports passed with Assets 160, Net Income 120, custom CTA 40 exactly once, Equity 160, and Balance Sheet zero. July values were zero. Click the actual Download button and compare **every CSV row and both monthly columns** against the relevant report loader. The child report succeeds while the parent's defaults remain unreadable directly through RLS.

For pagination, add 1,005 zero-balance Asset leaves to the owned chart. There were 1,111 chart accounts and 1,061 balance-sheet rows. Repeat the translated child report and verify all 1,005 additional leaves appear in the loader and CSV without affecting totals. This passed with a real PostgREST hard cap of 1,000 rows, as well as the uncapped local runtime.

To exercise the production-equivalent cap locally, first preserve the existing authenticator `pgrst.db_max_rows` setting. The official PostgREST 13 configuration workflow supports a database-specific role setting and `NOTIFY pgrst, 'reload config'`. Verify the cap using a fixture with more than 1,000 rows; after testing, restore the prior setting and independently verify the uncapped row count. Coordinate with other local agents before temporarily changing the shared local API cap. Never rebuild the database.

Evidence and runnable fixture/verification scripts: `.context/accounting/e2e-20260909/reports-*`. Verified outcomes are in `reports-verification.json`; the complete run findings, limitations, and restoration evidence are in `reports-results.md`.

## Default accounts save and validation

1. In an owned new company, confirm Shipping Revenue is an active Revenue leaf beneath Revenue, distinct from Sales. Current seeds use 4050 Shipping Revenue; 4040 is Customer Payment Discounts.
2. Open `/x/accounting/defaults`. Select a different Bank — Cash mapping and an owned alternate Shipping Revenue account beneath Revenue. Use the actual combobox option, then verify each hidden input's value. Offscreen coordinate clicks can dismiss the menu without changing the value; clicking the observed option DOM element reliably commits React state.
3. Submit the form with native `requestSubmit(saveButton)`. Reload the page and independently verify the stored mappings match both sections.
4. Through the actual authenticated action, submit the whole form with a valid bank change and Shipping Revenue equal to Sales. Verify the specific validation message and compare the entire defaults row before and after: no fields may change.
5. Repeat with a Shipping Revenue account from an unrelated owned group. Verify the company-group validation message and unchanged full row.

Both invalid mapping cases passed, and the valid UI save/reload passed. No existing company's mappings were changed.

## Payment read paths across 1,000-row boundaries

In an isolated company, create 1,005 open invoices and 1,105 effective settlements against a 2,000 document-currency invoice. A new Draft payment's actual browser loader must return all 1,005 invoices, the first invoice's remaining document amount 895, and total open document amount 10,935. This passed with the real 1,000-row API cap.

Place a temporary malformed settlement with missing exact principal beyond the first page, then request the Draft payment through its authenticated HTTP route. Verify an error redirect instead of partial balances, and remove the malformed test row afterward. This late-page data-validation case passed; it does not simulate a network failure.


## September 9 fix verification

After the report fixes, repeat the inactive case with both the posting leaf and its ancestor inactive. Child and All Companies translated reports now retain all historical values: Assets 160, Net Income 120, custom parent CTA 40, Equity 160, Balance Sheet zero. With 1,005 extra chart leaves and the actual PostgREST cap of 1,000, each report returned 1,061 rows and its real two-month CSV matched every loader value. The SQL regression also closes a period and invokes the real snapshot writer after deactivation; inactive balances survive both full scans and snapshot-bounded scans.

Posted payment and invoice detail histories now both display the full 1,105 applied amount under the actual cap, with the posted payment's Unapplied zero. Page-error regressions verify that a later request failure returns no partial history. When seeding invoice fixtures directly, create the `salesInvoiceShipment` companion row: the detail form requires it. The previously observed synthetic invoice render error was resolved by completing that fixture.

Out-of-group selections now return HTTP 404 for balance sheet, income statement, and trial balance. The caller remains the child-only employee, and valid All Companies still resolves the parent's configured CTA.

If the HTTPS local alias fails after an ERP-only restart while direct localhost works, import the same actual callback cookies into the named browser's `http://localhost:<ERP port>` origin and omit `--secure` for that local test origin. Do not change authentication/RLS or reset the database. Restore the original PostgREST cap, verify an unpaged 1,105-row read, reactivate the owned test accounts, close the browser, and delete the temporary session secret.

Verified fix artifacts: `.context/accounting/e2e-20260909/fix-reports-results.md`, `fix-reports-browser-verification.json`, `fix-historical-green.log`, `fix-refund-reports-green.log` (106 SQL report cases), and `fix-reports-vitest-green.log` (83 ERP tests).
