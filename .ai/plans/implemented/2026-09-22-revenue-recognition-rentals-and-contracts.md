# Revenue Recognition, Rentals and Contracts — implementation plan

> Status: implemented (2026-10-07). All tasks done except Part II Task 21's email send and digest checks, which wait for SMTP.
> Spec: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md`.
> Consolidated 2026-10-07 from six plans, each kept verbatim as a Part.

## Contents

| Part | Plan | Was |
|---|---|---|
| I | Revenue recognition and rentals | `.ai/plans/implemented/2026-09-22-revenue-recognition-and-rentals.md` |
| II | Rental invoice automation | `.ai/plans/2026-10-02-rental-invoice-automation.md` |
| III | Contracts, Phase A | `.ai/plans/2026-10-03-contracts-phase-a.md` |
| IV | Contracts setup wizard and Phase B revenue | `.ai/plans/2026-10-04-contracts-wizard-phase-b.md` |
| V | Period runs hardening | `.ai/plans/2026-10-04-period-runs-hardening.md` |
| VI | Close wizard run preview | `.ai/plans/2026-10-04-close-wizard-run-preview.md` |

# Part I — Revenue recognition and rentals

> Was `.ai/plans/implemented/2026-09-22-revenue-recognition-and-rentals.md` ("Revenue Recognition Core + Rental Fleet — implementation plan"), merged here verbatim on 2026-10-07. Decision, question and section numbers in this Part (D1, Q3, §2, Task 4) are its own.

**Spec:** `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part I
**Research:** .ai/research/2026-09-21-sell-vs-rent-rental-revenue-recognition.md
**Branch:** revenue-recognition-rentals-spec (rebase onto `origin/main` first — Task 1)

Four phases, one plan. Phase A (recognition core) and Phase B (fleet bridge + Make to Asset) are independent of each other; Phase C needs both; Phase D needs C. Tasks marked **parallel-safe** touch disjoint files and may run as concurrent subagents.

### Plan-level decisions (fold into the spec changelog at close-out)

1. **New journal source types ship with `defaultEnabled: false`** in `POSTING_POLICY` (`'Revenue Recognition'`, `'Asset Transfer'`, `'Lease'`). The spec says `true`; the codebase precedent (returns types, `packages/ee/src/accounting/core/models.ts:345-377` comment) is that a new journal type never starts pushing to a customer's external ledger unasked. Precedent wins.
2. **Shared pure math lives in `packages/database/supabase/functions/shared/` with NO imports except `./precision.ts`** (calendar math on `YYYY-MM-DD` strings and integers — never JS `Date`), re-exported to Node through `@carbon/utils` exactly like `packages/utils/src/math.ts` re-exports `precision.ts`. Files: `revenue-schedule.ts`, `rental-billing.ts`, `lessor-lease.ts`. One implementation serves the Deno posting functions, the app, and the jobs package.
3. **Kysely writers that both a route and an Inngest job need live in `packages/database/src/`** (`revenue-recognition.ts`, `rental-billing.ts`), exported from `packages/database/package.json` like `./sequence`. `accounting.server.ts` / `sales.server.ts` call them; the jobs package imports them directly. Human-triggered posting (`postRevenueRecognitionRun`) stays in `accounting.server.ts`.
4. **`rentalAgreement.taxPercent`** (NUMERIC NOT NULL DEFAULT 0) is added: the spec says rent lines take "the customer's default" tax, and no such default exists in Carbon.
5. **`rentalAgreementCharge.kind`** (`rentalInvoiceLineKind`, default `'Charge'`) is added so a sales-type purchase option bills as a charge row of kind `'Purchase Option'` rather than a new table.
6. **Close task `sortOrder` = 5** (ties with "Match & eliminate intercompany transactions"; ordering falls back to name). Existing rows are never renumbered.
7. **Job→asset SQL branch**: assets and transfer rows are created right after the job status update with `amount 0`, then priced once the WIP journal exists (the accounting-disabled early `RETURN` sits between the two). With accounting disabled the assets exist at cost 0 — the same posture as registration with accounting off.

### Execution notes (deviations and follow-ups, kept current by /execute)

- Task 10: `post-sales-invoice`'s catch block reset the invoice to Draft on ANY throw, including a refused VOID. With the new "reverse the recognition journal first" refusal that became a likely path leaving a posted invoice displayed as Draft, so the reset is now guarded to `type !== "void"` (same file, three lines). Pre-existing void throws benefit too.
- Task 10 (follow-up, not changed): an intercompany invoice with a deferred line lands its revenue leg on Deferred Revenue, which `classifyIntercompanyPostingLines` does not treat as a Revenue-role line, so the IC Revenue elimination captures less for dated lines. Record on #1058 when rentals/rev-rec meet intercompany.
- Task 15: the monthly proposal cron is `0 12 1 * *`, not the planned `0 6 1 * *` — at 06:00 UTC on the 1st a company west of UTC−6 is still on the last day of the prior month, so `priorMonthEnd(today)` would name the month before the one that just closed. At noon UTC every inhabited zone is past its month boundary.
- Tasks 5, 9, 10: `deno check` of `seed-company`, `convert` and `post-sales-invoice` reports pre-existing errors at HEAD (11 / 56 / 43, in shared lib files and long-standing implicit-any sites). The gate used is "identical normalized error set vs a HEAD copy checked from the same directory", per `.ai/lessons.md` on own-file error deltas.
- Task 28: `postAssetRegistration` (`accounting.server.ts`) gained an optional `status` so a construction-in-progress class registers as Under Construction with accounting on as well as off (the route already derived it; the poster hard-coded Active). `"Under Construction": "blue"` went into the shared `FIXED_ASSET_STATUS_COLOR_MAP` (`packages/utils`) rather than a local branch in the badge. Tasks 13/21 typecheck fallout closed here too: `"Asset Transfer"` appended to the hand-written `journalEntrySourceTypes` array and given an icon case.
- Task 27: `x+/job+/$jobId.details.tsx` never renders `JobForm` (an existing job is edited field by field in `JobProperties`), so the plan's loader data for that route would have been dead; the asset target is set at creation (`new.tsx`, with `?fixedAssetClassId=` preselect) and the details action passes both fields through. Follow-up: a Complete To control in `JobProperties`. The TS2589 in `getActiveProductionEvents` (present since the fleet-bridge types regen, unrelated to any edit) is suppressed with the `// @ts-ignore TS2589` precedent from `purchasing.service.ts`.
- Task 25: the non-serial guard is `<> 1` rather than `> 1` (a fractional quantity would price one asset above the job's WIP); a job attached to an asset outside a construction-in-progress class is refused so WIP never restates a live asset's basis; a serial job short of numbered units raises like the receipt path instead of capitalizing fewer units than completed. The journal target rides in `v_journal_source_type` / `v_journal_document_type` / `v_journal_description` so the three journal inserts stay verbatim. The fork's diff against `20260922050131` removes only the twelve rewritten anchor lines; the function's ACL is unchanged after the DROP + CREATE.
- Hook fix (commit `1f771c7211`, outside the task list): the pre-commit backup check staged the regenerated `packages/jobs/manifests/schema.json` a second time as a root-level `manifests/schema.json` on every migration commit (Tasks 2, 19, 25). A hook runs with `GIT_DIR` exported and no `GIT_WORK_TREE`, so git took `pnpm --filter`'s cwd (`packages/jobs`) as the work tree. `check-backups.ts` now runs its `git add` from the repo root; the stray copy is dropped.
- Task 24: `trackedActivityInput` has no `entityType` column (input rows are `{ trackedActivityId, trackedEntityId, quantity }`); `fixedAssetTransfer.locationId` is NOT NULL so `attachJob` takes the job's location and `capitalizeCip` the asset's (else the newest attached job's, else a 400); capitalizing stock straight into a construction-in-progress class also writes a `fixedAssetCipCost` row (`sourceType 'Manual'`, the transfer id as source document) so a later `capitalizeCip` sweeps that cost too; the function answers `{ id, transferId, fixedAssetId, fixedAssetReadableId }` (row ids plus readable numbers), with `id`/`transferId` null for an `attachJob` that found no WIP; zero-value transfers skip the journal (the line builders refuse a zero cost) but still move the unit and the asset.
- Task 29: `getFixedAssetClassesList` does not select `isConstructionInProgress`, so the capitalize loader reads the classes it needs directly (non-CIP, the class named Rental Fleet preselected); the fleet status badge lives in its own `FleetStatus.tsx` beside the table; `path.ts` and the sidebar Fleet entry were written ahead of the two parallel subagents so neither edited a shared file; the capital-cost panel on a work center shows a dash for assets without a straight-line monthly amount and sums only those that have one.
- Task 18 (browser, evidence in `.ai/runs/2026-09-22-revenue-recognition-and-rentals.md`): checks 1, 2, 4 pass; 3 and 5 partial. The plan's "six rows of 200.00" was wrong: spec §1 prorates a dated line by days and `spreadStraightLine` does (204.40 / 197.80 / 204.40 / 204.40 / 184.62 / 204.40, Σ 1,200.00), so the schedule is correct as built. `post-sales-invoice` re-stamps `postingDate`/`dateIssued` to today (pre-existing), so a back- or forward-dated invoice cannot be posted as dated from the UI. Closing October was blocked by four seeded Draft documents (environment, not a defect); Lock was exercised and posting into a Locked period works. Follow-ups fixed right after: the runs page had no period-end picker and `getNextPeriodEnd` used JS `Date`; the run page's Source column showed a raw line id; the close task had no "What this task means" text. The observation that `salesInvoice.subtotal`/`totalAmount` read 0 after posting is not a defect: those header columns are legacy (set once at creation), and invoice totals are computed in the `salesInvoices` view since migration `20260604120000`, where both invoices read 500 and 1,200.
- Task 30: two more stale statements outside the plan's file list said a work center and an asset are never linked (`docs/content/docs/reference/work-centers.mdx`, `docs/content/guides/fixed-assets-acquire.mdx`); both corrected in the same commit, and the agent knowledge base (`kb/`) regenerated per `.claude/rules/agent-knowledge-base.md`.
- Task 33: no view selects `payment.*`, so nothing had to be recreated for the two deposit columns; `rentalBillingPeriod` carries the full audit set per the conventions; the tables file was validated in a rolled-back transaction before `crbn migrate` applied it. Environment: a Docker Desktop restart recreated the Postgres volume between Phase B checks (b) and (c), so the dev company was re-seeded with a new id and every Phase A/B test record was lost; Phase A evidence stands as committed, Phase B (c)–(f) reran on the fresh company.
- Task 35 (+ a Task 22 gap): the dev bootstrap (`packages/database/src/datasets/bootstrap.ts`) inserts the seeded asset classes without `isConstructionInProgress`, so a company seeded by `crbn up`/`db:seed:dev` got a Construction in Progress class that was not flagged (the onboarding edge function was already correct). Fixed alongside the RA sequence seed; the re-seeded dev company was patched by hand (class flag + RA sequence row).
- Task 37: `createRentalInvoicesForDuePeriods` bills charges dated on or before `asOf` (not every unbilled charge — a future-dated charge waits for its date) and selects DATE columns as `::text` (pg decodes DATE to a JS `Date`, lesson on journal sync). `getItemRentalRate` takes the currency (the table is unique per item AND currency). Both invoice delete routes now go through Kysely transactions in `sales.server.ts` (`deleteSalesInvoiceReleasingRentals` / `deleteSalesInvoiceLineReleasingRentals`) so the release and the delete commit together. Follow-up: the MCP tools `invoicing_deleteSalesInvoice` / `invoicing_deleteSalesInvoiceLine` still call the plain service functions and would leave rental stamps behind.
- Task 38: cancel deletes the agreement's Pending lines (and their unbilled charges) so the unit is freed — the line status enum has no Cancelled — and refuses when a charge was billed, a line is Sold, or any recognition row exists; close also refuses unbilled charges (generation only bills Active agreements). A Draft line is already `Pending`, so a Draft agreement shows its units as Reserved and the live-line unique index keeps two drafts from naming one unit; activation treats "Reserved by this same agreement" as available and also requires the asset to be Active / Fully Depreciated. Periods run from the agreement start (plan), not the line's delivery date (spec). Gap closed alongside: nothing rolled an open-ended or held-over line's periods forward after activation — `createRentalInvoicesForDuePeriods` now cuts every live line's missing periods up to `billingHorizon(asOf)` (moved to `shared/rental-billing.ts`, re-exported as `activationThrough`) before billing.
- Task 40: an Accrual row's `periodStart`/`periodEnd` is the accrued SLICE (billing period ∩ month ∩ `[deliveredAt, returnedAt]`), so it sits inside exactly one billing period and two months never share a key; amounts use cumulative rounding from the period's first day so a period's slices sum exactly. A period accrues while no POSTED invoice covers it — `Pending`, or `Invoiced` onto a Draft/Pending invoice — because the daily job drafts an Arrears period on its last day, before the month-end run; Advance and Arrears alike. A transaction advisory lock serializes concurrent proposals. Task 12 had NOT handled rental rows at posting: `postRevenueRecognitionRun` (`accounting.server.ts`) now resolves `documentType 'Rental Agreement'` / `documentId` and the Customer, Item and Location dimensions from the agreement for Accrual and Interest rows. `$runId.post.tsx` needed no change. Known limit: the close check reads rental rows with the user's client, so an accountant without sales view sees no rental rows.
- Task 39: `revenueLegs` is a list (a positive Rent line needs Contract Assets then Deferred Revenue; the last leg takes the remainder). A positive Rent line consumes unbilled Accrual rows whether Planned or Posted — an Arrears invoice usually posts before its month's run, and a Planned accrual that posts later debits the contract asset the invoice credited, so it nets to zero either way; only the unaccrued days are deferred. An early-return credit writes NEGATIVE Deferral rows (latest month first) rather than shrinking the original rows, so voiding the credit just deletes them; any part already recognized debits Rental Income. Decisions live in the pure `post-sales-invoice/rental-posting.ts` (tested). Follow-ups: rental revenue legs carry `documentType 'Rental Agreement'`, so readers that select an invoice's journal lines by invoice document type (provider sync, Task 45) miss them; voiding an original rent invoice after its early-return credit posted leaves the credit's negative rows reducing Rental Income; intercompany elimination does not know the rental accounts (same as Task 10).
- Task 43: the agreement page is one scrolling page (header, Units, Charges, Billing Periods, Deposits, terms form, modal outlet) like the fixed-asset page rather than explorer/properties panels; `$id.details.tsx` only receives the terms save. Deliver is per line (`$id.$lineId.deliver.tsx`). Terms and units are editable only while Draft. "Generate invoices" needs `update: sales` AND `create: invoicing` (it drafts invoices over Kysely). The part Sales tab shows the rate ladder only for serial-tracked parts, base currency only. A Rental invoice line renders read-only (`SalesInvoiceLineForm`), and `salesInvoiceLineValidator` accepts `Rental` without offering it as a choice. Not done: the Activate modal lists no units (Task 51/54 adds the sales-type preview); no classification override UI (Task 54).
- Task 50: `presentValue` also returns `pvRent` (the rent stream alone). The plan's pin "pvPayments 32,871.02" contradicted its own classification pin (97.5 % of 38,000 needs 37,049.24) and spec §4 (PVpay includes a reasonably certain option), so `pvPayments` includes the option and `pvRent` carries 32,871.02. Amounts round at internal scale (5 decimals); the plan's cent figures agree at the cent (185.2462 → 185.25, 36,234.48703 → 36,234.49). An open-ended agreement classifies Operating even when a test is met (spec: Sales-Type requires an end date); its test booleans are still returned. Built ahead of Tasks 47–49 (Deno-only, no schema dependency) because the local stack is down.
- Task 45: `apps/erp/app/modules/invoicing/AGENTS.md` does not exist, so the invoicing facts (Rental lines, `payment.rentalAgreementId` / `salesOrderId`, `CUSTOMER_DEPOSIT_DESCRIPTION`) went into the sales and accounting AGENTS. A `rentalAgreement` map was added to `packages/utils/src/status-colors.ts` so the docs StatusFlow renders colours. Provider handling of Rental lines is read from code only (Xero → Sales account, QBO without an item ref, Rillet refuses as a warning) and marked UNVERIFIED in `accounting-sync-handlers.md`. Gaps found while writing and fixed in the same pass: the out-of-service route took an On Rent unit out of service (now refused, `getOnRentLineForAsset`), the fleet register offered Return to Inventory / Take Out of Service on rented units (now hidden), and the Deliver confirmation said billing starts on delivery. Still open: activation does not check `revenueRecognitionEnabled`.
- Tasks 47–49: the local stack was recreated (`crbn up --no-apps` on a fresh volume; smoke user test@carbon.ms, no demo company yet). `20260923051441_lease-enum.sql` was created while that boot's migrate step was running and was recorded as applied with no statements, so `'Lease'` was re-applied with psql (lesson added). `rentalAgreement` is registered as an audit entity (root + `rentalAgreementLine` child) — an additive `audit.config.ts` change the plan calls for, so a Task 51 classification override can be audit-logged. `'Lease'` joins `POSTING_POLICY` (`defaultEnabled: false`), the hand-written `journalEntrySourceTypes` array, and the source-type icon switch (`LuKeyRound`).
- Task 52: a Sales-Type Rent / Purchase Option line credits Net Investment in Leases in full (no schedule rows, no accrual consumption); a negative Rent line on a Sales-Type lease is refused; the Net Investment account is only required when the invoice has a Sales-Type line. Posting a Purchase Option line flips its line to `Sold` only when it is a Sales-Type line `On Rent` (stricter than the plan — otherwise a company with accounting off could mark an operating unit Sold), in the posting transaction and regardless of accounting; VOID reverts it to `On Rent` while still `Sold`. `postRevenueRecognitionRun` stamps `rentalLeaseScheduleLine.journalId/postedAt` for posted Interest rows (no unpost path exists to mirror). Follow-up: voiding a purchase-option invoice after the agreement is Closed returns the line to On Rent on a Closed agreement.
- Task 51 (edge) + Task 53 (edge `return`): pure decisions live in `post-rental-agreement/lessor.ts` (tested). A 28 Days lease values whole 28-day periods at a per-period rate of annual × 28/365 (passed to `presentValue` as `annualRate × 12 × 28/365`, stored as `classificationInputs.annualRate`); a mid-month Calendar Month start has one more billing period than schedule periods, and the schedule follows the first N. `pv.netInvestment` is stored as `round(pvPayments) + round(pvResidual)` so the commencement journal balances exactly. Commencement is fleet-only (activation already refuses a line without a fleet unit); Interest rows are written only when accounting is on (no commencement journal otherwise). A sales-type return before `endDate` is refused ("Early termination of a sales-type lease is a manual journal"), as is a return while a Draft run holds the lease's Interest rows; `residualDestination` Fleet → the "Rental Fleet" class (else the class the unit left), Inventory → the item's inventory account, out-of-service refused with Inventory. Cancel refuses a commenced sales-type line. Known gaps: a commenced unit's asset is Disposed, so the fleet register reads Sold while it is on lease; the return's closing NI comes from the schedule, so a posted final invoice with an unposted last interest month leaves the ledger and the schedule a month apart. Holdover is closed off: `rollBillingPeriodsForward` only rolls Operating (or unclassified) lines, so a sales-type line never bills past its term.
- Tasks 51 (override) / 53 (sell, return form) / 54: the override audit entry is `entityType "rentalAgreement"` (the registered entity) with `tableName "rentalAgreementLine"`, a `{ old, new }` diff (the audit types have no free `metadata.reason`, so the reason is a `classificationOverrideReason` diff entry), written with the service role because an accountant may lack the sales update RLS needs. Sell needs `create: ["sales","invoicing"]` + `update: "sales"` (the charge insert and the invoice draft). The lease payment terms and `classifyRentalLine` moved from `post-rental-agreement/lessor.ts` into `shared/lessor-lease.ts` (re-exported through @carbon/utils) so the Draft classification preview in `sales.utils.ts` and the record activation stores come from one function — the first cut had copied them into the app. The Activate confirmation previews the commencement journal (NBV read in the `$id.tsx` loader, accounting view only — a sales-only user sees the NI/revenue legs with a note). The net investment report lists live Sales-Type lines as of a date (Sold lines drop out); it reads `rentalAgreementLine`, so it needs sales view.
- Task 55: docs describe the built behaviour; the reference page is ~2,900 words (about double the style budget) — the sales-type part could split to its own page. `accounting-sync-handlers.md` now states that journal types shipped off by default are enabled per type. The docs agent found that Sell to Customer did not check the end date (the remaining rent kept billing after the unit was sold); fixed in the same pass — exercise is refused before `endDate`.
- Self-review (Task 56, code part): the two composite pointer FKs `payment_rentalAgreementId_fkey` and `revenueRecognitionSchedule_rentalLeaseScheduleLineId_fkey` had a bare `ON DELETE SET NULL`, which also nulls `companyId` (lesson on composite SET NULL) — deleting a Draft agreement holding a deposit failed. `20260923122421_rental-fk-set-null-column.sql` names the pointer column; proven with a rolled-back delete.
- Self-review fixes (Task 56, code part): invoice line delete now requires the line to be on the URL's invoice and that invoice to be Draft (in the transaction, `FOR UPDATE`); a charge's kind is server-side only (`rentalAgreementChargeValidator` has no `kind`; the Purchase Option insert is the server-only `insertRentalPurchaseOptionCharge`, invisible to the MCP scanner); the Draft-only guards live in the service writers too, and the rental agreement / line / charge writers pick their fields instead of spreading input (an MCP call could otherwise set `status` and skip activation); the out-of-service and deliver availability reads use the service role so a missing permission cannot fail them open; no billing period is cut past a sales-type lease's end date (activation caps at it, return does not re-cut); a sales-type return closes on the lease schedule and keeps interest rows dated on or before the return; future-dated returns are refused; a sales-type lease must run whole billing periods (shared `salesTypeRequirementError`, shown in the Activate preview); exercising a purchase option settles the line's remaining net investment (shortfall → COGS, excess → lease revenue).
- Task 46 (browser, evidence in `.ai/runs/2026-09-22-revenue-recognition-and-rentals.md`): scenarios re-based to September 2026 (future-dated returns are refused and Deliver stamps today). All accounting checks pass — Calendar Month advance 800.00 (16/30 × 1,500) deferral → run; arrears accrual → invoice consumes it; mileage charge; deposit 3,000 → apply 500 → refund 2,500 (2110 nets 0); 28-day best-rate returns 300 / 1,000 / 1,500 / 2,000; early-return −1,200; holdover; out-of-service return; return-to-inventory refusal; close task; utilization; the line-delete and deposit-FK fixes. Four defects found and fixed in the same pass: agreement create/edit failed (the explicit field list sent `exchangeRate: null` into a NOT NULL DEFAULT column — regression from the self-review fix); reloading `/details` hit a component-less route; the Return form never posted for an operating unit (`isSalesType=""` fails `zfd.checkbox`); a re-cut Arrears period kept its old `dueOn` (`RecutPeriod` now carries it). Not run: the next period's proposal on Oct 1 (date-bound). Environment residue in the dev company: a Draft deposit PAY-…-000004 with no agreement, four blank-serial VEH-100 units in stock.
- Task 56 (browser, evidence in `.ai/runs/2026-09-22-revenue-recognition-and-rentals.md`): all runnable checks pass — scenario A (36 × 1,000 arrears, 6 %, option 5,000 certain, fair value 38,000; started 2026-08-01 so month 1 is due): commencement Dr 1160 37,049.24 / Dr 5010 30,000 / Cr 4070 37,049.24 / Cr 1370 30,000, selling profit 7,049.24, 36 schedule lines (185.25 / 814.75 / 36,234.49 … 5,000.00), month-1 invoice Cr 1160 1,000, run posts 185.25 interest, report ties to 1160; scenario B (three 11-month leases ended 2026-08-31): sell to customer with shortfall and excess settlements (1160 nets 0, line Sold), return to fleet and to inventory; classification rules, whole-period refusal, override with audit; the Phase C UI fixes re-confirmed. Fixed from the pass: an Advance lease closing on zero wrote a −0.00001 Interest row (one-unit drift now gets no row); the override's audit comment/doc claimed the entry needs the audit log on (it is always written); the Close dialog now says "returned or sold". Not run: months 2–36 / end-of-term sale of scenario A (date-bound); a non-zero accumulated-depreciation commencement leg (a seeded Draft depreciation run DR000001 blocks depreciation in the dev company). Return to inventory debits the item's own inventory account (1210 for a Buy item), not always Finished Goods as the spec text says.
- Task 31 (browser, re-run on the recreated stack; evidence appended to `.ai/runs/2026-09-22-revenue-recognition-and-rentals.md`): (c) CIP postings pass — attach job Dr 1390 / Cr 1230 170, completion sweep 85, PO receipt cost row 6,000, capitalize into Machinery & Equipment Dr 1350 / Cr 1390 6,255, the in-service month's run charges 52.13; (e) out of service passes, including the On Rent refusal; (f) return to inventory Dr 1210 41,440 / Dr 1380 560 / Cr 1370 42,000 passes. Fixed from the pass: editing an asset dropped its work center (the details action's field list omitted `workCenterId`); an Under Construction asset could not be purchased (the PO / purchase invoice asset pickers and the Purchase action were Draft-only, though posting already adds CIP cost rows for it). Follow-up, fixed afterwards: a serial returned to stock was costed FIFO when later sold (`shared/calculate-cogs.ts` took the oldest layers, not the shipped serial's). `costLedger.trackedEntityId` (migration `20261006220601`) now stamps the layer `bookAdjustment` books for a serial unit, and `calculateCOGS` relieves the leaving unit's own layer first (`shared/cost-layer-order.ts`); callers pass the serial ids from `bookAdjustment`, `post-shipment` and `issue`. Receipt and job-output layers stay unstamped (many units per layer). A docs audit after that found the Net Investment in Leases report never counted the principal of a schedule line with no Interest row (a 0 % lease, the last line of an Advance lease closing on zero, which the drift fix no longer writes a row for), so it overstated 1160; `earnsInterest` (`shared/lessor-lease.ts`) is now the one rule for both `interestRows` and the report, which counts such a line once its date passes.

### Progress
- [x] Task 1: Rebase onto main and prove the baseline is green
- [x] Task 2: Migration — revenue recognition enums
- [x] Task 3: Migration — revenue recognition core (tables, defaults, settings, service dates, seeds, close task)
- [x] Task 4: Apply migrations and regenerate types
- [x] Task 5: Seeds for new companies (accounts, defaults, sequence, close task)
- [x] Task 6: `spreadStraightLine` — shared straight-line schedule math + tests
- [x] Task 7: Six new account-default mappings (validator, form, glossary)
- [x] Task 8: `revenueRecognitionEnabled` company setting toggle
- [x] Task 9: Service dates on sales order and sales invoice lines
- [x] Task 10: `post-sales-invoice` deferral branch + VOID guard
- [x] Task 11: Run/schedule validators and read services
- [x] Task 12: Run proposal builder (`@carbon/database/revenue-recognition`) + posting/deletion in `accounting.server.ts`
- [x] Task 13: Recognition run routes, UI, paths, sidebar
- [x] Task 14: Close-checklist evaluator `unposted-revenue-schedules`
- [x] Task 15: Inngest monthly run proposal
- [x] Task 16: `POSTING_POLICY` entry for `'Revenue Recognition'`
- [x] Task 17: Deferred revenue waterfall report
- [x] Task 18: Phase A browser verification
- [x] Task 19: Migration — asset transfer enums
- [x] Task 20: Migration — fleet bridge (asset columns, job targets, transfer + CIP ledger, accounts, classes, view)
- [x] Task 21: Apply migrations, regenerate types, `POSTING_POLICY` `'Asset Transfer'`
- [x] Task 22: Seeds for new companies (PP&E accounts, two classes, sequence)
- [x] Task 23: Shared asset-transfer line builders + safe document types
- [x] Task 24: Edge function `post-asset-transfer`
- [x] Task 25: `complete_job_to_inventory` job→asset branch + SQL test
- [x] Task 26: CIP awareness in `post-receipt` / `post-purchase-invoice`
- [x] Task 27: Job target (model, form, complete dialog, release gate)
- [x] Task 28: Fleet validators/services; CIP-class registration; status badge
- [x] Task 29: Fleet routes and UI (capitalize, return, attach job, capitalize CIP, out of service, register, work-center panel)
- [x] Task 30: Phase B docs, rules, AGENTS
- [x] Task 31: Phase B browser verification
- [x] Task 32: Migration — rental enums
- [x] Task 33: Migration — rental tables, invoice/payment columns, view, sequence, lease settings
- [x] Task 34: Apply migrations and regenerate types
- [x] Task 35: Seeds for new companies (rental sequence)
- [x] Task 36: Shared rental billing math (`bestRateCharge`, `generateRentalBillingPeriods`) + validators
- [x] Task 37: Rental CRUD services + invoice generation (`@carbon/database/rental-billing`)
- [x] Task 38: Edge function `post-rental-agreement`
- [x] Task 39: `post-sales-invoice` `Rental` case + VOID
- [x] Task 40: Accrual synthesis in the run + evaluator extension
- [x] Task 41: Customer deposits in `post-payment`
- [x] Task 42: Inngest daily rental billing
- [x] Task 43: Rental agreement routes and UI, item rate ladder, invoice line display
- [x] Task 44: Utilization report
- [x] Task 45: Phase C docs, rules, AGENTS
- [x] Task 46: Phase C browser verification
- [x] Task 47: Migration — `'Lease'` source type
- [x] Task 48: Migration — lessor schedule table
- [x] Task 49: Apply migrations, regenerate types, `POSTING_POLICY` `'Lease'`, audit config
- [x] Task 50: Shared lessor math (`presentValue`, `classifyLessorLease`, `buildLessorSchedule`) + tests
- [x] Task 51: Activation classification + commencement posting + override route
- [x] Task 52: `post-sales-invoice` sales-type legs; run stamps schedule lines
- [x] Task 53: End of term — purchase option and residual return
- [x] Task 54: Net investment report, classification UI, lease policy settings
- [x] Task 55: Phase D docs, rules, AGENTS
- [x] Task 56: Self-review and Phase D browser verification

### Dependencies
- Task 1 first. Phase A (2–18) and Phase B (19–31) are independent of each other after Task 1; run them as two parallel tracks if desired.
- Within A: 2 → 3 → 4 → {5, 7, 8, 9, 11} parallel-safe; 6 independent (Deno only); 10 needs 4 + 6 + 9; 12 needs 4 + 11; 13 needs 12; 14 needs 4; 15 needs 12; 16 needs 4; 17 needs 11; 18 last.
- Within B: 19 → 20 → 21 → {22, 23, 26, 27, 28} parallel-safe; 24 needs 23; 25 needs 21; 29 needs 24 + 25 + 28; 30 after 29; 31 last.
- Phase C (32–46) needs Tasks 13 and 29. 32 → 33 → 34 → {35, 36} ; 37 needs 34 + 36; 38 needs 37; 39 needs 38 + 10; 40 needs 12 + 38; 41 needs 34; 42 needs 37; 43 needs 38 + 39 + 41; 44 needs 40; 45, 46 last.
- Phase D (47–56) needs Phase C. 47 → 48 → 49 → 50 → 51 → {52, 53, 54} ; 55, 56 last.

Verification commands used throughout (never a whole-repo typecheck):

```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec turbo run typecheck --filter=@carbon/database
pnpm exec turbo run typecheck --filter=@carbon/jobs
pnpm exec turbo run typecheck --filter=@carbon/ee
pnpm exec turbo run typecheck --filter=@carbon/utils
pnpm run lint
pnpm --filter erp test <path>                                   # vitest, apps/erp
(cd packages/database/supabase/functions && deno task test <file>)   # Deno pure tests
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/<file>.test.sql   # SQL tests, always roll back
```

---

## Phase A — Recognition core

### Task 1: Rebase onto main and prove the baseline is green

**Depends on:** none
**Files:**
- Modify: nothing (git + generated types only)

**Steps:**
1. `git fetch origin && git rebase origin/main` (the branch is behind; `origin/main` carries `20260922050131_mark-complete-completes-remaining-quantities.sql`, which redefines `complete_job_to_inventory` — Task 25 forks from whatever is newest at that moment).
2. `pnpm install`.
3. `pnpm db:migrate` then `pnpm run generate:types`.
4. `git status` must show no changes other than possibly `packages/database/src/types.ts` (commit it if it changed: `git commit -am "chore: regenerate types after rebase"`).

**Verify:**
```bash
git log --oneline -1 origin/main && git merge-base --is-ancestor origin/main HEAD && echo "rebased"
pnpm exec turbo run typecheck --filter=erp
# Expected: "rebased"; typecheck exits 0
```

**Out of scope:** any code change.

### Task 2: Migration — revenue recognition enums

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_revenue-recognition-enums.sql` via `pnpm db:migrate:new revenue-recognition-enums`
- Copy from (precedent): `packages/database/supabase/migrations/20260524143826_fixed-asset-enums.sql` (ADD VALUE in its own file)

**Steps:**
1. `pnpm db:migrate:new revenue-recognition-enums` (never hand-pick the timestamp; HHMMSS must not be `000000`).
2. File contents, exactly:
```sql
-- Enum additions live alone: ADD VALUE cannot be used in the same transaction as the value.
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Revenue Recognition';

DO $rvenums$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'revenueScheduleType') THEN
    CREATE TYPE "revenueScheduleType" AS ENUM ('Deferral', 'Accrual', 'Interest');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'revenueScheduleStatus') THEN
    CREATE TYPE "revenueScheduleStatus" AS ENUM ('Planned', 'Posted');
  END IF;
END $rvenums$;
```

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -1
# Expected: <ts>_revenue-recognition-enums.sql, ts newer than every file on origin/main and HHMMSS != 000000
```

**Out of scope:** tables (Task 3).

### Task 3: Migration — revenue recognition core

**Depends on:** 2
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_revenue-recognition-core.sql` via `pnpm db:migrate:new revenue-recognition-core`
- Copy from (precedent): `20260908021155_accounting_posting_corrections.sql` (account insert per group + `accountDefault` backfill + `DO $tag$` constraint guards), `20260908142501_returns-module.sql:93-131,431-452` (table + RLS shape), `20260712142905_reconcile-period-close-definitions.sql:187-203` (close task seed)

**Steps:**
1. Confirm the four group-account names by reading `packages/database/supabase/functions/lib/seed.data.ts` rows with `key: "receivables"`, `key: "revenue"`, `key: "other-income"`, `key: "ppe"` (the `ppe` row is `name: "Property, Plant & Equipment"`). Use the exact `name` strings below where `<Receivables>`, `<Revenue>`, `<Other Income>` appear. If a key does not exist, STOP and report.
2. Settings + defaults:
```sql
ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS "revenueRecognitionEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "deferredRevenueAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "contractAssetAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalIncomeAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseRevenueAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseInterestIncomeAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "netInvestmentInLeasesAccount" TEXT;
```
   then one `DO $rrfk$ ... $rrfk$` block adding, for each of the six columns, `FOREIGN KEY (...) REFERENCES "account"(id) ON DELETE RESTRICT ON UPDATE CASCADE` named `accountDefault_<column>_fkey`, each guarded by `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"accountDefault"'::regclass AND conname = '...')` (copy the shape of `20260908021155` lines 45–60).
3. New accounts, one per company group, idempotent (repeat this statement for each row of the table; `<group name>` per step 1):

| number | name | class | accountType | incomeBalance | consolidatedRate | parent group |
|---|---|---|---|---|---|---|
| 1145 | Contract Assets | Asset | Other Current Asset | Balance Sheet | Current | `<Receivables>` |
| 1160 | Net Investment in Leases | Asset | Other Current Asset | Balance Sheet | Current | `<Receivables>` |
| 4060 | Rental Income | Revenue | Income | Income Statement | Average | `<Revenue>` |
| 4070 | Lease Revenue | Revenue | Income | Income Statement | Average | `<Revenue>` |
| 4150 | Interest Income – Leases | Revenue | Other Income | Income Statement | Average | `<Other Income>` |

```sql
INSERT INTO "account" ("id","number","name","class","accountType","incomeBalance","consolidatedRate","parentId","isGroup","active","isSystem","companyGroupId","createdBy")
SELECT id(), '1145', 'Contract Assets', 'Asset', 'Other Current Asset', 'Balance Sheet', 'Current', g.id, false, true, false, g."companyGroupId", 'system'
FROM "account" g
WHERE g."isGroup" = TRUE AND g.name = '<Receivables>'
  AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."companyGroupId" = g."companyGroupId" AND a.number = '1145');
```
   After the five inserts, a guard: `DO $rrguard$ BEGIN IF EXISTS (SELECT 1 FROM "company" c WHERE NOT EXISTS (SELECT 1 FROM "account" a WHERE a."companyGroupId" = c."companyGroupId" AND a.number = '1145')) THEN RAISE EXCEPTION 'revenue-recognition-core: a company group has no Receivables group account'; END IF; END $rrguard$;` (lesson: never insert silently orphaned accounts). If `account.id` already has a DEFAULT, `id()` in the SELECT is still correct.
4. Backfill the six defaults by id (2160 already exists; repeat per column/number pair 2160→deferredRevenueAccount, 1145→contractAssetAccount, 4060→rentalIncomeAccount, 4070→leaseRevenueAccount, 4150→leaseInterestIncomeAccount, 1160→netInvestmentInLeasesAccount):
```sql
UPDATE "accountDefault" ad SET "deferredRevenueAccount" = a.id, "updatedBy" = 'system'
FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a.number = '2160'
WHERE ad."companyId" = c.id AND ad."deferredRevenueAccount" IS NULL;
```
5. Sequence per company:
```sql
INSERT INTO "sequence" ("table","name","prefix","suffix","next","size","step","companyId")
SELECT 'revenueRecognitionRun', 'Revenue Recognition Run', 'RR', NULL, 0, 6, 1, c.id FROM "company" c
WHERE NOT EXISTS (SELECT 1 FROM "sequence" s WHERE s."companyId" = c.id AND s."table" = 'revenueRecognitionRun');
```
6. Close task definition per company (copy `20260712142905` lines 187–203 with this single VALUES row): `('Recognize revenue for the period', 'Auto', 'unposted-revenue-schedules', 5, true, 'Warning')`, guarded by `AND NOT EXISTS (SELECT 1 FROM "periodCloseTaskDefinition" d WHERE d."companyId" = c.id AND d.name = 'Recognize revenue for the period')` and `WHERE EXISTS (SELECT 1 FROM "user" u WHERE u.id = 'system')`.
7. Service dates:
```sql
ALTER TABLE "salesOrderLine" ADD COLUMN IF NOT EXISTS "serviceStartDate" DATE, ADD COLUMN IF NOT EXISTS "serviceEndDate" DATE;
ALTER TABLE "salesInvoiceLine" ADD COLUMN IF NOT EXISTS "serviceStartDate" DATE, ADD COLUMN IF NOT EXISTS "serviceEndDate" DATE;
```
   plus a `DO` guard adding `CHECK (("serviceStartDate" IS NULL) = ("serviceEndDate" IS NULL) AND ("serviceEndDate" IS NULL OR "serviceEndDate" >= "serviceStartDate"))` named `salesOrderLine_serviceDates_check` / `salesInvoiceLine_serviceDates_check`.
8. Recreate the two `t.*` views (lesson: `CREATE OR REPLACE` cannot reorder columns). Find the newest definition of each: `grep -l 'VIEW "salesInvoiceLines"' packages/database/supabase/migrations/*.sql | sort | tail -1` (as of writing `20260524143827_fixed-assets.sql:685-710`) and the same for `"salesOrderLines"`. Write `DROP VIEW IF EXISTS "salesInvoiceLines"; CREATE VIEW "salesInvoiceLines" WITH(SECURITY_INVOKER=true) AS (<body copied verbatim>);` and likewise for `salesOrderLines`. Before dropping, `grep -l 'FROM "salesInvoiceLines"\|JOIN "salesInvoiceLines"' migrations/*.sql` — if any other view depends on it, recreate that dependent view too (precedent `20260417000300_storage-unit-recreate-dependents.sql`).
9. Tables (each followed by `CREATE INDEX IF NOT EXISTS` on `companyId` and every FK, then RLS with the four `DROP POLICY IF EXISTS` + `CREATE POLICY` statements gated `accounting_view` for SELECT and `accounting_create/update/delete` for writes, schema-qualified, `::text[]` cast):
```sql
CREATE TABLE IF NOT EXISTS "revenueRecognitionSchedule" (
  "id" TEXT NOT NULL DEFAULT id('rvsc'),
  "companyId" TEXT NOT NULL,
  "type" "revenueScheduleType" NOT NULL,
  "status" "revenueScheduleStatus" NOT NULL DEFAULT 'Planned',
  "salesInvoiceLineId" TEXT,
  "rentalAgreementLineId" TEXT,
  "rentalLeaseScheduleLineId" TEXT,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "scheduledDate" DATE NOT NULL,
  "accountingPeriodId" TEXT REFERENCES "accountingPeriod"("id"),
  "amount" NUMERIC NOT NULL,
  "debitAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "creditAccountId" TEXT NOT NULL REFERENCES "account"("id"),
  "runLineId" TEXT,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "billedBySalesInvoiceLineId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "revenueRecognitionSchedule_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueRecognitionSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_due_idx" ON "revenueRecognitionSchedule" ("companyId", "status", "scheduledDate");
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_invoiceLine_idx" ON "revenueRecognitionSchedule" ("companyId", "salesInvoiceLineId");

CREATE TABLE IF NOT EXISTS "revenueRecognitionRun" (
  "id" TEXT NOT NULL DEFAULT id('rvrn'),
  "companyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft', 'Posted')),
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "revenueRecognitionRun_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueRecognitionRun_runId_companyId_key" UNIQUE ("runId", "companyId"),
  CONSTRAINT "revenueRecognitionRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "revenueRecognitionRunLine" (
  "id" TEXT NOT NULL DEFAULT id('rvrl'),
  "companyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "revenueRecognitionRunLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "revenueRecognitionRunLine_run_fkey" FOREIGN KEY ("runId", "companyId") REFERENCES "revenueRecognitionRun"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "revenueRecognitionRunLine_schedule_fkey" FOREIGN KEY ("scheduleId", "companyId") REFERENCES "revenueRecognitionSchedule"("id", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "revenueRecognitionRunLine_schedule_key" UNIQUE ("companyId", "scheduleId")
);
```
10. End the file with `NOTIFY pgrst, 'reload schema';`.

**Verify:**
```bash
pnpm db:migrate
# Expected: applies both new files with no error; running `pnpm db:migrate` a second time is a no-op
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -c "SELECT count(*) FROM \"account\" WHERE number IN ('1145','1160','4060','4070','4150')"
# Expected: 5 × (number of company groups)
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -c "SELECT count(*) FROM \"accountDefault\" WHERE \"deferredRevenueAccount\" IS NULL"
# Expected: 0
```

**Out of scope:** rental, fleet, lease tables (Phases B–D).

### Task 4: Apply migrations and regenerate types

**Depends on:** 3
**Files:**
- Modify: `packages/database/src/types.ts` (generated — never hand-edit)

**Steps:**
1. `pnpm db:migrate && pnpm run generate:types`.
2. `git diff --stat packages/database/src/types.ts` must show additions for `revenueRecognitionSchedule`, `revenueRecognitionRun`, `revenueRecognitionRunLine`, the six `accountDefault` columns, `revenueRecognitionEnabled`, the two service-date columns, and the enum values.

**Verify:**
```bash
grep -c "revenueRecognitionSchedule\|revenueScheduleType\|deferredRevenueAccount" packages/database/src/types.ts
# Expected: > 0
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** app code.

### Task 5: Seeds for new companies

**Depends on:** 4 (parallel-safe with 7, 8, 9, 11)
**Files:**
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` — `accounts` (near line 675 for 1145/1160 with `parentKey: "receivables"`, near line 749 for 4060/4070 with `parentKey: "revenue"`, near line 757 for 4150 with `parentKey: "other-income"`), `accountDefaults` map (line 811: add the six keys → numbers), `sequences` (line 233: add `{ table: "revenueRecognitionRun", name: "Revenue Recognition Run", prefix: "RR", suffix: null, next: 0, size: 6, step: 1 }`), `periodCloseTaskDefinitions` (line 921: add the row with `sortOrder: 5`, `severity: "Warning"`, `taskType: "Auto"`, `autoCheckKey: "unposted-revenue-schedules"`, `required: true`, `active: true`, `isSystem: true`)
- Copy from (precedent): the existing rows in each array

**Steps:**
1. Add the rows above. Account rows copy the exact object shape of line 675 (`key`, `number`, `name`, `isGroup: false`, `parentKey`, `accountType`, `incomeBalance`, `class`, `consolidatedRate: "Current"|"Average"`, `createdBy: "system"`).
2. `seed-company/index.ts` resolves `accountDefaults` keys automatically (lines 413–416) and inserts sequences/definitions from the arrays — no change needed there. Confirm by reading those lines; if the resolver enumerates keys explicitly, STOP and report.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all datasets apply (exit 0)
(cd packages/database/supabase/functions && deno task test seed-company/shipping-default.test.ts)
# Expected: ok
```

**Out of scope:** existing companies (Task 3 handled them).

### Task 6: `spreadStraightLine` — shared straight-line schedule math

**Depends on:** 1 (Deno only; parallel-safe)
**Files:**
- Create: `packages/database/supabase/functions/shared/revenue-schedule.ts`
- Create: `packages/database/supabase/functions/shared/revenue-schedule.test.ts`
- Create: `packages/utils/src/revenue-schedule.ts` (re-export) and export it from `packages/utils/src/index.ts`
- Copy from (precedent): `packages/database/supabase/functions/shared/precision.ts` + `packages/utils/src/math.ts` (the cross-package re-export line), `shared/precision.test.ts` (Deno test style)

**Steps:**
1. Implement, with no imports other than `./precision.ts` and no JS `Date`:
```ts
export type ScheduleRow = { periodStart: string; periodEnd: string; scheduledDate: string; amount: number };
export function daysInMonth(year: number, month: number): number;      // month 1–12, Gregorian leap rule
export function monthEnd(date: string): string;                        // "YYYY-MM-DD" → last day of that month
export function daysBetweenInclusive(start: string, end: string): number;
export function spreadStraightLine(args: { amount: number; startDate: string; endDate: string }): ScheduleRow[];
```
   `spreadStraightLine` cuts `[startDate, endDate]` at calendar-month boundaries, weights each cut by its inclusive day count, rounds with `round()` from `./precision.ts` and forces Σ rows = `amount` with `distributeRoundingResidual` (last row absorbs). `scheduledDate = periodEnd` of each cut. Throws if `endDate < startDate` or `amount` is not finite.
2. Tests (Deno, `assertEquals`): 1,200.00 over 2026-10-01→2027-03-31 → six rows of 200.00 dated 2026-10-31 … 2027-03-31; 1,500.00 over 2026-10-15→2026-10-31 → one row 1,500.00; 1,500.00 over 2026-10-15→2026-11-14 → 822.58 (17 days) + 677.42 (14 days), Σ = 1,500.00; leap year 2028-02.
3. `packages/utils/src/revenue-schedule.ts`: `export * from "../../database/supabase/functions/shared/revenue-schedule.ts";` using the exact relative path style `packages/utils/src/math.ts` uses; add `export * from "./revenue-schedule";` to `packages/utils/src/index.ts`.

**Verify:**
```bash
(cd packages/database/supabase/functions && deno task test shared/revenue-schedule.test.ts)
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: exit 0
```

**Out of scope:** rental billing math (Task 36).

### Task 7: Six new account-default mappings

**Depends on:** 4 (parallel-safe)
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `defaultBalanceSheetAccountValidator` (L414–478) gains `deferredRevenueAccount`, `contractAssetAccount`, `netInvestmentInLeasesAccount`; `defaultIncomeAcountValidator` (L480–565) gains `rentalIncomeAccount`, `leaseRevenueAccount`, `leaseInterestIncomeAccount` — all `z.string().optional()` (nullable columns, like `scrapAccount` L500)
- Modify: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx` — add one `AccountDefaultField` object per column to the matching `CategoryGroup.fields` (copy the shape at L83–89; `badgeType` `"Liability"` for 2160, `"Asset"` for 1145/1160, `"Revenue"` for 4060/4070/4150; `termId`s `account-default-deferred-revenue`, `account-default-contract-assets`, `account-default-net-investment-in-leases`, `account-default-rental-income`, `account-default-lease-revenue`, `account-default-lease-interest-income`)
- Modify: `packages/glossary/src/terms.ts` — six `account-default-*` terms (copy the shape at L515–527)
- Copy from (precedent): the `bankCashAccount` field (L83–89) and the `salesShippingRevenueAccount` handling (L654–662)

**Steps:**
1. Validator + form + glossary as above. `updateDefaultAccounts` (`accounting.service.ts:3900`) spreads the validated object; no change.
2. If `validateDefaultIncomeAccounts` (L3919+) enumerates income columns, add the three income columns there so a Balance-Sheet account cannot be mapped to them.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec turbo run typecheck --filter=@carbon/glossary
# Expected: exit 0 twice
pnpm --filter erp test app/modules/accounting/accounting.defaults.test.ts
# Expected: pass
```

**Out of scope:** posting code.

### Task 8: `revenueRecognitionEnabled` company setting toggle

**Depends on:** 4 (parallel-safe)
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — add `updateRevenueRecognitionSetting(client, companyId, enabled: boolean)` next to `updateAssetTaxDepreciationSettings` (L975–987): `client.from("companySettings").update({ revenueRecognitionEnabled: enabled }).eq("id", companyId)`
- Modify: `apps/erp/app/routes/x+/settings+/accounting.tsx` — new intent `"revenueRecognitionEnabled"` in the action (copy the `assetTaxDepreciationEnabled` branch at L115–123) returning `{ success, message }`; a `Switch` + handler (copy L357–360 and L220–228) under a "Revenue recognition" heading with helper text "Invoice lines with service dates defer to Deferred Revenue and are released by recognition runs"
- Copy from (precedent): the tax-depreciation toggle in the same route

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** lease thresholds (Task 33/54).

### Task 9: Service dates on sales order and sales invoice lines

**Depends on:** 4 (parallel-safe)
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `salesOrderLineValidator` (L892+) gains `serviceStartDate: zfd.text(z.string().optional())`, `serviceEndDate: zfd.text(z.string().optional())` and a `.refine` "both or neither; end ≥ start" (compare with `parseDate` from `@internationalized/date`)
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` — same two fields + refine on `salesInvoiceLineValidator` (L267+)
- Modify: `apps/erp/app/modules/sales/sales.service.ts` `upsertSalesOrderLine` (L5899) — insert branch passes `serviceStartDate: line.serviceStartDate ?? null`, `serviceEndDate: line.serviceEndDate ?? null` explicitly (lesson: a present-but-`undefined` key inserts NULL, and here NULL is what we want, but be explicit); the invoicing line upsert likewise
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderLineForm.tsx` and `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm.tsx` — two `DatePicker` fields (`~/components/Form`) labelled "Service start" / "Service end", rendered only when `useSettings().revenueRecognitionEnabled` is true and the line type is not `Comment`/`Fixed Asset`
- Modify: `packages/database/supabase/functions/convert/index.ts` — both invoice-line builders (L918–953 and the `shipmentToSalesInvoice` twin near L1520–1545) copy `serviceStartDate: line.serviceStartDate ?? null`, `serviceEndDate: line.serviceEndDate ?? null`
- Copy from (precedent): the `promisedDate` DatePicker in `SalesOrderLineForm.tsx`

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp test app/modules/sales/sales.models.test.ts
# Expected: exit 0; tests pass (add one case: end before start fails validation)
```

**Out of scope:** posting (Task 10).

### Task 10: `post-sales-invoice` deferral branch + VOID guard

**Depends on:** 4, 6, 9
**Files:**
- Modify: `packages/database/supabase/functions/shared/sales-posting-amounts.ts` — `buildSalesPostingLines` (L197–426) gains an optional `deferredRevenueAccount?: PostingAccount` argument; when present, the Sales Account leg (L324–332) posts to it as `credit("liability", amount)` with description `"Deferred Revenue"` and the class validation in `push()` accepts `Liability` for that leg; shipping, tax and AR legs unchanged
- Modify: `packages/database/supabase/functions/shared/sales-posting-amounts.test.ts` — one test: with the deferral account the revenue leg lands on it, Σ still balanced
- Modify: `packages/database/supabase/functions/post-sales-invoice/index.ts`:
  - after `getDefaultPostingGroup` (L259–265) read `companySettings.revenueRecognitionEnabled` and validate `accountDefaults.deferredRevenueAccount` with the same account-validation query as L356–376 (class `Liability`, active, leaf, same group)
  - in the item-type branch (L394–517): `const defers = revenueRecognitionEnabled && invoiceLine.serviceStartDate && invoiceLine.serviceEndDate && deferredRevenueAccount;` pass `deferredRevenueAccount` into `buildSalesPostingLines` when `defers`; collect `{ salesInvoiceLineId, amountBase: <the deferral leg's absolute base amount>, creditAccountId: chargeAccounts.sales.id, start, end }`
  - inside the transaction after the `journalLine` inserts (L777–808): for each collected line, `spreadStraightLine({ amount: amountBase, startDate, endDate })` (import `../shared/revenue-schedule.ts`) and insert `revenueRecognitionSchedule` rows `{ type: "Deferral", status: "Planned", salesInvoiceLineId, periodStart, periodEnd, scheduledDate, amount, debitAccountId: deferredRevenueAccount.id, creditAccountId, companyId, createdBy: userId }`
  - `case "void"` (L1062+): before building the reversal, `SELECT status FROM revenueRecognitionSchedule WHERE salesInvoiceLineId IN (<invoice line ids>) AND companyId = …`; if any `Posted` → throw `"Invoice has recognized revenue; reverse the recognition journal first"`; else delete those rows
- Copy from (precedent): the existing per-line account validation and journal insert blocks in the same file

**Steps:**
1. Implement as listed. `journalLine.amount` is base currency; use the leg the builder returns, not the document amount.
2. Do not touch the Fixed Asset branch, COGS logic, or any line without service dates — AC "byte-identical when off".

**Verify:**
```bash
(cd packages/database/supabase/functions && deno task test shared/sales-posting-amounts.test.ts)
# Expected: pass incl. the new deferral case
(cd packages/database/supabase/functions && deno check --no-lock post-sales-invoice/index.ts)
# Expected: no errors
```

**Out of scope:** Rental lines (Task 39), accruals (Task 40).

### Task 11: Run/schedule validators and read services

**Depends on:** 4 (parallel-safe)
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `revenueRecognitionRunValidator = z.object({ periodEnd: z.string().min(1, { message: "Period end is required" }) })` (copy `depreciationRunValidator` L1013–1015); `revenueScheduleTypes = ["Deferral","Accrual","Interest"] as const`
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — add, copying `getDepreciationRuns`/`getDepreciationRun`/`getDepreciationRunLines` (L6284–6323):
```ts
getRevenueRecognitionRuns(client, companyId, args: GenericQueryFilters & { search: string | null })   // select "id, runId, periodEnd, status, postedAt, journalId", ilike on runId, default sort createdAt desc
getRevenueRecognitionRun(client, id)                                                                    // .single()
getRevenueRecognitionRunLines(client, runId)                                                            // select "id, amount, schedule:scheduleId(id, type, periodStart, periodEnd, scheduledDate, amount, debitAccountId, creditAccountId, salesInvoiceLineId, rentalAgreementLineId, journalId)"
getRevenueSchedules(client, companyId, args: GenericQueryFilters & { status: "Planned"|"Posted"|null; type: string|null })
getDeferredRevenueWaterfall(client, companyId, { asOf: string })   // Planned rows grouped by scheduledDate month and type → { bucket, type, amount }[]
```
  `getRevenueRecognitionRunLines` embeds by target table name (`schedule:revenueRecognitionSchedule(...)` via the constraint) — lesson: composite FKs break `alias:column(...)` embeds; if PostgREST returns PGRST200, embed by constraint name `revenueRecognitionRunLine_schedule_fkey`
- Modify: `apps/erp/app/modules/accounting/index.ts` — nothing (barrel re-exports the whole service)

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** posting (Task 12).

### Task 12: Run proposal builder + posting/deletion

**Depends on:** 4, 11
**Files:**
- Create: `packages/database/src/revenue-recognition.ts`
- Modify: `packages/database/package.json` — add `"./revenue-recognition": "./src/revenue-recognition.ts"` to `exports`, mirroring the `./sequence` entry exactly (same shape for `types`/`import` if the entry is an object)
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — `postRevenueRecognitionRun`, `deleteRevenueRecognitionRun`
- Copy from (precedent): `accounting.server.ts:484-631` (`postDepreciationRun` journal + dimension inserts), `packages/database/src/sequence.ts` (`getNextSequence(trx, table, companyId)`)

**Steps:**
1. `packages/database/src/revenue-recognition.ts`:
```ts
import type { Kysely } from "kysely";
import type { KyselyDatabase } from "./client";   // use whatever path `sequence.ts` uses for the DB type
export type RunRowSynthesizer = (trx, ctx: { companyId: string; periodEnd: string; userId: string }) => Promise<void>;
export const RUN_ROW_SYNTHESIZERS: RunRowSynthesizer[] = [];     // Phase C pushes synthesizeRentalAccruals; Phase D needs nothing (Interest rows exist at activation)
export async function createRevenueRecognitionRunProposal(db: Kysely<KyselyDatabase>, args: { companyId: string; periodEnd: string; userId: string }): Promise<{ id: string; runId: string; lineCount: number } | null>
```
   Transaction: run every synthesizer; select `revenueRecognitionSchedule` rows `WHERE companyId = … AND status = 'Planned' AND runLineId IS NULL AND scheduledDate <= periodEnd` ordered by `scheduledDate, id`; if none → return `null`; `runId = await getNextSequence(trx, "revenueRecognitionRun", companyId)`; insert the run (`status 'Draft'`, `createdBy`), one `revenueRecognitionRunLine` per row (`amount = row.amount`), then `UPDATE revenueRecognitionSchedule SET runLineId = <line id>` per row. Every statement carries `companyId` (lesson: Kysely bypasses RLS).
2. `accounting.server.ts`:
```ts
export async function postRevenueRecognitionRun(db, args: { runId: string; companyId: string; userId: string; accountingPeriodId: string; postingDate: string; dimensionIds: { customer?: string; item?: string; location?: string } })
export async function deleteRevenueRecognitionRun(db, args: { runId: string; companyId: string })
```
   `post…`: load run (`status = 'Draft'` else throw), its lines joined to schedule rows; load `account.class` for the distinct debit/credit ids; load `salesInvoiceLine` (+ `salesInvoice.customerId`) for rows with `salesInvoiceLineId` and, when the column exists (Phase C), `rentalAgreementLine` → `rentalAgreement.customerId`; `journalEntryId = getNextSequence(trx, "journalEntry", companyId)`; insert ONE `journal` (`sourceType: "Revenue Recognition"`, `description: \`Revenue Recognition ${run.runId}\``, `postingDate`, `accountingPeriodId`, `status "Posted"`, `postedAt`, `postedBy`, `createdBy`); per schedule row two `journalLine`s (`amount: toStoredAmount(row.amount, 0, debitClass)` / `toStoredAmount(0, row.amount, creditClass)`, `description` = `"Deferred revenue released"` / `"Revenue recognized"` for Deferral, `"Unbilled rent accrued"` / `"Rental income accrued"` for Accrual, `"Net investment interest"` / `"Lease interest income"` for Interest, `documentType` = the value `post-sales-invoice` writes on its AR line (read it at `post-sales-invoice/index.ts` ~L790) with `documentId = salesInvoiceId` for Deferral rows, `'Rental Agreement'` + agreement id for the other two (only after Task 32 adds the enum value; until then leave them null), `journalLineReference: crypto.randomUUID()`); `journalLineDimension` rows for customer/item/location when the id is known (copy L571–597); stamp `journalId` + `status 'Posted'` on the rows, `journalId/status/postedAt/postedBy` on the run.
   `delete…`: run must be Draft; `UPDATE revenueRecognitionSchedule SET runLineId = NULL WHERE runLineId IN (…)`; delete lines then run.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database && pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 twice
```

**Out of scope:** routes (Task 13), accrual synthesis (Task 40).

### Task 13: Recognition run routes, UI, paths, sidebar

**Depends on:** 12
**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/revenue-recognition-runs.tsx`, `revenue-recognition-runs.new.tsx`
- Create: `apps/erp/app/routes/x+/revenue-recognition-run+/_layout.tsx`, `$runId.tsx`, `$runId.post.tsx`, `$runId.repeat.tsx`, `$runId.delete.tsx`
- Create: `apps/erp/app/modules/accounting/ui/RevenueRecognition/RevenueRecognitionRunsTable.tsx`, `RevenueRecognitionRunStatus.tsx`, `index.ts`
- Modify: `apps/erp/app/utils/path.ts` — `revenueRecognitionRuns`, `newRevenueRecognitionRun`, `revenueRecognitionRun(id)`, `postRevenueRecognitionRun(id)`, `repeatRevenueRecognitionRun(id)`, `deleteRevenueRecognitionRun(id)` in alphabetical position, mirroring the `depreciationRun*` entries (L702, L946–948, L1555, L2017)
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx` — entry `{ name: t\`Revenue Recognition\`, to: path.to.revenueRecognitionRuns, role: "employee", icon: <LuClock /> }` in the `General Ledger` group (L52)
- Copy from (precedent): `x+/accounting+/depreciation-runs.tsx`, `depreciation-runs.new.tsx`, `x+/depreciation-run+/*` (all seven files), `ui/FixedAssets/DepreciationRunTable.tsx`, `DepreciationRunStatus.tsx`

**Steps:**
1. List route: loader `{ view: "accounting", role: "employee" }`, `getRevenueRecognitionRuns`, next period end via `getNextPeriodEnd(lastRun?.periodEnd ?? null)` from `accounting.utils`; primary action `Confirm` posting to `path.to.newRevenueRecognitionRun` (copy L113–124 of the depreciation list).
2. `.new` action `{ create: "accounting" }`: `periodEnd` = last run's next period (or the form's `periodEnd` if posted with the validator); reject a duplicate `periodEnd`; `createRevenueRecognitionRunProposal(getDatabaseClient(), { companyId, periodEnd, userId })`; `null` → `redirect(path.to.revenueRecognitionRuns, flash(error(null, "Nothing to recognize for this period")))`; else redirect to the run.
3. Detail route: loader `{ view: "accounting" }`, `getRevenueRecognitionRun` + `getRevenueRecognitionRunLines`; render header (runId, periodEnd, status badge, journal link when posted), lines grouped by `schedule.type` with amount + period + source link (invoice line → `path.to.salesInvoice(...)`), a `fetcher.Form method="post" action="post"` Post button (Draft only), `ConfirmDelete` → `path.to.deleteRevenueRecognitionRun`, `Confirm` → `path.to.repeatRevenueRecognitionRun`; `<Outlet />`.
4. `.post` action `{ update: "accounting" }`: guard Draft; resolve `accountingPeriodId = getOrCreateAccountingPeriod(client, companyId, run.periodEnd, "accounting")`; resolve dimension ids by `entityType` `Customer` / `Item` / `Location` from `dimension` filtered `companyGroupId` + `active` (copy `$depreciationRunId.post.tsx` L63–93); `postRevenueRecognitionRun(getDatabaseClient(), {...})` in try/catch; redirect to the run with flash.
5. `.repeat` `{ create: "accounting" }`: only a Posted run; proposal for `getNextPeriodEnd(run.periodEnd)`. `.delete` `{ delete: "accounting" }`: `deleteRevenueRecognitionRun`.
6. Table + status components: copy the depreciation ones, columns `runId`, `periodEnd`, `status`, `postedAt`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: exit 0 twice
```

**Out of scope:** the waterfall report (Task 17).

### Task 14: Close-checklist evaluator `unposted-revenue-schedules`

**Depends on:** 4 (parallel-safe)
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `computePeriodReadiness` (L3051–3305): add to the `Promise.all` (L3074–3086) `client.from("revenueRecognitionSchedule").select("id", { count: "exact", head: true }).eq("companyId", companyId).eq("status", "Planned").lte("scheduledDate", endDate)` and to the checks array (L3242–3295) `{ autoCheckKey: "unposted-revenue-schedules", severity: "Warning", label: "Unposted revenue recognition schedules due on or before this period end", failing: (unpostedSchedules.count ?? 0) > 0, count: unpostedSchedules.count ?? 0 }`
- Copy from (precedent): the `draft-depreciation` query (L3103–3109) and check (L3281–3287)

**Steps:**
1. Add query + check. The definition row was seeded in Task 3/5 with the same key — a key without an evaluator fails every close (L3269–3272), so both halves must exist before commit.
2. Extend `apps/erp/app/modules/accounting/accounting.periods.test.ts` if it asserts the checks array (add the new key).

**Verify:**
```bash
pnpm --filter erp test app/modules/accounting/accounting.periods.test.ts
# Expected: pass
```

**Out of scope:** the accrual-days condition (Task 40).

### Task 15: Inngest monthly run proposal

**Depends on:** 12
**Files:**
- Create: `packages/jobs/src/inngest/functions/scheduled/revenue-recognition-proposal.ts`, `revenue-recognition-proposal.test.ts`
- Modify: `packages/jobs/src/inngest/functions/scheduled/index.ts` (export) and `packages/jobs/src/inngest/index.ts` (import block L59–73 and the `// Scheduled` array L143–156 — both, or the function is never served)
- Copy from (precedent): `scheduled/mrp.ts` L1–40 and L70–100 (per-company `step.run` fan-out), `scheduled/update-exchange-rates.test.ts` (test style)

**Steps:**
1. `revenueRecognitionProposalFunction = inngest.createFunction({ id: "revenue-recognition-proposal", retries: 2 }, { cron: "0 6 1 * *" }, …)`: `find-companies` step as in `mrp.ts`; per company `step.run(\`rev-rec-${company.id}\`)`: `tz = await getCompanyTimeZone(serviceRole, company.id)` (`@carbon/database`), `periodEnd = priorMonthEnd(datetime.today(tz))` (a pure exported helper using `@internationalized/date`: first day of this month minus one day), skip when a `revenueRecognitionRun` with that `periodEnd` exists (Kysely select), else `createRevenueRecognitionRunProposal(getJobDatabaseClient(), { companyId: company.id, periodEnd, userId: "system" })` from `@carbon/database/revenue-recognition`.
2. Test `priorMonthEnd("2026-10-01") === "2026-09-30"`, `("2026-03-15") === "2026-02-28"`, `("2028-03-01") === "2028-02-29"`.

**Verify:**
```bash
pnpm --filter @carbon/jobs test src/inngest/functions/scheduled/revenue-recognition-proposal.test.ts
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: pass; exit 0
```

**Out of scope:** posting (human).

### Task 16: `POSTING_POLICY` entry for `'Revenue Recognition'`

**Depends on:** 4 (parallel-safe)
**Files:**
- Modify: `packages/ee/src/accounting/core/models.ts` — add after `"Asset Disposal"` (L418–422): `"Revenue Recognition": { representation: "journal", defaultEnabled: false, defaultGranularity: "individual" }` with a one-line comment citing plan decision 1
- Copy from (precedent): the returns entries L345–377

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee && pnpm --filter @carbon/ee test src/accounting
# Expected: exit 0; tests pass
```

**Out of scope:** provider mappers.

### Task 17: Deferred revenue waterfall report

**Depends on:** 11
**Files:**
- Create: `apps/erp/app/routes/x+/reports+/revenue-waterfall.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/reports.tsx` — hub card `{ key: "revenue-waterfall", name: t\`Deferred Revenue Waterfall\`, description: t\`When deferred, accrued and lease-interest revenue will be recognized\`, to: path.to.revenueWaterfall, icon: LuFileSpreadsheet, category: t\`Close Reports\`, defaultPinned: false }` (copy L169–177)
- Modify: `apps/erp/app/utils/path.ts` — `revenueWaterfall: \`${x}/reports/revenue-waterfall\``
- Copy from (precedent): `x+/reports+/trial-balance.tsx` (page shell, as-of picker), `apps/erp/app/components/Table/Table.tsx` (CSV export is built in)

**Steps:**
1. Loader `{ view: "accounting" }`: `asOf` search param (default company today via `getCompanyTimeZone` + `datetime.today`), `getDeferredRevenueWaterfall`. Render a `Table` with columns Month, Type, Amount, and a totals row; the `Table` default export gives CSV.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** GL tie-out columns.

### Task 18: Phase A browser verification

**Depends on:** 5, 7, 8, 9, 10, 13, 14, 15, 16, 17
**Files:** none

**Steps:**
1. `crbn up` (plain, portless); invoke `/auth` then `/test` with this script:
   - Accounting settings: enable accounting (if off) and the new revenue-recognition toggle; Account Defaults shows the six new mappings prefilled.
   - Flag OFF first: post a Service invoice with no service dates → journal credits Sales (4010). Flag ON: post a Service line $1,200.00 with service 2026-10-01 → 2027-03-31 dated 2026-10-05 → journal Dr AR 1,200 / Cr Deferred Revenue 1,200; six Planned rows of 200.00 visible in the waterfall.
   - New recognition run for period end 2026-10-31 → one Deferral line 200.00; Post → journal `Revenue Recognition` Dr 2160 200 / Cr 4010 200; run Posted; a second run for the same period is refused / empty.
   - Lock October → posting a run still works; Close October → posting fails with the period error.
   - Period close checklist for October shows "Recognize revenue for the period" failing before the run posts and passing after.
2. Record evidence in `.ai/runs/2026-09-22-revenue-recognition-and-rentals.md`.

**Verify:**
```bash
ls .ai/runs/2026-09-22-revenue-recognition-and-rentals.md
# Expected: file exists with the five checks marked pass
```

**Out of scope:** rentals.

---

## Phase B — Fleet bridge + Make to Asset

### Task 19: Migration — asset transfer enums

**Depends on:** 1 (parallel-safe with Phase A)
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_asset-transfer-enums.sql` via `pnpm db:migrate:new asset-transfer-enums`
- Copy from (precedent): Task 2

**Steps:**
1. Contents:
```sql
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "itemLedgerDocumentType"  ADD VALUE IF NOT EXISTS 'Asset Transfer';
ALTER TYPE "fixedAssetStatus"        ADD VALUE IF NOT EXISTS 'Under Construction';
ALTER TYPE "disposalMethod"          ADD VALUE IF NOT EXISTS 'Transfer to Inventory';

DO $faenums$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fixedAssetTransferType') THEN
    CREATE TYPE "fixedAssetTransferType" AS ENUM ('Capitalization', 'Return to Inventory');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fixedAssetTransferSourceType') THEN
    CREATE TYPE "fixedAssetTransferSourceType" AS ENUM ('Inventory', 'Job', 'Construction in Progress');
  END IF;
END $faenums$;
```

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -1
# Expected: <ts>_asset-transfer-enums.sql
```

**Out of scope:** tables (Task 20).

### Task 20: Migration — fleet bridge

**Depends on:** 19
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_fleet-bridge.sql` via `pnpm db:migrate:new fleet-bridge`
- Copy from (precedent): `20260525084319_seed-fixed-asset-classes.sql` (class per company — but write the CURRENT columns `gainOnDisposalAccountId` / `lossOnDisposalAccountId`, the old `disposalAccountId` no longer exists), Task 3 (accounts + sequence + RLS shape)

**Steps:**
1. Columns and constraints (each `ADD CONSTRAINT` inside a `DO $fleet$` guard on `pg_constraint`):
```sql
ALTER TABLE "fixedAsset"
  ADD COLUMN IF NOT EXISTS "itemId" TEXT REFERENCES "item"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "trackedEntityId" TEXT REFERENCES "trackedEntity"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "quantity" NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "workCenterId" TEXT REFERENCES "workCenter"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "outOfServiceSince" DATE,
  ADD COLUMN IF NOT EXISTS "outOfServiceReason" TEXT;
-- guarded: CHECK ("quantity" = 1) as fixedAsset_quantity_v1_check
-- guarded: CHECK (("outOfServiceSince" IS NULL) = ("outOfServiceReason" IS NULL)) as fixedAsset_outOfService_check
CREATE UNIQUE INDEX IF NOT EXISTS "fixedAsset_trackedEntity_live_idx" ON "fixedAsset" ("companyId", "trackedEntityId")
  WHERE "trackedEntityId" IS NOT NULL AND "status" <> 'Disposed';
CREATE INDEX IF NOT EXISTS "fixedAsset_itemId_idx" ON "fixedAsset" ("itemId");
CREATE INDEX IF NOT EXISTS "fixedAsset_workCenterId_idx" ON "fixedAsset" ("workCenterId");
ALTER TABLE "fixedAssetClass" ADD COLUMN IF NOT EXISTS "isConstructionInProgress" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "fixedAssetClassId" TEXT REFERENCES "fixedAssetClass"("id"),
  ADD COLUMN IF NOT EXISTS "fixedAssetId" TEXT REFERENCES "fixedAsset"("id");
-- guarded: CHECK (num_nonnulls("fixedAssetClassId", "fixedAssetId") <= 1) as job_asset_target_check
CREATE INDEX IF NOT EXISTS "job_fixedAssetClassId_idx" ON "job" ("fixedAssetClassId");
CREATE INDEX IF NOT EXISTS "job_fixedAssetId_idx" ON "job" ("fixedAssetId");
```
2. `fixedAssetTransfer` — the spec's table (Data Model §3) verbatim, plus `CREATE INDEX IF NOT EXISTS` on `companyId`, `fixedAssetId`, `itemId`, `trackedEntityId`, `jobId`, `createdBy`, and the four `accounting_*` RLS policies. `fixedAssetCipCost` — the spec's table verbatim plus `"updatedBy" TEXT REFERENCES "user"("id")` and `"updatedAt" TIMESTAMP WITH TIME ZONE` (mandatory on any table with `createdBy`), indexes on `companyId`, `fixedAssetId`, `jobId`, `createdBy`, RLS `accounting_*`.
3. Sequence per company: `('fixedAssetTransfer', 'Fixed Asset Transfer', 'FAT', NULL, 0, 6, 1)` — same statement shape as Task 3 step 5.
4. Accounts per company group under the `Property, Plant & Equipment` group (Task 3 step 3 statement shape): `1370 Rental Fleet` (Asset / Fixed Asset / Balance Sheet / Current), `1380 Accumulated Depreciation – Rental Fleet` (Asset / Accumulated Depreciation / Balance Sheet / Current), `1390 Construction in Progress` (Asset / Fixed Asset / Balance Sheet / Current) + the missing-group guard.
5. Two classes per company (skip `"isEliminationEntity" IS TRUE` companies), `ON CONFLICT ("name", "companyId") DO NOTHING`, joining accounts by number within the company's group exactly as the precedent does:
   - `Rental Fleet`: `'Straight Line'`, `usefulLifeMonths 60`, `residualValuePercent 20`, asset 1370, accumulated 1380, expense 6310, writeOff 6320, writeDown 6320, gain 4140, loss 6320, `isConstructionInProgress false`.
   - `Construction in Progress`: `'Straight Line'`, 120, 0, asset 1390, accumulated 1330, expense 6310, writeOff 6320, writeDown 6320, gain 4140, loss 6320, `isConstructionInProgress true`.
6. `jobs` view: `job` gained columns and the view selects `j.*` before aliased columns (lesson) → `DROP VIEW IF EXISTS "jobs"` + `CREATE VIEW` from the NEWEST definition (`grep -l 'VIEW "jobs"' migrations/*.sql | sort | tail -1`), checking dependents first.
7. `fleetAssets` view (`WITH(SECURITY_INVOKER=true)`): `fixedAsset fa` where `fa."itemId" IS NOT NULL`, joined to `item i`, `trackedEntity te`, `fixedAssetClass fac`, `workCenter wc`, `LEFT JOIN LATERAL` the newest `rentalAgreementLine` with status in ('Pending','On Rent') — **in Phase B that table does not exist**: write the view WITHOUT the agreement join now, exposing `fleetStatus` as `CASE WHEN fa.status = 'Disposed' AND fa."disposalMethod" = 'Transfer to Inventory' THEN 'Returned to Stock' WHEN fa.status = 'Disposed' THEN 'Sold' WHEN fa.status = 'Under Construction' THEN 'Under Construction' WHEN fa."outOfServiceSince" IS NOT NULL THEN 'In Maintenance' ELSE 'Available' END`, `nbv = fa."acquisitionCost" - fa."accumulatedDepreciation"`, `itemReadableId`, `itemName`, `serialNumber`, `className`, `workCenterName`, `outOfServiceReason`. Task 33 recreates it with the agreement join and the `On Rent` / `Reserved` states.
8. `NOTIFY pgrst, 'reload schema';`

**Verify:**
```bash
pnpm db:migrate
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -c "SELECT name, \"isConstructionInProgress\" FROM \"fixedAssetClass\" WHERE name IN ('Rental Fleet','Construction in Progress') ORDER BY name"
# Expected: two rows per company; CIP true, Rental Fleet false
```

**Out of scope:** rental tables.

### Task 21: Apply migrations, regenerate types, `POSTING_POLICY` `'Asset Transfer'`

**Depends on:** 20
**Files:**
- Modify: `packages/database/src/types.ts` (generated); `packages/ee/src/accounting/core/models.ts` — `"Asset Transfer": { representation: "journal", defaultEnabled: false, defaultGranularity: "individual" }`

**Verify:**
```bash
pnpm db:migrate && pnpm run generate:types
pnpm exec turbo run typecheck --filter=@carbon/database && pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0 (ee fails to compile until the policy entry exists — that is the guard working)
```

**Out of scope:** app code.

### Task 22: Seeds for new companies

**Depends on:** 21 (parallel-safe)
**Files:**
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` — `accounts`: 1370 / 1380 / 1390 with `parentKey: "ppe"` (near L689; 1380 uses `accountType: "Accumulated Depreciation"`); `fixedAssetClasses` (L867): two entries with the Task 20 step 5 values plus `isConstructionInProgress`; `sequences`: `fixedAssetTransfer` / `Fixed Asset Transfer` / `FAT`
- Modify: `packages/database/supabase/functions/seed-company/index.ts` — the class insert loop (L459–478) gains `isConstructionInProgress: fac.isConstructionInProgress ?? false`

**Verify:**
```bash
pnpm db:check:datasets
(cd packages/database/supabase/functions && deno check --no-lock seed-company/index.ts)
# Expected: datasets exit 0; deno check reports no NEW errors vs HEAD. Baseline note (2026-09-22): the file already
# reports 11 errors at HEAD, all in lib/database.ts, lib/postgres/index.ts, lib/supabase.ts and two pre-existing
# seed-company sites — compare the "Found N errors" count against a `git show HEAD:<path>` copy checked from the
# same directory (NO_COLOR=1).
```

**Out of scope:** existing companies (Task 20).

### Task 23: Shared asset-transfer line builders + safe document types

**Depends on:** 21 (parallel-safe)
**Files:**
- Create: `packages/database/supabase/functions/shared/asset-transfer.ts`, `shared/asset-transfer.test.ts`
- Modify: `packages/database/supabase/functions/shared/post-adjustment.ts` — add `'Asset Transfer'` to `JOURNAL_LINE_SAFE_DOCUMENT_TYPES` (L108–121) so a `bookAdjustment` ledger with that document type keeps it on the journal line
- Modify: `packages/database/supabase/functions/lib/utils.ts` — `TrackedEntityAttributes` gains `"Fixed Asset"?: string` and `"Rental Agreement"?: string`
- Copy from (precedent): `shared/sales-posting-amounts.ts` (pure builder + `assertBalanced`), `shared/post-adjustment.test.ts`

**Steps:**
1. Pure, import-free except `./precision.ts` and `../lib/utils.ts` (`debit`/`credit`):
```ts
export type AssetAccounts = { assetAccountId: string; accumulatedDepreciationAccountId: string };
export function buildCapitalizationLines(args: { cost: number; assetAccountId: string; creditAccountId: string; creditDescription: string }): PostingLine[]
   // Dr asset (debit("asset", cost)) / Cr creditAccountId (credit("asset", cost)); creditDescription = "Finished Goods Account" | "Raw Materials Account" | "WIP Account" | "Construction in Progress"
export function buildReturnToInventoryLines(args: { cost: number; accumulatedDepreciation: number; inventoryAccountId: string; inventoryDescription: string; accounts: AssetAccounts }): PostingLine[]
   // Dr inventory (cost − accumDep) / Dr accumulated depreciation (accumDep, skipped when 0) / Cr asset (cost)
```
   `PostingLine = { accountId: string; description: string; amount: number }`; every builder ends with `assertBalanced` over the signed-debit total (mirror how `sales-posting-amounts.ts` converts natural-balance amounts before asserting).
2. Tests: capitalization 42,000 → two lines; return NBV 40,320 on cost 42,000 / accum 1,680 → three lines that balance; accum 0 → two lines.

**Verify:**
```bash
(cd packages/database/supabase/functions && deno task test shared/asset-transfer.test.ts shared/post-adjustment.test.ts)
# Expected: pass
```

**Out of scope:** the edge function (Task 24).

### Task 24: Edge function `post-asset-transfer`

**Depends on:** 23
**Files:**
- Create: `packages/database/supabase/functions/post-asset-transfer/index.ts` via `pnpm db:function:new post-asset-transfer`; `post-asset-transfer/validators.ts` + `validators.test.ts`
- Modify: `packages/database/supabase/config.toml` — `[functions.post-asset-transfer] enabled = true, verify_jwt = true, entrypoint = "./functions/post-asset-transfer/index.ts"` (copy L202–205)
- Copy from (precedent): `post-inventory-adjustment/index.ts` (`requirePermissions`, pool at module scope, period resolution before the transaction, `bookAdjustment` + `createAdjustmentJournal`), `post-receipt/index.ts:1690-1793` (asset activation + dimension tagging)

**Steps:**
1. Payload: `z.discriminatedUnion("type", [...])` with `companyId`, `userId` on every variant:
   - `capitalize`: `{ fixedAssetClassId, itemId, trackedEntityId, locationId, storageUnitId?, transferDate, name?, fixedAssetId? }` (`fixedAssetId` = an existing Draft asset to fill; otherwise create)
   - `return`: `{ fixedAssetId, locationId, storageUnitId?, transferDate }`
   - `attachJob`: `{ fixedAssetId, jobId }`
   - `capitalizeCip`: `{ fixedAssetId, toClassId, inServiceDate }`
   `requirePermissions(req, companyId, userId, { create: "accounting" })`. Re-read every referenced record under `companyId` and 404 on a miss (edge-function rule). Resolve the accounting period BEFORE the transaction with `getAccountingPeriodForDate(client, companyId, db, transferDate)` (`shared/get-accounting-period.ts`), guarded on `companySettings.accountingEnabled`.
2. `capitalize`: unit must be `Available` with net on-hand 1 at `locationId` (query `itemLedger` sum by `trackedEntityId`, resolve the bin by highest positive net — lesson); not already on a live asset (partial unique index will also refuse). In one Kysely transaction: `transferId = getNextSequence(trx, "fixedAssetTransfer", companyId)`; `const { cost, itemLedgerId } = await bookAdjustment(trx, { ledger: { postingDate: transferDate, itemId, quantity: -1, locationId, storageUnitId, trackedEntityId, entryType: "Negative Adjmt.", documentType: "Asset Transfer", documentId: <transfer row id>, companyId, createdBy: userId }, item, itemCost, accounting: null })` (accounting null → no variance journal; `cost` is the carrying cost for any costing method); when accounting is enabled: `journalId = createAdjustmentJournal(trx, { sourceType: "Asset Transfer", description: \`Capitalize ${item.readableId} ${serial} → ${fixedAssetId}\`, … })`, journal lines from `buildCapitalizationLines({ cost, assetAccountId: class.assetAccountId, creditAccountId: resolveInventoryAccount(item.replenishmentSystem, accountDefaults).account, creditDescription })` with `documentType 'Asset Transfer'`, `documentId = transfer id`, dimensions Location / FixedAssetClass / Item (copy post-receipt L1751–1758 for the ids); create/fill `fixedAsset` (`fixedAssetId = getNextSequence(trx, "fixedAsset", companyId)` when creating; `itemId`, `trackedEntityId`, `serialNumber = te.readableId`, `name = name ?? \`${item.name} ${te.readableId}\``, `acquisitionCost = cost`, `acquisitionDate = depreciationStartDate = transferDate`, `locationId`, class defaults for method/life/residual, `status 'Active'` — for a CIP class `'Under Construction'`); insert `fixedAssetTransfer` (`type 'Capitalization'`, `sourceType 'Inventory'`, `amount = cost`, `journalId`, `status 'Posted'`, `postedAt/By`); `UPDATE trackedEntity SET status = 'Consumed', attributes = attributes || jsonb_build_object('Fixed Asset', <asset id>)`; insert `trackedActivity` `{ type: "Capitalize", sourceDocument: "Fixed Asset", sourceDocumentId: <asset id>, sourceDocumentReadableId: <fixedAssetId>, attributes: { "Fixed Asset": <asset id> } }` + `trackedActivityInput` `{ trackedEntityId, quantity: 1, entityType: "Serial" }` (copy `post-shipment/index.ts:861-879`).
3. `return`: asset `Active | Fully Depreciated`, `trackedEntityId` set, not `outOfService`; **after Task 33 also** not on a live `rentalAgreementLine` (add that check in Task 38). NBV `N = acquisitionCost − accumulatedDepreciation`; `bookAdjustment` with `quantity: +1`, `fixedUnitCost: N`, `entryType "Positive Adjmt."`, `documentType "Asset Transfer"`, `accounting: null`; journal from `buildReturnToInventoryLines` (Dr inventory N / Dr class accumulated depreciation / Cr class asset at cost); `fixedAsset` → `status 'Disposed'`, `disposalMethod 'Transfer to Inventory'`, `disposalDate = transferDate`; insert `fixedAssetDisposal` (`netBookValueAtDisposal N`, `saleProceeds 0`, `gainLoss 0`, `journalId`); `fixedAssetTransfer` (`type 'Return to Inventory'`, `sourceType 'Inventory'`, `amount N`, `accumulatedDepreciation`); entity → `status 'Available'`, `attributes - 'Fixed Asset'`, activity `'Return to Inventory'` with the entity as OUTPUT (`trackedActivityOutput`).
4. `attachJob`: asset class `isConstructionInProgress`, asset status `Draft | Under Construction`; job `companyId` matches, `status NOT IN ('Completed','Cancelled','Closed')`, `salesOrderLineId IS NULL`, `fixedAssetClassId IS NULL`, `fixedAssetId IS NULL`. Balance `B = SUM(jl.amount) FROM journalLine jl JOIN journal j … WHERE jl.accountId = accountDefaults.workInProgressAccount AND jl.documentId = jobId AND j.companyId = companyId AND j.status <> 'Draft'`. If `B > 0`: journal `'Asset Transfer'` Dr CIP class asset account B / Cr WIP B, BOTH lines `documentType 'Asset Transfer'`, `documentId = jobId`, `documentLineReference = transferId`; `fixedAssetCipCost` `{ sourceType 'Job', jobId, amount B, costDate today, journalId }`; `fixedAssetTransfer` (`Capitalization`, `sourceType 'Job'`, `jobId`, `amount B`). Always: `UPDATE job SET fixedAssetId`, asset `status 'Under Construction'`, `acquisitionCost = acquisitionCost + B`.
5. `capitalizeCip`: asset `Under Construction`; `toClassId` not CIP; `S = Σ fixedAssetCipCost.amount` (must be > 0); journal Dr target class asset S / Cr CIP class asset S (`documentType 'Asset Transfer'`, `documentId = transfer id`); asset `fixedAssetClassId = toClassId`, `acquisitionCost = S`, `acquisitionDate = depreciationStartDate = inServiceDate`, depreciation method / life / residual from the target class when null, `status 'Active'`; transfer (`Capitalization`, `sourceType 'Construction in Progress'`, `fromClassId`, `inServiceDate`, `amount S`).
6. Accounting disabled: skip journals and `journalId`s; everything else identical.
7. Return `{ transferId, fixedAssetId }` (201). Errors → `{ error }` 500 with `corsHeaders`.

**Verify:**
```bash
(cd packages/database/supabase/functions && deno task test post-asset-transfer/validators.test.ts && deno check --no-lock post-asset-transfer/index.ts)
# Expected: pass; no type errors
```

**Out of scope:** job completion (Task 25).

### Task 25: `complete_job_to_inventory` job→asset branch + SQL test

**Depends on:** 21
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_complete-job-to-asset.sql` via `pnpm db:migrate:new complete-job-to-asset`
- Create: `packages/database/supabase/tests/job-completion-to-asset.test.sql`
- Copy from (precedent): the NEWEST migration defining the function — run `grep -l 'FUNCTION complete_job_to_inventory\|FUNCTION public.complete_job_to_inventory' packages/database/supabase/migrations/*.sql | sort | tail -1` (as of writing `20260922050131_mark-complete-completes-remaining-quantities.sql`); `packages/database/supabase/tests/job-completion-received-quantity.test.sql` (fixture + `make_job` helper)

**Steps:**
1. `DROP FUNCTION IF EXISTS complete_job_to_inventory(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT);` then `CREATE OR REPLACE FUNCTION` with the body copied VERBATIM from the newest file (same signature, `SECURITY DEFINER`, `SET search_path = public`). Diff your file against that source before editing further; the only hunks must be the ones below (lesson: a fork from a stale base silently reverts sibling branches).
2. DECLARE additions: `v_job_asset_class_id TEXT; v_job_asset_id TEXT; v_asset_target TEXT; v_target_class RECORD; v_asset_ids TEXT[] := '{}'; v_transfer_ids TEXT[] := '{}'; v_asset_unit_ids TEXT[]; v_new_asset_id TEXT; v_transfer_id TEXT; v_per_unit_cost NUMERIC; v_activity_id TEXT; i INTEGER;`
3. In the job `SELECT … INTO STRICT` (source ~L92–103) also select `"fixedAssetClassId", "fixedAssetId"` into `v_job_asset_class_id, v_job_asset_id`; set `v_asset_target := CASE WHEN v_job_asset_id IS NOT NULL THEN 'asset' WHEN v_job_asset_class_id IS NOT NULL THEN 'class' END;`. Guards right after: `IF v_asset_target IS NOT NULL AND v_sales_order_line_id IS NOT NULL THEN RAISE EXCEPTION 'A job linked to a sales order line cannot complete to a fixed asset'; END IF;` and `IF v_asset_target IS NOT NULL AND v_item_tracking_type IS DISTINCT FROM 'Serial' AND p_quantity_complete > 1 THEN RAISE EXCEPTION 'Make to Asset needs a serialized item or a quantity of one'; END IF;`
4. Immediately after the `UPDATE "job"` (source ~L155–165), for `v_asset_target = 'class'` and `v_quantity_received_to_inventory > 0`: `SELECT fac.* INTO STRICT v_target_class FROM "fixedAssetClass" fac WHERE fac.id = v_job_asset_class_id AND fac."companyId" = p_company_id;` pick units — serial: `v_asset_unit_ids := ARRAY(<the serial ARRAY(...) query from the serial branch, verbatim, but with the NOT EXISTS clause replaced by AND NOT (te.attributes ? 'Fixed Asset')>)`, take `[1:v_quantity_received_to_inventory::INTEGER]`; untracked/batch: `v_asset_unit_ids := ARRAY[NULL::TEXT]` (exactly one unit). `FOR i IN 1..array_length(v_asset_unit_ids,1) LOOP` → `INSERT INTO "fixedAsset" ("fixedAssetId","fixedAssetClassId","name","serialNumber","itemId","trackedEntityId","quantity","status","depreciationMethod","usefulLifeMonths","residualValuePercent","acquisitionCost","acquisitionDate","depreciationStartDate","locationId","companyId","createdBy") VALUES (get_next_sequence('fixedAsset', p_company_id), v_job_asset_class_id, <item name || ' ' || te.readableId>, te."readableId", v_item_id, v_asset_unit_ids[i], 1, 'Active', v_target_class."depreciationMethod", v_target_class."usefulLifeMonths", v_target_class."residualValuePercent", 0, v_company_today, v_company_today, v_job_location_id, p_company_id, p_user_id) RETURNING id INTO v_new_asset_id;` (for a CIP-class target use `'Under Construction'`); `INSERT INTO "fixedAssetTransfer" ("transferId","type","sourceType","fixedAssetId","itemId","trackedEntityId","jobId","locationId","quantity","transferDate","amount","status","postedAt","postedBy","companyId","createdBy") VALUES (get_next_sequence('fixedAssetTransfer', p_company_id), 'Capitalization', 'Job', v_new_asset_id, v_item_id, v_asset_unit_ids[i], p_job_id, v_job_location_id, 1, v_company_today, 0, 'Posted', NOW(), p_user_id, p_company_id, p_user_id) RETURNING id INTO v_transfer_id;` append both ids to the arrays; when the unit id is not null: `UPDATE "trackedEntity" SET status = 'Consumed', attributes = COALESCE(attributes,'{}'::jsonb) || jsonb_build_object('Fixed Asset', v_new_asset_id) WHERE id = v_asset_unit_ids[i]`; insert one `trackedActivity` (`type 'Capitalize'`, `sourceDocument 'Fixed Asset'`, `sourceDocumentId v_new_asset_id`, `attributes jsonb_build_object('Fixed Asset', v_new_asset_id, 'Job', p_job_id)`) and a `trackedActivityInput` for the unit. `END LOOP;`
   For `v_asset_target = 'asset'` (CIP): nothing here beyond marking units `Consumed` with `'Fixed Asset' = v_job_asset_id` and the activity; cost is recorded after the WIP journal.
5. Wrap the inventory artifacts in `IF v_asset_target IS NULL THEN … END IF;`: the outer itemLedger guard block (source ~L212–367) and the `pickMethod` block (~L369–399). `backflush_job_materials` (~L401) stays unconditional.
6. In the accounting section, after `v_accumulated_wip_cost` is known and the zero/re-completion early returns (~L674–696): if `v_asset_target IS NOT NULL` then (a) DR account = for `'class'` `v_target_class."assetAccountId"`, for `'asset'` the CIP asset's class `assetAccountId` (join `fixedAsset`→`fixedAssetClass`), description `'Fixed Asset'`; (b) the journal header uses `'Asset Transfer'` as `sourceType` and description `'Job Completion to Fixed Asset ' || v_job_id_readable`; (c) BOTH journal lines use `documentType 'Asset Transfer'`, `documentId p_job_id`, `documentLineReference 'job:' || p_job_id` (the WIP credit MUST keep `documentId = p_job_id`); (d) skip the `costLedger` insert and the `itemCost` update blocks (~L779–828) entirely; (e) price the assets: `v_per_unit_cost := v_accumulated_wip_cost / v_quantity_received_to_inventory;` `UPDATE "fixedAsset" SET "acquisitionCost" = v_per_unit_cost WHERE id = ANY(v_asset_ids); UPDATE "fixedAssetTransfer" SET amount = v_per_unit_cost, "journalId" = v_journal_id WHERE id = ANY(v_transfer_ids);` for CIP: `INSERT INTO "fixedAssetCipCost" ("fixedAssetId","sourceType","jobId","amount","costDate","journalId","companyId","createdBy") VALUES (v_job_asset_id,'Job',p_job_id,v_accumulated_wip_cost,v_company_today,v_journal_id,p_company_id,p_user_id); UPDATE "fixedAsset" SET "acquisitionCost" = "acquisitionCost" + v_accumulated_wip_cost, status = 'Under Construction' WHERE id = v_job_asset_id;` and insert the transfer row (`Capitalization`, `sourceType 'Job'`, amount = the swept cost). The dimension loop (~L830–858) runs unchanged; add a `FixedAssetClass` dimension tag when `v_dimension_fixed_asset_class` resolves (select it like the others).
7. SQL test (`\set ON_ERROR_STOP on`, `BEGIN;` … `ROLLBACK;`, fixture company, `make_job` helper copied from the precedent): (a) serial job of 2 with `fixedAssetClassId` = the fixture's Rental Fleet class and 84,000 of WIP → complete → two `fixedAsset` rows Active at 42,000 with `trackedEntityId` set, two transfer rows `sourceType 'Job'`, zero `itemLedger` rows with `documentType 'Job Receipt'` for the job, zero `costLedger` rows, journal `sourceType 'Asset Transfer'` with WIP credit `documentId = job`, entities `Consumed` with `attributes->>'Fixed Asset'`, Σ WIP lines for the job = 0; completing again changes nothing; (b) untracked job quantity 3 with a class target → `RAISE`; (c) CIP: asset in the CIP class + job attached via `UPDATE job SET "fixedAssetId"` with 1,500 WIP → complete → cip cost row 1,500, asset `Under Construction`, `acquisitionCost` += 1,500, no inventory rows. Accounting enabled in the fixture (`companySettings.accountingEnabled = true`, defaults present).

**Verify:**
```bash
pnpm db:migrate
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/job-completion-to-asset.test.sql
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/job-completion-received-quantity.test.sql
# Expected: both scripts finish with their final assertions passing and ROLLBACK
diff <(grep -l 'FUNCTION complete_job_to_inventory' packages/database/supabase/migrations/*.sql | sort | tail -2 | head -1 | xargs cat) packages/database/supabase/migrations/<ts>_complete-job-to-asset.sql | grep -c '^[<>]'
# Expected: only the hunks described in steps 2–6 (review the diff by eye)
```

**Out of scope:** the Complete dialog (Task 27).

### Task 26: CIP awareness in `post-receipt` / `post-purchase-invoice`

**Depends on:** 21 (parallel-safe)
**Files:**
- Modify: `packages/database/supabase/functions/post-receipt/index.ts` (~L1690–1793) and `post-purchase-invoice/index.ts` (~L1442–1660, direct path L1572–1645)
- Copy from (precedent): the existing Fixed Asset branches in those files

**Steps:**
1. Where each branch loads the asset + class, also select `fixedAssetClass.isConstructionInProgress`. When true: the status flip writes `'Under Construction'` instead of `'Active'` (leave `depreciationStartDate` null), and after the journal insert append `fixedAssetCipCost` `{ fixedAssetId, sourceType: 'Receipt' | 'Purchase Invoice', sourceDocumentId: receipt/invoice id, sourceDocumentLineId: line id, amount, costDate: posting date, journalId, companyId, createdBy: userId }`. GL lines unchanged (the CIP class's own asset account is 1390).
2. Void paths (`post-receipt` ~L630–676; purchase-invoice void branch): delete `fixedAssetCipCost` rows whose `sourceDocumentId` is the voided document and reduce `acquisitionCost` by their Σ; if the asset is no longer Under Construction (already capitalized), throw `"Asset was capitalized; reverse the capitalization first"`.

**Verify:**
```bash
(cd packages/database/supabase/functions && deno check --no-lock post-receipt/index.ts post-purchase-invoice/index.ts)
# Expected: no errors
```

**Out of scope:** UI.

### Task 27: Job target — model, form, complete dialog, release gate

**Depends on:** 21 (parallel-safe)
**Files:**
- Modify: `apps/erp/app/modules/production/production.models.ts` — `baseJobValidator` (L212–232) gains `fixedAssetClassId: zfd.text(z.string().optional())`, `fixedAssetId: zfd.text(z.string().optional())`; `jobValidator` refine: not both
- Modify: `apps/erp/app/modules/production/production.service.ts` — `updateJob` / the insert path pass the two columns through (`?? null`)
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobForm.tsx` — a **Complete to** `SelectControlled` (options `Inventory`, every active non-CIP `fixedAssetClass` via `useAssetClasses` from `~/components/Form`, and `Under Construction asset…`) that sets `<Hidden name="fixedAssetClassId">` / a `Combobox name="fixedAssetId"` of `Under Construction` assets (loader-provided); disabled when the job status is not `Draft`/`Planned`
- Modify: `apps/erp/app/routes/x+/job+/$jobId.details.tsx` — loader adds `getFixedAssets(client, companyId, { status: "Under Construction", … })`; action (L164–184) passes `fixedAssetClassId: validation.data.fixedAssetClassId || null`, `fixedAssetId: validation.data.fixedAssetId || null`; `x+/job+/new.tsx` (create) the same
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobHeader.tsx` — the Complete `ValidatedForm` (L1462–1732): when `job.fixedAssetClassId || job.fixedAssetId`, hide the `locationId`/`storageUnitId` pickers (L1502–1516) and render a note "Completes to fixed asset class {name}" / "Sweeps cost to {asset}"
- Modify: `apps/erp/app/routes/x+/job+/$jobId.status.tsx` — before `releaseJobs` (L88–97): if the job has a target and (`item.itemTrackingType !== "Serial"` and `quantity > 1`) → redirect with flash error `"Make to Asset needs a serialized item or a quantity of one"`; if `salesOrderLineId` → `"A job linked to a sales order line cannot complete to a fixed asset"`
- Copy from (precedent): the `Location`/`Customer` fields in `JobForm.tsx` L345, L372–378; the tax toggle note pattern in `$fixedAssetId.tsx`

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm --filter erp test test/job-complete-logic.test.ts
# Expected: exit 0; pass
```

**Out of scope:** MRP demand for fleet builds.

### Task 28: Fleet validators/services; CIP-class registration; status badge

**Depends on:** 21 (parallel-safe)
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — `fixedAssetStatuses` gains `"Under Construction"`; `fixedAssetValidator` gains `workCenterId: zfd.text(z.string().optional())`; new validators `fixedAssetCapitalizeValidator { fixedAssetClassId, itemId, trackedEntityId, locationId, storageUnitId?, transferDate, name? }`, `fixedAssetReturnToInventoryValidator { transferDate, locationId, storageUnitId? }`, `fixedAssetAttachJobValidator { jobId }`, `fixedAssetCapitalizeCipValidator { toClassId, inServiceDate }`, `fixedAssetOutOfServiceValidator { reason: z.string().min(1) }`
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getFixedAssets` status arg type accepts `"Under Construction"`; `insertFixedAsset`/`updateFixedAsset` accept `workCenterId`; add `getFixedAssetTransfers(client, fixedAssetId)`, `getFixedAssetCipCosts(client, fixedAssetId, companyId)`, `getFleetAssets(client, companyId, args: GenericQueryFilters & { search: string | null; fleetStatus: string | null })` (from the `fleetAssets` view, `count: LIST_COUNT`), `getUnderConstructionAssets(client, companyId)`, `getWorkCenterCapitalCost(client, workCenterId, companyId)` (assets with `workCenterId`, returning `nbv` and `monthlyDepreciation = acquisitionCost × (1 − residualValuePercent/100) ÷ usefulLifeMonths` for Straight Line, null otherwise), `setFixedAssetOutOfService(client, { id, companyId, reason, since, updatedBy })`, `returnFixedAssetToService(client, { id, companyId, updatedBy })`, `invokeAssetTransfer(client, body)` = `client.functions.invoke("post-asset-transfer", { body })`
- Modify: `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx` — when the asset's class `isConstructionInProgress`, the status written is `'Under Construction'` (both branches); depreciation-run creation already selects `Active` only — confirm in `depreciation-runs.new.tsx` and leave it
- Modify: `apps/erp/app/modules/accounting/ui/FixedAssets/FixedAssetStatus.tsx` — badge for `Under Construction`
- Copy from (precedent): `fixedAssetDisposalValidator` (L1026), `getFixedAssets` (L5968)

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** routes (Task 29).

### Task 29: Fleet routes and UI

**Depends on:** 24, 25, 28
**Files:**
- Create: `apps/erp/app/routes/x+/fixed-asset+/capitalize.tsx` (action + modal `FixedAssetCapitalizeForm`), `$fixedAssetId.return-to-inventory.tsx`, `$fixedAssetId.attach-job.tsx`, `$fixedAssetId.capitalize.tsx`, `$fixedAssetId.out-of-service.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/fleet.tsx`
- Create: `apps/erp/app/modules/accounting/ui/FixedAssets/FleetAssetsTable.tsx`, `FixedAssetCapitalizeForm.tsx`, `FixedAssetReturnToInventoryForm.tsx`, `FixedAssetAttachJobForm.tsx`, `FixedAssetCapitalizeCipForm.tsx`, `FixedAssetOutOfServiceForm.tsx`, `FixedAssetCipCosts.tsx` (export all from `ui/FixedAssets/index.ts`)
- Modify: `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.tsx` — loader adds transfers + cip costs; dropdown (L178–209) gains Attach job / Capitalize (CIP class only), Return to inventory (`itemId` set, Active/Fully Depreciated), Take out of service / Return to service; a `FixedAssetCipCosts` card when the class is CIP; the work-center name in the header
- Modify: `apps/erp/app/modules/accounting/ui/FixedAssets/FixedAssetForm.tsx` — `<WorkCenter name="workCenterId" label={t\`Work center\`} isOptional />` (selector exists in `~/components/Form`)
- Modify: `apps/erp/app/modules/inventory/ui/Inventory/InventoryStorageUnits.tsx` — dropdown item "Capitalize as fixed asset" gated `item.trackedEntityId` (copy L328–335), linking to `path.to.fixedAssetCapitalize` with `?itemId&trackedEntityId&locationId&storageUnitId`
- Modify: `apps/erp/app/modules/resources/ui/WorkCenters/WorkCenterForm.tsx` + `apps/erp/app/routes/x+/resources+/work-centers.$id.tsx` — loader adds `getWorkCenterCapitalCost`; the form gains a read-only `<Subheading variant="heavy">Capital cost</Subheading>` section listing assets, NBV, monthly depreciation (props `capitalCost?: …`)
- Modify: `apps/erp/app/utils/path.ts` — `fleet`, `fixedAssetCapitalize`, `fixedAssetReturnToInventory(id)`, `fixedAssetAttachJob(id)`, `fixedAssetCapitalizeCip(id)`, `fixedAssetOutOfService(id)`; `useAccountingSubmodules.tsx` — `Fleet` entry in the `Fixed Assets` group
- Copy from (precedent): `$fixedAssetId.dispose.tsx` + `FixedAssetDisposalForm.tsx` (modal action shape), `FixedAssetsTable.tsx` (table), `x+/accounting+/fixed-assets.tsx` (list route)

**Steps:**
1. Every action: `assertIsPost` → `requirePermissions({ create: "accounting" })` (out-of-service: `update: "accounting"`) → `validator(...)` → `invokeAssetTransfer` (or the two service updates for out-of-service) → flash + `redirect(path.to.fixedAsset(id))`. Show the edge function's `error` message in the flash.
2. `capitalize.tsx` loader (`view: "accounting"`): prefill from search params; `getFixedAssetClassesList` filtered non-CIP with `Rental Fleet` preselected; cost preview = `itemCost.unitCost` for the item.
3. `fleet.tsx`: `getFleetAssets`; `FleetAssetsTable` columns readable id, item, serial, class, `fleetStatus` badge (static filter over the seven values), NBV, work center, out-of-service reason; row actions Take out of service / Return to service / Return to inventory / Rent (Rent is added in Task 43); header action **Build for fleet** → `path.to.newJob` with `?fixedAssetClassId=<Rental Fleet id>` (the job `new` route reads it into `initialValues`).
4. Out-of-service form: `reason` TextArea; `?intent=return` variant posts `returnFixedAssetToService`. Reject when a live rental line exists (Task 43 adds the check once the table exists).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: exit 0 twice
```

**Out of scope:** rental agreement Rent action (Task 43).

### Task 30: Phase B docs, rules, AGENTS

**Depends on:** 29
**Files:**
- Modify: `.claude/rules/fixed-asset-lifecycle.md` — replace `disposalAccountId` with the gain/loss columns (migration `20260717031529`); add Acquire path 3 (Make: `complete_job_to_inventory` job→asset), CIP (attach / complete / capitalize), transfers, `Under Construction`, fleet register, out of service, work-center link, `post-asset-transfer`; `paths:` gains `packages/database/supabase/functions/post-asset-transfer/**`
- Modify: `apps/erp/app/modules/accounting/AGENTS.md` (tables `fixedAssetTransfer`, `fixedAssetCipCost`, `fleetAssets`; new service functions), `apps/erp/app/modules/production/AGENTS.md` (job completion: newest migration name, the asset branch and its two guards), `apps/erp/app/modules/inventory/AGENTS.md` (the Capitalize row action)
- Modify: `docs/content/docs/reference/fixed-assets.mdx` — new **Make** acquisition path, CIP, fleet register, out of service; update the callout that says Carbon keeps no link between a work center and an asset; use the `carbon-docs` skill
- Modify: `packages/glossary/src/terms.ts` — `rental-fleet`, `construction-in-progress`, `make-to-asset`, `out-of-service`

**Verify:**
```bash
pnpm --filter docs build 2>&1 | tail -3
# Expected: build succeeds
```

**Out of scope:** rental docs (Task 45).

### Task 31: Phase B browser verification

**Depends on:** 30
**Files:** none

**Steps:**
1. `/auth` then `/test`: (a) create a serialized item VEH-100, a job for 2 units with Complete to = Rental Fleet, run its operations, Complete → two Active assets at the WIP cost, VEH-100 on-hand unchanged, tracked entities Consumed with the Fixed Asset attribute, journal `Asset Transfer`; (b) capitalize a stocked serial from the item inventory page → Dr 1370 / Cr 1220 at carrying cost, on-hand −1, inventory tie-out unchanged; (c) CIP: asset W-1 in the CIP class, attach an in-progress job (WIP 2,500) → Dr 1390 / Cr 1230 2,500 and a cost row; complete the job → second row; Fixed Asset PO line 6,000 invoiced → third row; Capitalize to Machinery & Equipment in-service 2026-11-01 → Dr 1350 / Cr 1390 10,000, Active, excluded from the October run, 83.33 in November; (d) link W-1 to a work center → capital-cost section shows it; (e) take VIN-001 out of service → `In Maintenance`, still depreciates, Return to service → Available; (f) Return VIN-001 to inventory at NBV → Dr 1220 / Dr 1380 / Cr 1370, entity Available, sell it on a normal sales order → revenue + COGS at NBV.
2. Evidence in `.ai/runs/2026-09-22-revenue-recognition-and-rentals.md`.

**Verify:**
```bash
ls .ai/runs/2026-09-22-revenue-recognition-and-rentals.md
# Expected: file exists with (a)–(f) marked pass
```

**Out of scope:** rentals.

---

## Phase C — Rental agreements (operating)

### Task 32: Migration — rental enums

**Depends on:** 13, 29
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_rental-enums.sql` via `pnpm db:migrate:new rental-enums`
- Copy from (precedent): Task 2

**Steps:**
1. Contents:
```sql
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Rental Agreement';
ALTER TYPE "itemLedgerDocumentType"  ADD VALUE IF NOT EXISTS 'Rental Agreement';
ALTER TYPE "salesInvoiceLineType"    ADD VALUE IF NOT EXISTS 'Rental';

DO $rentenums$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalAgreementStatus') THEN CREATE TYPE "rentalAgreementStatus" AS ENUM ('Draft', 'Active', 'Closed', 'Cancelled'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalAgreementLineStatus') THEN CREATE TYPE "rentalAgreementLineStatus" AS ENUM ('Pending', 'On Rent', 'Returned', 'Sold'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalBillingCycle') THEN CREATE TYPE "rentalBillingCycle" AS ENUM ('Calendar Month', '28 Days'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalBillingTiming') THEN CREATE TYPE "rentalBillingTiming" AS ENUM ('Advance', 'Arrears'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalBillingPeriodStatus') THEN CREATE TYPE "rentalBillingPeriodStatus" AS ENUM ('Pending', 'Invoiced'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalInvoiceLineKind') THEN CREATE TYPE "rentalInvoiceLineKind" AS ENUM ('Rent', 'Charge', 'Purchase Option'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalRateUnit') THEN CREATE TYPE "rentalRateUnit" AS ENUM ('Day', 'Week', 'Month'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rentalRateMode') THEN CREATE TYPE "rentalRateMode" AS ENUM ('Best Rate', 'Fixed'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lessorClassification') THEN CREATE TYPE "lessorClassification" AS ENUM ('Operating', 'Sales-Type', 'Direct Financing'); END IF;
END $rentenums$;
```

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -1
# Expected: <ts>_rental-enums.sql
```

**Out of scope:** tables (Task 33).

### Task 33: Migration — rental tables, invoice/payment columns, view, sequence, lease settings

**Depends on:** 32
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_rental-agreements.sql` via `pnpm db:migrate:new rental-agreements`
- Copy from (precedent): Task 3 (RLS/sequence/view shapes), `20260908142501_returns-module.sql` (document + line tables with composite child FKs)

**Steps:**
1. Tables from the spec's Data Model §5, with these amendments: `rentalAgreement` gains `"taxPercent" NUMERIC NOT NULL DEFAULT 0` (plan decision 4); `rentalAgreementCharge` gains `"kind" "rentalInvoiceLineKind" NOT NULL DEFAULT 'Charge'` (decision 5); `rentalBillingPeriod` gains `"createdBy" TEXT NOT NULL REFERENCES "user"("id")`, `"updatedBy" TEXT REFERENCES "user"("id")`, `"updatedAt" TIMESTAMP WITH TIME ZONE`; `rentalAgreementLine` includes the classification columns exactly as in the spec (Phase C writes `'Operating'`). Add the `<table>_companyId_fkey` FOREIGN KEY to `company` `ON DELETE CASCADE ON UPDATE CASCADE` on every new table, indexes on `companyId` and every FK, and the four RLS policies gated `sales_view`(SELECT) / `sales_create` / `sales_update` / `sales_delete` on `itemRentalRate`, `rentalAgreement`, `rentalAgreementLine`, `rentalAgreementCharge`, `rentalBillingPeriod`. `rentalAgreement."customerId"` FK → `customer(id)`; `"locationId"` → `location(id)`; `"paymentTermId"` → `paymentTerm(id)`.
2. `salesInvoiceLine`: the five rental columns + `salesInvoiceLine_rental_check` from the spec (guarded `DO`), then `DROP VIEW IF EXISTS "salesInvoiceLines"; CREATE VIEW "salesInvoiceLines" …` from the body Task 3 used.
3. `payment`: `ADD COLUMN IF NOT EXISTS "salesOrderId" TEXT REFERENCES "salesOrder"("id") ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS "rentalAgreementId" TEXT` + guarded FK `("rentalAgreementId","companyId") REFERENCES "rentalAgreement"("id","companyId") ON DELETE SET NULL` + guarded `CHECK (num_nonnulls("salesOrderId", "rentalAgreementId") <= 1)` named `payment_deposit_document_check`. Recreate any `payment`-based `p.*` view (grep `VIEW "payments"`) with DROP + CREATE from its newest definition.
4. `companySettings`: `"leaseMajorPartThresholdPercent" NUMERIC NOT NULL DEFAULT 75`, `"leaseSubstantiallyAllThresholdPercent" NUMERIC NOT NULL DEFAULT 90`, `"leaseDefaultDiscountRate" NUMERIC NOT NULL DEFAULT 6`.
5. Sequence per company: `('rentalAgreement', 'Rental Agreement', 'RA', NULL, 0, 6, 1)`.
6. Views: recreate `fleetAssets` (DROP + CREATE) adding `LEFT JOIN LATERAL (SELECT ral.status, ral."rentalAgreementId", ra."customerId", ra."customerLocationId" FROM "rentalAgreementLine" ral JOIN "rentalAgreement" ra ON ra.id = ral."rentalAgreementId" AND ra."companyId" = ral."companyId" WHERE ral."fixedAssetId" = fa.id AND ral."companyId" = fa."companyId" AND ral.status IN ('Pending','On Rent') ORDER BY ral."createdAt" DESC LIMIT 1) live ON TRUE` and the full precedence `CASE` (Sold, Returned to Stock, Under Construction, `live.status = 'On Rent'` → On Rent, In Maintenance, `live.status = 'Pending'` → Reserved, Available), exposing `customerId`, `customerLocationId`, `rentalAgreementId`. New `rentalAgreements` view: header ⨝ `customer.name`, `lineCount`, `onRentCount`, `nextDueOn` (min Pending `dueOn`), `unbilledAmount` (Σ Pending amounts).
7. `NOTIFY pgrst, 'reload schema';`

**Verify:**
```bash
pnpm db:migrate && pnpm db:check:backups
# Expected: migrations apply; backup compatibility check passes (new tables are companyId-scoped)
```

**Out of scope:** lessor schedule table (Task 48).

### Task 34: Apply migrations and regenerate types

**Depends on:** 33
**Files:** `packages/database/src/types.ts` (generated)

**Verify:**
```bash
pnpm db:migrate && pnpm run generate:types && pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0; types contain rentalAgreement, rentalBillingPeriod, rentalInvoiceLineKind
```

**Out of scope:** app code.

### Task 35: Seeds for new companies (rental sequence)

**Depends on:** 34 (parallel-safe)
**Files:**
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` — `sequences` gains `{ table: "rentalAgreement", name: "Rental Agreement", prefix: "RA", suffix: null, next: 0, size: 6, step: 1 }`

**Verify:**
```bash
pnpm db:check:datasets
# Expected: exit 0
```

**Out of scope:** existing companies (Task 33).

### Task 36: Shared rental billing math + validators

**Depends on:** 34 (parallel-safe)
**Files:**
- Create: `packages/database/supabase/functions/shared/rental-billing.ts`, `shared/rental-billing.test.ts`
- Create: `packages/utils/src/rental-billing.ts` (re-export, exported from `packages/utils/src/index.ts`)
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `rentalAgreementValidator` (customerId required; customerLocationId/contactId/salesPersonId optional; locationId required; startDate required; endDate optional; billingCycle enum; billingTiming enum; paymentTermId optional; currencyCode required; depositAmount numeric ≥ 0; taxPercent 0–1 fraction; discountRate numeric; ownershipTransfers/specializedAsset `zfd.checkbox()`; purchaseOptionAmount optional numeric; purchaseOptionReasonablyCertain checkbox; notes) with refines "endDate > startDate" and "purchaseOptionReasonablyCertain requires endDate"; `rentalAgreementLineValidator` (fixedAssetId required in Phase C, rateMode, rateUnit optional, fairValue/economicLifeMonths/residuals optional numerics) with refine "Fixed ⇒ rateUnit"; `rentalAgreementChargeValidator` (chargeDate, description, amount, taxPercent, kind default Charge); `rentalAgreementReturnValidator` (returnedAt, meterIn?, returnNotes?, takeOutOfService checkbox, outOfServiceReason?); `itemRentalRateValidator` (itemId, currencyCode, dayRate?/weekRate?/monthRate? with refine ≥ 1 tier); status arrays `rentalAgreementStatuses`, `rentalAgreementLineStatuses`, `rentalBillingCycles`, `rentalBillingTimings`, `rentalRateUnits`, `rentalRateModes`
- Copy from (precedent): Task 6 (import-free calendar math), `salesOrderValidator` (L838–857)

**Steps:**
1. `rental-billing.ts` (imports only `./precision.ts` and `./revenue-schedule.ts` for `daysInMonth`/`monthEnd`/`daysBetweenInclusive`):
```ts
export type RateLadder = { dayRate: number | null; weekRate: number | null; monthRate: number | null };
export type RateUnit = "Day" | "Week" | "Month";
export function bestRateCharge(days: number, rates: RateLadder): { amount: number; rateUnitApplied: RateUnit; units: number }
   // candidates: days×dayRate (Day, units=days), ceil(days/7)×weekRate (Week), ceil(days/28)×monthRate (Month); skip null tiers; minimum amount; ties → the larger unit; throws when no tier
export function fixedRateCharge(days: number, unit: RateUnit, rates: RateLadder): { amount: number; rateUnitApplied: RateUnit; units: number }
export function calendarMonthCharge(periodStart: string, periodEnd: string, monthRate: number): number   // monthRate × days ÷ daysInMonth(periodStart's month), round()
export type PeriodSpec = { periodStart: string; periodEnd: string; days: number; amount: number; rateUnitApplied: RateUnit | null; dueOn: string; isAdjustment: boolean };
export function generateRentalBillingPeriods(args: { cycle: "Calendar Month" | "28 Days"; timing: "Advance" | "Arrears"; rateMode: "Best Rate" | "Fixed"; rateUnit: RateUnit | null; rates: RateLadder; startDate: string; endDate: string | null; returnedAt: string | null; through: string; existing: Array<{ periodStart: string; periodEnd: string; amount: number; status: "Pending" | "Invoiced"; isAdjustment: boolean }> }): { create: PeriodSpec[]; recut: Array<{ periodStart: string; periodEnd: string; days: number; amount: number; rateUnitApplied: RateUnit | null }>; adjustments: PeriodSpec[] }
```
   Rules: Calendar Month periods are calendar months from `startDate` (first partial) to `through`, or to `endDate`/`returnedAt` when earlier (last partial), priced by `calendarMonthCharge`; 28 Days periods are consecutive 28-day windows from `startDate`, last one cut at `returnedAt` or `endDate`; open-ended agreements generate one period beyond `through` (rolling); a unit past `endDate` with no `returnedAt` keeps generating (holdover); an `existing` Pending period overlapping `returnedAt` is re-cut (`recut`); an `existing` Invoiced period overlapping `returnedAt` with Advance timing yields one adjustment `{ amount: −(billed − charge(daysUsed)), isAdjustment: true, dueOn: returnedAt }` when that difference is positive (28 Days: `charge` = best/fixed rate of the used days; Calendar Month: `calendarMonthCharge` of the used days); never a positive adjustment. `dueOn` = `periodStart` (Advance) or `periodEnd` (Arrears).
2. Tests (Deno) pinning: 3 days → 300 Day; 10 → 1,000 Week (tie); 20 → 1,500 Month (tie); 35 days on 28 Days = 1,500 + 500 across two periods; a year on rent → 13 periods; Fixed Week on 10 days → 1,000; Advance 28 Days start 2026-10-01 end 2026-10-28 returned 2026-10-03 with the first period Invoiced at 1,500 → one adjustment −1,200; returned 2026-10-20 → no adjustment; Calendar Month 1,500/month start 2026-10-15 → 822.58; return 2027-01-10 → final 483.87; holdover past 2026-10-31 → a November period exists; return 2026-11-10 → 500.00.
3. `packages/utils/src/rental-billing.ts` re-export as in Task 6; `sales.models.ts` validators as listed (every enum value comes from the exported const arrays, never a string literal at the call site).

**Verify:**
```bash
(cd packages/database/supabase/functions && deno task test shared/rental-billing.test.ts)
pnpm exec turbo run typecheck --filter=@carbon/utils && pnpm exec turbo run typecheck --filter=erp
# Expected: pass; exit 0 twice
```

**Out of scope:** escalations, anniversary cycles.

### Task 37: Rental CRUD services + invoice generation

**Depends on:** 34, 36
**Files:**
- Create: `packages/database/src/rental-billing.ts` (+ `exports` entry `"./rental-billing"` in `packages/database/package.json`)
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `getRentalAgreements(client, companyId, args)` (view `rentalAgreements`, `count: LIST_COUNT`, search on `rentalAgreementId`/customer name), `getRentalAgreement(client, id)`, `insertRentalAgreement(client, {...})` (readable id via DB default? — NO default exists: call `getNextSequence(client, "rentalAgreement", companyId)` from `~/modules/settings` in the route and pass `rentalAgreementId`), `updateRentalAgreement`, `deleteRentalAgreement` (Draft only), `getRentalAgreementLines(client, rentalAgreementId)` (embed `fixedAsset(id, fixedAssetId, name, serialNumber)`, `item(readableIdWithRevision, name)` by target table name), `upsertRentalAgreementLine`, `deleteRentalAgreementLine`, `getRentalAgreementCharges`, `upsertRentalAgreementCharge`, `deleteRentalAgreementCharge`, `getRentalBillingPeriods(client, rentalAgreementId)`, `getRentableFleetAssets(client, companyId)` (`fleetAssets` where `fleetStatus = 'Available'`), `getItemRentalRate(client, itemId, companyId)`, `upsertItemRentalRate`, `deleteItemRentalRate`, `getRentalAgreementDeposits(client, rentalAgreementId)` (payments where `rentalAgreementId`)
- Modify: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.delete.tsx` (or wherever a Draft sales invoice is deleted — `grep -rn "deleteSalesInvoice" apps/erp/app/routes`) — before deleting, un-stamp: `UPDATE rentalBillingPeriod SET status='Pending', salesInvoiceLineId=NULL WHERE salesInvoiceLineId IN (lines of this invoice)` and the same for `rentalAgreementCharge`; do it through a Kysely transaction in `sales.server.ts` `releaseRentalInvoiceStamps(db, { invoiceId, companyId })`
- Copy from (precedent): `sales.service.ts` `getSalesOrders`/`insertSalesOrder`/`upsertSalesOrderLine`; `packages/database/supabase/functions/convert/index.ts:864-961` (invoice + line inserts, including the readable-id-then-UUID ordering gotcha at L900)

**Steps:**
1. `packages/database/src/rental-billing.ts`:
```ts
export async function createRentalInvoicesForDuePeriods(db: Kysely<KyselyDatabase>, args: { companyId: string; asOf: string; rentalAgreementId?: string; userId: string }): Promise<{ invoiceIds: string[] }>
```
   One transaction per agreement (loop outside the transaction): select Active agreements (optionally one) having Pending `rentalBillingPeriod` rows with `dueOn <= asOf` or `rentalAgreementCharge` rows with `salesInvoiceLineId IS NULL`; skip agreements with nothing due; `invoiceReadableId = getNextSequence(trx, "salesInvoice", companyId)`; insert `salesInvoice` copying the convert header shape (`status 'Draft'`, `customerId`, `invoiceCustomerId = customerId`, `invoiceCustomerContactId/LocationId` from the agreement, `locationId`, `paymentTermId`, `currencyCode`, `exchangeRate`, `dateIssued = asOf`, `subtotal/totalAmount` = Σ line amounts, `totalTax` = Σ line amount × taxPercent, `opportunityId null`, `companyId`, `createdBy`) then `salesInvoiceShipment` with `id = invoice.id`, `locationId`, `shippingCost 0`; one `salesInvoiceLine` per period (`invoiceLineType 'Rental'`, `rentalInvoiceLineKind 'Rent'`, `rentalAgreementId`, `rentalAgreementLineId`, `rentalBillingPeriodId`, `serviceStartDate = periodStart`, `serviceEndDate = periodEnd`, `description = \`${days} days · ${units} × ${unit} rate — ${asset name} ${serial}\`` or for an adjustment `\`Early return credit — ${days} days used\``, `quantity 1`, `unitPrice = amount` (negative for adjustments), `taxPercent = agreement.taxPercent`, `methodType 'Pull from Inventory'` explicitly (NOT NULL column — lesson), `unitOfMeasureCode 'EA'`, `exchangeRate`, `sortOrder`, `locationId`, `companyId`, `createdBy`) and per charge (`kind` → `rentalInvoiceLineKind`, `rentalAgreementChargeId`, `unitPrice = charge.amount`, `taxPercent = charge.taxPercent`); stamp `rentalBillingPeriod.status = 'Invoiced', salesInvoiceLineId` and `rentalAgreementCharge.salesInvoiceLineId`. Every statement carries `companyId`.
2. `sales.server.ts`: `generateRentalInvoicesNow(db, args)` thin wrapper; `releaseRentalInvoiceStamps`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database && pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 twice
```

**Out of scope:** posting (Task 39).

### Task 38: Edge function `post-rental-agreement`

**Depends on:** 37
**Files:**
- Create: `packages/database/supabase/functions/post-rental-agreement/index.ts` via `pnpm db:function:new post-rental-agreement`, `post-rental-agreement/validators.ts` + `.test.ts`
- Modify: `packages/database/supabase/config.toml` (`[functions.post-rental-agreement]`, same four lines)
- Modify: `packages/database/supabase/functions/post-asset-transfer/index.ts` — `return` now also refuses an asset with a live `rentalAgreementLine` (`status IN ('Pending','On Rent')`)
- Copy from (precedent): `post-asset-transfer/index.ts` (Task 24), `shared/rental-billing.ts`

**Steps:**
1. Payload union, all with `companyId`, `userId`, `rentalAgreementId`: `activate {}`, `return { rentalAgreementLineId, returnedAt, meterIn?, returnNotes?, takeOutOfService?: boolean, outOfServiceReason? }`, `close {}`, `cancel {}`. `requirePermissions(req, companyId, userId, { update: "sales" })`; re-read the agreement under `companyId`, 404 on miss.
2. `activate` (one transaction): agreement `Draft`; every line: `fixedAssetId` set, asset `fleetStatus = 'Available'` (read the `fleetAssets` view — `Reserved`/`On Rent` → error naming the other agreement; `In Maintenance` → error naming `outOfServiceReason`); snapshot rates: `itemRentalRate` for `(asset.itemId, agreement.currencyCode)` → `dayRate/weekRate/monthRate` on the line (Calendar Month requires `monthRate`; 28 Days requires ≥ 1 tier; `Fixed` requires that tier); `lessorClassification = 'Operating'` (Task 51 replaces this line); `generateRentalBillingPeriods({...line, startDate: agreement.startDate, endDate, returnedAt: null, through: today + one cycle, existing: [] })` → insert `create` rows; line `status = deliveredAt ? 'On Rent' : 'Pending'`; header `status 'Active'`, `activatedAt`. No journal.
3. `return`: line `On Rent` (or `Pending`, which just cancels the line's future periods); set `returnedAt`, `meterIn`, `returnNotes`, `status 'Returned'`; load `existing` periods; run the generator with `returnedAt` → delete Pending periods after `returnedAt`, apply `recut` (update `periodEnd/days/amount/rateUnitApplied`), insert `adjustments`; when `takeOutOfService`: `UPDATE fixedAsset SET outOfServiceSince = returnedAt, outOfServiceReason`.
4. `close`: all lines `Returned`/`Sold` and no `Pending` period → `status 'Closed'`, `closedAt`. `cancel`: `Draft`, or `Active` with no `On Rent` line and no `Invoiced` period → delete Pending periods, `status 'Cancelled'`.
5. Return `{ id }` 200.

**Verify:**
```bash
(cd packages/database/supabase/functions && deno task test post-rental-agreement/validators.test.ts && deno check --no-lock post-rental-agreement/index.ts post-asset-transfer/index.ts)
# Expected: pass; no errors
```

**Out of scope:** sales-type activation (Task 51).

### Task 39: `post-sales-invoice` `Rental` case + VOID

**Depends on:** 38, 10
**Files:**
- Modify: `packages/database/supabase/functions/shared/sales-posting-amounts.ts` — `buildSalesPostingLines` accepts `invoiceLineType 'Rental'` (no item, no shipping; `salesRevenueBase = quantity × unitPrice`, may be negative) and a `revenueLeg` override `{ accountId, accountClass: "Revenue" | "Liability" | "Asset", description }` used instead of the Sales Account leg; negative bases produce mirrored signs; `assertBalanced` unchanged
- Modify: `packages/database/supabase/functions/post-sales-invoice/index.ts` — new `case "Rental"` next to the item-type case
- Copy from (precedent): Task 10's deferral branch

**Steps:**
1. Load per Rental line: `rentalAgreementLine` (+ `lessorClassification`), `rentalBillingPeriod` (when `rentalBillingPeriodId`), posted `Accrual` schedule rows for the line with `periodStart/periodEnd` overlapping the period and `billedBySalesInvoiceLineId IS NULL`.
2. Legs by kind (Phase C = Operating only; Task 52 adds Sales-Type):
   - `Rent`, positive: `accrued = Σ matching Accrual rows`; if `accrued > 0` push a leg `Cr contractAssetAccount` (class Asset, credit) for `min(accrued, base)` and stamp those rows `billedBySalesInvoiceLineId`; the remainder (if any) posts `Cr deferredRevenueAccount` and writes `Deferral` rows via `spreadStraightLine` over the period (debit 2160 / credit `rentalIncomeAccount`).
   - `Rent`, negative (adjustment): leg `Dr deferredRevenueAccount` (i.e. the revenue leg override with the liability account, mirrored sign); reduce the period's `Planned` Deferral row(s) by the absolute amount (delete when it reaches 0); if the row is already `Posted`, post the leg against `rentalIncomeAccount` instead.
   - `Charge`: `Cr rentalIncomeAccount`, no schedule rows.
   - `Purchase Option` (Phase C): reject with `"Purchase option billing requires a sales-type line"`.
   AR, tax legs as today; `documentType 'Rental Agreement'`, `documentId = rentalAgreementId` on the revenue/deferral/asset legs.
3. VOID: mirror every leg; delete the line's Planned Deferral rows (throw when any is Posted, as Task 10); clear `billedBySalesInvoiceLineId` on accruals this line consumed; `rentalBillingPeriod` → `status 'Pending'`, `salesInvoiceLineId NULL`; `rentalAgreementCharge.salesInvoiceLineId NULL`.

**Verify:**
```bash
(cd packages/database/supabase/functions && deno task test shared/sales-posting-amounts.test.ts && deno check --no-lock post-sales-invoice/index.ts)
# Expected: pass (add cases: Rental line to a Liability revenue leg; negative Rental line) ; no errors
```

**Out of scope:** provider sync of Rental lines (Task 45 spike note).

### Task 40: Accrual synthesis in the run + evaluator extension

**Depends on:** 12, 38
**Files:**
- Modify: `packages/database/src/revenue-recognition.ts` — `synthesizeRentalAccruals` registered in `RUN_ROW_SYNTHESIZERS`
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `computePeriodReadiness` `unposted-revenue-schedules` also counts operating lines on rent during the period with no Accrual row for it
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.post.tsx` — resolve a `Customer` dimension for Accrual rows via `rentalAgreement.customerId` (Task 12 already handles it when the column exists)

**Steps:**
1. `synthesizeRentalAccruals(trx, { companyId, periodEnd, userId })`: accounting period = calendar month ending `periodEnd` (`periodStart` = first of that month); for each `rentalAgreementLine` with `lessorClassification = 'Operating'` and `status IN ('On Rent','Returned')` whose `[deliveredAt, returnedAt ?? ∞]` overlaps the month: for each `rentalBillingPeriod` of the line with `status = 'Pending'` (unbilled) overlapping the month, `accrual = round(period.amount × overlapDays ÷ period.days)`; skip when an Accrual row for `(rentalAgreementLineId, periodStart, periodEnd)` exists (idempotent); insert `revenueRecognitionSchedule` `{ type 'Accrual', status 'Planned', rentalAgreementLineId, periodStart, periodEnd, scheduledDate = periodEnd, amount, debitAccountId = accountDefault.contractAssetAccount, creditAccountId = accountDefault.rentalIncomeAccount, createdBy }`. Amounts in base currency (agreement currency must equal base in Phase C — enforce in Task 38 activation with the message "Rental agreements in a foreign currency are not supported yet").
2. Evaluator: count `rentalAgreementLine` rows (Operating, `On Rent` during the period) lacking an Accrual row whose `periodEnd = endDate` → add to `count`, keep one check object.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database && pnpm exec turbo run typecheck --filter=erp && pnpm --filter erp test app/modules/accounting/accounting.periods.test.ts
# Expected: exit 0; pass
```

**Out of scope:** Interest rows (created at activation, Task 51).

### Task 41: Customer deposits in `post-payment`

**Depends on:** 34 (parallel-safe)
**Files:**
- Modify: `packages/database/supabase/functions/shared/accounting-posting.ts` — `export const CUSTOMER_DEPOSIT_DESCRIPTION = "Customer Deposit"` (a NEW description; the prior-credit lookup keys on `onAccountCreditDescription`, so the deposit must not reuse it)
- Modify: `packages/database/supabase/functions/post-payment/build-payment-journal.ts` — `BuildPaymentJournalInput` gains `depositAccountId: string | null` and `isDeposit: boolean`; the unapplied leg (L276–284) posts `credit("liability", newOnAccountBase)` on `depositAccountId` with `CUSTOMER_DEPOSIT_DESCRIPTION` when `isDeposit && isAR && cashIn`
- Modify: `packages/database/supabase/functions/post-payment/post-payment-transaction.ts` — `isDeposit = Boolean(payment.rentalAgreementId ?? payment.salesOrderId)`; pass `accountDefaults.prepaymentAccount` as `depositAccountId`; the source-control lookup (L590–614) also matches `line.description = CUSTOMER_DEPOSIT_DESCRIPTION` so applying or refunding a deposit releases from 2110 (`priorCreditReleased` keyed by that account, L228–234 / L285–293 already handle a non-AR source account); refund path unchanged
- Modify: `packages/database/supabase/functions/post-payment/build-payment-journal.test.ts` — cases: deposit receipt 3,000 → Dr cash / Cr 2110; applying 500 to an invoice → Dr 2110 / Cr AR; Disbursement refund 2,500 funded by the deposit → Dr 2110 / Cr cash
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` `paymentValidator` — `salesOrderId`, `rentalAgreementId` optional with refine "at most one"; `apps/erp/app/modules/invoicing/ui/Payment/PaymentForm.tsx` — a "Deposit for" `Combobox` (customer Receipts only) listing the customer's Active rental agreements and open sales orders; `upsertPayment` passes both columns
- Copy from (precedent): the on-account leg and the `sourceControlById` lookup in the two files above

**Verify:**
```bash
(cd packages/database/supabase/functions && deno task test post-payment/build-payment-journal.test.ts post-payment/post-payment-transaction.test.ts)
pnpm exec turbo run typecheck --filter=erp
# Expected: pass; exit 0
```

**Out of scope:** deposit auto-application on close.

### Task 42: Inngest daily rental billing

**Depends on:** 37
**Files:**
- Create: `packages/jobs/src/inngest/functions/scheduled/rental-billing.ts`
- Modify: `packages/jobs/src/inngest/functions/scheduled/index.ts`, `packages/jobs/src/inngest/index.ts` (both registration points)
- Copy from (precedent): Task 15

**Steps:**
1. `rentalBillingFunction` (`id: "rental-billing"`, cron `0 5 * * *`): per company `step.run` → `asOf = datetime.today(await getCompanyTimeZone(serviceRole, company.id))` → `createRentalInvoicesForDuePeriods(getJobDatabaseClient(), { companyId, asOf, userId: "system" })` from `@carbon/database/rental-billing`; log invoice ids; skip companies with no Active agreements (one cheap Kysely count first).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** email notifications.

### Task 43: Rental agreement routes and UI, item rate ladder, invoice line display

**Depends on:** 38, 39, 41
**Files:**
- Create: `apps/erp/app/routes/x+/sales+/rental-agreements.tsx`; `apps/erp/app/routes/x+/rental-agreement+/{_layout,new,$id,$id._index,$id.details,$id.lines.new,$id.$lineId.details,$id.$lineId.delete,$id.charges.new,$id.charges.$chargeId.delete,$id.activate,$id.deliver,$id.$lineId.return,$id.invoice,$id.status,$id.delete}.tsx`
- Create: `apps/erp/app/modules/sales/ui/Rentals/{RentalAgreementsTable,RentalAgreementForm,RentalAgreementHeader,RentalAgreementLines,RentalAgreementLineForm,RentalAgreementChargeForm,RentalAgreementReturnForm,RentalBillingPeriods,RentalDeposits,RentalStatus,index}.tsx`
- Create: `apps/erp/app/modules/items/ui/Item/ItemRentalRateForm.tsx`; Modify: `apps/erp/app/routes/x+/part+/$itemId.sales.tsx` (loader `getItemRentalRate`; action intent `rentalRate` → `upsertItemRentalRate`)
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm.tsx` — when `invoiceLineType === "Rental"` render a read-only summary (agreement, period, kind) instead of the item/asset tabs; `salesInvoiceLineValidator` refines exempt `Rental` (no item, no location, no methodType)
- Modify: `apps/erp/app/modules/accounting/ui/FixedAssets/FleetAssetsTable.tsx` — **Rent** row action → `path.to.newRentalAgreement + "?fixedAssetId="`
- Modify: `apps/erp/app/utils/path.ts` (`rentalAgreements`, `newRentalAgreement`, `rentalAgreement(id)`, `rentalAgreementDetails`, `rentalAgreementLine(id, lineId)`, `newRentalAgreementLine`, `rentalAgreementActivate/Deliver/Invoice/Status/Delete(id)`, `rentalAgreementLineReturn(id, lineId)`, `rentalAgreementCharges…`, `partRentalRate(itemId)`), `apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx` (`Manage` group: `{ name: t\`Rental Agreements\`, to: path.to.rentalAgreements, icon: <LuKeyRound />, table: "rentalAgreement" }`)
- Copy from (precedent): `x+/sales+/orders.tsx` + `x+/sales-order+/*` (`new.tsx`, `$orderId.tsx` shell with `PanelProvider`/`ResizablePanels`, `$orderId.details.tsx` action shape with `requireUnlocked`, `$orderId.new.tsx` line action, `$orderId.status.tsx`), `ui/SalesOrder/{SalesOrdersTable,SalesOrderForm,SalesOrderHeader,SalesOrderLineForm (ModalCard),SalesStatus}.tsx`, `ItemSalePriceForm.tsx` (Card form with `INPUT_FORMAT.rate`), `x+/invoicing+/card-transactions.$id.tsx` (Drawer child)

**Steps:**
1. `new.tsx` action (`create: "sales"`): `rentalAgreementId = getNextSequence(client, "rentalAgreement", companyId)` (`~/modules/settings`), `discountRate` defaults from `companySettings.leaseDefaultDiscountRate`, `currencyCode` from the company base currency; `insertRentalAgreement`; redirect to details. `?fixedAssetId=` pre-creates one line after the header (Draft).
2. `$id.tsx` shell: header (readable id, customer, status badge, actions Activate / Generate invoices / Close / Cancel / Delete with `Confirm` modals; Activate modal shows the lines and, for Sales-Type lines after Task 51, the commencement journal preview), explorer = lines list, properties = dates/cycle/timing/deposit. Tabs via nested routes: details (header form), lines, charges, periods (`RentalBillingPeriods` table: period, days, tier, amount, status, invoice link, adjustment flag), deposits (`RentalDeposits`: `getRentalAgreementDeposits`).
3. Line form (`ModalCard`, copy `SalesOrderLineForm` structure): fleet unit `Combobox` from `getRentableFleetAssets` (locked after activation), `rateMode` Select, `rateUnit` Select (shown when Fixed), the three tier values read-only after activation (from the snapshot) or from `itemRentalRate` before, `fairValue`, `economicLifeMonths`, `guaranteedResidualValue`, `unguaranteedResidualValue`, classification chip (Phase D).
4. Actions `activate`/`deliver`/`return`/`status`/`invoice`: `update: "sales"`; `deliver` = `client.from("rentalAgreementLine").update({ deliveredAt, status: "On Rent" })` gated on the asset not being out of service (read `fleetAssets`); the others call `client.functions.invoke("post-rental-agreement", { body })` or `generateRentalInvoicesNow(getDatabaseClient(), …)`; flash the function's error text.
5. `RentalAgreementsTable`: columns id, customer, status (static filter over `rentalAgreementStatuses`), start, end, units, next due, unbilled; `table="rentalAgreement" withSavedView`.
6. `ItemRentalRateForm`: Card with three `Number` fields (`INPUT_FORMAT.rate(baseCurrency, decimals)`), `Hidden itemId`, `Hidden currencyCode`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: exit 0 twice
```

**Out of scope:** sales-type UI (Task 54).

### Task 44: Utilization report

**Depends on:** 40
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getRentalUtilization(client, companyId, { from, to, fixedAssetClassId })`
- Create: `apps/erp/app/routes/x+/reports+/rental-utilization.tsx`; Modify: `x+/accounting+/reports.tsx` (card `rental-utilization`, category `t\`Operations\`` or the nearest existing category), `path.ts` (`rentalUtilization`)
- Copy from (precedent): Task 17

**Steps:**
1. Per fleet asset (`fixedAsset.itemId IS NOT NULL`): `fleetDays` = days the asset was not Disposed inside `[from, to]` (from `acquisitionDate` to `disposalDate ?? to`); `onRentDays` = Σ over its `rentalAgreementLine` rows of `[deliveredAt, returnedAt ?? to] ∩ [from, to]`; `timeUtilization = onRentDays ÷ fleetDays`; `recognizedIncome` = Σ `revenueRecognitionSchedule` rows `status 'Posted'` for the asset's lines with `scheduledDate` in range and `creditAccountId IN (rentalIncomeAccount, leaseInterestIncomeAccount)` plus posted `Charge` invoice lines; `dollarUtilization = recognizedIncome × (365 ÷ rangeDays) ÷ acquisitionCost`. One query per table with `.in()` on collected ids (no N+1); compute in TS with `round()` from `@carbon/utils`.
2. Route: filters `from`/`to`/`fixedAssetClassId`; `Table` (CSV built in) with a class-total row.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** Rouse-style benchmarks.

### Task 45: Phase C docs, rules, AGENTS

**Depends on:** 43, 44
**Files:**
- Modify: `apps/erp/app/modules/sales/AGENTS.md` (Rentals sub-area: tables, services, edge function, the `Rental` invoice line type, deposits), `apps/erp/app/modules/invoicing/AGENTS.md` (Rental lines, `payment.rentalAgreementId/salesOrderId`, `CUSTOMER_DEPOSIT_DESCRIPTION`), `apps/erp/app/modules/accounting/AGENTS.md` (accruals, utilization), `.claude/rules/fixed-asset-lifecycle.md` (fleet statuses On Rent/Reserved), `.claude/rules/accounting-sync-handlers.md` (note: a Rental invoice line has no item; provider mappers must send it as an account-costed line to the deferred-revenue account — Xero by account code; for QBO/Rillet run the plan-stage spike and, where a provider cannot represent it, exclude the document with a reason code and rely on the `Revenue Recognition` journals; record the outcome per provider)
- Create: `docs/content/docs/reference/rental-agreements.mdx` + entry in `docs/content/docs/reference/meta.json` next to `sales-orders`; glossary terms `rental-agreement`, `on-rent`, `cycle-billing`, `best-rate`, `customer-deposit`, `contract-asset`, `deferred-revenue`
- Copy from (precedent): `docs/content/docs/reference/sales-orders.mdx`, `fixed-assets.mdx` (StatusFlow component)

**Verify:**
```bash
pnpm --filter docs build 2>&1 | tail -3
# Expected: build succeeds
```

**Out of scope:** Phase D docs.

### Task 46: Phase C browser verification

**Depends on:** 45
**Files:** none

**Steps:**
1. `/auth` then `/test` the spec's Phase C acceptance criteria in order: rate ladder on VEH-100; RA-000001 Calendar Month Advance (822.58 first period, deferral, October run releases it, November 1,500 proposed once); the Arrears twin (accrual in October, invoice consumes it); a 120.00 mileage charge; deposit 3,000 → apply 500 → refund 2,500 (2110 nets to 0); 28 Days Best Rate returns after 3 / 10 / 20 / 35 days (300 / 1,000 Week / 1,500 Month / 2,000); Advance early return on day 3 → −1,200 credit line posting Dr 2160 / Cr AR and the Planned row at 300; return on day 20 → no adjustment; holdover past the end date; return with out-of-service ticked → `In Maintenance`; Return to inventory blocked while on rent; close checklist fails on an un-accrued month and passes after the run; utilization report numbers for Q4.
2. Evidence in `.ai/runs/2026-09-22-revenue-recognition-and-rentals.md`.

**Verify:**
```bash
ls .ai/runs/2026-09-22-revenue-recognition-and-rentals.md
# Expected: exists with every check marked pass
```

**Out of scope:** sales-type.

---

## Phase D — Sales-type leases

### Task 47: Migration — `'Lease'` source type

**Depends on:** 46
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_lease-enum.sql` via `pnpm db:migrate:new lease-enum`

**Steps:**
1. Contents: `ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Lease';`

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -1
# Expected: <ts>_lease-enum.sql
```

**Out of scope:** tables (Task 48).

### Task 48: Migration — lessor schedule table

**Depends on:** 47
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_lessor-schedule.sql` via `pnpm db:migrate:new lessor-schedule`
- Copy from (precedent): Task 33

**Steps:**
1. `rentalLeaseScheduleLine` exactly as the spec's Data Model §5 plus `createdBy`/`createdAt`/`updatedBy`/`updatedAt`, indexes on `companyId`, `rentalAgreementLineId`, `journalId`, RLS `sales_*`; guarded FK `revenueRecognitionSchedule."rentalLeaseScheduleLineId"` → `rentalLeaseScheduleLine("id","companyId") ON DELETE SET NULL`. `NOTIFY pgrst, 'reload schema';`

**Verify:**
```bash
pnpm db:migrate
# Expected: applies cleanly; second run is a no-op
```

**Out of scope:** lessee tables (#1056).

### Task 49: Apply migrations, regenerate types, `POSTING_POLICY` `'Lease'`, audit config

**Depends on:** 48
**Files:**
- Modify: `packages/database/src/types.ts` (generated); `packages/ee/src/accounting/core/models.ts` (`"Lease": { representation: "journal", defaultEnabled: false, defaultGranularity: "individual" }`); `packages/database/src/audit.config.ts` — register `rentalAgreementLine` as an auditable table / entity type so `insertAuditLogEntries` accepts it (copy the shape of an existing sales table entry)

**Verify:**
```bash
pnpm db:migrate && pnpm run generate:types && pnpm exec turbo run typecheck --filter=@carbon/database && pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** UI.

### Task 50: Shared lessor math + tests

**Depends on:** 49 (Deno part is parallel-safe with 49)
**Files:**
- Create: `packages/database/supabase/functions/shared/lessor-lease.ts`, `shared/lessor-lease.test.ts`
- Create: `packages/utils/src/lessor-lease.ts` (re-export, added to `packages/utils/src/index.ts`)
- Copy from (precedent): Task 6

**Steps:**
1. Import-free except `./precision.ts`:
```ts
export type Timing = "Advance" | "Arrears";
export function presentValue(args: { payment: number; periods: number; annualRate: number; timing: Timing; purchaseOption?: number; guaranteedResidual?: number; unguaranteedResidual?: number }): { pvPayments: number; pvResidual: number; netInvestment: number }
   // r = annualRate/100/12; annuity-immediate (Arrears) or annuity-due (Advance) for the payment stream; option + guaranteed residual discounted at period `periods` into pvPayments; unguaranteed residual into pvResidual; r = 0 ⇒ undiscounted sums
export function classifyLessorLease(inputs: { ownershipTransfers: boolean; purchaseOptionReasonablyCertain: boolean; termMonths: number | null; economicLifeMonths: number | null; pvPayments: number; fairValue: number | null; specializedAsset: boolean }, thresholds: { majorPartPercent: number; substantiallyAllPercent: number }): { classification: "Operating" | "Sales-Type"; tests: { a: boolean; b: boolean; c: boolean; d: boolean; e: boolean }; pvToFairValuePercent: number | null; termToLifePercent: number | null }
   // any test true ⇒ Sales-Type; termMonths null (open-ended) ⇒ c false and d evaluated only when fairValue > 0
export function buildLessorSchedule(args: { netInvestment: number; payment: number; periods: number; annualRate: number; timing: Timing; closingTarget: number; periodDates: string[] }): Array<{ periodDate: string; openingNetInvestment: number; paymentAmount: number; interestAmount: number; principalAmount: number; closingNetInvestment: number }>
   // interest = opening × r (Arrears; Advance: payment first, then interest on the remainder); last line absorbs rounding so closing === closingTarget (option + residuals)
```
2. Tests pin: 36 × 1,000 Arrears, 6 %, option 5,000 → `pvPayments 32,871.02`, `pvResidual 0`, option PV 4,178.22 folded in (`netInvestment 37,049.24`); classification Sales-Type with option reasonably certain and fair value 38,000 (`pvToFairValuePercent 97.5`); Operating when option not certain and fair value 60,000 (54.8 %, 30 % of life 120); open-ended ⇒ Operating; schedule month 1 interest 185.25 / principal 814.75 / closing 36,234.49, month 36 closing 5,000.00 exactly; zero-rate schedule; Advance timing PV (annuity-due) > Arrears PV.

**Verify:**
```bash
(cd packages/database/supabase/functions && deno task test shared/lessor-lease.test.ts)
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: pass; exit 0
```

**Out of scope:** direct financing inputs.

### Task 51: Activation classification + commencement posting + override route

**Depends on:** 50
**Files:**
- Modify: `packages/database/supabase/functions/post-rental-agreement/index.ts` (`activate`)
- Create: `apps/erp/app/routes/x+/rental-agreement+/$id.$lineId.classification.tsx` (override action, `update: "accounting"`, reason required, audit log)
- Copy from (precedent): `post-asset-transfer/index.ts` (Task 24: `bookAdjustment` with `accounting: null`, fleet derecognition legs from `buildReturnToInventoryLines`'s sibling), `apps/erp/app/routes/x+/acknowledge.tsx:82-100` (audit entry)

**Steps:**
1. `activate`, per line, before period generation: `termMonths` = whole months between `startDate` and `endDate` (null when open-ended); `pv = presentValue({ payment: monthRate (Calendar Month) or the 28-day equivalent bestRate(28) (28 Days), periods: termMonths, annualRate: agreement.discountRate, timing, purchaseOption: purchaseOptionReasonablyCertain ? purchaseOptionAmount : 0, guaranteedResidual, unguaranteedResidual })`; `classifyLessorLease(inputs, thresholds from companySettings)`; store `lessorClassification` (unless `classificationOverride` is already true — keep the overridden value), `classificationInputs` JSON (inputs + tests + pvs). Sales-Type requires `agreement.currencyCode === base currency` (else throw the message from Task 40) and `endDate`.
2. Sales-Type commencement (same transaction, after classification): derecognize the unit — from stock (`trackedEntityId` set, no `fixedAssetId`): `bookAdjustment(quantity −1, documentType 'Rental Agreement', documentId = agreement id, accounting: null)` → `C = cost`; from the fleet (`fixedAssetId`): `C = acquisitionCost − accumulatedDepreciation`, legs Dr class accumulated depreciation / Cr class asset at cost, asset `Disposed` (`disposalMethod 'Sale'`, `disposalDate`), `fixedAssetDisposal` row (`netBookValueAtDisposal C`, `saleProceeds = pv.netInvestment`, `gainLoss = pv.pvPayments − (C − pv.pvResidual)`). Journal `sourceType 'Lease'`, description `Lease commencement ${rentalAgreementId} ${serial}`: Dr `netInvestmentInLeasesAccount` `NI`; Dr `costOfGoodsSoldAccount` `C − pvResidual`; Cr `leaseRevenueAccount` `pvPayments`; Cr Finished Goods (`resolveInventoryAccount`) `C` for stock, or the fleet legs above. All lines `documentType 'Rental Agreement'`, `documentId = agreement id`; dimensions Customer / Item / Location. Store `initialNetInvestment`, `sellingProfit`, `commencementJournalId`; tracked entity → `Consumed` with `attributes || { "Rental Agreement": <id>, Customer: <customerId> }` and a `'Lease Commencement'` activity.
3. Schedule: `periodDates` = each period end from the first billing period; `buildLessorSchedule({ netInvestment: NI, payment, periods: termMonths, annualRate, timing, closingTarget: purchaseOption + residuals, periodDates })` → insert `rentalLeaseScheduleLine` rows and, per row, a `revenueRecognitionSchedule` `Interest` row `{ rentalAgreementLineId, rentalLeaseScheduleLineId, periodStart/End = that month, scheduledDate = periodDate, amount = interestAmount, debitAccountId = netInvestmentInLeasesAccount, creditAccountId = leaseInterestIncomeAccount }`.
4. Override route: `validator(z.object({ classification: z.enum(["Operating","Sales-Type"]), reason: z.string().min(1) }))`; only while the agreement is `Draft`; update the line (`classificationOverride true`, `classificationOverrideReason`); `insertAuditLogEntries(serviceRole, companyId, [{ tableName: "rentalAgreementLine", entityType: "rentalAgreementLine", entityId: lineId, recordId: lineId, operation: "UPDATE", actorId: userId, diff: { lessorClassification: { from, to } }, metadata: { reason } }])` in a best-effort try/catch.

**Verify:**
```bash
(cd packages/database/supabase/functions && deno check --no-lock post-rental-agreement/index.ts)
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors; exit 0
```

**Out of scope:** early termination (manual journal, blocked in UI).

### Task 52: `post-sales-invoice` sales-type legs; run stamps schedule lines

**Depends on:** 51
**Files:**
- Modify: `packages/database/supabase/functions/post-sales-invoice/index.ts` — in `case "Rental"`, when the line's `lessorClassification = 'Sales-Type'`: `Rent` and `Purchase Option` → revenue leg override `Cr netInvestmentInLeasesAccount` (class Asset, credit), no schedule rows; `Charge` → `Cr rentalIncomeAccount`; a `Purchase Option` line also sets `rentalAgreementLine.status = 'Sold'` and flags the agreement closable; VOID mirrors and reverts the status
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` `postRevenueRecognitionRun` — after stamping schedule rows, `UPDATE rentalLeaseScheduleLine SET journalId, postedAt WHERE id IN (rows' rentalLeaseScheduleLineId)`

**Verify:**
```bash
(cd packages/database/supabase/functions && deno check --no-lock post-sales-invoice/index.ts)
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors; exit 0
```

**Out of scope:** FX remeasurement.

### Task 53: End of term — purchase option and residual return

**Depends on:** 52
**Files:**
- Create: `apps/erp/app/routes/x+/rental-agreement+/$id.$lineId.sell.tsx` — "Sell to customer": `update: "sales"`; only a Sales-Type line `On Rent` with `purchaseOptionAmount`; inserts a `rentalAgreementCharge` `{ kind: 'Purchase Option', amount: purchaseOptionAmount, chargeDate: today, description: "Purchase option exercised" }` then `generateRentalInvoicesNow` for the agreement
- Modify: `packages/database/supabase/functions/post-rental-agreement/index.ts` (`return`) — for a Sales-Type line add `residualDestination: "Fleet" | "Inventory"` to the payload: `closing = the last unposted rentalLeaseScheduleLine.closingNetInvestment (or the line's current NI = initialNetInvestment − Σ posted principal)`; journal `'Lease'`: `Fleet` → Dr Rental Fleet class asset account `closing` / Cr `netInvestmentInLeasesAccount` `closing` and create a new `fixedAsset` (Rental Fleet, `acquisitionCost = closing`, today, `itemId`/`trackedEntityId` from the line) + `fixedAssetTransfer` (`Capitalization`, `sourceType 'Inventory'`, amount closing); `Inventory` → `bookAdjustment(+1, fixedUnitCost: closing, accounting: null)` + Dr Finished Goods / Cr net investment; delete unposted `Interest` rows and unposted `rentalLeaseScheduleLine`s of the line; tracked entity reactivated (`Available`, attributes minus `Rental Agreement`/`Customer`) with a `'Return to Inventory'` activity
- Modify: `RentalAgreementReturnForm.tsx` — `residualDestination` Radios shown for Sales-Type lines; the line form hides Return for `Sold` lines and shows "Early termination is a manual journal" when a Sales-Type line is cancelled

**Verify:**
```bash
(cd packages/database/supabase/functions && deno check --no-lock post-rental-agreement/index.ts)
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors; exit 0
```

**Out of scope:** partial terminations.

### Task 54: Net investment report, classification UI, lease policy settings

**Depends on:** 51
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getLeaseNetInvestment(client, companyId, { asOf })` (per Sales-Type line: initial NI, Σ posted principal, current NI, next interest, maturity by fiscal year from unposted schedule lines)
- Create: `apps/erp/app/routes/x+/reports+/lease-net-investment.tsx`; Modify: `x+/accounting+/reports.tsx` (card `lease-net-investment`, Close Reports), `path.ts` (`leaseNetInvestment`)
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementLineForm.tsx` — classification chip (test results from `classificationInputs`, computed client-side with `classifyLessorLease` from `@carbon/utils` before activation) + "Override" button opening a modal that posts to `$id.$lineId.classification`; Activate confirmation shows the commencement journal preview (`presentValue` from `@carbon/utils`)
- Modify: `apps/erp/app/routes/x+/settings+/accounting.tsx` + `settings.service.ts` — intent `leasePolicy` with a `ValidatedForm` (`leaseMajorPartThresholdPercent`, `leaseSubstantiallyAllThresholdPercent`, `leaseDefaultDiscountRate`; `Number` fields with `INPUT_FORMAT.percent`-style options from `@carbon/utils` — no inline fraction digits) → `updateLeasePolicySettings(client, companyId, settings)`
- Copy from (precedent): Task 17, Task 8, `x+/settings+/accounting.tsx` L44–53 + L125–162 (validated detail form)

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: exit 0 twice
```

**Out of scope:** disclosures package (#1056).

### Task 55: Phase D docs, rules, AGENTS

**Depends on:** 53, 54
**Files:**
- Modify: `docs/content/docs/reference/rental-agreements.mdx` (classification, sales-type commencement, purchase option, residual return), `apps/erp/app/modules/sales/AGENTS.md`, `apps/erp/app/modules/accounting/AGENTS.md` (`rentalLeaseScheduleLine`, net investment report), `.claude/rules/accounting-sync-handlers.md` (`'Lease'` policy), glossary terms `sales-type-lease`, `net-investment-in-leases`, `purchase-option`
- Modify: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part I changelog — record the plan-level decisions 1–7 and any deviation found during execution; move to `.ai/specs/implemented/` only after Task 56 passes

**Verify:**
```bash
pnpm --filter docs build 2>&1 | tail -3
# Expected: build succeeds
```

**Out of scope:** #1056 lessee docs.

### Task 56: Self-review and Phase D browser verification

**Depends on:** 55
**Files:** none

**Steps:**
1. `/auth` then `/test`: RA-000002 per the spec's Sales-type AC (36 × 1,000 Arrears, option 5,000 reasonably certain, fair value 38,000, life 120, 6 %, unit from stock at 30,000): activation journal Dr 1160 37,049.24 / Dr 5010 30,000.00 / Cr 4070 37,049.24 / Cr 1220 30,000.00, `sellingProfit` 7,049.24, entity Consumed with Rental Agreement + Customer attributes, 36 schedule lines (month 1 = 185.25 / 814.75 / 36,234.49); October run posts Dr 1160 185.25 / Cr 4150 185.25; the month-1 invoice posts Dr AR 1,000 / Cr 1160 1,000; after payment 36 the closing balance is 5,000.00 ± 0.01; Sell to customer bills 5,000.00 → Dr AR / Cr 1160 → NI 0.00, line Sold. Classification AC: option not certain + fair value 60,000 → Operating; open-ended → Operating; option-certain without `endDate` rejected; override needs a reason and writes an audit entry. Net investment report ties to the 1160 balance.
2. Run `/self-review` on the branch; fix Must-fix items; run every verification command in this plan once more; `pnpm db:check:datasets && pnpm db:check:backups`.
3. Evidence in `.ai/runs/2026-09-22-revenue-recognition-and-rentals.md`.

**Verify:**
```bash
ls .ai/runs/2026-09-22-revenue-recognition-and-rentals.md && pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: file exists with every check marked pass; exit 0 twice
```

**Out of scope:** everything listed as out of scope in the spec's §0.

### Follow-up — rental agreement document layout (2026-09-28)

Brad (2026-09-28): the agreement has line items, so lay it out like a sales order /
quote. Terms stay in the center (no editable properties panel). Ships in the rentals PR.

#### Shape

- `x+/rental-agreement+/$id.tsx` — `PanelProvider` + top-bar header + `ResizablePanels`
  (explorer + center `<Outlet />`, no properties panel). Model: `sales-return-order+/$id.tsx`.
- Header (`RentalAgreementHeader`) — top bar like `SalesReturnOrderHeader`: explorer toggle,
  id → details, copy, more menu (Delete), status + Past end date, actions
  (Invoice / Cancel / Close / Activate, same confirms as today).
- Explorer (`RentalAgreementExplorer`, new) — one row per unit (thumbnail, unit id, item,
  status); click → `/$lineId/details`; row menu Delete (Draft); footer **Add Unit** opens
  the unit form as a modal (Draft).
- `/details` — `RentalAgreementSummary` (stat row + customer / term / billing rows), Units
  table, Charges, Billing Periods, Deposits, then the terms form (`RentalAgreementForm`).
- `/$lineId/details` — the unit page: status + Deliver / Return / Sell, the unit form as a
  card (editable while Draft), then that unit's charges and billing periods.

#### Tasks

- [x] `RentalAgreementLineForm` takes `type: "card" | "modal"`; the modal closes on submit.
- [x] Charge and Return forms take an `action`, close on submit, open from the page
      (no route navigation — a modal route would blank the center behind it).
- [x] `useRentalLineActions` — one home for Deliver / Return / Sell / Delete confirms,
      used by the units table, the explorer and the unit page.
- [x] Header → top bar; stat card → `RentalAgreementSummary`.
- [x] `RentalAgreementExplorer`.
- [x] `$id.tsx` shell; `$id.details.tsx` renders the summary + terms form;
      `$id.$lineId.details.tsx` renders the unit page.
- [x] Line-scoped actions redirect to `requestReferrer(request)` (fall back to details) so
      acting from the unit page stays there; line delete keeps details.
- [x] Docs: sales `AGENTS.md` ("one scrolling page"), rental-agreements docs page.
- [x] Verify: biome, `turbo run typecheck --filter=erp`, sales vitest (41 pass)
- [x] Browser check — the agreement UI passed in the rental invoice automation browser run (Part II Task 21, 2026-10-03)

# Part II — Rental invoice automation

> Was `.ai/plans/2026-10-02-rental-invoice-automation.md` ("Rental Invoice Automation — implementation plan"), merged here verbatim on 2026-10-07. Decision, question and section numbers in this Part (D1, Q3, §2, Task 4) are its own.

> Shared layer (2026-10-02): the automation built here is source-agnostic (`invoiceAutomation`, `packages/jobs/src/invoicing/`, `recurring-billing`, "Recurring invoicing" digest) so AR contracts (`.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III) reuse it. Scope is unchanged: rentals only, no Stripe mode.

**Spec:** `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part II
**Research:** .ai/research/rental-invoice-automation.md
**Branch:** revenue-recognition-rentals-spec (rentals are not on `main` yet; this builds on them)

### Plan-level decisions (fold into the spec changelog at close-out)

These refine the spec where the code facts gathered for this plan disagreed with its assumptions.

1. **The automation sends email with `sendEmail` (`@carbon/lib/email.server`) directly, not `trigger("send-email")`.** The `carbon/send-email` job forces From to `DEFAULT_FROM`, maps `from` to `replyTo`, and has no sender-name field (`packages/jobs/src/inngest/functions/notifications/send-email.ts:46-54`). It also only queues, so a delivery error would never reach `sendError`. Calling `sendEmail` directly gives D13's From/Reply-To and a real error. The manual post route keeps `trigger("send-email")`, so its `sentAt` means "queued".
2. **`checkPartyContactRequirement` moves to `@carbon/lib`, not `@carbon/database` or `@carbon/ee`.** `@carbon/database` lacks `@carbon/logger` and has `@supabase/supabase-js` only as a devDep. `packages/ee` is commercially licensed, and moving AGPL logic there changes its license. `@carbon/lib` already depends on `@carbon/logger`, `@supabase/supabase-js` and `@carbon/database`, and both ERP and jobs depend on it. Its pure sibling `party-contact.ts` moves with it. The ERP files become re-exports, so the six existing callers don't change.
3. **The shared sales-invoice document loader lives in `@carbon/lib` (`./sales-invoice-document.server`), not `@carbon/documents`.** `@carbon/documents` has no supabase or files runtime deps and no loader precedent. `@carbon/lib` gains workspace deps on `@carbon/documents` and `@react-pdf/renderer` (same version as `packages/jobs`). This is not a cycle: `@carbon/documents` depends on `env`, `notifications`, `react` and `utils`, not `lib`.
4. **"Needs review" is a derived boolean on the `salesInvoices` view (`needsReview`) plus a sidebar link** `Receivables → Needs Review` (`?filter=needsReview:eq:true`). Saved views are per user (`tableView.createdBy`), and the generic filter syntax can't express the spec's OR.
5. **"Send" on a posted invoice with `sendError` is a new action route `x+/sales-invoice+/$invoiceId.send.tsx`.** It fires `carbon/invoice.automate` with `mode: "Post and Email"`. `automateSalesInvoice` skips posting an already-Submitted invoice, then emails it. There is no send-only path in `SalesInvoicePostModal` to reuse.
6. **The event carries an optional `mode`.** When absent, the function resolves the effective mode from the invoice's agreement (`salesInvoiceLine.rentalAgreementId` → `rentalAgreement.invoiceAutomation ?? companySettings.invoiceAutomation`).
7. **The split and hold decision is a pure function in its own file**, `packages/database/src/rental-invoice-plan.ts`, tested with vitest. The existing `shared/rental-billing.test.ts` runs under Deno only.
8. **Re-billing after a VOID is always held (user, 2026-10-02).** VOID returns a rental invoice's periods and charges to Pending (`post-sales-invoice/index.ts:1704-1715`). With automation on, the next morning's run would redraft and re-post — and email — the same amounts, since an Active agreement's rates are locked. VOID now stamps `voidedSalesInvoiceId` on each released row. The planner holds any rent invoice containing such a row with "Re-billing INV-…, which was voided"; charges are held anyway. The stamp is sticky: deleting the held draft (`releaseRentalInvoiceStamps`) leaves it, so the next draft is held again. A later VOID overwrites it. `Draft Only` agreements get no hold, since nothing is automated.
9. **Notifications reach an internal person with no setup (user, 2026-10-02: "a good default should be automatic invoices with notifications to the internal person").** The spec's D16 sent nothing when `invoiceNotificationGroup` was empty, so out of the box nobody heard about anything. Now every cron run sends each agreement's internal owner — `rentalAgreement.salesPersonId ?? createdBy` — one digest covering their agreements' invoices: posted, emailed, held, unsent. The settings group becomes **Also notify**: those people get the company-wide digest on top. An owner listed directly in the group (by user id) gets only the company digest, never both. The default mode stays `Post and Email`.

### Progress

- [x] Task 1: Baseline green
- [x] Task 2: Migration — enum, columns, views
- [x] Task 3: Apply migration, regenerate types, run DB gates
- [x] Task 4: Pure invoice planner + tests
- [x] Task 5: Generator drafts rent and charges invoices per the planner
- [x] Task 5b: VOID stamps the voided invoice on released periods and charges
- [x] Task 6: Move the party-contact check to `@carbon/lib`
- [x] Task 7: Shared sales-invoice document loader in `@carbon/lib`; PDF route uses it
- [x] Task 8: Event type + trigger map entry
- [x] Task 9: `automateSalesInvoice` + tests
- [x] Task 10: Inngest wiring — automate function, cron steps, digest
- [x] Task 11: `RecurringInvoicing` notification event
- [x] Task 12: Manual post route — shared PDF, storage path fix, sent stamps
- [x] Task 13: Settings models/services + Settings → Invoicing page (moving two cards)
- [x] Task 14: Agreement override — model, service, update route, properties field
- [x] Task 14b: Agreement shows invoicing is automatic; button becomes "Invoice Now"
- [x] Task 15: Generate Invoices / Sell to Customer fire automation
- [x] Task 16: Agreement cards show held invoices
- [x] Task 17: Invoice header badges + Send route
- [x] Task 18: Invoices list — needsReview column + Needs Review link
- [x] Task 19: MCP metadata, lint, i18n, scoped typechecks, tests
- [x] Task 20: Docs — AGENTS.md, rules, spec changelog
- [ ] Task 21: Browser verification (`/test`) — all non-email flows PASS 2026-10-03; email send + digest pending SMTP

### Dependencies

- Task 1 → Task 2 → Task 3. Every later task needs Task 3's types.
- Task 4 → Task 5. Task 5b needs only Task 3 (parallel-safe with 4–5).
- Tasks 6, 7 and 8 are independent of each other and of Tasks 4–5 (parallel-safe after Task 3).
- Task 9 needs Tasks 5, 6, 7 and 8. Task 10 needs Tasks 9 and 11. Task 11 is independent after Task 3.
- Task 12 needs Task 7.
- Tasks 13, 14, 14b, 16 and 18 are parallel-safe after Task 3 (disjoint files).
- Tasks 15 and 17 need Task 8.
- Tasks 19–21 run last, in order.

---

### Task 1: Baseline green

**Depends on:** none
**Files:** none

**Steps:**
1. `git status` must be clean. `git fetch origin && git merge origin/main` if `main` moved; resolve conflicts and stop if any touch `rental-billing.ts`, `$invoiceId.post.tsx` or `settings+/sales.tsx`.
2. Record a baseline of the scoped typechecks and tests below. Any pre-existing failure goes in the run log so later tasks compare against it, not against zero.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/lib --filter=@carbon/database --filter=@carbon/documents
# Expected: all tasks successful (or the pre-existing failures recorded in step 2)
pnpm --filter @carbon/jobs test && pnpm --filter @carbon/database test && pnpm --filter @carbon/lib test
# Expected: all pass
```

**Out of scope:** fixing any pre-existing failure.

---

### Task 2: Migration — enum, columns, views

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_rental-invoice-automation.sql` (via `pnpm db:migrate:new rental-invoice-automation`)
- Copy from (precedent): `packages/database/supabase/migrations/20261006220501_rental-agreements.sql:319-347` (the `rentalAgreements` view), `packages/database/supabase/migrations/20260916143022_invoice-settlement-source-amount-fallback.sql:13-92` (the `salesInvoices` view)

**Steps:**
1. `pnpm db:migrate:new rental-invoice-automation`. The timestamp must be newer than `20261006220801`; if it isn't, STOP.
2. Write:
```sql
DO $$ BEGIN
  CREATE TYPE "invoiceAutomation" AS ENUM ('Draft Only', 'Post', 'Post and Email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "invoiceAutomation" "invoiceAutomation" NOT NULL DEFAULT 'Post and Email',
  ADD COLUMN IF NOT EXISTS "invoiceNotificationGroup" TEXT[] NOT NULL DEFAULT '{}';

-- NULL = the company default
ALTER TABLE "rentalAgreement"
  ADD COLUMN IF NOT EXISTS "invoiceAutomation" "invoiceAutomation";

-- The last invoice this row was billed on that was VOIDED. Set by post-sales-invoice's
-- void step; the rental invoice planner holds a re-bill. No FK, like salesInvoiceLineId.
ALTER TABLE "rentalBillingPeriod"
  ADD COLUMN IF NOT EXISTS "voidedSalesInvoiceId" TEXT;
ALTER TABLE "rentalAgreementCharge"
  ADD COLUMN IF NOT EXISTS "voidedSalesInvoiceId" TEXT;

ALTER TABLE "salesInvoice"
  ADD COLUMN IF NOT EXISTS "automationHoldReason" TEXT,
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "sentTo" TEXT,
  ADD COLUMN IF NOT EXISTS "sendError" TEXT;
```
3. Recreate `rentalAgreements`. Copy `20261006220501_rental-agreements.sql:320-347` VERBATIM (its `DROP VIEW IF EXISTS` + `CREATE VIEW … WITH(SECURITY_INVOKER=true)` selecting `ra.*`), with one change: add `COALESCE(ra."invoiceAutomation", cs."invoiceAutomation") AS "effectiveInvoiceAutomation"` to the select list and `LEFT JOIN "companySettings" cs ON cs."id" = ra."companyId"` to the FROM. First `grep -rn '"rentalAgreements"' packages/database/supabase/migrations` and confirm no migration newer than `20261006220501` redefines it. If one does, copy THAT body instead.
4. Recreate `salesInvoices`. `grep -rln 'VIEW "salesInvoices"' packages/database/supabase/migrations | sort | tail -1` must be `20260916143022_invoice-settlement-source-amount-fallback.sql`; if not, copy the newest. Copy its full `CREATE OR REPLACE VIEW "salesInvoices"` statement and APPEND, after the last column (`si."status" AS "baseStatus"`):
```sql
  , si."automationHoldReason"
  , si."sentAt"
  , si."sentTo"
  , si."sendError"
  , (
      (si."status" = 'Draft' AND si."automationHoldReason" IS NOT NULL)
      OR (si."status" <> 'Draft' AND si."sendError" IS NOT NULL AND si."sentAt" IS NULL)
    ) AS "needsReview"
```
   `CREATE OR REPLACE` only allows appending columns at the end; do not reorder anything.
5. No RLS changes: these are new columns on existing tables (spec D21). No `TABLE_RENAMES` entry: nothing renamed or dropped.

**Verify:**
```bash
grep -c "invoiceAutomation" packages/database/supabase/migrations/*_rental-invoice-automation.sql
# Expected: >= 4
grep -n "000000_" <(ls packages/database/supabase/migrations | tail -1)
# Expected: no output
```

**Out of scope:** `CREATE POLICY` (forbidden in migrations); touching any other view.

---

### Task 3: Apply migration, regenerate types, run DB gates

**Depends on:** 2
**Files:** generated types only (`packages/database/src/types.ts`, swagger), plus `packages/jobs/manifests/schema.json` if the backup check regenerates it

**Steps:**
1. `pnpm db:migrate` (applies + regenerates types). If the local DB is unreachable, STOP and ask the user to start it. Never rebuild the DB.
2. `pnpm run generate:types` if `db:migrate` reported no regeneration.
3. `pnpm db:check:datasets` and `pnpm db:check:backups`.

**Verify:**
```bash
grep -c "invoiceAutomation" packages/database/src/types.ts
# Expected: >= 3 (enum + companySettings + rentalAgreement)
grep -n "needsReview\|effectiveInvoiceAutomation" packages/database/src/types.ts | head
# Expected: both names present
grep -c "voidedSalesInvoiceId" packages/database/src/types.ts
# Expected: >= 6 (Row/Insert/Update × 2 tables)
pnpm db:check:datasets
# Expected: all four datasets OK
pnpm db:check:backups
# Expected: compatible / exit 0
```

**Out of scope:** hand-editing `types.ts`.

---

### Task 4: Pure invoice planner + tests

**Depends on:** 3
**Files:**
- Create: `packages/database/src/rental-invoice-plan.ts`
- Create: `packages/database/src/rental-invoice-plan.test.ts`
- Modify: `packages/database/package.json` — add `"./rental-invoice-plan": "./src/rental-invoice-plan.ts"` to `exports` next to `./rental-billing`
- Copy from (precedent): `packages/database/src/inspection-verdict.ts` + its `.test.ts` (pure module + vitest shape)

**Steps:**
1. Start the file with its SPDX header (`pnpm --filter @carbon/checks license-headers` writes it; AGPL).
2. Implement:
```ts
import type { Database } from "./types";

export type InvoiceAutomation = Database["public"]["Enums"]["invoiceAutomation"];

export const RENTAL_HOLD_CHARGES = "Charges are reviewed before posting";
export const RENTAL_HOLD_EARLY_RETURN = "Includes an early-return credit";
export const RENTAL_SEND_NO_EMAIL = "The invoice contact has no email";
/** readableIds: distinct readable ids of the voided invoices, in first-seen order. */
export const rentalHoldRebill = (readableIds: string[]) =>
  `Re-billing ${readableIds.join(", ")}, which ${readableIds.length === 1 ? "was" : "were"} voided`;

export type PlannableLine<T> = {
  item: T; kind: "Rent" | "Charge" | "Purchase Option"; isAdjustment: boolean;
  /** Readable id of a voided invoice this row was previously billed on, else null. */
  voidedInvoiceReadableId: string | null;
};
export type PlannedInvoice<T> = { lines: T[]; holdReason: string | null; role: "combined" | "rent" | "charges" };

/** Splits one agreement's due lines into the invoices to draft.
 *  Draft Only → one combined invoice, no hold (today's behaviour).
 *  Otherwise → a rent invoice and a charges invoice (Charge + Purchase Option, always held).
 *  Rent hold precedence: re-bill of a voided invoice (rentalHoldRebill) > early-return adjustment.
 *  Empty invoices are omitted. */
export function planRentalInvoices<T>(mode: InvoiceAutomation, lines: PlannableLine<T>[]): PlannedInvoice<T>[]

/** The mode in force for an agreement. */
export function effectiveInvoiceAutomation(
  agreementMode: InvoiceAutomation | null, companyMode: InvoiceAutomation
): InvoiceAutomation
```
   Line order inside each invoice is the input order.
3. Tests (each a separate `it`):
   - Draft Only with rent + charge → 1 combined invoice, holdReason null, both lines.
   - Post with rent only → 1 rent invoice, holdReason null.
   - Post with rent + Charge + Purchase Option → rent (no hold) + charges (`RENTAL_HOLD_CHARGES`, 2 lines).
   - Post and Email with a rent row + an `isAdjustment` rent row → 1 rent invoice with `RENTAL_HOLD_EARLY_RETURN`.
   - Post with charges only → 1 charges invoice, held.
   - Post and Email with two rent rows carrying `voidedInvoiceReadableId` "INV-7" and one with null → rent invoice held with `rentalHoldRebill(["INV-7"])` ("Re-billing INV-7, which was voided").
   - Post with a re-billed rent row AND an adjustment row → the re-bill message wins.
   - Draft Only with a re-billed row → 1 combined invoice, holdReason null.
   - Empty input → `[]` in every mode.
   - `effectiveInvoiceAutomation(null, "Post")` is `"Post"`; `("Draft Only", "Post and Email")` is `"Draft Only"`.

**Verify:**
```bash
pnpm --filter @carbon/database test -- rental-invoice-plan
# Expected: 10 passed (or more), 0 failed
```

**Out of scope:** any DB access in this file.

---

### Task 5: Generator drafts rent and charges invoices per the planner

**Depends on:** 4
**Files:**
- Modify: `packages/database/src/rental-billing.ts`
- Modify: `apps/erp/app/modules/sales/sales.server.ts:386-391` (`generateRentalInvoicesNow` return type follows)
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.invoice.tsx:48-84` (reads the new return shape)
- Modify: `packages/jobs/src/inngest/functions/scheduled/rental-billing.ts:57-68` (reads the new shape)

**Steps:**
1. Change the return type of `createRentalInvoicesForDuePeriods` to:
```ts
export type DraftedRentalInvoice = {
  invoiceId: string; rentalAgreementId: string;
  mode: InvoiceAutomation; holdReason: string | null;
};
Promise<{ invoices: DraftedRentalInvoice[]; invoiceIds: string[] }>  // invoiceIds = invoices.map(i => i.invoiceId), kept for callers
```
2. In `draftAgreementInvoice` (114-340): read the company mode once per agreement inside the transaction, with `selectFrom("companySettings").select("invoiceAutomation").where("id","=",args.companyId).executeTakeFirstOrThrow()` right after the agreement `forUpdate` read (121-128). Compute `mode = effectiveInvoiceAutomation(agreement.invoiceAutomation, company.invoiceAutomation)`.
3. Add `voidedSalesInvoiceId` to the period select (142-175) and the charge select (177-198). Read the readable ids in ONE query (`selectFrom("salesInvoice").select(["id","invoiceId"]).where("companyId","=",…).where("id","in",distinctIds)`, skipped when there are none; no per-row query). Build the `lines` array exactly as today (214-240), carrying each line's `kind`, the period's `isAdjustment` and `voidedInvoiceReadableId` (the readable id, else the raw id if the invoice row is gone). Call `planRentalInvoices(mode, lines.map(l => ({ item: l, kind: l.kind, isAdjustment: l.isAdjustment ?? false, voidedInvoiceReadableId: l.voidedInvoiceReadableId })))`.
4. Extract the existing per-invoice block (subtotal/tax 242-245, `getNextSequence` 247, invoice insert 252-275, shipment insert 277-286, line insert 288-307, period stamp 310-323, charge stamp 325-337) into `insertRentalInvoice(trx, args, agreement, lines, holdReason)`, returning the invoice id. Insert `automationHoldReason: holdReason` on the `salesInvoice` row. Call it once per planned invoice. The function now returns `DraftedRentalInvoice[]` (empty when nothing is due). The stamping is already scoped by `sil.invoiceId`, so it stays correct per invoice.
5. Update the three callers to the new shape (`invoiceIds` still exists, so `$id.invoice.tsx`'s counts keep working; the cron logs `invoices.length`).
6. If the extracted block reads any variable that differs between the two invoices beyond lines/holdReason (e.g. a header-level total computed before the split), STOP and report. Do not improvise header semantics.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs --filter=erp
# Expected: no new errors vs Task 1 baseline
pnpm --filter @carbon/database test
# Expected: all pass
```

**Out of scope:** posting, emailing, events (Task 9/10); `rollBillingPeriodsForward`; the idempotency query at 52-102.

---

### Task 5b: VOID stamps the voided invoice on released periods and charges

**Depends on:** 3
**Files:**
- Modify: `packages/database/supabase/functions/post-sales-invoice/index.ts:1704-1715` (the void step's `rentalBillingPeriod` and `rentalAgreementCharge` updates)

**Steps:**
1. In both `.set({...})` calls of the void step, add `voidedSalesInvoiceId: invoiceId` (the `salesInvoice.id` already in scope in the void branch; it is the same `invoiceId` used at :1560). Change nothing else in the void step.
2. Update the comment above (`// Undo what posting a Rental line consumed…`) with one line: "…and remember the voided invoice, so the automated re-bill is held for review (spec Part II)."
3. If `invoiceId` is not in scope at :1704, or holds the readable id rather than `salesInvoice.id`, STOP and report.
4. The posting function has pre-existing `deno check` errors (see the revenue-recognition plan's execution notes). The gate is "no NEW errors": run the check at HEAD (`git stash`-free: copy the file to `/tmp` first) and after, then diff the normalized error lists.

**Verify:**
```bash
grep -c "voidedSalesInvoiceId: invoiceId" packages/database/supabase/functions/post-sales-invoice/index.ts
# Expected: 2
cd packages/database/supabase/functions && deno check post-sales-invoice/index.ts 2>&1 | grep -E "^(error|TS)" | sed -E 's/:[0-9]+:[0-9]+//' | sort > /tmp/after.txt; wc -l < /tmp/after.txt
# Expected: the same count (and identical content) as the HEAD run recorded in step 4
cd packages/database/supabase/functions && deno task test post-sales-invoice/rental-posting.test.ts
# Expected: all pass (unchanged)
```
Behaviour is proven end to end in Task 21 step 8.

**Out of scope:** any other change to the void step; clearing the stamp anywhere.

---

### Task 6: Move the party-contact check to `@carbon/lib`

**Depends on:** 3
**Files:**
- Create: `packages/lib/src/party-contact.ts` (moved from `apps/erp/app/modules/settings/party-contact.ts`, content unchanged)
- Create: `packages/lib/src/party-contact.server.ts` (moved from `apps/erp/app/modules/settings/party-contact.server.ts`; its `./party-contact` import stays relative)
- Create: `packages/lib/src/party-contact.test.ts` (moved from `apps/erp/app/modules/settings/party-contact.test.ts`; fix its import path)
- Modify: `packages/lib/package.json` — exports `"./party-contact": "./src/party-contact.ts"`, `"./party-contact.server": "./src/party-contact.server.ts"`
- Modify: `apps/erp/app/modules/settings/party-contact.ts` → `export * from "@carbon/lib/party-contact";`
- Modify: `apps/erp/app/modules/settings/party-contact.server.ts` → `export * from "@carbon/lib/party-contact.server";`
- Delete: `apps/erp/app/modules/settings/party-contact.test.ts`

**Steps:**
1. `git mv` each file to keep history, then recreate the two ERP files as one-line re-exports (with their SPDX header).
2. Every runtime import of the moved server file (`@carbon/database` types, `@carbon/logger`, `@supabase/supabase-js`) is already a `@carbon/lib` dependency. If the pure file imports anything that isn't, STOP.
3. Run the license-header fixer.

**Verify:**
```bash
pnpm --filter @carbon/lib test -- party-contact
# Expected: the moved tests pass (same count as before the move)
pnpm exec turbo run typecheck --filter=@carbon/lib --filter=erp
# Expected: no new errors
```

**Out of scope:** changing the six ERP callers; changing behaviour.

---

### Task 7: Shared sales-invoice document loader in `@carbon/lib`; PDF route uses it

**Depends on:** 3
**Files:**
- Create: `packages/lib/src/sales-invoice-document.server.tsx`
- Modify: `packages/lib/package.json` — export `"./sales-invoice-document.server": "./src/sales-invoice-document.server.tsx"`; add deps `"@carbon/documents": "workspace:*"` and `"@react-pdf/renderer"` (copy the exact version string from `packages/jobs/package.json`)
- Modify: `apps/erp/app/routes/file+/sales-invoice+/$id[.]pdf.tsx` — replace the reads (:61-205) with the loader
- Copy from (precedent): the current `$id[.]pdf.tsx:61-247`; thumbnails from `apps/erp/app/modules/shared/shared.service.ts:56` (`getBase64ImageFromSupabase`); logo URL rewrite from `getCompany` (`apps/erp/app/modules/settings/settings.service.ts:207`)

**Steps:**
1. Implement with a plain `SupabaseClient<Database>` (no `~/` imports):
```ts
export type SalesInvoiceDocument = {
  pdfProps: SalesInvoicePDFProps;          // from @carbon/documents/pdf
  email: Omit<SalesInvoiceEmailProps, "recipient" | "sender" | "locale">;  // from @carbon/documents/email
  invoiceReadableId: string;
  fileName: string;                        // `${company.name} - ${invoiceId}.pdf`
};
export async function loadSalesInvoiceDocument(args: {
  client: SupabaseClient<Database>; companyId: string; companyGroupId: string;
  invoiceId: string; locale: string; storageUrl: string;   // base for public logo URLs
}): Promise<SalesInvoiceDocument>                           // throws on a missing invoice/company/lines/locations/shipment/terms, as the route does
export async function renderSalesInvoicePdf(props: SalesInvoicePDFProps): Promise<Buffer>  // ensureFont + renderToStream, collected into a Buffer
```
   Replicate each read with the exact select listed in this plan's research (company `*` + logo rewrite to `${storageUrl}/storage/v1/object/public/public/<path>`; `companySettings *`; `companyAccountsReceivableBillingAddress *`; `documentTemplate` for `salesInvoice`; sections via `getBuiltInSection` + `documentSection.in(ids)`; `salesInvoices *`; `salesInvoiceLocations *`; `salesInvoiceShipment *`; `salesInvoiceLines * order sortOrder, createdAt`; `terms.salesTerms`; `salesOrder(id, salesOrderId).in(ids)`; active `paymentTerm(id,name)`; active `shippingMethod(id,name)`; `currencies * by code + companyGroupId`). Keep the route's semantics: `accountsReceivableBillingAddress` only when `companySettings.accountsReceivableAddress`; thumbnails only when `templateShowsThumbnails`, via `storage(client).company(companyId).download` → `data:<mime>;base64,…` (HEIC → jpeg transform, non-image → png), exactly as `getBase64ImageFromSupabase`.
2. In the PDF route, keep `requirePermissions({ view: "sales" })` and call `loadSalesInvoiceDocument({ client, companyId, companyGroupId, invoiceId: id, locale, storageUrl: SUPABASE_URL })` (`SUPABASE_URL` from `@carbon/auth`, as `getCompany` uses), then `renderSalesInvoicePdf`. The response headers are unchanged.
3. If adding `@carbon/documents` to `@carbon/lib` makes `pnpm install` report a cycle, or `@carbon/documents` turns out to depend on `@carbon/lib` transitively, STOP and report.
4. `pnpm install` to link the workspace deps.

**Verify:**
```bash
pnpm install && pnpm exec turbo run typecheck --filter=@carbon/lib --filter=erp
# Expected: no new errors
grep -n "getSalesInvoiceLines\|getBase64ImageFromSupabase" "apps/erp/app/routes/file+/sales-invoice+/\$id[.]pdf.tsx"
# Expected: no output (reads moved to the loader)
```
Manual: Task 21 opens an invoice PDF and compares it with one rendered before the change.

**Out of scope:** changing the PDF's content or layout; the quote/order PDF routes.

---

### Task 8: Event type + trigger map entry

**Depends on:** 3
**Files:**
- Modify: `packages/lib/src/events.ts` — add to `Events` (before its closing `};` at ~763)
- Modify: `packages/lib/src/trigger.ts:13-54` — add to `taskToEvent`

**Steps:**
1. Events:
```ts
  "carbon/invoice.automate": {
    data: {
      companyId: string;
      invoiceId: string;
      /** Absent = the agreement's effective mode. The Send route passes "Post and Email". */
      mode?: "Draft Only" | "Post" | "Post and Email";
    };
  };
```
2. `taskToEvent`: `"invoice-automate": "carbon/invoice.automate",`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib --filter=@carbon/jobs
# Expected: no new errors
```

**Out of scope:** registering the function (Task 10).

---

### Task 9: `automateSalesInvoice` + tests

**Depends on:** 5, 6, 7, 8
**Files:**
- Create: `packages/jobs/src/invoicing/automate-invoice.ts`
- Create: `packages/jobs/src/invoicing/automate-invoice.test.ts`
- Copy from (precedent): `packages/jobs/src/inngest/functions/integrations/ramp-sync-bill.ts:153-221` (claim/invoke/read-back) and `ramp-sync-bill.test.ts:11-58` (fake client fixture)

**Steps:**
1. Signature:
```ts
export type AutomationOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "held"; reason: string }
  | { outcome: "posted"; emailed: false; sendError: string | null }
  | { outcome: "posted"; emailed: true; sentTo: string };

export async function postSalesInvoiceUnattended(args: {
  client: SupabaseClient<Database>; companyId: string; invoiceId: string;
}): Promise<{ outcome: "skipped" | "held" | "posted"; reason?: string }>

export async function emailPostedInvoice(args: {
  client: SupabaseClient<Database>; companyId: string; companyGroupId: string; invoiceId: string;
}): Promise<{ emailed: boolean; sentTo?: string; sendError?: string }>

export async function resolveInvoiceAutomation(client, companyId, invoiceId): Promise<InvoiceAutomation | null>
// reads the invoice's rental agreement (first salesInvoiceLine.rentalAgreementId) → rentalAgreements.effectiveInvoiceAutomation; null when not a rental invoice
```
2. `postSalesInvoiceUnattended`, in order:
   1. Read `salesInvoice` (`status, automationHoldReason, customerId, invoiceCustomerId, invoiceCustomerContactId, invoiceCustomerLocationId, opportunityId`) scoped by `companyId`, `maybeSingle`. Missing → `skipped`. Already `Submitted` (or any posted status) → `posted` (idempotent retry). Not Draft → `skipped`. `automationHoldReason` set → `held` with that reason.
   2. `checkPartyContactRequirement(client, companyId, { kind: "customer", id: invoiceCustomerId ?? customerId })` from `@carbon/lib/party-contact.server`. Copy the argument shape from `$invoiceId.post.tsx:523-549`; if that route passes contact/location ids in a different shape, mirror it exactly. A non-null message → write `automationHoldReason` = message → `held`.
   3. `evaluateSalesRulesForSalesDocument({ client, companyId, userId: "system", documentType: "salesInvoice", documentId: invoiceId })` from `@carbon/ee/rules.server`, then `dedupeViolations`. Any violation → hold reason `Sales rule: ${messages.join("; ")}` → `held`. A thrown error → hold reason `Sales rule evaluation failed: <message>` → `held`. If importing `@carbon/ee/rules.server` fails to load in the vitest environment, mock it in the test with `vi.mock`; if it fails to TYPECHECK from `@carbon/jobs`, STOP and report.
   4. Claim: `update({ status: "Pending" }).eq("id").eq("companyId").eq("status","Draft").select("id").maybeSingle()`. No row → `skipped` ("no longer Draft").
   5. `client.functions.invoke("post-sales-invoice", { body: { invoiceId, userId: "system", companyId } })`, wrapped in try/catch to capture `postError`.
   6. Read status back. `Submitted` → `raiseMoment("invoicing.salesInvoicePosted", { outputs: { salesInvoice: { id: invoiceId }, postedBy: { id: "system" } }, companyId, actorId: null })` → `posted`. Otherwise: `update({ status: "Draft", automationHoldReason: postError ?? "Posting failed" }).eq("status","Pending")`, then also set the hold reason when the status is already Draft (the edge function reset it) → `held`.
3. `emailPostedInvoice`:
   1. Read `salesInvoice` (`sentAt, invoiceCustomerContactId, customerId, createdBy, opportunityId, invoiceId`). `sentAt` set → `{ emailed: false }` (idempotent).
   2. Contact email: `customerContact` → `contact(email, firstName, lastName)` by `invoiceCustomerContactId`. No email → `update({ sendError: RENTAL_SEND_NO_EMAIL })` → `{ emailed: false, sendError }`.
   3. `loadSalesInvoiceDocument({ … locale: "en-US", storageUrl: SUPABASE_INTERNAL_URL })` (`@carbon/env`, as `print-job/renderers.tsx:124`) and `renderSalesInvoicePdf`.
   4. Upload to `${companyId}/${opportunityId ? `opportunity/${opportunityId}` : `sales-invoice/${invoiceId}`}/${fileName}` with `storage(client).company(companyId).upload(path, buffer, { contentType: "application/pdf", upsert: true })`. Insert a `document` row with the same fields as ERP `upsertDocument`'s insert branch (`apps/erp/app/modules/documents/documents.service.ts:178`): `path, name, size (KB, rounded), sourceDocument: "Sales Invoice", sourceDocumentId, readGroups/writeGroups: [createdBy], createdBy: "system", companyId, type`. If `type` comes from a helper (`getDocumentType`) that isn't in a package jobs can import, STOP and report.
   5. Render `SalesInvoiceEmail` (`@carbon/documents/email`) with `renderAsync` (html + plain text, as `$invoiceId.post.tsx`), recipient = the contact, sender = `{ firstName: company.name, lastName: "", email: replyTo }`.
   6. Reply-To = `companySettings.accountsReceivableEmail`, else the agreement owner's `user.email` (the invoice's `rentalAgreementId` → `rentalAgreement.salesPersonId ?? createdBy` → `user.email`). From = `` `"${company.name}" <${address}>` `` where `address` is the `<…>` part of `DEFAULT_FROM` (or all of it when there are no brackets). CC = `customer.defaultCc` if non-empty, else `companySettings.defaultCustomerCc`, plus the receivables email when set, de-duplicated. Subject: `` `Invoice ${invoiceId} from ${company.name}` ``. Attachment: `{ filename: fileName, content: buffer.toString("base64") }`. Confirm against `email.server.ts:121-125` that `content` is expected base64; if it expects raw, adapt.
   7. `sendEmail(...)` from `@carbon/lib/email.server`. Error → `update({ sendError: error.message })`. Success → `update({ sentAt: now, sentTo: [to, ...cc].join(", "), sendError: null })`. Use the timestamp helper the codebase uses (`datetime.timestamp()` from `@carbon/utils`, as `updateRentalAgreement`); no JS `Date`.
4. Tests (fake client in the style of `ramp-sync-bill.test.ts`; `vi.mock` `@carbon/ee/rules.server`, `@carbon/lib/party-contact.server`, `@carbon/lib/sales-invoice-document.server`, `@carbon/lib/email.server`, `@carbon/lib/workflows`):
   - Draft, no rules, invoke → Submitted ⇒ `posted`, the moment is raised once.
   - Already Submitted ⇒ `posted`, invoke not called.
   - `automationHoldReason` set ⇒ `held`, invoke not called.
   - A sales-rule warning ⇒ `held` with "Sales rule:" prefix, the status stays Draft.
   - Contact requirement message ⇒ `held`.
   - Claim loses the race (status already Pending) ⇒ `skipped`, invoke not called.
   - Invoke throws, status left Pending ⇒ status reset to Draft, hold reason = the thrown message.
   - Invoke error, edge function reset to Draft ⇒ `held` with its message.
   - Email: `sentAt` set ⇒ `sendEmail` not called.
   - Email: contact without email ⇒ `sendError` = `RENTAL_SEND_NO_EMAIL`, no send.
   - Email: success ⇒ `sentAt` stamped, From contains the company name, Reply-To = receivables email.
   - Email: `sendEmail` returns an error ⇒ `sendError` stamped, `sentAt` null.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- automate-invoice
# Expected: 12 passed, 0 failed
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no new errors
```

**Out of scope:** the Inngest function (Task 10); any change to `post-sales-invoice`.

---

### Task 10: Inngest wiring — automate function, cron steps, digest

**Depends on:** 9, 11
**Files:**
- Create: `packages/jobs/src/inngest/functions/tasks/invoice-automate.ts`
- Modify: `packages/jobs/src/inngest/functions/tasks/index.ts` — export it
- Modify: `packages/jobs/src/inngest/index.ts` — import (~81-103) and add to the `// Tasks` section of the `functions` array (~130-151)
- Rename: `packages/jobs/src/inngest/functions/scheduled/rental-billing.ts` → `scheduled/recurring-billing.ts` (`git mv`; function id and export `recurring-billing` / `recurringBillingFunction`; update the import and `functions` array in `packages/jobs/src/inngest/index.ts` and any test or doc naming it). One daily job drafts every recurring source — rental agreements now, contracts later (`.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III, U4)
- Create: `packages/jobs/src/invoicing/digest.ts` + `digest.test.ts`
- Copy from (precedent): `functions/tasks/post-transaction.ts:8-11` (event function), `company-import.ts:50` (concurrency), `scheduled/schedule-inputs-changed.ts:374-384` (digest `step.sendEvent`)

**Steps:**
1. The task function:
```ts
export const invoiceAutomateFunction = inngest.createFunction(
  { id: "invoice-automate", retries: 2, concurrency: { key: "event.data.invoiceId", limit: 1 } },
  { event: "carbon/invoice.automate" },
  async ({ event, step }) => { … }
);
```
   Body: `mode = event.data.mode ?? (await step.run("resolve-mode", () => resolveInvoiceAutomation(...)))`. Null or `Draft Only` → return. `step.run("post", () => postSalesInvoiceUnattended(...))`. If posted and `mode === "Post and Email"`: `step.run("email", () => emailPostedInvoice(...))`. `companyGroupId` is read from `company.companyGroupId` inside the email step.
2. The cron (`scheduled/recurring-billing.ts`, renamed above): per company, keep the draft step (it now returns `invoices`). Then, for each invoice with `mode !== "Draft Only"` and `holdReason === null`, run `step.run(\`post-${invoiceId}\`)` and, when posted and `Post and Email`, `step.run(\`email-${invoiceId}\`)`, calling the same two functions. Collect `{ posted, emailed, held: invoiceIds[], unsent: invoiceIds[] }`. Pre-held invoices (from the planner) count as held. Replace the comment at :56 with: "Drafts, then posts and emails per the agreement's invoice automation (spec Part II)."
3. Digests (plan-level decision 9). Track every result per invoice as `{ invoiceId, rentalAgreementId, outcome }`, the planner's pre-held invoices included. After a company's invoices, if anything was posted, emailed or held:
   1. Read owners in ONE query: `selectFrom("rentalAgreement").select(["id","salesPersonId","createdBy"]).where("companyId","=",companyId).where("id","in",agreementIds)`. Owner = `salesPersonId ?? createdBy`. Skip `"system"` and any id with no `userToCompany` row for the company (one `.in()` read).
   2. Read `companySettings.invoiceNotificationGroup` (`groupIds`).
   3. For each owner NOT present in `groupIds`: `step.sendEvent(\`notify-recurring-invoicing-${companyId}-${ownerId}\`, { name: "carbon/notify", data: { event: NotificationEvent.RecurringInvoicing, companyId, documentIds, recipient: { type: "user", userId: ownerId }, body } })`. `body` and `documentIds` are computed over that owner's invoices only.
   4. If `groupIds` is non-empty: one company-wide event with `recipient: { type: "group", groupIds }` over all invoices.
   5. `body = \`${posted} posted, ${emailed} emailed, ${needReview} need review\``. `documentIds` = held + unsent ids; when that's empty, use the posted ids (`notify` throws NonRetriable when an event has neither content nor documentIds).
   6. Put the grouping in a pure helper `buildRecurringInvoicingDigests(results, owners, groupIds)` in `packages/jobs/src/invoicing/digest.ts`, with a vitest file covering: two owners get separate digests over their own invoices; an owner listed in `groupIds` gets no owner digest; an empty group sends only owner digests; nothing to report → no digests.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp
# Expected: no new errors
grep -n "invoiceAutomateFunction" packages/jobs/src/inngest/index.ts
# Expected: one import + one array entry
pnpm --filter @carbon/jobs test -- digest
# Expected: 4 passed, 0 failed
```

**Out of scope:** changing the cron schedule or retries.

---

### Task 11: `RecurringInvoicing` notification event

**Depends on:** 3
**Files:**
- Modify: `packages/notifications/src/index.ts` — enum (11-60): `RecurringInvoicing = "recurring-invoicing"`; `getNotificationTopic` (Sales group, ~180-184); `getNotificationEmailHeading` ("Recurring invoicing summary"); `getNotificationEmailCtaLabel` ("Review invoices")
- Modify: `packages/jobs/src/inngest/functions/notifications/content.ts` — `buildEventContent` case
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts:47-195` — `defaultDestinations[RecurringInvoicing] = [InApp, Email]` (copy the array literal used by another Sales event)
- Modify: `apps/erp/app/components/Layout/Topbar/Notifications.tsx:267-539` — `GenericNotification` case
- Modify: `apps/erp/app/routes/api+/link.ts:18-111` — `resolve()` case → `${path.to.invoicingSales}?filter=needsReview:eq:true`
- Copy from (precedent): the `IntegrationSync` case (payload-carried text) in `content.ts:1358-1363`, and its `Notifications.tsx` case

**Steps:**
1. `buildEventContent`: description `Recurring invoicing: ${payload.body}`, no per-document reads.
2. `Notifications.tsx`: title "Recurring invoicing", description = the notification's body, link to the Needs Review filter. Mirror how the IntegrationSync case reads its payload text. If that case does not exist or reads a different field, STOP and report which payload field carries `body`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/notifications --filter=@carbon/jobs --filter=erp
# Expected: no new errors
grep -rn "RecurringInvoicing" packages/notifications/src/index.ts packages/jobs/src/inngest/functions/notifications apps/erp/app/components/Layout/Topbar/Notifications.tsx apps/erp/app/routes/api+/link.ts | wc -l
# Expected: >= 7
```

**Out of scope:** email preview fixtures (none exist for payload-carried events); new notification topics.

---

### Task 12: Manual post route — shared PDF, storage path fix, sent stamps

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.post.tsx`

**Steps:**
1. Replace the `pdfLoader(...)` call and `arrayBuffer` (:777-799) with `loadSalesInvoiceDocument({ client: serviceRole, companyId, companyGroupId, invoiceId, locale: locales?.[0] ?? "en-US", storageUrl: SUPABASE_URL })` + `renderSalesInvoicePdf`. Get `companyGroupId` from `requirePermissions`; if it isn't returned there, read it the way `$id[.]pdf.tsx` does.
2. :802 path → `` `${companyId}/${opportunityId ? `opportunity/${opportunityId}` : `sales-invoice/${invoiceId}`}/${fileName}` ``. Leave the Stripe helper's guard (:85) alone.
3. Email branch (:962-980): right after `trigger("send-email", …)` succeeds, `serviceRole.from("salesInvoice").update({ sentAt: datetime.timestamp(), sentTo: [contactEmail, ...(cc ?? [])].join(", "), sendError: null }).eq("id", invoiceId).eq("companyId", companyId)`. In the catch at :980: `update({ sendError: "Failed to send email" })`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
grep -n "opportunity/\${salesInvoice.data.opportunityId}" "apps/erp/app/routes/x+/sales-invoice+/\$invoiceId.post.tsx"
# Expected: no output
```

**Out of scope:** the Stripe branch; the sales-rule/contact checks; the modal.

---

### Task 13: Settings models/services + Settings → Invoicing page (moving two cards)

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `invoiceAutomations` const + `invoiceAutomationValidator` (precedent `kanbanOutputTypes` :33 / `kanbanOutputValidator` :243-245); `rentalInvoiceNotificationValidator` (precedent `rfqReadyValidator` :347-351)
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — `updateInvoiceAutomationSetting(client, companyId, mode)` and `updateRentalInvoiceNotificationSetting(client, companyId, group)` (precedent `updateRfqReadySetting` :1395-1405, both `/** @mcp update */`)
- Create: `apps/erp/app/routes/x+/settings+/invoicing.tsx`
- Modify: `apps/erp/app/routes/x+/settings+/sales.tsx` — remove the moved intents, cards and state
- Modify: `apps/erp/app/utils/path.ts` — `invoicingSettings: \`${x}/settings/invoicing\`` after `invoicingSales` (~1346)
- Modify: `apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx` — Modules group entry between Inventory (~109) and Items (~115): `{ name: t\`Invoicing\`, to: path.to.invoicingSettings, role: "employee", icon: <LuFileText /> }`
- Copy from (precedent): `routes/x+/settings+/sales.tsx` (page shell :377-384, cards), `routes/x+/settings+/inventory.tsx:235-275` (enum Select card)

**Steps:**
1. `invoiceAutomations = ["Draft Only", "Post", "Post and Email"] as const` with a comment that it mirrors the DB enum. `invoiceAutomationValidator = z.object({ invoiceAutomation: z.enum(invoiceAutomations) })`.
2. `invoicing.tsx`: loader `requirePermissions({ view: "settings" })` + `getCompanySettings` + `getAccountsReceivableBillingAddress` (same redirect as sales.tsx:78-85). Action `requirePermissions({ update: "settings" })` + `switch (intent)` with:
   - `invoiceAutomation` → `updateInvoiceAutomationSetting`
   - `receivablesEmail` → `accountsReceivableEmailValidator` + `updateAccountsReceivableEmail` (both exist, unused)
   - `rentalInvoiceNotifications` → `updateRentalInvoiceNotificationSetting`
   - `emails`, `accountsReceivableAddressToggle`, `accountsReceivableBillingAddress` → moved verbatim from sales.tsx (:265-290, :117-130, :240-263)
3. JSX, in order:
   - "Recurring Invoices" card (enum Select; labels `Draft only` / `Post` / `Post and email`; description from spec UI Changes)
   - "Receivables Email" card (`Input name="accountsReceivableEmail"`)
   - "Notifications" card: description "Each agreement's salesperson (or its creator) gets a daily summary of their rental invoices." plus `Users name="invoiceNotificationGroup" type="employee"` labelled "Also notify", with helper text "Gets the summary for every agreement"
   - then the moved Emails card (sales.tsx:390-431, fixing its spinner check to `intent === "emails"`)
   - the Centralized Billing Address card plus nested form (:480-580) with its state/handlers (:299-374).
4. Delete those three intents, the two cards, their state, the AR-address loader read and now-unused imports from `sales.tsx`. The "Require a Customer Contact and Location" card (:432-479) STAYS in sales.tsx.
5. All strings in `<Trans>`/`t`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
grep -n "defaultCustomerCc\|accountsReceivableBillingAddress" "apps/erp/app/routes/x+/settings+/sales.tsx"
# Expected: no output
```

**Out of scope:** moving any other card; the AP address/email.

---

### Task 14: Agreement override — model, service, update route, properties field

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `invoiceAutomations` const next to `rentalBillingCycles` (:1376); `rentalAgreementInvoiceAutomationValidator = z.object({ invoiceAutomation: z.enum(invoiceAutomations).nullable() })`
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `updateRentalAgreementInvoiceAutomation` after `updateRentalAgreement` (:8690-8729)
- Modify: `apps/erp/app/routes/x+/rental-agreement+/update.tsx` — `intent === "invoiceAutomation"` branch BEFORE the `isTermField` check (:66-78)
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.tsx` — loader adds `contactEmail` (customerContact → contact(email)) to the `Promise.all` at :63-73 and returns it
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementProperties.tsx` — Invoicing Select
- Copy from (precedent): the billingCycle field `RentalAgreementProperties.tsx:299-314`; `rentalRefusal` `sales.service.ts:8680`

**Steps:**
1. The service:
```ts
/** @mcp update */
export async function updateRentalAgreementInvoiceAutomation(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; invoiceAutomation: InvoiceAutomation | null; updatedBy: string }
)
```
   It reads the agreement (`status, customerContactId`) under `companyId`. Not Draft/Active → `rentalRefusal("RENTAL_AGREEMENT_CLOSED", "Invoicing can only be changed on a Draft or Active agreement")`. `invoiceAutomation === "Post and Email"` and the contact's `contact.email` is empty → `rentalRefusal("RENTAL_INVOICE_EMAIL_NO_CONTACT", "Add a contact with an email to send invoices")`. Otherwise `update(sanitize({ invoiceAutomation, updatedBy, updatedAt: datetime.timestamp() })).eq("id").eq("companyId")`.
2. `update.tsx`: when `formData.get("intent") === "invoiceAutomation"`, validate `{ invoiceAutomation: value === "" ? null : value }` with the new validator, call the service, and return `{ error, data }` in the route's existing shape. Same `requirePermissions({ update: "sales" })`.
3. Properties: a `Select` named `invoiceAutomation`, label "Invoicing", options `[{ value: "", label: \`Company default (${companyLabel})\` }, ...modes]`, where `companyLabel` comes from `useSettings().invoiceAutomation`. "Post and email" is `disabled` when `!contactEmail`, with helper text "Add a contact with an email to send invoices". If `Select` options don't support `disabled`, filter the option out and show the helper text instead. The field is read-only unless `["Draft","Active"].includes(agreement.status) && permissions.can("update","sales")`. `onChange` submits FormData `{ id, intent: "invoiceAutomation", value }` to `path.to.rentalAgreementUpdate` via the panel's `fetcher`. Under the field, when `agreement.effectiveInvoiceAutomation === "Post and Email" && !contactEmail`, show the note "Invoices will be posted but not emailed — the contact has no email".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
grep -n "updateRentalAgreementInvoiceAutomation" apps/erp/app/modules/sales/sales.service.ts "apps/erp/app/routes/x+/rental-agreement+/update.tsx"
# Expected: definition + one call
```

**Out of scope:** `updateRentalAgreement` and its Draft guard; `TERM_FIELDS`.

---

### Task 14b: Agreement shows invoicing is automatic; button becomes "Invoice Now"

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementHeader.tsx` — the header button (:186-195) and the `invoice` confirm copy (:116-121)
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementSummary.tsx` — under the "Next Due:" row (:142-153)
- Copy from (precedent): the "Next Due:" `HStack` itself (`text-sm text-muted-foreground`) and `DateTime` usage at :147-148

**Steps:**
1. Header button: label `<Trans>Invoice Now</Trans>`, `variant="secondary"` always. Drop the `allPeriodsBilled ? … : "primary"` switch, since a primary button reads as a chore. If `allPeriodsBilled` is then unused, remove it. Keep the icon, the `isActive` gate and `canUpdate`.
2. Confirm copy: title `Invoice ${readableId} now`; text "Invoices are created automatically every day for whatever is due. Use this to bill what's due right away — for example after adding a charge. Invoices then follow this agreement's invoicing setting."; confirmText `Invoice Now`.
3. Summary: below the Next Due row, one muted line (`text-xs text-muted-foreground`) derived from `rentalAgreement.status`, `rentalAgreement.nextDueOn` and `rentalAgreement.effectiveInvoiceAutomation` (view column from Task 2). Put the choice in a small pure function at the bottom of the file, `invoicingScheduleText(status, nextDueOn, mode)`, returning a Lingui message:
   - Draft → "Invoices are created automatically once the agreement is active."
   - Active, `nextDueOn` set → `Post and Email`: "Next invoice {date} is created automatically, then posted and emailed." `Post`: "…, then posted." `Draft Only`: "…, and left as a draft for review." `{date}` is rendered with `<DateTime value={nextDueOn} variant="date" />` (compose with `<Trans>` placeholders, as other Rentals components do).
   - Active, no `nextDueOn` → "Nothing is due. Invoices are created automatically when a period comes due."
   - Closed / Cancelled → render nothing.
4. All strings via Lingui. No JS `Date`: `nextDueOn` is a `YYYY-MM-DD` string passed straight to `DateTime`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
grep -n "\"primary\"" apps/erp/app/modules/sales/ui/Rentals/RentalAgreementHeader.tsx
# Expected: no match on the Invoice Now button (other buttons may still be primary)
```

**Out of scope:** the generate route's behaviour (Task 15); the properties panel (Task 14).

---

### Task 15: Generate Invoices / Sell to Customer fire automation

**Depends on:** 5, 8
**Files:**
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.invoice.tsx`
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.$lineId.sell.tsx:148-178`
- Copy from (precedent): `batchTrigger` in `packages/lib/src/trigger.ts`; ERP `trigger` import `apps/erp/app/routes/api+/webhook.ramp.$companyId.ts:114`

**Steps:**
1. After generating, `const toAutomate = invoices.filter(i => i.mode !== "Draft Only" && !i.holdReason)`. If non-empty, `await batchTrigger("invoice-automate", toAutomate.map(i => ({ payload: { companyId, invoiceId: i.invoiceId } })))` (import from `@carbon/jobs`, as `trigger` is; if `batchTrigger` isn't re-exported there, loop `trigger`).
2. Flash in `$id.invoice.tsx`: when `toAutomate.length > 0`, "Generated N invoice(s); posting M automatically". Otherwise keep today's message. Sell to Customer only produces a held charges invoice under automation, so its flash is unchanged and nothing is triggered unless `toAutomate` is non-empty.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
```

**Out of scope:** posting synchronously in the route.

---

### Task 16: Agreement cards show held invoices

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.tsx:77-91,138-146` — select `salesInvoice(id, invoiceId, status, automationHoldReason)`
- Modify: `apps/erp/app/modules/sales/ui/Rentals/types.ts` — `RentalInvoiceLinks` value gains `status: string | null; automationHoldReason: string | null`
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalBillingPeriods.tsx:139-147` and `RentalAgreementCharges.tsx:139-146`
- Copy from (precedent): the adjustment `<Badge variant="orange">` at `RentalBillingPeriods.tsx:119-123`

**Steps:**
1. In both Invoice cells, after the hyperlink: when `status === "Draft" && automationHoldReason`, render `<Badge variant="orange">` with the text "Held" and a tooltip/title of the reason. Use whatever tooltip wrapper the Rentals UI already uses; if none, put the reason in the badge's `title`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
```

**Out of scope:** a new invoices list on the agreement.

---

### Task 17: Invoice header badges + Send route

**Depends on:** 8
**Files:**
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader.tsx` (status area :320-332)
- Create: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.send.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `salesInvoiceSend: (id: string) => generatePath(\`${x}/sales-invoice/${id}/send\`)` next to `salesInvoicePost` (match its exact style)
- Copy from (precedent): `PurchaseInvoiceHeader.tsx:333-337` (`<Status color="red">`); an action-only route such as `x+/rental-agreement+/$id.invoice.tsx`

**Steps:**
1. Header, after `<SalesInvoiceStatus>`:
   - `status === "Draft" && automationHoldReason` → `<Status color="orange" title={reason}>Held</Status>`.
   - Posted with `sentAt` → `<Status color="green">Emailed</Status>` with title `` `To ${sentTo} on ${formatDate(sentAt)}` `` (`formatDate` from `@carbon/utils`).
   - Posted with `sendError && !sentAt` → `<Status color="red" title={sendError}>Not sent</Status>` plus a "Send" button (`Button variant="secondary"`, `LuSend` icon) that submits a fetcher POST to `path.to.salesInvoiceSend(id)`, disabled without `permissions.can("update","invoicing")`.
2. Route: `requirePermissions({ update: "invoicing" })`; re-read the invoice under `companyId` (404 on miss). Refuse unless it is posted and `sentAt` is null. `trigger("invoice-automate", { companyId, invoiceId, mode: "Post and Email" })`. Redirect back with flash "Sending invoice".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
```

**Out of scope:** the post modal; Stripe sending.

---

### Task 18: Invoices list — needsReview column + Needs Review link

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts:72-73` — append `needsReview, automationHoldReason, sendError, sentAt` to `SALES_INVOICES_LIST_COLUMNS`
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx` — a hidden-by-default boolean `needsReview` column with `meta.filter: { type: "static", options: [{ value: "true", label: t\`Yes\` }, { value: "false", label: t\`No\` }] }` (precedent: the status column :126-145)
- Modify: `apps/erp/app/modules/invoicing/ui/useInvoicingSubmodules.tsx:89-95` — under Accounts Receivable, after Sales Invoices: `{ name: t\`Needs Review\`, to: \`${path.to.invoicingSales}?filter=needsReview:eq:true\`, icon: <LuTriangleAlert /> }` (match the sibling entries' fields)

**Steps:**
1. Find how the table declares a column hidden by default (`defaultColumnVisibility` or similar). If no such mechanism exists, show the column.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
```

**Out of scope:** system-wide saved views.

---

### Task 19: MCP metadata, lint, i18n, scoped typechecks, tests

**Depends on:** 4–18 (including 5b)
**Files:** generated MCP metadata, `.po` catalogs

**Steps:**
1. `pnpm run generate:mcp` (new `@mcp update` services: `updateRentalAgreementInvoiceAutomation`, `updateInvoiceAutomationSetting`, `updateRentalInvoiceNotificationSetting`).
2. `pnpm --filter @carbon/checks license-headers` (new files).
3. `pnpm run lint`.
4. `/translate` for the new Lingui strings.
5. The scoped typechecks and tests below.

**Verify:**
```bash
pnpm run lint
# Expected: no errors
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/lib --filter=@carbon/database --filter=@carbon/notifications
# Expected: no errors beyond the Task 1 baseline
pnpm --filter @carbon/database test && pnpm --filter @carbon/jobs test && pnpm --filter @carbon/lib test
# Expected: all pass
pnpm --filter @carbon/checks lint
# Expected: no new findings (spdx-license-header, no-db-client-in-service, no-raw-rounding)
```

**Out of scope:** whole-repo typecheck.

---

### Task 20: Docs — AGENTS.md, rules, spec changelog

**Depends on:** 19
**Files:**
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — Rentals "Invoice generation" bullet (:140): drafts AND automates (mode, split, holds, the automate event, the Send route); remove "Only drafts — posting stays human." Add to the `rentalBillingPeriod` / `rentalAgreementCharge` table rows: `voidedSalesInvoiceId`, set by VOID, makes the re-bill a held draft, sticky across a deleted draft.
- Modify: `apps/erp/app/modules/settings/AGENTS.md` — the Invoicing settings page and its cards
- Modify: `apps/erp/app/modules/invoicing/AGENTS.md` — `automationHoldReason`/`sentAt`/`sentTo`/`sendError`, `needsReview`, the send route, the storage path for invoices without an opportunity
- Modify: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part II — fold in this plan's "Plan-level decisions"; Changelog line; status `in-progress`

**Verify:**
```bash
grep -n "posting stays human" apps/erp/app/modules/sales/AGENTS.md
# Expected: no output
```

**Out of scope:** moving the spec to `implemented/` (needs the user's OK).

---

### Task 21: Browser verification (`/test`)

**Depends on:** 20
**Files:** playbook under `.ai/playbooks/` if `/test` writes one

**Steps:**
Use `/test` (needs `crbn up`; ask the user before starting it). Then:
1. Settings → Invoicing shows five cards. Saving each persists (reload). Settings → Sales no longer shows Emails or Centralized Billing Address.
2. On an Active agreement whose contact has an email, with a due period: set Invoicing to "Post and email", click Generate Invoices, and wait for the Inngest run. The invoice becomes Submitted with an "Emailed" badge, and the email arrives (local SMTP catcher) with From "<Company>" and Reply-To = the receivables email.
3. Add a damage charge and generate. A second Draft invoice shows "Held", and the agreement's Charges card shows "Held".
4. Clear the contact's email. The "Post and email" option is disabled and the note shows when the company default is Post and email. Generate: the invoice is Submitted with "Not sent". Click Send after restoring the email: it becomes "Emailed".
5. Receivables → Needs Review lists the held and unsent invoices.
6. Open a rental invoice PDF (`file/sales-invoice/<id>.pdf`) and a non-rental invoice PDF. Both render as before.
7. With NO notification group set, run the cron via the Inngest dev UI ("Invoke" `recurring-billing`). The agreement's salesperson (or creator) gets one "Recurring invoicing" notification, in the topbar and by email. Then add a different user to "Also notify" and re-run with a new due period: that user also gets one.
8. Void the posted rent invoice from step 2 (⋯ → Void). The agreement's Billing Periods card shows the period Pending again. Click Invoice (Generate Invoices): the new rent invoice is Draft and "Held" with "Re-billing INV-…, which was voided", and nothing is posted or emailed. Delete that draft and generate again: still held.
9. On an Active agreement the header shows a secondary "Invoice Now" button, and the summary reads "Next invoice <date> is created automatically, then posted and emailed." Switch the agreement to Draft only: the line says "…left as a draft for review."

**Verify:** every step above passes; screenshots saved under `.context/`.

**Out of scope:** Stripe sending.

# Part III — Contracts, Phase A

> Was `.ai/plans/2026-10-03-contracts-phase-a.md` ("Contracts, Phase A — implementation plan"), merged here verbatim on 2026-10-07. Decision, question and section numbers in this Part (D1, Q3, §2, Task 4) are its own.

> Phase A of `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III ("Delivery phases"): contracts, lines, an invoice schedule you can edit, amendments, cancellation with a credit memo, renewal, contract types, discounts, *Billed through*, Create Contract from a sales order, the contract source in `recurring-billing`, contract holds, and the *Post and Send via Stripe* mode.
> Phase B (separate plan, not here) builds the line-level revenue engine: `customerContractRevenue`, the contract branches of `post-sales-invoice` / `post-memo` that relieve Contract Assets, `synthesizeContractRevenue`, the posting effect of Even Period and *Recognize revenue from*, and the contract position view.

**Spec:** `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III
**Interview record:** .ai/runs/2026-10-02-contracts.md (Q1–Q11, U1–U4, G1–G9, Handoff "Split")
**Research:** .ai/research/subscription-recurring-invoicing.md
**Builds on:** Part II (shared recurring-invoicing layer, executed; only Task 21's email check is still pending)
**Branch:** revenue-recognition-rentals-spec. Rentals and the shared layer are not on `main` yet, and this plan builds on both.

### Where the spec's names live now

The spec was written before edge functions became Node server functions (`f58d55409d`) and before rental math moved to `@carbon/utils` (`4489907c8b`). Read the spec through this table:

| Spec says | Build it at |
|---|---|
| `packages/database/supabase/functions/shared/contract-schedule.ts` (re-exported by `@carbon/utils`) | `packages/database/src/contract-schedule.ts`, subpath `@carbon/database/contract-schedule`, re-exported from the `@carbon/utils` root (as `precision` is). It lives in `@carbon/database` so the demo-dataset tier, which cannot import `@carbon/utils`, can plan a schedule. |
| Revenue preview math (`revenueSchedule`, `contractPosition`) | `packages/utils/src/contract-revenue.ts`, which reuses `spreadStraightLine` from `revenue-schedule.ts` |
| `@carbon/database/contract-billing` (`confirmContract`, `applyContractAmendment`, `cancelContract`, `renewDueContracts`, `createContractInvoicesForDuePlannedInvoices`) | Two server functions. `post-customer-contract` covers confirm, schedule edits, amend, cancel and revert. `create-contract-invoices` covers renewal, the horizon roll, ending a contract, and drafting. |
| Edge functions `post-sales-invoice` / `post-memo` / `convert` | `packages/server-functions/src/<name>/` |
| `automateSalesInvoice` | `postSalesInvoiceUnattended` + `emailPostedInvoice` (`packages/jobs/src/invoicing/automate-invoice.ts`), plus a new `sendPostedInvoiceViaStripe` |
| `releaseRecurringInvoiceStamps` | `releaseRentalInvoiceStamps` in `apps/erp/app/modules/sales/sales.server.ts:413`, generalized |

### Plan-level decisions (fold into the spec changelog at close-out)

These refine the spec where the code facts gathered for this plan disagree with its assumptions. Reviewed with Brad on 2026-10-03: decision 3 was changed to a real line discount; the project dimension (decision 5) was confirmed; the rest were approved as written.

1. **No `customerContractRevenue` table in Phase A.** It belongs to Phase B (spec "Delivery phases"). The Revenue section is a preview computed from the lines (`contract-revenue.ts`). Posted revenue comes from the Service-line deferral that each invoice line already triggers.
2. **The invoice schedule is persisted only once someone edits it, or at Confirm.** While a Draft is unedited, the loader computes the schedule live from the lines with the pure planner. The first schedule edit materializes it (`customerContractInvoice` rows, `isEdited = true`). If lines change after an edit, the per-line residual shows and the page offers *Reset schedule*. Confirm materializes an unedited schedule, and refuses an edited one that no longer conserves every line's total. This means a line written through MCP can never leave a stale persisted schedule behind.
3. **Sales invoice lines get a real discount (user, 2026-10-03).** `salesInvoiceLine.discountPercent NUMERIC NOT NULL DEFAULT 0` is a fraction from 0 to 1, as on `quoteLinePrice`, with generated `netUnitPrice` / `convertedNetUnitPrice` columns copied from the quote pattern (`20260811123619_widen-sales-production-scale.sql:55-58`). It discounts **merchandise only** (`quantity × unitPrice`). Add-on, non-taxable add-on and shipping are not discounted. Tax is charged on the discounted merchandise. Every place that computes line or invoice amounts applies it: the `salesInvoices` view's totals, `calculateSalesPostingAmounts`, the documents helpers + PDF + email, the ERP invoice summary and line form, the Stripe line conversion and expected total, the accounting-provider sales document builder, and rental utilization (Tasks 3b, 13b–13e). Existing rows default to 0, so nothing already posted changes. A contract invoice line carries the contract line's **list** `unitPrice` per unit and its `discountPercent`, so the invoice shows price + discount (spec G8).
4. **The cancellation credit memo posts to Deferred Revenue, not Sales Discount.** Today `post-memo` offsets an AR credit memo to `salesDiscountAccount` (`post-memo-transaction.ts:295-301`). That would leave the credited period's Planned Service-deferral rows in place, so the cancelled days would still be recognized. A memo with `customerContractId` instead debits Deferred Revenue up to the Planned deferral it releases and debits Sales for any remainder already recognized. It deletes or trims those Planned rows in the posting transaction. Voiding a contract memo is refused (the spec already makes the cancellation irreversible once its memo has posted).
5. **The project is carried on `salesInvoiceLine.projectId`, and `post-sales-invoice` writes it as the Project dimension.** Sales posting has no Project dimension today; only purchase invoices, charges and reimbursements do. Phase A records the project on each drafted invoice line and dimensions the line's Sales / Deferred Revenue journal lines (AR keeps the customer). The recognition-run journal is Phase B. This is the spec's "one-way door": every contract invoice carries its project from the first one.
6. **Rental reconciliation is not extracted.** Rental re-cut and adjustment logic lives inside `generateRentalBillingPeriods` (`packages/utils/src/rental-periods.ts:252`). It is keyed on `returnedAt` and applied by `post-rental-agreement` at return. Contracts get their own `reconcileContractSchedule` in `contract-schedule.ts` using the same adjustment rule (billed amount × days after the new end ÷ days billed, at most one per billed period). Rental files are untouched, which is what the "rental behaviour unchanged" acceptance criterion asks for.
7. **A sales-order line taken into a contract is marked `invoicedComplete = true` when the contract is created**, and released if the Draft contract or that contract line is deleted. `convert` already invoices only lines with `quantityToInvoice > 0 && !invoicedComplete` (`convert/index.ts`, the `salesOrderToSalesInvoice` branch), and the order-status rollup in `post-sales-invoice` reads `invoicedComplete`. The spec's "convert skips contract-linked lines" and "rollup counts them as invoiced" both follow without changing `convert`.
8. **A row created by reconciliation, or a line starting mid-period, lands on the next regular invoice date.** It is not drafted on its own day. This matches the spec's one-time-line rule ("first planned invoice on or after their start date") and the amendment acceptance criterion ("the next invoice carries −$206.45 and +$309.68").
9. **Recurring units are counted in whole months from the period start, then by days.** For a Month / Quarter / Year rate unit, `units = (n + remainderDays ÷ daysOfTheNextMonthFromThere) ÷ (1 | 3 | 12)`. Here `n` is the count of whole months added to the period start (`@internationalized/date` `.add({ months })`, which clamps to month end). So an Anniversary period such as 15 Mar–14 Apr is exactly 1, with no proration, and a Calendar partial period is its days ÷ that month's days. The spec's "each partial month's days ÷ its days" would bill 15 Mar–14 Apr at 1.015 months, which contradicts "Anniversary … no proration".
10. **Pricing a schedule row is two roundings at internal scale.** `unitPrice = round(rate × units)` (the list price per contract-line unit for the period) and `amount = round(quantity × unitPrice × (1 − discountPercent))`. The drafted invoice line copies `quantity`, `unitPrice` and `discountPercent`, so its net merchandise equals the row. A row whose amount no longer equals that product (a split installment, an adjustment) is drafted as `quantity` 1, `unitPrice` = amount, `discountPercent` 0, with the discount stated in the description (`invoiceLinePricing`).
11. **Cancellation stores what it changed, so it can be reverted.** `customerContractAmendment.previousState JSONB` holds `{ contractEndDate, renewal, lineEndDates: { [lineId]: string | null } }`. *Revert cancellation* restores from it. This adds a column the spec doesn't have. Memo-borne adjustment rows have no planned invoice, so `customerContractInvoiceLine.customerContractInvoiceId` is nullable, with a CHECK that the row has an invoice or a memo, and the table also gets `customerContractId`.
12. **The contract type is suggested when the contract is created and stays editable** (spec decision 17). Confirm does not overwrite what the user chose. Amendment types are suggested in the amendment preview from the change in recurring value per billing period.
13. **The list's "recurring per period" column is computed in TypeScript on the contract page, not in the view.** Expressing rate-unit-to-frequency conversion in SQL would duplicate `periodUnits`. The list shows contract value, invoiced to date and next invoice from the view. "Recognized" and "deferred" are Phase B.
14. **The Stripe send moves into `@carbon/stripe`** as `sendPostedSalesInvoiceViaStripe` (`packages/stripe/src/send-sales-invoice.server.ts`), so the job and the manual post route share it. `@carbon/stripe` already depends on `@carbon/lib`. The mapping write (`createMappingService` is `@carbon/ee`) is injected as a callback, so `@carbon/stripe` does not gain a commercial dependency.
15. **Demo datasets: one Active contract per dataset, as the spec says**, even though rentals shipped without dataset rows.

### Acceptance criteria covered in Phase A

Every acceptance criterion in the spec is covered except these, which belong to Phase B:

- the Contract Assets criterion (implementation billed 2 × $30,000);
- the recognition parts of the Acme posting criterion. Posting the 1 Nov invoice crediting Deferred Revenue $60,420.00 is Phase A, through the Service deferral. The November run releases the implementation line by day ($60,000 × 30/181), not $10,000; the Even Period amount is Phase B;
- "the October run recognizes $1,000 from Deferred Revenue" in the migrated-contract criterion. The no-invoice-before-1-May-2027 part is Phase A;
- "recognition rows post in base" in the EUR criterion. Invoice posting with base translation is Phase A;
- the recognition-run half of the project criterion.

### Progress

- [x] Task 1: Baseline green
- [x] Task 2: Migration — enum values
- [x] Task 3: Migration — contract tables, provenance columns, view, sequence
- [x] Task 3b: Migration — sales invoice line discount
- [x] Task 4: Authz rules, apply, generated RLS migration, types, DB gates
- [x] Task 5: Pure schedule math (`@carbon/database/contract-schedule`) + tests
- [x] Task 6: Pure revenue preview + contract invoice holds (`@carbon/utils`) + tests
- [x] Task 7: Contract validators (`sales.models.ts`)
- [x] Task 8: Contract services (`sales.service.ts`) with Draft guards and MCP tags
- [x] Task 9: Server function `post-customer-contract` — confirm, schedule edits, reset
- [x] Task 10: `post-customer-contract` — amend
- [x] Task 11: `post-customer-contract` — cancel and revert cancellation
- [x] Task 12: Server function `create-contract-invoices`
- [x] Task 13: `post-sales-invoice` — VOID releases contract rows; Project dimension
- [x] Task 13b: Line discount — posting amounts
- [x] Task 13c: Line discount — documents (PDF, email)
- [x] Task 13d: Line discount — ERP invoice UI and rental utilization
- [x] Task 13e: Line discount — Stripe and accounting providers
- [x] Task 14: `post-memo` — contract credit memo releases deferral
- [x] Task 15: `sales.server.ts` — release stamps on delete, create from sales order, wrappers
- [x] Task 16: `@carbon/stripe` — shared send of a posted invoice; the post route uses it
- [x] Task 17: Automation — contract source, Stripe mode
- [x] Task 18: `recurring-billing` — the contract source
- [x] Task 19: Settings and rental override offer *Post and Send via Stripe*
- [x] Task 20: Paths, navigation, status colors, route types
- [x] Task 21: Contracts list
- [x] Task 22: Contract page shell — new, header, explorer, properties, update, delete
- [x] Task 23: Line form and line routes
- [x] Task 24: Summary section
- [x] Task 25: Invoices section and schedule editing
- [x] Task 26: Revenue section (preview)
- [x] Task 27: Confirm and Invoice Now
- [x] Task 28: Amend modal, preview, amendment history
- [x] Task 29: Cancel modal and revert
- [x] Task 30: Create Contract from a sales order
- [x] Task 31: "From contract" links on invoices, invoice lines and memos
- [x] Task 32: Demo datasets
- [x] Task 33: MCP digest, lint, i18n, scoped typechecks, tests
- [x] Task 34: Docs — reference page, glossary, AGENTS.md, rules, spec changelog
- [x] Task 35: Browser verification (`/test`)

### Dependencies

- Task 1 → Task 2 → Task 3 → Task 3b → Task 4. Every later task needs Task 4's types.
- Tasks 13b, 13c, 13d and 13e touch disjoint files and are parallel-safe after Task 4. Task 12 (drafting with `discountPercent`) needs 13b. Task 16 (Stripe extraction) must land before 13e's Stripe step, or 13e edits the helpers in their new home. Run 16 first.
- Tasks 5 and 6 are independent of each other and can run in parallel after Task 4.
- Task 7 needs Task 4. Task 8 needs Task 7.
- Task 9 needs Tasks 5 and 6. Task 10 and Task 11 need Task 9. Task 12 needs Tasks 5, 6 and 9.
- Tasks 13, 14 and 16 are independent of each other and of Tasks 5–12 (parallel-safe after Task 4).
- Task 15 needs Tasks 8 and 12. Task 17 needs Tasks 12 and 16. Task 18 needs Task 17.
- Task 19 needs Task 4. Task 20 needs Task 4.
- UI: Task 21 needs Tasks 8 and 20. Task 22 needs Task 21. Tasks 23–26 need Task 22 (23, 24 and 26 touch disjoint files; 25 needs 9). Task 27 needs Tasks 15, 17 and 22. Task 28 needs Tasks 10 and 22. Task 29 needs Tasks 11 and 22. Task 30 needs Tasks 15 and 22. Task 31 needs Task 22.
- Task 32 needs Task 5.
- Tasks 33 → 34 → 35 run last, in order.

---

### Task 1: Baseline green

**Depends on:** none
**Files:** none

**Steps:**
1. `git status` must be clean apart from files this plan's author committed. Run `git fetch origin && git merge origin/main` if `main` has moved. STOP and report any conflict in `post-sales-invoice`, `post-memo`, `convert`, `recurring-billing.ts`, `automate-invoice.ts`, `sales.models.ts`, `sales.service.ts`, `sales.server.ts` or the `$invoiceId.post.tsx` route.
2. Record a baseline of the commands below in the run log `.ai/runs/2026-10-02-contracts.md`. Later tasks compare against these results, not against zero.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/server-functions --filter=@carbon/database --filter=@carbon/utils --filter=@carbon/stripe --concurrency=1
# Expected: all successful, or the pre-existing failures recorded in the run log
pnpm --filter @carbon/utils test && pnpm --filter @carbon/database test && pnpm --filter @carbon/server-functions test && pnpm --filter @carbon/jobs test
# Expected: all pass, or the pre-existing failures recorded
```

**Out of scope:** fixing pre-existing failures.

---

### Task 2: Migration — enum values

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_contract-enums.sql` (via `pnpm db:migrate:new contract-enums`)
- Copy from (precedent): `packages/database/supabase/migrations/20260923003308_rental-enums.sql`

**Steps:**
1. `pnpm db:migrate:new contract-enums`. The timestamp must be newer than the newest file in `packages/database/supabase/migrations/` before you ran it (`20261003191518` when this plan was written). Its HHMMSS must not be `000000`. Do not create the file while a `db:migrate` is running.
2. Write the following. `ADD VALUE` must sit in a migration earlier than anything that uses the value, which is why this file is separate.
```sql
-- Contracts (`.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III). Enum values only: an ADD VALUE
-- cannot share a transaction with statements that use it.
ALTER TYPE "invoiceAutomation" ADD VALUE IF NOT EXISTS 'Post and Send via Stripe';

DO $$ BEGIN CREATE TYPE "customerContractStatus" AS ENUM ('Draft', 'Active', 'Ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "customerContractType" AS ENUM ('New Sales', 'Existing', 'Expansion', 'Reactivation', 'Contraction');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "customerContractLineKind" AS ENUM ('One-time', 'Recurring');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractRateUnit" AS ENUM ('Day', 'Week', 'Month', 'Quarter', 'Year');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractBillingFrequency" AS ENUM ('Week', 'Month', 'Quarter', 'Year');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractBillingAlignment" AS ENUM ('Anniversary', 'Calendar');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractBillingTiming" AS ENUM ('Advance', 'Arrears');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractRenewal" AS ENUM ('Renew', 'End');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- A method, not a pattern: 'As Invoiced' and 'Percent Complete' arrive later as values.
DO $$ BEGIN CREATE TYPE "contractRevenueMethod" AS ENUM ('Daily', 'Even Period');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractAmendmentEffect" AS ENUM ('Change Date', 'Next Period');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractInvoiceStatus" AS ENUM ('Planned', 'Invoiced', 'Billed Externally');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -1 | grep -c "contract-enums"
# Expected: 1
grep -c "CREATE TYPE" packages/database/supabase/migrations/*_contract-enums.sql
# Expected: 11
```

**Out of scope:** `revenueScheduleStatus` (Phase B uses the existing enum).

---

### Task 3: Migration — contract tables, provenance columns, view, sequence

**Depends on:** 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_contracts.sql` (via `pnpm db:migrate:new contracts`)
- Copy from (precedent): `packages/database/supabase/migrations/20261006220501_rental-agreements.sql`. Copy its table shape (lines 30–80), the sequence backfill (section "10) Sequence per company", around line 271) and the `salesInvoiceLines` view recreation (line 217).

**Steps:**
1. `pnpm db:migrate:new contracts`. It must be newer than `_contract-enums.sql`.
2. Before writing any FK, check the target's primary key: `grep -n "_pkey\" PRIMARY KEY" packages/database/supabase/migrations/*.sql | grep -E '"(customer|customerContact|customerLocation|item|paymentTerm|salesOrder|salesOrderLine|memo|project)_pkey"'`. A single-column `("id")` PK takes `REFERENCES "<t>"("id")` as written below. A composite PK takes `FOREIGN KEY ("<col>", "companyId") REFERENCES "<t>"("id", "companyId")`, plus `ON DELETE SET NULL ("<col>")` when nullable. If a target in the list below is composite and is written single-column here, convert it.
3. Write:
```sql
-- Contracts, Phase A (`.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III, Part III).
-- RLS comes from the authz manifest (no CREATE POLICY here).

-- 1) Header -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customerContract" (
  "id" TEXT NOT NULL DEFAULT id('con'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "customerContractStatus" NOT NULL DEFAULT 'Draft',
  "contractType" "customerContractType" NOT NULL DEFAULT 'New Sales',
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "invoiceCustomerId" TEXT REFERENCES "customer"("id"),
  "invoiceCustomerContactId" TEXT REFERENCES "customerContact"("id"),
  "invoiceCustomerLocationId" TEXT REFERENCES "customerLocation"("id"),
  "salesPersonId" TEXT REFERENCES "user"("id"),
  "salesOrderId" TEXT REFERENCES "salesOrder"("id") ON DELETE SET NULL,
  "projectId" TEXT,
  "customerReference" TEXT,
  "closeDate" DATE NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "termMonths" INTEGER CHECK ("termMonths" > 0),
  "renewal" "contractRenewal" NOT NULL DEFAULT 'End',
  "renewalUplift" NUMERIC NOT NULL DEFAULT 0 CHECK ("renewalUplift" >= 0),
  "billingFrequency" "contractBillingFrequency" NOT NULL DEFAULT 'Month',
  "billingAlignment" "contractBillingAlignment" NOT NULL DEFAULT 'Anniversary',
  "billingTiming" "contractBillingTiming" NOT NULL DEFAULT 'Advance',
  "firstInvoiceDate" DATE,
  "billedThrough" DATE,
  "recognizeRevenueFrom" DATE,
  "invoiceAutomation" "invoiceAutomation",
  "paymentTermId" TEXT REFERENCES "paymentTerm"("id"),
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
  "notes" JSONB,
  "confirmedAt" TIMESTAMP WITH TIME ZONE,
  "confirmedBy" TEXT REFERENCES "user"("id"),
  "cancelledAt" TIMESTAMP WITH TIME ZONE,
  "cancellationReason" TEXT,
  "endedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerContract_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContract_customerContractId_companyId_key" UNIQUE ("customerContractId", "companyId"),
  CONSTRAINT "customerContract_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContract_project_fkey" FOREIGN KEY ("projectId", "companyId")
    REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  -- endDate = startDate - 1 is a contract cancelled back to nothing
  CONSTRAINT "customerContract_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate" - 1)
);
CREATE INDEX IF NOT EXISTS "customerContract_companyId_idx" ON "customerContract" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContract_companyId_status_idx" ON "customerContract" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "customerContract_customerId_idx" ON "customerContract" ("customerId");
CREATE INDEX IF NOT EXISTS "customerContract_invoiceCustomerId_idx" ON "customerContract" ("invoiceCustomerId");
CREATE INDEX IF NOT EXISTS "customerContract_invoiceCustomerContactId_idx" ON "customerContract" ("invoiceCustomerContactId");
CREATE INDEX IF NOT EXISTS "customerContract_invoiceCustomerLocationId_idx" ON "customerContract" ("invoiceCustomerLocationId");
CREATE INDEX IF NOT EXISTS "customerContract_salesPersonId_idx" ON "customerContract" ("salesPersonId");
CREATE INDEX IF NOT EXISTS "customerContract_salesOrderId_idx" ON "customerContract" ("salesOrderId");
CREATE INDEX IF NOT EXISTS "customerContract_projectId_idx" ON "customerContract" ("projectId");
CREATE INDEX IF NOT EXISTS "customerContract_paymentTermId_idx" ON "customerContract" ("paymentTermId");
CREATE INDEX IF NOT EXISTS "customerContract_confirmedBy_idx" ON "customerContract" ("confirmedBy");
CREATE INDEX IF NOT EXISTS "customerContract_createdBy_idx" ON "customerContract" ("createdBy");

-- 2) Amendments -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customerContractAmendment" (
  "id" TEXT NOT NULL DEFAULT id('cona'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "amendmentDate" DATE NOT NULL,                -- the effective date, after snapping
  "effect" "contractAmendmentEffect" NOT NULL DEFAULT 'Change Date',
  "contractType" "customerContractType" NOT NULL,
  "reason" TEXT NOT NULL,
  -- What a cancellation changed, so it can be reverted:
  -- { contractEndDate, renewal, lineEndDates: { [lineId]: date | null } }. NULL otherwise.
  "previousState" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractAmendment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractAmendment_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractAmendment_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "customerContractAmendment_companyId_idx" ON "customerContractAmendment" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractAmendment_customerContractId_idx" ON "customerContractAmendment" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractAmendment_createdBy_idx" ON "customerContractAmendment" ("createdBy");

-- 3) Lines ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customerContractLine" (
  "id" TEXT NOT NULL DEFAULT id('conl'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "kind" "customerContractLineKind" NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "description" TEXT,
  "quantity" NUMERIC NOT NULL DEFAULT 1 CHECK ("quantity" > 0),
  "rate" NUMERIC NOT NULL CHECK ("rate" >= 0),
  "rateUnit" "contractRateUnit",
  "discountPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("discountPercent" >= 0 AND "discountPercent" <= 1),
  "discountEndsOn" DATE,
  "taxPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1),
  "startDate" DATE NOT NULL,
  "endDate" DATE,                               -- NULL = runs to the contract's end
  "goLiveDate" DATE,
  "revenueMethod" "contractRevenueMethod" NOT NULL DEFAULT 'Daily',
  "revenueStartDate" DATE,
  "revenueEndDate" DATE,
  "amendmentId" TEXT,
  "amendsLineId" TEXT,
  "salesOrderLineId" TEXT REFERENCES "salesOrderLine"("id") ON DELETE SET NULL,
  "projectId" TEXT,
  "sortOrder" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerContractLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractLine_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractLine_amendment_fkey" FOREIGN KEY ("amendmentId", "companyId")
    REFERENCES "customerContractAmendment"("id", "companyId") ON DELETE SET NULL ("amendmentId"),
  CONSTRAINT "customerContractLine_amendsLine_fkey" FOREIGN KEY ("amendsLineId", "companyId")
    REFERENCES "customerContractLine"("id", "companyId") ON DELETE SET NULL ("amendsLineId"),
  CONSTRAINT "customerContractLine_project_fkey" FOREIGN KEY ("projectId", "companyId")
    REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  CONSTRAINT "customerContractLine_rateUnit_check" CHECK (("kind" = 'Recurring') = ("rateUnit" IS NOT NULL)),
  CONSTRAINT "customerContractLine_amends_check" CHECK ("amendsLineId" IS NULL OR "amendmentId" IS NOT NULL),
  CONSTRAINT "customerContractLine_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate" - 1)
);
CREATE INDEX IF NOT EXISTS "customerContractLine_companyId_idx" ON "customerContractLine" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractLine_customerContractId_idx" ON "customerContractLine" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractLine_itemId_idx" ON "customerContractLine" ("itemId");
CREATE INDEX IF NOT EXISTS "customerContractLine_amendmentId_idx" ON "customerContractLine" ("amendmentId");
CREATE INDEX IF NOT EXISTS "customerContractLine_amendsLineId_idx" ON "customerContractLine" ("amendsLineId");
CREATE INDEX IF NOT EXISTS "customerContractLine_projectId_idx" ON "customerContractLine" ("projectId");
CREATE INDEX IF NOT EXISTS "customerContractLine_createdBy_idx" ON "customerContractLine" ("createdBy");
CREATE UNIQUE INDEX IF NOT EXISTS "customerContractLine_salesOrderLine_key"
  ON "customerContractLine" ("salesOrderLineId", "companyId") WHERE "salesOrderLineId" IS NOT NULL;

-- 4) The invoice schedule: planned invoices and their lines -----------------------------
CREATE TABLE IF NOT EXISTS "customerContractInvoice" (
  "id" TEXT NOT NULL DEFAULT id('coni'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "invoiceDate" DATE NOT NULL,
  "status" "contractInvoiceStatus" NOT NULL DEFAULT 'Planned',
  "salesInvoiceId" TEXT,                        -- stamp when drafted (no FK, rental precedent)
  "isEdited" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractInvoice_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractInvoice_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractInvoice_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "customerContractInvoice_companyId_idx" ON "customerContractInvoice" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_due_idx" ON "customerContractInvoice" ("companyId", "status", "invoiceDate");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_customerContractId_idx" ON "customerContractInvoice" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_salesInvoiceId_idx" ON "customerContractInvoice" ("salesInvoiceId");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_createdBy_idx" ON "customerContractInvoice" ("createdBy");

CREATE TABLE IF NOT EXISTS "customerContractInvoiceLine" (
  "id" TEXT NOT NULL DEFAULT id('conil'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "customerContractInvoiceId" TEXT,             -- NULL only for a cancellation credit (memoId set)
  "customerContractLineId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "units" NUMERIC NOT NULL,
  "unitPrice" NUMERIC NOT NULL,                 -- per contract-line unit, net of discount
  "amount" NUMERIC NOT NULL,                    -- negative for an adjustment
  "isAdjustment" BOOLEAN NOT NULL DEFAULT FALSE,
  "salesInvoiceLineId" TEXT,                    -- stamp (no FK, rental precedent)
  "voidedSalesInvoiceId" TEXT,                  -- re-bill hold (rental D26)
  "memoId" TEXT,                                -- cancellation credit
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractInvoiceLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractInvoiceLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_invoice_fkey" FOREIGN KEY ("customerContractInvoiceId", "companyId")
    REFERENCES "customerContractInvoice"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId")
    REFERENCES "customerContractLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_dates_check" CHECK ("periodEnd" >= "periodStart"),
  CONSTRAINT "customerContractInvoiceLine_parent_check" CHECK ("customerContractInvoiceId" IS NOT NULL OR "memoId" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_companyId_idx" ON "customerContractInvoiceLine" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_customerContractId_idx" ON "customerContractInvoiceLine" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_invoiceId_idx" ON "customerContractInvoiceLine" ("customerContractInvoiceId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_lineId_idx" ON "customerContractInvoiceLine" ("customerContractLineId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_salesInvoiceLineId_idx" ON "customerContractInvoiceLine" ("salesInvoiceLineId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_memoId_idx" ON "customerContractInvoiceLine" ("memoId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_createdBy_idx" ON "customerContractInvoiceLine" ("createdBy");

-- 5) Provenance on existing tables ------------------------------------------------------
ALTER TABLE "salesInvoice" ADD COLUMN IF NOT EXISTS "customerContractId" TEXT;
ALTER TABLE "salesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "customerContractId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerContractLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerContractInvoiceLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "memo" ADD COLUMN IF NOT EXISTS "customerContractId" TEXT;

DO $$ BEGIN
  ALTER TABLE "salesInvoice" ADD CONSTRAINT "salesInvoice_customerContract_fkey"
    FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId")
    ON DELETE SET NULL ("customerContractId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_customerContract_fkey"
    FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId")
    ON DELETE SET NULL ("customerContractId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_customerContractLine_fkey"
    FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId")
    ON DELETE SET NULL ("customerContractLineId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_customerContractInvoiceLine_fkey"
    FOREIGN KEY ("customerContractInvoiceLineId", "companyId") REFERENCES "customerContractInvoiceLine"("id", "companyId")
    ON DELETE SET NULL ("customerContractInvoiceLineId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_project_fkey"
    FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId")
    ON DELETE SET NULL ("projectId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "memo" ADD CONSTRAINT "memo_customerContract_fkey"
    FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId")
    ON DELETE SET NULL ("customerContractId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "salesInvoice_customerContractId_idx" ON "salesInvoice" ("customerContractId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_customerContractId_idx" ON "salesInvoiceLine" ("customerContractId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_customerContractLineId_idx" ON "salesInvoiceLine" ("customerContractLineId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_customerContractInvoiceLineId_idx" ON "salesInvoiceLine" ("customerContractInvoiceLineId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_projectId_idx" ON "salesInvoiceLine" ("projectId");
CREATE INDEX IF NOT EXISTS "memo_customerContractId_idx" ON "memo" ("customerContractId");
```
4. Recreate `salesInvoiceLines` so it exposes the four new line columns. Find the newest definition with `grep -ln 'VIEW "salesInvoiceLines"' packages/database/supabase/migrations/*.sql | sort | tail -1`. Copy its `DROP VIEW IF EXISTS` and `CREATE VIEW … WITH(SECURITY_INVOKER=true)` statements VERBATIM. If the select list already has `sil.*` (or `"salesInvoiceLine".*`), the recreate alone picks the columns up. Otherwise append `sil."customerContractId", sil."customerContractLineId", sil."customerContractInvoiceLineId", sil."projectId"` after its last column. Before dropping, check for dependent views with `grep -n '"salesInvoiceLines"' packages/database/supabase/migrations/*.sql`. If another view selects from it, STOP and report.
5. The `customerContracts` view:
```sql
DROP VIEW IF EXISTS "customerContracts";
CREATE VIEW "customerContracts" WITH(SECURITY_INVOKER=true) AS
SELECT
  c.*,
  cu."name" AS "customerName",
  COALESCE(c."invoiceAutomation", cs."invoiceAutomation") AS "effectiveInvoiceAutomation",
  (SELECT COUNT(*) FROM "customerContractLine" l
     WHERE l."customerContractId" = c."id" AND l."companyId" = c."companyId") AS "lineCount",
  (SELECT COALESCE(SUM(il."amount"), 0) FROM "customerContractInvoiceLine" il
     WHERE il."customerContractId" = c."id" AND il."companyId" = c."companyId") AS "contractValue",
  (SELECT COALESCE(SUM(il."amount"), 0) FROM "customerContractInvoiceLine" il
     JOIN "customerContractInvoice" ci ON ci."id" = il."customerContractInvoiceId" AND ci."companyId" = il."companyId"
     WHERE il."customerContractId" = c."id" AND il."companyId" = c."companyId" AND ci."status" = 'Invoiced') AS "invoicedToDate",
  (SELECT MIN(ci."invoiceDate") FROM "customerContractInvoice" ci
     WHERE ci."customerContractId" = c."id" AND ci."companyId" = c."companyId" AND ci."status" = 'Planned') AS "nextInvoiceDate"
FROM "customerContract" c
JOIN "customer" cu ON cu."id" = c."customerId"
LEFT JOIN "companySettings" cs ON cs."id" = c."companyId";
```
   `contractValue` on a Draft whose schedule has not been edited is 0, because nothing is persisted yet (decision 2). The list renders that as "—" for Drafts (Task 21).
6. The readable-id sequence for existing companies:
```sql
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'customerContract', 'Contract', 'CON', NULL, 0, 6, 1, c."id"
FROM "company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "sequence" s WHERE s."companyId" = c."id" AND s."table" = 'customerContract'
);
```
7. Add the same sequence for NEW companies to the `sequences` array in `packages/database/src/seed-data.ts`, next to the `rentalAgreement` entry (around line 581):
   `{ table: "customerContract", name: "Contract", prefix: "CON", suffix: null, next: 0, size: 6, step: 1 },`
8. Add the FK-less id columns to `ID_REF_COLUMNS` in `packages/jobs/src/backups/id-refs.ts`, as its header comment requires: `customerContractInvoice: ["salesInvoiceId"]` and `customerContractInvoiceLine: ["salesInvoiceLineId", "voidedSalesInvoiceId", "memoId"]`. Keep the object's alphabetical order. The file is typed against the generated rows, so it compiles only after Task 4.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_contracts.sql
# Expected: 5
grep -c "CREATE POLICY" packages/database/supabase/migrations/*_contracts.sql
# Expected: 0
grep -c "SECURITY_INVOKER=true" packages/database/supabase/migrations/*_contracts.sql
# Expected: 2
grep -n '"customerContract"' packages/database/src/seed-data.ts
# Expected: one sequence entry
```

**Out of scope:** `customerContractRevenue` (Phase B); `TABLE_RENAMES` (nothing is renamed); the `salesInvoices` view (the header link reads `salesInvoice` directly, Task 31).

---

### Task 3b: Migration — sales invoice line discount

**Depends on:** 3
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_sales-invoice-line-discount.sql` (via `pnpm db:migrate:new sales-invoice-line-discount`)
- Copy from (precedent): `packages/database/supabase/migrations/20260811123619_widen-sales-production-scale.sql:55-58` (quote net generated columns); `packages/database/supabase/migrations/20261003053100_sales-invoices-needs-review-posted.sql` (the newest `salesInvoices` view)

**Steps:**
1. `pnpm db:migrate:new sales-invoice-line-discount`. It must be newer than `_contracts.sql`.
2. Columns:
```sql
ALTER TABLE "salesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "discountPercent" NUMERIC NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_discountPercent_check"
    CHECK ("discountPercent" >= 0 AND "discountPercent" <= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "salesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "netUnitPrice" NUMERIC
    GENERATED ALWAYS AS ("unitPrice" * (1 - "discountPercent")) STORED,
  ADD COLUMN IF NOT EXISTS "convertedNetUnitPrice" NUMERIC
    GENERATED ALWAYS AS ("unitPrice" * "exchangeRate" * (1 - "discountPercent")) STORED;
```
   Check `convertedUnitPrice`'s generated expression in `20250507143421_sales-invoice.sql:152-155` (or its newest redefinition: `grep -n '"convertedUnitPrice"' packages/database/supabase/migrations/*.sql | tail -3`). Copy its exact form for `convertedNetUnitPrice` (e.g. if it uses `COALESCE("exchangeRate", 1)`).
3. Recreate `salesInvoiceLines` (DROP + CREATE, copying the definition Task 3 step 4 wrote) so `sl.*` picks up the three new columns.
4. Recreate `salesInvoices`. Confirm `grep -ln 'VIEW "salesInvoices"' packages/database/supabase/migrations/*.sql | sort | tail -1` is `20261003053100_sales-invoices-needs-review-posted.sql` (copy the newest otherwise). Copy its whole statement, including the `WITH(SECURITY_INVOKER=true)` clause and its DROP/CREATE or CREATE OR REPLACE form. Change only the merchandise term inside the `subtotal` SUM (around lines 103–108) and the `totalTax` SUM (around lines 109–115): `"quantity" * "unitPrice"` becomes `"quantity" * "unitPrice" * (1 - "discountPercent")`. If the `lines` JSON (lines 117–125) lists line fields, add `'discountPercent', sil."discountPercent"`. Every place in that file that multiplies `quantity` by `unitPrice` gets the factor. Grep the copied text for `unitPrice` and justify each occurrence left unchanged in the run log.
5. AR reports read `salesInvoices."totalAmount"` and need no change.

**Verify:**
```bash
grep -c 'discountPercent' packages/database/supabase/migrations/*_sales-invoice-line-discount.sql
# Expected: >= 5
grep -c "SECURITY_INVOKER=true" packages/database/supabase/migrations/*_sales-invoice-line-discount.sql
# Expected: 2
```

**Out of scope:** `salesInvoice.totalDiscount` (an unused header column); sales order lines (no discount; quote → order already folds it into the price).

---

### Task 4: Authz rules, apply, generated RLS migration, types, DB gates

**Depends on:** 3
**Files:**
- Modify: `packages/database/src/authz/manifest.ts` — add rules after the `rentalAgreement*` block (around lines 1254–1258)
- Create: the generated RLS migration (via `pnpm --filter @carbon/database authz migration contracts-rls`)
- Generated: `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`, `packages/server-functions/src/lib/types.ts` if it exists, `packages/jobs/manifests/schema.json`
- Copy from (precedent): `packages/database/supabase/migrations/20260928014618_rental-revenue-recognition-rls.sql` (shape of the generated file)

**Steps:**
1. Add these rules, in the manifest's sort order:
```ts
customerContract: company("sales", { read: "sales_view" }),
customerContractAmendment: company("sales", { read: "sales_view" }),
customerContractInvoice: company("sales", { read: "sales_view" }),
customerContractInvoiceLine: company("sales", { read: "sales_view" }),
customerContractLine: company("sales", { read: "sales_view" }),
```
2. `pnpm db:migrate`. This applies both migrations, syncs authz locally and regenerates types. If the local database is unreachable, STOP and ask the user to start it. Never rebuild the database.
3. `pnpm --filter @carbon/database authz migration contracts-rls`. Never hand-edit the file it writes.
4. `pnpm run generate:types` if step 2 did not regenerate.
5. `pnpm db:check:datasets` and `pnpm db:check:backups`.

**Verify:**
```bash
grep -c '"Post and Send via Stripe"' packages/database/src/types.ts
# Expected: >= 2
grep -n 'customerContracts: {' packages/database/src/types.ts | head -2
# Expected: the view is present
grep -c "customerContractInvoiceLineId" packages/database/src/types.ts
# Expected: >= 3
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all pass
pnpm --filter @carbon/database authz check
# Expected: exit 0 (no drift)
pnpm db:check:datasets && pnpm db:check:backups
# Expected: both exit 0
# In your SQL client against the local database:
#   BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM "customerContracts"; ROLLBACK;
# Expected: 0
```

**Out of scope:** hand-editing `types.ts` or the generated RLS migration.

---

### Task 5: Pure schedule math (`@carbon/database/contract-schedule`) + tests

**Depends on:** 4
**Files:**
- Create: `packages/database/src/contract-schedule.ts`
- Create: `packages/database/src/contract-schedule.test.ts`
- Modify: `packages/database/package.json` — add `"./contract-schedule": "./src/contract-schedule.ts"` to `exports`, next to `./supersession-pick`
- Modify: `packages/utils/src/index.ts` — add `export * from "@carbon/database/contract-schedule";` next to the `@carbon/database/precision` re-export (line 7)
- Copy from (precedent): `packages/database/src/supersession-pick.ts` + `.test.ts` (pure module + vitest); `packages/utils/src/rental-periods.ts` (calendar arithmetic with `@internationalized/date`)

**Steps:**
1. Start the file with the AGPL SPDX header (`pnpm --filter @carbon/checks license-headers`). Import `parseDate`, `CalendarDate`, `endOfMonth`, `startOfWeek` from `@internationalized/date`, and `round`, `equals` from `./precision`. No JS `Date`, no `Math.round`. Dates cross the API as `YYYY-MM-DD` strings.
2. Types (enum types come from `./types` `Database["public"]["Enums"]`):
```ts
export type ContractTerms = {
  startDate: string; endDate: string | null;
  billingFrequency: BillingFrequency; billingAlignment: BillingAlignment; billingTiming: BillingTiming;
  firstInvoiceDate: string | null; billedThrough: string | null;
};
export type ContractLineTerms = {
  id: string; kind: "One-time" | "Recurring"; quantity: number; rate: number;
  rateUnit: RateUnit | null; discountPercent: number; startDate: string; endDate: string | null;
};
export type PlannedRow = {
  lineId: string; periodStart: string; periodEnd: string; units: number; unitPrice: number;
  amount: number; isAdjustment: boolean; invoiceDate: string; status: "Planned" | "Billed Externally";
};
export type PlannedInvoice = { invoiceDate: string; status: "Planned" | "Billed Externally"; rows: PlannedRow[] };
export type ExistingRow = {
  id: string; invoiceId: string | null; invoiceDate: string | null;
  invoiceStatus: "Planned" | "Invoiced" | "Billed Externally" | null; invoiceIsEdited: boolean;
  lineId: string; periodStart: string; periodEnd: string; units: number; unitPrice: number;
  amount: number; isAdjustment: boolean; memoId: string | null;
};
```
3. Functions. Each is exported and has a doc comment stating its rule:
   - `billingGrid(terms, through): { start: string; end: string; dueDate: string }[]`. Periods from `startDate` to `min(endDate, through)`. Month-based frequencies (Month 1, Quarter 3, Year 12 months) under **Anniversary** compute period k as `[start.add({ months: k·m }), start.add({ months: (k+1)·m }) − 1 day]`, always adding from the anchor, never chained, so a 31 Jan anchor gives 28 Feb then 31 Mar. Week is 7-day periods from the anchor. Under **Calendar** the grid anchors on the Monday of the start's week (`startOfWeek(d, "en-GB")`), or the 1st of its month, of its quarter's first month, or 1 Jan. The first period is clipped to start at `startDate`. The last period is clipped at `endDate`. `dueDate` is `start` (Advance) or `end` (Arrears).
   - `periodUnits(periodStart, periodEnd, rateUnit): number`. Day: days inclusive. Week: days ÷ 7. Month / Quarter / Year (decision 9): `n` = the largest integer with `periodStart.add({ months: n }) − 1 day ≤ periodEnd`; `rest` = days from `periodStart.add({ months: n })` to `periodEnd` inclusive; `restBase` = days in `[periodStart.add({ months: n }), periodStart.add({ months: n + 1 }) − 1 day]`; result `(n + rest ÷ restBase) ÷ (1 | 3 | 12)`. Do not round.
   - `rowPricing(line, units): { unitPrice; amount }`. `unitPrice = round(rate × units)`, `amount = round(quantity × unitPrice × (1 − discountPercent))` (decision 10).
   - `nextInvoiceDate(gridDueDates: string[], date: string): string`. The first grid due date ≥ `date`, else `date` itself (decision 8).
   - `planInvoiceSchedule(terms, lines, through): PlannedInvoice[]`. **Recurring:** one row per grid period intersecting `[line.startDate, line.endDate ?? terms.endDate ?? through]`, clipped to that span, priced with `periodUnits` + `rowPricing`. Its `invoiceDate` is `nextInvoiceDate(grid dues, dueDate)`, where `dueDate` is the clipped start (Advance) or clipped end (Arrears). **One-time:** one row, `periodStart = line.startDate`, `periodEnd = line.endDate ?? line.startDate`, `units = 1`, `invoiceDate = nextInvoiceDate(grid dues, line.startDate)`. Then any `invoiceDate` before `firstInvoiceDate` becomes `firstInvoiceDate`. A row with `periodEnd ≤ billedThrough` has status `Billed Externally`. Group rows by `(invoiceDate, status)` into invoices, sorted by date, rows by line input order then `periodStart`.
   - `lineTotals(invoices): Map<lineId, number>` and `validateScheduleEdit(computed: Map<lineId, number>, rows: { lineId; amount; isAdjustment }[]): { ok: boolean; residuals: Map<lineId, number> }`. Residual = computed − Σ non-adjustment amounts. `ok` when every residual `equals` 0 and no row's line is unknown.
   - `invoiceLinePricing(row: { amount; unitPrice }, line: { quantity; discountPercent }): { quantity; unitPrice; discountPercent }`. Returns `{ quantity: line.quantity, unitPrice: row.unitPrice, discountPercent: line.discountPercent }` when `equals(round(line.quantity × row.unitPrice × (1 − line.discountPercent)), row.amount)`, else `{ quantity: 1, unitPrice: row.amount, discountPercent: 0 }`.
   - `reconcileContractSchedule({ terms, lines, existing, from, through }): { deleteInvoiceIds: string[]; deleteRowIds: string[]; recut: { id; periodEnd; units; unitPrice; amount }[]; create: PlannedInvoice[]; adjustments: PlannedRow[] }`. `lines` are all lines after the change. Algorithm, which the doc comment must restate:
     1. `ideal = planInvoiceSchedule(terms, lines, through)`, rows keyed `lineId|periodStart`.
     2. For every existing non-adjustment row whose invoice is `Invoiced`, whose line is Recurring, and whose line now ends before `row.periodEnd`, unless an adjustment row already exists with the same `lineId` and `periodEnd`: add an adjustment `{ periodStart: max(lineEnd + 1, row.periodStart), periodEnd: row.periodEnd, units: −(row.units × daysAfter ÷ daysBilled), unitPrice: row.unitPrice, amount: −round(row.amount × daysAfter ÷ daysBilled), isAdjustment: true }`. For a line now ending before the row starts, `daysAfter = daysBilled`. Its `invoiceDate` is the first planned invoice date ≥ `from` in the result, or `from` if there is none.
     3. Existing `Planned` invoices dated ≥ `from` → `deleteInvoiceIds`.
     4. Existing `Planned` rows on invoices dated < `from`: if `ideal` has the key with a different `periodEnd` or `amount` → `recut`. If `ideal` lacks the key → `deleteRowIds`. A kept invoice left with no rows → `deleteInvoiceIds`.
     5. `create` = ideal rows whose key matches no kept row and no `Invoiced` / `Billed Externally` row, with `invoiceDate = max(row.invoiceDate, from)` re-snapped via `nextInvoiceDate`, grouped into invoices. Adjustments ride with them.
   - `amendmentEffectiveDate(terms, effect, requested, through): string`. `Change Date` returns `requested`. `Next Period` returns the start of the first grid period whose start is > `requested`, or `requested` when it already starts a period.
   - `recurringValuePerPeriod(lines, frequency, on: string): number`. Σ over Recurring lines active on `on` of `quantity × rate × (1 − discount) × perFrequency`, where `perFrequency` = periods per year of the rate unit ÷ periods per year of the frequency (Day 365, Week 52, Month 12, Quarter 4, Year 1).
   - `suggestAmendmentType(before: number, after: number)`. Greater → `"Expansion"`, smaller → `"Contraction"`, equal → `"Existing"`.
   - `suggestContractType(previous: { status: "Draft" | "Active" | "Ended" }[])`. No non-Draft previous → `"New Sales"`. All non-Draft previous `Ended` → `"Reactivation"`. Otherwise → `"New Sales"`.
   - `currentPeriodEnd(terms, today): string`. End of the grid period containing `today`, used as the cancel default.
   - `renewedEndDate(endDate, termMonths): string`. `(endDate + 1 day).add({ months: termMonths }) − 1 day`.
   - `horizon(terms, today): string`. `terms.endDate` when set. Otherwise the end of the grid period after the one containing `today`.
4. Tests, one `it` each. Every number is from the spec's acceptance criteria:
   - Acme: Calendar / Monthly / Advance, contract start 1 Nov 2026, end 31 Oct 2027. Implementation One-time 60,000 1 Nov 2026–30 Apr 2027. Platform 10 × 40 per Month at 0.2 discount. Support 1 × 1,200 per Year. `planInvoiceSchedule` gives invoice 2026-11-01 total 60,420, and 2026-12-01 total 420.
   - `rowPricing` for 10 per Day over 2026-12-01..2026-12-31 gives 310, and over 2027-02-01..2027-02-28 gives 280.
   - Anniversary Monthly starting 2027-03-15: periods start on the 15th, and `periodUnits` of 2027-03-15..2027-04-14 per Month is 1.
   - Anniversary Monthly anchored 2027-01-31: the grid has 2027-02-28 then 2027-03-31 as period starts.
   - Calendar first period 2026-10-15..2026-10-31 per Month gives units 17/31.
   - Split edit: implementation rows 3 × 20,000 on three invoices → `validateScheduleEdit` ok. Rows summing to 50,000 → not ok, residual 10,000.
   - `reconcileContractSchedule`: platform March 2027 `Invoiced` 1–31 Mar at 320 (10 seats). The line now ends 2027-03-11 and a new 15-seat line starts 2027-03-12, from 2027-03-12. Expect an adjustment of −206.45 and a created row of 309.68 for 12–31 Mar, both on invoice 2027-04-01.
   - `amendmentEffectiveDate(…, "Next Period", "2027-03-12")` gives 2027-04-01.
   - Cancellation: September 2027 `Invoiced` at 420, line ends 2027-09-20 → adjustment −140.
   - Re-running `reconcileContractSchedule` with the adjustment present creates no second adjustment.
   - Billed through: Yearly / Advance, start 2026-05-01, `billedThrough` 2027-04-30, one 12,000 per Year line → the first `Planned` invoice is 2027-05-01, and the 2026-05-01 row is `Billed Externally`.
   - `invoiceLinePricing({ amount: 320, unitPrice: 40 }, { quantity: 10, discountPercent: 0.2 })` gives `{10, 40, 0.2}`. `({ amount: 20000, unitPrice: 60000 }, { quantity: 1, discountPercent: 0 })` (a split installment) gives `{1, 20000, 0}`. The 12–31 Mar row of 15 seats: `rowPricing` gives unitPrice `25.80645` and amount `309.68`, and `invoiceLinePricing` keeps `{15, 25.80645, 0.2}`.
   - `suggestContractType([])` gives "New Sales". `([{status:"Ended"}])` gives "Reactivation". `([{status:"Active"}])` gives "New Sales".
   - `suggestAmendmentType(400, 600)` gives "Expansion". `renewedEndDate("2027-10-31", 12)` gives "2028-10-31".

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/contract-schedule.test.ts
# Expected: all passed (≥ 16), 0 failed
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/utils
# Expected: successful
```

**Out of scope:** DB access in this file; revenue math (Task 6).

---

### Task 6: Pure revenue preview + contract invoice holds (`@carbon/utils`) + tests

**Depends on:** 4 (parallel-safe with Task 5)
**Files:**
- Create: `packages/utils/src/contract-revenue.ts`, `packages/utils/src/contract-revenue.test.ts`
- Create: `packages/utils/src/contract-invoice-plan.ts`, `packages/utils/src/contract-invoice-plan.test.ts`
- Modify: `packages/utils/src/index.ts` — re-export both, next to `./rental-invoice-plan`
- Copy from (precedent): `packages/utils/src/rental-invoice-plan.ts` + `.test.ts`; `packages/utils/src/revenue-schedule.ts` (`spreadStraightLine`, `distributeRoundingResidual` usage)

**Steps:**
1. `contract-revenue.ts`:
```ts
export type RevenueLine = {
  id: string; kind: "One-time" | "Recurring"; method: "Daily" | "Even Period";
  revenueStart: string; revenueEnd: string | null; netAmount: number; // what the invoice schedule bills for the span
};
export type RevenueMonth = { lineId: string; periodStart: string; periodEnd: string; amount: number };
/** Revenue dates default: start = goLiveDate ?? revenueStartDate ?? startDate; end = revenueEndDate ?? endDate. */
export function lineRevenueDates(line: { startDate: string; endDate: string | null; goLiveDate: string | null; revenueStartDate: string | null; revenueEndDate: string | null }): { start: string; end: string | null };
/** Daily → spreadStraightLine. Even Period → equal per full calendar month, partial first/last months prorated
 *  by their days ÷ that month's days, residual by distributeRoundingResidual. No end → one row in the start month. */
export function revenuePreview(line: RevenueLine): RevenueMonth[];
/** Per calendar month: invoiced (Σ schedule rows by invoiceDate month), recognized (Σ revenue months),
 *  deferred = cumulative invoiced − cumulative recognized. */
export function contractPositionPreview(invoices: { invoiceDate: string; amount: number }[], revenue: RevenueMonth[]): { month: string; invoiced: number; recognized: number; deferred: number }[];
```
   Pass in amounts already summed. No DB.
2. `contract-invoice-plan.ts`:
```ts
export const CONTRACT_HOLD_ADJUSTMENT = "Includes a credit for a contract change";
export { rentalHoldRebill as recurringHoldRebill } from "./rental-invoice-plan";
/** The hold for one drafted contract invoice. Draft Only → null. Re-bill of a voided invoice
 *  (any row with voidedInvoiceReadableId) wins over a negative adjustment row. */
export function contractInvoiceHold(mode: InvoiceAutomation, rows: { amount: number; isAdjustment: boolean; voidedInvoiceReadableId: string | null }[]): string | null;
```
3. Tests:
   - Implementation 60,000, Even Period, 2026-11-01..2027-04-30 → six months of 10,000.
   - Daily over the same span → the first month is `round(60000 × 30/181)` and the total is exactly 60,000.
   - Even Period 2026-11-15..2027-01-14 at 2,000 → November and January each 16/30 and 14/31 of a month share, and the total is exactly 2,000.
   - One-time with no end → one row in the start month.
   - Acme November position: invoiced 60,420, recognized 10,420 (implementation 10,000 Even Period + platform 320 + support 100), deferred 50,000.
   - `contractInvoiceHold("Draft Only", [negative adjustment])` gives null. `("Post", [a row with voided "INV-7", a negative adjustment])` gives "Re-billing INV-7, which was voided". `("Post and Email", [a negative adjustment])` gives `CONTRACT_HOLD_ADJUSTMENT`. `("Post and Send via Stripe", [positive rows])` gives null.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/contract-revenue.test.ts src/contract-invoice-plan.test.ts
# Expected: all passed, 0 failed
```

**Out of scope:** posting; persisting revenue (Phase B).

---

### Task 7: Contract validators (`sales.models.ts`)

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — add after the rental block (lines 1362–1620); add `"Post and Send via Stripe"` to `invoiceAutomations` (L1382)
- Copy from (precedent): `rentalAgreementValidator`, `rentalAgreementLineValidator`, `rentalAgreementInvoiceAutomationValidator`, `selectedLinesValidator` (L1164) in the same file

**Steps:**
1. Enum arrays that mirror the DB enums: `customerContractStatuses`, `customerContractTypes`, `customerContractLineKinds`, `contractRateUnits`, `contractBillingFrequencies`, `contractBillingAlignments`, `contractBillingTimings`, `contractRenewals`, `contractRevenueMethods`, `contractAmendmentEffects`, `contractInvoiceStatuses`. Type each as `readonly [...] satisfies Database["public"]["Enums"]["<enum>"][]` (copy the rental arrays' typing).
2. `customerContractValidator`: `id?`, `customerContractId?`, `name`, `contractType`, `customerId`, `invoiceCustomerId?`, `invoiceCustomerContactId?`, `invoiceCustomerLocationId?`, `salesPersonId?`, `projectId?`, `customerReference?`, `closeDate`, `startDate`, `duration` (`"6"|"12"|"24"|"36"|"open"|"custom"`), `endDate?` (required when `duration = "custom"`), `renewal`, `renewalUplift` (percent points, ÷ 100 in the service), `billingFrequency`, `billingAlignment`, `billingTiming`, `firstInvoiceDate?`, `billedThrough?`, `recognizeRevenueFrom?`, `invoiceAutomation?` (the shared enum, or `""` for the company default), `paymentTermId?`, `currencyCode`, `exchangeRate?`, `notes?`. Refines: end date ≥ start date − 1; `billedThrough` ≥ start date − 1.
   Export `contractEndDate(startDate, duration, endDate): { endDate: string | null; termMonths: number | null }`. "open" gives `null, null`. "custom" gives `endDate, null`. N months gives `parseDate(start).add({ months: N }).subtract({ days: 1 })` and N.
3. `customerContractLineValidator`: `id?`, `customerContractId`, `kind`, `itemId`, `description?`, `quantity` (> 0), `rate` (≥ 0), `rateUnit?` (required iff Recurring, via refine), `discountPercent` (percent points 0–100), `discountEndsOn?`, `taxPercent` (percent points 0–100), `startDate`, `endDate?`, `goLiveDate?`, `revenueMethod`, `revenueStartDate?`, `revenueEndDate?`, `projectId?`. Refines: end date ≥ start date; `discountEndsOn` within `[startDate, endDate)`.
4. `customerContractScheduleEditValidator`: a `z.discriminatedUnion("intent", …)` of
   - `{ intent: "move", customerContractInvoiceId, invoiceDate }`
   - `{ intent: "split", customerContractInvoiceLineId, installments: JSON string → [{ invoiceDate, amount }] (≥ 2) }`
   - `{ intent: "merge", sourceInvoiceId, targetInvoiceId }`
   - `{ intent: "moveLine", customerContractInvoiceLineId, invoiceDate }`
   - `{ intent: "reset" }`
5. `customerContractAmendmentValidator`: `customerContractId`, `amendmentDate`, `effect`, `contractType`, `reason`, and `changes` (a JSON string → array of `{ op: "change", lineId, quantity?, rate?, rateUnit?, discountPercent?, taxPercent?, description?, revenueMethod?, projectId? } | { op: "add", line: <the line fields> } | { op: "end", lineId }`, ≥ 1).
6. `customerContractCancelValidator`: `customerContractId`, `endDate`, `reason`, `creditUnusedTime` (`zfd.checkbox()`).
7. `createContractFromSalesOrderValidator`: `salesOrderId`, `name`, `startDate`, `duration`, `endDate?`, `billingFrequency`, `billingAlignment`, `billingTiming`, `lines` (a JSON string → `[{ salesOrderLineId, kind, rateUnit? }]`, ≥ 1).
8. `customerContractInvoiceAutomationValidator`: copy `rentalAgreementInvoiceAutomationValidator`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful (validators unused so far is fine)
```

**Out of scope:** the services that use these (Task 8).

---

### Task 8: Contract services (`sales.service.ts`) with Draft guards and MCP tags

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — add after the rental block (around lines 8618–9440)
- Create: `apps/erp/app/modules/sales/ui/Contracts/types.ts`
- Copy from (precedent): `getRentalAgreements`, `getRentalAgreement`, `insertRentalAgreement`, `updateRentalAgreement` (and its private `rentalAgreementTerms` field picker and `rentalRefusal` helper), `deleteRentalAgreement`, `upsertRentalAgreementLine`, `updateRentalAgreementInvoiceAutomation` in the same file; `apps/erp/app/modules/sales/ui/Rentals/types.ts`

**Steps:**
1. Readers: `getContracts(client, companyId, args: GenericQueryFilters & { search: string | null })` from the `customerContracts` view, with `setGenericQueryFilters` and search on `customerContractId` / `name` / `customerName`. Also `getContract(client, id)` (view, `.single()`), `getContractLines(client, customerContractId)` (embed `item(name, readableIdWithRevision, type)`, ordered by `sortOrder`, `startDate`), `getContractLine(client, id)`, `getContractInvoiceSchedule(client, customerContractId)` (`customerContractInvoice` with embedded `customerContractInvoiceLine(*)`, ordered by `invoiceDate`; also the memo-borne rows `customerContractInvoiceLine` where `customerContractInvoiceId IS NULL`), `getContractAmendments(client, customerContractId)` (with the lines that point at each), and `getCustomerContractStatuses(client, companyId, customerId)` (status only, for `suggestContractType`).
2. Writers. Each builds its row from an explicit field picker (`customerContractTerms(…)`, `customerContractLineTerms(…)`), never a spread, and wraps it in `sanitize`. Percent points are divided by 100 here.
   - `insertContract(client, Omit<…> & { customerContractId, companyId, createdBy, customFields? })` sets `endDate` / `termMonths` from `contractEndDate`.
   - `updateContract(client, …)` refuses a non-Draft contract with `contractRefusal("CONTRACT_NOT_DRAFT", "Only a Draft contract can be edited — use Amend")`, then updates with `.eq("status", "Draft")`. One exception: `updateContractType(client, { id, contractType, updatedBy })` is allowed in any status (decision 12).
   - `deleteContract(client, id)` deletes with `.eq("status", "Draft")`. Order-line release happens in `deleteContractReleasingSalesOrderLines` (Task 15); the route uses that.
   - `upsertContractLine(client, …)` refuses when the parent is not Draft, and refuses a non-Service item (`item.type !== "Service"`, error code `CONTRACT_LINE_NOT_SERVICE`).
   - `deleteContractLine(client, id)` refuses when the parent is not Draft.
   - `updateContractInvoiceAutomation(client, …)` allows any status. It refuses `Post and Email` when the invoice contact has no email, as `updateRentalAgreementInvoiceAutomation` does. `Post and Send via Stripe` is accepted here; Confirm and the job check the Stripe link.
3. JSDoc tags, which make these MCP tools: `@mcp read` on the readers; `@mcp create` on `insertContract`; `@mcp update` on `updateContract`, `updateContractType`, `updateContractInvoiceAutomation`; `@mcp upsert` on `upsertContractLine`; `@mcp delete` on `deleteContractLine`. **No tag** on `deleteContract`, because the MCP path would skip releasing sales-order lines (the rental delete has the same documented gap).
4. `ui/Contracts/types.ts`: `Contract = Database["public"]["Views"]["customerContracts"]["Row"]`, and `ContractLine`, `ContractInvoice`, `ContractAmendment` as `NonNullable<Awaited<ReturnType<typeof getX>>["data"]>[number]`. Also `ContractRouteData` (contract, lines, schedule, amendments, `computedSchedule`, `revenue`), copying `RentalAgreementRouteData`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
grep -c "@mcp" apps/erp/app/modules/sales/sales.service.ts
# Expected: the previous count + 11
```

**Out of scope:** Kysely in this file (`no-db-client-in-service`); confirm, amend, cancel (server functions).

---

### Task 9: Server function `post-customer-contract` — confirm, schedule edits, reset

**Depends on:** 5, 6
**Files:**
- Create: `packages/server-functions/src/post-customer-contract/index.ts`
- Create: `packages/server-functions/src/post-customer-contract/schedule-writes.ts` (internal helpers shared by Tasks 9–12)
- Modify: `packages/server-functions/src/invoke.ts` — register `"post-customer-contract"` (alphabetical, after `"post-charge"`)
- Modify: `packages/server-functions/src/__snapshots__/permissions-manifest.test.ts.snap` (via `vitest -u` after reviewing the diff)
- Copy from (precedent): `packages/server-functions/src/post-rental-agreement/index.ts` (L1800 `defineServerFn`, transaction shape) and `packages/server-functions/src/create-rental-invoices/index.ts` (`forUpdate` reads, `inOrder`, `assertCompanyRecords`)

**Steps:**
1. Input, a `z.discriminatedUnion("type", …)`. Every branch has `customerContractId` and `asOf` (`YYYY-MM-DD`, today in the company timezone, computed by the caller):
   - `{ type: "confirm" }`
   - `{ type: "edit-schedule", edit: <Task 7 step 4 union minus "reset"> }`
   - `{ type: "reset-schedule" }`
   - `amend`, `cancel`, `revert-cancellation` (Tasks 10 and 11). Declare them now; the bodies `throw new InvalidInputError("not implemented")` until those tasks.
   `permissions: { update: "sales" }`. The confirm route checks `create: "invoicing"` itself when the effective mode posts (spec decision 29).
2. `schedule-writes.ts` exports:
   - `loadContractForUpdate(trx, companyId, id)`: the header `forUpdate`, all lines, and every schedule row joined to its invoice, as `ExistingRow[]`.
   - `toTerms(contract)` and `toLineTerms(lines)` (DB rows → the pure types).
   - `materializeSchedule(trx, ctx, contract, lines, through)`: inserts `planInvoiceSchedule` output. Each `customerContractInvoice` row carries its status. Lines carry `customerContractId`, `units`, `unitPrice`, `amount`. Multi-row inserts set the same keys on every row.
   - `applyReconciliation(trx, ctx, contractId, result)`: deletes, recuts, then inserts the created invoices and adjustments. Adjustments attach to the created or kept invoice with their `invoiceDate`, inserting one if needed.
   Every statement has `.where("companyId", "=", companyId)`.
3. **confirm**. In one `db.transaction()`:
   1. Lock and load. Refuse if not Draft. Refuse with ≥ 1 line missing, a non-Service item (one query on `item` ids), or a Recurring line without `rateUnit`.
   2. If no schedule rows exist, `materializeSchedule(…, horizon(terms, asOf))`. Otherwise run `validateScheduleEdit(lineTotals(planInvoiceSchedule(…)), rows)` and refuse with the residuals in the message when it fails.
   3. If the effective mode is `Post and Send via Stripe`, refuse when `externalIntegrationMapping` has no row for `entityType = 'customer'`, the billing customer (`invoiceCustomerId ?? customerId`) and integration `'stripe-connect'`. Read the exact column names from `packages/ee/src/accounting/core/external-mapping.ts` `link(...)`. If that table's shape is not what `link` writes, STOP and report.
   4. For each line with `discountEndsOn`, create a `customerContractAmendment` (`amendmentDate` = `discountEndsOn` + 1, effect `Change Date`, reason `"Discount ends"`, type `suggestAmendmentType(...)` from `recurringValuePerPeriod` before/after). End the old line at `discountEndsOn`. Insert a copy starting `discountEndsOn` + 1 with `discountPercent 0`, `discountEndsOn null`, `amendmentId`, `amendsLineId`. Then `applyReconciliation(reconcileContractSchedule({ from: discountEndsOn + 1, … }))`.
   5. Set `status 'Active'`, `confirmedAt`, `confirmedBy`, `updatedBy`, `updatedAt`.
   Return `{ customerContractId }`.
4. **edit-schedule** (Draft only). Lock and load. If no rows exist, materialize first. Then apply the edit:
   - `move`: set `invoiceDate` (merging into an existing Planned invoice on that date, if one exists).
   - `split`: replace the row with one row per installment. Each keeps `periodStart` / `periodEnd` / `unitPrice`, sets `amount` = the installment and `units` = `units × amount ÷ originalAmount`, and goes on the Planned invoice of its `invoiceDate` (created if missing). Refuse unless the installments sum (`equals`) to the original amount, and report the residual: "Installments total {x}; the line must still total {y}".
   - `merge`: move every row from source to target and delete the source.
   - `moveLine`: as `move`, for one row.
   Set `isEdited = true` on every touched invoice. Delete invoices left empty. Only `Planned` invoices may be touched.
5. **reset-schedule** (Draft only): delete all of the contract's schedule rows and invoices. The loader goes back to the live preview.
6. `pnpm --filter @carbon/server-functions exec vitest run src/permissions-manifest.test.ts`, review the new snapshot entry (`post-customer-contract: { update: "sales" }`), then re-run with `-u`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: successful
pnpm --filter @carbon/server-functions test
# Expected: all pass (snapshot updated after review)
pnpm --filter @carbon/checks test
# Expected: pass (server-fn-authorizes-caller, no-unscoped-kysely-write)
```

**Out of scope:** amend, cancel, revert (Tasks 10–11); drafting invoices (Task 12).

---

### Task 10: `post-customer-contract` — amend

**Depends on:** 9
**Files:**
- Modify: `packages/server-functions/src/post-customer-contract/index.ts`

**Steps:**
1. Input: `{ type: "amend", customerContractId, asOf, amendmentDate, effect, contractType, reason, changes, preview?: boolean }`, where `changes` is the Task 7 step 5 array.
2. In one transaction: lock and load, and refuse unless Active.
   1. `effective = amendmentEffectiveDate(terms, effect, amendmentDate, horizon)`.
   2. Build the next line set:
      - `change`: refuse a One-time line whose rows are already `Invoiced`. Otherwise the old line ends at `effective − 1`, and the new line copies every column with the changes applied, `startDate = effective`, `amendmentId`, `amendsLineId`, `salesOrderLineId = null`.
      - `add`: the new line starts at `max(line.startDate, effective)`.
      - `end`: the line ends at `effective − 1`.
   3. Insert the amendment header. Write the lines. `applyReconciliation(reconcileContractSchedule({ from: effective, … }))`.
3. With `preview: true`, run all of step 2 inside the transaction, collect `{ adjustments, nextInvoices: the first two Planned invoices after the change with their rows, suggestedType: suggestAmendmentType(before, after), resetsEditedInvoices: count of deleted invoices with isEdited }`, then throw a private `PreviewRollback` carrying the result. Catch it outside the transaction and return the result. Nothing is committed.
4. Return `{ amendmentId }`, or the preview object.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: successful
pnpm --filter @carbon/server-functions test
# Expected: all pass
```

**Out of scope:** UI (Task 28).

---

### Task 11: `post-customer-contract` — cancel and revert cancellation

**Depends on:** 9
**Files:**
- Modify: `packages/server-functions/src/post-customer-contract/index.ts`
- Copy from (precedent): `createSalesReturnOrderCredit` in `apps/erp/app/modules/sales/sales.service.ts:8038` (the Kysely `insertInto("memo")` at L8186-8203); `getNextSequence` from `@carbon/database/sequence`

**Steps:**
1. **cancel** input: `{ type: "cancel", customerContractId, asOf, endDate, reason, creditUnusedTime, preview?: boolean }`. Resolve the memo sequence BEFORE opening the transaction, and only when `creditUnusedTime && !preview`. In one transaction:
   1. Lock and load. Refuse unless Active. Refuse `endDate` ≥ a set contract `endDate`. Refuse `endDate < startDate` when any row is `Invoiced` ("Invoices exist — cancel on or after {first invoiced period}").
   2. Record `previousState = { contractEndDate, renewal, lineEndDates }` for every line whose end is null or > `endDate`, and set each such line's end to `max(endDate, line.startDate − 1)`.
   3. Update the contract: `endDate`, `renewal = 'End'`, `cancelledAt`, `cancellationReason = reason`.
   4. Insert an amendment (`amendmentDate = endDate + 1`, effect `Change Date`, reason `"Cancellation: " + reason`, type `Contraction`, `previousState`).
   5. `result = reconcileContractSchedule({ from: endDate + 1, … })`.
      - With `creditUnusedTime` false, drop `result.adjustments`.
      - With it true and at least one adjustment, insert the memo: `direction 'Credit'`, `status 'Draft'`, `customerId = invoiceCustomerId ?? customerId`, `memoId` from the `creditMemo` sequence, `memoDate = asOf`, `currencyCode`, `exchangeRate`, `amount = −Σ adjustments`, `reference = customerContractId` (readable), `customerContractId`, audit columns. Read the `memo` columns from `packages/database/src/types.ts` (`memo` Insert) and set every NOT NULL column without a default. Insert the adjustments with `customerContractInvoiceId = null` and `memoId`, not on an invoice.
   6. Apply the rest of `result`. When `endDate < startDate`, also set `status 'Ended'` and `endedAt`.
   With `preview: true`, roll back as Task 10 step 3 and return `{ credit: −Σ adjustments, creditAvailable: adjustments.length > 0, removedInvoices }`.
2. **revert-cancellation** input: `{ type: "revert-cancellation", customerContractId, asOf }`. Refuse unless `cancelledAt` is set, the status is Active, and `asOf ≤ endDate`. Refuse if the cancellation's memo is not Draft ("The credit memo has been posted"). In one transaction:
   1. Restore the line end dates, `endDate` and `renewal` from the latest amendment whose reason starts with `"Cancellation"`.
   2. Clear `cancelledAt` / `cancellationReason`.
   3. Delete the memo-borne rows and the Draft memo, then the amendment.
   4. `applyReconciliation(reconcileContractSchedule({ from: cancelledEndDate + 1, … }))`.
3. Write the cancellation's `previousState` JSON with `toJson()` (lesson: "A JSON column through Kysely only survives as an object").

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: successful
pnpm --filter @carbon/server-functions test
# Expected: all pass
```

**Out of scope:** posting the memo (Task 14); UI (Task 29).

---

### Task 12: Server function `create-contract-invoices`

**Depends on:** 5, 6, 9, 13b
**Files:**
- Create: `packages/server-functions/src/create-contract-invoices/index.ts`
- Modify: `packages/server-functions/src/invoke.ts` — register `"create-contract-invoices"` (before `"create-rental-invoices"`)
- Modify: the permissions snapshot (review, then `-u`)
- Copy from (precedent): `packages/server-functions/src/create-rental-invoices/index.ts`. Copy all of it: `createRentalInvoicesForDuePeriods` (L74-153), `draftAgreementInvoices` (L169-360), `insertRentalInvoice` (L367-483) and the `defineServerFn` block (L623-645).

**Steps:**
1. `defineServerFn({ name: "create-contract-invoices", input: { asOf, customerContractId? }, permissions: { update: "sales", create: "invoicing" } })`. It returns `{ invoices: DraftedContractInvoice[]; invoiceIds: string[]; failures: { customerContractId; error }[] }`, where `DraftedContractInvoice = { invoiceId; customerContractId; mode: InvoiceAutomation; holdReason: string | null }`.
2. Select Active contracts for the company (or the one id) that have any of: a `Planned` invoice with `invoiceDate ≤ asOf`; `renewal = 'Renew'` with `endDate ≤ asOf`; `endDate < asOf`; `endDate IS NULL` (horizon roll). Process each in its own `db.transaction()`. A throw goes into `failures` and does not stop the loop.
3. Per contract, in order:
   1. Lock and load (`loadContractForUpdate`).
   2. **Renew** while `renewal = 'Renew' && termMonths && endDate ≤ asOf`: `newEnd = renewedEndDate(endDate, termMonths)`. Insert an amendment (`amendmentDate = endDate + 1`, effect `Next Period`, reason `"Renewal"`, type `Existing`). For every Recurring line whose end is null or equals the old contract end: when `renewalUplift > 0`, end it at the old end and insert a copy from `endDate + 1` with `rate = round(rate × (1 + renewalUplift))`, `endDate null`, `amendmentId`, `amendsLineId`. When the uplift is 0, keep it (a null end follows the contract). Set the contract's `endDate = newEnd`. Reconcile `from: old endDate + 1`. Loop so that a contract several terms behind catches up.
   3. **Roll the horizon** for open-ended contracts: `applyReconciliation(reconcileContractSchedule({ from: the day after the last persisted row's periodEnd, through: horizon(terms, asOf) }))`. It creates only.
   4. **Draft** every `Planned` invoice with `invoiceDate ≤ asOf`, one `salesInvoice` each. Mode = `effectiveInvoiceAutomation(contract.invoiceAutomation, companySettings.invoiceAutomation)`. Read the readable ids of `voidedSalesInvoiceId` in one query. Hold = `contractInvoiceHold(mode, rows)`.
      - `getNextSequence(trx, "salesInvoice", companyId)` and the opportunity insert, copied from `insertRentalInvoice`.
      - The `salesInvoice` insert copies the rental column list, with these changes: `customerId`; `invoiceCustomerId = contract.invoiceCustomerId ?? customerId`; `invoiceCustomerContactId`; `invoiceCustomerLocationId`; `locationId` = the company's default location (read the same way `insertRentalInvoice`'s caller resolves a location; if contracts have no location source, use `companySettings` / the first `location` of the company, and STOP and report if neither exists); `customerReference`; `customerContractId`; `automationHoldReason`.
      - Totals, computed as the rental code does but from each line's net merchandise `round(quantity × unitPrice × (1 − discountPercent))` and `taxPercent`: `subtotal`, `totalTax`, `totalAmount`.
      - `salesInvoiceShipment` as in rentals.
      - One `salesInvoiceLine` per row:
        - `invoiceLineType 'Service'`, `itemId`
        - `description` = `line.description ?? item.name`, plus `" · " + periodStart + "–" + periodEnd` formatted with `formatDate` (`@carbon/utils`, `dateStyle: "medium"`). When `invoiceLinePricing` fell back (discount 0 on a discounted line), also append `" · " + formatPercent(line.discountPercent) + " off"`
        - `{ quantity, unitPrice, discountPercent } = invoiceLinePricing(row, line)` (decision 10)
        - `taxPercent`
        - `serviceStartDate` / `serviceEndDate` = the row's period for Recurring lines. For One-time lines, use `lineRevenueDates(line)`, or both null when there is no end (point in time).
        - `customerContractId`, `customerContractLineId`, `customerContractInvoiceLineId`
        - `projectId = line.projectId ?? contract.projectId`
        - `methodType`, `unitOfMeasureCode` (the item's, else `"EA"`), `exchangeRate`, `locationId`, `sortOrder`
        Before writing, read how `convert`'s `salesOrderToSalesInvoice` branch fills `methodType` for a Service line and copy that.
      - Stamp the `customerContractInvoice` with `status 'Invoiced'` and `salesInvoiceId`. Stamp each `customerContractInvoiceLine` with `salesInvoiceLineId`, joined on `sil.customerContractInvoiceLineId` exactly like the rental stamp (L453-466).
   5. **End** the contract when `endDate < asOf` and no `Planned` invoice remains: `status 'Ended'`, `endedAt`.
4. Idempotency: re-running on the same day drafts nothing, because the stamps plus `forUpdate` exclude them.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: successful
pnpm --filter @carbon/server-functions test
# Expected: all pass
```

**Out of scope:** posting and emailing (Task 17); rental files.

---

### Task 13: `post-sales-invoice` — VOID releases contract rows; Project dimension

**Depends on:** 4
**Files:**
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts`
- Modify: `packages/database/src/sales-posting-amounts.ts` — `SalesPostingMetadata` (L34) gains `projectId: string | null`
- Copy from (precedent): the rental VOID block (`index.ts` L2321-2355); the Project dimension in `packages/server-functions/src/post-purchase-invoice/index.ts` (L675 query, L2034 metadata, L2287-2291 insert)

**Steps:**
1. VOID: inside the existing void transaction (L2307), after the rental block, for this invoice's line ids:
   - set `customerContractInvoiceLine.salesInvoiceLineId = null, voidedSalesInvoiceId = invoiceId, updatedBy, updatedAt`, matched on `salesInvoiceLineId IN (lineIds)`;
   - then set `customerContractInvoice.status = 'Planned', salesInvoiceId = null`, matched on `salesInvoiceId = invoiceId`.
   Both statements are scoped by `companyId`. The existing Service-deferral refusal (a Posted deferral row blocks the void, L2228-2240) still applies first.
2. Project dimension:
   - add `"Project"` to the dimension-type query (L326-345), mirroring the purchase-invoice query;
   - carry `invoiceLine.projectId` into `SalesPostingMetadata.projectId` for every line type;
   - where `journalLineDimension` rows are written (L1680-1765), add a Project dimension row on the line's revenue-side journal lines only (Sales, Deferred Revenue, and in the Rental branch Rental Income / Contract Assets), never on AR or tax, when `projectId` is set and a `Project` dimension exists.
   Copy how the purchase invoice decides which journal lines get its project. If the sales journal lines have no "revenue side" marker to key on, STOP and report.
3. Add a unit test only if the existing `post-sales-invoice` tests build `SalesPostingMetadata`. Otherwise this is verified in the browser (Task 35).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --filter=@carbon/database --concurrency=1
# Expected: successful
pnpm --filter @carbon/server-functions test
# Expected: all pass, rental-posting.test.ts unchanged
```

**Out of scope:** the Phase B contract posting branch; the recognition run's journal dimensions.

---

### Task 13b: Line discount — posting amounts

**Depends on:** 4
**Files:**
- Modify: `packages/database/src/sales-posting-amounts.ts` — `SalesPostingAmountsInput` (:9-17), merchandise (:136-138), `allocateSalesHeaderShipping` weights (:182-189), `calculateSalesIntercompanyAmount` (:219-227)
- Modify: `packages/utils/src/sales-posting-amounts.test.ts`
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts:1088` — `shipmentLine.unitPrice` becomes the net unit price

**Steps:**
1. Add `discountPercent?: number | null` to the input. `merchandise = quantity × unitPrice × (1 − (discountPercent ?? 0))`. `salesRevenueBase`, `salesTaxBase` and `grossReceivableBase` follow from it. Shipping weights and the intercompany amount use the same net merchandise.
2. Intercompany: the buyer-side purchase invoice must match the net amount exactly. Read how `calculateSalesIntercompanyAmount`'s result is compared (`post-sales-invoice/index.ts:1909` and the matching purchase side). If the purchase side recomputes from its own lines with no discount, STOP and report.
3. `post-sales-invoice` reads `salesInvoiceLine` rows with every column (L107) and spreads them into the posting input (L979), so `discountPercent` flows through. Confirm that by reading those lines. If the select lists columns explicitly, add `discountPercent`.
4. Tests: a line of quantity 10 at 40, 20% off, 10% tax → merchandise 320, tax 32, revenue base 320. An existing test with no discount is unchanged. Shipping allocation across a discounted line and an undiscounted line weights by net.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/sales-posting-amounts.test.ts
# Expected: all passed
pnpm --filter @carbon/server-functions test
# Expected: all pass, rental-posting.test.ts unchanged
```

**Out of scope:** COGS (cost-based, never reads prices).

---

### Task 13c: Line discount — documents (PDF, email)

**Depends on:** 4
**Files:**
- Modify: `packages/documents/src/utils/sales-invoice.ts` — `getLineSubtotal` (:38-47), `getLineTaxableSubtotal` (:49-57)
- Modify: `packages/documents/src/pdf/blocks/SummaryBlock.tsx` (:47-50 inline subtotal, :127, :141)
- Modify: `packages/documents/src/pdf/blocks/LineItemsBlock.tsx` (:179 unit price, :184 line total)
- Modify: `packages/documents/src/email/SalesInvoiceEmail.tsx` (:268, :275, :296)
- Modify: `packages/documents/src/pdf/samples.ts` (:53, :67) and `packages/documents/src/utils/document-totals.test.ts`

**Steps:**
1. Line subtotal = `quantity × convertedUnitPrice × (1 − discountPercent)` (documents render in the invoice currency). `getLineTaxesAndFees`, `getLineTotal` and `getTotal` follow.
2. SummaryBlock's inline subtotal uses the same helper, not its own multiplication. Add a "Discount" row (−Σ quantity × convertedUnitPrice × discountPercent) above Subtotal only when it is non-zero, so undiscounted invoices render exactly as before.
3. LineItemsBlock and the email: keep the list unit price, and when `discountPercent > 0` show "−20%" under it (`formatPercent`). The line total is net.
4. Give one sample line `discountPercent: 0.2`. Add a totals test: a 10 × 40 line at 20% off with 10% tax totals 352.

**Verify:**
```bash
pnpm --filter @carbon/documents test
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/documents
# Expected: successful
```

**Out of scope:** quote, order and purchase documents.

---

### Task 13d: Line discount — ERP invoice UI and rental utilization

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` (~:323, the sales invoice line validator) — `discountPercent` (percent points 0–100; the route divides by 100, as quote pricing does)
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm.tsx` (:187 amount, :354-376 tax pair seed, a discount input after the unit price :820)
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceSummary.tsx` (:88-108 per-line math, :209/:264/:268/:298/:302 display, :387-439 totals)
- Modify: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.$lineId.details.tsx` (:238), `$invoiceId.new.tsx` (:185), `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceExplorer.tsx` (:85) — default 0
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts:7425-7484` (`getRentalUtilization`) — select and apply `discountPercent`
- Copy from (precedent): the discount input in `apps/erp/app/modules/sales/ui/Quotes/QuoteLinePricing.tsx:1227-1238`

**Steps:**
1. Validator: `discountPercent: zfd.numeric(z.number().min(0).max(100).optional())`. Convert it to a fraction in the action before `upsertSalesInvoiceLine` (the service passes fields through `sanitize`). Initial values multiply by 100.
2. Line form: a Discount % input (`INPUT_FORMAT` percent-points kind, as the quote uses). Amount = `quantity × unitPrice × (1 − discount)`. Pass the NET unit price into `taxableBase` / `useTaxPair` rather than changing the shared helper.
3. Summary: every `unitPrice × quantity` becomes net. Show the discount beside the unit price when non-zero. Lines 92–99 appear to omit `nonTaxableAddOnCost` unlike the view; leave that unchanged and note it in the run log as a separate finding.
4. Rental utilization: apply the factor to its revenue-base mirror.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
cd apps/erp && pnpm exec vitest run app/modules/invoicing
# Expected: all pass
```

**Out of scope:** sales order and quote screens.

---

### Task 13e: Line discount — Stripe and accounting providers

**Depends on:** 4, 16
**Files:**
- Modify: `packages/stripe/src/send-sales-invoice.server.ts` (`toStripeInvoiceLines`, moved there by Task 16)
- Modify: `packages/stripe/src/connect.server.ts` — `ConnectInvoiceLineInput` doc (:542-580), `expectedConnectInvoiceTotal` (:623-640)
- Modify: `packages/ee/src/accounting/core/sales-invoice-source.ts` (:91 select, :265-285 `lineAmount`)
- Modify: `packages/ee/src/accounting/core/models.ts` (:1226-1278 line schema)
- Modify: `packages/ee/src/accounting/core/sales-document-components.ts` (:166 posting input, :219-234 `unitAmount`, :259 `baseNet`, :184-198 reconciliation)
- Modify: `packages/ee/src/accounting/core/sales-document-components.test.ts` and `packages/ee/src/accounting/providers/{xero,quickbooks-online,rillet}/entities/__tests__/invoice.test.ts`

**Steps:**
1. Stripe: send the NET unit price (`unitPrice × (1 − discountPercent)`, rounded to internal scale), and append "(20% off)" to the description when discounted. `expectedConnectInvoiceTotal` uses the same net price, so the drift check against Stripe's draft total still holds. Stripe coupons are not used.
2. Accounting source and builder: select `discountPercent`, pass it to `calculateSalesPostingAmounts`, and use the net unit price for `unitAmount` (keeping its sanity check against `unitPrice × rate`, net on both sides) and `baseNet`. The reconciliation against the view's subtotal and tax must still pass, because the view (Task 3b) and the builder now agree.
3. Providers: Xero and Rillet send net line amounts and follow automatically. QuickBooks Online sends `UnitPrice: unitAmount` with `Amount` and `Qty`, which now agree because `unitAmount` is net. Do not use provider-native line discount fields.
4. Tests: one discounted line per provider test: the amount is net, and QBO has `Qty × UnitPrice = Amount`. The builder test covers a discounted line reconciling.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/accounting
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/stripe --concurrency=1
# Expected: successful
```

**Out of scope:** reading back remote discounts (sync mirrors remote values as today).

---

### Task 14: `post-memo` — contract credit memo releases deferral

**Depends on:** 4
**Files:**
- Modify: `packages/server-functions/src/post-memo/post-memo-transaction.ts` (reason account L276-317, journal lines around L416, memo stamp L485)
- Modify: `packages/server-functions/src/post-memo/index.ts` — refuse `void` for a contract memo
- Create: `packages/utils/src/deferral-release.ts` + `.test.ts` (pure); re-export from `packages/utils/src/index.ts`
- Modify: `packages/server-functions/src/post-memo/post-memo-transaction.test.ts`

**Steps:**
1. Pure function in utils: `releaseDeferral(rows: { id; periodStart; amount; status: "Planned" | "Posted" }[], amount): { deleteIds: string[]; reduce: { id; amount }[]; fromRevenue: number }`. Walk the `Planned` rows from the latest `periodStart` backwards. Delete whole rows while `row.amount ≤ remaining`, then reduce the next one by what remains. Any amount left after the Planned rows run out is `fromRevenue`. Tests: 3 Planned rows (100, 100, 100) releasing 150 → delete the last row, reduce the middle to 50, `fromRevenue` 0. Releasing 350 with one row Posted → delete both Planned rows, `fromRevenue` 150.
2. In the posting transaction, when `memo.customerContractId` is set, the memo is an AR Credit, and `accountingEnabled`:
   1. Load the memo-borne rows (`customerContractInvoiceLine.memoId = memo.id`).
   2. For each, find the `Invoiced` non-adjustment row with the same `customerContractLineId` and `periodEnd`. Its `salesInvoiceLineId` identifies the `revenueRecognitionSchedule` rows (`type 'Deferral'`).
   3. Run `releaseDeferral(thoseRows, |adjustment.amount| in base)`, converting with `toBaseAmount` at the memo's `exchangeRate`.
   4. Delete and reduce those rows in the transaction.
   5. Build the journal with the offset split into two debit lines: `deferredRevenueAccount` for the released amount and `salesAccount` for `fromRevenue`.
   Read how the existing reason line is built and extend it to N lines. If the journal builder only supports a single reason line, STOP and report — do not restructure `buildMemoJournal` without approval.
   Otherwise (no contract, or accounting off) the memo behaves as today.
3. `index.ts`: for `type: "void"`, throw `ServerFnError("A contract cancellation credit cannot be voided", 400)` when `memo.customerContractId` is set.
4. Test: a contract memo of 140 against a Planned deferral row of 420 for September → the row becomes 280, the journal debits Deferred Revenue 140, credits AR 140, and balances.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/deferral-release.test.ts
# Expected: all passed
pnpm --filter @carbon/server-functions exec vitest run src/post-memo
# Expected: all passed, existing memo tests unchanged
```

**Out of scope:** Phase B's contract-assets branch; memos without `customerContractId`.

---

### Task 15: `sales.server.ts` — release stamps on delete, create from sales order, wrappers

**Depends on:** 8, 12
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.server.ts` (`releaseRentalInvoiceStamps` L413, `deleteSalesInvoiceReleasingRentals` L452/460, `deleteSalesInvoiceLineReleasingRentals` ~L496, `generateRentalInvoicesNow` L385)
- Copy from (precedent): those functions

**Steps:**
1. Rename `releaseRentalInvoiceStamps` to `releaseRecurringInvoiceStamps`. Keep the rental statements and add, for the same `salesInvoiceLineIds`:
   - `customerContractInvoiceLine` gets `salesInvoiceLineId = null`;
   - the parent `customerContractInvoice` rows (those whose `salesInvoiceId` is the deleted invoice) get `status 'Planned'` and `salesInvoiceId = null`.
   `voidedSalesInvoiceId` stays, so the hold is sticky (rental decision 8).
   Both delete functions also pick lines with `customerContractInvoiceLineId IS NOT NULL`, not only Rental lines. Deleting a single contract line from a Draft invoice releases that row but leaves its `customerContractInvoice` `Invoiced` while the invoice still has other contract lines. Re-open the planned invoice only when no stamped row remains on it.
2. `generateContractInvoicesNow(db, { companyId, userId, customerContractId, asOf })` calls `serverFns.system({ db, companyId, userId }).invokeOrThrow("create-contract-invoices", { asOf, customerContractId })`. Copy `generateRentalInvoicesNow`.
3. `runContractAction(caller, input)` is a thin wrapper over `serverFns.as(caller).invoke("post-customer-contract", input)` for the routes.
4. `createContractFromSalesOrder(db, { companyId, userId, input })` (Kysely, one transaction; resolve the `customerContract` sequence before it):
   1. Lock the order and its chosen lines (`forUpdate`). Refuse a line that is not `Service`, is already `invoicedComplete`, or has `quantityInvoiced > 0`.
   2. Insert the contract. Copy `customerId`, `paymentTermId`, `currencyCode`, `exchangeRate`, `customerReference`, `salesPersonId`, `invoiceCustomerContactId` / `invoiceCustomerLocationId` from the order. Read the order's real column names in `types.ts`; skip any the order does not have. Set `salesOrderId`, `contractType = suggestContractType(...)`, `closeDate = asOf`.
   3. Insert one contract line per order line: `itemId`, `description`, `quantity = saleQuantity`, `rate = unitPrice`, `taxPercent`, `kind`, `rateUnit`, `startDate` = the contract start, `salesOrderLineId`.
   4. Set those order lines to `invoicedComplete = true` (decision 7).
   5. If every line of the order is now `invoicedComplete`, recompute the order's status with the rule in `post-sales-invoice` (around L1520–1580: all invoiced and shipped → `Completed`, all invoiced → `To Ship`). Copy the rule, don't import it.
   Return the new contract id.
5. `deleteContractReleasingSalesOrderLines(db, { companyId, id })`. Draft only. In one transaction: set `invoicedComplete = false` on the order lines its lines reference, where `quantityInvoiced < saleQuantity`, then delete the contract. Do the same for a single line: `deleteContractLineReleasingSalesOrderLine`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
grep -n "releaseRentalInvoiceStamps" -r apps/erp/app | wc -l
# Expected: 0
```

**Out of scope:** `convert` (decision 7); MCP delete tools (documented gap, unchanged).

---

### Task 16: `@carbon/stripe` — shared send of a posted invoice; the post route uses it

**Depends on:** 4
**Files:**
- Create: `packages/stripe/src/send-sales-invoice.server.ts`
- Modify: `packages/stripe/package.json` — export `"./send-sales-invoice.server": "./src/send-sales-invoice.server.ts"`
- Modify: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.post.tsx` — delete the moved helpers (`storeStripeInvoicePdf` L66, `appendStripeLinkToNotes` L134, `toStripeInvoiceLines` L223, `toStripeEpochSeconds` L254, `clampDueDate` L268, `clampEffectiveAt` L276) and the send block (around L990–1080); call the new function
- Modify: `apps/erp/app/modules/invoicing/stripe-customer.server.ts` — `getStripeConnectAccountId` (L139) and `STRIPE_CONNECT_INTEGRATION` become re-exports from the new module

**Steps:**
1. Move the six helpers verbatim. Add, from `stripe-customer.server.ts`, `STRIPE_CONNECT_INTEGRATION` and `getStripeConnectAccountId`. Add `getLinkedStripeCustomerId(serviceRole, companyId, customerId): Promise<string | null>`, a read of `externalIntegrationMapping` for `customer` / `STRIPE_CONNECT_INTEGRATION`, using the columns `createMappingService.link` writes.
2. Export:
```ts
export async function sendPostedSalesInvoiceViaStripe(args: {
  serviceRole: SupabaseClient<Database>; companyId: string; userId: string; invoiceId: string;
  stripeAccountId: string; stripeCustomerId: string; dueDateOverride?: string | null;
  linkStripeInvoice: (stripeInvoiceId: string, metadata: { hostedInvoiceUrl: string | null; invoicePdf: string | null }) => Promise<void>;
}): Promise<{ stripeInvoiceId: string; hostedInvoiceUrl: string | null; invoicePdf: string | null }>
```
   The body is the route's send block. Replace its ERP service reads (`getSalesInvoiceLines`, `getSalesInvoiceShipment`, `getSalesInvoiceCustomerDetails`, `getCompanyTimeZone`) with direct `serviceRole` reads of the same views or tables (`salesInvoiceLines`, `salesInvoiceShipment`, the customer-details view or RPC the ERP service uses, and `getCompanyTimeZone` from `@carbon/lib` if exported there, else read it the way the ERP helper does). Then call `createAndSendConnectInvoice`, `linkStripeInvoice`, `storeStripeInvoicePdf` and `appendStripeLinkToNotes`. It throws on failure.
3. The route keeps `preflightStripeSend` and its own error handling. It calls `sendPostedSalesInvoiceViaStripe` with `linkStripeInvoice = (id, metadata) => createMappingService(getDatabaseClient(), companyId).link("salesInvoice", invoiceId, STRIPE_CONNECT_INTEGRATION, id, { metadata })`. Behaviour must be identical.
4. The new module must not import `@carbon/ee` or any `~/` path.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/stripe --filter=erp --concurrency=1
# Expected: successful
grep -n "function toStripeInvoiceLines\|function storeStripeInvoicePdf" "apps/erp/app/routes/x+/sales-invoice+/\$invoiceId.post.tsx"
# Expected: no output
grep -n "@carbon/ee" packages/stripe/src/send-sales-invoice.server.ts
# Expected: no output
```

**Out of scope:** the post modal and preflight; changing what is sent to Stripe.

---

### Task 17: Automation — contract source, Stripe mode

**Depends on:** 12, 16
**Files:**
- Modify: `packages/jobs/src/invoicing/automate-invoice.ts` — `resolveInvoiceAutomation` (L65-89), `getInvoiceOwnerEmail` (L305-333), new `sendPostedInvoiceViaStripe`
- Modify: `packages/jobs/src/invoicing/automate-invoice.test.ts`
- Modify: `packages/jobs/src/inngest/functions/tasks/invoice-automate.ts` — the Stripe branch
- Modify: `packages/lib/src/events.ts:769` — `mode?` adds `"Post and Send via Stripe"`

**Steps:**
1. `resolveInvoiceAutomation`: read `salesInvoice.customerContractId` first. When set, return the `customerContracts` view's `effectiveInvoiceAutomation`. Otherwise use the current rental path, unchanged.
2. `getInvoiceOwnerEmail`: when `salesInvoice.customerContractId` is set, the owner is `customerContract.salesPersonId ?? createdBy`. Otherwise use the rental path.
3. Export `INVOICE_SEND_NO_STRIPE = "No Stripe customer is linked"` and `INVOICE_SEND_STRIPE_NOT_CONNECTED = "Stripe is not connected"`.
   `sendPostedInvoiceViaStripe({ client, companyId, invoiceId }): Promise<EmailOutcome>`:
   1. Skip when `sentAt` is set or the invoice is not posted (`isPostedSalesInvoice`).
   2. `getStripeConnectAccountId`; null → `stampSendError(INVOICE_SEND_STRIPE_NOT_CONNECTED)`.
   3. Billing customer = `invoiceCustomerId ?? customerId`; `getLinkedStripeCustomerId`; null → `stampSendError(INVOICE_SEND_NO_STRIPE)`.
   4. `sendPostedSalesInvoiceViaStripe` with `linkStripeInvoice` built from `createMappingService` (`@carbon/ee/accounting`, which jobs already depends on).
   5. Success → stamp `{ sentAt: datetime.timestamp(), sentTo: "Stripe", sendError: null }`. A throw → `stampSendError(message)`.
4. `invoice-automate.ts`: after `post`, when the mode is `Post and Send via Stripe`, run step `stripe` → `sendPostedInvoiceViaStripe`. The email branch is unchanged.
5. Tests, extending the existing mocks: a contract invoice resolves the contract's mode; a Stripe send with no link stamps `INVOICE_SEND_NO_STRIPE`; a successful send stamps `sentTo "Stripe"`.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/invoicing
# Expected: all passed
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/lib --concurrency=1
# Expected: successful
```

**Out of scope:** the email path; the digest builder (unchanged, it is already source-agnostic).

---

### Task 18: `recurring-billing` — the contract source

**Depends on:** 17
**Files:**
- Modify: `packages/jobs/src/inngest/functions/scheduled/recurring-billing.ts` (find-companies L45-52, the per-company step, the invoice loop L126-181, digest recipients L192-197)

**Steps:**
1. `find-companies`: the DISTINCT union of companies with an Active `rentalAgreement` and companies with an Active `customerContract`.
2. Per company, after the existing `rental-billing-${company.id}` step, add `contract-billing-${company.id}`. It invokes `create-contract-invoices` with the same `asOf` and the same try/catch isolation, and returns `{ invoices, failures }`. Map contract invoices to the loop's shape with `sourceId: customerContractId`. Concatenate both lists before the posting loop.
3. In the loop, a `Post and Send via Stripe` invoice posts like the others, then runs step `stripe-${invoiceId}` (`sendPostedInvoiceViaStripe`). The outcome is `"emailed"` when sent and `"unsent"` with an error, so the digest counts it as sent.
4. Digest recipients: owners also include `customerContract` ids → `salesPersonId ?? createdBy` (filtered to `userToCompany`, as rentals are).
5. One company's contract step throwing must not stop the others. Copy the existing try/catch per step.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --concurrency=1
# Expected: successful
pnpm --filter @carbon/jobs test
# Expected: all pass
```

**Out of scope:** renaming the step ids of the rental source.

---

### Task 19: Settings and rental override offer *Post and Send via Stripe*

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `invoiceAutomations` (L37)
- Modify: `apps/erp/app/routes/x+/settings+/invoicing.tsx` — the mode select's options and helper copy
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementProperties.tsx` (~L387) — option label
- Copy from (precedent): the existing options in those files

**Steps:**
1. Add `"Post and Send via Stripe"` to the settings array. The sales array was done in Task 7.
2. Label it "Post and send via Stripe". Helper copy: "Posts the invoice and sends it through your connected Stripe account with a payment link. Customers without a linked Stripe customer are held."
3. When Stripe Connect is not connected (`getStripeConnectAccountId` in the settings loader returns null), disable the option with the tooltip "Connect Stripe in Integrations first".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** the rental agreement's Invoice Now (unchanged; `invoice-automate` handles the new mode).

---

### Task 20: Paths, navigation, status colors, route types

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — next to the rental entries (L891–896, L1722–1726, L2103–2124)
- Modify: `apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx` (L60–65)
- Modify: `packages/utils/src/status-colors.ts` (L177, L408)

**Steps:**
1. Paths:
   - `contracts: \`${x}/sales/contracts\``
   - `newContract: \`${x}/contract/new\``
   - `contract(id)`, `contractDetails(id)`, `contractSchedule(id)`, `contractConfirm(id)`, `contractAmend(id)`, `contractCancel(id)`, `contractRevertCancellation(id)`, `contractInvoice(id)`, `contractUpdate: \`${x}/contract/update\``
   - `deleteContract(id)`, `newContractLine(id)`, `contractLine(id, lineId)`, `deleteContractLine(id, lineId)`
   - `salesOrderContract(orderId)` → `${x}/sales-order/${orderId}/contract`
   Each id helper uses `generatePath`, as the rental helpers do.
2. Nav: `{ name: t\`Contracts\`, to: path.to.contracts, icon: <LuFileSignature />, table: "customerContract" }` before Rentals. If `LuFileSignature` is not exported by the installed `react-icons/lu`, use `LuFileText`.
3. `CUSTOMER_CONTRACT_STATUS_COLOR_MAP`: Draft gray, Active green, Ended muted. Copy `RENTAL_AGREEMENT_STATUS_COLOR_MAP`'s value shape and register its key at L408.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/utils
# Expected: successful
```

**Out of scope:** routes (Tasks 21–30).

---

### Task 21: Contracts list

**Depends on:** 8, 20
**Files:**
- Create: `apps/erp/app/routes/x+/sales+/contracts.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractsTable.tsx`, `ContractStatus.tsx`, `index.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/sales+/rental-agreements.tsx`, `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementsTable.tsx`, `RentalStatus.tsx`, `ui/Rentals/index.ts`

**Steps:**
1. The route copies the rental list: `requirePermissions(request, { view: "sales" })`, `getGenericQueryFilters`, `getContracts`, render `<ContractsTable data count />` + `<Outlet />`, and a `handle` breadcrumb `msg\`Contracts\``.
2. Columns: ID (`Hyperlink` → `path.to.contract`), Name, Customer (`CustomerAvatar`), Type, Status (`ContractStatus`), Contract value (money; "—" for a Draft with `contractValue = 0`), Invoiced to date, Next invoice (date), Ends on (`endDate`, "Open-ended" when null), plus `useCustomColumns("customerContract")`. The New button goes to `path.to.newContract` (permission `create: "sales"`).
3. Use the `carbon-design` skill's list archetype. Money uses `useCurrencyFormatter` with the row's `currencyCode`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** recognized and deferred columns (Phase B).

---

### Task 22: Contract page shell — new, header, explorer, properties, update, delete

**Depends on:** 21
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/_layout.tsx`, `new.tsx`, `update.tsx`, `$id.tsx`, `$id._index.tsx`, `$id.details.tsx`, `$id.delete.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractForm.tsx`, `ContractHeader.tsx`, `ContractExplorer.tsx`, `ContractProperties.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/rental-agreement+/` (`_layout`, `new`, `update`, `$id`, `$id._index`, `$id.details`, `$id.delete`) and `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementForm.tsx`, `RentalAgreementHeader.tsx`, `RentalAgreementExplorer.tsx`, `RentalAgreementProperties.tsx`

**Steps:**
1. `new.tsx`:
   1. `requirePermissions(request, { create: "sales" })`, validate with `customerContractValidator`.
   2. `getNextSequence(client, "customerContract", companyId)`.
   3. `contractType` from `suggestContractType(await getCustomerContractStatuses(...))` unless the form set it.
   4. `insertContract`, then redirect to `path.to.contractDetails(id)`.
   The form fields follow the spec's Properties list. Duration is a select (6 months / 1 year / 2 years / 3 years / Open-ended / Custom); Custom reveals End date.
2. `$id.tsx` loader (`view: "sales"`):
   1. Load the contract, lines, persisted schedule and amendments with `Promise.all`.
   2. If the contract is a Draft with no persisted rows, `computedSchedule = planInvoiceSchedule(toTerms, toLineTerms, horizon(terms, today))`, where `today = datetime.today(await getCompanyTimeZone(client, companyId)).toString()`. Otherwise use the persisted schedule.
   3. `residuals = validateScheduleEdit(...)` for an edited Draft.
   4. `revenue` = `revenuePreview` per line, with `netAmount` = that line's scheduled total.
   Layout: `<PanelProvider><ContractHeader/><ResizablePanels explorer={<ContractExplorer key={id}/>} content={<VStack><Outlet/></VStack>} properties={<ContractProperties key={id}/>}/></PanelProvider>`. Breadcrumb as rentals, with `module: "sales"`.
3. Header: ID, name, `ContractStatus`, "Ends {date}" when `cancelledAt` is set. Buttons: Confirm (Draft), Invoice Now (Active), Amend (Active), Cancel (Active), Revert cancellation (Active with `cancelledAt` and endDate ≥ today), Delete (Draft). Each links to its route, built in Tasks 27–29. Gate them with `usePermissions().can("update", "sales")`.
4. Explorer: lines grouped One-time / Recurring, each linking to `path.to.contractLine`, with *Add Line* (Draft) → `path.to.newContractLine`. Lines replaced by an amendment show struck through with "until {endDate}".
5. Properties: the spec's Properties list, saved through `update.tsx` intents, copying the rental update route. Draft fields are editable. On an Active contract only `contractType`, `invoiceAutomation` and `notes` are editable (the others are read-only text). Invoicing select: "Company default ({mode})" plus the four modes.
6. `$id.details.tsx` renders the center sections in order: `<ContractSummary/>`, `<ContractInvoices/>`, `<ContractRevenue/>`, `<ContractAmendments/>`. Until Tasks 24–28 build them, render the section headings with an empty state.
7. `$id.delete.tsx`: Draft only. Calls `deleteContractReleasingSalesOrderLines(getDatabaseClient(), …)` and redirects to `path.to.contracts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** the section bodies (Tasks 24–26, 28).

---

### Task 23: Line form and line routes

**Depends on:** 22
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/$id.lines.new.tsx`, `$id.$lineId.details.tsx`, `$id.$lineId.delete.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractLineForm.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/rental-agreement+/$id.lines.new.tsx`, `$id.$lineId.details.tsx`, `$id.$lineId.delete.tsx`; `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementLineForm.tsx`

**Steps:**
1. Fields: Service item (the item picker filtered to `type: "Service"`; find the filter prop by reading how the picker is used for service items elsewhere), Kind (One-time / Recurring), Description (customer-facing), Quantity, Rate (`INPUT_FORMAT.rate`) plus Per (rate unit, Recurring only), Discount % plus Discount ends on, Tax %, Start / End, Go-live, Revenue method plus Revenue start / end (collapsed under "Revenue"), Project (defaults to the contract's project).
2. Actions: `update: "sales"`, `upsertContractLine`. A Draft-guard refusal flashes its message.
3. Delete route: `deleteContractLineReleasingSalesOrderLine(getDatabaseClient(), …)`.
4. An Active contract renders the form read-only with the note "Change lines with Amend".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** multi-select add (follow-up).

---

### Task 24: Summary section

**Depends on:** 22
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractSummary.tsx`
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementSummary.tsx`

**Steps:**
1. One row per line, written as a sentence: "Implementation · one-time · $60,000.00", "Platform access · 10 × $40.00 per month · 20% off until 31 Oct 2027".
2. Totals: contract value (Σ the schedule), recurring per period (`recurringValuePerPeriod(lines, billingFrequency, today)`, labelled "per month / quarter / …"), next invoice (date and total).
3. When the effective mode is not `Draft Only` and the contract is Active, show "Invoices are drafted and {posted / posted and emailed / posted and sent via Stripe} automatically." Copy the rental summary copy at `RentalAgreementSummary.tsx:263-281`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** recognized and deferred figures (Phase B).

---

### Task 25: Invoices section and schedule editing

**Depends on:** 22, 9
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractInvoices.tsx`, `ContractInvoiceSplitModal.tsx`
- Create: `apps/erp/app/routes/x+/contract+/$id.schedule.tsx` (action only)
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Rentals/RentalBillingPeriods.tsx` (table, the Held badge at L152); a `useFetcher` modal form such as `apps/erp/app/modules/sales/ui/SalesReturnOrders/ReturnableLinesModal.tsx`

**Steps:**
1. Table: date, total, lines (expandable: line name, service window, amount, an "Adjustment" badge), status (Planned / Invoiced with a link to the sales invoice / Billed externally), "Edited" badge, and a Held badge when the drafted invoice has `automationHoldReason` (load it with the schedule in Task 22's loader through the stamped `salesInvoiceId`, in one `.in()` query).
2. Draft only, per invoice: *Move date* (date picker), *Merge into…* (select another Planned invoice). Per line: *Split* (modal with N installments of date and amount, live residual "{x} left to place"), *Move to…* (date). All of these post to `$id.schedule.tsx`.
3. When `residuals` has a non-zero value, show a warning callout listing each line's residual ("Platform access: {x} not on any invoice") and a *Reset schedule* button (intent `reset`).
4. `$id.schedule.tsx`:
   1. `update: "sales"`, `customerContractScheduleEditValidator`.
   2. `runContractAction(…, { type: "edit-schedule" | "reset-schedule", customerContractId, asOf: today, edit })`.
   3. Flash the server function's error message on refusal. That is how the residual message from Task 9 step 4 reaches the user.
5. Memo-borne rows (cancellation credit) show under the table as "Credited on {memoId}" with a link to `path.to.memo`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** drag-and-drop.

---

### Task 26: Revenue section (preview)

**Depends on:** 22
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractRevenue.tsx`
- Copy from (precedent): the table styling of `RentalBillingPeriods.tsx`

**Steps:**
1. Per line: method, project, revenue dates (`lineRevenueDates`), and its monthly revenue preview.
2. A per-month table from `contractPositionPreview`: Month, Invoiced, Recognized, Deferred. A negative deferred amount reads "Earned, not billed".
3. Footnote: "Preview. Until line-level revenue arrives, posted revenue follows each invoice line's service period by day." This is the Phase A interim (spec "Delivery phases").

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** posted figures (Phase B).

---

### Task 27: Confirm and Invoice Now

**Depends on:** 15, 17, 22
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/$id.confirm.tsx`, `$id.invoice.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractConfirmModal.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/rental-agreement+/$id.activate.tsx` and `$id.invoice.tsx`; the Stripe customer step in `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoicePostModal.tsx` + `StripeCustomerPanel.tsx`, and `preflightStripeSend` in `$invoiceId.post.tsx` (L300)

**Steps:**
1. Modal: a summary (first invoice date and total, invoice count to the horizon, the effective invoicing mode). When the mode is Stripe and no customer is linked, show `StripeCustomerPanel`. Read how the post modal fetches `path.to.api.stripeConnectCustomer`. If that API requires an `invoiceId` and cannot resolve by customer, STOP and report — a by-customer variant is a design change.
2. `$id.confirm.tsx`:
   1. `requirePermissions(request, { update: "sales" })`. When the effective mode is not `Draft Only`, also require `create: "invoicing"`.
   2. Stripe mode: run the link step (resolve plus `mappingService.link("customer", …)`, as in `preflightStripeSend`).
   3. `runContractAction(…, { type: "confirm", customerContractId, asOf: today })`.
   4. Flash the result and redirect to the contract.
3. `$id.invoice.tsx` (Invoice Now): `update: "sales"` + `create: "invoicing"`. Call `generateContractInvoicesNow`, then `batchTrigger("invoice-automate", …)` for the invoices that are not held and not `Draft Only`, passing `mode`. Copy the rental route exactly. Flash "Drafted N invoice(s)", or "Nothing is due" when there are none.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** changing `preflightStripeSend`.

---

### Task 28: Amend modal, preview, amendment history

**Depends on:** 10, 22
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/$id.amend.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractAmendModal.tsx`, `ContractAmendments.tsx`
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementReturnForm.tsx` (a modal form posting to a document action route)

**Steps:**
1. Modal: effective date (default today), "Takes effect" (From the change date / From the next billing period), a table of open lines with editable quantity / rate / discount / tax / description and an End checkbox, *Add line*, reason, contract type (pre-filled from the preview's `suggestedType`).
2. Preview: on change (debounced), a fetcher posts `intent=preview` to `$id.amend.tsx`, which runs `runContractAction({ type: "amend", preview: true, … })`. It renders the adjustments, the next two invoices and the suggested type. When `resetsEditedInvoices > 0` it adds the warning "This resets {n} edited invoice(s) after {date}".
3. Save: `intent=save` → `runContractAction({ type: "amend", … })`.
4. `ContractAmendments`: history (date, effect, type, reason) and the replaced → replacement lines with their changed fields.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** amending a Draft (Draft edits lines directly).

---

### Task 29: Cancel modal and revert

**Depends on:** 11, 22
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/$id.cancel.tsx`, `$id.revert-cancellation.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractCancelModal.tsx`
- Copy from (precedent): the Task 28 modal

**Steps:**
1. Modal: end date (default `currentPeriodEnd(terms, today)`), reason, and *Credit unused time*. The checkbox is visible only when the preview returns `creditAvailable`, and reads "Credit unused time ({credit})".
2. Preview through `intent=preview` as in Task 28. Save → `runContractAction({ type: "cancel", … })`. When a memo was created, flash "Cancelled. Credit memo {memoId} drafted" with a link.
3. Revert route: `update: "sales"` → `runContractAction({ type: "revert-cancellation", … })`, behind a `Confirm` dialog.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** posting the memo (the user posts it from Credits; Task 14 handles the accounting).

---

### Task 30: Create Contract from a sales order

**Depends on:** 15, 22
**Files:**
- Create: `apps/erp/app/routes/x+/sales-order+/$orderId.contract.tsx`
- Create: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderToContractModal.tsx`
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx` — add the action next to the jobs action
- Copy from (precedent): `apps/erp/app/modules/sales/ui/SalesReturnOrders/ReturnableLinesModal.tsx` (checkbox modal), `apps/erp/app/modules/sales/ui/Quotes/QuoteToOrderDrawer.tsx` (hidden JSON `selectedLines`), `apps/erp/app/routes/x+/quote+/$quoteId.convert.tsx`

**Steps:**
1. Show the action only when the order has at least one `Service` line that is not `invoicedComplete` and has `quantityInvoiced = 0`, and the user can `create` sales.
2. Modal: the eligible Service lines with a checkbox, Kind (One-time / Recurring) and Per (rate unit when Recurring); contract name (default "{customer} — {order id}"), start date, duration, frequency, alignment, timing. Post hidden JSON `lines`.
3. Route: `create: "sales"`, `createContractFromSalesOrderValidator`, `createContractFromSalesOrder(getDatabaseClient(), …)`, then redirect to the new contract's details.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** goods lines (spec: physical goods stay on sales orders).

---

### Task 31: "From contract" links on invoices, invoice lines and memos

**Depends on:** 22
**Files:**
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm.tsx` — beside `RentalInvoiceLineSummary` (L135)
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader.tsx` — near the related-documents area (~L151)
- Modify: the memo detail header (find it with `grep -rln "path.to.memo" apps/erp/app/modules/invoicing/ui`)

**Steps:**
1. Line form: when `customerContractLineId` is set, show "Generated from contract {CON…}" linking to `path.to.contract(customerContractId)`. Copy `RentalInvoiceLineSummary`'s `useCarbon` lookup.
2. Invoice header: when `salesInvoice.customerContractId` is set, add a "Contract {CON…}" link.
3. Memo header: the same when `memo.customerContractId` is set.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** list columns.

---

### Task 32: Demo datasets

**Depends on:** 5
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — `SalesData` (~L870) gains `contracts: ContractSpec[]`
- Modify: `packages/database/src/datasets/data/{satellite,robotics,precision,motor}/sales.ts`
- Modify: `packages/database/src/datasets/tiers/04-sales.ts` — after the sales-return block (~L465)
- Modify: `packages/database/src/datasets/coverage.ts` — floors
- Copy from (precedent): the sales-return block in `04-sales.ts` (`nextSequence(ctx, "salesReturnOrder")`, `insertId`); `.claude/rules/onboarding-company-templates.md` (offsets, never `Date`)

**Steps:**
1. `ContractSpec`:
```ts
{ key; name; customer; startOffset: DayOffset; termMonths: number | null; renewal; renewalUpliftPercent;
  billingFrequency; billingAlignment; billingTiming;
  lines: { kind; item; description; quantity; rate; rateUnit?; discountPercent?; startOffset; endOffset?; revenueMethod }[] }
```
   Percentages are written as people write them; the tier divides by 100.
2. One contract per dataset: a One-time implementation line and two Recurring lines, on Service items that already exist in that dataset. If a dataset has fewer than three Service items, add the missing ones to its items slice. The contract starts at offset −60, Monthly / Calendar / Advance, a 12-month term renewing at 5%.
3. Tier:
   1. Insert the contract as Active with `confirmedAt` and lines.
   2. Plan the schedule with `planInvoiceSchedule` (import `../../contract-schedule`) through `horizon(terms, anchor)`.
   3. Insert it with every invoice dated ≤ the anchor marked `Billed Externally` and `billedThrough` set to the last such row's `periodEnd`. This keeps the seed free of drafted invoices, which tier 09 would otherwise have to journal.
4. Floors: measure with `pnpm db:check:datasets` (read the counts it reports), then add `customerContract: 1`, `customerContractLine: 3`, `customerContractInvoice` / `customerContractInvoiceLine` at their measured minimum × 0.8 (rounded down).

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets OK, no shortfalls
pnpm --filter @carbon/database test
# Expected: all pass
```

**Out of scope:** seeding drafted or posted contract invoices.

---

### Task 33: MCP digest, lint, i18n, scoped typechecks, tests

**Depends on:** 1–32
**Files:** generated and catalog files only

**Steps:**
1. `pnpm generate:mcp`, then `pnpm check:manifest`.
2. `pnpm --filter @carbon/checks license-headers` (fixes any new file's SPDX header).
3. `pnpm run lint` (fix new findings only).
4. `pnpm lingui:extract`, then the `/translate` skill to fill new strings.
5. Run the scoped typechecks and tests below.

**Verify:**
```bash
pnpm check:manifest
# Expected: OK
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/server-functions --filter=@carbon/database --filter=@carbon/utils --filter=@carbon/stripe --filter=@carbon/lib --filter=@carbon/ee --filter=@carbon/documents --concurrency=1
# Expected: all successful (or only the Task 1 baseline failures)
pnpm --filter @carbon/utils test && pnpm --filter @carbon/database test && pnpm --filter @carbon/server-functions test && pnpm --filter @carbon/jobs test && pnpm --filter @carbon/checks test && pnpm --filter @carbon/documents test && pnpm --filter @carbon/ee exec vitest run src/accounting
# Expected: all pass
cd apps/erp && pnpm exec vitest run app/modules/sales test/list-select-columns.test.ts
# Expected: all pass
```

**Out of scope:** pre-existing lint findings.

---

### Task 34: Docs — reference page, glossary, AGENTS.md, rules, spec changelog

**Depends on:** 33
**Files:**
- Create: `docs/content/docs/reference/contracts.mdx` (use the `carbon-docs` skill); add it to `docs/content/docs/reference/meta.json`
- Modify: `docs/content/src/glossary/terms.ts` — *Contract*, *Contract type*, *Invoice schedule*, *Revenue method*, *Billed through*, *Amendment* (copy the `"rental-agreement"` entry shape, ~L496)
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — a "Contracts" section beside "Rentals"
- Modify: `packages/server-functions/AGENTS.md` only if it lists functions
- Modify: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III — Changelog entry recording plan-level decisions 1–15, plus the path mapping table
- Copy from (precedent): `docs/content/docs/reference/rental-agreements.mdx`

**Steps:**
1. The reference page covers concepts, lifecycle (`<StatusFlow entity="customerContract">`, if `StatusFlow` reads entities from a registry, register it there as rental agreements are), invoice schedule editing, amendments, cancellation, renewal, invoicing automation, and a Phase A callout that revenue follows invoice service periods.
2. Regenerate the agent knowledge base with the command in `.claude/rules/agent-knowledge-base.md`.
3. Add any durable lesson to `.ai/lessons.md` (`Context → Problem → Rule → Applies to`).

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: successful
pnpm --filter @carbon/content test
# Expected: terms.test.ts passes
```

**Out of scope:** a changelog entry (shipped with the PR, `changelog-entry` skill).

---

### Task 35: Browser verification (`/test`)

**Depends on:** 34
**Files:** `.ai/playbooks/` (cached by `/test`), the run log

**Steps:** With the user's permission, `/auth` then `/test` against the running stack, with accounting enabled and default mode *Post and Email*. Record PASS or FAIL for each check in the run log:
1. Create the Acme Draft (Task 5's worked example). The Invoices section shows 1 Nov = $60,420.00 and $420.00 monthly. The Revenue preview shows implementation $10,000/month Nov–Apr. November reads invoiced $60,420.00, recognized $10,420.00, deferred $50,000.00.
2. Split implementation into 3 × $20,000 (1 Nov / 1 Dec / 1 Jan): accepted. A split totalling $50,000: refused, with the residual shown.
3. Confirm. Invoice Now on/after 1 Nov drafts one invoice with three Service lines (service windows 1–30 Nov ×2 and 1 Nov–30 Apr), and it posts. A second Invoice Now drafts nothing. The journal credits Deferred Revenue $60,420.00. With a project on the contract and an override on one line, each line's revenue-side journal line carries its own Project dimension and AR carries none.
4. A $10/day line bills $310.00 for a 31-day month.
5. Amend on 12 March (10 → 15 seats, From the change date): the preview shows −$206.45 / +$309.68 and Expansion. With *From the next billing period* there are no March lines.
6. Cancel effective 20 Sep with Credit unused time: a Draft credit memo for $140.00. Post it: the journal debits Deferred Revenue. Revert is refused after posting.
7. VOID a posted contract invoice. Invoice Now re-drafts it, held with "Re-billing INV-…, which was voided".
8. An invoice containing a negative adjustment is held under *Post and Email*.
9. Set the contract to *Post and Send via Stripe* with no linked customer: Confirm asks for the link. In test mode with Stripe connected, the invoice is sent and stamped "Stripe". Without Stripe, the option is disabled in Settings.
10. Create Contract from a sales order with one Service line ticked. Invoicing the order bills only the remaining lines, and the order completes when they are invoiced.
11. A EUR contract posts with base translation.
12. Rental agreement Invoice Now still behaves as before.
13. The drafted Acme invoice's platform line shows 10 × $40.00, −20%, $320.00, on screen and in the PDF. A hand-made invoice line at 20% off posts net revenue, and the invoice total matches the list.
Email-dependent checks (actual delivery, digest) are recorded as pending when SMTP is not configured, as in the rental plan.

**Verify:**
```bash
grep -c "PASS" .ai/runs/2026-10-02-contracts.md
# Expected: ≥ 13 (or each FAIL has a follow-up)
```

**Out of scope:** Phase B acceptance criteria.

# Part IV — Contracts setup wizard and Phase B revenue

> Was `.ai/plans/2026-10-04-contracts-wizard-phase-b.md` ("Contracts — setup wizard, editable schedules, Phase B revenue"), merged here verbatim on 2026-10-07. Decision, question and section numbers in this Part (D1, Q3, §2, Task 4) are its own.

Spec: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III (Phase A implemented; this plan is Phase B
plus a UI change Brad asked for on 2026-10-04). FX facts: `.ai/research/contract-exchange-rates.md`.

### Brad's decisions (2026-10-04)

1. **Wizard** — creating a contract is a five-step flow: Details → Products → Invoicing →
   Revenue → Review. Overrides the spec's "one page, not Rillet's wizard" (UI Changes).
   The contract page stays the place to work on a contract after Confirm.
2. **Draft at step 1** — Next on Details inserts the Draft; every later step edits that
   record through real endpoints. Steps are routes: `/x/contract/:id/setup/<step>`.
3. **Keep the conservation rule** — invoice-grid and revenue-grid edits only move money:
   each line's billed total = its computed total, and its revenue total = its billed
   total. The footer shows the residual; Confirm stays blocked until it is zero.
4. **Ship-to** — `customerContract.shipToCustomerLocationId`, copied onto drafted invoices.
5. **Build Phase B now** — stored per-line monthly revenue, editable while Draft
   (overrides the spec's "read-only" / "hand-edited revenue schedules out of scope"),
   and the GL engine that posts from it.

### Design decisions (this plan)

D1. **Revenue plan table** `customerContractRevenue` — one row per (line, calendar month),
    `amount` in contract currency, `status` `contractRevenueStatus`: Planned /
    Recognized / Recognized Externally. UNIQUE (companyId, customerContractLineId,
    periodStart). Same persistence model as the invoice schedule: an unedited Draft has
    no rows (the loader plans live); the first revenue edit, or Confirm, writes them.
    Rows are addressed by their natural key (lineId + month) — no `planned:` refs needed.
D2. **Revenue plan math** moves to `@carbon/database/contract-revenue-schedule`
    (`planRevenueSchedule`, `reconcileRevenueSchedule`, `validateRevenueEdit`), so the
    server functions and the dataset tier share it. A line's revenue total = Σ its
    invoice-schedule rows (adjustments and memo credits included), spread over
    `lineRevenueDates` by the line's method (Daily / Even Period). Months before
    `recognizeRevenueFrom` are `Recognized Externally`. `packages/utils/src/contract-revenue.ts`
    keeps `contractPositionPreview` and re-exports the rest.
D3. **Position = invoiced − recognized per line, in both currencies.** GL invariant per
    line: Deferred Revenue = max(N, 0), Contract Assets = max(−N, 0). Every movement
    (invoice, recognition, memo, VOID, opening) is applied by ONE pure function
    `applyContractMovement(position, amount, rate)` → `{ deferred, asset, fx }` legs
    (contract-currency + base). Base is carried at a weighted-average rate per pool
    (research open question 7, SAP RAR); clearing Contract Assets at an invoice books
    the base difference to `realizedExchangeGain/LossAccount`, never to revenue.
D4. **Movement ledger** `customerContractLedgerEntry` — one row per movement:
    `customerContractLineId`, `entryType` (Invoice / Recognition / Credit Memo / Void /
    Opening), source refs (`salesInvoiceLineId`, `memoId`, `revenueRecognitionScheduleId`,
    `customerContractRevenueId`), `deferredAmount`, `deferredBase`, `assetAmount`,
    `assetBase` (signed), `journalId`. Position = Σ by line. A Recognition entry
    cascades with its `revenueRecognitionSchedule` row (a recalculated Draft run drops
    both).
D5. **Recognition reuses the run.** `revenueRecognitionSchedule` gains
    `customerContractLineId`, `customerContractRevenueId`, `contractAmount`.
    `synthesizeContractRevenue` (added to `RUN_ROW_SYNTHESIZERS`) turns each due Planned
    revenue row into a Deferral row (Dr Deferred Revenue / Cr Sales) for the part the
    deferred pool covers and an Accrual row (Dr Contract Assets / Cr Sales) for the rest
    (base at the run date's rate), writes the ledger entries, and marks the plan row
    Recognized. Run posting is unchanged except: Project dimension from the line, and
    `documentType "Contract"`.
D6. **Invoice posting contract branch** — a `salesInvoiceLine` with
    `customerContractLineId` skips the Service deferral: Cr Contract Assets up to the
    asset pool, the rest Cr Deferred Revenue; no schedule rows. Negative amounts reverse
    (Dr Deferred up to the deferred pool, rest Dr Contract Assets). VOID applies the
    negation through the same function (entry type Void) instead of refusing.
D7. **post-memo contract branch** — a contract credit memo applies a negative movement
    per credited line (Dr Deferred up to the pool, rest Dr Contract Assets) and replaces
    `releaseContractDeferral`. Cancel adds negative catch-up revenue rows for months
    already Recognized after the new end date, so the asset clears in the next run.
D8. **Opening balance at Confirm** (migration): per line, Opening entry =
    Σ Billed Externally rows − Σ Recognized Externally revenue, at the contract's
    reference rate, no journal (the user's opening journal carries it).
D9. **Reconcile, never rewrite** — amend / cancel / revert / renewal / horizon roll call
    `reconcileRevenueSchedule` per touched line: Planned months are replaced by the new
    plan; a Recognized month whose new value differs adds the difference to the first
    Planned month on or after the effective date (a catch-up row is created when none).
D10. **Invoice grid ops** (Draft, extend `edit-schedule`): `setAmount` (invoice × line
    cell; one row per cell after the edit, units rescaled like split, deleting the row
    at 0), `addInvoice` (date + optional cell amounts; created with ≥ 1 row), `delete`
    (removes the invoice's rows — residual shows). Existing `move` stays for the date
    cell. move/split/merge/moveLine stay for the contract page's menus.
D11. **Revenue grid ops** (Draft, new `edit-revenue` action): `setAmount` (line ×
    month), `addMonth`, `deleteMonth`, `reset`. Confirm refuses a line whose revenue
    total ≠ its billed total.
D12. **Grid** — the shared `Table` with `editableComponents` (the inspection grid's
    machinery). New `EditableDate` cell (extend `~/components/Editable`). Rows =
    invoices / months, columns = contract lines, a footer row of residuals.
D13. **Wizard shell** — new `ContractSetup` layout: stepper (no shared one exists —
    create it in `ui/Contracts/ContractSetupSteps.tsx`), sticky footer with contract
    total + Back / Next. Next navigates; data is already saved.

### Tasks

- [x] **T1 Schema** — migration `contracts-phase-b`: enum `contractRevenueStatus`,
      enum `contractLedgerEntryType`, tables `customerContractRevenue`,
      `customerContractLedgerEntry`; `revenueRecognitionSchedule` +3 columns;
      `customerContract.shipToCustomerLocationId`; `customerContracts` view gains
      `shipToCustomerLocationId`, `recognizedToDate`. Authz manifest + RLS migration.
      `pnpm db:migrate && pnpm run generate:types`. Verify: types contain the tables.
- [x] **T2 Pure math + tests** — `packages/database/src/contract-revenue-schedule.ts`
      (plan / reconcile / validate), `packages/database/src/contract-position.ts`
      (`applyContractMovement`, `positionFromEntries`). Verify: vitest green.
- [x] **T3 Contract lifecycle** — `post-customer-contract`: invoice-grid ops (D10),
      `edit-revenue` (D11), confirm materializes revenue + checks + Opening (D8), amend /
      cancel / revert reconcile revenue (D9, D7 catch-up); `create-contract-invoices`:
      renewal + `rollHorizon` reconcile revenue, ship-to on drafted invoices.
      DB tests in `contract-lifecycle.test.ts`.
- [x] **T4 Posting** — `post-sales-invoice` contract branch + VOID (D6), `post-memo`
      (D7), `synthesizeContractRevenue` (D5), run post: Project dimension, revenue rows
      Recognized, close-task count. DB tests. ⚠ Shares files with uncommitted
      recalculate-run work in this worktree — wait for it to land or ask.
- [x] **T5 ERP data** — validators (`sales.models.ts`), `$id.schedule.tsx` new intents,
      `$id.revenue.tsx`, `update.tsx` ship-to field, `$id.tsx` loader exposes
      `lineTotals`, revenue rows (live or stored), residuals, ledger position.
- [x] **T6 Wizard UI** — routes `x+/contract+/new.tsx` (step 1 → insert → redirect to
      setup/products), `$id.setup.tsx` layout + `products` / `invoicing` / `revenue` /
      `review` children; `ContractProductsGrid`, `ContractInvoiceGrid`,
      `ContractRevenueGrid`, `ContractBillTo` (bill-to, address, ship-to, contact,
      terms), `EditableDate`. Contract page Invoices/Revenue cards reuse the grids while
      Draft. Copy in Lingui.
- [x] **T7 Data + docs** — dataset tier 04 seeds revenue rows (+ Opening entries) for its
      Active contracts, coverage floors; `docs/content/docs/reference/contracts.mdx`;
      sales `AGENTS.md`; spec changelog; lessons; `/translate`.
- [x] **T8 Verify** — scoped typechecks (database, utils, server-functions, erp), tests,
      Biome, `db:check:datasets`, browser walkthrough of the wizard at 1440/1024/390.

### Interfaces (T3 ⇄ T5/T6 contract — both sides build to exactly this)

#### `post-customer-contract` input additions

`edit-schedule` → `edit` gains three intents (Draft, Planned invoices only, refs as today —
a stored id or `planned:<invoiceDate>`):

```ts
| { intent: "setAmount"; customerContractInvoiceId: string; customerContractLineId: string; amount: number }
    // the cell (invoice × line) becomes ONE non-adjustment row of `amount` (≥ 0). 0 deletes the
    // cell's rows; an invoice left empty is deleted. A cell with no rows yet gets a row whose
    // period is the invoice's other rows' period for that line, else the line's nearest
    // planned period, else [invoiceDate, invoiceDate]; units = amount ÷ (qty × unitPrice ×
    // (1 − discount)) when that is defined, else 1 with unitPrice = amount.
| { intent: "addInvoice"; invoiceDate: string; amounts: { customerContractLineId: string; amount: number }[] }
    // ≥ 1 amount > 0; rows as setAmount; if a Planned invoice already sits on the date the
    // amounts are added to it.
| { intent: "delete"; customerContractInvoiceId: string }
    // removes the Planned invoice and its rows; the lines show residuals.
```

New action `edit-revenue` (Draft only; the first edit writes the live plan, D1):

```ts
{ type: "edit-revenue"; customerContractId; asOf; edit:
  | { intent: "setAmount"; customerContractLineId: string; periodStart: string /* YYYY-MM-01 */; amount: number } // 0 deletes the row
  | { intent: "addMonth"; periodStart: string; amounts: { customerContractLineId: string; amount: number }[] }
  | { intent: "deleteMonth"; periodStart: string }   // every line's row in that month
  | { intent: "reset" } }                             // delete all rows → live plan again
```

`confirm` additionally: writes the revenue plan when none is stored; refuses (`{ revenueResiduals }`)
when any line's revenue total ≠ its billed total; writes Opening ledger entries (D8).

#### Shared server helper (server-functions)

`packages/server-functions/src/post-customer-contract/revenue-writes.ts`:
- `billedTotals(trx, scope, contractId)` → `{ totals: Map<lineId, number>, lastPeriodEnds: Map<lineId, string> }`
  (Σ every schedule row incl. adjustments + memo credits; last periodEnd per line).
- `plannedRevenue(trx, scope, contract, lines)` → `ContractRevenueRow[]` (planRevenueSchedule with the above).
- `materializeRevenue(trx, scope, contract, lines)` — inserts the plan.
- `reconcileRevenue(trx, scope, contract, lines, lineIds, from)` — D9 per line.

#### ERP loader (`$id.tsx`) additions to `ContractRouteData`

`lineTotals: Record<lineId, number>` (planned billed totals), `revenueRows` (stored rows, or the
live plan when none — each `{ lineId, periodStart, periodEnd, amount, status }`),
`revenueIsStored: boolean`, `revenueResiduals: Record<lineId, number>`, `ledgerPosition:
Record<lineId, ContractPosition>` (Active contracts).

#### Routes

- `path.to.contractSchedule(id)` — existing; accepts the three new intents (amounts as numbers,
  `amounts` as a JSON field).
- `path.to.contractRevenue(id)` → `x+/contract+/$id.revenue.tsx` — action only, `update: sales`.
- `path.to.contractSetup(id, step)` → `x+/contract+/$id.setup.tsx` (layout) +
  `$id.setup.products.tsx`, `$id.setup.invoicing.tsx`, `$id.setup.revenue.tsx`,
  `$id.setup.review.tsx`. `new.tsx` is step 1 and redirects to `setup/products` on create.
  An existing Draft can reopen the wizard; an Active contract redirects to `contractDetails`.

### Changes during the build (2026-10-04)

| Change | Why |
|---|---|
| `customerContractLine.kind` → `revenueType`, enum `contractRevenueType` (migration `20261004202351`) | Brad: never name a field "Kind". The rule is in root `AGENTS.md` and `conventions-database.md`. |
| `customerContractLedgerEntry` gains `updatedBy` / `updatedAt` (migration `20261004202441`) | Every table with `createdBy` needs `updatedBy`. |
| Ship-to is copied onto drafted invoices through the new `salesInvoiceShipment.customerLocationId` (migration `20261004211336`) | The column did not exist. Brad approved the change on 2026-10-04. Sales rules and the invoice PDF read it too. |
| Details step: "Action on Completion", More Details always open, Sales Person = the current user, "Contract Close Date" with glossary term `contract-close-date`, no contract-type helper text | Brad's review of the wizard. |
| `reconcileRevenue` keeps a Planned month that a Draft run holds | An amendment must not delete a month the run is about to post. |
| Revenue edits refuse negative amounts in the server too | Only reconciliation writes a negative catch-up month. |
| The contract page's move / merge / split menus are removed | The invoice grid replaces them on a Draft. The server intents stay. |
| A confirmed contract's Revenue card shows the stored plan with a status per month | Phase B stores the plan, so the preview is only a fallback for contracts confirmed before it. |

Not committed: another session's uncommitted recalculate-run work shares `post-sales-invoice/index.ts`, `post-memo-transaction.ts`, `propose-revenue-recognition-run/index.ts` and `accounting.server.ts`. The posting changes build on its helpers. Commit after that work lands.

# Part V — Period runs hardening

> Was `.ai/plans/2026-10-04-period-runs-hardening.md` ("Period runs hardening (revenue recognition and depreciation) — implementation plan"), merged here verbatim on 2026-10-07. Decision, question and section numbers in this Part (D1, Q3, §2, Task 4) are its own.

**Spec:** none. The decisions come from the conversation of 2026-10-04. The table below lists them.
**Research:** .ai/research/2026-10-04-netsuite-period-runs.md
**Branch:** revenue-recognition-rentals-spec

### Decisions (Brad, 2026-10-04)

| # | Decision | NetSuite precedent |
|---|---|---|
| D0 | Keep the uncommitted baseline: Recalculate on Draft runs, the out-of-date check at Post, and Draft-run sync on invoice void and contract credit memo. | ARM Estimate, re-runnable process |
| D1 | A posting makes a period Active only when the period contains the company's today. | The current period comes from the system date. |
| D2 | New, Repeat and Post refuse a run whose `periodEnd` is after the end of the company's current month. The current month stays allowed. | FAM "Allow Future-dated Depreciation" off |
| D3 | **Reverse Run** on a Posted run reverses its journals, resets the source records, and returns the run to Draft. Depreciation allows it only on the latest posted run. Generic journal reversal refuses run journals. | ARM void or delete makes plan lines recognizable again |
| D4 | A run posts one journal per month, each in that month's accounting period. If that month's period is Closed, that month posts in the run's own period. | FAM journal per period of depreciation |
| D5 | A revenue recognition period can have more than one run. Only one Draft per period exists at a time. | ARM "multiple times in a month" |

Terms used in this plan:

- **Month end**: the last day of a calendar month, `YYYY-MM-DD`.
- **Company today**: `datetime.today(await getCompanyTimeZone(client, companyId)).toString()`.
- **Current month end**: `endOfMonth(parseDate(companyToday)).toString()`.
- **Future run**: a run whose `periodEnd` is after the current month end.
- **Target date**: the posting date of a month's journal. It is the month end, or the run's `periodEnd` when the month's period is Closed.

### Progress

- [x] Task 0: Commit the baseline (shipped inside the contracts Phase B commit — the two share the posting files; see that commit's message)
- [x] Task 1: Make the server period resolver activate only today's period (deviation: `chargeFixture`'s one period spans 2000–2099, so the new test deletes it and inserts a current-month period first)
- [x] Task 2: Make the ERP period helper activate only today's period (deviation: the company today is read lazily, only when a period would change, so the mocked period tests need no `company` row)
- [x] Task 3: Add the pure helpers for future runs and target dates
- [x] Task 4: Refuse future runs in New, Repeat and Post (the check lives once in `futureRunPeriodError`, `accounting.server.ts`)
- [x] Task 5: Add the migration for per-month depreciation lines and one Draft per period (deviation: `periodEnd` stays NULLABLE — `db:check:backups` refused NOT NULL with no default; readers fall back to the run's `periodEnd`. Committed with Task 6, because the dataset check fails on the migration alone)
- [x] Task 6: Regenerate the database types and fix the dataset tier (also: `insertDepreciationRun` / `replaceDepreciationRunLines` write the run's `periodEnd` until Task 7)
- [x] Task 6b: Move the depreciation month arithmetic to `@internationalized/date` (found in Task 7; also corrected the existing test "uses lastPostedPeriodEnd to narrow the window", which pinned the skipped month)
- [x] Task 7: Build depreciation lines per asset per month (lines from before the migration read their run's `periodEnd`)
- [x] Task 8: Post depreciation one journal per line, dated per month
- [x] Task 9: Post revenue recognition one journal per month (contract ledger entries and lease schedule lines record their own month's journal)
- [x] Task 10: Show the period on depreciation lines and every journal in the Documents panels (also: Accum. Depr. / NBV After start a later month from the earlier months of the same asset)
- [x] Task 11: Allow more than one revenue recognition run per period
- [x] Task 12: Add Reverse Run for revenue recognition (also refuses while another Draft holds the period; resets contract ledger entries and revenue months)
- [x] Task 13: Add Reverse Run for depreciation
- [x] Task 14: Refuse generic reversal of run journals (`RUN_JOURNAL_SOURCES` lives in `accounting.models.ts`, shared by the service and the header)
- [x] Task 15: Update AGENTS.md and the fixed-asset rule
- [x] Task 16: Verify in the browser (all 7 cases PASS; found and fixed unrounded accumulated depreciation on posting)

### Dependencies

- Task 0 comes first.
- Tasks 1, 2 and 3 are independent of each other.
- Task 4 needs Task 3.
- Task 6 needs Task 5. Tasks 7, 8, 10 and 13 need Task 6.
- Task 8 needs Tasks 3 and 7. Task 9 needs Task 3.
- Task 10 needs Tasks 8 and 9.
- Task 11 needs Task 6 (the unique index).
- Task 12 needs Task 9. Task 13 needs Task 8.
- Task 14 needs Tasks 12 and 13.
- Tasks 15 and 16 come last.

---

### Task 0: Commit the baseline

**Depends on:** none
**Files:**
- Modify: none. The baseline is already in the working tree.

**Steps:**
1. Run `git status --short`. Confirm that git lists `apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx` as modified.
2. Run the `/check-and-commit` skill.
3. Exclude `apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx` from the commit. Another session owns that change.
4. Use the message `feat(accounting): recalculate draft period runs and refuse out-of-date posts`.

**Verify:**
```bash
git show --stat HEAD | grep -c useSalesSubmodules
# Expected: 0
git status --short apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx
# Expected: " M apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx" (still uncommitted)
```

**Out of scope:** any change to `useSalesSubmodules.tsx`.

---

### Task 1: Make the server period resolver activate only today's period

**Depends on:** Task 0
**Files:**
- Modify: `packages/server-functions/src/lib/get-accounting-period.ts` — `resolveAccountingPeriod`, the `mode === "current"` block (line 157)
- Modify: `packages/server-functions/src/post-charge/get-accounting-period.test.ts` — the test "period creation uses the fiscal start and leap-month boundary"

**Steps:**
1. In `resolveAccountingPeriod`, select `sql<string>\`"endDate"::text\`.as("endDate")` beside `startDate` in the `periods` query.
2. Before the `mode === "current"` block, compute the company today: `datetime.today(await getCompanyTimeZone(db, companyId)).toString()`.
3. Change the condition to `mode === "current" && period.status !== "Active" && period.startDate <= today && period.endDate >= today`.
4. Update the comment above the function: a posting dated in another month leaves the Active period alone.
5. In the test "period creation uses the fiscal start and leap-month boundary", change the expected `status` to `"Inactive"`. The date 2024-02-29 is not today.
6. Add a `databaseTest` named "a posting dated in another month leaves the Active period alone":
   1. Use `chargeFixture()`.
   2. Read the id of the period that has `status = 'Active'`.
   3. Call `getCurrentAccountingPeriod(f.companyId, f.db, "2024-02-29")`.
   4. Expect the same period to be still `Active`.
   5. Expect the 2024-02 period to be `Inactive`.

**Verify:**
```bash
cd packages/server-functions && SUPABASE_DB_URL="$(grep -h '^SUPABASE_DB_URL' ../../.env.local | cut -d= -f2- | tr -d '"')" pnpm exec vitest run src/post-charge/get-accounting-period.test.ts
# Expected: all tests pass, none skipped
```

**Out of scope:** the intercompany elimination SQL (`20260816162947`, `20260817122328`). It already activates only the period that contains today.

If `chargeFixture` has no Active period, STOP and report — do not improvise.

---

### Task 2: Make the ERP period helper activate only today's period

**Depends on:** Task 0
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getOrCreateAccountingPeriod` (line 2348)

**Steps:**
1. At the top of `getOrCreateAccountingPeriod`, compute the company today with `getCompanyTimeZone(client, companyId)` and `datetime.today(tz)`. Both imports already exist in this file; confirm with grep.
2. Set `isCurrent` to true when `date.slice(0, 10)` and the company today fall in the same month. Compare the `startOfMonth(parseDate(...)).toString()` of each.
3. In the existing-period branch, run the two Active updates only when `isCurrent` is true.
4. In the create branch, run the "demote the Active period" update only when `isCurrent` is true.
5. In the create branch, insert `status: isCurrent ? "Active" : "Inactive"`.
6. Add a doc comment: "Only a posting in the company's current month changes the Active period."

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
cd apps/erp && pnpm exec vitest run app/modules/accounting/accounting.periods.test.ts
# Expected: all tests pass
```

**Out of scope:** the `closeStatus` gates in the same function. They stay as they are.

If the mocked clients in `accounting.periods.test.ts` fail on the new `getCompanyTimeZone` read, add the `company` row to each mock. Do not remove a test.

---

### Task 3: Add the pure helpers for future runs and target dates

**Depends on:** Task 0
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.utils.ts`
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts`

**Steps:**
1. Add `isFutureRunPeriod(periodEnd: string, companyToday: string): boolean`. It returns `periodEnd > endOfMonth(parseDate(companyToday)).toString()`.
2. Add `monthEndOf(date: string): string`. It returns `endOfMonth(parseDate(date.slice(0, 10))).toString()`.
3. Add `runPostingTargets(args)`:
   - Input: `months: string[]` (month ends), `runPeriodEnd: string`, `closedMonths: Set<string>` (month ends whose period is Closed).
   - Output: `Map<string, string>`, month end → target date.
   - Rule: a month in `closedMonths` maps to `runPeriodEnd`. Every other month maps to itself.
4. Add tests:
   - `isFutureRunPeriod("2026-10-31", "2026-10-04")` is `false`.
   - `isFutureRunPeriod("2026-11-30", "2026-10-04")` is `true`.
   - `isFutureRunPeriod("2026-09-30", "2026-10-04")` is `false`.
   - `runPostingTargets` with months Aug, Sep, Oct, run Oct, Aug closed gives Aug → Oct, Sep → Sep, Oct → Oct.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/accounting/accounting.utils.test.ts
# Expected: all tests pass
```

**Out of scope:** `getNextPeriodEnd` and `getNextRevenueRecognitionPeriodEnd`. They do not change.

---

### Task 4: Refuse future runs in New, Repeat and Post

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/routes/x+/accounting+/revenue-recognition-runs.new.tsx`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.repeat.tsx`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.post.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/depreciation-runs.new.tsx`
- Modify: `apps/erp/app/routes/x+/depreciation-run+/$depreciationRunId.post.tsx`
- Modify: `packages/server-functions/src/propose-revenue-recognition-run/index.ts`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.tsx` — loader returns `canRepeat`
- Modify: `apps/erp/app/modules/accounting/ui/RevenueRecognition/RevenueRecognitionRunHeader.tsx` — show Repeat Run only when `canRepeat`

**Steps:**
1. In each of the 5 routes, compute the company today after `requirePermissions`.
2. In each route, after the route knows `periodEnd`, call `isFutureRunPeriod(periodEnd, companyToday)`.
3. If it returns `true`, throw a redirect with this flash error: "{Month Year} has not started yet. A run can cover the current month or an earlier one." Format the month with `formatDate(periodEnd, { month: "long", year: "numeric" })`.
4. In `proposeRevenueRecognitionRun` (`run`), read the company today with `getCompanyTimeZone(db, companyId)`. If the period is a future run, throw `InvalidInputError` with the same text. This guards the monthly job too.
5. Copy the date check as a small inline comparison in the server function. `@carbon/server-functions` cannot import ERP utils.
6. In the run page loader, return `canRepeat: !isFutureRunPeriod(getNextPeriodEnd(run.data.periodEnd), companyToday)`.
7. In `RevenueRecognitionRunHeader`, render the Repeat Run menu item only when `isPosted && canRepeat`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: Tasks: 3 successful
cd packages/server-functions && SUPABASE_DB_URL="$(grep -h '^SUPABASE_DB_URL' ../../.env.local | cut -d= -f2- | tr -d '"')" pnpm exec vitest run src/recalculate-revenue-recognition-run src/post-memo
# Expected: all tests pass
```

**Out of scope:** the depreciation Repeat route. It repeats the period of a run that is already posted, so it cannot create a future run by itself.

---

### Task 5: Add the migration for per-month depreciation lines and one Draft per period

**Depends on:** Task 0
**Files:**
- Create: the migration from `pnpm db:migrate:new period-run-months`

**Steps:**
1. Run `pnpm db:migrate:new period-run-months`.
2. Write this SQL into the new file:

```sql
-- One depreciation run line per asset per month (FAM's depreciation history
-- record). A catch-up run posts each month in its own accounting period.
ALTER TABLE "depreciationRunLine" ADD COLUMN IF NOT EXISTS "periodEnd" DATE;

UPDATE "depreciationRunLine" l
SET "periodEnd" = r."periodEnd"
FROM "depreciationRun" r
WHERE r."id" = l."depreciationRunId"
  AND l."periodEnd" IS NULL;

ALTER TABLE "depreciationRunLine" ALTER COLUMN "periodEnd" SET NOT NULL;

-- The deferred tax journal of the line's month. Reverse Run reads it.
ALTER TABLE "depreciationRunLine" ADD COLUMN IF NOT EXISTS "deferredTaxJournalId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'depreciationRunLine_deferredTaxJournalId_fkey'
  ) THEN
    ALTER TABLE "depreciationRunLine"
      ADD CONSTRAINT "depreciationRunLine_deferredTaxJournalId_fkey"
      FOREIGN KEY ("deferredTaxJournalId") REFERENCES "journal" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "depreciationRunLine_deferredTaxJournalId_idx"
  ON "depreciationRunLine" ("deferredTaxJournalId");

-- Before this migration a run posted one deferred tax journal, named only by
-- its description. Link it to the run's lines.
UPDATE "depreciationRunLine" l
SET "deferredTaxJournalId" = j."id"
FROM "depreciationRun" r, "journal" j
WHERE r."id" = l."depreciationRunId"
  AND j."companyId" = r."companyId"
  AND j."sourceType" = 'Asset Depreciation'
  AND j."description" = 'Deferred Tax: Depreciation ' || r."depreciationRunId"
  AND l."deferredTaxJournalId" IS NULL;

-- A revenue recognition period can have more than one run, but one Draft at a
-- time.
CREATE UNIQUE INDEX IF NOT EXISTS "revenueRecognitionRun_one_draft_per_period"
  ON "revenueRecognitionRun" ("companyId", "periodEnd")
  WHERE "status" = 'Draft';
```

3. Run `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate
# Expected: the new migration applies with no error
```

If the unique index fails because 2 Drafts share a period, STOP and report the duplicate runs — do not delete them.

**Out of scope:** RLS. Both tables keep their policies.

---

### Task 6: Regenerate the database types and fix the dataset tier

**Depends on:** Task 5
**Files:**
- Modify (generated): `packages/database/src/types.ts` and siblings, via the command
- Modify: `packages/database/src/datasets/tiers/09-accounting.ts` — the `depreciationRunLine` insert (line 491)

**Steps:**
1. Run `pnpm run generate:types`.
2. In tier 09, add `periodEnd: previousMonthEnd(ctx.anchor)` to the `depreciationRunLine` insert. It equals the run's `periodEnd`.
3. Run `pnpm db:check:datasets`.
4. Run `pnpm db:check:backups`.

**Verify:**
```bash
grep -c '"periodEnd"\|periodEnd:' packages/database/src/types.ts
# Expected: a count higher than before the command
pnpm db:check:datasets
# Expected: every dataset passes
pnpm db:check:backups
# Expected: no backup is reported as unrestorable
```

**Out of scope:** hand edits to `packages/database/src/types.ts`.

---

### Task 6b: Move the depreciation month arithmetic to `@internationalized/date`

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.utils.ts` — `addOneMonth`, `getMonthsBetween`, `getMonthsElapsed`, `calculateDepreciation`, `calculateTaxDepreciation`, `calculateMacrsDepreciation`
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts`

Task 7 found 2 defects that already reach production:

| Defect | Effect |
|---|---|
| `addOneMonth` calls `setMonth` before `setDate(1)`, so Aug 31 + 1 month is Oct 1. | After a run for a 31-day month, the next shorter month gets 0 months of depreciation. On a UTC server that is February, April, June, September and November. |
| The helpers parse `YYYY-MM-DD` with `new Date`, which `.claude/rules/date-handling.md` bans. | West of UTC, Jan 1 reads as Dec 31. MACRS tax years then shift by one year. |

**Steps:**
1. Write the failing tests first:
   1. `addOneMonth("2026-08-31")` is the first of September.
   2. `calculateDepreciation` charges 1 month for `2026-09-30` after `2026-08-31` for a Straight Line asset.
   3. A MACRS asset in service on Jan 1 takes its year-1 percentage in January.
2. Run them with `TZ=UTC` and with `TZ=America/New_York`. Expect both to fail.
3. Make `addOneMonth(date: string)` return `startOfMonth(parseDate(date)).add({ months: 1 })`.
4. Make `getMonthsBetween` and `getMonthsElapsed` take `CalendarDate` values. Read `year`, `month` and `day` from them.
5. In the 3 calculate functions, parse every date with `parseDate(value.slice(0, 10))`.
6. Compare dates with `compare`, not with `>`.
7. In `calculateMacrsDepreciation`, replace `getMonth()` with `month - 1` and `getFullYear()` with `year`.
8. Update the existing tests that pass `new Date(...)` to pass `parseDate(...)`.

**Verify:**
```bash
cd apps/erp && TZ=UTC pnpm exec vitest run app/modules/accounting/accounting.utils.test.ts
# Expected: the 3 new tests pass; the Task 7 tests still in the tree are allowed to fail
cd apps/erp && TZ=America/New_York pnpm exec vitest run app/modules/accounting/accounting.utils.test.ts
# Expected: the same result as under TZ=UTC
```

**Out of scope:** posted runs that lost months. A catch-up for them is a separate decision.

---

### Task 7: Build depreciation lines per asset per month

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.utils.ts` — `DepreciationLine`, `buildDepreciationLines`, `depreciationRunLinesMatch`
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — `buildDepreciationRunLines`, `replaceDepreciationRunLines`
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `insertDepreciationRun` writes `periodEnd`
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts`

**Steps:**
1. Add `periodEnd: string` to `DepreciationLine`.
2. Change the `usageMap` argument of `buildDepreciationLines` to `Map<string, number>`. The key is `${fixedAssetId}|${monthEnd}`.
3. In `buildDepreciationLines`, list the month ends from the asset's first month to `periodEnd`:
   - The first month is the month after `lastPostedPeriodEnd`.
   - If `lastPostedPeriodEnd` is null, the first month is the month of `depreciationStartDate ?? acquisitionDate`.
4. For each month, call `calculateDepreciation(asset, monthEnd, previousMonthEnd, decimalPlaces, usage)`:
   - `previousMonthEnd` is the month end before it, or `lastPostedPeriodEnd` for the first month.
   - For the asset's first month with no posted run, pass `null`.
   - `usage` is `{ unitsProduced: usageMap.get(key) ?? 0 }`.
5. After each month, add the month's amount to a local copy of `accumulatedDepreciation`.
6. Do the same for `calculateTaxDepreciation`, with a local copy of `accumulatedTaxDepreciation`.
7. Push one line per month when `amount > 0` or `taxAmount > 0`.
8. In `buildDepreciationRunLines`, build the usage map per month. Key each usage log by `monthEndOf(log.periodEnd)`. Select `periodEnd` from `fixedAssetUsageLog`.
9. Make `depreciationRunLinesMatch` key lines by `${fixedAssetId}|${periodEnd}`. Add `periodEnd` to its `stored` type.
10. Write `periodEnd` in `insertDepreciationRun` and in `replaceDepreciationRunLines`.
11. In the post route, add `periodEnd` to the `depreciationRunLine` select that feeds `depreciationRunLinesMatch`.
12. Add tests:
    - A Straight Line asset with 3 months since the last posted run gives 3 lines. Their sum equals the old 3-month amount.
    - A Declining Balance asset gives 3 lines. Each line is smaller than the one before.
    - A Units of Production asset with logs in 2 of 3 months gives 2 lines.
    - A MACRS asset with bonus depreciation takes the bonus in the first month only.
    - `depreciationRunLinesMatch` is `false` when the same asset has a different `periodEnd`.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/accounting/accounting.utils.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
```

If a split month total differs from the old span total by more than one minor unit for Straight Line, STOP and report — do not improvise.

**Out of scope:** `calculateDepreciation` and `calculateTaxDepreciation` themselves. Call them per month; do not change them.

---

### Task 8: Post depreciation one journal per line, dated per month

**Depends on:** Tasks 3 and 7
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — `postDepreciationRun`, add `resolveRunPostingPeriods`
- Modify: `apps/erp/app/routes/x+/depreciation-run+/$depreciationRunId.post.tsx`

**Steps:**
1. Add `resolveRunPostingPeriods(client, { companyId, monthEnds, runPeriodEnd })` to `accounting.server.ts`:
   1. Read the `accountingPeriod` rows that overlap `[min(monthEnds) start, runPeriodEnd]` in one query.
   2. Put each month whose row is Closed (`closeStatus = 'Closed'` or `closedAt` not null) into `closedMonths`.
   3. Call `runPostingTargets` to get each month's target date.
   4. For each distinct target date, call `getOrCreateAccountingPeriod(client, companyId, target, "accounting")`.
   5. Return `Map<monthEnd, { accountingPeriodId, postingDate }>`, or the first error.
2. Note in a comment that the loop in step 1.4 runs once per distinct month, not per line.
3. In the post route, replace the single `getOrCreateAccountingPeriod` call with `resolveRunPostingPeriods`. Pass the distinct `periodEnd` values of the lines.
4. Change `postDepreciationRun` to take `periods: Map<string, { accountingPeriodId: string; postingDate: string }>` instead of `postingDate` and `accountingPeriodId`.
5. Add `periodEnd` to the `DepreciationRunLine` type in `accounting.server.ts`.
6. For each line, post its journal with the period and posting date of `periods.get(line.periodEnd)`.
7. Sum the amounts per asset before the asset update. Run one `fixedAsset` update per asset with the summed book and tax amounts. The current code adds each line to the same starting value, which loses all but the last month.
8. Compute the deferred tax per month group. Post one deferred tax journal per month, dated with that month's period.
9. Set `deferredTaxJournalId` on every line of that month to the month's deferred tax journal.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
cd apps/erp && pnpm exec vitest run app/modules/accounting
# Expected: all tests pass
```

**Out of scope:** the journal line accounts and dimensions. They stay as they are.

---

### Task 9: Post revenue recognition one journal per month

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — `postRevenueRecognitionRun`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.post.tsx`

**Steps:**
1. In the post route, read the distinct month ends of the run's schedule rows. Use one query on `revenueRecognitionRunLine` with an embed of `scheduledDate`.
2. Call `resolveRunPostingPeriods` from Task 8 with those month ends and the run's `periodEnd`.
3. Change `postRevenueRecognitionRun` to take `periods` (the same map type) instead of `accountingPeriodId` and `postingDate`.
4. In `postRevenueRecognitionRun`, select `s.scheduledDate` in the `rows` query.
5. Group the rows by the target date of `monthEndOf(scheduledDate)`. Months that share a target date go into one journal.
6. For each group, insert one journal with that group's period and posting date. Build its lines with the existing per-row code.
7. Set `journalId` on each schedule row to its group's journal.
8. Set `rentalLeaseScheduleLine.journalId` from the journal of the row that references it.
9. Set `revenueRecognitionRun.journalId` to the journal whose posting date is the run's `periodEnd`. If no group has that date, use the journal with the latest posting date.
10. Keep the out-of-date check from the baseline before the first insert.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
```

**Out of scope:** the account and dimension rules of each line. They stay as they are.

---

### Task 10: Show the period on depreciation lines and every journal in the Documents panels

**Depends on:** Tasks 8 and 9
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `getDepreciationRunLines` selects `periodEnd` and `deferredTaxJournalId`; `getJournalEntryRelatedItems` (the `"Revenue Recognition"` branch near line 5948)
- Modify: `apps/erp/app/routes/x+/depreciation-run+/$depreciationRunId.tsx` — journal ids include `deferredTaxJournalId`; the lines table shows a Period column
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.tsx` — pass the distinct `schedule.journalId` values to `getPeriodRunRelatedItems`
- Copy from (precedent): the Period column of `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.tsx` (the Deferrals table)

**Steps:**
1. In `getDepreciationRunLines`, add `periodEnd, deferredTaxJournalId` to the select. Order by `periodEnd`.
2. In the depreciation run page, add a Period column that shows `formatDate(line.periodEnd)`. Copy the column markup from the revenue recognition run page.
3. In the depreciation run loader, collect both `journalId` and `deferredTaxJournalId`, without duplicates.
4. In the revenue recognition run loader, collect the distinct `schedule.journalId` values from `lines`. Pass them instead of `[run.data.journalId]`.
5. In `getJournalEntryRelatedItems`, change the `"Revenue Recognition"` lookup:
   1. Read `revenueRecognitionSchedule` rows with `journalId = journal.id`.
   2. Embed the run through `runLineId`.
   3. Return each run once.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
```

**Out of scope:** the `MAX_LISTED_JOURNALS` cap on the depreciation page. Keep it.

---

### Task 11: Allow more than one revenue recognition run per period

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/routes/x+/accounting+/revenue-recognition-runs.new.tsx` — the "existing run" check (line 55)
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.repeat.tsx` — the "existing run" check
- Modify: `packages/jobs/src/inngest/functions/scheduled/revenue-recognition-proposal.ts` — the `existing` query
- Modify: `packages/server-functions/src/propose-revenue-recognition-run/index.ts` — `createRevenueRecognitionRunProposal`

**Steps:**
1. In both routes, add `.eq("status", "Draft")` to the existing-run query.
2. If a Draft exists, redirect to that Draft with the flash error: "{runId} is already a draft for this period. Recalculate it instead."
3. In the job, add `.where("status", "=", "Draft")` to the `existing` query. Change the log text to "a draft run for {periodEnd} already exists".
4. In `createRevenueRecognitionRunProposal`, read a Draft for the same `companyId` and `periodEnd` before the insert.
5. If one exists, throw `InvalidInputError` with the same text as step 2. The unique index from Task 5 is the backstop.
6. Add a `databaseTest` in `packages/server-functions/src/recalculate-revenue-recognition-run/recalculate-revenue-recognition-run.test.ts`:
   1. Hold one row in a run with `holdInDraftRun`.
   2. Set that run to `Posted`.
   3. Insert a second due row for the same month.
   4. Call `proposeRevenueRecognitionRun` for the same `periodEnd`.
   5. Expect a second run with 1 line.

**Verify:**
```bash
cd packages/server-functions && SUPABASE_DB_URL="$(grep -h '^SUPABASE_DB_URL' ../../.env.local | cut -d= -f2- | tr -d '"')" pnpm exec vitest run src/recalculate-revenue-recognition-run
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/server-functions
# Expected: every task successful
```

**Out of scope:** depreciation. Its Repeat route already adds a run for the same period.

---

### Task 12: Add Reverse Run for revenue recognition

**Depends on:** Task 9
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — add `reverseRevenueRecognitionRun` and `reverseRunJournals`
- Create: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.reverse.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `reverseRevenueRecognitionRun` after `reverseJournalEntry`
- Modify: `apps/erp/app/modules/accounting/ui/RevenueRecognition/RevenueRecognitionRunHeader.tsx` — a Reverse Run menu item and its Confirm
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts` — the message "Invoice has recognized revenue; reverse the recognition journal first"
- Copy from (precedent): the Reverse menu item and Confirm in `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryHeader.tsx` (lines 91 and 153)

**Steps:**
1. Add `reverseRunJournals(trx, { journalIds, periods, companyId, userId })` to `accounting.server.ts`. For each journal:
   1. Read the journal, its lines and their `journalLineDimension` rows in 3 queries for all journals together.
   2. Insert a Posted journal with `reversalOfId` = the original id and the original `sourceType`.
   3. Use `periods.get(original.postingDate)` for its period and posting date.
   4. Insert the lines with negated `amount`, the same `accountId`, `documentType`, `documentId` and `description`.
   5. Copy each line's dimensions onto its negated line.
   6. Set the original to `status = 'Reversed'` and `reversedById` = the new id.
2. Add `reverseRevenueRecognitionRun(db, { runId, periods, companyId, userId })`. In one transaction:
   1. Lock the run `FOR UPDATE`. Refuse unless it is Posted.
   2. Read the distinct `journalId` values of its schedule rows.
   3. Call `reverseRunJournals`.
   4. Set the run's schedule rows to `status = 'Planned'`, `journalId = null`. Keep `runLineId`.
   5. Set `rentalLeaseScheduleLine.journalId = null` and `postedAt = null` where `journalId` is one of the reversed journals.
   6. Set the run to `status = 'Draft'`, `journalId = null`, `postedAt = null`, `postedBy = null`.
3. In the route, build `periods` for the original posting dates:
   - If the original's period is not Closed, the reversal uses the original posting date.
   - If it is Closed, the reversal uses the company today.
   - Resolve each distinct date with `getOrCreateAccountingPeriod(..., "accounting")`.
4. Require `update: accounting` in the route. On success, redirect to the run with "Reversed {runId}. It is a draft again."
5. In the header, add a destructive Reverse Run menu item for Posted runs. Copy the Confirm from `JournalEntryHeader`. Text: "This will reverse the journals of {runId} and return it to Draft. You can then recalculate, post or delete it."
6. Change the post-sales-invoice message to "Invoice has recognized revenue; reverse its revenue recognition run first".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: every task successful
```

If the `journal_posted_immutable` trigger refuses the `Reversed` update, STOP and report — do not disable the trigger.

**Out of scope:** the generic `reverseJournalEntry`. Task 14 changes it.

---

### Task 13: Add Reverse Run for depreciation

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts` — add `reverseDepreciationRun`
- Create: `apps/erp/app/routes/x+/depreciation-run+/$depreciationRunId.reverse.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `reverseDepreciationRun`
- Modify: `apps/erp/app/modules/accounting/ui/FixedAssets/DepreciationRunHeader.tsx` — a Reverse Run menu item and its Confirm
- Copy from (precedent): the Task 12 route and header item

**Steps:**
1. Add `reverseDepreciationRun(db, { depreciationRunId, periods, companyId, userId })`. In one transaction:
   1. Lock the run `FOR UPDATE`. Refuse unless it is Posted.
   2. If a Posted run has a later `periodEnd`, refuse: "{later run} is posted for a later period and builds on this run. Reverse it first."
   3. Read the lines with their assets.
   4. If any asset is `Disposed`, refuse: "{fixedAssetId} was disposed after this run. Reverse the disposal first."
   5. Collect the distinct `journalId` and `deferredTaxJournalId` values. Call `reverseRunJournals` from Task 12.
   6. Sum the book and tax amounts per asset.
   7. Subtract the sums from `accumulatedDepreciation` and `accumulatedTaxDepreciation`, one update per asset.
   8. If an asset is `Fully Depreciated` and its new net book value is above its residual value, set it to `Active`.
   9. Set every line's `journalId` and `deferredTaxJournalId` to null.
   10. Set the run to `status = 'Draft'`, `postedAt = null`, `postedBy = null`.
2. Build `periods` in the route the same way as Task 12, step 3.
3. Add the header menu item and Confirm the same way as Task 12, step 5.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
```

**Out of scope:** disposal reversal. A disposed asset blocks the reversal; it does not undo the disposal.

---

### Task 14: Refuse generic reversal of run journals

**Depends on:** Tasks 12 and 13
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` — `reverseJournalEntry` (line 6511)
- Modify: `apps/erp/app/routes/x+/journal-entry+/$journalEntryId.reverse.tsx` — show the error message
- Modify: `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryHeader.tsx` — hide Reverse for these source types

**Steps:**
1. In `reverseJournalEntry`, after the Posted check, refuse when `original.data.sourceType` is `"Revenue Recognition"` or `"Asset Depreciation"`.
2. Use the message: "This journal belongs to a {revenue recognition | depreciation} run. Reverse the run instead, so its schedule and assets stay correct."
3. In the reverse route, flash `result.error.message` when it is set.
4. In `JournalEntryHeader`, render the Reverse menu item only when `sourceType` is not one of the 2 types.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 2 successful
```

**Out of scope:** other system source types. They keep the generic reversal.

---

### Task 15: Update AGENTS.md and the fixed-asset rule

**Depends on:** Tasks 1–14
**Files:**
- Modify: `apps/erp/app/modules/accounting/AGENTS.md` — the Revenue recognition paragraph and the functions list
- Modify: `.claude/rules/fixed-asset-lifecycle.md` — `depreciationRunLine`, the routes list, and the "What a run should hold" bullet

**Steps:**
1. Describe D1 to D5 in each file, one or two sentences each.
2. Name the new functions: `resolveRunPostingPeriods`, `reverseRunJournals`, `reverseRevenueRecognitionRun`, `reverseDepreciationRun`.
3. Name the new columns: `depreciationRunLine.periodEnd` and `depreciationRunLine.deferredTaxJournalId`.
4. Name the index `revenueRecognitionRun_one_draft_per_period`.

**Verify:**
```bash
grep -c "reverseDepreciationRun\|deferredTaxJournalId" apps/erp/app/modules/accounting/AGENTS.md .claude/rules/fixed-asset-lifecycle.md
# Expected: at least 1 in each file
```

**Out of scope:** the docs site under `docs/`.

---

### Task 16: Verify in the browser

**Depends on:** Tasks 0–15
**Files:** none

**Steps:**
1. Ask Brad for permission to use the browser on his dev data.
2. Run `/test` with these cases:
   1. A revenue recognition run for a future month refuses with "has not started yet".
   2. Posting a run for a past month leaves the Active period on the current month.
   3. A catch-up depreciation run over 2 months posts 2 journals, each in its own period.
   4. Reverse Run on a posted revenue recognition run returns it to Draft. Its rows are Planned.
   5. Reverse Run on the latest posted depreciation run restores the asset's accumulated depreciation.
   6. A second revenue recognition run for a posted period picks up a newly due row.
   7. The Reverse menu item is absent on a run journal's page.
3. Run `/check-and-commit` with the message `feat(accounting): per-month period runs, reverse run, today-only active period`.

**Verify:**
```bash
# The /test report lists all 7 cases as passed.
```

**Out of scope:** fixing Brad's current RR000002 and December data. Brad decides that after the browser check.

# Part VI — Close wizard run preview

> Was `.ai/plans/2026-10-04-close-wizard-run-preview.md` ("Close wizard asks the runs what is due — implementation plan"), merged here verbatim on 2026-10-07. Decision, question and section numbers in this Part (D1, Q3, §2, Task 4) are its own.

**Spec:** none. Decisions from the conversation of 2026-10-04 (below).
**Builds on:** Part V (Recalculate, more than one run per period).
**Branch:** revenue-recognition-rentals-spec

### Decisions (Brad, 2026-10-04)

| # | Decision |
|---|---|
| E1 | The close checklist asks the run engines what a run would do now, instead of copying their rules. |
| E2 | Revenue recognition: a dry run of the proposal (synthesizers + due rows) in a transaction that always rolls back. |
| E3 | Depreciation: `buildDepreciationRunLines` for the period end — the lines New Run would create. |
| E4 | Each task shows what is due (count and amount), and offers **Create run**. |
| E5 | Never leave an empty run: Create run, New Run and the dry run create nothing when nothing is due. |

Terms:

- **Run preview**: `{ revenue: { count, amount }, depreciation: { count, amount } }` for one period end.
- **Due**: in the preview, or held by a Draft run of the period that is not posted.

### Progress

- [x] Task 1: Add the `preview-revenue-recognition-run` server function
- [x] Task 2: Move `buildDepreciationRunLines` to the service and add `createDepreciationRun`, which refuses an empty run
- [x] Task 3: Add `getPeriodRunPreview` and feed it to the readiness checks
- [x] Task 4: Show what is due and a Create run button on the close page
- [x] Task 5: Update AGENTS.md and the fixed-asset rule
- [x] Task 6: Verify in the browser

### Dependencies

- Task 3 needs Tasks 1 and 2. Task 4 needs Task 3. Tasks 5 and 6 come last.

---

### Task 1: Add the `preview-revenue-recognition-run` server function

**Files:**
- Create: `packages/server-functions/src/preview-revenue-recognition-run/index.ts`
- Modify: `packages/server-functions/src/invoke.ts`, the permissions snapshot
- Create: `packages/server-functions/src/preview-revenue-recognition-run/preview-revenue-recognition-run.test.ts`

**Steps:**
1. Input `{ periodEnd }`. Permissions `{ view: "accounting" }`.
2. In one transaction, run `RUN_ROW_SYNTHESIZERS`, then `selectDueScheduleRows`.
3. Throw a private sentinel at the end of the transaction, so it always rolls back. Catch only that sentinel.
4. Return `{ count, amount }` of the due rows.
5. Test against the local database:
   1. A Planned row due by the period end counts. A row held by a run does not count.
   2. After the preview, the schedule table and the run table have the same rows as before.

**Verify:** `vitest run src/preview-revenue-recognition-run` with the local `SUPABASE_DB_URL` — all pass.

### Task 2: Move `buildDepreciationRunLines` and add `createDepreciationRun`

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts`, `accounting.server.ts`
- Modify: `apps/erp/app/routes/x+/accounting+/depreciation-runs.new.tsx` and every route that imports `buildDepreciationRunLines`

**Steps:**
1. Move `buildDepreciationRunLines` from `accounting.server.ts` to `accounting.service.ts`. It reads only through the Supabase client. Leave no `@mcp` tag.
2. Add `createDepreciationRun(client, { companyId, companyGroupId, periodEnd, userId })` to the service. It builds the lines, returns the error "Nothing to depreciate for this period" when there are none, else calls `insertDepreciationRun`.
3. Use it in the New route. A run with no lines is no longer created.

**Verify:** typecheck `erp`; the accounting tests pass.

### Task 3: Add `getPeriodRunPreview` and feed it to the readiness checks

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts`, `accounting.periods.test.ts`
- Modify: `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx` (loader)

**Steps:**
1. Add `getPeriodRunPreview(client, db, companyId, periodEnd)`. It calls the Task 1 function and `buildDepreciationRunLines`. If a later depreciation run is posted, the depreciation preview is empty: per-month posting already put those months in their periods.
2. Give `computePeriodReadiness` a `runPreview` argument. Delete `countUnaccruedRentalLines` and the contract-revenue count it replaces.
3. `unposted-revenue-schedules` fails when the preview has rows or a Draft run holds a row due by the period end. Its count is both; add `amount`.
4. `draft-depreciation` fails when the preview has lines or a Draft run ends in the period. Its count is the assets due plus the Draft runs; add `amount`.
5. Give the MCP entry points (`getPeriodCloseChecklist`, `getPeriodCloseReadiness`) a `db` argument; they compute the preview. `closeAccountingPeriod` takes an optional preview function so the scripted tests can pass zeros.
6. Replace the scripted rental/contract readiness tests with tests that pass a preview value.

**Verify:** typecheck `erp`; `vitest run app/modules/accounting` — all pass.

### Task 4: Show what is due and a Create run button

**Files:** `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx`; precedent: the existing "Go to … runs" links in the same file.

**Steps:**
1. Under each failing run task, show "N due · $amount".
2. Add a Create run button that posts intent `create-revenue-run` or `create-depreciation-run` with the period end.
3. In the action, create through `propose-revenue-recognition-run` or `createDepreciationRun`. Redirect to the new run. If nothing is due, flash the refusal; never create an empty run.
4. Update both task descriptions to say the check asks the run what it would do.

**Verify:** typecheck `erp`.

### Task 5: Update AGENTS.md and the fixed-asset rule

Name `preview-revenue-recognition-run`, `getPeriodRunPreview`, `createDepreciationRun`, and the new meaning of the two checks.

### Task 6: Verify in the browser

Use the isolated session from `.ai/playbooks/period-runs.md`. Cases:
1. The October close task shows the revenue due and Create run makes a Draft that holds it.
2. A period with nothing due shows the tasks passing.
3. Depreciation shows assets due for a period with no run.
4. Create run with nothing due flashes a refusal and creates no run.
