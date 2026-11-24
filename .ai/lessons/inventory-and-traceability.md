# Inventory and traceability lessons

The item ledger, bins, lots, serials and tracked entities, picking, backflush, kanban, stock effects of receipts and shipments.

## A pick moves a job material's storage unit to lineside, so the line no longer names its Pull From

```scope
id: a-pick-moves-a-job-material-s-storage-unit-to-lineside-so-th
paths: ["packages/database/src/strict-backflush.ts","apps/erp/app/modules/shared/strict-backflush.ts"]
triggers: ["pointJobMaterialAtLineside","pullFromStorageUnit","strict-backflush"]
```

**Context:** Strict backflush (2026-10-16) consumed what no pick covered from `jobMaterial.storageUnitId`.

**Problem:** Posting a pick calls `pointJobMaterialAtLineside`, which overwrites `jobMaterial.storageUnitId` with the lineside bin. After a partial pick, the remainder was checked against lineside (already drawn) instead of the warehouse bin the BoM named. With negative stock prevented it refused a completion the shelf could cover. With it allowed, it drove lineside negative. The TypeScript and SQL paths had the same bug, and no test picked anything.

**Rule:** Never read `jobMaterial.storageUnitId` as "the Pull From" once picking may have run. The pick line keeps the source (`pickingListLine.storageUnitId`). Use the oldest pick line into the line's current bin (`pullFromStorageUnit`, `@carbon/database/strict-backflush`). A later list is sourced from the fullest bin, so do not use the newest one. Any test of a bin rule needs a case with a partial pick.

**Applies to:** strict backflush, and any rule keyed on a job material's bin (picking, returns, lineside credit, consumption).

## A running total must be subtracted from the pool it was taken from

```scope
id: a-running-total-must-be-subtracted-from-the-pool-it-was-take
paths: ["packages/database/src/picked-consumption.ts"]
triggers: ["SharedTakes","recordSharedTakes","splitTakeByBin","getPickedBudgets","unclaimedRemaining"]
```

**Context:** The operation-completion backflush (`issue`, `issueJobOperationMaterials`) allocates every material of the operation against its lineside budgets before inserting any ledger row. A review pointed out that two materials sharing a picked item could both be offered the same unclaimed lineside stock, and asked to track what earlier materials took and subtract it from the next budget.

**Problem:** The budget's `available` was the sum of two pools — the material's OWN pick (private) and the bin's UNCLAIMED stock (shared) — and the fix subtracted a per-item running total of whole takes from that sum. Material A consuming its own private pick therefore zeroed material B's private pick, and B fell back to the warehouse while its staged stock sat at the machine. The fix was written to the reviewer's wording ("subtract it from available"), it had no test with a non-empty running total, and the follow-up review comment landed after the fix was pushed and was never re-polled.

**Rule:** When a value is a sum of pools with different sharing scopes, subtract a take only from the pool it came from. Every fix that adds a cross-iteration accumulator gets a pure test with the accumulator non-empty before it is committed. After pushing review fixes, re-read the PR's open threads — the reviewer's follow-up is on the FIX commit, not the original diff. The rest (the `own` and `unclaimed` pools, `SharedTakes`) is in `.claude/rules/supersession-system.md` ("A budget is two pools, and only one is shared").

**Applies to:** `packages/database/src/picked-consumption.ts` (`SharedTakes`, `recordSharedTakes`, `splitTakeByBin`), `generatePickingList`'s `unclaimedRemaining`, `getPickedBudgets` callers, and any loop that allocates from a shared balance before persisting.

## Issue-bin displays preserve stock stripes and picked ownership

```scope
id: issue-bin-displays-preserve-stock-stripes-and-picked-ownersh
paths: ["apps/mes/app/services/inventory.service.ts"]
triggers: ["excludeLineside","p_exclude_lineside","get_issue_tracked_entity_stock"]
```

**Context:** A batched MES query reports the bins a job can issue from, including stock picked to a work center.

**Problem:** Summing project and common ledger rows before testing for positive stock hid a positive project bin behind a negative common balance. Excluding every lineside bin hid stock already picked for the job.

**Rule:** Test positive on-hand per eligible `(item, bin, projectId)` stripe, then combine display quantities. Show lineside stock only when the job has an outstanding picked claim at that bin, net of its consumption.

**Applies to:** Issue-location reads, stock availability badges, and any query that merges warehouse and picked lineside stock.

## Tracked consumption/split must book against the entity's ACTUAL bin, not an arbitrary ledger row

```scope
id: tracked-consumption-split-must-book-against-the-entity-s-act
paths: ["apps/erp/app/modules/inventory/inventory.service.ts","packages/utils/src/resolve-tracked-entity-bin.ts"]
triggers: ["resolveTrackedEntityBin","trackedEntitiesToOperation","unconsumeTrackedEntities","trackedEntityId"]
```

**Context:** Consuming a batch picked to a lineside shelf (`trackedEntitiesToOperation`) booked its rows against `itemLedgers.find(il => il.trackedEntityId === id)?.storageUnitId`, the first row in a `createdBy`-ordered list. The entity was left at −N in one bin and +N in another.

**Problem:** For a tracked entity that has moved between bins (pick/transfer), "which bin holds the stock" is NOT the first ledger row — it's the bin whose net on-hand is positive. Picking any row's `storageUnitId` silently misplaces consumption and breaks any downstream feature that reasons about physical location (e.g. returning lineside remainder to source).

**Rule:** Every movement row for a tracked entity, not only consumption and split, resolves the storage unit from net on-hand per bin (`resolveTrackedEntityBin`, `packages/utils/src/resolve-tracked-entity-bin.ts`). Scope such a fix to the path you can verify — the same `.find` pattern exists in other cases (e.g. `unconsumeTrackedEntities`); don't blanket-replace untested paths. The rest (consumption and split rows book at the entity's on-hand bin) is in `.claude/rules/traceability-model.md`.

**Applies to:** `issueMaterial` (`apps/erp/app/modules/inventory/inventory.service.ts`) and any posting inserting `itemLedger` rows for a tracked entity that may hold stock in multiple bins.

## Two readers of the same shelf must share one definition (2026-09-16)

```scope
id: two-readers-of-the-same-shelf-must-share-one-definition-2026
paths: ["packages/database/src/picked-consumption.ts"]
triggers: ["linesideCredit","get_lineside_credit","generatePickingList","get_picking_schedule","getPickedBudgets"]
```

- **Context:** the pick-list generator credited lineside material with an
  all-or-nothing on-hand check per item, the schedule SQL did its own version,
  and consumption followed pick lines only. A job whose two assemblies' parts
  were already at the work centre (one pair picked on a since-cancelled list,
  one produced by a sub-job straight into the bin) got a list for four more,
  and would have consumed the wrong part from the wrong bin.
- **Problem:** three code paths each answered "what is at the machine for
  this job?" with a different formula, and none of them was wrong in
  isolation. The trial found it in minutes because real shop floors leave
  material at the machine in every way except a clean pick.
- **Rule:** when several readers share one definition of what is in a bin,
  enumerate the ways stock reaches a bin — pick, cancelled pick, sub-job
  output, manual transfer, return — and test each against the definition
  before calling the feature done. The rest (`linesideCredit` and its SQL
  twin `get_lineside_credit`) is in `.claude/rules/supersession-system.md`
  ("Lineside credit").
- **Applies to:** `generatePickingList`, `get_picking_schedule`,
  `getPickedBudgets` / `issue`, `post-picking`.

## What a document posts must be what its form shows

```scope
id: what-a-document-posts-must-be-what-its-form-shows
paths: ["apps/erp/app/modules/inventory/ui/Receipts/ReceiptLines.tsx"]
triggers: ["setReceiptLineSerial","saveReceiptSerialBox","planReceiptSerialRelease","receiptLineSplit"]
```

**Context:** Receipt serial entry (2026-10-16). Each serial box saved on blur, keyed on the serial number.

**Problem:** A box emptied, refused (a duplicate) or pushed out of range by a lower received quantity kept its saved serial. The post check reads what is saved, so the receipt posted a serial the user could no longer see.

**Rule:** Key a per-field save on the field's position (here the box: receipt line + index), not on its value. An empty value, a refused value and a removed field each clear what is saved for it. And a removal never deletes a record with stock history: a sales return re-tags real shipped units, so those only lose their receipt link (`planReceiptSerialRelease`).

**Applies to:** `setReceiptLineSerial` / `saveReceiptSerialBox`, `updateReceiptLines`, `ReceiptLines` `SerialForm`, the receipt line split (`receiptLineSplit` in `shared.service.ts`), and any autosaved list of tracked values (shipment serials, batch numbers).

## A tag that points at a line is cleared by every write that removes the line

```scope
id: a-tag-that-points-at-a-line-is-cleared-by-every-write-that-r
paths: []
triggers: ["clearShipmentTags","liveShipmentTags","\"Shipment Line\"","\"Receipt Line\"","deleteShipmentLine"]
```

- **Context:** A serial unit on a shipment carries `Shipment` and `Shipment Line` in `trackedEntity.attributes`; posting ships the units tagged to the shipment.
- **Problem:** Deleting a line, deleting the shipment or re-sourcing a Draft removed the lines but left the tags. The post then shipped units no line asked for. A post-time filter hid the stale tag, so a test that checked only after posting still passed when the clear was removed.
- **Rule:** Any attribute that names another row follows the same rule as the `Shipment` tag. Test the clear right after the write, before any reader that would also hide it, and remove the clear once to see the test go red. The rest (which writes clear shipment tags, `liveShipmentTags`) is in `.claude/rules/shipments-receipts-ui-patterns.md`.
- **Applies to:** `clearShipmentTags` callers (`deleteShipment`, `deleteShipmentLine`, the `create` re-source), `liveShipmentTags`, and any attribute that names another row (`Receipt Line`, `Job Make Method`).

## A void reverses only what is still where the posting put it

```scope
id: a-void-reverses-only-what-is-still-where-the-posting-put-it
paths: ["apps/erp/app/modules/inventory/inventory.service.ts"]
triggers: ["lockPostedReceipt","assertReceivedStockOnHand","assertNoRejectedUntrackedLot","settleQuantity"]
```

**Context:** Voiding a posted purchase receipt with serials and batches (2026-10-16).

**Problem:** The void set every tracked entity back to Available at its received quantity, so a lot that was never received stayed pickable. It also reversed each ledger row at the receipt's bin with only a cost-layer check. A serial moved to another bin, picked to lineside or shipped (Standard and Average cost never draw a layer down) passed that check, so the receipt bin went negative while the unit stayed counted where it went. And the receipt's inspection lot stayed open: Accept made the voided batch Available again, and Reject wrote the reversed stock off a second time.

**Rule:** Every void that reverses item ledger rows checks, inside its transaction, that the stock is still where the posting put it, and closes or refuses on every record that hangs off the document. To keep `Rejected` at zero, write the status directly: `settleQuantity` only preserves `Scrapped` and turns `Rejected` into `Consumed`. The rest (the purchase receipt void's checks) is in `.claude/rules/shipments-receipts-ui-patterns.md`.

**Applies to:** the `postReceipt` void (`lockPostedReceipt`, `assertReceivedStockOnHand`, `assertNoRejectedUntrackedLot` in `inventory.service.ts`), and any other void that reverses item ledger rows (shipments, stock transfers, adjustments).

## Returns must not decrement pickingListLine.quantityPicked — the status trigger demotes terminal headers

```scope
id: returns-must-not-decrement-pickinglistline-quantitypicked-th
paths: []
triggers: ["quantityPicked","quantityReturned","update_picking_list_status","returnPickedRemainder"]
```

**Context:** Building the picked-material return sweep (spec `.ai/specs/2026-08-04-picked-material-return-timing.md`). The original `returnPickedRemainder` case in `post-picking` decremented `pickingListLine.quantityPicked` when flushing un-consumed staged stock back to the warehouse at job complete.

**Problem:** `update_picking_list_status` (AFTER UPDATE ROW on `pickingListLine`, newest body `20260728120100`) fires on any `quantityPicked` change. After the decrement the line satisfies `quantityPicked < quantityToPick`, so the trigger's work-remains branch moves a `Completed`/`Partial` picking-list header back to **In Progress** — the automatic job-complete sweep was silently reopening completed picking lists. The demotion is CORRECT for an operator unpick (work regression); it is wrong for a post-completion return.

**Rule:** On a return, leave `quantityPicked` as gross-picked; net staged at lineside = `quantityPicked − quantityReturned`. Only genuine unpicks (operator reversing work) may decrement `quantityPicked`. Any new writer of `pickingListLine.quantityPicked`/`status` must first check what `update_picking_list_status` will do with the change. `pickingListLineTrackedEntity` allocations are different — returns DO decrement those (availability RPCs net them out; no trigger watches that table). The rest (returns book `pickingListLine.quantityReturned`) is in `.claude/rules/mes-job-operation-ui.md`.

**Applies to:** `postPicking` (`apps/erp/app/modules/inventory/inventory.service.ts`, all return/unpick cases), `update_picking_list_status` migrations, any code mutating `pickingListLine` quantities.

## A flip/refactor must not add ledger rows to a code path that deliberately posted none

```scope
id: a-flip-refactor-must-not-add-ledger-rows-to-a-code-path-that
paths: ["apps/erp/app/modules/inventory/inventory.service.ts"]
triggers: ["buildBatchSplitRecords","Batch Split"]
```

**Context:** Implementing the batch-split identity flip (spec `2026-08-04-batch-split-identity-flip.md`) via a shared `buildBatchSplitRecords` builder that emits a 2-row net-zero `Batch Split` `itemLedger` pair. Wired it into all five split writers uniformly, including `post-shipment`'s Purchase-Order-sourced block.

**Problem:** The pre-flip `post-shipment` PO block (subcontract / outside-processing shipments against a PO) wrote split **genealogy only** — `trackedEntity` + `trackedActivity` + output rows — and posted **zero** `itemLedger` rows, unlike the SO block which posts a `Sales Shipment` negative-adjustment the split pair complements. Mechanically wiring the builder's ledger inserts into the PO block introduced a −q on the parent that nothing in that path offsets, changing inventory behavior for subcontract shipments with unclear valuation consequences. Own-file `deno check` and typecheck stay green (it compiles fine), so only reading the ORIGINAL of each branch caught it. Self-review found it; the browser e2e never would have (no shippable PO fixture).

**Rule:** When applying a uniform transformation across N sibling branches, diff each branch against its own pre-change body — don't assume they were symmetric. A branch that posted no ledger, sent no email, fired no event before your change must still post/send/fire nothing after, unless the spec explicitly says otherwise. "It typechecks and the other four branches do it" is not evidence the fifth should. Preserve per-branch behavior; the flip's mandate was which id departs, not to newly introduce inventory movements.

**Applies to:** `apps/erp/app/modules/inventory/inventory.service.ts` (PO vs SO split blocks); any refactor threading a shared record-builder through multiple writers (`post-*`, `issue`, sync handlers).

## A posting that moves held stock must say it is the release

```scope
id: a-posting-that-moves-held-stock-must-say-it-is-the-release
paths: ["packages/jobs/src/inngest/functions/tasks/company-restore.ts","packages/jobs/src/inngest/functions/tasks/company-import.ts"]
triggers: ["withInspectionRelease","setInspectionRelease","app.sync_in_progress","app.inspection_release","check_inspection_hold"]
```

**Context:** The goods-in inspection hold is one statement handler on `itemLedger` (`check_inspection_hold`) plus BEFORE interceptors on `inspection`, `trackedEntity`, `storageUnit`, `location` and `nonConformance`.

**Problem:** A posting that moves stock out of an inspection unit without `setInspectionRelease` is refused with "held for inspection". The quick way out was to set `app.sync_in_progress`, which also switches the hold off. But that flag also stops the event queue, the contact and address sync handlers, the kanban and PMI queues and `queue_model_pipeline`. A company restore set it for its whole load and silenced all of them.

**Rule:** Never set `app.sync_in_progress` only to get past the hold or to silence events. A flag left on for a whole posting let an NCR close scrap units of an open lot and a void drain another receipt's held stock. The rest (`withInspectionRelease`, `setInspectionRelease`, the restore's `app.inspection_release`) is in `.claude/rules/inventory-system.md` and `.claude/rules/inspection-system.md`.

**Applies to:** Any new posting that writes negative `itemLedger` rows in a non-nettable unit; `company-restore.ts`, `company-import.ts`; every hold interceptor (each honours both flags).

## A skip inside a posting loop does not cover maps built before the loop

```scope
id: a-skip-inside-a-posting-loop-does-not-cover-maps-built-befor
paths: ["apps/erp/app/modules/inventory/inventory.service.ts"]
triggers: ["postReceipt","postShipment","receiptLinesByPurchaseOrderLineId","trackedEntityUpdates"]
```

**Context:** Making `postReceipt` (PO path) ignore a receipt line received at 0 (receipt quantities can start at zero, 2026-10).

**Problem:** The fix added `if (receivedQuantity === 0) continue;` to the per-line ledger loop. Three side-effect maps were built earlier from every line: `receiptLinesByPurchaseOrderLineId` (PO line `receivedDate`, outside-processing operation status) and `trackedEntityUpdates` (entity status and the Receive activity). A zero line still stamped its PO line received today, and a batch left on it became Available at its full quantity with no item ledger row. Review caught it, not the tests.

**Rule:** When a posting must ignore a line, filter it where every per-line collection is built, not only in the loop that writes the ledger. List every map or array derived from the lines and check each. Pin the skipped line's absence in a test: assert the side effects did not happen, not only that the ledger row is missing.

**Applies to:** `postReceipt` / `postShipment` and every posting in `inventory.service.ts` that builds update maps before its write loop.

## A tracked entity's bin is where it IS, never the document line's bin — and "no storage unit" is a bin

```scope
id: a-tracked-entity-s-bin-is-where-it-is-never-the-document-lin
paths: ["apps/erp/app/modules/shared/shared.service.ts"]
triggers: ["resolveTrackedEntityBin","getTrackedEntityBins","p_filter_storage_unit","assertInSourceBin"]
```

**Context:** Sales order shipments booked every serial and batch against `shipmentLine.storageUnitId` (copied from the sales order line, which defaults to the item's default bin). A unit picked from any other bin drove the line's bin negative and left its real bin showing stock that had already shipped. The stock transfer picker had the matching gap: it listed every lot at the location, not the line's source bin, and an empty source (`fromStorageUnitId` null — the wizard's "No storage unit") meant "any bin".

**Problem:** A document line's bin is a default for untracked stock. For a serial or batch the ledger already knows the bin, and ignoring it corrupts two bins at once. `resolveTrackedEntityBin` skips the unassigned bin (`null`), so a unit moved into "no storage unit" resolves back to the named bin it left. And `NULL` as a filter value cannot also mean "no filter".

**Rule:** Use the null-aware `resolveTrackedEntityBins` (`@carbon/utils`), never `resolveTrackedEntityBin`, where a unit can sit in "no storage unit". A bin filter that must express "no storage unit" takes an explicit switch (`p_filter_storage_unit` on `get_available_tracked_entities`) and compares with `IS NOT DISTINCT FROM`. The rest (a shipment books at `getTrackedEntityBins`, refuses with no stock, and voids into the posted bin) is in `.claude/rules/shipments-receipts-ui-patterns.md`.

**Applies to:** `post-shipment` (Sales Order post/void, serial + batch), `post-stock-transfer` (`assertInSourceBin`), the stock transfer picker. Return and outbound-transfer shipments still use the line's bin.

## `null` as "no bin chosen" and `null` as "no storage unit" are different things

```scope
id: null-as-no-bin-chosen-and-null-as-no-storage-unit-are-differ
paths: ["packages/database/src/picked-consumption.ts"]
triggers: ["planStripedUntrackedDraw","backflush_job_materials","IS DISTINCT FROM"]
```

**Context:** The untracked draw planner (`planStripedUntrackedDraw`) and its SQL twin in
`backflush_job_materials` took a preferred bin, where `null` meant "no bin chosen", and
listed the other bins as "every bin that is not the preferred one".

**Problem:** With no bin chosen, "not the preferred one" also dropped the bin whose id
is `null`: stock with no storage unit. A draw with 8 in a bin and 3 in no storage unit
took 20 from the bin and left the 3. TypeScript `id !== null` and SQL
`IS DISTINCT FROM NULL` both excluded it, so the twins agreed and unit tests passed.

**Rule:** When one value can mean "nothing chosen" and also name a real bucket, test the
"nothing chosen" case against stock in that bucket. In code, guard the comparison:
`preferred === null || id !== preferred`, and in SQL
`v_preferred IS NULL OR id IS DISTINCT FROM v_preferred`.

**Applies to:** `packages/database/src/picked-consumption.ts`, `backflush_job_materials`,
and any bin or stripe filter where `null` is both a key and "unset".

## Removing a feature flag can expose a fail-open `?.data` guard

```scope
id: removing-a-feature-flag-can-expose-a-fail-open-data-guard
paths: ["apps/erp/app/modules/inventory/inventory.service.ts"]
triggers: ["accountingEnabled","accountDefaults?.data"]
```

**Context:** Before always-posting, the return shipments in `post-shipment` and the sales return receipt in `post-receipt` read the account defaults only when `accountingEnabled` was true. Otherwise `accountDefaults` was null. The journal was written under `if (accountingEnabled && accountDefaults?.data && cost > 0)`. So `accountDefaults?.data` was part of the "accounting is off" test.

**Problem:** The always-post change removed the flag and kept `if (accountDefaults.data && cost > 0)`. After that, the `.data` check only caught a failed read, and it failed open. If the defaults read failed, the post still wrote its stock and cost rows, but it skipped the journal with no error and no log. Typecheck and the tests passed. Commit b9f897608c makes both paths throw "Error getting account defaults" when the read fails.

**Rule:** When you remove a flag, read every condition that used the flag. A null check that meant "feature off" becomes a silent error check when the flag goes. Turn a failed read into a throw before any write. Keep only business conditions, such as `cost > 0`, in the `if`.

**Applies to:** `apps/erp/app/modules/inventory/inventory.service.ts` (return shipments); `apps/erp/app/modules/inventory/inventory.service.ts` (sales return receipt); any flag removal, such as `accountingEnabled` or a plan gate.

## Reverse inventory from the original ledger sources

```scope
id: reverse-inventory-from-the-original-ledger-sources
paths: ["apps/erp/app/modules/inventory/inventory.service.ts"]
triggers: ["Job Consumption","unissue","Unissue","unpick"]
```

**Context:** Picking a material in stages and unissuing project-job inventory.

**Problem:** A saved bin can empty between picks, and a project job can consume both project and common stock. Reusing the saved bin or default project stripe for a reversal changes physical or ownership balances.

**Rule:** Resolve stock after the draw lock for every pick, record its source per line, and reverse outstanding quantities by their original bin and stripe. Find the rows to reverse by document and item, not by a tag only some writers set: the job-completion backflush writes `Job Consumption` rows with no `documentLineId`. A refusal the person can act on is an `InvalidInputError`; a plain `Error` reads as a 500 and its text is withheld.

**Applies to:** Picking transfers, unpick, job consumption, and unissue.
