# Port notes: foundation (plan Phase 3)

Agent `foundation`. Worktree `kelowna-port`. Nothing committed.

## Files created (from FREEZE `50c4309a9c`, `packages/server-functions/src/lib/…`)

| Branch file | New home | Import changes |
|---|---|---|
| `lib/stock-stripes.ts` | `packages/api/src/stock-stripes.ts`, export `@carbon/api/stock-stripes` (added to `packages/api/package.json`) | `../errors` → `./errors`. `@carbon/api` has no `kysely` dependency (and I may not run `pnpm install`), so the Kysely types come from `@carbon/database/client`: `Kysely`, `ExpressionBuilder`, and `KyselyTx` in place of `Transaction<DB>`. In `itemLedgerInStripes`, `const filters: Expression<SqlBool>[] = []` became `const filters = []` (an evolving array, same inferred type). These are type-only changes; runtime is unchanged. |
| `lib/project-posting.ts` | `apps/erp/app/modules/projects/project-posting.ts` | none (it imported no lib helpers) |
| `lib/project-cip.ts` | `apps/erp/app/modules/projects/project-cip.ts` | none (`./project-posting` is still a sibling) |
| `lib/project-journal.ts` | `apps/erp/app/modules/projects/project-journal.ts` | `resolveAccountingPeriod`, `allocateJournalLineIds` and `createAdjustmentJournal` → `~/modules/shared/shared.service` (same signatures as the old lib) |
| `lib/service-orders.ts` | `apps/erp/app/modules/service/service-orders.ts` | `../errors` → `@carbon/api/errors` |

SPDX headers: the license-header fixer reports all 5 as correct AGPL.

## Carry items re-applied to main's copies

- [x] `lib/calculate-cogs.ts` → `calculateCOGS` (shared.service.ts): new optional `projectId`. FIFO and LIFO open layers are filtered to that stripe (`projectId = x`, or `IS NULL` for common stock). The children query reads `openLayers.select("id")`, so it inherits the filter.
- [x] `lib/post-adjustment.ts` → `BookAdjustmentArgs.ledger.projectId?`, `BookAdjustmentResult.offsetJournalLineId`, `bookAdjustment` passes `projectId` to the ledger row and to `valueMovement`, `ValueMovementArgs.movement.projectId?`, `valueMovement` passes it to `calculateCOGS` and to all three cost-ledger rows, and returns `offsetJournalLineId` (`journalLines[1]?.id ?? null`, or null on every early return). `createAdjustmentJournal`: the branch did not change it.
- [x] `lib/plan-adjustment.ts` → `JOURNAL_LINE_SAFE_DOCUMENT_TYPES` gains `"Project Issue"` and `"Project Transfer"`. `buildItemLedgerRow` and `buildCostLedgerRow` take an optional `projectId` and write `projectId ?? null`.
- [x] `lib/storage-units.ts` → object signatures (below). Main's `allowFullestBin` (strict backflush) is kept as an option on the object, so both intents survive. `getStorageUnitWithHighestQuantity` now also filters by `companyId` (the branch added that) and groups by `(storageUnitId, projectId)`.
- [x] `company-records.ts` → `CompanyRecordTable` (main's name for it, in shared.service.ts) gains `"item"` and `"project"`.
- [x] `post-receipt/void-cost-ledger.ts` → `ReceiptCostLedgerRow.projectId?`, `RestoringLayer.projectId` (required), and `planReceiptVoidCostLedger` maps `projectId: row.projectId ?? null` (inventory.service.ts).
- [—] `server-fn-context.ts` / `invoke.ts`: NOT ported, as instructed. What they carried:
  - registry entries for the 12 new functions: `complete-service-order`, `create-project-billing-invoices`, `create-service-order-invoice`, `generate-contract-billable-items`, `post-project-burden`, `post-project-expense`, `post-project-issue`, `post-project-stock-transfer`, `post-timesheet`, `reclass-project-coverage`, `save-timesheet-entry`, `submit-timesheet-week` (Phase 5 postings and operations);
  - `revenueRunSynthesizers?: RunRowSynthesizer[]` on the invoker fields and on `ServerFnContext` (default `[]`). The ERP and jobs pass `projectRevenueSynthesizers` from `@carbon/ee/project-revenue.server` to propose, recalculate and preview revenue recognition runs. This must be carried through main's run postings (the accounting agent, Phase 4/5).

## Call sites updated for the storage-units signature

Every caller in the repo (`git grep` over apps and packages; MES, jobs and ee have none):

- `production.service.ts` `itemDerivedJobMaterialFields`: `getStorageUnitId(trx, { companyId, itemId, locationId, storageUnitId: lineStorageUnitId, allowFullestBin: !strict })`. The branch's get-method passed no `stripes` here, so the default `[null]` applies.
- `inventory.service.ts`: 2 calls in `issueJobOperationMaterials`, 2 in `issueMaterial` (job issue), and 1 in the maintenance-consumption path. Each now calls `getStorageUnitWithHighestQuantity(trx, { companyId, itemId, locationId, stripes: [null] })` and reads `?.storageUnitId ?? null`.
  - **For the inventory agent (issue port):** at FREEZE the first four pass the job's `stripes` (`issue/index.ts:373, 384, 3347, 3483`), not `[null]`. Replace `[null]` with the demand stripes when you port the stripes logic. The maintenance call (`issue/index.ts:5223`) keeps `[null]`, as on the branch.
  - Behaviour note: under the new signature the query sees only common stock (`projectId IS NULL`) and only the company's own rows. On a database with no project stock this gives the same result as before.

## Signatures other agents must know

```ts
// shared.service.ts
getStorageUnitId(trx: Transaction<DB>, {
  companyId: string; itemId: string; locationId: string;
  storageUnitId?: string;
  stripes?: readonly StockStripe[];   // default [null] = common stock
  allowFullestBin?: boolean;          // default true; false under strict backflush (main)
}): Promise<string | undefined>

getStorageUnitWithHighestQuantity(trx: Transaction<DB>, {
  companyId: string; itemId: string; locationId: string;
  stripes: readonly StockStripe[];    // required
}): Promise<{ storageUnitId: string; projectId: StockStripe } | null>

calculateCOGS(trx, { itemId, quantity, companyId, trackedEntityIds?, projectId?: string | null }): Promise<COGSResult>

bookAdjustment(trx, args: BookAdjustmentArgs /* ledger.projectId?: string | null */)
  : Promise<{ itemLedgerId; journalId: string | null; offsetJournalLineId: string | null; cost }>

valueMovement(trx, args: ValueMovementArgs /* movement.projectId?: string | null */)
  : Promise<{ journalId: string | null; offsetJournalLineId: string | null; cost: number }>

buildItemLedgerRow({ …, projectId?: string | null }) / buildCostLedgerRow({ …, projectId?: string | null })
assertCompanyRecords(db, "item" | "project" | …, ids, companyId, label)

// inventory.service.ts
RestoringLayer.projectId: string | null   (required)
ReceiptCostLedgerRow.projectId?: string | null
```

Exported names of the new files:

- `@carbon/api/stock-stripes`: `StockStripe`, `stripesForDemand`, `StripeQuantity`, `splitAcrossStripes`, `drawFromStripes`, `trackedEntityStripe`, `assertEntitiesInStripes`, `stripeKey`, `itemLedgerInStripes`, `loadDemandStripes`, `ProjectStockFlags`, `loadProjectStock`, `loadTrackedEntityStripe`, `withStripe`, `loadTrackedEntityStripes`, `assertEntitiesInCommonStock`. The db parameter type is `Kysely<DB> | KyselyTx`.
- `~/modules/projects/project-posting`: `ProjectCostTreatment`, `ProjectStateGroup`, `ProjectPostingProject`, `ProjectPostingElement`, `AccountAllowability`, `ProjectPostingAsset`, `ProjectPostingContext`, `ResolvedProjectPostingAccount`, `ProjectChargeError`, `capitalAssetId`, `resolveProjectTreatment`, `resolveProjectPostingAccount`, `assertChargeable`, `isUnallowableCharge`, `buildProjectLedgerRow`, `projectPostingKey`, `loadProjectPostingContexts`, `startElementsOnFirstCharge`, `JobProjectCharge`, `loadJobProjectCharge`, `ProjectLineCharge`, `resolveProjectLineCharges`, `resolveProjectLineAccounts`, `reverseProjectLedgerRows`, `ServicePostingContext`, `loadServicePostingContexts`, `loadServicePostingContext`, `serviceChargeCoverage`, `buildBillableItem`, `reverseBillableItem`, `ContractBillingLine`, `ContractLaborRate`, `LaborCategoryBillRate`, `ContractBillingContext`, `contractLineForRow`, `loadContractBillingContext`, `buildContractBillableItem`, `insertProjectLedgerRows`, `generateTimeAndMaterialsItems`.
- `~/modules/projects/project-cip`: `ProjectCipSourceType`, `ProjectCipRow`, `buildProjectCipRow`, `assetCostIncrements`, `writeProjectCipRows`, `reverseProjectCipRows`.
- `~/modules/projects/project-journal`: `ProjectJournalLine`, `postProjectJournal`.
- `~/modules/service/service-orders`: `insertServiceProject`, `InsertServiceOrderArgs`, `insertServiceOrder`, `ensureCustomerAssets`, `assertNoOpenRefurbishment`.

## Verification

- `pnpm exec turbo run typecheck --filter=@carbon/api`: passes.
- ERP `npx tsgo --noEmit`: no errors in any file I touched or created. Two errors remain in files I touched, and both were already in HEAD's versions of those files:
  - `production.service.ts(2330)` `planningSegmentFilter` is not defined;
  - `shared.service.ts(107)` cannot find `@carbon/ee/action-task-entity`.
- The branch's `stock-stripes.test.ts` passes against the new file: 5/5, run with a throwaway vitest config. `packages/api`'s own vitest config cannot load, because `@carbon/config/dist` is not built in this worktree. I removed the test file again; Phase 8 should place it at `packages/api/src/stock-stripes.test.ts`.
- `biome check --write` on all touched files: one error, `planningSegmentFilter` (above, already in HEAD).

## Requests for other owners

- **service agent:** `apps/erp/app/modules/service/service.server.ts:20` imports `insertServiceOrder` from `@carbon/server-functions/lib/service-orders`. Change it to `~/modules/service/service-orders`.
- **MES owner:** `apps/mes/app/services/inventory.service.ts:265` calls `trackedEntityStripe` with no import (the merge dropped it). Add `import { trackedEntityStripe } from "@carbon/api/stock-stripes"`. `@carbon/api` is already a MES dependency.
- **inventory agent:** pass the demand stripes to the four job-issue calls (see above). In `voidReceipt` (inventory.service.ts ~10600), select `projectId` from the receipt's cost ledger rows and write `projectId: layer.projectId` on the restoring layers. The branch's post-receipt void did this; I changed only the plan function.
- **tests (Phase 8):** `apps/erp/test/database/post-customer-contract/contract-lifecycle.test.ts:23` imports `../lib/project-posting`. Change it to `~/modules/projects/project-posting`. Other branch lib tests (`project-posting.test.ts`, `project-cip.test.ts`, `service-orders.test.ts`, `stock-stripes.test.ts`, `calculate-cogs.test.ts`, `plan-adjustment.test.ts`) are not in the tree yet.
- **docs/comments (low priority):** `service/AGENTS.md:9` and the comments in four migrations (`20261021000600`, `…000900`, `…001500`, `…001600`) still name `packages/server-functions/src/lib/project-posting.ts`. The new path is `apps/erp/app/modules/projects/project-posting.ts`.
- **orchestrator:** decide whether `@carbon/api` should declare `kysely` as a dependency. Adding it needs `pnpm install`. Until then, stock-stripes takes its types from `@carbon/database/client`, which works.
- `lib/project-revenue.ts` is the accounting agent's (per the brief); I did not touch it.
