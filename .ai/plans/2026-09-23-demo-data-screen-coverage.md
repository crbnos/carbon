# Demo Data Screen Coverage — implementation plan

**Spec / source:** `.ai/specs/2026-09-23-demo-data-screen-coverage.md`
**Branch:** `feat/demo-data-completeness` (checkout `/Users/aashu/work/carbon/carbon`)
**Research (per-screen sources, filters, exact tables to seed):**
- `.ai/research/2026-09-23-screen-audit-erp-commercial.md` (sales, purchasing, invoicing, accounting)
- `.ai/research/2026-09-23-screen-audit-erp-operations.md` (production, items, inventory)
- `.ai/research/2026-09-23-screen-audit-mes-quality-resources.md` (MES, quality, resources, workflows)
- `.ai/research/2026-09-23-screen-audit-erp-settings-people.md` (settings, users, people)
- `.ai/research/2026-09-23-planning-engine-seeding.md` (MRP + scheduler)

## Ground rules for every task (read once, apply always)

1. Working dir `/Users/aashu/work/carbon/carbon`. Always `pnpm`, never `npm`. **Never commit, stash, reset or checkout** — the user commits. Never use `.claude/worktrees`. Never rebuild the database. Never write to the DB outside (a) rolled-back transactions and (b) `pnpm db:seed:dev -- --email demo-audit@carbon.local …` (the scratch company `dapnjkh860gjckkl52t0`). Company `dap2gkh860gg2ccl14sg` belongs to the user — SELECT only.
2. Engine idiom (unchanged from the 2026-09-22 plan): tiers use `insertRow`/`insertId`/`insertMaybe` from `datasets/sql.ts`; refs via `need(map, key, label)` — never `map[key]!` or a silent `continue`; dates ONLY via `DayOffset` + `resolveDate`/`resolveTimestamp` (`datasets/dates.ts`) — no JS `Date`, no `CURRENT_DATE`; every query carries a `companyId` (or `companyGroupId`) predicate; never a literal primary key; never write global tables (`user`, `exchangeRate`, `period` except tier 12's locked insert).
3. Before inserting into a table for the first time, read its `Insert` type in `packages/database/src/types.ts` and its CHECK constraints (`psql … -c "select pg_get_constraintdef(oid) from pg_constraint where conrelid='\"<table>\"'::regclass and contype='c'"`). Check for sync interceptors that already create the row (adopt-and-UPDATE on unique violation, as tier 02 does for `itemCost`).
4. All four data packs move together: new `Dataset` fields are REQUIRED (compile-enforced parity). Author `data/satellite/` first, then robotics / precision / motor with industry-appropriate content of the same shape and volume. Keep each industry's story voice.
5. Every new shape gets, in the same task: a `validate.ts` rule (refs resolve; required variety via a `REQUIRED_*` set where it is a status/family/type) + a negative case in `validate.test.ts`.
6. Verification loop after every task (all must be green before the next task):
   ```bash
   pnpm --filter @carbon/database typecheck     # Expected: no output, exit 0
   pnpm --filter @carbon/database test          # Expected: all tests passed
   pnpm --silent db:check:datasets              # Expected: ✓ satellite ✓ robotics ✓ precision ✓ motor
   ```
7. Floors: after a task adds rows to a table, add/raise its entry in `datasets/coverage.ts` `COVERAGE_FLOORS` (floor = min count across the 4 datasets, ×0.8 for volume tables). Engine outputs (`demandActual`, `demandForecast`, `demandForecastSource`, `supplyActual`, `supplyForecast`, `capacityReservation`, `jobOperationDependency`) stay OUT of the floors.
8. If an assumption in a task turns out false (missing column, CHECK shape differs, interceptor conflict, screen filter different from the research), re-decide via the ship-it resolution ladder, record it in the spec's Autonomous Decisions section, and continue. Improvising silently or silently dropping coverage is forbidden.
9. Comments: only where a future dev needs the why; one line by default. No task/cluster tags in code comments.

## Progress
- [x] Task 1: Wipe — model-only slides + refusal preflight
- [x] Task 2: Post-commit planning step (MRP + scheduler) for both callers
- [x] Task 3: Production floor (B1)
- [x] Task 4: Planning inputs, people & time (B2 + B6 time cards)
- [x] Task 5: Sales & purchasing surfaces (B3)
- [x] Task 6: Invoicing & accounting (B4)
- [x] Task 7: Quality, maintenance, resources (B5)
- [x] Task 8: Settings & people remainder (B6)
- [x] Task 9: Screen matrix — script, real seeds ×4, fix loop
- [x] Task 10: Full verification + evidence
- [x] Task 11: Docs

## Dependencies
Task 1 and Task 2 are independent of each other and of the data tasks. Tasks 3–8 run **sequentially** (all touch `types.ts`, `validate.ts`, `coverage.ts`). Task 4 needs Task 3 (assignments reference the new jobs). Task 9 needs 1–8. Task 10 needs 9. Task 11 needs 10.

---

## Task 1: Wipe — model-only slides + refusal preflight

**Depends on:** none
**Files:**
- Modify: `packages/database/src/datasets/wipe.ts`
- Precedent: `TRANSIENT_MRP_TABLES` handling in the same file (delete before `nullNullableReferences`).

**Steps:**
1. Add `const MODEL_SLIDE_TABLES = ["assemblyInstructionStepSlide", "methodOperationStepSlide", "jobOperationStepSlide", "quoteOperationStepSlide"]` with a one-line why (their `imagePath OR modelUploadId` CHECK cannot survive the FK-nulling pass). Delete each (if in `deleteSet`) right after the `TRANSIENT_MRP_TABLES` loop.
2. Add `async function assertWipeable(ctx)` called first in `wipeCompanyBusinessData`, before any write. It runs one query per case, scoped by `companyId`:
   - `SELECT count(*) FROM customer WHERE "companyId"=$1 AND "intercompanyCompanyId" IS NOT NULL` (+ same for `supplier`) → throw `Seed: this company trades with other companies in its group (N intercompany customer/supplier record(s)). Demo data can only be applied to a company without intercompany partners.`
   - `SELECT count(*) FROM "cardTransaction" WHERE "companyId"=$1 AND status <> 'Draft'` → throw `Seed: this company has N posted or voided card transaction(s), which cannot be deleted. Demo data can only be applied to a company without posted card transactions.`
3. Keep the accounting-period change already in the working tree (PRESERVED `accountingPeriod`, tier 09 period adoption).

**Verify:** a scratchpad probe (not committed) that, per case, inside `BEGIN … ROLLBACK` on company `dap2gkh860gg2ccl14sg` (user `eeb03435-d6ca-4665-8c0d-bde873fe3b7e`), creates the state and calls `applyDatasetTiers(…, wipeFirst: true)`:
- IC customer: `UPDATE customer SET "intercompanyCompanyId"='dapnjkh860gjckkl52t0' WHERE id=(first customer)` → expected error starts `Seed: this company trades with other companies`
- Posted card: insert Draft `cardTransaction` (cardAccountId = a Liability account of the company group) then UPDATE to Posted with postingDate/postedAt/postedBy → expected `Seed: this company has 1 posted or voided card transaction`
- Model-only slide: insert `modelUpload(modelPath)` + `assemblyInstructionStepSlide(stepId=a seeded step, modelUploadId)` → expected `APPLY OK`
- Baseline → `APPLY OK`
Place the probe at `packages/database/src/zz-probe.ts` (tsx must resolve `./client.ts`; run `pnpm exec tsx src/zz-probe.ts` from `packages/database`) and DELETE it afterwards. Save output to `.ai/runs/2026-09-23-wipe-probes.txt`. Then the standard loop.
**Out of scope:** changing the triggers themselves.

## Task 2: Post-commit planning step (MRP + scheduler) for both callers

**Depends on:** none
**Files:**
- Create: `packages/jobs/src/demo-planning.ts` — `planDemoCompany`
- Create: `packages/jobs/src/scripts/plan-company.ts` — CLI (precedent: `packages/jobs/src/scripts/check-backups.ts`)
- Modify: `packages/jobs/package.json` — script `"plan:company": "tsx --env-file-if-exists=../../.env --env-file-if-exists=../../.env.local src/scripts/plan-company.ts"`
- Modify: `packages/jobs/src/inngest/functions/tasks/company-template.ts` — new step after `apply-template`
- Modify: `packages/database/src/seed-dev.ts` (+ `datasets/cli.ts` if args live there) — spawn the script; `--skip-plan`
- Precedents: `packages/jobs/src/inngest/functions/scheduled/mrp.ts:86` (runMrp call), `apps/erp/app/routes/api+/schedule.ts` (runLocationSchedule call)

**Steps:**
1. `planDemoCompany({ companyId, userId }): Promise<{ mrp: "ok" | string; schedule: { locationId: string; result: "ok" | string }[] }>`:
   - `const client = getCarbonServiceRole(); const db = getJobDatabaseClient();`
   - `await runMrp(client, db, { type: "company", id: companyId, companyId, userId })` in try/catch → record message.
   - Locations to schedule: `SELECT DISTINCT "locationId" FROM job WHERE "companyId"=$1 AND status IN ('Ready','In Progress','Paused') AND "locationId" IS NOT NULL` (Kysely). For each: `await runLocationSchedule({ db, client, locationId, companyId, userId })` in try/catch.
   - Never throws; returns the per-step outcome.
2. Template job: after the `apply-template` step returns successfully, `await step.run("plan-template", () => planDemoCompany({ companyId, userId }))`; log failures; write `planningError` into the marker's metadata only if a sub-step failed (read how the marker metadata is updated in the same file and reuse that helper). A planning failure must not change the marker status from its post-apply value.
3. CLI `plan-company.ts`: `parseArgs` `--company`, `--user` (required) → `planDemoCompany` → print one line per step (`MRP ✓` / `MRP ✗ <msg>`, `Schedule <locationId> ✓/✗`); exit 0 even on failure (planning is best-effort), exit 1 only on bad args.
4. `seed-dev.ts`: after the seed commits, unless `--skip-plan`, `spawnSync("pnpm", ["--silent", "--filter", "@carbon/jobs", "plan:company", "--", "--company", companyId, "--user", userId], { stdio: "inherit", cwd: <repo root> })`; on non-zero status print `⚠ Planning step failed — run it later with: pnpm --filter @carbon/jobs plan:company -- --company <id> --user <id>`. Document `--skip-plan` in the CLI usage text.
**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs      # Expected: Tasks: N successful
pnpm --filter @carbon/database typecheck                  # Expected: exit 0
pnpm db:seed:dev -- --email demo-audit@carbon.local --dataset robotics   # Expected: exit 0, "MRP ✓", "Schedule … ✓"
psql postgresql://postgres:postgres@localhost:57312/postgres -At -c "select (select count(*) from \"demandActual\" where \"companyId\"='dapnjkh860gjckkl52t0'),(select count(*) from \"capacityReservation\" where \"companyId\"='dapnjkh860gjckkl52t0')"
# Expected: both > 0
```
If `runMrp`/`runLocationSchedule` need env not present locally (service key/URL), re-decide per ground rule 8.
**Out of scope:** changing engine code; the `carbon/mrp` event (nothing consumes it).

## Task 3: Production floor (B1)

**Depends on:** none (sequential with 4–8)
**Files:** `datasets/types.ts`, `tiers/06-production.ts`, `data/*/production.ts`, `data/*/items.ts` (if short-routing items are needed), `validate.ts`, `validate.test.ts`, `coverage.ts`
**Screens to fill (research: operations §Production, MES §5):** Priorities (week + Unscheduled), MES operations board (all plant work centers), MES Assigned, work-center displays, production KPIs (completion time, estimates vs actuals), job Steps tab, batches, MES inspection op, MES assembly 3D, procedures lifecycle, make-method status, pickMethod.
**Capabilities:**
- Re-date existing open jobs (Ready/In Progress/Paused/Planned) to due −3…+21; keep document chronology valid (validator).
- ≥ 10 new released jobs per dataset (mix Ready / In Progress), short routings, every plant work center gets ≥ 2 open ops; 1 Ready job with `dueDate` NULL; 2 make-to-stock jobs (no sales order).
- `JobSpec.priority` (distinct 1…n) and `assignee: "self"` → `ctx.userId`; op-level `assignee` on ~6 open ops.
- 3 Completed jobs finished −25…−3 with `releasedDate` and Setup/Labor/Machine `productionEvent`s whose durations roughly match estimates; open `productionEvent` (`endTime` NULL, start today) on 3–4 more work centers with those ops `In Progress`.
- `jobOperationStepRecord` for done ops with steps; `jobOperationParameter`, `jobOperationTool` on ≥ 3 ops (read tables first).
- One item's Final Inspection method op: `operationType='Inspection'` + `inspectionDocumentId` (the seeded inspection document); copied to its jobs by `copyMethodToJob` (extend the helper if it drops those columns).
- Link the seeded assembly instruction to the assembly op (`methodOperation.assemblyInstructionId` + job copy).
- One process `batchable=true`; an Active `jobOperationBatch` with ≥ 2 member ops from different jobs.
- Procedures: versions so the set shows Draft, Active and Archived; make methods of seeded items `Active`; assembly instruction in its published/active status (read the enum).
- `pickMethod` default shelf per stocked item at the plant.
- Validator: `REQUIRED_PROCEDURE_STATUSES = {Draft, Active, Archived}`; ≥ 18 jobs; every plant work center has ≥ 1 open op; ≥ 1 open job due within 0…+7; ≥ 1 released job without due date.
**Verify:** loop (ground rule 6) + floors updated.
**Out of scope:** capacityReservation / op dates (the scheduler writes them — Task 2).

## Task 4: Planning inputs, people & time (B2 + B6 time cards)

**Depends on:** Task 3
**Files:** `types.ts`, `tiers/01-foundation.ts`, `tiers/10-ops.ts`, `tiers/12-planning.ts`, `data/*/foundation.ts`, `data/*/ops.ts`, `data/*/planning.ts`, validator, floors
**Capabilities:**
- Shifts created at the plant location (today `ctx.locationId` = HQ, `01-foundation.ts:43-47`) + `workCenterShift` for every plant work center; `employeeShift` points at a plant shift.
- Upsert the applying user's `employeeJob` (today an UPDATE that no-ops when the row is missing, `01-foundation.ts:117-122`): `locationId` = plant, `title`, `departmentId`, `shiftId`, `startDate`, `managerId` NULL. Do NOT modify the `user` row.
- `peopleAssignment` for the applying user across the current week (not only today — today's row pre-filters the MES board to one work center; research MES §4; pick days −2…+4 excluding today OR today on the work center with the most ops, and record which), + 1 `peopleAbsence` next week.
- `companySettings.timeCardEnabled = true`; one open `timeCardEntry` (clockIn today 07:00 company TZ, clockOut NULL) unless it conflicts with an existing open entry rule (read constraints).
- Planning setup at HQ too (one reorder policy + projection) so the location picker on HQ is not empty.
**Verify:** loop.

## Task 5: Sales & purchasing surfaces (B3)

**Depends on:** Task 4
**Files:** `types.ts`, `tiers/02-items.ts`, `tiers/04-sales.ts`, `tiers/05-purchasing.ts`, `data/*/items.ts`, `data/*/sales.ts`, `data/*/purchasing.ts`, validator, floors; new helper if needed `helpers/quote-method.ts` (precedent: `helpers/job-method.ts` `copyMethodToJob`)
**Capabilities:**
- `enforcementRule` families `sales` (item-targeted; CHECK: targetType 'item', appliesToAll false, surfaces ⊂ quoteLine/salesOrderLine/salesInvoiceLine, severity warn|error), `storage`, and a work-center rule; assignments via `enforcementRuleItemAssignment` / `enforcementRuleWorkCenterAssignment`. Read the condition JSON shape from `packages/ee/src/rules/` models before authoring. `REQUIRED_ENFORCEMENT_RULE_FAMILIES` covers every family the UI lists.
- Customer portals: `externalLink` documentType `Customer` for 2 customers (documentId = customerId), id minted by default (never literal).
- `approvalRule` (purchaseOrder ≥ 5000, ≥ 25000; supplier) with `approverGroupIds` = the company's Admin employee-type group (resolve by query, never a literal); Pending `approvalRequest` for the Needs-Approval PO and the Pending supplier (read `packages/ee/src/approvals/` for the request shape).
- Quote methods: copy each Make-to-Order quote line's item method into `quoteMakeMethod`/`quoteMaterial`/`quoteOperation` (adopt interceptor-created `quoteMakeMethod` like tier 06 adopts `jobMakeMethod`).
- Configurator: one configurable item `requiresConfiguration=true`, one `configurationRule`, one quote line with a configuration.
- `assignee` = applying user on ≥ 2 open quotes, SOs, POs, RFQs; `status` on every supplier; `createdAt` of quotes/RFQs/supplier quotes spread over past offsets (a new optional `createdOffset`); 2 more `pricingRule`s; customer/supplier bank-account rows only if the table is company-scoped tenant data (check).
- Return orders: memos linked via `salesReturnOrderId`/`purchaseReturnOrderId` + their credit lines; `nonConformanceSalesReturnOrderLine` / `nonConformancePurchaseReturnOrderLine`.
**Verify:** loop.

## Task 6: Invoicing & accounting (B4)

**Depends on:** Task 5
**Files:** `types.ts`, `tiers/04-sales.ts`, `tiers/05-purchasing.ts`, `tiers/09-accounting.ts`, `data/*/accounting.ts`, `data/*/sales.ts`, `data/*/purchasing.ts`, validator, floors; `.claude/rules/onboarding-company-templates.md` (payments convention changes)
**Capabilities:**
- `postingDate` = `dateIssued` on every non-Draft sales/purchase invoice.
- Posted journals shaped like the posting paths — read `packages/database/supabase/functions/post-sales-invoice`, `post-purchase-invoice`, `post-payment` (or their current names) for account defaults and line `documentType`/`documentId`: `sourceType` `Sales Invoice` (AR debit / Revenue credit), `Purchase Invoice` (Inventory or Expense / AP), `Payment` (Cash vs AR/AP; set `payment.journalId`); one `Opening Balance`. `accountingPeriodId` set from the adopted period for the posting date. Every journal balances (validator already checks authored journals — extend to the generated ones by deriving them in data, or generate them in the tier from the invoice specs and assert balance in the tier).
- Invoice dates spread so receivables aging hits Current, 1–30, 31–60, 61–90.
- Draft Receipt + Draft Disbursement payments.
- `costLedger` rows paired with posted receipt/shipment `itemLedger` rows (shape from `post-receipt`/`post-shipment`); `itemCost.unitCost` non-zero for stocked items.
- `companyAccountsReceivableBillingAddress` / `companyAccountsPayableBillingAddress` (id = companyId).
**Verify:** loop + `psql` spot check in a real seed is Task 9's job.

## Task 7: Quality, maintenance, resources (B5)

**Depends on:** Task 6
**Files:** `types.ts`, `tiers/07-quality.ts`, `tiers/10-ops.ts`, `tiers/01-foundation.ts` (partners, HQ work center), `data/*/quality.ts`, `data/*/ops.ts`, `data/*/foundation.ts`, `helpers/inspection.ts` if inspection math changes, validator, floors
**Capabilities:**
- `nonConformanceWorkflow` ×3 linked from ≥ 2 NCRs; `nonConformanceItem` on every NCR; NCR `assignee`; `nonConformanceSupplier` on a supplier NCR dated in the current month; `nonConformanceActionProcess` linking an open task to a process in use; `procedureParameter` on ≥ 2 procedures.
- `QualityData.inspection` → `inspections: InspectionSpec[]` with ≥ 3 entries: Passed receipt lot, Pending lot, Job Operation lot (keep `helpers/inspection.ts` sample math shared with the validator).
- Maintenance: `maintenanceDispatchItem.unitCost`; Reactive dispatch on a production-event day; 2 Completed dispatches at −55…−35; a Scheduled dispatch due today; an In Progress dispatch with the work center Down; `workCenterReplacementPart`; one HQ work center with 1 dispatch + 1 schedule.
- `partner` rows (read the table first).
**Verify:** loop.

## Task 8: Settings & people remainder (B6)

**Depends on:** Task 7
**Files:** `types.ts`, `tiers/01-foundation.ts` or `tiers/10-ops.ts`, `data/*/foundation.ts` / `data/*/ops.ts`, validator, floors
**Capabilities:**
- `userAttributeCategory` → `userAttribute` (Date, List, User data types) → `userAttributeValue` for the applying user.
- `itemSerialSequence` for every serial-tracked item; 3 `customField` rows (part Text, customer User, job Yes/No — resolve `dataTypeId` by name from the lookup table); `printJob` history (completed, failed, queued) against a printer route. ~~one `webhook` `active=false`~~ — dropped (spec D66).
**Verify:** loop.

## Task 9: Screen matrix — script, real seeds ×4, fix loop

**Depends on:** Tasks 1–8
**Files:**
- Create (scratchpad, not committed): `…/scratchpad/screen-matrix.ts` (or `.sql`)
- Create: `.ai/runs/2026-09-23-screen-matrix-{satellite,robotics,precision,motor}.txt`
**Steps:**
1. From the five research files, list every screen classified EMPTY/FILTERED-EMPTY that is in scope, plus the previously-OK core lists as regression guards. For each, write ONE count query reproducing the loader's source and filters for the applying user (RPCs called inside `BEGIN … ROLLBACK`).
2. For each dataset: `pnpm db:seed:dev -- --email demo-audit@carbon.local --dataset <key>` (includes Task 2's planning), then run the matrix for company `dapnjkh860gjckkl52t0`; write `<screen> | query | count | PASS/FAIL` to the evidence file.
3. Any FAIL → fix in the owning tier/data (ground rules apply), re-run the loop, re-seed, re-run the matrix. Repeat until 0 FAIL for all four datasets.
**Verify:** each evidence file ends with `FAIL: 0`.

## Task 10: Full verification + evidence

**Depends on:** Task 9
**Steps / Verify:**
```bash
pnpm --filter @carbon/database typecheck                 # exit 0
pnpm --filter @carbon/database test                      # all pass
pnpm --silent db:check:datasets                          # ✓ ×4
pnpm exec turbo run typecheck --filter=@carbon/jobs      # all successful
pnpm exec biome check packages/database/src packages/jobs/src   # 0 errors
```
- Real re-apply over an existing seeded company: seed robotics then satellite onto `demo-audit@carbon.local`; both exit 0; no robotics items remain.
- Re-run Task 1 probes (now also against the final code).
- Pre-commit drill: break one new ref in `data/satellite/*.ts`, stage only that file, `sh .husky/pre-commit` → `Commit blocked`; restore the file byte-identical (checksum before/after); unstage.
- Refresh `.ai/runs/2026-09-23-seed-baseline-*.txt` (row counts) and the status audit if statuses changed.
Record everything in `.ai/runs/2026-09-23-screen-coverage-verification.txt`.

## Task 11: Docs

**Depends on:** Task 10
**Files:** `.claude/rules/onboarding-company-templates.md` (planning step, wipe refusals, slides, payments now journaled, shifts at plant, volume), `packages/database/src/datasets/AGENTS.md`, `packages/database/AGENTS.md` (dev CLI `--skip-plan`), `packages/jobs/AGENTS.md` if it lists scripts/functions, `docs/content/docs/platform/demo-data.mdx` (user-facing: what the demo includes, that planning runs after apply, the two refusal messages) then regenerate the agent KB exactly as the previous pass did (find the generator in `.claude/rules/agent-knowledge-base.md`), spec status → Implemented + changelog.
**Verify:** `grep -n "plan:company\|planDemoCompany" .claude/rules/onboarding-company-templates.md packages/database/AGENTS.md` shows both; KB manifest regenerated without diff noise outside demo-data.
