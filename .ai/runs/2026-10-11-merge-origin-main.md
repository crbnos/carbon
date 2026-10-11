# Merge of origin/main into projects-wbs-research-spec (2026-10-11)

Brad asked for this merge. He approved main's always-post journal model for
the branch: every company posts, and `journal_posting_status()` makes a
journal Provisional before the accounting cutover and Posted after it.

Merge base: `11a7a60999`. Main brought 19 new migrations
(`20261008002726` … `20261010031417`).

## Phase 1: conflict resolutions

The posting server functions use main's always-post builders. The branch's
project logic moved into them.

| Area | Resolution |
|---|---|
| `post-purchase-invoice` | `posting-lines.ts` gets `projectCharges` and `projectDrafts`. |
| `post-receipt` | Rebuilt on main. It keeps stripes, consume-at-receipt, grouped jobs and pegs. |
| `issue`, `post-shipment`, `post-sales-invoice`, `post-charge-post`, `post-reimbursement-post` | Main's builders with the branch's project logic. |
| `calculate-cogs` | The serial-stamped-children rule moved to `@carbon/database/cost-relief`. |
| `void-cost-ledger.ts` | A void restores each layer on its original stripe. |
| Revenue recognition | Main's `run-journals.ts`, with the ProjectElement tag and the Cost Relief and Loss Provision descriptions. |
| MRP | Main's order rules apply inside the branch's per-row (segment) planning. |
| Depreciation | Main's cost-adjustment catch-up skips an asset with a project late cost (remaining-life schedule). |
| Service orders | Direct-invoice cost relief leaves out service-order invoice lines. |

## Local unblock for `20261009181437`

Main's `20261009181437_supplier-part-currency.sql` failed at statement 8 on
this database: `cannot change return type of existing function`. The cause:
the branch's `20261010135634` had already created `get_purchasing_planning`
with an extra output column, `planningSegmentId`. Main's file rolled back
cleanly.

Nothing depends on the function in `pg_depend`, so this one-off local step
is safe. Run it once on a database that applied `20261010135634` first:

```bash
/tmp/kpsql -c "DROP FUNCTION public.get_purchasing_planning(text, text, text[]);"
pnpm db:migrate
```

Main's file then creates its own version. The combined migration below
creates the branch's version again. `.ai/lessons.md` records the same step
("A migration from main can fail on a local database …").

## Combined migrations

`20261011163015_merge-main-job-costing-and-planning.sql` is dated after every
migration on both sides.

| Function | Body | Main's change | Security |
|---|---|---|---|
| `get_purchasing_planning` | Branch, from `20261010135634` | `supplierUnitPrice` and `currencyCode` in each supplier, from `20261009181437`. DROP and CREATE, because the return type differs. | DEFINER, `assert_company_access` |
| `backflush_job_materials` | Branch, from `20261010160658` | Always-post, from `20261009010412` | INVOKER |
| `complete_job_to_inventory` | Branch, from `20261010160658` | Always-post, from `20261009010412` | DEFINER |

The always-post changes in each job function:

1. `v_posting_status "journalEntryStatus"` replaces `v_accounting_enabled`.
2. `v_posting_status := journal_posting_status(p_company_id)` replaces the
   `accountingEnabled` early return.
3. A period lookup creates or activates a period only when the status is
   Posted. A Provisional journal gets a NULL period.
4. Each journal insert writes `v_posting_status`, not `'Posted'`.
5. The WIP sum in `complete_job_to_inventory` reads only journals with
   status Provisional, Posted or Reversed.

The `'Posted'` status of `fixedAssetTransfer` rows is not a journal status.
It does not change. A diff of each new body against main's body shows no
posting-status difference. A diff against the branch's body shows only the
hunks above.

The branch's own `20261010135634` also changed (it has not shipped). On a new
database it runs after main's column rename, and its `LANGUAGE sql` body is
checked at creation. It now reads `supplierUnitPrice` and `currencyCode`.

### Scan for other journal writes

The branch's other new migrations hold no journal insert and no
`accountingEnabled` test. Their `'Posted'` literals belong to
`timesheetEntry` and `shipment`. No branch function reads `journalLine`.

Main and the branch both define only three function names:
`get_purchasing_planning`, `complete_job_to_inventory` and
`backflush_job_materials`. The combined migration covers all three.

## Shortcut decision

Main added a global `c`-then-letter Create menu (`CREATE_PREFIX = "c"`). The
branch bound bare `c` to "New element" on the Project Elements page. The
Create menu has no page context, so it cannot hold an entry that needs a
project. `PROJECT_SHORTCUTS.create` is now `SHORTCUTS.newRecord` (`n`), the
list page's New key.

The branch's Service Order item in the Create menu had no shortcut, which
failed the typecheck. It now uses `CREATE_SHORTCUTS.serviceOrder = "v"`.

## Other merge fixes

| File | Fix |
|---|---|
| `packages/database/src/accounting-cutover/shared.ts` | `ACCOUNT_DEFAULT_COLUMNS` lists the branch's 4 accounts: `projectWorkInProgressAccount`, `projectExpenseAccount`, `warrantyExpenseAccount`, `contractLossProvisionAccount`. The readiness check now requires them. |
| `post-project-issue`, `post-project-stock-transfer`, `post-timesheet`, `complete-service-order`, `lib/project-journal.ts` | Main's `createAdjustmentJournal` requires `status`. These paths still test `accountingEnabled`, so they pass `"Posted"`. Phase 2b replaces this. |
| `$projectId.elements.$elementId.create-po-line.tsx` | Reads `supplierUnitPrice` and converts it into the order's currency with `getSupplierPartPricing` and `resolveSupplierPrice`, as main's kanban route does. The line gets the order's `exchangeRate`. |
| `$supplierId.parts.$supplierPartId.tsx` | The `purchaseOrder` embed names `purchaseOrderLine_purchaseOrderId_fkey` (TS2589 after the branch's new FKs). |

## Generated files

- `pnpm run generate:types` and `pnpm run generate:swagger`.
- `packages/jobs/manifests/schema.json` from `pnpm db:check:backups -- --stage` (restorable).
- `pnpm run generate:workflow-catalog`: no change.
- `pnpm run generate:mcp`: response hashes only. The removed tool names are
  each removed by one side on purpose.
- `permissions-manifest.test.ts.snap`: adds the branch's 11 server functions.
- `authz check`: 0 changes.

## Checks

- Typecheck green: `@carbon/database`, `@carbon/utils`, `@carbon/ee`,
  `@carbon/server-functions`, `@carbon/jobs`, `@carbon/planning`, `erp`, `mes`.
- `CLOBBER_BASE_REF=MERGE_HEAD pnpm --filter @carbon/checks clobbers` names
  `complete_job_to_inventory` and `backflush_job_materials`. The combined
  migration covers both. The check compares names, not bodies, and it
  misses DROP + CREATE (`get_purchasing_planning`).
  `CLOBBER_BASE_REF=11a7a60999` reports nothing, because it compares the
  merge base with itself.

## Phase 2b to-do

1. Move the branch's TS posting paths from `accountingEnabled` to
   `journalPostingStatus`: `post-project-issue`, `post-project-expense`,
   `post-project-stock-transfer`, `post-timesheet` and its `plan.ts`,
   `reclass-project-coverage`, `complete-service-order`, and the revenue
   Cost Relief and Loss Provision rows.
2. Remove the `status: "Posted"` stand-ins listed above.
3. Make main's accounting setup backfill (`activate-accounting/legacy/*`)
   aware of project charges and stock stripes.
4. Make the cutover re-cost aware of project charges and stock stripes.
5. Run the full test suites.
6. Run `pnpm db:check:datasets` and `pnpm db:check:backups`.

## Phase 2b: the cutover and this branch's data

Projects and Field Service have not shipped. So no production company holds
a project document posted before always-post, and every project document
gets its journal when it posts. The legacy backfill (`activate-accounting/legacy/*`)
needs no project family.

| Area | Decision | Change |
|---|---|---|
| Project Expense and Project WIP accounts | Both are non-control accounts when Project WIP differs from the WIP account. The trial balance opens them. | None |
| Project stock stripes: the inventory reset | The reset opened one common layer per item. A project stripe then had no layer, and `calculateCOGS` relieves a stripe from its own layers only. The reset now opens one layer per stripe, at the item's one unit cost (`splitOpeningLayersByStripe`). Common stock takes the rest of the quantity and the cost, so the opening journal does not change. | `accounting-cutover.ts`, `recost.ts` |
| Project stock stripes: the re-cost | Each stripe is its own pool, as `calculateCOGS` relieves it. | `recost.ts` |
| Project stock Transfer and Borrow after the cutover | The layer that the transfer opens takes the re-costed cost of the stock it drew (`costOf` on the replay layer). Both legs use one inventory account, so the re-cost writes no journal for it. | `cost-relief.ts`, `accounting-cutover.ts`, `recost.ts` |
| Project stock Payback after the cutover | If the re-cost changes its cost, the enable refuses (409). See open question 4. | `recost.ts` |
| Timesheets | An empty labor absorption default writes a stand-in line before the cutover. The enable re-points it. | None |
| Revenue rows (Cost Relief, Loss Provision) | Step 5 sets each Planned row dated before the cutover to Posted with no journal. The trial balance holds the prior system's relief. The opening deferred revenue reads only `Deferral` rows. | None |
| Service order completion | `complete-service-order` reads the WIP from `projectLedger`, not from journals. See open question 1. | None |

Tests: `activate-accounting/project-stripes.test.ts` (the reset per stripe,
and a Transfer re-costed at cost) and the `splitOpeningLayersByStripe` and
`costOf` cases in `packages/database/src/accounting-cutover.test.ts`.

### Open questions for Brad

1. **Project and service WIP on the WIP control account.** The WIP account
   is a control account. Its opening reads only per-job lines
   (`getWorkInProgressItems`). Two kinds of project cost also post to it:
   - A Refurbishment charge with Capitalized coverage always posts to
     `workInProgressAccount`.
   - The backfill (`20261009055122`) set `projectWorkInProgressAccount` to
     `workInProgressAccount` for each existing company. So Contract
     project costs post there too.

   Such costs before the cutover are missing from the opening WIP. Migration
   Clearing then shows the difference, and the enable refuses. If the user
   forces Migration Clearing to zero, a completion after the cutover credits
   WIP below zero. Recommendation: add one opening item for these lines. Its
   amount is the sum of the WIP-account lines dated before the cutover whose
   document is not a job, minus the Cost Relief rows dated before the
   cutover that credit the WIP account (step 5 posts them with no journal).
2. **Fixed asset cost at the cutover.** `getCutoverFixedAssets` reads
   today's `acquisitionCost` and today's class. A CIP cost dated on or after
   the cutover raises `acquisitionCost`, and its promoted journal posts it
   again. A capitalization after the cutover moves the asset to its
   in-service class, and its promoted journal moves the cost again. Every
   cost charged to a Capitalize project after the cutover shows this. Main's
   job CIP shows it too. Recommendation: subtract the `fixedAssetCipCost`
   rows dated on or after the cutover, and use the class at the cutover.
3. **Re-cost of a project issue.** The re-cost adjusts the issue's journal
   (the project account against inventory). It changes no `projectLedger`
   row, billable item or `fixedAssetCipCost` row. So Cost Plus billing, the
   project cost summary and CIP capitalization keep the old cost. Should the
   re-cost also write a `projectLedger` adjustment row (quantity 0) and a CIP
   row?
4. **Re-cost of a project stock Payback.** A Payback returns the lender's
   cost at `borrowedUnitCost` and books the difference as Payback Variance.
   A re-cost would have to move the lender layers, the variance journal and
   the Payback Variance ledger row. The enable now refuses instead. Is a
   refusal right, or should the re-cost rebuild the payback?
