# @carbon/models

Executable models of Carbon's concurrent protocols. `explore` (`src/explore.ts`)
runs every interleaving of a set of actors breadth-first and returns the
shortest trace that breaks an invariant, or deadlocks. The models run in
`pnpm test`, so CI checks them on every pull request, with no database.

A model is for a protocol where two requests, a retry or a job can interleave
and a past bug did: a read-then-write, a status change, a lock order. A pure
calculation gets a unit test next to its code instead
(`.claude/rules/testing.md`).

## Checking a change

`.claude/skills/formal-verification/SKILL.md` is the procedure: whether a change
touches verified code, how to run it, and how to tell a real bug from a
modelling error. `coverage.json` records each model's functions, its database
tests, a hash of each function as last confirmed, and `confirmedAt`.

```bash
pnpm --filter @carbon/models touched   # exit 2: covered code changed since its last confirm (CI runs this)
SUPABASE_DB_URL=… pnpm --filter @carbon/models verify   # models + their database tests; refuses to skip
SUPABASE_DB_URL=… pnpm --filter @carbon/models confirm <model>   # verify, then record the code as confirmed
```

## Models

| Model | Protocol | Code |
|---|---|---|
| `accounting-period.ts` | lock, unlock, close and reopen of accounting periods | `lockAccountingPeriod`, `unlockAccountingPeriod`, `closeAccountingPeriod`, `reopenAccountingPeriod` (`apps/erp/app/modules/accounting/accounting.service.ts`) |
| `document-posting.ts` | posting and voiding a receipt, shipment or purchase invoice: the operation's status read and claim, the posting's `assertPostable`, the transaction's lock, ledger and status writes, the failure handler's return to Draft; two tabs, a retry of the posting, a void, a failing post, a failure after the commit | the post and void branches of `postReceipt` / `postShipment` (`apps/erp/app/modules/inventory/inventory.service.ts`) and `postPurchaseInvoice` (`apps/erp/app/modules/invoicing/invoicing.service.ts`), `lockPostable` / `assertPostable` (`shared.service.ts`), `lockPostedReceipt` / `lockPostedShipment`, and the `postReceipt` / `postShipment` / `postPurchaseInvoice` operations' claims (`inventory.server.ts`, `invoicing.server.ts`) |
| `invoice-void.ts` | voiding a posted sales or purchase invoice against a line account change, and against another void | the `void` branch of `postSalesInvoice` / `postPurchaseInvoice`, `changeInvoiceLineAccount` (`apps/erp/app/modules/invoicing/invoicing.service.ts`) |
| `job-material-issue.ts` | issuing an untracked job material: operation completion, step issue, MES step backflush and the job's backflush, under every strict backflush setting, and the FIFO / LIFO cost layer they and other consumers relieve | `issueJobOperationMaterials`, the `partToOperation` case of `issueMaterial` (`apps/erp/app/modules/inventory/inventory.service.ts`), `calculateCOGS` (`apps/erp/app/modules/shared/shared.service.ts`), `backflushUntrackedMaterialsOnStepRecord` (`apps/mes/app/services/operations.service.ts`), `backflush_job_materials` (SQL) |
| `make-method-versions.ts` | the Draft / Active / Archived status of one item's make method versions: activation, the method import, the Onshape sync, a new version that sets its source Active | the `methodVersionToActive` case of `convertDocument`, `writeGroup`, `lockItemMakeMethods` (`apps/erp/app/modules/shared/shared.service.ts`), `syncMakeMethod`, `createMakeMethodVersion` (`apps/erp/app/modules/items/items.service.ts`) |
| `order-line-counters.ts` | posts and voids of invoices, receipts and shipments writing one order line's counter and `*Complete` flag, and the order status they set from the lines | `lockOrderLines`, `lockOrderLinesAsRead` (`apps/erp/app/modules/shared/shared.service.ts`) at the top of each post and void transaction in `postSalesInvoice`, `postPurchaseInvoice`, `postReceipt`, `postShipment`; the force delete's `restore*` and `createSalesReturnOrderCredit` |

## Always

- **One step is one statement or one transaction boundary, in the order the
  code runs them.** An autocommit read sees committed rows. An UPDATE waits for
  the row lock and then re-checks its WHERE against the row it waited for
  (READ COMMITTED). Writes inside a transaction stay in the actor's `pending`
  until its commit step.
- **Each fix is a switch on the model's `Protocol`, and a test replays the bug
  it closed** with that switch off, naming the commit. The test asserts the
  violated invariant or the trace, so it fails if the model stops reaching it.
- **`SHIPPED` is the protocol the code runs now.** Its test searches every
  small configuration (every start state that meets the invariants × every
  multiset of N operations), and a second test runs the same search on the
  previous protocol and expects it to fail. A search that cannot fail proves
  nothing.
- **Change the model in the same PR as the protocol.** A lock added, removed
  or moved in the code is a step added, removed or moved here.
- **Prove the trace on Postgres once.** A database test reproduces the
  model's counterexample with the real functions and two connections (see
  `apps/erp/test/database/period-close-concurrency.test.ts`): red before the
  fix, green after. The model then covers the interleavings the database test
  does not.

## Never

- Never model a step the code does not take, or merge two statements into one
  step: an interleaving between them is exactly what the model is for.
- Never weaken an invariant to make `SHIPPED` pass. Fix the protocol in the
  code, then flip the switch.

## Validation Commands

```bash
pnpm --filter @carbon/models test
pnpm --filter @carbon/models typecheck
```
