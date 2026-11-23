# Purchasing and supplier improvements — implementation plan

**Spec / source:** `.ai/specs/2026-11-05-purchasing-supplier-improvements.md`
**Branch:** `feat/purchasing-supplier-improvements`

🛑 Do not commit until the user gives permission. The user chose one stop, after task 12.

🛑 Check free memory before each typecheck, test run or dev server. Run one heavy process at a time.

## Progress

Phase 1: Supplier Stage

- [x] Task 1: Provision the worktree stack
- [x] Task 2: Add the `supplierStage` schema and registrations
- [x] Task 3: Add the Supplier Stage services, routes and pages
- [x] Task 4: Show the stage on the supplier form, table and header

Phase 2: Purchase order shipping and promised date

- [x] Task 5: Add the shipping columns, the setting and regenerate types
- [x] Task 6: Allow the shipping fields after release (main now does this)
- [x] Task 7: Add the shipping fields to the card and the list
- [x] Task 8: Add the promised date rule and toggle

Phase 3: Request Quote

- [x] Task 9: Add the pure function that builds the rows
- [x] Task 10: Add the `requestQuoteFromItem` operation and the popup data route
- [x] Task 11: Add the menu item and the popup

Finish

- [x] Task 12: Update docs and run the final checks

## Dependencies

Task 1 comes first. Tasks 2–4 run in order. Tasks 5–8 run in order. Tasks 9–11 run in order. The three phases do not depend on each other. Task 12 comes last.

## Commands

| Purpose | Command |
|---------|---------|
| Apply migrations, regenerate types | `pnpm db:migrate` |
| Typecheck the ERP | `pnpm exec turbo run typecheck --filter=erp` |
| Typecheck the database package | `pnpm exec turbo run typecheck --filter=@carbon/database` |
| Lint | `pnpm run lint` |
| Extract Lingui strings | `pnpm lingui:extract` |
| Run the conformance checks | `pnpm --filter @carbon/checks clobbers` |
| Check the demo datasets | `pnpm db:check:datasets` |
| Check the backups | `pnpm db:check:backups` |

---

## Task 1: Provision the worktree stack

**Depends on:** none
**Files:** none

**Steps:**

1. Run `crbn init`.
2. Run `pnpm install`.
3. Run `crbn up` when the proxy is live.

**Verify:**

```bash
crbn list
# Expected: this worktree shows a running stack.
```

If the proxy is not running, STOP and report. The user must start it.

**Out of scope:** other worktrees and their stacks.

## Task 2: Add the `supplierStage` schema and registrations

**Depends on:** 1
**Files:**

- Create: a migration from `pnpm db:migrate:new supplier-stage`
- Modify: `packages/database/src/seed-data.ts` — export `supplierStages`
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — insert the stages beside `customerStatuses`
- Modify: `packages/database/src/datasets/bootstrap.ts` — insert the stages beside `customerStatuses`
- Modify: `packages/database/src/datasets/wipe.ts` — add `supplierStage` beside `customerStatus`
- Modify: `packages/database/src/authz/manifest.ts` — `supplierStage: company("purchasing", { read: "member" })`
- Modify: `packages/database/src/audit.config.ts` — `supplierStageId` on `supplier`, and `supplierStage: ["name"]`
- Copy from (precedent): `customerStatus` in the same files

**Steps:**

1. Write the SQL from the spec section Data Model Changes for `supplierStage`, the `supplier` column and the seed insert.
2. Add the FK from `supplier` to `supplierStage` with `ON DELETE SET NULL ("supplierStageId")`.
3. Read the latest `suppliers` view definition. Recreate the view with `s."supplierStageId"` added.
4. Generate the authz migration with the command that `.claude/rules/authz-manifest.md` names.
5. Run `pnpm db:migrate`.

**Verify:**

```bash
grep -c '"supplierStage"' packages/database/src/types.ts
# Expected: a count above 0.
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: success.
```

If recreating the view fails on a dependent object, STOP and report.

**Out of scope:** `supplierStatusType` and all approval code.

## Task 3: Add the Supplier Stage services, routes and pages

**Depends on:** 2
**Files:**

- Modify: `apps/erp/app/modules/purchasing/purchasing.models.ts` — `supplierStageValidator`, and `supplierStageId` in the supplier validators
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — get, list, upsert, delete
- Modify: `apps/erp/app/modules/purchasing/purchasing.server.ts` — operations, and `supplierStageId` in the supplier inputs
- Modify: `apps/erp/app/modules/purchasing/types.ts` — `SupplierStage`
- Create: `apps/erp/app/modules/purchasing/ui/SupplierStages/{SupplierStageForm,SupplierStagesTable}.tsx`
- Create: `apps/erp/app/routes/x+/purchasing+/supplier-stages{,.new,.$supplierStageId,.delete.$supplierStageId}.tsx`
- Create: `apps/erp/app/routes/api+/purchasing.supplier-stages.ts`
- Modify: `apps/erp/app/utils/path.ts`, `apps/erp/app/utils/list-registry/purchasing.server.ts`, `apps/erp/app/modules/purchasing/ui/usePurchasingSubmodules.tsx`, `apps/erp/app/components/Form/emptyStates.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/sales+/customer-statuses*.tsx`, `apps/erp/app/modules/sales/ui/CustomerStatuses/`

**Steps:**

1. Copy each customer status file and rename it. Change the permission module from `sales` to `purchasing`.
2. Add the operations to `purchasing.server.ts` in the shape of `createCustomerStatus` and `updateCustomerStatus`.
3. Add a "Stages" entry under Configure in the sidebar.

**Verify:**

```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success.
```

**Out of scope:** CSV import and workflow rule conditions.

## Task 4: Show the stage on the supplier form, table and header

**Depends on:** 3
**Files:**

- Create: `apps/erp/app/components/Form/SupplierStage.tsx`
- Modify: `apps/erp/app/components/Form/index.ts`
- Modify: `apps/erp/app/modules/purchasing/ui/Supplier/SupplierForm.tsx`, `SuppliersTable.tsx`, `SupplierHeader.tsx`
- Modify: `apps/erp/app/routes/x+/purchasing+/suppliers.tsx`, `apps/erp/app/routes/x+/supplier+/_layout.tsx`, `apps/erp/app/routes/x+/supplier+/$supplierId.details.tsx`
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — `getSuppliers` stage filter and list columns
- Copy from (precedent): `apps/erp/app/components/Form/CustomerStatus.tsx`, `apps/erp/app/modules/sales/ui/Customers/CustomersTable.tsx:113`, `apps/erp/app/modules/sales/ui/Customer/CustomerHeader.tsx:79`

**Steps:**

1. Copy `CustomerStatus.tsx` to `SupplierStage.tsx`. Keep the inline create.
2. Add the Stage field below Supplier Status on the form.
3. Add the Stage column and its filter, from the loader's stage list.
4. Show the stage in the supplier header.

**Verify:** Open the running app. Run each Supplier Stage acceptance criterion in the spec.

🛑 Stop. Report to the user.

## Task 5: Add the shipping columns, the setting and regenerate types

**Depends on:** 1
**Files:**

- Create: a migration from `pnpm db:migrate:new purchase-order-shipping-dates`

**Steps:**

1. Add `shippedDate` and `expectedReceiptDate` to `purchaseOrderDelivery`.
2. Add `requirePromisedDateToFinalizePurchaseOrder` to `companySettings`.
3. Read the latest `purchaseOrders` view in `20260811123616_widen-purchasing-scale.sql`, and check for newer definitions. Recreate the view with both dates.
4. Run `pnpm db:migrate`.

**Verify:**

```bash
grep -c 'expectedReceiptDate' packages/database/src/types.ts
# Expected: a count above 0.
```

## Task 6: Allow the shipping fields after release

Main made the Shipping card editable on a released order, so this task adds only the validator and operation fields.

**Depends on:** 5
**Files:**

- Modify: `apps/erp/app/modules/purchasing/purchasing.models.ts` — validator fields
- Modify: `apps/erp/app/modules/purchasing/purchasing.server.ts` — `updatePurchaseOrderDelivery`
- Modify: `apps/erp/test/database/purchasing-guards.test.ts`

**Steps:**

1. Add `shippedDate` and `expectedReceiptDate` to `purchaseOrderDeliveryValidator` and `updatePurchaseOrderDelivery`.
2. Write a database test for a To Receive and a Completed order.

**Verify:**

```bash
pnpm --filter erp exec vitest run app/modules/purchasing/purchasing.models.test.ts
# Expected: all tests pass.
```

## Task 7: Add the shipping fields to the card and the list

**Depends on:** 6
**Files:**

- Modify: `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderDeliveryForm.tsx`
- Modify: `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx`
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — `PURCHASE_ORDER` list columns
- Modify: `apps/erp/app/routes/x+/purchase-order+/$orderId.details.tsx` — initial values, if the route sets them
- Copy from (precedent): the `deliveryDate` field and the promised date column in the same files

**Steps:**

1. Add the two date fields beside Delivery Date.
2. Keep the card as it is on main.
3. Add both list columns.

**Verify:** Open a To Receive order in the running app. Edit the four fields on the Shipping card.

## Task 8: Add the promised date rule and toggle

**Depends on:** 5
**Files:**

- Modify: `apps/erp/app/modules/purchasing/purchasing.models.ts` and its test — `isPurchaseOrderMissingPromisedDate`
- Modify: `apps/erp/app/modules/purchasing/purchasing.server.ts` — `finalizePurchaseOrderAndNotify`, `decidePurchaseOrderApproval`
- Modify: `apps/erp/app/routes/x+/settings+/purchasing.tsx` — toggle card
- Modify: `apps/erp/app/modules/settings/settings.server.ts` — the `settings.purchasing.update` input
- Modify: `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderHeader.tsx`, `PurchaseOrderFinalizeModal.tsx`
- Copy from (precedent): the `requireSupplierContactEmailToggle` card in `settings+/purchasing.tsx`

**Steps:**

1. Write the pure refusal with tests. It takes the lines and the setting, and it uses `promisedDateOf`. It skips Comment lines.
2. Call the refusal in `finalizePurchaseOrderAndNotify` before the approval fork.
3. Call the refusal in `decidePurchaseOrderApproval` when the decision approves.
4. Add the toggle card.
5. Show the reason in the finalize modal and disable its Finalize button when the rule fails.

**Verify:** Run each Promised date rule acceptance criterion in the spec.

🛑 Stop. Report to the user.

## Task 9: Add the pure function that builds the rows

**Depends on:** none
**Files:**

- Modify: `apps/erp/app/modules/purchasing/purchasing.models.ts` and its test — `getRfqLinesFromMethod`

**Steps:**

1. Take the flat `get_method_tree` rows. Return one row per item with `itemId`, summed `quantity` and `usedIn`.
2. Walk into `Make to Order` lines. Do not list them.
3. Skip a line whose `replenishmentSystem` is `Make`.
4. Multiply each child quantity by its parent quantity.
5. Write tests with the EPS-001 shape from the satellite dataset: MAT-KAPTON sums to 6 across 2 parents.

**Verify:**

```bash
pnpm --filter erp exec vitest run app/modules/purchasing/purchasing.models.test.ts
# Expected: all tests pass.
```

## Task 10: Add the `requestQuoteFromItem` operation and the popup data route

**Depends on:** 9
**Files:**

- Modify: `apps/erp/app/modules/purchasing/purchasing.server.ts` — `requestQuoteFromItem` with `@mcp`
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — insert building blocks that take `db`
- Create: `apps/erp/app/routes/api+/purchasing.request-quote.$itemId.ts`
- Create: `apps/erp/app/routes/x+/purchasing-rfq+/request-quote.tsx`
- Modify: `apps/erp/app/utils/path.ts`

**Steps:**

1. Read `.claude/rules/purchasing-conversion-factors.md`. Convert each quantity to the purchase unit.
2. Group the lines by supplier.
3. In one `ctx.transaction`, create each RFQ with its supplier and its lines.
4. Return the new RFQ ids.
5. In the data route, read the active make method, the tree, `preferredSupplierId` and the supplier parts. Use one `.in()` query.
6. Redirect to the RFQ page for one id. Redirect to the filtered RFQ list for more than one id.

**Verify:**

```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success.
```

If a building block for an RFQ insert cannot run in a transaction, STOP and report.

## Task 11: Add the menu item and the popup

**Depends on:** 10
**Files:**

- Create: `apps/erp/app/modules/purchasing/ui/PurchasingRfq/RequestQuoteModal.tsx`
- Modify: `apps/erp/app/modules/items/ui/Item/ItemRecordHeader.tsx`
- Copy from (precedent): `apps/erp/app/modules/items/ui/ChangeNotice/CreateChangeNoticeModal.tsx`

**Steps:**

1. Add Request Quote above Create Change Notice. Disable it without `create` on `purchasing`.
2. Build the popup from the approved design: search, Builds, rows, Supplier dropdowns, This part only, and the footer summary.
3. Use only the components in `packages/react/src/` and `apps/erp/app/components/`.

**Verify:** Run each Request Quote acceptance criterion in the spec, on the satellite demo data.

🛑 Stop. Report to the user.

## Task 12: Update docs and run the final checks

**Depends on:** 4, 8, 11
**Files:**

- Modify: `apps/erp/app/modules/purchasing/AGENTS.md`
- Modify: `docs/content/docs/reference/purchase-orders.mdx`, `docs/content/src/glossary/terms.ts`
- Modify: `.ai/playbooks/po-promised-date-after-confirm.md` — the Shipping card line under Expected

**Steps:**

1. Update the docs for each new field, setting and menu item.
2. Run `pnpm lingui:extract`.
3. Run `pnpm run lint`.
4. Run `pnpm db:check:datasets`.
5. Run `pnpm db:check:backups`. Do not commit a junk root `manifests/schema.json`.

**Verify:**

```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success.
pnpm --filter erp exec vitest run app/modules/purchasing
# Expected: all tests pass.
```
