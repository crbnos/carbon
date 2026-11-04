# Port notes: sales (plan Phase 4 sales + Phase 5 sales)

Agent `sales`. Worktree `kelowna-port`. Nothing committed.

## Carried

### `packages/server-functions/src/post-customer-contract/index.ts` → `sales.service.ts` (`postCustomerContract` and helpers)

- Input: `contractRevenueMethods` gains `Right to Invoice` and `Percent Complete`; new `contractBillingMethods`; `amendmentLine` gains `billingMethod`, `projectElementId`, `materialHandlingPercent`, `feePercent`, `fundedAmount`, `fundedCost`, `noticePercent`, `noticeWindowDays`, `ceilingAmount`.
- New `BillingLineCheck`, `rangesOverlap` and `checkBillingLines` (base currency, a billing element on a Contract project, no overlapping element subtrees, T&M recognized by Right to Invoice). They sit above `confirm`.
- `confirm`: a `billingBasisMismatch` problem per line, then `checkBillingLines`, then step 6, the T&M backfill (`generateTimeAndMaterialsItems` from `~/modules/projects/project-posting`, through `asOf`).
- `refuseRevenueResiduals`: Right to Invoice and Percent Complete lines (`isProgressRevenueMethod`) are left out of the billed totals and of the revenue rows.
- `amend`: an added line is refused on a `billingBasisMismatch`; a `change` of a non-Fixed line is refused (P9); an added line writes the billing columns (`noticePercent` default 0.75, `noticeWindowDays` default 60, the notice-cost, CLIN and parent columns null); `checkBillingLines` runs after `setLineEndDates`; the insert returns `id, billingMethod`, and each added T&M line gets the backfill.
- `isProgressRevenueMethod` imported from `@carbon/database/contract-revenue-schedule`. `billingBasisMismatch` and `billingBasisMismatchMessages` from `@carbon/utils`.

### `post-customer-contract/schedule-writes.ts` → `sales.service.ts`

- `copyLineValues` copies `billingMethod`, `projectElementId`, `materialHandlingPercent`, `feePercent`, `fundedAmount`, `fundedCost`, `noticePercent`, `noticeWindowDays`, `ceilingAmount`, `thresholdNoticeFundedCost`, `runOutNoticeFundedCost`, `lineItemNumber` and `parentLineId`.
- `toLineTerms` reads and passes `billingMethod`.

### `create-contract-invoices/index.ts` + `insert-invoice.ts` → `sales.service.ts`

- `contractLocationId`, `InvoiceLineValues` (now with optional `invoiceLineType`, nullable `itemId`, `customerContractLineId` and `customerContractInvoiceLineId`) and the new `insertDraftContractInvoice` (returns `{ invoiceId, lineIds }`, sorted by `sortOrder`) are exported building blocks. `insertContractInvoice` calls `insertDraftContractInvoice` and keeps its stamping.

### `create-project-billing-invoices/{index,clin}.ts` (branch-only) → building block + operation

- `clin.ts` → `apps/erp/app/modules/sales/contract-clin.ts`, a plain file, unchanged. SPDX header checked.
- `index.ts` → `sales.service.ts`: `ProjectBillingInvoiceArgs`, `createProjectBillingInvoicesForContracts(db, args)`, `processProjectBillingContract` (renamed from `processContract`, which clashed with the contract-schedule one), `createProjectBillingInvoicesInput`, `createProjectBillingInvoicesPermission = { update: "sales", create: "invoicing" }` (unchanged), and the body `createProjectBillingInvoices(ctx, raw)`.
- Operation: `sales.server.ts` `createProjectBillingInvoices` (`run(ctx, "create-project-billing-invoices", …)`). It has no `@mcp`, as the branch's server function was not a tool.

### `generate-contract-billable-items/index.ts` (branch-only) → building block + operation

- `sales.service.ts`: `generateContractBillableItemsInput`, `generateContractBillableItemsPermission = { update: "sales" }` (unchanged), `GenerateContractBillableItemsResult`, and the body `generateContractBillableItems(ctx, raw)`.
- Operation: `sales.server.ts` `generateContractBillableItems({ customerContractId, customerContractLineId })`. It holds the logic that was in the route: it checks that the line is on the contract, sets `through` = company today, and sends a Cost Plus line to `generateCostPlusItems` (`@carbon/ee/project-revenue.server`). `gated` → an `entitlement` error with the PROJECT_REVENUE upgrade message. A T&M line runs `run(ctx, "generate-contract-billable-items", …)`.
- `contract+/$id.$lineId.generate.tsx` now calls `api.sales.generateContractBillableItems` and `respond().redirect(back, …)`. The flash messages did not change.

### `sales.server.ts` conflict hunks (main moved these into `sales.service.ts`)

- `releaseServiceOrderStamps`: added. `releaseRecurringInvoiceStamps` calls it first.
- `deleteSalesInvoiceReleasingRentals`: the line select also takes lines that a `projectBillableItem` points at.
- `generateContractInvoicesNow` takes `billingBasis`. A Project contract runs `create-project-billing-invoices` first (`invokePostingOrThrow(…, createProjectBillingInvoices)`), then `create-contract-invoices`. The failures and invoices are merged. `$id.invoice.tsx` already passed `billingBasis`.
- `projectRevenueRefusal(client, companyId, lines)` → `sales.service.ts`. A helper cannot sit in a `.server.ts`. It imports `EntitlementError`, `defaultUpgradeMessage`/`resolveRequirement` and `requireProjectRevenueEntitlement`.

### Gate moved into operations

- `amendContract` (`sales.server.ts`): the branch's `$id.amend.tsx` refusal (added lines + changed `revenueMethod`) runs before `postContract`, returning `ctx.error("entitlement", …)`. The preview is not gated, as on the branch.
- `createContractLine` / `updateContractLine` ops (MCP tools on main, generated from MB): `revenueMethod` accepts all four methods, a `billingMethod` was added (the other billing fields already pass through `looseObject`), and the same `projectRevenueRefusal` gate runs. Without it an MCP caller could write a Cost Plus line with no plan.
- `createContract`: the branch's `new.tsx` project branch (`projectContractTermDefaults`, no duration, `renewalUplift` 0, billing frequency from the input) moved into the op. `new.tsx` keeps the list path (`projectContracts` for a Project contract) for the refusal redirect.
- `setContractTerm`: `billingBasis` is appended to the merged form (the branch's `update.tsx` hunk).
- `escalateReturnOrderLine`: the `sales-return-order+/$id.$lineId.issue.tsx` hunk (a Repair line is refused with `REPAIR_DISPOSITION_LOCKED_MESSAGE`) moved into the op.

### Branch `@mcp` service tools → operations

Main reads MCP from operations only. The branch tagged 9 new `sales.service.ts` functions `@mcp`. I removed the tags from the service and added operations with the same function (all `@mcp`): `updateContractResearchFlags`, `getContractFundingActions`, `getContractLaborRates`, `upsertContractLaborRate`, `deleteContractLaborRate` (`@mcp destructive`), `getContractLineFunding` (`asOf` defaults to company today), `updateContractLineFunding`, `getContractProjectBillingInvoices`, `getProjectBillingBackup`. Permissions match the branch routes (view or update sales). `contract+/update.tsx`'s `researchFlag` intent now validates the flag and value as the branch did, then calls `api.sales.updateContractResearchFlags`.

### Routes: imports lost in the conflicts

- `$id.$lineId.details.tsx`, `$id.$lineId.update.tsx`, `$id.lines.new.tsx`: `projectRevenueRefusal` (from `sales.service`) and `contractLineBillingFormValues` (from `sales.models`). These routes still call `upsertContractLine` directly, as on main. `route-action-shape` allows that.
- `$id.details.tsx`: `getContractLineFunding`, `getContractProjectBillingInvoices` (sales.service), `getProjectContractRevenue` (projects.service), `getCompanyTimeZone` (`~/modules/shared/shared.service`, which replaces `timezone.server`).
- `$id.$lineId.billing.tsx`: `getCompanyTimeZone` from `shared.service`.
- `$id.setup.details.tsx`: `projectContractTermDefaults`, `ProjectContractDetailsForm`.
- `new.tsx`: `ContractBillingBasis`, `projectContractTermDefaults`.
- `sales.service.ts` import conflicts: `ContractBillingBasis`, `billingBasisMismatch(Messages)`, `parseLineItemNumber`, `sumFunding`, `contractLaborRateValidator`, `contractLineFundingValidator`, `isProjectBillingMethod`, `REPAIR_*_MESSAGE`. Also the three Repair doc-comment hunks (without `@mcp`).
- `sales-order+/$orderId.confirm.tsx`: nothing to carry. The branch only changed the `runMRP` import to `production.mcp.server`, and main replaced the route with `api.sales.confirmSalesOrder`.

### `packages/jobs/.../scheduled/recurring-billing.ts`

- The `create-project-billing-invoices` call is now `postingOrThrow("create-project-billing-invoices", { db, companyId, userId: "system" }, { asOf })`. `generateCostPlusItems`, `checkContractFunding`, the project-billing company query and the step order were already merged.

## Not carried / left to others

- Tests (Phase 8): `create-project-billing-invoices.test.ts`, `clin.test.ts` (import `~/modules/sales/contract-clin`), `generate-contract-billable-items.test.ts`, `contract-lifecycle.test.ts`, `sales.models.test.ts`.
- `apps/erp/app/modules/sales/AGENTS.md` (not mine): it still says `projectRevenueRefusal` / `generateContractInvoicesNow` are in `sales.server.ts`; both are in `sales.service.ts`. Also name the new operations.

## Requests

1. **Postings owner (`@carbon/api` `PostingContract` + `apps/erp/app/modules/postings.server.ts`):** register `create-project-billing-invoices`:
   - contract: `input: { asOf: string; customerContractId?: string }`, `output: ContractInvoiceGenerationResult`;
   - permission: `sales.createProjectBillingInvoicesPermission` (`{ update: "sales", create: "invoicing" }`);
   - body: `sales.createProjectBillingInvoices`, schema `sales.createProjectBillingInvoicesInput`, the same shape as the `create-contract-invoices` entry.
   Until then `@carbon/jobs` typecheck fails in `recurring-billing.ts` (363–405: the name and `drafted` unknown), and nowhere else in that file.
2. **UI owner:** `apps/erp/app/modules/sales/ui/Contracts/index.ts:48` imports `contractDurationOf` from `./useContractLabels`. Main moved it to `~/modules/sales/sales.models`. Re-export it from there (or import it there in `ContractProperties.tsx`).
3. **Production agent:** `sales.server.ts` `confirmSalesOrder` (~line 2072) calls `runMRP` from `~/modules/production/production.service`. On the branch, `runMRP` injected `planningGroupMrpDeps`. If that moves to a `production.server.ts` operation, tell the sales owner, because this call site must switch to it.
4. **Orchestrator (Phase 9):** run `pnpm generate:mcp` / the tool metadata. It must pick up the new `@mcp` operations, the changed `createContractLine`/`updateContractLine` inputs and the moved service tags. `posting-permissions.test.ts` may need the two new `*Permission` constants.

## Verification

- ERP `npx tsgo --noEmit`, final run: no errors in my files. The one remaining sales error is `ui/Contracts/index.ts:48` (request 2, not my file).
- The conformance scanners (`module-shape`, `service-fn-file`, `route-action-shape`, `no-server-code-in-client`, `no-raw-rounding`, `no-inline-fraction-digits`, `no-interpolated-error-log`, `no-local-timezone`), run on every file I touched: no new findings. Two findings in `sales.service.ts` were already in HEAD (`new Date()` and `Math.round` on a file size).
- `@carbon/jobs` `tsgo --noEmit`: only the errors from request 1 in `recurring-billing.ts`.
- `npx biome check --write` on the sales module files I touched and on `routes/x+/contract+`, `routes/x+/sales-return-order+`: clean. The 2 warnings were already there (a `console.error` in a route I did not change).
