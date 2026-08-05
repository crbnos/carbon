# Manual testing checklist — Batch Split Identity Flip

## ✅ Browser e2e verified 2026-08-05 (real Chrome, erp.batch-split-identity-flip.dev)

Seeded lot 2026/09 = 8 @ BIN-A via the real `post-inventory-adjustment` edge fn.
Added BATCH-TEST-01 (qty 2, Pull from Inventory) to job J000005 Assembly op,
generated picking list PL000004, and exercised the real edge functions:

**PICK 6-of-8 (post-picking `case "batch"`, Task 6) — ALL INVARIANTS HOLD:**
- shelf `shrc1t…` kept its id, decremented 8→2, no `Split Entity ID` written on it
- new child `F0vLO…` qty 6, `Split From Entity ID = shrc1t…`
- ledger: Batch Split −6 shelf / +6 child @ BIN-A (net 0) + Transfer −6 BIN-A / +6 WC-1 on the **child**
- `pickingListLineTrackedEntity` → the **child** id
- Split genealogy: input parent@6 → **one** output child@6 (no self-loop)

**UNPICK (post-picking `unpickBatch`, Task 7) — CLEAN MERGE-BACK:**
- shelf restored 2→8 Available; child drained to 0 / Consumed
- Split activity deleted; allocation row deleted; on-hand reconciles (shelf 8 @ BIN-A)

**ISSUE partial-consume 2-of-6 (MES `issue` `trackedEntitiesToOperation`, Task 9 —
atomicity-critical) — ALL INVARIANTS HOLD:**
- lineside child `smHXnQA2LZ` kept its id, decremented 6→4 (Available @ WC-1)
- consumed portion is a NEW grandchild `ik-Mt17…` qty 2, **Consumed**, `Split From
  Entity ID` = the lineside child (not the shelf)
- Consume activity input references the **consumed grandchild** (entity + ledger halves
  flipped atomically), Split genealogy input child@2 → ONE output grandchild@2
- ledger booked at the actual lineside bin WC-1 (resolveTrackedEntityBin): Batch Split
  −2/+2 net zero + Consumption −2 on the grandchild
- MES showed the lighter toast "Issued 2 of BATCH-TEST-01 — 4 remains" (Task 15) — no
  full-screen split screen, no label print; picker correctly listed both lots (shelf 2 +
  lineside child 6) and issued from the lineside child

Verified live across the two most important edge functions (post-picking + issue).
Remaining flows (complete→merge sweep Task 8, stock transfer Task 11, shipment Task 12,
NCR disposition Task 13) unverified in-browser — same shared `buildBatchSplitRecords`
builder; cover per the checklist below.

---


Spec: `.ai/specs/2026-08-04-batch-split-identity-flip.md`
Branches: `fix/split-display-fixes` (PR A, display) → `feat/batch-split-identity-flip` (PR B, the flip)

**Core invariant to keep in mind for every split:** the shelf/source lot **keeps its
id and is decremented**; a **new child** entity (same batch number, attribute
`"Split From Entity ID" = <parent id>`) holds the departing quantity. The Split
activity is `input parent@q → output child@q` (no self-loop). The ledger gets exactly
**two** net-zero `Batch Split` rows (−q parent, +q child) at the parent's bin.

## DB helper (authoritative checks)

```bash
DB=$(grep '^SUPABASE_DB_URL' .env.local | cut -d= -f2-)
# Company: d9otj388c0gg27mdg1pg   Item BATCH-TEST-01: item_2vR3NXXDHwTXP99sdyA2d8
# Bins: BIN-A sh_M8q44ioXwZ4HbHwRdXHUHw   WC-1 sh_GEB3c6mNM9nkEexp99VeL8

# Lot rows for the item (id, qty, status, Split From pointer)
psql "$DB" -c "SELECT id, quantity, status, attributes->>'Split From Entity ID' AS split_from FROM \"trackedEntity\" WHERE \"itemId\"='item_2vR3NXXDHwTXP99sdyA2d8' ORDER BY \"createdAt\";"

# Ledger for the item, per bin (should net to on-hand)
psql "$DB" -c "SELECT \"trackedEntityId\", \"storageUnitId\", \"entryType\", \"documentType\", quantity FROM \"itemLedger\" WHERE \"itemId\"='item_2vR3NXXDHwTXP99sdyA2d8' ORDER BY \"createdAt\";"

# Genealogy edges of a split/merge activity
psql "$DB" -c "SELECT a.type, i.\"trackedEntityId\" AS input, i.quantity AS in_qty, o.\"trackedEntityId\" AS output, o.quantity AS out_qty FROM \"trackedActivity\" a LEFT JOIN \"trackedActivityInput\" i ON i.\"trackedActivityId\"=a.id LEFT JOIN \"trackedActivityOutput\" o ON o.\"trackedActivityId\"=a.id WHERE a.type IN ('Split','Merge') ORDER BY a.\"createdAt\";"
```

`BATCH-TEST-01` already exists (batch-tracked). If you want a fresh scenario, seed a
lot via **Inventory → Quantities → BATCH-TEST-01 → Update Inventory** (Set Quantity 8,
Storage Unit BIN-A, Batch Number e.g. `2026/09`).

---

## A. Display fixes (PR A) — safe to verify on any batch lot, incl. historical

- [ ] **Activity feed labels** — Inventory → Quantities → item → Activity tab. Tracked
      rows say "batch"/"serial" per the item's tracking type (not by quantity>1). A
      sub-1 batch quantity is NOT called "serial".
- [ ] **Batch Split rows hidden** — the activity feed shows the Transfer/Consumption
      rows for a pick/issue but NOT the internal `Batch Split` bookkeeping rows.
- [ ] **Storage Units grouping** — item detail → Storage Units card. Fragments of the
      same lot in the same bin collapse into one group row (summed qty, `×N` count,
      earliest expiration, chevron). Expanding shows the member rows; per-row actions
      (edit / print / adjust) live on the members only. A single-member lot renders
      exactly as before (no chevron).
- [ ] **Traceability sidebar** — Inventory → Traceability, open a received lot that has
      been split. Its sidebar shows a **"Splits"** section (not "Produced by Split" /
      "Consumed by Split"). The graph is a star from the received lot, no self-loop.
- [ ] **Expiry popover** — a split child's expiry trace shows "Split from another batch
      — Parent {id}" using the correct parent (child's `Split From Entity ID`). A
      legacy-only lot (old `Split Entity ID`) does NOT show a bogus parent row.

---

## B. Pick (post-picking `case "batch"`)

Setup: a Job whose BOM has BATCH-TEST-01 as a batch material, generate a picking list,
pick **1 of 8** from lot `2026/09`.

- [ ] Shelf lot keeps its id at **qty 7**, same `createdAt` (not a new row).
- [ ] A **new child** lot at qty 1 sits at the lineside bin with
      `"Split From Entity ID" = <shelf id>`.
- [ ] The picking-list allocation (`pickingListLineTrackedEntity`) references the
      **child** id, not the shelf id.
- [ ] Ledger: exactly **−1/+1 `Batch Split`** at the warehouse bin, plus the Transfer
      pair (−1 warehouse / +1 lineside) on the **child**.
- [ ] Activity feed shows only the Transfer (no phantom adjustments); Storage Units math
      is right.

```sql
-- expect: shelf lot 7 (split_from NULL), child lot 1 (split_from = shelf id)
-- expect: Batch Split −1/+1 net zero + Transfer −1/+1 on child
```

## C. Issue / consume (issue `trackedEntitiesToOperation`)

Issue **0.5** of the picked child (0.5 of 1) from the lineside in MES.

- [ ] MES shows a **one-line toast** ("Issued 0.5 of 2026/09 — 0.5 remains"), **no**
      full-screen split screen, **no** label print.
- [ ] A child-of-child at qty 0.5 is **Consumed** with a Consumption ledger row.
- [ ] The lineside survivor keeps the picked-child id at 0.5 Available.
- [ ] Genealogy: the Consume input references the consumed child (not the survivor).

## D. Operation/Job complete → merge-on-return (post-picking return sweep)

Complete the operation/job so the sweep returns the 0.5 lineside leftover.

- [ ] The 0.5 leftover **merges into the shelf lot** (7 → 7.5) with a **`Merge`**
      activity (input child@0.5 → output shelf@0.5).
- [ ] **No** new Available fragment is left behind.
- [ ] Picking-list header status unchanged (return booked on `quantityReturned`, not
      `quantityPicked`).

## E. Unpick (post-picking `unpickBatch`)

Unpick the batch pick from D's picking list (before consuming, or on a fresh pick).

- [ ] Shelf lot back to **8**; allocation row gone.
- [ ] The **Split activity is deleted** (clean undo); child set Consumed@0.
- [ ] Ledger transfer reversed at the picked magnitude (from the allocation row, not
      the entity's current qty).

## F. Stock transfer (post-stock-transfer `case "batch"` + `unpickBatch`)

Inventory → Stock Transfers, new transfer, move **2** of the 8-lot from BIN-A to WC-1.

- [ ] Source lot stays in BIN-A at **qty 6**; a **new child qty 2** at WC-1 with
      `Split From Entity ID`.
- [ ] `stockTransferLine.trackedEntityId` = the **child** id.
- [ ] Ledger: Batch Split −2/+2 at source + Transfer pair to WC-1 on the child.
- [ ] **Unpick that line** → merges the child fully back into the source lot (6 → 8),
      Split activity deleted. **Test on a 2-line transfer** to confirm the scoped
      Split-activity lookup (each line's unpick deletes only its own Split).

## G. Shipment (post-shipment SO block)

Requires a shippable sales order with a batch line. Ship a partial lot (e.g. 3 of 8).

- [ ] Retained shelf lot keeps its id, decremented, and carries **no** shipment
      attributes.
- [ ] The **shipped child** is Consumed; the `Sales Shipment` ledger books against the
      child.
- [ ] Auto-print / labels-download route emits labels for the **retained** lot(s) only
      (shipped child gets none).
- [ ] (PO-sourced / subcontract shipment, if reachable: split posts genealogy only —
      **no** itemLedger — matching pre-flip behavior. This was a self-review fix.)

## H. NCR disposition (quality `subdivideBatchEntity`)

Quality → Issue with a batch item, split a disposition row mid-lot.

- [ ] Original lot keeps its id + `keepQty`; new lot has `moveQty` +
      `Split From Entity ID`; 2-row net-zero Batch Split ledger.

---

## I. Cross-cutting invariants

- [ ] **Serial assignment** — a job whose output batch was split still assigns serials
      (seed filter matches exactly 1; excludes both pointer keys).
- [ ] **Traveler PDF** prints the surviving lot id (production reader filter).
- [ ] **Availability picker** — after a pick, the lot shows 7 available at the warehouse;
      FEFO/FIFO position unchanged (survivor keeps its `createdAt`).
- [ ] **MES scan mapping** — scanning the shelf label id in the issue modal resolves to
      the allocated lineside child for that operation.
- [ ] **Full-quantity draw** (q = whole lot) still produces **no** Split.
- [ ] **Historical fragments** (pre-flip lots with old `Split Entity ID`) still render,
      return, and consume correctly.
- [ ] **Per-bin ledger nets** — after every flow, `itemLedger` per (entity, bin) is
      non-negative and total on-hand matches the Storage Units card.

## J. Regression sanity

- [ ] Serial pick/issue/unpick unchanged (serials never split).
- [ ] A non-tracked (Inventory) item's pick/issue unchanged.
- [ ] Traceability graph for a fully-consumed lot renders without the dragged-node
      crash (separate pre-existing bug flagged as a background task — not part of this
      change).
```
