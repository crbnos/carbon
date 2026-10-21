# Project contracts — implementation plan

**Spec:** .ai/specs/2026-10-21-project-contracts.md
**Research:** .ai/research/project-billing-onboarding-ux.md
**Closest sibling:** the service contract (same record, `x+/contract+/`, `apps/erp/app/modules/sales/ui/Contracts/`)
**Branch:** projects-wbs-research-spec

## Progress

- [x] Task 1: Add the `billingBasis` column and recreate the `customerContracts` view
- [x] Task 2: Add the basis helpers and validator rules
- [x] Task 3: Make the sales services and the server function basis-aware
- [x] Task 4: Test, and fix if it fails, Confirm of a Fixed Percent Complete line
- [ ] Task 5: Split the list and the nav into Service Contracts and Project Contracts
- [ ] Task 6: Create a project contract and give it its own Details step
- [ ] Task 7: Give a project contract its own Lines step and line drawer
- [ ] Task 8: Make the Invoicing step basis-aware, with Fixed Price billing events
- [ ] Task 9: Add the project contract gaps to the Review step
- [ ] Task 10: Make the contract page basis-aware
- [ ] Task 11: Keep service order coverage on service contracts
- [ ] Task 12: Show the Billing page for every Contract project
- [ ] Task 13: Add the Contract card and the Needs attention rows to the Overview
- [ ] Task 14: Show Approvals while billable items wait
- [ ] Task 15: Apply the canonical labels, the helper text and the glossary
- [ ] Task 16: Add the Journal card to the Draft revenue run
- [ ] Task 17: Write the "Project to cash" guide and update the reference pages
- [ ] Task 18: Update the rules and AGENTS files
- [ ] Task 19: Fill the translations
- [ ] Task 20: Verify in the browser

## Dependencies

- Task 2 needs Task 1 (types). Tasks 3 and 4 need Task 2.
- Tasks 5 to 11 need Task 3. Tasks 6 to 10 run in order (they share `$id.setup.tsx` and `ContractLineForm.tsx`).
- Tasks 12, 13 and 14 need Task 3. They share `$projectId.tsx`, so they run in order.
- Tasks 15 and 16 are independent of Tasks 5 to 14 (different files), except Task 15's label edits in `ContractProjectBilling.tsx` and `ProjectBillingLines.tsx`, which run after Tasks 10 and 12.
- Task 17 and Task 18 run after the code tasks. Task 19 and Task 20 run last.

## Rules for every task

1. Read `.claude/skills/carbon-design/SKILL.md` before a UI task. Copy the named precedent file; do not invent a layout.
2. Keep the UI style of the branch: one toolbar row, at most one primary action, no input boxes in a table, `Empty` (`~/components/Empty.tsx`) for empty states, `bordered` on every `Boolean`, `termId` on domain terms, Lingui `t`/`<Trans>` for every string, `<Plural>` for counts.
3. Never use JavaScript `Date`. Use `@internationalized/date` and `formatDate`.
4. New source files start with the SPDX header. Run `pnpm --filter @carbon/checks license-headers`.
5. Commit each task through `/check-and-commit`. Before a commit that touches `packages/database`, load the worktree database URL: `set -a; . <(grep -E '^SUPABASE_' .env.local); set +a`.
6. If an assumption in a task turns out false, STOP and report — do not improvise.

The code gate after every code task:

```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0, no "error TS" line.
pnpm exec biome check --no-errors-on-unmatched <changed files>
# Expected: exit code 0.
```

---

## Task 1: Add the `billingBasis` column and recreate the `customerContracts` view

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_contract-billing-basis.sql` (with `pnpm db:migrate:new contract-billing-basis`)
- Modify: generated types (`pnpm run generate:types`)
- Copy from (precedent): the view body in `packages/database/supabase/migrations/20261006221301_contracts.sql` (`CREATE OR REPLACE VIEW "customerContracts"`, near line 372)

**Steps:**
1. Run `pnpm db:migrate:new contract-billing-basis`.
2. Write the enum with a `duplicate_object` guard, the column `"billingBasis" "contractBillingBasis" NOT NULL DEFAULT 'Schedule'` with `ADD COLUMN IF NOT EXISTS`, and the backfill `UPDATE` from the spec's Data Model section.
3. Find the newest definition of `customerContracts`: `grep -l '"customerContracts"' packages/database/supabase/migrations/*.sql`. Copy its body exactly.
4. Write `DROP VIEW IF EXISTS "customerContracts";` then the copied `CREATE VIEW` with `WITH (SECURITY_INVOKER=true)` as the original has it.
5. Add `COMMENT ON COLUMN "customerContract"."billingBasis" IS 'Schedule: a service contract billed on its invoice schedule. Project: a project contract billed from project cost and billing events.';`
6. Load the worktree env and apply: `set -a; . <(grep -E '^SUPABASE_' .env.local); set +a; pnpm db:migrate`.
7. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -n "billingBasis" packages/database/src/types.ts | head -5
# Expected: the column on customerContract Row/Insert/Update and on the customerContracts view.
grep -n "contractBillingBasis" packages/database/src/types.ts | head -2
# Expected: the enum with "Schedule" | "Project".
```

**Out of scope:** any change to `customerContractLine`.

## Task 2: Add the basis helpers and validator rules

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/contract-schedule.ts` — add `ContractBillingBasis`, `contractBillingBasisFor(lines)`, `billingBasisMismatch(basis, line)`
- Modify: `packages/database/src/contract-schedule.test.ts` (create if absent) — tests
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `contractBillingBases`, `billingBasis` on `customerContractValidator`, project rules in `checkBillingTerms`
- Modify: `apps/erp/app/modules/sales/sales.models.test.ts` — tests

**Steps:**
1. In `contract-schedule.ts`, export `type ContractBillingBasis = "Schedule" | "Project"`.
2. Export `billingBasisMismatch(basis, line: { billingMethod: string; revenueType: string }): "billing-line-on-schedule" | "recurring-line-on-project" | null`. A `Schedule` contract refuses a non-`Fixed` method. A `Project` contract refuses `revenueType === "Recurring"`.
3. Write tests for the four cases (two refusals, two passes).
4. In `sales.models.ts`, export `contractBillingBases = ["Schedule", "Project"] as const`.
5. Add `billingBasis: z.enum(contractBillingBases).optional()` to `customerContractValidator`.
6. Make `duration`, `renewal`, `billingFrequency`, `billingAlignment` and `billingTiming` optional when `billingBasis === "Project"`. Use the validator's existing refine style. A `Project` contract requires `projectId` and `endDate`.
7. Export `projectContractTermDefaults = { billingFrequency: "Month", billingAlignment: "Calendar", billingTiming: "Arrears", renewal: "End" }`. Check these values against the enum arrays in the same file first.
8. Export `contractBillingMethodsFor(basis)`: `Schedule` → `["Fixed"]`; `Project` → all three.
9. Add tests in `sales.models.test.ts`: a Project contract parses with no duration and no renewal; a Project contract without `projectId` fails; `contractBillingMethodsFor` returns the right lists.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/contract-schedule.test.ts
# Expected: all tests pass.
cd apps/erp && pnpm exec vitest run app/modules/sales/sales.models.test.ts
# Expected: all tests pass.
```

**Out of scope:** UI.

## Task 3: Make the sales services and the server function basis-aware

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `getContracts` (near line 9759), `customerContractTerms` (near line 9931), `upsertContractLine` (near line 10265), `insertContractLines` (near line 10932)
- Modify: `apps/erp/app/routes/x+/contract+/update.tsx` — carry `billingBasis` when it rebuilds the payload (near line 280)
- Modify: `packages/server-functions/src/post-customer-contract/index.ts` — confirm (near line 575) and amend (near line 1536)

**Steps:**
1. `getContracts(client, companyId, args)`: accept `billingBasis?: ContractBillingBasis`. When set, add `.eq("billingBasis", billingBasis)`.
2. `customerContractTerms`: carry `billingBasis` with a conditional spread, as `contractType` is carried. Never write null into it.
3. `upsertContractLine` and `insertContractLines`: read the contract's `billingBasis`. Return `{ data: null, error: { message } }` when `billingBasisMismatch` refuses. Messages: "A service contract bills on its schedule. Create a project contract for Time & Materials or Cost Plus lines." and "A project contract line is One-time. Create a service contract for recurring charges."
4. In `upsertContractLine`, when the contract is `Project` and the method is `Fixed`, force `quantity` 1 and `revenueType` "One-time" (as the existing billing-line branch forces quantity 1 and rate 0).
5. `update.tsx`: include `billingBasis` from the stored contract in the rebuilt payload.
6. `post-customer-contract`: select `billingBasis` with the contract in confirm and amend. Refuse each line `billingBasisMismatch` flags with an `InvalidInputError` that names the line and the reason (same messages as step 3).
7. Run `pnpm generate:mcp`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: exit code 0.
pnpm --silent check:manifest
# Expected: "digest current".
```

**Out of scope:** the schedule planner, the revenue planner, invoicing.

## Task 4: Test, and fix if it fails, Confirm of a Fixed Percent Complete line

**Depends on:** Task 3
**Files:**
- Modify: `packages/server-functions/src/post-customer-contract/contract-lifecycle.test.ts`
- Modify (only if the test fails): `packages/server-functions/src/post-customer-contract/index.ts` (`refuseRevenueResiduals`, near line 743), `apps/erp/app/routes/x+/contract+/$id.tsx` (`revenueResiduals`, near line 338)

**Steps:**
1. Read the existing tests and the `local-database-test-fixture` they use.
2. Add a test: a Draft project contract (`billingBasis` Project) on a Contract project with a billing element, one Fixed line (quantity 1, rate 90000, One-time, revenue method Percent Complete). Confirm it. Expect status Active.
3. Run it. If it passes, skip steps 4 and 5 and record "no bug" in the plan's Execution notes.
4. If it fails on the revenue residual, skip lines whose revenue method is a progress method (`isProgressRevenueMethod`, `@carbon/database/contract-revenue-schedule`) in `refuseRevenueResiduals`. They have no planned revenue rows by design.
5. Apply the same skip to `revenueResiduals` in `$id.tsx`.

**Verify:**
```bash
set -a; . <(grep -E '^SUPABASE_' .env.local); set +a
pnpm --filter @carbon/server-functions exec vitest run src/post-customer-contract/contract-lifecycle.test.ts
# Expected: all tests pass, the new one included.
```

**Out of scope:** the Percent Complete synthesizer in `packages/ee`.

## Task 5: Split the list and the nav into Service Contracts and Project Contracts

**Depends on:** Task 3
**Files:**
- Create: `apps/erp/app/routes/x+/sales+/project-contracts.tsx`
- Modify: `apps/erp/app/routes/x+/sales+/contracts.tsx` — filter `Schedule`, breadcrumb "Service Contracts"
- Modify: `apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx` — two entries
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractsTable.tsx` — a `billingBasis` prop for the title and the New link
- Modify: `apps/erp/app/utils/path.ts` — `projectContracts`, `newProjectContract`
- Copy from (precedent): `apps/erp/app/routes/x+/sales+/contracts.tsx`

**Steps:**
1. Add `path.to.projectContracts` (`${x}/sales/project-contracts`) and `path.to.newProjectContract` (`${x}/contract/new?basis=Project`). Add `newProjectContractForProject(projectId)` returning the same URL with `&projectId=`.
2. Copy `contracts.tsx` to `project-contracts.tsx`. Pass `billingBasis: "Project"` to `getContracts`. Breadcrumb "Project Contracts".
3. In `contracts.tsx`, pass `billingBasis: "Schedule"`. Breadcrumb "Service Contracts".
4. `ContractsTable`: take `billingBasis`. Title "Service Contracts" or "Project Contracts". The New button links `path.to.newContract` or `path.to.newProjectContract`. For `Project`, hide the columns that a project contract does not fill (Next Invoice) and show "Funded" in place of "Value" when the view exposes no funded column — if no funded column exists, hide Value for `Project`.
5. `useSalesSubmodules`: in Agreements, "Service Contracts" (`path.to.contracts`), then "Project Contracts" (`path.to.projectContracts`, icon `LuFolderKanban` or the projects module icon), then Rental Agreements.

**Verify:** the code gate. Then:
```bash
grep -n "Project Contracts" apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx
# Expected: one match.
```

**Out of scope:** the contract page.

## Task 6: Create a project contract and give it its own Details step

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/routes/x+/contract+/new.tsx` — read `?basis=` and `?projectId=`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ProjectContractDetailsForm.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractSetupSteps.tsx` — `projectContractSetupSteps`, a `billingBasis` prop, label "Lines" for `products`
- Modify: `apps/erp/app/routes/x+/contract+/$id.setup.tsx` — steps by basis
- Modify: `apps/erp/app/routes/x+/contract+/$id.setup.details.tsx` — render the project form for `Project`
- Modify: `apps/erp/app/modules/sales/ui/Contracts/index.ts` — export
- Copy from (precedent): `ContractDetailsForm.tsx`

**Steps:**
1. `new.tsx` loader: read `basis` (default `Schedule`) and `projectId`. Pass them to the component.
2. `new.tsx` action: when `billingBasis` is `Project`, insert with `projectContractTermDefaults`, `termMonths` null and `billingBasis: "Project"`. Redirect to `path.to.contractSetup(id, "products")`, as today.
3. Copy `ContractDetailsForm.tsx` to `ProjectContractDetailsForm.tsx`. Keep: customer, name, contract number (`customerReference`, label "Contract Number"), project (required, `ContractProject` picker filtered to Contract projects if the picker supports it), Start Date and End Date (label group "Period of Performance"), salesperson, close date, notes. Remove: type, duration, renewal, uplift. Carry the project defaults as hidden fields, as `CARRIED_TERMS` does.
4. `ContractSetupSteps`: export `projectContractSetupSteps = ["details", "products", "invoicing", "review"] as const`. Take `billingBasis`; choose the steps and the `products` label ("Services" or "Lines").
5. `$id.setup.tsx`: read the contract's `billingBasis` from the loader. Use the matching step list for Back and Next. A `Project` contract that opens `setup/revenue` redirects to `setup/review`.
6. `$id.setup.details.tsx`: render `ProjectContractDetailsForm` for `Project`.

**Verify:** the code gate.

**Out of scope:** the Lines step.

## Task 7: Give a project contract its own Lines step and line drawer

**Depends on:** Task 6
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Contracts/ProjectContractLinesGrid.tsx`
- Modify: `apps/erp/app/routes/x+/contract+/$id.setup.products.tsx` — render the grid by basis
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractLineForm.tsx` — basis-aware fields
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractAmendModal.tsx` — billing method only for `Project`
- Modify: `apps/erp/app/routes/x+/contract+/$id.lines.new.tsx` (and `$id.$lineId.details.tsx` if it renders `ContractLineForm`) — pass the basis
- Copy from (precedent): `ContractProductsGrid.tsx` (grid, `useCellSave`, Add button)

**Steps:**
1. Copy `ContractProductsGrid.tsx` to `ProjectContractLinesGrid.tsx`. Columns: CLIN (`lineItemNumber`), Description, Billing Method (label "Fixed Price" for `Fixed`), Billing Element, Funded (`fundedAmount`), Ceiling (`ceilingAmount`), Fee/Handling (`feePercent` for Cost Plus, `materialHandlingPercent` for T&M), Price (`rate`, Fixed only), Revenue (`revenueMethod`). Editable cells post to the same `$lineId.update` route the services grid uses. Cells that do not apply to the row's method render "—" and are not editable.
2. "Add Line" opens `$id.lines.new` (the line drawer), as the services grid's Add opens its modal. With no lines, show `Empty` "No lines yet" with the Add button.
3. `ContractLineForm`: take `billingBasis`. For `Schedule`, hide the Billing Method select (always `Fixed`). For `Project`, hide Revenue Type, Quantity, Per, Discount, Discount Ends, Go-Live; show Price (`rate`) only for Fixed; offer revenue methods from `contractRevenueMethodsByBillingMethod`, limited for Fixed to Percent Complete and Daily.
4. `ContractAmendModal`: show the billing method select only on a `Project` contract.
5. `$id.setup.products.tsx`: render `ProjectContractLinesGrid` for `Project`, else `ContractProductsGrid`.

**Verify:** the code gate.

**Out of scope:** the line Billing page (`ContractLineBilling.tsx`), which stays as it is.

## Task 8: Make the Invoicing step basis-aware, with Fixed Price billing events

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/routes/x+/contract+/$id.setup.invoicing.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractBillTo.tsx`
- Modify (if it needs a line filter prop): `apps/erp/app/modules/sales/ui/Contracts/ContractInvoiceGrid.tsx`

**Steps:**
1. `ContractBillTo`: take `billingBasis`. For `Project`, show bill-to, contact, address, ship-to, payment terms, invoicing mode and one "Billing Period" select (`billingFrequency`). Hide first invoice, timing, alignment, billed through and recognize-from.
2. `$id.setup.invoicing.tsx`: for `Project`, render the grid only when a Fixed line exists. Pass only the Fixed lines' rows. Title "Billing Events". Description: "Each row is an invoice for a Fixed Price line. Add, split or move rows until each line's rows add up to its price."
3. With no Fixed line, show one sentence: "Time & Materials and Cost Plus lines bill from project cost every billing period."

**Verify:** the code gate.

**Out of scope:** the schedule writers in `post-customer-contract`.

## Task 9: Add the project contract gaps to the Review step

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `projectContractGaps(input)` (pure)
- Modify: `apps/erp/app/modules/sales/sales.models.test.ts` — tests
- Modify: `apps/erp/app/routes/x+/contract+/$id.setup.review.tsx` — loader reads, render
- Copy from (precedent): the "Before You Confirm" gap list in `$id.setup.review.tsx` (near lines 71–110)

**Steps:**
1. Write `projectContractGaps({ lines, project, billingElementIds, baseCurrency, currencyCode, scheduleTotalsByLine, laborCategoriesWithoutBillRate, emptyAccountDefaults })`. Return `{ key, blocking, lineId? }[]` for the eight gaps in spec section 5.
2. Test each gap once, and a clean contract with no gap.
3. Loader: for `Project`, read the project (cost treatment), the billing elements (`getProjectBillingElements`), the labor categories with rates (`getLaborCategories`), the line labor rates, and the account defaults (`getDefaultAccounts`; an error or no row counts as "unknown", never as a gap).
4. Render each gap as a row with its fix link, in the precedent's markup. Blocking gaps keep Confirm disabled; the others are warnings.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/sales/sales.models.test.ts
# Expected: all tests pass.
```
Then the code gate.

**Out of scope:** the service contract's gaps.

## Task 10: Make the contract page basis-aware

**Depends on:** Task 9
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractProperties.tsx` — hide Term and Invoicing subscription fields for `Project`; show Billing Period and Period of Performance
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractHeader.tsx` — breadcrumb list by basis
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractSummary.tsx` — "Funded" (Σ line `fundedAmount` + Fixed prices) in place of "Contract value" for `Project`
- Modify: `apps/erp/app/routes/x+/contract+/$id.details.tsx` — Project Billing card first for `Project`
- Modify: `apps/erp/app/routes/x+/contract+/$id.invoice.tsx` and `apps/erp/app/modules/sales/sales.server.ts` (`generateContractInvoicesNow`) — also draft project billing invoices for `Project`

**Steps:**
1. `ContractProperties`: branch on `billingBasis` as above.
2. `ContractSummary`: for `Project`, label "Funded" and sum the funded amounts and Fixed prices.
3. `$id.details.tsx`: for `Project`, render Project Billing before Invoices.
4. Read `packages/server-functions/src/create-project-billing-invoices/index.ts`. If its input can be scoped to one contract (a `contractId` or `customerContractId` field), call it from `generateContractInvoicesNow` for a `Project` contract after `create-contract-invoices`. If it cannot be scoped without an engine change, STOP this step and record it in Execution notes.

**Verify:** the code gate.

**Out of scope:** amend and cancel modals beyond Task 7.

## Task 11: Keep service order coverage on service contracts

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/service/service.server.ts` — `createServiceOrder` contract lookup (near line 196), `updateServiceOrderCoverageContract` (near line 773)
- Modify: `apps/erp/app/modules/service/service.service.ts` — `getServiceOrderFormOptions` (near line 388)

**Steps:**
1. Add `.eq("billingBasis", "Schedule")` to each contract read (Kysely: `.where("billingBasis", "=", "Schedule")`).
2. In `updateServiceOrderCoverageContract`, refuse a contract whose basis is `Project` with "A project contract cannot cover a service order."

**Verify:** the code gate.

**Out of scope:** service invoicing.

## Task 12: Show the Billing page for every Contract project

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId.tsx` — `showBilling`, `projectContract`
- Modify: `apps/erp/app/modules/projects/ui/Project/useProjectNavigation.tsx` and `ProjectSidebar.tsx` — use `showBilling`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.billing.tsx` and `apps/erp/app/modules/projects/ui/Billing/ProjectBillingLines.tsx` — empty state with CTA, contract header row

**Steps:**
1. In `$projectId.tsx`, return `showBilling: project.costTreatment === "Contract"` and keep `hasBillingLines`.
2. Also read the project's project contracts: `customerContract` with `projectId`, `billingBasis = 'Project'`, status not Cancelled, `id, customerContractId, name, status`. Return them as `projectContracts`.
3. The sidebar shows Billing when `showBilling` and the user can view sales.
4. `$projectId.billing.tsx`: with no project contract, render `Empty` "No project contract bills this project" with the description "A project contract sets how this project bills: Time & Materials, Cost Plus or Fixed Price." and a "New Project Contract" button to `path.to.newProjectContractForProject(projectId)` (needs `create: sales`).
5. With a contract, show a one-line header above the lines: the contract id and name (linked to `path.to.contract`), its status badge (`ContractStatus`).
6. Replace the plain `<p>` empty text in `ProjectBillingLines` with `Empty`.

**Verify:** the code gate.

**Out of scope:** the Overview.

## Task 13: Add the Contract card and the Needs attention rows to the Overview

**Depends on:** Task 12
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId._index.tsx` — contract figures
- Modify: `apps/erp/app/modules/projects/ui/Project/ProjectOverview.tsx` — `ContractCard`, new attention rows
- Copy from (precedent): `BudgetCard` and `AttentionRow` in `ProjectOverview.tsx`; `FundingBar` (`compact`) from `~/modules/sales`

**Steps:**
1. Loader: for a Contract project with an Active project contract, read its non-Fixed lines (`getContractBillingLines`), `getContractLineFunding` for them (as `$projectId.billing.tsx` does), and `getProjectContractRevenue`. Sum funded, billed, unbilled, incurred and revenue. Also count billable items Unbilled or On Hold for the project.
2. `ContractCard`: title "Contract", action link "View contract". Body: `FundingBar` compact, then a row of five figures: Funded, Cost, Billed, Unbilled, Revenue (`useCurrencyFormatter`). Render it under `BudgetCard`.
3. Attention rows for a Contract project: "No project contract bills this project" (link Billing), "Project contract {id} is not confirmed" (link the contract setup), and `<Plural>` "# billable item waits for review" (link `path.to.projectsApprovals` with `?tab=billing`). Use icons from `react-icons/lu`.

**Verify:** the code gate.

**Out of scope:** the Budget card.

## Task 14: Show Approvals while billable items wait

**Depends on:** Task 13
**Files:**
- Modify: `apps/erp/app/routes/x+/projects+/_layout.tsx` — `billingReviewCount`
- Modify: `apps/erp/app/modules/projects/ui/useProjectsSubmodules.tsx` — visibility and count

**Steps:**
1. Loader: when the user can update projects and view sales, count `projectBillableItem` rows with `customerContractLineId` not null and status in Unbilled, On Hold (`count: "exact", head: true`). Return `billingReviewCount`.
2. `showApprovals` is also true when `billingReviewCount > 0`. The count badge adds it.

**Verify:** the code gate.

**Out of scope:** the Approvals page.

## Task 15: Apply the canonical labels, the helper text and the glossary

**Depends on:** Tasks 10 and 12
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Billing/ProjectBillingLines.tsx` — "Complete" → "Progress", "Recognized" → "Revenue"
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractProjectBilling.tsx` — "Revenue Recognized" → "Revenue"
- Modify: `apps/erp/app/modules/sales/ui/Contracts/FundingBar.tsx` — "Funded Amount" → "Funded", "Cost Incurred" → "Cost"
- Modify: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx` — Project WIP and Contract Assets helper text
- Modify: `docs/content/src/glossary/terms.ts` — fix `revenue-method`, `account-default-contract-assets`; add 7 entries
- Modify: `ContractLineBillingFields.tsx`, `ProjectContractLinesGrid.tsx`, `ProjectContractDetailsForm.tsx` — `termId` on domain fields

**Steps:**
1. Rename the strings. Grep each new string inside `t\`` and `<Trans>` afterwards (lesson: "A word-boundary rename corrupts UI copy").
2. Project WIP text: "Cost charged to Contract projects. The revenue run moves it to cost of goods sold as revenue is earned."
3. Contract Assets text: "Revenue earned before it is invoiced, for rentals and contracts."
4. Glossary: rewrite `revenue-method` to list Daily, Even Period, Right to Invoice and Percent Complete. Add `project-contract`, `service-contract`, `time-and-materials`, `cost-plus`, `fixed-price`, `funded-amount`, `contract-ceiling`, each with an `href` into `/docs/reference/project-billing` or `/docs/reference/contracts`.
5. Add `termId` to the matching fields.

**Verify:**
```bash
pnpm --filter @carbon/content exec vitest run
# Expected: terms.test.ts passes.
```
Then the code gate.

**Out of scope:** labels outside projects, contracts and account defaults.

## Task 16: Add the Journal card to the Draft revenue run

**Depends on:** none
**Files:**
- Create: `apps/erp/app/components/JournalPreview.tsx` (extracted from `LeaseJournalPreview.tsx`)
- Modify: `apps/erp/app/modules/purchasing/ui/Leases/LeaseJournalPreview.tsx` — wrap `JournalPreview`
- Modify: `apps/erp/app/components/index.ts` — export
- Create: `apps/erp/app/modules/accounting/ui/RevenueRecognition/runJournal.ts` and `runJournal.test.ts`
- Modify: `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.tsx` — the card

**Steps:**
1. Move the table of `LeaseJournalPreview` into `JournalPreview({ rows, currencyCode })` with `JournalPreviewRow = { account: string; debit: number; credit: number }`. `LeaseJournalPreview` renders it.
2. `summarizeRunJournal(lines)`: for each schedule row, a positive amount debits `debitAccountId` and credits `creditAccountId`; a negative amount swaps them at its absolute value. Sum by account id. Return rows sorted debits first, then by account id.
3. Test: two rows, one negative; totals of debit and credit are equal.
4. On `$runId.tsx`, for a Draft run with lines, render a `Card` titled "Journal" after the summary list. Label each account "number name" from `useAccounts()` (`~/components/Form/Account.tsx`). Show a total row.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/accounting/ui/RevenueRecognition/runJournal.test.ts
# Expected: all tests pass.
```
Then the code gate.

**Out of scope:** the burden run, the posted run.

## Task 17: Write the "Project to cash" guide and update the reference pages

**Depends on:** Tasks 5 to 16
**Files:**
- Create: `docs/content/guides/project-to-cash.mdx`
- Modify: `docs/content/docs/reference/project-billing.mdx`, `docs/content/docs/reference/contracts.mdx`
- Copy from (precedent): `docs/content/guides/quote-to-cash.mdx` (frontmatter `label`, `index`, `flow`, `flowName`, `flowIndex`)

**Steps:**
1. Read `.claude/skills/carbon-docs/SKILL.md`.
2. Frontmatter: `title: From project to cash`, `flow: project-to-cash`, `flowName: Project to cash`, `flowIndex: 5`, `index: 0`, `label: "(I)"`.
3. Sections: Two kinds of contract; Set up the project (Contract treatment, billing element, labor categories); Create the project contract (lines, funding, billing events); Charge the work (time, material, cost); Review and bill (Approvals → Billing, the invoice); Earn the revenue (the revenue run and its journal). Describe only what the code does.
4. Reference pages: name service and project contracts, and link the guide.

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: exit code 0.
cd docs && for l in $(grep -oh "](/docs/[^)]*)" content/guides/project-to-cash.mdx content/docs/reference/project-billing.mdx content/docs/reference/contracts.mdx | sed 's|](/docs/||;s|)||;s|#.*||' | sort -u); do [ -f "content/docs/$l.mdx" ] || [ -f "content/docs/$l/index.mdx" ] || echo "MISSING $l"; done
# Expected: no MISSING line.
```

**Out of scope:** a changelog entry.

## Task 18: Update the rules and AGENTS files

**Depends on:** Task 17
**Files:**
- Modify: `apps/erp/app/modules/sales/AGENTS.md` (Contracts), `.claude/rules/project-billing.md`, `.claude/rules/projects-system.md`

**Steps:**
1. Describe `billingBasis`, the two lists, the project setup steps, the gap list, the server guard and the coverage filter.
2. Describe the Billing page for every Contract project, the Contract card, the attention rows and the Approvals rule.

**Verify:**
```bash
grep -n "billingBasis" apps/erp/app/modules/sales/AGENTS.md .claude/rules/project-billing.md | head
# Expected: matches in both files.
```

**Out of scope:** other rules.

## Task 19: Fill the translations

**Depends on:** Tasks 5 to 16
**Steps:**
1. Run `pnpm lingui:extract`.
2. Run the `/translate` skill for the empty `msgstr` entries.

**Verify:**
```bash
pnpm lingui:extract 2>&1 | grep -A3 "erp:" | head
# Expected: no missing count for the new strings (the pre-existing 114 may stay).
```

## Task 20: Verify in the browser

**Depends on:** all
**Steps:**
1. Run `/auth`, then `/test` against `https://erp.projects-wbs-research-spec.dev` (never localhost:3000). Set `AGENT_BROWSER_SESSION` to a name for this worktree.
2. Drive the acceptance criteria of the spec that the UI can show. Save screenshots under `.context/`.

**Verify:** every acceptance criterion has a PASS line in `.ai/runs/2026-10-21-project-contracts.md`.

## Execution notes

- Task 1 (`c2bdead6bd`): the hook's backup check was skipped. It compares against main's manifest, which has 5 tables this branch (behind main) does not have. The new column has a default.
- Task 2 (`fe23b54faf`): `billingBasisMismatchMessages` lives in `contract-schedule.ts`, so the ERP and the server function share the text. A line validator cannot see the contract's basis, so `checkBillingTerms` got no project rules.
- Task 3 (`9e2905e6e6`): `upsertContractLine` forces a project contract line to One-time before the basis check, so its Recurring refusal never fires there; confirm and amend still refuse. Amend checks the lines it adds, not the copies of changed lines. `contract-lifecycle.test.ts` now builds its T&M contracts as `billingBasis: "Project"`.
- Task 4 (`03563a5fab`): the bug was real ("The revenue plan no longer recognizes each line's billed total"). Confirm and the `$id.tsx` residual check now skip Right to Invoice and Percent Complete lines. 18 of 18 lifecycle tests pass.
- Task 6 must post `renewalUplift` 0 as a hidden field: the validator still requires it.
