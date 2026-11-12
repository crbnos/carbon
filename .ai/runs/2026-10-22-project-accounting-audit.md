# Project accounting audit — 2026-10-22

Branch `projects-port-main` (PR #2003) at `a0c98f0560`. Read-only review of five
areas by parallel reviewers: cost postings, burden and indirect rates, billing to
invoice, the revenue recognition run, and capitalize / close / service. Findings
marked **[verified]** were re-read against the code by the session lead; the rest
are the reviewers' reads of the exact path.

## Test baseline (all green)

- ERP database tests against the port's own stack (all 1325 migrations applied):
  51 files, 342 tests pass — post-timesheet, post-project-issue/expense/burden/stock-transfer,
  create-project-billing-invoices, generate-contract-billable-items, propose/preview/recalculate
  revenue run, ee (indirect-rates, project-revenue), lib, post-customer-contract,
  reclass-project-coverage, asset-capitalization, service orders, post-sales-invoice,
  post-receipt, post-purchase-invoice, issue.
- Unit: `packages/ee` project-revenue / indirect-rates / project-control 54 pass;
  `packages/utils` project-billing 19 pass; ERP accounting / projects / sales modules 542 pass.

The tests pass because none of them exercises the paths below (e.g. no test POSTS a
revenue run that holds Cost Relief rows; they only propose).

## Port

No port regression in the posting bodies: every line the branch added
(23bd5d6e0b→50c4309a9c) is present at HEAD. Port-introduced: C10 (strict backflush
bin check across stripes). From `a0c98f0560`: C11, C13.

## A. Revenue recognition run

- **A1 [verified] Blocker — a run holding a Cost Relief or Loss Provision row can never post.**
  `accounting.service.ts:11088` `drifted` treats `customerContractLineId && !customerContractRevenueId`
  as stale; both row types are written that way by design (`project-revenue.ts:332-345`,
  ee `service.server.ts:516-528`). Recalculate rewrites the same rows → fails forever, and blocks
  every other row in the run. Fix: limit that clause to `Deferral`/`Accrual`.
- **A2 [verified by two reviewers] Two progress lines on one element subtree** (an ended line and its
  follow-on, an amend `change` of a Fixed Percent Complete line, or Fixed PC + Cost Plus on a child)
  → `selectUnrelievedCost` returns a row once per line → `projectCostRelief_ledger_key` violation;
  every proposal and close preview for the company fails. Before that, both lines earn revenue
  and a loss provision on the same cost. `loadProgressLines` has no end-date/amended filter;
  `checkBillingLines` skips Fixed lines in the P7 overlap check.
- **A3 Running an earlier month after a later month has a row double-recognizes** —
  `recognizedBefore` counts only earlier months (`project-revenue.ts:191-212`; ee `:437-474`).
- **A4 A second run in a month with zero revenue books the Loss Provision change again** —
  no month row is written at 0 so the month is never "closed" (`project-revenue.ts:225`, ee `:430`).
- **A5 Cost Plus Percent Complete price includes fee on unallowable cost**, which billing never bills
  (`progress.ts:33-39`). Also: EAC uses memo burden at costing rates, no ceilings.
- A6 (policy) Right to Invoice recognizes On Hold items, including "Funding limit" holds.
- A7 EAC uses cost as of now, progress uses cost to the period end; planned labor rate uses UTC `CURRENT_DATE`.
- A8 Rounding dust: items at 5 dp, invoices at 2 dp.
- A9 Right to Invoice run does not run the T&M backfill, so SQL-posted rows (job completion,
  backflush) are relieved to COGS months before their revenue is recognized.
- A10 A project Fixed Price line with Daily / Even Period revenue never relieves Project WIP.
- Docs: `project-billing.md` "a Project Issue row carries no journalLineId" is stale.

Verified correct: run order; Deferral/Accrual split and its sign swaps; invoices on contract
lines post only to Contract Assets / Deferred Revenue, never Sales (no double recognition);
Percent Complete arithmetic; cost relief (Asset-only, unique, sides); journals and dimensions;
the Draft Journal preview matches posting (apart from A1); dates are company-day strings.

## B. Billing to invoice

- **B1 [verified] T&M backfill has no lower date bound** (`project-posting.ts:1932`): ending a
  Fixed Price line and adding a T&M line on the same element bills all earlier cost again.
  Same in the Cost Plus generator (ee `service.server.ts:214-226`).
- **B2 Amend `change` of a partly invoiced Fixed Price line bills the full new price again**
  (`lineCutover` `sales.service.ts:19755`, `reconcileContractSchedule`): 100k, 50k invoiced,
  changed to 120k → plans 120k more. Main's One-time service lines behave the same.
- **B3 [verified] `takeWithinFunding` stops at the first over-funding item**, so a later credit is held
  (`packages/utils/src/project-billing.ts:308-325`).
- B4 An Ended contract never bills again: a late reversal or a voided invoice's items stay Unbilled forever.
- B5 An ended Cost Plus line drops rows posted after its end date for an earlier date (ee `:201`).
- B6 Draft project billing invoice lines can be edited/deleted (`invoicing.server.ts:295`) — invoice
  and items diverge; funding allocations survive a line delete.
- B7 T&M labor invoice line ≠ Σ items (rounded hours × rate) — 0.50 per 1,000 entries.
- B8 Cost Plus PC caps revenue at the ceiling, billing ignores the ceiling.
- B9 A reversal dated after `through` for a never-billed row is never credited.
- B10 The contract page's Invoice action skips Cost Plus generation.

Verified correct: contract-line invoice posting (Contract Assets first, then Deferred Revenue);
no COGS on billed lines; void and Draft delete return items to Unbilled; funding units; repeat
runs lock and stamp; T&M and Cost Plus pricing; bill-rate precedence; no overlap between the
two invoice sources.

## C. Cost postings

- **C1 [verified] `closeJob` writes off a consume-to-project job's project cost**
  (`production.service.ts:12620`): it sums WIP lines by `documentId = jobId`; consume-to-project
  lines carry the job as document and Project WIP = WIP (backfill `20261021000500:59`, seed 1230).
  Dr Material Variance / Cr WIP for all of it, while `projectLedger` keeps it; the revenue run
  then relieves it again → WIP negative, cost expensed twice.
- **C2 [verified by two reviewers] Charge at receipt is charged twice** — receipt writes a row
  (`inventory.service.ts:11908`), `postProjectIssue` (`projects.service.ts:7941`) and the job
  issue paths never read `chargeAtReceipt`. Spec `2026-10-03-projects.md:419`: the issue must not.
  Double T&M billing; relief credits Raw Materials for stock already credited.
- **C3 Project issue Return valued at today's cost**, not the issue's (`projects.service.ts:7632, 7863`,
  `bookAdjustment` without `fixedUnitCost`).
- **C4 Supplier return of a line consumed at receipt credits inventory, not the project.**
- **C5 Timesheet correction after DCAA re-dilution keeps the original billable item** —
  `ledgerRowByEntry` picks the last row (no `orderBy`), usually the dilution adjustment.
- C6 Two posts in one employee-week each re-dilute the week (no lock in `loadWeekDilution`).
- C7 Reversing a charge on a completed refurbishment strands WIP (`service.service.ts:3168`).
- C8 Payback variance invented for Average / Standard cost items.
- C9 A voided receipt still counts as having charged the project at invoice (`project-charges.ts:158`).
- C10 (port) Strict backflush checks the bin across all stripes, draws only the job's.
- C11 (a0c98f0560) Issue below zero to a project leaves no negative cost layer.
- C12 Two materials of one item at one bin both draw the same project stock.
- C13 (a0c98f0560) The zero-cost refusal blocks issues before the cutover and on Statistical projects.
- C14 A direct inventory purchase invoice line charged to a project never reaches the project.
- C15 Reversals post on the original date → refused once that period is Locked/Closed (labor transfers).
- C16 A production event on a project can't be reversed after the project closes.
- Inconsistencies: SQL `projectLedger` inserts never set `unallowable`; reversals recompute the
  unallowable flag and the account instead of copying them (see D2); charge-at-receipt return row
  vs journal amount; no Project dimension on Statistical purchase lines; void journals copy no
  dimensions; charge lines gate on `commitment`; reimbursement dimension can disagree with the ledger.

## D. Capitalize, close, service, reports

- **D2 Reversals re-resolve the posting account and unallowable flag** (`timesheet-posting-plan.ts:244-335`,
  expense reversal, issue Return): Contract→Expense mid-project then transfer → Cr Project Expense
  while WIP keeps the debit.
- **D3 Labor transfer rebooks at the current rate for the entry date**, not the booked rate.
- D5 Revenue-run relief can credit CIP (Fixed PC line on a Capitalize element).
- **D6 A Capitalize asset Under Construction at the cutover is dropped from the opening balance**
  (`accounting-cutover/fixed-assets.ts:191-208`; `acquisitionDate` NULL).
- D7 Cutover re-cost of an issue on an Active asset posts to CIP.
- D8 Postings after a refurbishment completes credit WIP already moved to the serial.
- D9 Refurbishment cost-layer split ignores project stock.
- D10 DCAA diluted reversal leaves 0.00003.
- **D11 Closing a project posts nothing; Contract WIP outside every billing subtree is never relieved**
  (no element, no contract line, Fixed Daily lines, project-level burden). Close does not check
  borrows, project stock, or assets still Under Construction. Needs a design decision.
- D12 Contract-coverage service charges go to the parent's Project WIP and are never relieved.
- D13 Moving an element out of a billing subtree strands later reversals.
- D14 A capital job open when its asset is placed in service strands its WIP.
- D15 A voided service invoice can't be re-invoiced (order stays Closed).
- D16 A pre-cutover timesheet batch becomes one Provisional journal dated at its latest entry.
- D17 Closed/Locked periods handled three ways (refuse / shift / accept).
- D19 Committed double-counts invoiced G/L Account and Service PO lines (never received).
- D20 Cost by CLIN shows Billed $0 on Fixed CLINs.
- Lower: unallowable cost capitalized with no flag; `capitalizeCip` takes CIP rows dated after
  in-service; $0 billable items when no price; coverage reclass resets reviewed items; no project
  poster calls `assertBalanced`.

## E. Burden and indirect rates (ee)

- **E1 [verified] G&A base double-counts absorbed overhead** in the rate run vs the targets
  (`compute.ts:203-205, 233-239` vs `:398-402`).
- **E2 [verified] Burden billing ignores `offsetAbsorbedOverhead`** (`compute.ts:521-558`) while the
  Cost Plus generator bills Overhead rows at cost → overbilling.
- **E3 [verified] Burden-on-burden dropped from the rate base** when an earlier pool's base carries
  burden (rate run carries `rate × raw cells`, targets carry the full earlier target).
- **E4 [verified] Deactivating a pool reverses its whole year of burden** (active-only pools,
  goal 0 in `burdenCatchUp`); billing does not follow; the UI tells users to deactivate.
- **E5 [verified] Re-running or relocking an earlier period undoes later burden and the Final
  true-up** — `loadPostedBurden` sums the whole fiscal year, the target only reaches the run period.
- E6 Concurrent runs post the same catch-up twice (no lock / re-read); burden billing has the same race.
- E7 Project ledger vs GL drift when "Post applied burden" or cost treatment changes mid-year.
- E8 Absorbed-overhead offset applies only to the allowable target.
- E9 The applied/absorption account can be mapped as a pool Cost account.
- E10 ICE Schedule I compares cost with fee-loaded billings; contract rate ceilings never shown as disallowed.
- Closed contracts never bill the Final-rate true-up difference.

Verified correct: applied burden journal balances and maps to its ledger rows; re-running the
latest period is idempotent; unallowable stays out of pool cost and in the base; IR&D/B&P out of
the G&A base; T&M bills no burden; ceiling and fee; memo burden is never relieved; fiscal years.

## C2 options (from the fix attempt)

Every design that counts cost once, bills once and relieves from the account holding the cost
needs a ledger row at the issue (relief is one row, one account) and must split a draw by how much
receipt-charged quantity is still unissued (project stock also fills from transfers, borrows, job
output and returns). Seven write sites: `postProjectIssue`, `insertJobProjectLedgerRows` (4 calls),
SQL `backflush_job_materials`, `complete_job_to_inventory`. ACWP at measurement point Issue double
counts the same way today.

- A (recommended): the issue writes its normal row (+cost, WIP debit) plus an offsetting −cost row
  on its inventory credit for the receipt-charged part, both marked (new `projectLedger` boolean);
  billing skips marked rows; relief skips rows on inventory accounts. Return writes the mirror pair.
  Schema change on `projectLedger`, both SQL functions, ~6 TS files.
- B: no issue row; repoint the receipt row once fully issued. Not recommended.
- C: book the receipt to Project WIP. Breaks inventory↔GL tie-out. Not recommended.
- D (interim, no schema): relief skips inventory-account rows. Stops Raw Materials going negative;
  the double cost and double billing remain.
