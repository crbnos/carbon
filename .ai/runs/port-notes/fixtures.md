# Port notes: fixtures (plan Phase 8, part 0)

Agent `fixtures`. Worktree `kelowna-port`. Nothing committed.

## Files

| Branch (FREEZE `50c4309a9c`, `packages/server-functions/src/…`) | New home (`apps/erp/test/database/fixtures/…`) |
|---|---|
| `lib/project-posting-test-fixture.ts` | `project-posting.ts` (new) |
| `lib/project-billing-test-fixture.ts` | `project-billing.ts` (new) |
| `lib/sales-return-test-fixture.ts` | `sales-return.ts` (new) |
| `activate-accounting/activation-test-fixture.ts` (+68, `addReleasedProject`) | `activation.ts`: already there (the merge carried it). Byte-identical to the branch's. No change. |
| `local-database-test-fixture.ts`, `always-post-test-fixture.ts` | The branch did not change them (`git diff 23bd5d6e0b 50c4309a9c` is empty). Nothing to carry. |
| — | `handles.ts`: added `systemServiceOf` (below). `handlesOf` is unchanged. |

The data and every helper body are the branch's, unchanged. The only edits are the imports,
the `ctx`, the new `service` field and one dropped option (below).

## Exported API

### `project-posting.ts`

- `PROJECT_TEST_USER = "system"`
- `projectPostingFixture(options?: { costTreatment?: projectCostTreatment })`. Same signature
  as the branch. It returns:
  - `db`, `ctx`, **`service` (new)**, `prefix`, `account(name)`, `state(key)`,
    `dimension(entityType)`, `companyId`, `groupId`, `projectId`, `elementId`, `laborCategoryId`
  - `addCapitalAsset({ status, finalAssetElement?, acquisitionCost? })` → `{ fixedAssetId, cipClassId, classId }`
  - `addStockedItem(key, { quantity, unitCost })` → `{ locationId, itemId }`
  - `enableProjectStock()`
  - `addStripeStock({ itemId, locationId, projectId, quantity, unitCost, storageUnitId?, postingDate? })` → `{ itemLedgerId, costLedgerId }`
  - `addConsumeToProjectJob(key, { locationId, materialItemId, quantityPerParent, jobQuantity, consumeToProject? })` → `{ jobId, makeMethodId, operationId, materialId, workCenterId, finishedItemId }`
  - `addPlanningGroup({ locationId, members, excessRule? })` → `{ planningGroupId, projectIds }`
  - `addPeg({ planningGroupId, itemId, locationId, supplyType, supplyId, projectId, quantity, needDate })` → `{ id }`
  - `addItem(key, { itemTrackingType })` → `{ itemId }`
  - `addPurchaseOrder(key, { locationId, lines })` → `{ supplierId, purchaseOrderId, lineIds }`
  - `addReceipt(key, { locationId, purchaseOrderId, supplierId, lines })` → `{ receiptId, receiptLineIds }`
  - `addPurchaseInvoice(key, { supplierId, lines })` → `{ invoiceId, lineIds }`
  - `addServiceOrder(key, { laborWarrantyEndDate?, partsWarrantyEndDate?, laborPrice? }?)` → `{ customerId, locationId, subjectItemId, subjectSerialId, customerAssetId, serviceOrderId, laborItemId }`
  - `cleanup()`

### `project-billing.ts`

- `projectBillingTestFixture()`. **Signature change:** the branch took
  `options: { revenueRunSynthesizers?: RunRowSynthesizer[] }`, which it put on the
  `ServerFnContext`. Main's accounting port has no such context field:
  `proposeRevenueRecognitionRun`, `previewRevenueRecognitionRun` and
  `recalculateRevenueRecognitionRun` always call `runRowSynthesizers(type)`, which defaults
  `extra` to `projectRevenueSynthesizers(projectRevenueWriters)` (`accounting.service.ts`
  ~22411). There is no seam left to pass the option to, so I removed it. I did not keep it as an
  option that does nothing. It returns:
  - `db`, `ctx`, **`service` (new)**, `companyId`, `customerId`, `itemId`, `locationId`,
    `laborCategoryId`, `userId`, `account(name)`
  - `addAccounting()`, `addJournalLines(lines, postingDate?)` → line ids,
    `addProject(key, identifier, costTreatment?)` → `{ projectId, rootId, childId }`,
    `addContract({ key, projectId, projectElementId, status?, billingMethod?, revenueMethod?, materialHandlingPercent?, fundedAmount?, ceilingAmount? })` → `{ contractId, lineId }`,
    `addStockedItem(key, { quantity, unitCost })` → `itemId`,
    `post(rows)` (through `insertProjectLedgerRows` / `buildProjectLedgerRow`, now from
    `~/modules/projects/project-posting`), `items(projectId)`, `cleanup()`

### `sales-return.ts`

- `salesReturnRepairFixture(f)` → the same ids object as the branch's. `f` is a `projectPostingFixture`.
- `onHand(f, itemId, locationId)` → number.

### `activation.ts`

- `addReleasedProject(f, { costTreatment: "Contract" | "Capitalize", fixedAssetId?, fixedAssetClassId? })` → `{ projectId, elementId }`. Unchanged.

### `handles.ts`

- `handlesOf(ctx)`: unchanged.
- **New:** `systemServiceOf(ctx: { db, companyId, userId }, groupId): ServiceContext`. It returns
  the system actor on behalf of `ctx.userId`, over `ctx.db`. It is the same construction as
  `alwaysPostFixture`'s `service`: there is no Supabase client and no kv, and a body that uses
  one throws `A posting body has no …`. Both new fixtures expose it as `f.service`.

## `ctx` changed type

On the branch, `f.ctx` was `ServerFnContext.system({ db, companyId, userId })`, a class
instance. Now it is the plain `{ db, companyId, userId }`, as in every main fixture
(`activation`, `rental`, `lease`, `always-post`). The branch tests read only `f.ctx` as a
whole, plus one `ctx.project…` (a local variable, not the fixture). So `f.ctx.db` /
`.companyId` / `.userId` still work. Nothing used `.actor`, `.isSystem` or `.supabase()`.

## How a ported test calls a posting

The branch wrote `await postX(f.ctx, input)`, which returns `{ data, error }`. Now:

```ts
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { postProjectIssue } from "../../../app/modules/projects/projects.service";
import { handlesOf } from "../fixtures/handles";

const issued = await invokePosting(handlesOf(f.ctx), "post-project-issue", input, postProjectIssue);
expect(issued.error).toBeNull();   // same { data, error } shape; error is a ServerFnError
```

- `invokePosting` runs the body as the system, over `f.ctx.db`. It reads the company group
  from the DB. The `name` only labels the span and picks `POSTING_DEFAULTS`: `"issue"` gets
  `defaultStatus: 400`, as its server function did. Any body works, registered or not. Use the
  branch's server-function name (kebab-case).
- `invokePostingOrThrow(...)` returns the data and throws the refusal.
- `invokeCreate(handlesOf(f.ctx), { type: …, … })` replaces the branch's `create(f.ctx, …)`.
- Calling a body directly as `body(f.service, input)` also works. But it THROWS a refusal and
  does not return `{ data, error }`. Use it only where the branch called a plain building
  block, or for an operation.
- A second actor (branch `save-timesheet-entry.test.ts`: `ServerFnContext.system({ db, companyId, userId: managerId })`)
  → `handlesOf({ db: f.db, companyId: f.companyId, userId: managerId })`.

Body homes (`apps/erp/app/modules/…`). Main's name is given where it differs from the branch's
default export:

| Branch `postX(f.ctx, …)` | Name | Body |
|---|---|---|
| `postReceipt` / `postShipment` / `postPicking` / `postInventoryAdjustment` / `postStockTransfer` / `postInventoryCount` | `post-receipt` … | `inventory/inventory.service` (same names) |
| `issue` | `issue` | `inventory/inventory.service` **`issueMaterial`** |
| `correctStockMovement` | `correct-stock-movement` | `inventory/inventory.service` **`postStockMovementCorrection`** |
| `postProductionEvent` | `post-production-event` | `production/production.service` |
| `postPurchaseInvoice` / `postSalesInvoice` | `post-purchase-invoice` / `post-sales-invoice` | `invoicing/invoicing.service` |
| `postCharge` / `postReimbursement` / `proposeRevenueRecognitionRun` / `activateAccounting` | … | `accounting/accounting.service` |
| `createProjectBillingInvoices` / `generateContractBillableItems` | `create-project-billing-invoices` / `generate-contract-billable-items` | `sales/sales.service` |
| `postTimesheet` / `saveTimesheetEntry` / `submitTimesheetWeek` / `postProjectIssue` / `postProjectExpense` / `postProjectStockTransfer` / `reclassProjectCoverage` / `postProjectBurden` | kebab of each | `projects/projects.service` |
| `completeServiceOrder` / `createServiceOrderInvoice` | `complete-service-order` / `create-service-order-invoice` | `service/service.service` |
| `create` | — | `invokeCreate` (`shared/shared.service`) |

## What test agents must know

- **Biome ignores `apps/erp/test/**` in this repo.** `biome check` reports "No files were
  processed", which is why main's fixtures have unsorted imports. I formatted my files through
  `biome check --write --stdin-file-path=apps/erp/app/…`. Use that trick if you want them formatted.
- **The revenue run always includes the commercial synthesizers.** A branch test that passed
  `revenueRunSynthesizers: projectRevenueSynthesizers` (the ee `percent-complete` /
  `cutover-recost` tests) now gets them by default. They degrade through
  `projectRevenueEnabledForCompany` → `companyHasFeature(getCarbonServiceRole(), …)`, which
  returns `false` on the Community edition. Under vitest, `SUPABASE_URL` is stubbed to
  `http://localhost` (`apps/erp/vitest.config.ts`), so a test that needs Percent Complete
  probably has to `vi.mock` that gate. A community test that expects them to be absent may need
  the opposite mock. I did not verify this; it is for the accounting/ee test agent.
- **Under `invokePosting` with handles**, the body's `caller`/`system` Supabase clients are
  `getCarbonServiceRole()`, built from the stubbed vitest env. A body that really calls
  PostgREST fails. The branch's bodies use `ctx.db` (now `ctx.asSystem.pg`) only.
- Load the env first: `source /tmp/port/env.sh`. Without it `hasLocalDatabase` is false and
  every `databaseTest` SKIPS silently.
- `projectPostingFixture` hard-codes dates (the period is 2000-01-01..2099-12-31, the stock is
  dated 2026-01-01), as on the branch.

## Verification

- Smoke test `apps/erp/test/database/fixtures/fixtures.smoke.test.ts`. It built every fixture
  and called every helper of `projectPostingFixture`, `salesReturnRepairFixture` + `onHand`,
  `projectBillingTestFixture` (`addAccounting`, `addProject`, `addContract`, `addJournalLines`,
  `addStockedItem`, `post`, `items`) and `activationFixture` + `addReleasedProject`. It also
  posted one project issue: `invokePosting(handlesOf(f.ctx), "post-project-issue", …,
  postProjectIssue)` → `error: null`, `cost: 50`. Each case ran `cleanup()`. Result against the
  port stack (`localhost:51853`): **4 passed**. Re-run after the `handles.ts` edit together
  with main's `strict-backflush.test.ts` (which uses `handlesOf`): 18 passed. Main has no
  fixture smoke-test pattern, so I **deleted** the file afterwards, as the brief says.
- ERP `npx tsgo --noEmit`: 0 errors in `test/database/fixtures/*`. 38 lines remain, all in
  other files (`post-charge-transaction.test.ts`, `contract-lifecycle.test.ts`,
  `post-reimbursement-transaction.test.ts`, `release-jobs.test.ts`, which are unported branch tests).
- License-header fixer: 4 files, all correct AGPL.

## Requests

None. No module code changed.
