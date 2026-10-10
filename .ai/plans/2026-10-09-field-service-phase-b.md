# Field Service Phase B — depot repair through the RMA — implementation plan

**Spec:** .ai/specs/2026-10-08-field-service.md (*Depot Repair through the RMA*, decision 14, Phase B acceptance criteria, Risks)
**Branch:** projects-wbs-research-spec
**Prerequisite:** `.ai/plans/2026-10-09-field-service-phase-a.md` is done and committed. This plan uses `serviceOrder`, `customerAsset`, `createServiceProject`, `resolveCoverage` and the Service module. If one of them is missing, STOP and report.

## Scope of this plan

A customer returns a unit for repair. The company repairs it and ships the same serial back. The unit never enters company stock or stock value.
1. **The `Repair` disposition** is set before receipt, on serialized lines only, and locked after receipt.
2. **The receipt of a `Repair` line** writes no stock ledger, no cost layer and no journal. The serial stays `Consumed`. The asset shows At Depot. Carbon creates one Depot Repair order per received serial.
3. **The shop works the order.** Charges post by coverage, as in Phase A.
4. **The return shipment of a `Repair` line** writes no stock ledger, no COGS and no journal. The asset is In Service again.
5. **Guards:** a `Repair` line gets no credit memo and no replacement order. Voids keep the serial `Consumed`.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/field-service.md` (from Phase A), `.claude/rules/inventory-system.md`, `.claude/rules/traceability-model.md`, `.claude/rules/shipments-receipts-ui-patterns.md` and `apps/erp/app/modules/sales/AGENTS.md` before Task 1.
- 🛑 Branch only on `disposition = 'Repair'`. Every other RMA line must post exactly as today. The risk table rates this change High.
- The DB enum `disposition` already has `Repair` (`20251114222648_supplier_id.sql:3-15`). Do not add it again.
- Use the `carbon-design` skill for every UI task.
- Never query in a loop. Never construct a database client in a `*.service.ts`.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Decisions this plan makes

| # | Decision | Why |
|---|---|---|
| B1 | The link is `serviceOrder.salesReturnOrderLineId`, not `salesReturnOrderLine.serviceOrderId`. | One RMA line can return several serials, and each serial gets its own order (spec decision 9). A column on the line holds one order only. |
| B2 | `Repair` needs an item tracked by Serial. | An order has one subject serial. A batch or untracked unit has no identity to ship back. |
| B3 | A missing customer asset is created at receipt with source `Manual`. | A unit shipped before Carbon, or before the asset backfill, has no asset. The repair must still work. |
| B4 | A receipt void of a `Repair` line cancels its orders, and refuses when an order has posted charges. | The order's subject is no longer at the depot. Posted cost needs a decision by a person. |
| B5 | A replacement order skips `Repair` lines, and is refused when every line is `Repair`. | `createReplacementSalesOrder` works on the whole RMA. Other lines of the same RMA can still be replaced. |

Task 12 records these in the spec.

## Progress

- [x] Task 1: Add the service order link migration
- [x] Task 2: Move service order creation into a shared helper
- [x] Task 3: Allow `Repair` before receipt and lock it after
- [x] Task 4: Post a `Repair` receipt with no ledger
- [x] Task 5: Void a `Repair` receipt
- [x] Task 6: Let the return shipment take `Repair` serials
- [x] Task 7: Post a `Repair` return shipment with no ledger
- [x] Task 8: Guard the credit memo and the replacement order
- [x] Task 9: Add the depot repair UI
- [ ] Task 10: Add the database tests
- [ ] Task 11: Extend the demo datasets
- [ ] Task 12: Update the rules, AGENTS.md, docs and spec
- [ ] Task 13: Verify in the browser

## Dependencies

- Task 1 runs first. Task 2 needs Task 1.
- Task 3 needs Task 1. Tasks 4 and 5 need Tasks 2 and 3.
- Task 6 needs Task 3. Task 7 needs Task 6.
- Task 8 needs Task 3. Task 9 needs Tasks 4 and 7.
- Task 10 needs Tasks 4–8. Task 11 needs Task 4. Task 12 needs Tasks 1–11. Task 13 runs last.

---

## Task 1: Add the service order link migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_depot-repair.sql`
- Modify: generated types

**Steps:**
1. Run `pnpm db:migrate:new depot-repair`. Write:

```sql
ALTER TABLE "serviceOrder" ADD COLUMN IF NOT EXISTS "salesReturnOrderLineId" TEXT;
ALTER TABLE "serviceOrder" ADD CONSTRAINT "serviceOrder_rmaLine_fkey"
  FOREIGN KEY ("salesReturnOrderLineId") REFERENCES "salesReturnOrderLine"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "serviceOrder_rmaLine_idx" ON "serviceOrder" ("salesReturnOrderLineId") WHERE "salesReturnOrderLineId" IS NOT NULL;
ALTER TABLE "serviceOrder" ADD CONSTRAINT "serviceOrder_depot_check"
  CHECK ("type" <> 'Depot Repair' OR "salesReturnOrderLineId" IS NOT NULL);
```

2. Check the `salesReturnOrderLine` primary key in `20260908142501_returns-module.sql:137-168`. If it is composite, make the FK composite with `"companyId"`.
3. Run `pnpm db:migrate`, then `pnpm run generate:types`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit code 0
```

**Out of scope:** `salesReturnOrderLine.serviceOrderId` (decision B1 replaces it).

---

## Task 2: Move service order creation into a shared helper

**Depends on:** 1
**Files:**
- Create: `packages/server-functions/src/lib/service-orders.ts`
- Create: `packages/server-functions/src/lib/service-orders.test.ts`
- Modify: `apps/erp/app/modules/service/service.server.ts` (`createServiceOrder`)
- Modify: `apps/erp/app/modules/projects/projects.server.ts` (`createServiceProject`)

**Steps:**
1. `post-receipt` must create orders inside its own transaction, and it cannot import ERP code. Move the insert logic of `createServiceProject` and of `createServiceOrder` (Phase A Task 17) into `insertServiceOrder(trx, args)` in `service-orders.ts`. It does these steps:
   1. Read the `serviceOrder` sequence.
   2. Insert the order.
   3. Insert the Service project (`projectType 'Service'`, identifier = the readable id, Released, By Coverage, `parentProjectId` from the contract) and its default states.
   4. Set `serviceOrder.projectId`.
2. Add `ensureCustomerAsset(trx, { companyId, userId, trackedEntityId, customerId, customerLocationId })`. It returns the asset id, and inserts an asset with source `Manual` when none exists (decision B3).
3. Export both from the package (add the paths to `packages/server-functions/package.json` exports, as the other `lib` helpers are exported).
4. The ERP `createServiceOrder` and `createServiceProject` call `insertServiceOrder`. Keep their signatures, so the Phase A routes need no change.
5. Write `service-orders.test.ts` (`databaseTest`): `insertServiceOrder` creates the order, the project and 6 states in one transaction; a forced error rolls back all three.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- service-orders && pnpm exec turbo run typecheck --filter=erp
# Expected: all tests pass; typecheck exits 0
```

**Out of scope:** changing the order fields.

---

## Task 3: Allow `Repair` before receipt and lock it after

**Depends on:** 1
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` (`salesReturnDispositionType` `:1259-1271`)
- Modify: `apps/erp/app/modules/sales/sales.service.ts` (`setSalesReturnOrderLineDisposition` `:8349-8575`)
- Modify: `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderLineForm.tsx` (`:442-471`)
- Modify: `apps/erp/app/routes/x+/sales-return-order+/$id.$lineId.disposition.tsx`

**Steps:**
1. Un-comment `Repair` in `salesReturnDispositionType` (`:1266`).
2. In `setSalesReturnOrderLineDisposition`:
   1. Before receipt (`:8388-8398`), allow `Pending` and `Repair`. Keep refusing the other values.
   2. Refuse `Repair` when the line's item is not tracked by Serial (decision B2). Read `itemTrackingType` with the line.
   3. Under the row lock (`:8493-8505`), refuse a change to or from `Repair` when `quantityReceived > 0`. The receipt posted with no ledger, so a later change would leave stock wrong.
3. In the line form, enable the select before receipt with only **Pending** and **Repair**. After receipt, hide **Repair** unless it is the current value, and disable the select when it is.
4. In the disposition route, keep the `Scrap` / `Rework` redirect. `Repair` posts like the other plain values.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** dispositions of batch items.

---

## Task 4: Post a `Repair` receipt with no ledger

**Depends on:** 2, 3
**Files:**
- Modify: `packages/server-functions/src/post-receipt/index.ts` (case `Sales Return Order`, `:2588-3196`)

**Steps:**
1. Add `disposition` to the RMA line read (`:2605-2627`). Add `customerLocationId` to the RMA header read.
2. In the per-line loop, after `returnLine` resolves (`:2764-2770`), branch on `returnLine.disposition === "Repair"`:
   1. Skip the `itemLedger` pushes (`:2824-2907`), the cost layer (`:2912-2929`) and the journal (`:2933-2983`).
   2. Keep the `quantityReceived` update (`:2985-2991`).
   3. Do not add the serials to `trackedEntityUpdates`. They stay `Consumed`.
   4. Collect the line's serials (the `receiptLineTracking` rows of this receipt line) into `repairSerials`.
3. Inside the transaction, after the RMA lock (`:3030`), for each serial in `repairSerials`:
   1. Call `ensureCustomerAsset`, and set the asset's status to `At Depot`.
   2. Call `insertServiceOrder` with type `Depot Repair`, the RMA's customer and site, the receiving location, the asset, and `salesReturnOrderLineId`.
   3. Insert a `trackedActivity` of type `Return Receipt` with attributes `{ "Sales Return Order", Receipt, Employee, "At Depot": true, "Service Order": <id> }` and a `trackedActivityOutput` for the serial. The existing activity code runs only when `trackedEntityUpdates` is not empty (`:3147`), so this path writes its own.
4. A `Repair` line with no serial on the receipt is refused with "Assign the serial before posting a repair receipt".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: exit code 0 (Task 10 adds the database test)
```

**Out of scope:** the receipt of other dispositions.

---

## Task 5: Void a `Repair` receipt

**Depends on:** 2, 3
**Files:**
- Modify: `packages/server-functions/src/post-receipt/index.ts` (void branch `:293-566`)

**Steps:**
1. Load the Depot Repair orders whose `salesReturnOrderLineId` is in the receipt's RMA lines, with one query.
2. If one of them has a posted `projectLedger` row, refuse the void with "Service order <id> has posted charges. Reverse them before you void this receipt." (decision B4).
3. Otherwise, inside the void transaction:
   1. Set each order to Cancelled and its project to Closed.
   2. Set each asset back to `In Service`.
4. Keep the serials of `Repair` lines `Consumed`. Today the void sets every receipt entity to `Consumed` (`:531-552`), which is already right for them.
5. Write the `Void Receipt` activity as today.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: exit code 0
```

**Out of scope:** reversing service charges automatically.

---

## Task 6: Let the return shipment take `Repair` serials

**Depends on:** 3
**Files:**
- Modify: `packages/server-functions/src/create/index.ts` (`:2060-2064`)
- Modify: `apps/erp/app/routes/x+/shipment+/lines.tracking.tsx` (`:99-140`)
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentLines.tsx` (`expectedEntityStatus` `:683-686` and its uses)
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentPostModal.tsx` (`:58-60`, `:163`)
- Modify: `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderHeader.tsx` (`:91-93`, `:218-232`)

**Steps:**
1. In `create`, accept lines with disposition `Return to Customer` or `Repair`. For a `Repair` line, the quantity to ship is the count of its Depot Repair orders that are Completed and not yet shipped back.
2. In the shipment tracking route, let a `Repair` line accept a `Consumed` serial. Require 2 things:
   - its asset is `At Depot`;
   - its `Receipt` attribute points at a receipt of this RMA.

   Keep the `On Hold` rule for other lines.
3. In `ShipmentLines`, `expectedEntityStatus` returns `Consumed` for a `Repair` line and `On Hold` otherwise. Pass the line's disposition through its props.
4. In `ShipmentPostModal`, use the same rule.
5. The RMA header's **Ship** button shows when a `Return to Customer` line has a received quantity, or a `Repair` line has a Completed order.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/server-functions
# Expected: exit code 0
```

**Out of scope:** shipping a unit before its order is Completed.

---

## Task 7: Post a `Repair` return shipment with no ledger

**Depends on:** 6
**Files:**
- Modify: `packages/server-functions/src/post-shipment/index.ts` (case `Sales Return Order` `:1985-2403`, void `:4084-4345`)

**Steps:**
1. Before the line loop (`:2080`), load the RMA lines by `shipmentLines.data[].lineId` with one query (`id`, `disposition`). `shipmentLine.lineId` holds the RMA line id (`create/index.ts:2172`).
2. For a `Repair` line:
   1. Skip the `itemLedger` rows (`:2105-2162`) and leave the line out of `itemShipmentQuantities`, so it gets no cost (`:2196`).
   2. Write no journal line for it.
   3. Keep the serial `Consumed`.
   4. Write the `Return Shipment` activity with attribute `"At Depot": false`.
   5. Update the asset: status `In Service`, the RMA's site, ship date = the posting date, `shipmentId`.
3. The order stays Completed. It goes to Closed when it is invoiced, or with **Close** (spec *Depot Repair*, step 5).
4. In the void (`:4084-4345`), a `Repair` line keeps its serial `Consumed`, not `On Hold` (`:4310-4316`). Set the asset back to `At Depot`. There is no ledger to reverse.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: exit code 0
```

**Out of scope:** the Phase A customer asset upsert for `Sales Return Order`, which this replaces for `Repair` lines only.

---

## Task 8: Guard the credit memo and the replacement order

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` (`getCreditableQuantities` `:7981-8029`, `createSalesReturnOrderCredit` `:8041-8215`, `createReplacementSalesOrder` `:8224-8338`)

**Steps:**
1. Both functions are MCP tools, so put the guards in the service, not only in the routes.
2. `getCreditableQuantities` leaves out `Repair` lines, so the credit modal hides them.
3. `createSalesReturnOrderCredit` adds `disposition` to its locked select (`:8103-8109`). In the line loop (`:8156-8183`) it refuses a `Repair` line with "Change the disposition before you credit a repair line."
4. `createReplacementSalesOrder` skips `Repair` lines when it copies lines (`:8257-8324`). If every line is `Repair`, it refuses with "Every line is a repair. There is nothing to replace." (decision B5).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** a credit for a repair the company cannot complete. The user changes the disposition first, which Task 3 allows only before receipt; after receipt, the user voids the receipt (Task 5).

---

## Task 9: Add the depot repair UI

**Depends on:** 4, 7
**Files:**
- Modify: `apps/erp/app/routes/x+/sales-return-order+/$id.$lineId.details.tsx` (loader `:27-127`)
- Modify: `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderLineForm.tsx` (`linkage` `:66-73`, `SourceReference` `:78-111`)
- Modify: `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderExplorer.tsx` (`:370-398`)
- Modify: `apps/erp/app/modules/service/ui/ServiceOrders/ServiceOrderHeader.tsx`, `ServiceOrdersTable.tsx`
- Modify: `apps/erp/app/modules/service/ui/CustomerAssets/CustomerAssetsTable.tsx`, `CustomerAssetPage.tsx`

**Steps:**
1. The RMA line loader reads the line's Depot Repair orders (`salesReturnOrderLineId` = the line) with one query. `linkage` lists each order's id, readable id and status. The line form shows one `SourceReference` link per order, labelled "Service order SVC000123".
2. The RMA explorer row shows the order count and the worst status.
3. On a Depot Repair order:
   - the header shows a link to the RMA and the badge **At depot** while the asset is At Depot;
   - **Complete** works with no visit (shop orders, spec *Lifecycle*);
   - **Ship back** links to the RMA, where the user creates the return shipment.
4. The order list gets a **Type** filter (Field Visit, Depot Repair).
5. The asset list and page show the **At Depot** status.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** a precheck that decides repair or return (later work).

---

## Task 10: Add the database tests

**Depends on:** 4, 5, 6, 7, 8
**Files:**
- Create: `packages/server-functions/src/post-receipt/sales-return-repair.test.ts`
- Create: `packages/server-functions/src/post-shipment/sales-return-repair.test.ts`
- Copy from (precedent): `packages/server-functions/src/post-customer-contract/contract-lifecycle.test.ts:185` (running a server function in a `databaseTest`); `packages/server-functions/src/local-database-test-fixture.ts:33`

**Steps:**
1. No RMA test for `post-receipt` or `post-shipment` exists today. Build a fixture: a serialized item, a customer asset for serial `SN-0001`, and an RMA with one `Repair` line, confirmed.
2. `sales-return-repair.test.ts` (receipt):
   1. Posting the receipt writes no `itemLedger` row, no `costLedger` row and no journal for the line.
   2. The serial stays `Consumed`. The asset is `At Depot`. One Depot Repair order exists, linked to the RMA line, with its Service project.
   3. A `Return to Customer` line on the same receipt still posts its ledger and journal as before.
   4. The void cancels the order and sets the asset back to `In Service`. With a posted charge on the order, the void is refused.
3. `sales-return-repair.test.ts` (shipment):
   1. With the order Completed, the return shipment writes no `itemLedger`, no `costLedger` and no journal for the line.
   2. The asset is `In Service` with the new ship date.
   3. The on-hand quantity of the item is unchanged from before the RMA receipt to after the shipment.
   4. The void keeps the serial `Consumed` and sets the asset to `At Depot`.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- sales-return-repair
# Expected: all tests pass
```

**Out of scope:** UI tests.

---

## Task 11: Extend the demo datasets

**Depends on:** 4
**Files:**
- Modify: `packages/database/src/datasets/types.ts` (`SalesReturnLineSpec` `:818-854` gains an optional `disposition`)
- Modify: `packages/database/src/datasets/tiers/04-sales.ts` (`:478-590`)
- Modify: `packages/database/src/datasets/data/satellite/sales.ts` (`SALES_RETURNS` `:927-963`)
- Modify: `packages/database/src/datasets/validate.ts` (`:942-949`)

**Steps:**
1. Add one RMA in status `To Receive` to the satellite dataset. Its one line has disposition `Repair`, for a serialized item that has a seeded customer asset (Phase A Task 29).
2. Tier 04 writes `disposition` on RMA lines when the spec sets it.
3. In `validate.ts`, leave `Repair` lines out of the on-hand count of received RMA lines. A repair never adds stock.
4. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** a received repair in the datasets.

---

## Task 12: Update the rules, AGENTS.md, docs and spec

**Depends on:** 1–11
**Files:**
- Modify: `.claude/rules/field-service.md`, `.claude/rules/inventory-system.md`, `.claude/rules/traceability-model.md`
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — the `Repair` disposition, and the RMA status list. It says "Draft → Confirmed → Partially Received → Received". The code has Draft, To Receive, Completed and Cancelled.
- Modify: `docs/content/docs/reference/service-orders.mdx`, and the RMA reference page
- Modify: `.ai/specs/2026-10-08-field-service.md`

**Steps:**
1. Document the `Repair` branches of `post-receipt` and `post-shipment`, the disposition rules, and the voids.
2. In the spec, record decisions B1–B5. Replace `salesReturnOrderLine.serviceOrderId` with `serviceOrder.salesReturnOrderLineId` in *Data Model Changes* and *Depot Repair*. Mark Phase B done.
3. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
```

**Out of scope:** the changelog entry.

---

## Task 13: Verify in the browser

**Depends on:** 1–12
**Files:**
- Create: `.ai/playbooks/field-service-phase-b.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company with accounting on.
2. Cover the spec's Phase B acceptance criteria:
   1. **Repair receipt:** set **Repair** on the seeded RMA line before receipt, then receive serial `SN-0001`. No stock moves, the asset shows At Depot, and a Depot Repair order links to the RMA line.
   2. **Repair work:** time and a part on the order post by coverage.
   3. **Ship back:** after **Complete**, ship the serial back from the RMA. No stock moves, the asset is In Service, and the order closes after its invoice.
   4. **Guards:** the RMA's credit modal hides the repair line, and the item's on-hand quantity is unchanged through the whole repair.
3. Save the playbook to `.ai/playbooks/field-service-phase-b.md`.

**Verify:**
```bash
ls .ai/playbooks/field-service-phase-b.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** Phase C.

## Execution notes

- Prerequisite check: the Phase A artifacts this plan names exist (`serviceOrder`, `customerAsset`, `createServiceProject`, `resolveCoverage`, the Service module).
- Task 1 (deviation): `salesReturnOrderLine` has a composite primary key, so the FK is composite (`"salesReturnOrderLineId", "companyId"`), and so is the index. The FK is NO ACTION, not `ON DELETE SET NULL`: `serviceOrder_depot_check` needs the line on a Depot Repair order, so a SET NULL could only fail with a CHECK error. Deleting an RMA line that has a depot order is refused by the FK instead. The FK lets the backup restore remap the column, so `ID_REF_COLUMNS` needs no entry. `pnpm db:migrate` applied the migration and regenerated the types and swagger; the workflow catalog did not change.
- Task 1: `pnpm db:check:backups` fails on `supplierPartPrice.unitPrice` ("required since this backup"), a column this branch does not touch: the upstream `main` manifest differs from this branch's schema there. The commit skips that check with `CARBON_SKIP_BACKUP_CHECK=1`. The new column is nullable, so it blocks no restore.
- Task 2 (deviation): `insertServiceOrder` inserts the project before the order, not after: `serviceOrder.projectId` is NOT NULL (the Phase A Task 17 reason). The project half is its own export, `insertServiceProject`. The package exports the file as `@carbon/server-functions/lib/service-orders`.
- Task 2: `defaultProjectStates` moved to `@carbon/utils` (`project-states.ts`), because the server functions cannot import ERP code; `projects.models.ts` re-exports it, so its callers are unchanged.
- Task 2 (deviation): the ERP `createServiceProject` is removed, not kept: its only caller was `createServiceOrder`, which now calls `insertServiceOrder`. No route called it. `createServiceOrder` keeps its signature. The service `AGENTS.md` names the new helpers.
- Task 2 (fix found by the test): the project of an order was named "<serial> — <customer>", and a project's name is unique in its company (`project_companyId_name_key`). So a unit's second service order, after the first was Closed, failed on insert. The name is now "<order id> — <serial> — <customer>". A Depot Repair order on a unit that had a Field Visit order hits the same case.
- Task 2: `service-orders.test.ts` (3 database cases): the order, its Service project (Released, By Coverage, identifier = the order id) and 6 states; a forced error rolls back all three and the sequence; `ensureCustomerAsset` returns the existing asset, and creates a Manual one for an unregistered serial.
- Task 3: the non-Use-As-Is path of `setSalesReturnOrderLineDisposition` had no row lock (only Use As Is opens a transaction). So a change to or from `Repair` now writes in its own transaction under the return order's row lock (the lock `post-receipt` takes) and re-reads `quantityReceived` there. Task 4 closes the other side: `post-receipt` re-reads the dispositions under that lock. The refusal text is `REPAIR_DISPOSITION_LOCKED_MESSAGE` (`sales.models.ts`); `salesReturnPreReceiptDispositions` lists Pending and Repair.
- Task 3: the line's Issue route (`$id.$lineId.issue.tsx`) writes Scrap or Rework directly, not through the setter, so it refuses a `Repair` line too. The line form offers **Repair** before receipt only for a serial-tracked item.
- Task 3: the disposition route needed no change: `Repair` posts like the other plain values.
- Task 4: the RMA line read already returns every column, so `disposition` and the header's `customerLocationId` needed no new select. The Repair branch sits right after the item resolves: it refuses an item that is not serial-tracked ("Only a serialized item can be received for repair") and a line with fewer assigned serials than its received quantity, adds the line's received quantity, and skips every ledger push. The order writes live in `post-receipt/repair.ts` (`createDepotRepairOrders`).
- Task 4 (deviation): `ensureCustomerAsset` became `ensureCustomerAssets` (many serials, 3 statements), so a receipt of several serials does not read once per serial. `insertServiceOrder` and the activity still write once per serial.
- Task 4: under the return order's lock, the posting re-reads the received lines' dispositions and refuses ("A line's disposition changed while the receipt was posting. Post the receipt again.") when a line's Repair state differs from the one it was posted by (the other half of the Task 3 race).
- Task 4: a serial that already has an open service order is refused before any write ("Serial … has an open service order (SVC…). Close or cancel it before you receive the unit for repair."), instead of failing on `serviceOrder_open_subject_key`.
- Task 4 (deviation): the spec says the order takes its coverage contract "from the RMA", and the RMA has no contract column. The order takes the customer's only Active contract, the rule the ERP's New Service Order proposes; with none or several, it has none. The contact is the RMA's contact; the location is the receipt line's location, else the RMA's, else the receipt's.
- Task 4: Task 10's receipt test came early (`post-receipt/sales-return-repair.test.ts`, on the new `lib/sales-return-test-fixture.ts`): one receipt with a Repair line for SN-0001 and a Return to Customer line for 2 widgets. Only the widget line writes `itemLedger`, `costLedger` and its 2 journal lines (20.00 each); the machine's on-hand does not move; the serial stays Consumed; the asset is At Depot; one Draft Depot Repair order links to the line with its Released Service project; the activity carries `At Depot` and the order id. A Repair line without its serial is refused, and a serial with no asset gets a Manual one. With the Repair branch disabled, all 3 cases fail.
- Task 5: `voidDepotRepairOrders` (`post-receipt/repair.ts`) runs inside the void transaction and locks the orders it reads: the Depot Repair orders of this receipt's serials on its Repair lines that are not Cancelled. A partial receipt's void therefore cancels only its own serials' orders. "Posted charges" means a charge that is not reversed (`openChargeIds`, the Phase A cancel fix), so reversing the charges does let the void through. It also cancels the orders' open visits, clears the completion stamp, and refuses an order whose unit is no longer At Depot ("Void its return shipment before you void this receipt").
- Task 5: 2 more cases in the receipt test: the void cancels the order, closes its project, sets the asset In Service, keeps the serial Consumed, and still reverses the widget line's stock; a void with an open charge is refused, and goes through once the charge is reversed.
- Task 6 (deviation): a Repair line ships the units whose Depot Repair order is Completed **or Closed**, and whose asset is still At Depot. An order goes to Closed at its invoice, and a company may invoice before it ships the unit back; counting only Completed would strand that unit. The asset leaves At Depot when the return shipment posts (Task 7), so the count needs no prior-shipment netting.
- Task 6: the shipment tracking route checks a third thing for a Repair line besides the asset and the `Receipt` provenance: the serial has a Depot Repair order on this line that is Completed or Closed ("Complete the unit's service order before you ship it back"), as `create` counts.
- Task 6: `ShipmentLines` and `ShipmentPostModal` get the RMA's Repair line ids from the shipment layout loader (`repairLineIds`, one query for a Sales Return Order shipment), not from the line itself: `shipmentLine` has no disposition. `expectedEntityStatus(shipment, isRepairLine)` (exported from `ShipmentLines.tsx`) is the one rule both use; only the serial form passes `isRepairLine`, because Repair needs a serial.
- Task 6: the RMA layout loader reads `getDepotRepairOrdersByReturnOrder` (`service.service.ts`, one query through the new FK), and **Ship** also shows when one of them `isReadyToShipBack` (`service.models.ts`). The read goes through RLS, so a user without `service_view` sees no orders and no Ship button for a Repair line; Task 9 uses the same data.
- Task 7: the Repair writes live in `post-shipment/repair.ts`: `loadRepairLineIds` (one query by the shipment lines' `lineId`), `shipRepairedUnits` and `unshipRepairedUnits`. A Repair line needs a serial per shipped unit; it writes no `itemLedger`, stays out of `itemShipmentQuantities` (so no cost layer and no journal), and its serial is not updated. Under the posting lock, `shipRepairedUnits` re-checks each unit's Depot Repair order on its line (Completed or Closed) and its asset (At Depot), so a shipment drafted before an order was reopened is refused. It writes one `Return Shipment` activity with `At Depot: false` (the units as inputs) and sets the assets In Service at the RMA's site (else their own), shipped today on this shipment.
- Task 7: the void leaves a Repair line's serial Consumed (the other lines' entities still go back On Hold) and sets its asset At Depot. The asset's ship date and shipment stay as the void found them.
- Task 7: Task 10's shipment test came early (`post-shipment/sales-return-repair.test.ts`, 2 cases): the shipment `create` drafts has no Repair line until the order is Completed, then has it with 1 unit; posting writes `itemLedger`, `costLedger` and 2 journal lines (20.00) for the widget line only; the machine's on-hand is the same before the RMA receipt and after the shipment; the serial stays Consumed and the asset is In Service with today's ship date, this shipment and the RMA's site; the activity carries `At Depot: false`; the order stays Completed; the void keeps the serial Consumed, sets the asset At Depot and restores the widget stock. A unit whose order was reopened after the shipment was drafted is refused at posting. With the Repair branch disabled, both cases fail.
- Task 7 verification: the full `@carbon/server-functions` suite passes (460 of 462); the 2 failures are the known shared-database races (`get-accounting-period`, `post-charge-concurrency`), which pass alone.
- Task 8: the refusal texts are constants in `sales.models.ts` (`REPAIR_LINE_CREDIT_MESSAGE`, `REPAIR_ONLY_REPLACEMENT_MESSAGE`). The credit refusal names the line: "Line 2: Change the disposition before you credit a repair line."
- Task 8 (deviation): the RMA header changes too, outside the task's file list. **Issue Credit** shows only when a line that is not Repair has a received quantity. **Create Replacement** hides when every line is Repair. Without this, both buttons opened a dialog or a request that the service then refuses.
- Task 9: the RMA line loader reads the line's orders with one query (`id`, `serviceOrderId`, `status`). The line form shows one **Service Order** link per order. The explorer uses the orders the RMA layout already loads (`depotRepairOrders`, Task 6), so it adds no query. It shows the count and the worst status in the line's expanded details. `worstServiceOrderStatus` (`service.models.ts`, tested) picks On Hold first, then the least advanced open status.
- Task 9: on a Depot Repair order, the header shows the RMA's readable id as a link, **View Return Order** in the ⋯ menu, and the **At Depot** asset status pill (the existing `CustomerAssetStatus`) while the unit is At Depot. **Complete** is the primary button, because a shop order has no visit. **Ship Back** links to the RMA while `isReadyToShipBack` holds. `getServiceOrder` now embeds the RMA line and its return order.
- Task 9: the order list gains a **Type** column with a filter (`listedServiceOrderTypes`: Field Visit, Depot Repair). The New form still offers Field Visit only.
- Task 9: the asset list and the asset page needed no change. Both render the status through `CustomerAssetStatus`, and the list filter reads `customerAssetStatuses`, which already has At Depot.
