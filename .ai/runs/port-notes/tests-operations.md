# Port notes: tests-operations (plan Phase 8)

Agent `tests-operations`. Worktree `kelowna-port`. Nothing committed.

## Method

Each new test is the FREEZE file (`git show 50c4309a9c:packages/server-functions/src/<path>`)
with only its plumbing changed:

- the fixture imports point at `../fixtures/{project-posting,local-database,sales-return}`;
- `./grouped-receipt` → `app/modules/inventory/grouped-receipt`,
  `../lib/service-orders` → `app/modules/service/service-orders`,
  `../lib/stock-stripes` → `@carbon/api/stock-stripes`;
- every default import of a server function (`import issue from "./index"`) is replaced by a
  local wrapper with the SAME name and call shape, so no test body changed:
  `const issue = (ctx: Ctx, input) => invokePosting(handlesOf(ctx), "issue", input, issueMaterial)`
  (`Ctx = Parameters<typeof handlesOf>[0]`). The body is imported `as <name>Body` where the
  names would clash. `create(f.ctx, …)` → `invokeCreate(handlesOf(f.ctx), …)`.

No assertion was changed. Biome ignores `apps/erp/test/**`, so the files were formatted
through `biome check --write --stdin-file-path=apps/erp/app/…`. License-header fixer: 16
files, all correct AGPL.

## Files

| Branch (`packages/server-functions/src/…`) | New home | Wrappers → body | Result |
|---|---|---|---|
| `issue/project-issue.test.ts` | `apps/erp/test/database/issue/project-issue.test.ts` | `issue` → `issueMaterial` | 13/13 pass |
| `post-receipt/grouped-receipt.test.ts` | `test/database/post-receipt/grouped-receipt.test.ts` | `postReceipt` | 6/6 pass |
| `post-receipt/project-receipt.test.ts` | `test/database/post-receipt/project-receipt.test.ts` | `postReceipt` | 3/3 pass (after the fix below) |
| `post-receipt/sales-return-repair.test.ts` | `test/database/post-receipt/sales-return-repair.test.ts` | `postReceipt` | 6/6 pass |
| `post-shipment/customer-assets.test.ts` | `test/database/post-shipment/customer-assets.test.ts` | `postShipment` | 4/4 pass |
| `post-shipment/project-stock-shipment.test.ts` | `test/database/post-shipment/project-stock-shipment.test.ts` | `postShipment`, `postReceipt`, `postInventoryCount` | 3/3 pass |
| `post-shipment/sales-return-repair.test.ts` | `test/database/post-shipment/sales-return-repair.test.ts` | `postShipment`, `postReceipt`, `create` → `invokeCreate` | 2/2 pass |
| `post-purchase-invoice/project-invoice.test.ts` | `test/database/post-purchase-invoice/project-invoice.test.ts` | `postPurchaseInvoice`, `postReceipt` | 6/6 pass |
| `post-picking/project-stock-pick.test.ts` | `test/database/post-picking/project-stock-pick.test.ts` | `postPicking`, `postStockTransfer`, `issue` | 2/2 pass |
| `post-picking/refurbishment-guard.test.ts` | `test/database/post-picking/refurbishment-guard.test.ts` | `postPicking` | 1/1 pass |
| `post-production-event/project-event.test.ts` | `test/database/post-production-event/project-event.test.ts` | `postProductionEvent` (production.service) | 1/1 pass |
| `post-inventory-adjustment/project-stock.test.ts` | `test/database/post-inventory-adjustment/project-stock.test.ts` | `postInventoryAdjustment` | 1/1 pass |
| `post-sales-invoice/post-sales-invoice.test.ts` | `test/database/post-sales-invoice/post-sales-invoice.test.ts` | `postSalesInvoice` (invoicing.service) | 1/1 pass |
| `correct-stock-movement/correct-stock-movement.test.ts` | `test/database/correct-stock-movement/correct-stock-movement.test.ts` | `correctStockMovement` → `postStockMovementCorrection` | 1/1 pass |
| `import-csv/payroll-total-import.test.ts` (pure part) | `apps/erp/app/modules/shared/shared.payroll-total-import.test.ts` | — (`readPayrollTotalRow`) | 4/4 pass |
| `import-csv/payroll-total-import.test.ts` (live part) | `test/database/import-csv/payroll-total-import.test.ts` | — (`importPayrollTotals(db, …)`) | 1/1 pass |

Every case ran against the port stack (`localhost:51853`, `source /tmp/port/env.sh`); the
case counts equal the branch files' `databaseTest`/`it` counts, so nothing was skipped.

### Modified by the branch (main had already moved them)

All four already carry the branch's change in their main home; nothing to do:

- `lib/calculate-cogs.test.ts` → `test/database/lib/calculate-cogs.test.ts`: both new cases
  ("a stamped layer relieves every child…", "the stripe decides which layers…") are present. Pass.
- `lib/plan-adjustment.test.ts` → `test/database/lib/plan-adjustment.test.ts`: the
  `"Project Issue"` expectation is present. Pass.
- `post-purchase-invoice/posting-lines.test.ts` → `test/database/post-purchase-invoice/posting-lines.test.ts`:
  `ProjectElement: null` present. Pass.
- `post-receipt/void-cost-ledger.test.ts` → `test/database/post-receipt/void-cost-ledger.test.ts`:
  `projectId: null` present. Pass.

### `apps/erp/test/release-jobs.test.ts`

HEAD had the branch's version, which mocks `production.mcp.server` and drops the `runMRP`
import. The production agent kept `runMRP` in `production.service.ts` (main's home), and
`production.mcp.server.ts` does not exist. I restored main's file
(`git show 0a1bd961b2:apps/erp/test/release-jobs.test.ts`), which mocks `runMRP` on
`production.service`. 20/20 pass; the TS errors are gone.

## Module fix (port slip): receipt void guard vs. consume-at-receipt

`project-receipt.test.ts` → "a receipt charges project lines to the project account and
consumes stocked items at receipt" failed: the void was refused with "Cannot void: stock
received on this receipt was moved, picked or shipped since it was received."

Cause — both sides changed the PO receipt void and the merge did not reconcile them:

- main (`7d1cbb2d17`, #1936) added `assertReceivedStockOnHand`, which checks only the
  reversal's NEGATIVE rows against on-hand;
- the branch made the void also reverse the receipt's own `Project Issue` rows (a line
  consumed by its project at receipt: +4 received, −4 issued, on-hand 0).

So the reversal is −4 and +4 at the same position, net 0, but the guard ignored the +4 and
saw a shortfall of 4.

Fix (`apps/erp/app/modules/inventory/inventory.service.ts`, `findVoidShortfalls` +
`assertReceivedStockOnHand`): the guard nets ALL reversal rows per position (item, location,
bin, tracked entity) and refuses only where the net takes out more than is on hand. Main's
intent holds: a row that only puts stock back still needs nothing, two lines into one bin
still add up, and stock that really moved is still refused. Added a case to
`apps/erp/app/modules/inventory/inventory.void-guards.test.ts` ("nets a row the same
reversal puts back"). All main void tests pass (`void-tracked-entities`,
`inventory-document-guards`, `void-cost-ledger`, `receipt-quantities-start-at-zero`).

Observation, not changed: the guard's position key has no `projectId`, so it compares a
reversal with the bin's stock across all stripes. A project-stock receipt whose stock was
replaced by common stock in the same bin would pass the guard. That is main's guard on a
stripe-blind key; whether to add the stripe is a design call for the inventory owner.

## Sweep

`vitest run` over `app/modules/{inventory,invoicing,production,purchasing,shared,quality,settings,items}`,
`test/database/{post-receipt,post-shipment,issue,post-picking,post-purchase-invoice,post-sales-invoice,post-inventory-adjustment,post-production-event,correct-stock-movement,import-csv,lib}`,
`test/release-jobs.test.ts`, plus `strict-backflush`, `inventory-document-guards`,
`always-post-inventory*`, `receipt-quantities-start-at-zero`, `stock-correction-cutover`:
**113 files, 1189 tests, all pass.** In the full parallel run, 4 cases failed with Postgres
`out of shared memory` during fixture cleanup (lock table exhausted by the concurrent
company deletes, other agents' suites included). Re-run with `--no-file-parallelism`, all 4
pass (`strict-backflush`, `lib/right-to-invoice`, `post-receipt/sales-return-repair`,
`post-receipt/void-tracked-entities`). Environmental, not a regression.

ERP `npx tsgo --noEmit`: exit 0, no errors in the whole app.

## Requests

- **Inventory owner / reviewer:** please check the void-guard netting above; it is the one
  module-code change I made.
