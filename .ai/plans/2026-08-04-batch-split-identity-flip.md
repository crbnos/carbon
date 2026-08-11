# Batch Split Identity Flip — implementation plan

**Spec:** .ai/specs/2026-08-04-batch-split-identity-flip.md
**Research:** .ai/research/batch-split-identity.md
**Branch:** feat/batch-split-identity-flip (PR B) — Tasks 1–3 ship first from fix/split-display-fixes (PR A)

Convention being implemented (memorize before any task): on a partial batch draw of
quantity `q` from `parent`, the parent KEEPS its id and is decremented by `q`; a NEW
`child` entity (same `readableId`, attrs cloned + `"Split From Entity ID": parent.id`)
holds `q` and is what departs (lineside / other bin / consumed / shipped). Split activity:
input parent@q, output child@q — never a survivor self-loop. Ledger: exactly two net-zero
`Batch Split` rows (−q parent, +q child) at the parent's resolved bin. The OLD convention
(original departs, new = remainder, `"Split Entity ID"` tagged on the survivor) must not
survive anywhere. Serial paths never split — do not touch `case "serial"` /
`unpickSerial`. No DB migration exists in this plan; nothing schema-related changes.

## Progress
- [x] Task 1: Fix activity-feed tracking labels + hide Batch Split bookkeeping rows
- [x] Task 2: Group Storage Units rows by (lot, storage unit)
- [x] Task 3: Filter split self-loops in traceability sidebar/graph + fix ExpiryTracePopover copy
- [x] Task 4: Add "Split From Entity ID" to the shared attribute types
- [x] Task 5: Pure batch-split/merge record builders + Deno tests
- [x] Task 6: Flip post-picking batch pick
- [x] Task 7: Rework post-picking unpickBatch (allocation-qty undo + merge-back)
- [x] Task 8: Merge-on-return in the post-picking return sweep
- [x] Task 9: Flip issue trackedEntitiesToOperation
- [x] Task 10: Flip issue maintenanceDispatchTrackedEntities
- [x] Task 11: Flip post-stock-transfer batch + unpick merge-back redetect
- [x] Task 12: Flip post-shipment SO + PO splits, retained-parent label ids
- [x] Task 13: Align quality-disposition subdivideBatchEntity
- [x] Task 14: Reader filters — root-entity queries + serial assignment + newest-live audit
  (audit log: issue:1165 filters by Operation marker, acts on caller id — left; MES
  getTrackedEntitiesByJobMakeMethodIds + JobsTable map make-method→readableId, invariant
  across fragments — left; MES/ERP getTrackedEntitiesByMakeMethodId consumers select via
  isSerialEntityIncompleteForOperation which already guards status !== Consumed — left;
  JobHeader sums Available rows — left; issue new.tsx + association.new.tsx link ALL
  entities — left; print-job resolvers Operation case renders all rows — left. Adjacent
  observation, NOT in plan scope: print-job resolver "Shipment" case selects by the
  Shipment attribute, which post-flip lands on consumed children — flagged in run report.)
- [x] Task 15: MES — issue confirmation, Convert/Scrap retarget, scan mapping, picked-lots semantics
  (Convert/Scrap were reachable ONLY from the deleted split screen → deleted per the
  plan's dead-code clause. Scan mapping matches by entity id; parent→child resolution
  added via pickedAllocation.splitFromEntityId — active when picked-lots data is loaded,
  i.e. the process view with a picking allocation.)
- [x] Task 16: ERP routes — label print retargeting (stock transfer, shipment, maintenance)
- [x] Task 17: Validation gates (lint ✓, scoped typechecks ×4 ✓, deno tests 12+5 ✓, lingui extract + 24 translations filled ✓)
- [~] Task 18: Browser verification — PARTIAL but core writers PROVEN e2e (2026-08-05,
  real Chrome via chrome MCP against erp.batch-split-identity-flip.dev). Seeded lot 2026/09
  = 8 @ BIN-A via the real post-inventory-adjustment edge fn; added BATCH-TEST-01 (Pull
  from Inventory) to job J000005, generated picking list PL000004, and exercised the live
  edge functions:
  • PICK 6-of-8 (post-picking `case "batch"`, Task 6): shelf entity kept its id decremented
    8→2 (no `Split Entity ID` on it), new child qty 6 carries `Split From Entity ID`=parent,
    ledger 2-row Batch Split nets zero + Transfer pair books on the CHILD, allocation →
    CHILD, Split genealogy input parent@6 → ONE output child@6. Every invariant held.
  • UNPICK (post-picking `unpickBatch`, Task 7): shelf restored 2→8, child drained to 0/
    Consumed, Split activity deleted, allocation deleted, on-hand reconciles. Clean merge-back.
  Evidence + queries recorded in `.ai/playbooks/batch-split-identity-flip.md`. Earlier
  blocker (in-app pane's portaled combobox) was resolved by using the real Chrome MCP
  (1:1 coords). NOT yet exercised live: issue partial-consume (Task 9), complete→merge
  sweep (Task 8), stock transfer (Task 11 — new wizard is demand-driven, needs a WC-1
  demand), shipment (Task 12 — no SO), NCR disposition (Task 13). Those share the same
  verified `buildBatchSplitRecords` builder; cover per the playbook checklist.

## Dependencies
- Tasks 1–3 independent of everything (PR A; ship first).
- Task 4 → Task 5 → Tasks 6–13 (writers; 6–13 mutually independent, but 7 and 8 edit the
  same file as 6 — run 6 → 7 → 8 sequentially; 9 → 10 same file sequentially).
- Tasks 14–16 depend only on Task 4; parallel to writers, but land in the same PR B.
- Task 17 after all code tasks. Task 18 last (needs the user's running dev stack).

---

## Task 1: Fix activity-feed tracking labels + hide Batch Split bookkeeping rows

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Inventory/InventoryActivity.tsx` — label
  source + row filtering
- Modify: `apps/erp/app/routes/x+/inventory+/quantities+/$itemId.activity.tsx` — thread
  `itemTrackingType`

**Steps:**
1. In `InventoryActivity.tsx`, six sites build `Math.abs(ledgerRecord.quantity) > 1 ?
   "batch" : "serial"` (≈ lines 81, 98, 200, 244, 297, 307). Replace the ternary with a
   `trackingNoun` derived from a new `itemTrackingType` prop: `"Serial"` → `"serial"`,
   `"Batch"` → `"batch"`, anything else → omit the tracked-entity clause entirely.
   Thread the prop through the component(s) in this file down to `getActivityText`
   (convert `getActivityText` to take `(ledgerRecord, trackingNoun)`).
2. In the route `$itemId.activity.tsx`: read the loader; if item data with
   `itemTrackingType` is already loaded, pass it down; otherwise fetch it in the loader
   via the items service `getItem(client, itemId)` pattern used by the sibling
   quantities routes and pass `item.itemTrackingType`. If neither is feasible without
   new service code, STOP and report — do not guess a tracking type client-side.
3. In the row-collapsing/reducer stage of `InventoryActivity.tsx` (the
   `CollapsedItemLedger` reduce near the top), drop rows with
   `documentType === "Batch Split"` from the feed entirely — they are internal net-zero
   bookkeeping; the Transfer/Consumption rows tell the real story. Keep them in any
   raw ledger table views (this file only).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0, no errors in InventoryActivity.tsx or $itemId.activity.tsx
rg -n 'quantity\) > 1 \? "batch" : "serial"' apps/erp/app/modules/inventory/ui/Inventory/InventoryActivity.tsx
# Expected: no matches
```

**Out of scope:** StockMovementsTable (raw ledger view keeps Batch Split rows), any
locale/.po updates beyond what lingui extract picks up in Task 17.

## Task 2: Group Storage Units rows by (lot, storage unit)

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Inventory/InventoryStorageUnits.tsx`
- Copy from (precedent): `apps/erp/app/modules/inventory/ui/Valuation/InventoryValuationWorkbench.tsx`
  — the `expandedIds: Set<string>` + flattened-rows `useMemo` expand/collapse pattern

**Steps:**
1. Rows arrive as `itemStorageUnitQuantities: ItemStorageUnitQuantities[]` (one row per
   (storage unit, tracked entity)). Build a `useMemo` grouping by key
   `${storageUnitId}::${readableId}` (fall back to the tracked entity id when
   `readableId` is null so untracked/unnumbered rows stay singletons).
2. Groups with one member render exactly as today (zero visual change). Groups with >1:
   render a group row — storage unit name, summed quantity, the shared Tracking ID chip,
   earliest expiration of the members, a `×N` count, and a chevron `IconButton`
   toggling the key in an `expandedIds` set (precedent file's pattern). When expanded,
   member rows render beneath exactly as today (existing per-entity actions — edit,
   label print, adjustment menu — stay on member rows ONLY).
3. Keep sort: storage unit, then `readableId`, then existing order within group.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** the picker components (`TrackedEntityPicker`), the quantities list
page, any service/RPC change — grouping is purely presentational in this component.

## Task 3: Filter split self-loops in traceability sidebar/graph + ExpiryTracePopover copy

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Traceability/TraceabilitySidebar.tsx` —
  self-loop classification (useMemo at ~line 77)
- Modify: `apps/erp/app/modules/inventory/lineage.server.ts` — `toGraphData` (~line 448)
- Modify: `apps/erp/app/modules/inventory/ui/Traceability/ExpiryTracePopover.tsx` (~218–230)

**Steps:**
1. Sidebar: in the `useMemo`, precompute for the selected entity the set of activity ids
   where it appears in BOTH `payload.inputs` and `payload.outputs` (self-loop = historical
   split survivor). For those activities: skip the `producedBy` push and the
   `consumedBy` push, and instead push into a new `splits: RelatedActivity[]` list
   (quantity = the output-row quantity, i.e. what the entity kept). Render a "Splits"
   section between "Produced by" and "Consumed by" using the same `Section` component,
   row label unchanged (activity headline), so a receipt-originated lot no longer shows
   "Produced by Split" / "Consumed by Split".
2. Graph: in `toGraphData`, drop OUTPUT links whose `(trackedActivityId, trackedEntityId)`
   pair also exists in `payload.inputs` (the survivor's output edge). Keep the input edge.
3. `ExpiryTracePopover.tsx`: the "Split from another batch — Parent {id}" block currently
   keys off the legacy `"Split Entity ID"` attribute with inverted meaning. Change it to
   read `"Split From Entity ID"` (correct parent pointer, Task 4 type). For legacy
   entities that only have `"Split Entity ID"`, suppress the block (it names the CHILD,
   not the parent — showing it as "Parent" is wrong).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** strict-RPC SQL (unchanged), EntityNode labels, worker/ lineage code.

## Task 4: Add "Split From Entity ID" to the shared attribute types

**Depends on:** none
**Files:**
- Modify: `packages/utils/src/types.ts` (~line 51, `TrackedEntityAttributes`)
- Modify: `packages/database/supabase/functions/lib/utils.ts` (~line 15, same interface)

**Steps:**
1. Add `"Split From Entity ID"?: string;` beside the existing
   `"Split Entity ID"?: string;` in both declarations. Do NOT remove the legacy key
   (historical rows carry it).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: exit 0
rg -n '"Split From Entity ID"' packages/utils/src/types.ts packages/database/supabase/functions/lib/utils.ts
# Expected: one match in each file
```

**Out of scope:** removing `"Split Entity ID"` (still written on ACTIVITY attributes and
present on historical entities).

## Task 5: Pure batch-split/merge record builders + Deno tests

**Depends on:** Task 4
**Files:**
- Create: `packages/database/supabase/functions/shared/batch-split.ts`
- Create: `packages/database/supabase/functions/shared/batch-split.test.ts`
- Copy from (precedent): `packages/database/supabase/functions/issue/resolve-tracked-entity-bin.ts`
  + its colocated `.test.ts` (pure module + `deno test`, no DB imports)

**Steps:**
1. `batch-split.ts` exports two pure functions (NO imports from `../lib/database.ts` —
   node code will import this file too; see lesson "Node-side re-exports from the Deno
   functions tree must dodge lib/database.ts"):
   ```typescript
   export type BatchSplitInput = {
     parent: { id: string; readableId: string | null; quantity: number;
       sourceDocument: string | null; sourceDocumentId: string | null;
       sourceDocumentReadableId: string | null; itemId: string | null;
       expirationDate: string | null; attributes: Record<string, unknown> | null };
     drawQuantity: number;          // q, must be > 0 and < parent.quantity
     childId: string;               // caller-supplied nanoid
     splitActivityId: string;       // caller-supplied nanoid
     activitySourceDocument: string;   // e.g. "Picking List"
     activitySourceDocumentId: string;
     bin: { storageUnitId: string | null; locationId: string | null };
     itemLedgerItemId: string;      // itemId for the ledger rows
     companyId: string; userId: string; postingDate: string;
     childStatus: "Available" | "Consumed";
     extraChildAttributes?: Record<string, unknown>;
   };
   export function buildBatchSplitRecords(input: BatchSplitInput): {
     childEntityInsert: {...};        // quantity = q, attrs = parent attrs minus
                                      // "Split Entity ID"/"Split From Entity ID"
                                      // + { "Split From Entity ID": parent.id }
                                      // + extraChildAttributes
     parentUpdate: { quantity: number };   // parent.quantity - q  (attrs untouched)
     activityInsert: {...};           // type "Split", attributes { "Original Quantity":
                                      // parent.quantity, "Drawn Quantity": q,
                                      // "Remaining Quantity": parent.quantity - q,
                                      // "Split Entity ID": childId }
     activityInputInsert: {...};      // parent @ q
     activityOutputInsert: {...};     // child @ q  (exactly ONE output — no self-loop)
     ledgerInserts: [{...}, {...}];   // −q on parent, +q on child; entryType
                                      // "Negative Adjmt."/"Positive Adjmt.",
                                      // documentType "Batch Split", documentId
                                      // splitActivityId, at input.bin
   };
   export function buildMergeRecords(input: { child: { id: string; quantity: number };
     parent: { id: string; quantity: number }; mergeQuantity: number;
     mergeActivityId: string; companyId: string; userId: string }): {
     activityInsert: {...};           // type "Merge"
     activityInputInsert: {...};      // child @ mergeQuantity
     activityOutputInsert: {...};     // parent @ mergeQuantity
     parentUpdate: { quantity: number };  // parent.quantity + mergeQuantity
     childUpdate: { quantity: number; status?: "Consumed" };  // Consumed when → 0
   };
   ```
   Throw on `drawQuantity <= 0`, `drawQuantity >= parent.quantity`, or
   `mergeQuantity > child.quantity` — the callers' split gates should make these
   unreachable; loud beats silent.
2. Tests assert: child (not parent) carries `"Split From Entity ID"`; parent update only
   decrements; exactly one activity output and it is the child; ledger rows net to zero
   with −q on parent / +q on child; merge Consumed-at-zero behavior; the throw cases.

**Verify:**
```bash
deno test packages/database/supabase/functions/shared/batch-split.test.ts
# Expected: all tests pass (ok | N passed)
```

**Out of scope:** wiring into any writer (Tasks 6–13); itemLedger typing beyond what the
writers already use (mirror the `ItemLedgerInsert` field shape they build inline).

## Task 6: Flip post-picking batch pick

**Depends on:** Task 5
**Files:**
- Modify: `packages/database/supabase/functions/post-picking/index.ts` — `case "batch"`
  (~372–634)

**Steps:**
1. In the split branch (`entityQuantity !== transferQuantity`, ~404): replace the inline
   entity/activity/ledger writes (~407–529) with `buildBatchSplitRecords` (import from
   `../shared/batch-split.ts`): parent = the loaded `trackedEntity`, `drawQuantity =
   transferQuantity`, `childStatus: "Available"`, activity source `"Picking List"` /
   `pickingListId`, bin = `{ storageUnitId: fromStorageUnitId, locationId }`. Insert/
   update in the same trx order: activity → child entity → input/output → parent update →
   ledger rows. Set `splitEntityId = childId` (response meaning now = departing child).
2. Everything after the split must reference the CHILD when a split occurred, else the
   original entity: introduce `const pickedEntityId = didSplit ? childId :
   trackedEntityId;` and use it for: the Pick `trackedActivityInput` (~551–560), BOTH
   Transfer ledger rows (~563–590), and the `pickingListLineTrackedEntity` upsert
   (~609–629).
3. Do not modify `case "serial"`, `case "inventory"`, `case "unpickInventory"`.

**Verify:**
```bash
deno check --no-lock packages/database/supabase/functions/post-picking/index.ts 2>&1 | rg "post-picking/index.ts" ; echo "exit:$?"
# Expected: exit:1 (no own-file errors; pre-existing lib noise is fine per lessons.md
# "gate on own-file error deltas") — record the error count before your change and
# assert it did not grow.
rg -n "pickedEntityId" packages/database/supabase/functions/post-picking/index.ts | head -5
# Expected: matches in the Pick input, Transfer rows, and allocation upsert
```

**Out of scope:** unpick and return cases (Tasks 7–8), label printing (picking still
prints nothing — spec decision).

## Task 7: Rework post-picking unpickBatch (allocation-qty undo + merge-back)

**Depends on:** Task 6
**Files:**
- Modify: `packages/database/supabase/functions/post-picking/index.ts` —
  `case "unpickSerial"/"unpickBatch"` (~636–743)

**Steps:**
1. Split the shared case: keep `unpickSerial` behavior byte-identical (qty is always 1);
   give `unpickBatch` its own branch.
2. `unpickBatch` for entity id E (the id recorded in `pickingListLineTrackedEntity` —
   callers pass what they rendered from allocations):
   a. Load the allocation row (`pickingListLineId`, `trackedEntityId = E`); unpick
      quantity `q = allocation.quantityPicked`. STOP and report if no allocation row —
      do not fall back to `trackedEntity.quantity`.
   b. Reverse the Transfer pair for E: −q @ `line.toStorageUnitId`, +q @
      `line.storageUnitId` (as today, but with `q`, not entity quantity).
   c. Delete the Pick activity for E on this picking list (existing query, ~664–677).
   d. If `E.attributes["Split From Entity ID"]` names a parent P that exists and
      `P.readableId === E.readableId`: merge-back undo — `P.quantity += q`;
      `E.quantity -= q`, set `E.status = 'Consumed'` when it reaches 0; two ledger rows
      `Batch Split` documentType at the SOURCE bin (−q on E, +q on P) so the original
      split pair nets out; DELETE the Split activity that created E (find it via
      `trackedActivity.type = 'Split'` AND `attributes->>'Split Entity ID' = E.id` AND
      `companyId`) and its input/output rows. Do NOT delete E's entity row.
      If P is missing/mismatched (legacy pre-flip allocation), skip the merge — E simply
      returns to the source bin as its own entity (today's behavior).
   e. Keep the existing `quantityPicked` decrement, line status reset, allocation-row
      delete, and `restoreJobMaterialSource` call.

**Verify:**
```bash
deno check --no-lock packages/database/supabase/functions/post-picking/index.ts 2>&1 | rg -c "post-picking/index.ts"
# Expected: own-file error count unchanged from Task 6 baseline
rg -n "quantityPicked" packages/database/supabase/functions/post-picking/index.ts | rg -n "unpick" -A0 | head -3
# Expected: unpickBatch derives q from the allocation row
```

**Out of scope:** `unpickInventory`, stock-transfer unpick (Task 11).

## Task 8: Merge-on-return in the post-picking return sweep

**Depends on:** Task 7
**Files:**
- Modify: `packages/database/supabase/functions/post-picking/index.ts` —
  `returnTrackedAllocationRemainder` (~944–1109)

**Steps:**
1. The lineage walk (~998–1058) stays as-is (seed + forward descendants; still correct —
   spec §returns). For each lineage entity `E` with lineside on-hand `r > 0` about to be
   transferred back to `sourceBin`:
   a. Resolve `P` from `E.attributes["Split From Entity ID"]` (may be absent on legacy
      rows). Load P scoped by `companyId`.
   b. Merge when P exists AND `P.status = 'Available'` AND `P.readableId ===
      E.readableId` AND `resolveTrackedEntityBin`-style net on-hand places P at
      `sourceBin`: use `buildMergeRecords` — Transfer ledger −r on E @ lineside, +r on
      P @ sourceBin (keep the existing Transfer entryType/documentType the sweep uses
      today), `P.quantity += r`, `E.quantity −= r` (Consumed at 0), insert the Merge
      activity + input(E@r)/output(P@r).
   c. Otherwise fall back to today's behavior verbatim (transfer E back, E stays
      Available at sourceBin).
2. Keep the allocation decrement/delete keyed on the allocated id (~1066–1095) unchanged.
3. Do not touch `returnUntrackedMaterialRemainder` or `maybeRestoreJobMaterialSource`.

**Verify:**
```bash
deno check --no-lock packages/database/supabase/functions/post-picking/index.ts 2>&1 | rg -c "post-picking/index.ts"
# Expected: own-file error count unchanged
rg -n '"Merge"' packages/database/supabase/functions/post-picking/index.ts
# Expected: one trackedActivity type "Merge" insert site
```

**Out of scope:** operation/job sweep orchestration and policy gates (untouched — spec
2026-08-04-picked-material-return-timing owns them).

## Task 9: Flip issue trackedEntitiesToOperation

**Depends on:** Task 5
**Files:**
- Modify: `packages/database/supabase/functions/issue/index.ts` —
  `case "trackedEntitiesToOperation"` split block (~2203–2400)

**Steps:**
1. Replace the inline split writes (~2224–2355) with `buildBatchSplitRecords`: parent =
   the loaded entity, `drawQuantity = quantity` (the consumed amount), `childStatus:
   "Consumed"` is NOT set here — create the child `"Available"` and let step 2 flip it
   (mirrors the existing two-phase shape), activity source `"Job Material"` /
   `actualMaterialId`, bin from `resolveTrackedEntityBin(itemLedgers, trackedEntityId)`,
   `extraChildAttributes` = the per-consume keys the case adds today (Job Operation
   Step / Unit when present). Respect the existing `methodType !== "Make to Order"`
   guard: MTO skips ONLY the ledger inserts (entity/activity writes still happen).
2. This is the atomicity-critical edit (spec risk #1): in the SAME edit, repoint to the
   CHILD id — `splitEntities.push({originalId: trackedEntityId, newId: childId, ...,
   quantity: consumed qty (was remainder)})`, the `status: "Consumed"` update
   (~2359–2365), the Consume `trackedActivityInput` (~2367–2373), and the Consumption
   ledger row (~2376–2387). The parent is touched ONLY by the builder's quantity
   decrement. Grep the whole case afterward for remaining uses of the original id and
   justify each survivor (the parent decrement and the `splitEntities.originalId` are
   the only legitimate ones).
3. `splitEntities[].quantity` consumers (MES modal, Task 15) will read it as the
   consumed child quantity + compute remaining from parent — update the pushed object to
   `{ originalId, newId, readableId, quantity: <consumed q>, remainingQuantity:
   <parent quantity after decrement> }`.

**Verify:**
```bash
deno check --no-lock packages/database/supabase/functions/issue/index.ts 2>&1 | rg -c "issue/index.ts"
# Expected: own-file error count unchanged from pre-task baseline
rg -n 'set\(\{\s*$' -A3 packages/database/supabase/functions/issue/index.ts | rg -n '"Consumed"' | head -4
# Expected: the trackedEntitiesToOperation Consumed update targets the child id variable
```

**Out of scope:** `unconsumeTrackedEntities` (id passed by caller; semantics unchanged),
`jobOperationBatchComplete` / `jobOperationSerialComplete` (Task 14 audits their
selection filters only).

## Task 10: Flip issue maintenanceDispatchTrackedEntities

**Depends on:** Task 9
**Files:**
- Modify: `packages/database/supabase/functions/issue/index.ts` —
  `case "maintenanceDispatchTrackedEntities"` (~3231–3419)

**Steps:**
1. Same builder replacement as Task 9 (activity source `"Maintenance Dispatch Item"`).
   Replace this block's `itemLedgers.find(...)`-based bin with
   `resolveTrackedEntityBin` (aligns with Block A; lesson "actual bin" — the fix is
   in-scope here because this task's tests exercise the path).
2. Repoint to child: status Consumed, Consume input, `Maintenance Consumption` ledger,
   AND the `maintenanceDispatchItemTrackedEntity` junction insert (~3394–3400).
   `splitEntities` shape as in Task 9 step 3.

**Verify:**
```bash
deno check --no-lock packages/database/supabase/functions/issue/index.ts 2>&1 | rg -c "issue/index.ts"
# Expected: own-file count unchanged
rg -n "maintenanceDispatchItemTrackedEntity" packages/database/supabase/functions/issue/index.ts
# Expected: junction insert references the child id variable
```

**Out of scope:** `maintenanceDispatchUnconsume` (caller-supplied id).

## Task 11: Flip post-stock-transfer batch + unpick merge-back redetect

**Depends on:** Task 5
**Files:**
- Modify: `packages/database/supabase/functions/post-stock-transfer/index.ts` —
  `case "batch"` (~406–683) and `case "unpickBatch"` (~815–1058)

**Steps:**
1. `case "batch"`: builder replacement (source `"Stock Transfer"` / `stockTransferId`,
   bin `fromStorageUnitId`, child `"Available"`). Departing side = child: the Transfer
   activity input, BOTH Transfer ledger rows (from → `toStorageUnitId`), and
   `stockTransferLine.trackedEntityId` update (~669–680) all use the child id.
   `splitEntityId` response = child id.
2. `case "unpickBatch"` for entity id E (from the line):
   - New detection: E is a split child iff `E.attributes["Split From Entity ID"]` is
     set. Legacy detection (pre-flip rows): `E.attributes["Split Entity ID"]` set (E was
     the departed original; its pointer names the remainder). Handle BOTH:
     - New shape: P = parent from the pointer; merge E fully back into P (P.quantity +=
       E.quantity, E → Consumed @ 0), ledger rows as the branch writes today but with
       roles P=receiver / E=drained; delete the Split activity found via
       `type='Split'` AND `attributes->>'Split Entity ID' = E.id` AND
       `sourceDocumentId = stockTransferId` AND `companyId` — scoped, fixing the
       pre-existing multi-line bug at ~884.
     - Legacy shape: keep the existing merge code path, but scope its Split-activity
       query the same way (`attributes->>'Split Entity ID' = <remainder id>`).
   - No pointer at all → existing plain reverse-transfer branch unchanged.

**Verify:**
```bash
deno check --no-lock packages/database/supabase/functions/post-stock-transfer/index.ts 2>&1 | rg -c "post-stock-transfer/index.ts"
# Expected: own-file count unchanged
rg -n "Split From Entity ID" packages/database/supabase/functions/post-stock-transfer/index.ts | head -3
# Expected: matches in both the batch case (via builder import) and unpickBatch detection
```

**Out of scope:** `case "serial"` / `unpickSerial`, destination-bin merging (spec: none
in v1).

## Task 12: Flip post-shipment SO + PO splits, retained-parent label ids

**Depends on:** Task 5
**Files:**
- Modify: `packages/database/supabase/functions/post-shipment/index.ts` — SO split block
  (~705–1065) and PO split block (~1418–1652)

**Steps:**
1. Both blocks are near-verbatim twins — apply identical edits to each:
   a. The `trackedEntitySplits`/`trackedEntityUpdates` maps: parent is now only
      decremented (builder handles it); the SHIPPED portion becomes the child with
      `status: "Consumed"`, `quantity: shippedQuantity`, and the shipment attributes
      (`Shipment`, `Shipment Line`, `Shipment Line Index`) moved onto the CHILD via
      `extraChildAttributes`. The parent keeps its attributes and gains nothing —
      delete the dead `updatedAttributesObj` code (~944–957 / ~1603–1616) and the
      `"Split Entity ID"`-on-parent write; the retained parent must NOT carry shipment
      attrs (this was the old code's dead intent — make it real).
   b. Shipment activity `trackedActivityInput` rows reference the child for split lots
      (unchanged full-lot shipments keep the original id).
   c. Ledger: builder's 2-row Batch Split pair at the shipment line's bin, then the
      existing shipment ledger rows book against the child.
   d. `splitEntityIds` response: push the RETAINED PARENT ids (label semantics — spec).
2. Void branches untouched (they contain no split logic).

**Verify:**
```bash
deno check --no-lock packages/database/supabase/functions/post-shipment/index.ts 2>&1 | rg -c "post-shipment/index.ts"
# Expected: own-file count unchanged
rg -n "updatedAttributesObj" packages/database/supabase/functions/post-shipment/index.ts
# Expected: no matches (dead code removed)
```

**Out of scope:** `Outbound Transfer` case (no splits), void merge-back (pre-existing
asymmetry, unchanged).

## Task 13: Align quality-disposition subdivideBatchEntity

**Depends on:** Task 4 (types); builder import optional — this file is ERP app code
**Files:**
- Modify: `apps/erp/app/modules/quality/quality-disposition.server.ts` (~195–385)

**Steps:**
1. Identity polarity here is ALREADY post-flip (original keeps `keepQty`, new entity
   carries `moveQty`). Align the contract: stop writing `"Split Entity ID"` onto the
   original (~257–268); write `"Split From Entity ID": original.id` on the new entity;
   activity attributes keep `"Split Entity ID": newEntity.id`; edges become input
   original@moveQty → output newEntity@moveQty only (drop the survivor output);
   ledger becomes the 2-row pair (−moveQty original, +moveQty new).
2. Import `buildBatchSplitRecords` from
   `packages/database/supabase/functions/shared/batch-split.ts` via a relative import if
   the module resolves cleanly under the ERP tsconfig (it is pure, no Deno imports);
   if the import fails to typecheck for path/module-resolution reasons, mirror the
   record shapes inline and add a comment pinning it to `shared/batch-split.ts` — do
   NOT create a second divergent helper elsewhere.
3. Update this file's "keep in sync with issue" comment (~154–163) to reference the
   shared builder as the contract.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** disposition row logic, NCR flows beyond the split mechanics.

## Task 14: Reader filters — root-entity queries + serial assignment + newest-live audit

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` (~2249, ~2280)
- Modify: `packages/database/supabase/functions/assign-serial-numbers/index.ts` (~88–108)
- Audit/modify as needed: `packages/database/supabase/functions/issue/index.ts` (~1165–1179),
  `apps/mes/app/services/operations.service.ts` (~51, ~1151),
  `apps/erp/app/modules/inventory/inventory.service.ts` (~1367),
  `apps/erp/app/modules/production/ui/Jobs/JobHeader.tsx` (~994),
  `apps/erp/app/modules/production/ui/Jobs/JobsTable.tsx` (~104–116),
  `apps/erp/app/routes/x+/issue+/new.tsx` (~288),
  `apps/erp/app/routes/x+/issue+/$id.association.new.tsx` (~427),
  `packages/jobs/src/inngest/functions/tasks/print-job/resolvers.ts` (~157–161)

**Steps:**
1. `production.service.ts` both functions: alongside the existing
   `.is("attributes->>Split Entity ID", null)` add
   `.is("attributes->>Split From Entity ID", null)` (survivors carry neither key across
   both conventions — spec Design Decisions).
2. `assign-serial-numbers`: extend the seed exclusion the same way (exclude rows where
   EITHER pointer key is non-null) so `seeds.length === 1` holds post-flip.
3. Audit each listed "newest live" site: the selection of a make-method/job entity must
   land on the SURVIVOR via a status filter (`status != 'Consumed'` or equivalent), not
   `createdAt` recency (the flip makes the survivor the OLDER row). Where a site already
   filters by status AND that yields exactly one live row, leave it and note it in the
   task log; where it orders by `createdAt` without a status guard, add the status guard.
   If any site's semantics are genuinely "most recent activity" (not "the live lot"),
   STOP and report that site rather than changing it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/jobs
# Expected: exit 0
rg -n "Split From Entity ID" apps/erp/app/modules/production/production.service.ts packages/database/supabase/functions/assign-serial-numbers/index.ts
# Expected: matches at both getTrackedEntit* filters and the seed filter
```

**Out of scope:** rewriting the traveler PDF routes (they consume the fixed service).

## Task 15: MES — issue confirmation, Convert/Scrap retarget, scan mapping, picked-lots semantics

**Depends on:** Tasks 4, 9 (response shape)
**Files:**
- Modify: `apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx`
  (~529–546, ~1041–1075, ~1117–1180, ~1960–1999, scan-tab resolution)
- Modify: `apps/mes/app/services/inventory.service.ts` —
  `getPickedTrackedEntitiesForMaterial` (~401–454)
- Modify: `apps/mes/app/routes/x+/issue-tracked-entity.tsx` (~78–116)

**Steps:**
1. `IssueMaterialModal`: delete the full-screen "Batch Split Occurred" state + its
   `PrintButton` (~1117–1155). On a successful issue with `splitEntities.length > 0`,
   close the modal as the no-split path does and fire ONE toast per split via the
   existing MES toast util: `` t`Issued ${quantity} of ${readableId} — ${remainingQuantity} remains` ``
   (fields from the Task 9 response shape). Keep `ConvertSplitModal`/`ScrapSplitModal`
   flows but retarget them to the surviving lineside entity: post-flip the leftover at
   lineside is the ORIGINAL allocated entity (`split.originalId`), not `newId` — update
   the `entity.newId` matches (~1970 and the Convert/Scrap wiring at ~1156–1180). If
   Convert/Scrap prove to be dead code paths only reachable from the deleted screen,
   delete them too and note it — do not leave unreachable UI.
2. Scan mapping: in the scan-tab resolution path of the modal, when a scanned entity id
   X is not itself allocated/at-lineside for this operation, look for an allocation row
   (in the already-loaded picked-lots data) whose entity has
   `attributes["Split From Entity ID"] === X`; if found, resolve the scan to that child.
   If the modal matches scans by `readableId` rather than entity id, verify the match
   still lands on the allocated lineside child and skip this step with a note.
3. `getPickedTrackedEntitiesForMaterial`: rewrite the docstring (~407–409) — allocated
   ids are now the departing children staged at lineside; behavior/query unchanged
   (allocation rows already point at the lineside entity post-Task-6).
4. `issue-tracked-entity.tsx`: remove the per-split `print-job` trigger (~103–112) and
   the printer resolution that only serves it (~86–101) if now unused. Consumed
   portions get no label (spec).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
rg -n "Batch Split Occurred" apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx
# Expected: no matches
```

**Out of scope:** allocation.ts (no change — FIFO fix falls out of the writers),
IssueMaterialModal seeding/tab logic from spec 2026-07-24 (untouched).

## Task 16: ERP routes — label print retargeting (stock transfer, shipment, maintenance)

**Depends on:** Tasks 4, 11, 12
**Files:**
- Modify: `apps/erp/app/routes/x+/stock-transfer+/$id.line.quantity.tsx` (~125–147)
- Modify: `apps/erp/app/routes/x+/stock-transfer+/$id.scan.$lineId.tsx` (~193–214)
- Modify: `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx` (~308–323)
- Modify: `apps/erp/app/routes/file+/shipment+/$id.labels[.]zpl.tsx` (~61–72)
- Modify: `apps/erp/app/routes/file+/shipment+/$id.labels[.]pdf.tsx` (~61–72)
- Modify: `apps/erp/app/routes/x+/maintenance+/$dispatchId.add-and-issue.tsx` (~105–119)

**Steps:**
1. Stock-transfer routes: `splitEntityId` is now the DEPARTING child. Print the `Entity`
   label for the child (it physically arrives at the destination bin) and keep the
   reprint for the parent (quantity changed) — i.e. the two print calls swap which id is
   "new label" vs "reprint". Resolve roles defensively from the entity's
   `"Split From Entity ID"` attribute rather than positionally (deploy-skew tolerance,
   spec risk table).
2. `$shipmentId.post.tsx`: `splitEntityIds` now carries RETAINED parent ids (Task 12) —
   the print loop needs no id change, only the `sourceDocument` switches from `"Split"`
   to `"Entity"` (these are existing entities being reprinted). Verify
   `packages/printing/src/registry.ts` accepts `Entity` for productLabel (it does — it
   is the standard source); leave the `Split` registry entry for history.
3. Shipment labels download routes: replace the `"Split Entity ID"`-based filter with:
   collect the shipment's tracking entities that carry `"Split From Entity ID"`
   (shipped children), map to their parent ids, print parents; legacy rows (attribute
   `"Split Entity ID"` present on the shipped original) keep the old mapping as a
   fallback so historical shipments still download correct labels.
4. Maintenance route: remove the per-split `Split` print block (~105–119) — consumed
   portions get no label.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
rg -n '"Split"' apps/erp/app/routes/x+/maintenance+/\$dispatchId.add-and-issue.tsx
# Expected: no product-label print with sourceDocument "Split" remains
```

**Out of scope:** `packages/documents` templates (token contract unchanged),
`inventory.service.ts:2933–2950` picking splitEntityId (still intentionally unused).

## Task 17: Validation gates

**Depends on:** Tasks 1–16
**Steps:**
1. `pnpm run lint` — fix anything introduced by these changes.
2. Scoped typechecks (never whole-repo):
   ```bash
   pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/utils --filter=@carbon/jobs
   ```
3. Deno test + own-file check deltas:
   ```bash
   deno test packages/database/supabase/functions/shared/batch-split.test.ts
   deno test packages/database/supabase/functions/issue/resolve-tracked-entity-bin.test.ts
   ```
4. UI strings changed (Task 1 nouns, Task 15 toast) → run lingui extract and fill:
   `pnpm lingui:extract`, then `/translate` if new empty msgstr appear.

**Verify:**
```bash
pnpm run lint && pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/utils --filter=@carbon/jobs
# Expected: both exit 0
```

## Task 18: Browser verification (/test) of acceptance criteria

**Depends on:** Task 17; requires the user's running dev stack (`crbn up`) — never
restart or rebuild it (memory: connect to the running server only).

**Steps:**
1. Invoke `/auth` then `/test` against the spec's acceptance criteria, minimum flows:
   - batch pick 1-of-8 → shelf row same id qty 7 (check Storage Units card + DB row),
     allocation on new child id, activity feed shows only the Transfer row (no phantom
     adjustments), Storage Units grouped row math correct.
   - issue partial from lineside → toast (no split screen, no print), consumed child in
     genealogy, survivor at lineside.
   - complete op/job → leftover merges into shelf entity (7 → 7.5, Merge activity in
     graph), no new Available fragment.
   - unpick → shelf back to 8, Split activity gone.
   - stock transfer partial → child at destination, `stockTransferLine.trackedEntityId`
     = child, unpick merges back (test on a 2-line transfer).
   - traceability graph for the lot: star shape, no self-loop sections on the shelf
     entity's sidebar.
2. Record the playbook to `.ai/playbooks/batch-split-identity-flip.md` per /test.
3. Any failure → STOP, fix, re-run the affected flow before checking off.

**Verify:** the /test run report lists each flow PASS; paste summary into the PR and the
spec changelog.

**Out of scope:** shipment browser flow if no shippable sales order exists in the dev
tenant — cover with the Deno/typecheck level and note it in the run log.
