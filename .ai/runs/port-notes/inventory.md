# Port notes: inventory (plan Phase 4, inventory)

Agent `inventory`. Worktree `kelowna-port`. Nothing committed.

## Method

For each server function I did a three-way merge, with `git merge-file --diff3`:

- base = the MB file (`23bd5d6e0b`). Main moved this exact version into
  `inventory.service.ts` in one commit (`6984e529d8`).
- theirs = the FREEZE file (`50c4309a9c`).
- ours = the function's region in `inventory.service.ts`.

Before the merge I changed base and theirs in the same way, so that they have main's shape.
The `defineServerFn({ … async run(ctx, x) {` wrapper became
`export async function name(ctx, raw) { const x = nameInput.parse(raw);`. I removed the
imports and `export default`, and ran `biome format`. After this, base and ours differed
only by main's own edits, so every branch hunk landed in its real position.

There were 10 conflicts. I resolved them by hand (see below). After the merge, every line
the branch added is in the file, except the 6 lines listed under "Not carried". I checked
this with a script over all 9 merged regions.

## Carried (carry-list line → new home)

- [x] `packages/server-functions/src/post-receipt/index.ts` → `postReceipt`, with the void
  path, in `apps/erp/app/modules/inventory/inventory.service.ts`. The branch's additions are
  all in: project routes, receipt into project stock stripes, grouped planning-group
  receipts (peg hardening, linking and softening), consume-at-receipt Project Issue rows,
  CIP rows, the `projectLedger` / CIP reversal on void, and Depot Repair orders on RMA
  Repair lines.
  - One conflict. Main renamed `trackedEntityUpdatesVoid` to `trackedEntitiesVoid` (an
    array). I kept the branch's soften-pegs and project/CIP reversal block and used main's
    `trackedEntitiesVoid.length` check.
  - Foundation request: `voidReceipt` selects `projectId` and writes `projectId:
    layer.projectId` on the restoring layers. This came in with the branch's void hunk.
- [x] `post-receipt/posting-lines.ts` → `PurchaseReceiptLine.projectDebit` and
  `consumedByProject`, `purchaseReceiptLineCosts`, `buildPurchaseReceiptJournalLines`
  (project debit with Project / ProjectElement tags), and the new
  `purchaseReceiptDebitLineIndexes` (all in inventory.service.ts).
- [x] `post-receipt/void-cost-ledger.ts`: the foundation agent did this.
- [x] `post-receipt/grouped-receipt.ts` → `apps/erp/app/modules/inventory/grouped-receipt.ts`.
  Unchanged; it has no relative imports.
- [x] `post-receipt/project-routes.ts` → `apps/erp/app/modules/inventory/receipt-project-routes.ts`.
  `../lib/project-posting` → `~/modules/projects/project-posting`.
- [x] `post-receipt/repair.ts` → `apps/erp/app/modules/inventory/receipt-repair.ts`.
  `../lib/service-orders` → `~/modules/service/service-orders`.
- [x] `post-shipment/index.ts` → `postShipment` (inventory.service.ts). No conflicts. The
  branch's common-stock draws, customer assets and repair ship-back are all in.
- [x] `post-shipment/customer-assets.ts` → `apps/erp/app/modules/inventory/shipment-customer-assets.ts`.
- [x] `post-shipment/repair.ts` → `apps/erp/app/modules/inventory/shipment-repair.ts`.
- [x] `issue/index.ts` → `issueMaterial` and its helpers (`issueJobOperationMaterials`,
  `createMaterialWipEntries`, `consumeTrackedEntitiesIntoOperation`, …). This covers the
  stripe-aware draws, the consume-to-project charge with `projectLedger` Material rows,
  scrap/return relief, the lot-merge guard, and the maintenance draws from common stock only.
  There were 8 conflicts:
  - The four job-issue `getStorageUnitWithHighestQuantity` calls now pass the job's
    `stripes`, as the foundation agent asked. The maintenance call keeps `[null]`.
  - The job select keeps main's `companyId` filter and `jobId`, and adds the branch's
    `projectId`: `.select(["locationId", "jobId", "projectId"])`.
  - `partToOperation`: main's strict-backflush block (strict bin and `assertBinCovers`)
    runs first. Then the branch's `untrackedRows(...)` per-stripe split runs at the bin the
    strict block chose. Both intents are kept.
  - The scrap journal uses main's `sequence.getNextSequence`, with the branch's
    `loadJobProjectCharge` before it.
  - The maintenance tracked-entities path keeps the branch's `assertEntitiesInStripes(…,
    [null])`. Main had removed the item re-query (it fetches the item earlier), so I did
    not add it back.
  - **Both sides changed one thing (my own decision; please check):** in
    `issueJobOperationMaterials`, main's strict-backflush path wrote ONE common-stock row
    for the remainder. The branch splits the remainder across the job's stripes at the bin.
    I changed the strict path to draw with `drawUntrackedAtBin` at the strict bin (one row
    per stripe, `projectId: draw.stripe`). The row total is the same, so the bin-cover
    check and the "kept when refused" planned rows behave as before. Without this change, a
    project job under strict backflush would take from common stock and leave its own
    project stock untouched.
- [x] `post-picking/index.ts` → `postPicking` and the return-sweep helpers. No conflicts.
- [x] `post-inventory-adjustment/index.ts` → `postInventoryAdjustment`. The body is in.
  The schema change is not: see below.
- [x] `correct-stock-movement/index.ts` → `postStockMovementCorrection`. No conflicts.
- [x] `post-inventory-count/index.ts` → `postInventoryCount`. No conflicts.
- [x] `post-stock-transfer/index.ts` → `postStockTransfer`. No conflicts.
- [x] `apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx`: the branch's only change was
  the embed hint `item!purchaseOrderLine_itemId_fkey(readableIdWithRevision)`. I applied it
  in main's `postReceipt` operation (`inventory.server.ts`, the over-receipt check). This
  also fixes the TS2589 "excessively deep" error that was already in HEAD at that line
  (the embed is ambiguous now that a second FK goes to `item`).
- [x] `apps/erp/app/routes/x+/shipment+/lines.tracking.tsx` → the
  `assignShipmentLineEntity` operation (`inventory.server.ts`). Carried:
  - the line's `lineId` is selected;
  - a Repair-disposition RMA line allows `Consumed` entities;
  - a Repair-disposition line needs a Completed or Closed Depot Repair service order on
    that line, with the customer asset `At Depot`.

  The refusals are `ctx.error("rule", …)` and the load failures are `ctx.error("internal",
  …)`. The messages are the branch's.
- [x] `apps/erp/app/routes/x+/inventory+/quantities.tsx`: the branch's stock-owner filter
  merged cleanly. The only thing missing was the `getStockOwnerProjects` import, now from
  `~/modules/projects/projects.service`.
- [x] `apps/erp/app/routes/api+/kanban.$id.tsx`: nothing to carry. The branch's only change
  moved the `runMRP` import out of the production barrel. Main's `scanKanban` operation no
  longer calls `runMRP`.
- [x] `apps/mes/app/services/inventory.service.ts`: I added `import { trackedEntityStripe }
  from "@carbon/api/stock-stripes"` and `import { fetchAll } from
  "@carbon/database/fetch-all"`, which the merge had dropped. All other lines the branch
  added are already in the file.
- [x] The AU source files under `apps/erp/test/database/{post-receipt,post-shipment}/`
  (`grouped-receipt.ts`, `project-routes.ts`, `repair.ts`, `customer-assets.ts`): these
  are the five helper files above. I took them from their FREEZE paths.

Other changes:

- Imports added to inventory.service.ts:
  - `@carbon/api/stock-stripes`;
  - `~/modules/projects/project-posting` and `~/modules/projects/project-cip`;
  - `assertNoOpenRefurbishment` from `~/modules/service/service-orders`;
  - `allocateJournalLineIds` from `~/modules/shared/shared.service`;
  - the five new helper files.
- Four user-facing `throw new Error(...)` that the branch added now throw
  `InvalidInputError`, so that their message reaches the user. Main did the same to the
  same kind of message when it ported these functions. A plain `Error` becomes a 500 with
  the message hidden. The four messages:
  - "Only a serialized item can be received for repair"
  - "Assign the serial before posting a repair receipt"
  - "A line's disposition changed while the receipt was posting…"
  - the repair-shipment serial message

## Not carried (needs another owner)

- **`packages/api/src/postings.ts` `postInventoryAdjustmentInput`: add `projectId`.** Main
  moved this schema there, and I do not own that file. The branch added:
  ```ts
      unscrapOfItemLedgerId: z.string().optional().nullable(),
      // The stock stripe of untracked stock, and of a NEW tracked entity: a
      // project with project stock, or null / omitted for common stock. An
      // existing tracked entity always moves in the stripe that holds it.
      projectId: z.string().optional().nullable()
  ```
  Until this is added, `inventory.service.ts(~19067)` has a TS2339 error, because
  `postInventoryAdjustment` destructures `projectId`. Zod would also strip the field at
  runtime, so the quantities page's per-owner adjustment would post as common stock. The
  ERP's `inventoryAdjustmentValidator` already has `projectId`.

## Verification

- ERP `npx tsgo --noEmit`: one error in my files, the TS2339 `projectId` error above. No
  errors in my routes or the new helper files.
- MES `npx tsgo --noEmit`: no errors in `services/inventory.service.ts`.
- `biome check --write` on every file I touched or created: clean.
- License-header fixer on the five new files: 5 correct AGPL.
- `@carbon/checks` `run.test.ts` cannot start in this worktree (`@carbon/config` dist is
  not built). Instead I searched the added code by hand for the banned patterns
  (`Math.round/ceil/floor`, `toFixed`, `new Date`, inline fraction digits): none.

## Requests for other owners

- **Owner of `packages/api/src/postings.ts` (orchestrator / foundation):** add `projectId`
  to `postInventoryAdjustmentInput` (above).
- **Tests (Phase 8):** the branch tests for these functions should import the helpers from
  their new homes:
  - `post-receipt/grouped-receipt.test.ts` → `~/modules/inventory/grouped-receipt`;
  - `project-routes` → `~/modules/inventory/receipt-project-routes`;
  - `repair` → `~/modules/inventory/receipt-repair` or `shipment-repair`;
  - `customer-assets` → `~/modules/inventory/shipment-customer-assets`.

  The tests that need porting: `issue/project-issue.test.ts`,
  `post-receipt/{grouped-receipt,project-receipt,sales-return-repair}.test.ts`,
  `post-shipment/{customer-assets,project-stock-shipment,sales-return-repair}.test.ts`,
  `post-picking/{project-stock-pick,refurbishment-guard}.test.ts`,
  `post-inventory-adjustment/project-stock.test.ts`, `correct-stock-movement.test.ts`, and
  the `void-cost-ledger.test.ts` change.
- **Review:** the strict-backflush plus stripes combination in `issueJobOperationMaterials`
  (above) is my decision, not a branch hunk.
