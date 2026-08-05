# Batch Split Identity Flip — shelf lot keeps its identity

> Status: draft
> Author: Sid (design interview) + Claude
> Date: 2026-08-04
> Research: `.ai/research/batch-split-identity.md`
> Decision source: Slack (Brad Barbin / Davide Codemo / Umberto / Sid), May 15 + Jul 21 2026 —
> "during a split — existing batch stays on shelf with updated quantity, new batch gets
> consumed by job." Believed implemented; verified 2026-08-04 it never was.

## TLDR

Every partial draw from a batch (pick, issue/consume, stock transfer, shipment, NCR
disposition) writes a Split where the ORIGINAL `trackedEntity` id follows the DEPARTING
portion and a NEW id is minted for the remainder left on the shelf. This spec inverts the
convention in all five split writers: **the shelf entity keeps its id and is decremented;
the departing portion is the new entity.** Returns MERGE quantity back into the shelf
entity. Effects: physical shelf labels/QRs stay valid forever, Storage Units shows one row
per lot per bin in steady state, FEFO/FIFO ordering stops being corrupted by splits
(`createdAt` no longer churns), the traceability graph becomes a star rooted at the
received lot instead of a chain of renamed remainders, and fragment count stops growing
monotonically. Batch-only: serial paths never split. **No DB migration** — the entire
convention lives in edge-function/app code and JSONB attributes; SQL is convention-agnostic
(verified: zero migrations reference `'Split'` or `"Split Entity ID"`).

## Problem Statement

Observed on a live tenant (Zero Farms), lot `2026/09`, item SD08810001:

1. One routine job cycle (pick 1 kg from an 8 kg lot, issue 0.5, return 0.5) produces
   2 Split activities and 3 surviving fragments of the same lot — Storage Units shows
   `0.5`, `7`, `1` as three indistinguishable `2026/09` rows. Fragments never re-merge, so
   the count grows forever.
2. The shelf bag's printed label/QR points at the entity id that LEFT with the picker —
   every physical label goes stale on the first partial draw (Umberto: "forgetting to
   print the new label").
3. The traceability graph is a chain of renamed remainders + one Split diamond per draw;
   the survivor is recorded as both input and output of its own Split, so the sidebar
   claims a receipt-originated lot was "Produced by Split" and "Consumed by Split 8" while
   Available at qty 1.
4. FEFO/FIFO picking is corrupted: the shelf remainder is a NEW row with a fresh
   `createdAt` after every draw (`sortLotsByPickMethod` and the availability RPCs order by
   `createdAt`).
5. The activity feed renders the split's internal ledger triplet as three phantom human
   "adjustments" per pick, and calls sub-1 batch quantities "serial".

Industry consensus (see research file): lot number = identity; stock = quantity per
(lot, location); nobody mints new lot identities on partial draws. Fragments carry zero
traceability information for a homogeneous batch.

## Proposed Solution

### New convention (batch draws only)

On a partial draw of `parent` (shelf/lineside entity) for quantity `q`:

1. Create `child` entity: new nanoid, same `readableId` / `sourceDocument*` / `itemId` /
   `expirationDate`, cloned `attributes` **plus** `"Split From Entity ID": parent.id`
   (and minus any stale pointer keys), `quantity: q`, status per flow (Available for
   pick/transfer; the consuming flows set it Consumed in the same transaction).
2. Decrement `parent.quantity -= q`. Parent attributes are NOT tagged (no more
   `"Split Entity ID"` on the survivor).
3. Split activity: `trackedActivityInput` = parent @ `q`; `trackedActivityOutput` =
   child @ `q`. **No survivor self-loop** (today's input @ full-qty + output @ kept-qty
   pair is dropped). Activity `attributes` keep `Original Quantity` / `Remaining
   Quantity` / the flow's drawn-quantity key, plus `"Split Entity ID": child.id` —
   standardized across all writers (post-shipment omits it today).
4. Ledger: **two** net-zero `Batch Split` rows at the parent's resolved bin
   (`resolveTrackedEntityBin` — lesson `.ai/lessons.md` "actual bin"): `−q` on parent,
   `+q` on child. (Replaces today's `−full/+kept/+remainder` triplet.) The subsequent
   movement (Transfer pair / Consumption / Shipment) books against **child**.
5. Everything downstream that tracked the departing portion references **child**:
   `pickingListLineTrackedEntity` allocation, `stockTransferLine.trackedEntityId`,
   `maintenanceDispatchItemTrackedEntity`, Consume activity input, `status: "Consumed"`,
   Consumption/Shipment ledger rows, `splitEntityId`/`splitEntities[].newId` responses.

Full-quantity draws (q = parent quantity) keep today's no-split fast path unchanged.

### Merge-on-return (new)

When leftover tracked material returns to the warehouse (return sweep at op/job complete),
each returning entity `E` with lineside on-hand `r`:

- Resolve `P` = `E.attributes["Split From Entity ID"]` (one hop; the sweep's lineage
  members each carry a direct pointer).
- **Merge** when `P` exists, `P.status = 'Available'`, `P.readableId = E.readableId`, and
  `P`'s resolved bin = the return target bin: ledger Transfer `−r` on E @ lineside,
  `+r` on P @ target bin; `P.quantity += r`; `E.quantity −= r`, and when it hits 0 →
  `E.status = 'Consumed'`. Genealogy: new `trackedActivity` `type: "Merge"` with input
  E @ `r`, output P @ `r` (type is TEXT — no enum change; UI renders it generically).
- **Fallback** (P missing / not Available / different bin): today's behavior — E returns
  as its own Available entity at the target bin. Never block a return on merge
  eligibility.

**Unpick** (post-picking `unpickBatch`, post-stock-transfer `unpickBatch`) is an undo, not
a return: reverse the Transfer pair for the **allocated child** (quantity from the
allocation row / transfer line — NOT `trackedEntity.quantity`), restore
`parent.quantity += q`, set child `Consumed` @ 0 (row kept — `itemLedger.trackedEntityId`
FK is `ON DELETE SET NULL`; deleting would null history), and DELETE the Split activity +
its input/output rows (clean undo, matching today's Pick-activity deletion). The
stock-transfer merge-back branch detects the split via the child's
`"Split From Entity ID"` (today it reads the pointer off the departing original) and its
Split-activity lookup gets scoped to the entity + transfer (fixes the pre-existing
multi-line bug at `post-stock-transfer/index.ts:884`).

No destination-bin auto-merge in v1 (user-resolved): a transferred child arriving at a bin
that already holds the same lot stays its own entity.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Which side keeps identity | Shelf/source entity keeps id + decrements; departing portion = new entity | Team decision (Slack May 15). Industry: lot identity pinned to stock at rest; labels stay valid. |
| Scope | Batch only; all five writers in lockstep (`post-picking` batch, `issue` ×2, `post-stock-transfer` batch, `post-shipment` SO + PO, `quality-disposition.subdivideBatchEntity`) | Serial paths never split (verified). quality-disposition already has the survivor-keeps-id shape; only pointer/edges/ledger align. Its own comment mandates lockstep with `issue`. |
| Pointer attribute | Stop tagging the survivor; write `"Split From Entity ID": parentId` on the child. Type added to `TrackedEntityAttributes` (`packages/utils/src/types.ts`, `functions/lib/utils.ts`) | A survivor can split many times — a single-valued forward pointer can't hold N children (already broken in spirit today). Child→parent is 1:1, and it's exactly what merge-back needs. |
| "Root/live entity" filters | `.is('attributes->>Split Entity ID', null)` sites additionally filter `.is('attributes->>Split From Entity ID', null)` | Legacy key excludes old departed originals; new key excludes new children. Survivors carry neither → filters keep returning exactly the live root across mixed history. Sites: `production.service.ts:2249,:2280` (traveler PDFs, job page), `assign-serial-numbers/index.ts:88–108`. |
| Split activity edge shape | input = parent @ q; output = child @ q. No survivor self-loop | Honest quantities (edge = the draw), kills "Produced by Split ×2 / Consumed by Split 8" sidebar lies, no strict-RPC self-loop reliance for new data. Mass balance is still derivable from activity attributes. |
| Split ledger rows | 2-row net-zero pair (−q parent / +q child) at parent's `resolveTrackedEntityBin` bin; `documentType: 'Batch Split'` unchanged | Halves feed noise; keeps Xero net-zero exclusion valid (`inventory-adjustment.ts:101–110`); honors the actual-bin lesson. |
| Allocation rows | `pickingListLineTrackedEntity` records the **child** id at posting | Child is the lineside lot — the thing the operator consumes. Availability RPCs need NO change: allocated child sits in excluded lineside bins (same shape as today's departed original); parent is never allocated so its shelf availability is its real remaining qty. |
| Return semantics | Merge into parent (conditions above) with standalone-fragment fallback; Merge activity for genealogy | User-resolved. Odoo-quant behavior per (lot, bin); zero fragments in steady state. |
| Destination merge | None in v1 | User-resolved. Minimal change; revisit. |
| Unpick semantics | Undo: reverse transfer using allocation/line quantity, parent re-increment, child Consumed@0, Split activity deleted | Mirrors today's delete-the-Pick-activity philosophy; fixes `unpickBatch`'s use of `trackedEntity.quantity` (post-flip that would be the remainder) and the unscoped stock-transfer Split lookup. |
| History | Forward-only; no data migration | User-resolved. Old fragments drain as consumed; matches SAP-style convention changes. |
| `splitEntityId` / `splitEntities[].newId` responses | Meaning flips to "departing child id"; every consumer updated in the same PR; app-side consumers resolve the entity's ROLE from `"Split From Entity ID"` rather than assuming | Tolerates the brief function/app deploy skew on release. |
| MES issue UX | Kill the full-screen "Batch Split Occurred" flow; show a one-line confirmation ("Issued 0.5 of 2026/09 — 0.5 remains at {bin}"). No auto label print on issue/maintenance paths. Convert/Scrap retarget to the surviving lineside entity | User-resolved (lighter confirmation option). Consumed portions need no label (Brad). |
| Labels | Stock transfer: print Entity label for the child (it physically arrives somewhere new) + keep the parent reprint (qty changed). Shipment: auto-print retargets to the RETAINED parents (qty changed); shipped child gets no label. Picking: still prints nothing (existing gap; lineside flows scan by lot/allocation, see scan mapping) | Labels exist for stock at rest. `file+/shipment+/$id.labels[.]{zpl,pdf}` resolve retained lots via the child's `"Split From Entity ID"` instead of the legacy forward pointer. |
| MES scan mapping | Issue-modal scan of a parent (shelf label) resolves to its allocated lineside child for the operation when one exists (via `pickingListLineTrackedEntity` + `Split From` pointer) | Today scanning the shelf label "works" only because the shelf label's id departed. Post-flip the shelf label points at warehouse stock; without mapping, issue would consume the warehouse lot at the wrong bin — silent-corruption site #3's cousin. |
| "Newest live" lookups | Every `attributes->>'Job Make Method'`-family lookup selects the survivor via `status != 'Consumed'` (exactly one live row); never by `createdAt` recency | The flip inverts the age signal (survivor becomes the OLDER row). Sites enumerated in the plan (issue `:1165`, MES `operations.service.ts:51,:1151`, `inventory.service.ts:1367`, JobHeader/JobsTable, print-job resolvers, issue routes). |
| Multi-tenancy / auth | No new tables, no RLS, no schema change; all writes stay inside the existing edge-function transactions with existing `companyId` scoping | Heuristics 1–4 satisfied by construction; heuristics 5–6 N/A (no new forms/modules). |
| Tests | New Deno tests colocated with the edge functions asserting WHICH id gets: Consumed status, Consumption ledger, allocation row, merged-back quantity | Zero regression coverage exists today and 10 of the breakage modes are silent. |

## Data Model Changes

**None.** No migration, no `generate:types`. The convention lives entirely in:
- edge-function code (`packages/database/supabase/functions/{post-picking,issue,post-stock-transfer,post-shipment}`),
- `apps/erp/app/modules/quality/quality-disposition.server.ts`,
- JSONB `trackedEntity.attributes` keys (`"Split From Entity ID"` new, `"Split Entity ID"` no longer written on entities, still written on Split **activity** attributes),
- a new `trackedActivity.type` value `'Merge'` (TEXT column — no enum).

Verified: no SQL function/view/trigger references `'Split'` or `"Split Entity ID"`.

## API / Service Changes

### Writers (the flip itself)

1. **`post-picking` `case "batch"`** — child = departing lineside lot: Split edges, 2-row
   ledger, Transfer pair on child, Pick activity input on child,
   `pickingListLineTrackedEntity` upsert keyed on child.
2. **`post-picking` `unpickBatch`** — target the allocated child (qty from allocation
   row), merge back into parent, delete Split; `unpickSerial` untouched.
3. **`post-picking` `returnTrackedAllocationRemainder`** — walk unchanged (seed = child,
   forward walk still superset); per returning entity apply merge-on-return; allocation
   decrement stays keyed on the allocated (child) id. Untracked path untouched.
4. **`issue` `trackedEntitiesToOperation`** — child = consumed portion: Consumed status,
   Consume input, Consumption ledger, `splitEntities[].newId` all on child; parent only
   decremented. MTO no-ledger branch keeps parity.
5. **`issue` `maintenanceDispatchTrackedEntities`** — same, plus
   `maintenanceDispatchItemTrackedEntity` junction gets child; align its bin resolution
   with `resolveTrackedEntityBin` (pre-existing inconsistency).
6. **`post-stock-transfer` `case "batch"`** — child departs to `toStorageUnitId`;
   `stockTransferLine.trackedEntityId = child`; `unpickBatch` merge-back re-detected via
   child's `Split From` pointer + scoped activity lookup.
7. **`post-shipment` SO + PO blocks** — child = shipped portion (Consumed, shipment
   attrs); parent retains id + keeps NO shipment attributes (deletes the dead
   `updatedAttributesObj` code by making the live path do what it intended);
   `splitEntityIds` becomes the retained-parent ids (see labels decision).
8. **`quality-disposition.subdivideBatchEntity`** — pointer + edges + 2-row ledger
   aligned (identity polarity already correct).

### Readers

- `production.service.ts` `getTrackedEntityByJobId` / `getTrackedEntitiesByJobId`: add
  `Split From` null-filter (traveler PDFs, job routes).
- `assign-serial-numbers`: seed filter excludes both pointer keys.
- MES `inventory.service.ts` `getPickedTrackedEntitiesForMaterial`: docstring + semantics
  (allocated ids are now the lineside children — still valid picker options).
- MES `IssueMaterialModal`: lighter confirmation, Convert/Scrap retarget, scan mapping
  parent→allocated child.
- `apps/mes/app/routes/x+/issue-tracked-entity.tsx`, ERP
  `maintenance+/$dispatchId.add-and-issue.tsx`: drop Split auto-print.
- Stock-transfer routes (`$id.line.quantity.tsx`, `$id.scan.$lineId.tsx`): swap label
  roles (child = new Entity label, parent = reprint).
- `shipment+/$shipmentId.post.tsx` + `file+/shipment+/$id.labels[.]{zpl,pdf}.tsx`:
  retained-parent label resolution.
- "Newest live" audit across the §Design-Decisions list.
- `ExpiryTracePopover.tsx`: "Split from another batch — Parent {id}" reads the child's
  `Split From` pointer (finally correct).

## UI Changes

Companion display fixes (separate PR, shippable first — they help historical data too):

1. `InventoryActivity.tsx`: label from `itemTrackingType` (kill the `qty > 1 ? "batch" :
   "serial"` heuristic, 6 sites); hide `documentType: 'Batch Split'` rows from the feed
   (internal bookkeeping — the Transfer/Consumption rows tell the story).
2. `InventoryStorageUnits.tsx` (+ its quantities source): group rows by
   (`readableId`, storage unit), summed quantity, expandable to fragments.
3. Traceability sidebar + graph: filter/relabel self-loop Split rows (historical data
   keeps them forever under forward-only).

## Acceptance Criteria

All on a batch-tracked item; `X` = shelf entity id before the action.

- [ ] Pick 1 from an 8 kg lot: shelf row keeps id `X` at qty 7 (same `createdAt`), a new
      entity at qty 1 sits at the lineside bin with `"Split From Entity ID" = X`, the
      picking-list allocation references the new id, Split activity edges are
      input `X`@1 → output child@1, ledger shows exactly −1/+1 `Batch Split` at the
      warehouse bin + the Transfer pair on the child.
- [ ] Issue 0.5 of that child: child-of-child qty 0.5 is Consumed with the Consumption
      ledger row; the lineside survivor keeps the child id at 0.5 Available; MES shows the
      one-line confirmation and does NOT print a label or show the split screen.
- [ ] Job completes: the 0.5 lineside leftover merges into `X` (7 → 7.5) with a Merge
      activity; no new Available fragment exists; picking-list header status unchanged.
- [ ] Unpick the batch pick: `X` back to 8, allocation row gone, Split activity gone,
      child Consumed@0; ledger transfer reversed at the correct magnitude.
- [ ] Stock-transfer 2 of `X` to bin B: `X` stays in source bin at qty−2; new entity qty 2
      at B; `stockTransferLine.trackedEntityId` = new id; unpicking that line merges back
      into `X` and works on a multi-line transfer.
- [ ] Ship partial lot: retained shelf entity keeps `X` + no shipment attributes; shipped
      child is Consumed; auto-print and the labels download route emit labels for the
      RETAINED lot(s) only.
- [ ] Serial-number assignment on a job whose output batch was split still assigns
      (seed filter matches exactly 1).
- [ ] Traveler PDF prints the surviving lot id.
- [ ] Availability picker: after the pick, lot `X` shows 7 available at the warehouse;
      FEFO/FIFO position unchanged from before the pick.
- [ ] Scanning the shelf label (id `X`) in the MES issue modal resolves to the allocated
      lineside child for that operation.
- [ ] Full-quantity draw still produces no Split.
- [ ] Historical fragments still render, return, and consume correctly (forward-only).
- [ ] Deno tests cover: which id gets Consumed/ledger/allocation in `issue`;
      pick-split + unpick round-trip in `post-picking`; transfer-split + merge-back in
      `post-stock-transfer`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Partial flip in `issue` (entity half flipped, Consumed/ledger half not) marks the shelf remainder Consumed → double-counted on-hand | High | Flip each writer as one atomic edit; Deno test asserts the consumed id; acceptance #2. |
| Stock-transfer unpick merge-back silently stops detecting splits | High | Re-detection via child pointer + scoped lookup; acceptance #5 includes multi-line. |
| Allocation/netting mismatch hides shelf availability | High | Child-keyed allocation + RPC no-change argument (children live in excluded lineside bins); acceptance #9. |
| MES picked-lot suggestions / scan point at warehouse stock | High | Child-keyed allocations + parent→child scan mapping; acceptance #11. |
| "Newest live" heuristics select the wrong row once the survivor is the older one | Med | Status-based selection rule; per-site audit task in the plan. |
| Serial assignment no-ops (seed filter matches 2) | Med | Dual-key null filter; acceptance #7. |
| Wrong-magnitude unpick (uses `trackedEntity.quantity`) | Med | Quantity from allocation/line rows; acceptance #4. |
| Deploy skew between edge functions and apps briefly inverts label roles | Low | App consumers resolve role from `Split From` attribute, not positional assumption. |
| Mixed-history confusion (old fragments + new convention) | Low | Forward-only decision; filters handle both keys; display grouping collapses old noise. |
| Merge-on-return books into a moved/consumed parent | Low | Merge guarded (Available + same lot + same bin), else standalone fallback. |

## Open Questions

> All resolved with Sid before this spec was written (AskUserQuestion, 2026-08-04).

- [x] Merge-on-return vs keep-separate — **Answer:** merge into parent when parent is
      Available/same-lot/same-bin; standalone fragment fallback. Merge activity for
      genealogy.
- [x] Destination-bin auto-merge on stock transfer — **Answer:** no, v1 forward-only per
      (lot, arrival); revisit later.
- [x] MES split ceremony — **Answer:** replace with a lighter one-line confirmation
      ("issued q, r remains"); no label print; Convert/Scrap retarget to the surviving
      lineside entity.
- [x] Historical fragments — **Answer:** forward-only, no data migration.

## Changelog

- 2026-08-04: Created after code-verified blast-radius sweep (5 writers, 10 silent-risk
  sites, no SQL coupling, no test coverage) + desk research
  (`.ai/research/batch-split-identity.md`) + 4 user-resolved questions. Companion display
  fixes scoped as a separate first PR.
