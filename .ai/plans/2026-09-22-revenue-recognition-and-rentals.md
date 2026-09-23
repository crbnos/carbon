# Revenue Recognition Core + Rental Fleet — implementation plan

**Spec:** .ai/specs/2026-09-22-revenue-recognition-and-rentals.md
**Research:** .ai/research/2026-09-21-sell-vs-rent-rental-revenue-recognition.md
**Branch:** revenue-recognition-rentals-spec (rebase onto `origin/main` first — Task 1)

Four phases, one plan. Phase A (recognition core) and Phase B (fleet bridge + Make to Asset) are independent of each other; Phase C needs both; Phase D needs C. Tasks marked **parallel-safe** touch disjoint files and may run as concurrent subagents.

## Plan-level decisions (fold into the spec changelog at close-out)

1. **New journal source types ship with `defaultEnabled: false`** in `POSTING_POLICY` (`'Revenue Recognition'`, `'Asset Transfer'`, `'Lease'`). The spec says `true`; the codebase precedent (returns types, `packages/ee/src/accounting/core/models.ts:345-377` comment) is that a new journal type never starts pushing to a customer's external ledger unasked. Precedent wins.
2. **Shared pure math lives in `packages/database/supabase/functions/shared/` with NO imports except `./precision.ts`** (calendar math on `YYYY-MM-DD` strings and integers — never JS `Date`), re-exported to Node through `@carbon/utils` exactly like `packages/utils/src/math.ts` re-exports `precision.ts`. Files: `revenue-schedule.ts`, `rental-billing.ts`, `lessor-lease.ts`. One implementation serves the Deno posting functions, the app, and the jobs package.
3. **Kysely writers that both a route and an Inngest job need live in `packages/database/src/`** (`revenue-recognition.ts`, `rental-billing.ts`), exported from `packages/database/package.json` like `./sequence`. `accounting.server.ts` / `sales.server.ts` call them; the jobs package imports them directly. Human-triggered posting (`postRevenueRecognitionRun`) stays in `accounting.server.ts`.
4. **`rentalAgreement.taxPercent`** (NUMERIC NOT NULL DEFAULT 0) is added: the spec says rent lines take "the customer's default" tax, and no such default exists in Carbon.
5. **`rentalAgreementCharge.kind`** (`rentalInvoiceLineKind`, default `'Charge'`) is added so a sales-type purchase option bills as a charge row of kind `'Purchase Option'` rather than a new table.
6. **Close task `sortOrder` = 5** (ties with "Match & eliminate intercompany transactions"; ordering falls back to name). Existing rows are never renumbered.
7. **Job→asset SQL branch**: assets and transfer rows are created right after the job status update with `amount 0`, then priced once the WIP journal exists (the accounting-disabled early `RETURN` sits between the two). With accounting disabled the assets exist at cost 0 — the same posture as registration with accounting off.

## Execution notes (deviations and follow-ups, kept current by /execute)

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
- Task 18 (browser, evidence in `.ai/runs/2026-09-22-revenue-recognition-phase-a.md`): checks 1, 2, 4 pass; 3 and 5 partial. The plan's "six rows of 200.00" was wrong: spec §1 prorates a dated line by days and `spreadStraightLine` does (204.40 / 197.80 / 204.40 / 204.40 / 184.62 / 204.40, Σ 1,200.00), so the schedule is correct as built. `post-sales-invoice` re-stamps `postingDate`/`dateIssued` to today (pre-existing), so a back- or forward-dated invoice cannot be posted as dated from the UI. Closing October was blocked by four seeded Draft documents (environment, not a defect); Lock was exercised and posting into a Locked period works. Follow-ups fixed right after: the runs page had no period-end picker and `getNextPeriodEnd` used JS `Date`; the run page's Source column showed a raw line id; the close task had no "What this task means" text. The observation that `salesInvoice.subtotal`/`totalAmount` read 0 after posting is not a defect: those header columns are legacy (set once at creation), and invoice totals are computed in the `salesInvoices` view since migration `20260604120000`, where both invoices read 500 and 1,200.
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
- Task 46 (browser, evidence in `.ai/runs/2026-09-22-revenue-recognition-phase-c.md`): scenarios re-based to September 2026 (future-dated returns are refused and Deliver stamps today). All accounting checks pass — Calendar Month advance 800.00 (16/30 × 1,500) deferral → run; arrears accrual → invoice consumes it; mileage charge; deposit 3,000 → apply 500 → refund 2,500 (2110 nets 0); 28-day best-rate returns 300 / 1,000 / 1,500 / 2,000; early-return −1,200; holdover; out-of-service return; return-to-inventory refusal; close task; utilization; the line-delete and deposit-FK fixes. Four defects found and fixed in the same pass: agreement create/edit failed (the explicit field list sent `exchangeRate: null` into a NOT NULL DEFAULT column — regression from the self-review fix); reloading `/details` hit a component-less route; the Return form never posted for an operating unit (`isSalesType=""` fails `zfd.checkbox`); a re-cut Arrears period kept its old `dueOn` (`RecutPeriod` now carries it). Not run: the next period's proposal on Oct 1 (date-bound). Environment residue in the dev company: a Draft deposit PAY-…-000004 with no agreement, four blank-serial VEH-100 units in stock.
- Task 56 (browser, evidence in `.ai/runs/2026-09-22-revenue-recognition-phase-d.md`): all runnable checks pass — scenario A (36 × 1,000 arrears, 6 %, option 5,000 certain, fair value 38,000; started 2026-08-01 so month 1 is due): commencement Dr 1160 37,049.24 / Dr 5010 30,000 / Cr 4070 37,049.24 / Cr 1370 30,000, selling profit 7,049.24, 36 schedule lines (185.25 / 814.75 / 36,234.49 … 5,000.00), month-1 invoice Cr 1160 1,000, run posts 185.25 interest, report ties to 1160; scenario B (three 11-month leases ended 2026-08-31): sell to customer with shortfall and excess settlements (1160 nets 0, line Sold), return to fleet and to inventory; classification rules, whole-period refusal, override with audit; the Phase C UI fixes re-confirmed. Fixed from the pass: an Advance lease closing on zero wrote a −0.00001 Interest row (one-unit drift now gets no row); the override's audit comment/doc claimed the entry needs the audit log on (it is always written); the Close dialog now says "returned or sold". Not run: months 2–36 / end-of-term sale of scenario A (date-bound); a non-zero accumulated-depreciation commencement leg (a seeded Draft depreciation run DR000001 blocks depreciation in the dev company). Return to inventory debits the item's own inventory account (1210 for a Buy item), not always Finished Goods as the spec text says.
- Task 31 (browser, re-run on the recreated stack; evidence appended to `.ai/runs/2026-09-22-revenue-recognition-phase-b.md`): (c) CIP postings pass — attach job Dr 1390 / Cr 1230 170, completion sweep 85, PO receipt cost row 6,000, capitalize into Machinery & Equipment Dr 1350 / Cr 1390 6,255, the in-service month's run charges 52.13; (e) out of service passes, including the On Rent refusal; (f) return to inventory Dr 1210 41,440 / Dr 1380 560 / Cr 1370 42,000 passes. Fixed from the pass: editing an asset dropped its work center (the details action's field list omitted `workCenterId`); an Under Construction asset could not be purchased (the PO / purchase invoice asset pickers and the Purchase action were Draft-only, though posting already adds CIP cost rows for it). Follow-up, fixed afterwards: a serial returned to stock was costed FIFO when later sold (`shared/calculate-cogs.ts` took the oldest layers, not the shipped serial's). `costLedger.trackedEntityId` (migration `20260923223639`) now stamps the layer `bookAdjustment` books for a serial unit, and `calculateCOGS` relieves the leaving unit's own layer first (`shared/cost-layer-order.ts`); callers pass the serial ids from `bookAdjustment`, `post-shipment` and `issue`. Receipt and job-output layers stay unstamped (many units per layer).

## Progress
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

## Dependencies
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

# Phase A — Recognition core

## Task 1: Rebase onto main and prove the baseline is green

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

## Task 2: Migration — revenue recognition enums

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

## Task 3: Migration — revenue recognition core

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

## Task 4: Apply migrations and regenerate types

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

## Task 5: Seeds for new companies

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

## Task 6: `spreadStraightLine` — shared straight-line schedule math

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

## Task 7: Six new account-default mappings

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

## Task 8: `revenueRecognitionEnabled` company setting toggle

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

## Task 9: Service dates on sales order and sales invoice lines

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

## Task 10: `post-sales-invoice` deferral branch + VOID guard

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

## Task 11: Run/schedule validators and read services

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

## Task 12: Run proposal builder + posting/deletion

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

## Task 13: Recognition run routes, UI, paths, sidebar

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

## Task 14: Close-checklist evaluator `unposted-revenue-schedules`

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

## Task 15: Inngest monthly run proposal

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

## Task 16: `POSTING_POLICY` entry for `'Revenue Recognition'`

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

## Task 17: Deferred revenue waterfall report

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

## Task 18: Phase A browser verification

**Depends on:** 5, 7, 8, 9, 10, 13, 14, 15, 16, 17
**Files:** none

**Steps:**
1. `crbn up` (plain, portless); invoke `/auth` then `/test` with this script:
   - Accounting settings: enable accounting (if off) and the new revenue-recognition toggle; Account Defaults shows the six new mappings prefilled.
   - Flag OFF first: post a Service invoice with no service dates → journal credits Sales (4010). Flag ON: post a Service line $1,200.00 with service 2026-10-01 → 2027-03-31 dated 2026-10-05 → journal Dr AR 1,200 / Cr Deferred Revenue 1,200; six Planned rows of 200.00 visible in the waterfall.
   - New recognition run for period end 2026-10-31 → one Deferral line 200.00; Post → journal `Revenue Recognition` Dr 2160 200 / Cr 4010 200; run Posted; a second run for the same period is refused / empty.
   - Lock October → posting a run still works; Close October → posting fails with the period error.
   - Period close checklist for October shows "Recognize revenue for the period" failing before the run posts and passing after.
2. Record evidence in `.ai/runs/2026-09-22-revenue-recognition-phase-a.md`.

**Verify:**
```bash
ls .ai/runs/2026-09-22-revenue-recognition-phase-a.md
# Expected: file exists with the five checks marked pass
```

**Out of scope:** rentals.

---

# Phase B — Fleet bridge + Make to Asset

## Task 19: Migration — asset transfer enums

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

## Task 20: Migration — fleet bridge

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

## Task 21: Apply migrations, regenerate types, `POSTING_POLICY` `'Asset Transfer'`

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

## Task 22: Seeds for new companies

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

## Task 23: Shared asset-transfer line builders + safe document types

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

## Task 24: Edge function `post-asset-transfer`

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

## Task 25: `complete_job_to_inventory` job→asset branch + SQL test

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

## Task 26: CIP awareness in `post-receipt` / `post-purchase-invoice`

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

## Task 27: Job target — model, form, complete dialog, release gate

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

## Task 28: Fleet validators/services; CIP-class registration; status badge

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

## Task 29: Fleet routes and UI

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

## Task 30: Phase B docs, rules, AGENTS

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

## Task 31: Phase B browser verification

**Depends on:** 30
**Files:** none

**Steps:**
1. `/auth` then `/test`: (a) create a serialized item VEH-100, a job for 2 units with Complete to = Rental Fleet, run its operations, Complete → two Active assets at the WIP cost, VEH-100 on-hand unchanged, tracked entities Consumed with the Fixed Asset attribute, journal `Asset Transfer`; (b) capitalize a stocked serial from the item inventory page → Dr 1370 / Cr 1220 at carrying cost, on-hand −1, inventory tie-out unchanged; (c) CIP: asset W-1 in the CIP class, attach an in-progress job (WIP 2,500) → Dr 1390 / Cr 1230 2,500 and a cost row; complete the job → second row; Fixed Asset PO line 6,000 invoiced → third row; Capitalize to Machinery & Equipment in-service 2026-11-01 → Dr 1350 / Cr 1390 10,000, Active, excluded from the October run, 83.33 in November; (d) link W-1 to a work center → capital-cost section shows it; (e) take VIN-001 out of service → `In Maintenance`, still depreciates, Return to service → Available; (f) Return VIN-001 to inventory at NBV → Dr 1220 / Dr 1380 / Cr 1370, entity Available, sell it on a normal sales order → revenue + COGS at NBV.
2. Evidence in `.ai/runs/2026-09-22-revenue-recognition-phase-b.md`.

**Verify:**
```bash
ls .ai/runs/2026-09-22-revenue-recognition-phase-b.md
# Expected: file exists with (a)–(f) marked pass
```

**Out of scope:** rentals.

---

# Phase C — Rental agreements (operating)

## Task 32: Migration — rental enums

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

## Task 33: Migration — rental tables, invoice/payment columns, view, sequence, lease settings

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

## Task 34: Apply migrations and regenerate types

**Depends on:** 33
**Files:** `packages/database/src/types.ts` (generated)

**Verify:**
```bash
pnpm db:migrate && pnpm run generate:types && pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0; types contain rentalAgreement, rentalBillingPeriod, rentalInvoiceLineKind
```

**Out of scope:** app code.

## Task 35: Seeds for new companies (rental sequence)

**Depends on:** 34 (parallel-safe)
**Files:**
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` — `sequences` gains `{ table: "rentalAgreement", name: "Rental Agreement", prefix: "RA", suffix: null, next: 0, size: 6, step: 1 }`

**Verify:**
```bash
pnpm db:check:datasets
# Expected: exit 0
```

**Out of scope:** existing companies (Task 33).

## Task 36: Shared rental billing math + validators

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

## Task 37: Rental CRUD services + invoice generation

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

## Task 38: Edge function `post-rental-agreement`

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

## Task 39: `post-sales-invoice` `Rental` case + VOID

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

## Task 40: Accrual synthesis in the run + evaluator extension

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

## Task 41: Customer deposits in `post-payment`

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

## Task 42: Inngest daily rental billing

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

## Task 43: Rental agreement routes and UI, item rate ladder, invoice line display

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

## Task 44: Utilization report

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

## Task 45: Phase C docs, rules, AGENTS

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

## Task 46: Phase C browser verification

**Depends on:** 45
**Files:** none

**Steps:**
1. `/auth` then `/test` the spec's Phase C acceptance criteria in order: rate ladder on VEH-100; RA-000001 Calendar Month Advance (822.58 first period, deferral, October run releases it, November 1,500 proposed once); the Arrears twin (accrual in October, invoice consumes it); a 120.00 mileage charge; deposit 3,000 → apply 500 → refund 2,500 (2110 nets to 0); 28 Days Best Rate returns after 3 / 10 / 20 / 35 days (300 / 1,000 Week / 1,500 Month / 2,000); Advance early return on day 3 → −1,200 credit line posting Dr 2160 / Cr AR and the Planned row at 300; return on day 20 → no adjustment; holdover past the end date; return with out-of-service ticked → `In Maintenance`; Return to inventory blocked while on rent; close checklist fails on an un-accrued month and passes after the run; utilization report numbers for Q4.
2. Evidence in `.ai/runs/2026-09-22-revenue-recognition-phase-c.md`.

**Verify:**
```bash
ls .ai/runs/2026-09-22-revenue-recognition-phase-c.md
# Expected: exists with every check marked pass
```

**Out of scope:** sales-type.

---

# Phase D — Sales-type leases

## Task 47: Migration — `'Lease'` source type

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

## Task 48: Migration — lessor schedule table

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

## Task 49: Apply migrations, regenerate types, `POSTING_POLICY` `'Lease'`, audit config

**Depends on:** 48
**Files:**
- Modify: `packages/database/src/types.ts` (generated); `packages/ee/src/accounting/core/models.ts` (`"Lease": { representation: "journal", defaultEnabled: false, defaultGranularity: "individual" }`); `packages/database/src/audit.config.ts` — register `rentalAgreementLine` as an auditable table / entity type so `insertAuditLogEntries` accepts it (copy the shape of an existing sales table entry)

**Verify:**
```bash
pnpm db:migrate && pnpm run generate:types && pnpm exec turbo run typecheck --filter=@carbon/database && pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** UI.

## Task 50: Shared lessor math + tests

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

## Task 51: Activation classification + commencement posting + override route

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

## Task 52: `post-sales-invoice` sales-type legs; run stamps schedule lines

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

## Task 53: End of term — purchase option and residual return

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

## Task 54: Net investment report, classification UI, lease policy settings

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

## Task 55: Phase D docs, rules, AGENTS

**Depends on:** 53, 54
**Files:**
- Modify: `docs/content/docs/reference/rental-agreements.mdx` (classification, sales-type commencement, purchase option, residual return), `apps/erp/app/modules/sales/AGENTS.md`, `apps/erp/app/modules/accounting/AGENTS.md` (`rentalLeaseScheduleLine`, net investment report), `.claude/rules/accounting-sync-handlers.md` (`'Lease'` policy), glossary terms `sales-type-lease`, `net-investment-in-leases`, `purchase-option`
- Modify: `.ai/specs/2026-09-22-revenue-recognition-and-rentals.md` changelog — record the plan-level decisions 1–7 and any deviation found during execution; move to `.ai/specs/implemented/` only after Task 56 passes

**Verify:**
```bash
pnpm --filter docs build 2>&1 | tail -3
# Expected: build succeeds
```

**Out of scope:** #1056 lessee docs.

## Task 56: Self-review and Phase D browser verification

**Depends on:** 55
**Files:** none

**Steps:**
1. `/auth` then `/test`: RA-000002 per the spec's Sales-type AC (36 × 1,000 Arrears, option 5,000 reasonably certain, fair value 38,000, life 120, 6 %, unit from stock at 30,000): activation journal Dr 1160 37,049.24 / Dr 5010 30,000.00 / Cr 4070 37,049.24 / Cr 1220 30,000.00, `sellingProfit` 7,049.24, entity Consumed with Rental Agreement + Customer attributes, 36 schedule lines (month 1 = 185.25 / 814.75 / 36,234.49); October run posts Dr 1160 185.25 / Cr 4150 185.25; the month-1 invoice posts Dr AR 1,000 / Cr 1160 1,000; after payment 36 the closing balance is 5,000.00 ± 0.01; Sell to customer bills 5,000.00 → Dr AR / Cr 1160 → NI 0.00, line Sold. Classification AC: option not certain + fair value 60,000 → Operating; open-ended → Operating; option-certain without `endDate` rejected; override needs a reason and writes an audit entry. Net investment report ties to the 1160 balance.
2. Run `/self-review` on the branch; fix Must-fix items; run every verification command in this plan once more; `pnpm db:check:datasets && pnpm db:check:backups`.
3. Evidence in `.ai/runs/2026-09-22-revenue-recognition-phase-d.md`.

**Verify:**
```bash
ls .ai/runs/2026-09-22-revenue-recognition-phase-d.md && pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: file exists with every check marked pass; exit 0 twice
```

**Out of scope:** everything listed as out of scope in the spec's §0.
