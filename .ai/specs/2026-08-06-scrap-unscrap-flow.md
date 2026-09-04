# Scrap & Unscrap Flow — Tracked-Entity Scrap in MES + ERP Stock Scrap/Unscrap with Full Posting

> Status: draft (autonomous-mode spec — all Open Questions resolved autonomously; review the **Autonomous:** markers before implementation)
> Author: Claude (for Brad Barbin)
> Date: 2026-08-06
> Research: `.ai/research/scrap-unscrap-flow.md` (SAP / Oracle Fusion / NetSuite / Epicor / Infor / JobBOSS / Plex / Fulcrum survey)
> Related: `.ai/specs/2026-07-14-inventory-adjustment-gl-posting.md` (shared posting core), `.ai/specs/2026-08-04-batch-split-identity-flip.md` (split conventions), `.claude/rules/traceability-model.md`, `.claude/rules/mes-job-operation-ui.md`

## TLDR

Scrap in Carbon today is a quantity bucket: MES scrap inserts a
`productionQuantity` `type='Scrap'` row and backflushes materials, but the
scrapped output never touches `trackedEntity` status, `itemLedger`, cost layers,
or the GL — and the operation's auto-Done predicate counts scrap toward
`targetQuantity`, so a scrapped serial silently shorts the job. This spec makes
scrap a first-class inventory/traceability/GL event across three surfaces,
shared by the MES **job operation view and assembly view** (which already share
`QuantityModal`, the scrap route, and the entity-scrap route):

1. **Scrap the serial unit being made** → terminal `Scrapped` status on the
   selected entity, a `Scrap` genealogy activity, materials-backflush kept,
   Dr `scrapAccount` / Cr WIP for the unit's consumed-material cost, and —
   improving on every surveyed competitor — **auto-spawn of the next serial**
   (the existing `jobOperationSerialComplete` spawn). The auto-Done
   predicate stops counting `quantityScrapped`, so the operation stays open
   until **good** quantity reaches `targetQuantity` — no target mutation.
2. **Scrap an already-made BOM part** → *Pull from Inventory*: scrap from stock
   (Dr `scrapAccount` / Cr inventory), requirement stays open so the operator
   pulls a replacement. *Make to Order*: `Scrapped` status + Dr `scrapAccount` /
   Cr WIP, plus an opt-out **replacement flow** that reopens the subassembly's
   Done operations, tops up `operationQuantity` capacity when scrap exceeds
   the planned allowance, and spawns the replacement serial ("made 3,
   scrapped 1 → make 1 more").
3. **Batch parts** → partial-quantity scrap via the batch-split convention
   (child departs `Scrapped`, parent keeps its id).

In the **ERP**, available stock gains first-class **Scrap / Unscrap** actions
(SAP 551/552 + Oracle Return-from-Scrap pattern) built on the existing
`post-inventory-adjustment` → `bookAdjustment` core with
`offsetAccount = accountDefault.scrapAccount` (already seeded), mandatory scrap
reason, `Scrapped` entity status, and unscrap reversing **at the original
scrapped cost** via `correctionOfItemLedgerId`. Every path updates inventory,
`itemLedger`, cost layers, and `journalLine`s atomically.

## Problem Statement

Verified current state (file:line refs from repo @ `new-york`):

1. **Operation-output scrap posts nothing.** `apps/mes/app/routes/x+/scrap.tsx`
   → `insertScrapQuantity` (`operations.service.ts:1516`) inserts
   `productionQuantity` `type='Scrap'`, then backflushes BOM materials via the
   `issue` edge function. No `trackedEntity` change, no `itemLedger`, no
   `costLedger`, no journal. The consumed materials sit in WIP forever (until
   `close-job` washes them to `materialVarianceAccount`).
2. **The scrapped serial still counts as done.** The auto-Done predicate
   (`sync_update_job_operation_quantities`, newest `20260706181125:91`) is
   `(quantityComplete + quantityReworked + quantityScrapped) >= targetQuantity`
   — but `targetQuantity` is defined as the **good** quantity before scrap
   (`20260119120000` column comment; `get-method` sets `operationQuantity` =
   target + planned scrap allowance). So scrap consumes good-target capacity:
   "make 3, scrap 1" flips the op Done with 2 good units and no replacement
   serial is ever created — and even *planned* scrap shorts the job (target 10
   good + 2 planned scrap auto-Dones at 8 good + 2 scrap).
3. **The only posting scrap path conflates scrap with consumption.** `issue`
   case `scrapTrackedEntity` (`functions/issue/index.ts:1682-1871`; reached only
   from `x+/entity+/$materialId.$trackedEntityId.scrap.tsx`) sets the entity
   `status='Consumed'`, posts `Consumption`/`Job Consumption` into **WIP**
   (job absorbs the loss into finished-goods cost), bumps
   `jobMaterial.quantityIssued` (so the requirement looks satisfied and no
   replacement is prompted), takes **no scrap reason**, and posts **nothing**
   for Make-to-Order materials.
4. **No terminal scrap state, no scrap ledger identity.** `trackedEntityStatus`
   = `Available|Reserved|On Hold|Consumed|Rejected` — no `Scrapped`. No `Scrap`
   value in `itemLedgerDocumentType`/`journalLineDocumentType`. Scrap is
   invisible to traceability queries and indistinguishable in the GL.
5. **No ERP stock scrap/unscrap.** The quantities page offers only
   Positive/Negative Adjmt./Set Quantity with the generic
   `inventoryAdjustmentVarianceAccount` offset; scrapping a damaged shelf part
   is indistinguishable from count shrinkage, and there is no way to restore a
   wrongly-scrapped entity.
6. **The building blocks already exist**: `accountDefault.scrapAccount`
   (`20260726012013`, seeded with fallback to
   `inventoryAdjustmentVarianceAccount`); `bookAdjustment` in
   `functions/shared/post-adjustment.ts` already accepts an `offsetAccount`
   (the header comment names scrapAccount; `post-nonconformance` uses it);
   the serial-spawn logic (`jobOperationSerialComplete`,
   `issue/index.ts:1301-1367`); the batch-split builder
   (`shared/batch-split.ts`); rework machinery (`rework` table,
   `trigger-rework` op-quantity pattern); `calculateCOGS`;
   `correctionOfItemLedgerId`; scrap reasons (`scrapReason` table +
   `productionQuantity.scrapReasonId`).

## Proposed Solution

### 0. Shared vocabulary (migration)

- `trackedEntityStatus` += **`'Scrapped'`** — terminal. Excluded everywhere
  `Rejected` is excluded (`get_inventory_quantities`,
  `get_available_tracked_entities`, `get_picking_list_tracked_available`,
  picker RPCs). Unlike `Consumed`, a `Scrapped` entity is recoverable via
  Unscrap (ERP) and is queryable for scrap analysis.
- `itemLedgerDocumentType` += **`'Scrap'`** — stamped on scrap and unscrap
  movements (unscrap = positive quantity, same documentType, linked via
  `correctionOfItemLedgerId`).
- `journalLineDocumentType` += **`'Scrap'`** (separate enum — the
  journal/ledger enums are different; lesson `journalLineDocumentType…`).
- `itemLedger.scrapReasonId` TEXT NULL, FK → `scrapReason` — reason lands on
  the movement for stock scrap (MES production scrap keeps its reason on
  `productionQuantity.scrapReasonId`).
- `trackedActivity.type` values `'Scrap'` / `'Unscrap'` (TEXT column — no enum
  change).

### 1. MES: scrap the tracked unit being made (use case 1)

New `issue` edge-function case **`jobOperationSerialScrap`** (mirror of
`jobOperationSerialComplete`, one Kysely transaction), invoked from the
existing scrap route when the parent make method is serial-tracked. The
`QuantityModal` scrap branch and `x+/scrap.tsx` are shared by
`JobOperation.tsx` and `AssemblyView.tsx`, so **both views get this by
construction** — the modal gains the selected serial's `readableId`
confirmation, keeps `ScrapReason` (required) + notes.

Transaction steps:

1. `productionQuantity` `type='Scrap'`, `scrapReasonId`, notes (unchanged
   shape; the quantity-sync interceptor keeps aggregating `quantityScrapped`).
2. Backflush the unit's BOM for the current operation
   (`issueJobOperationMaterials`) — **kept**: material cost enters WIP exactly
   as today (NetSuite "Issue for Scrap" pattern).
3. `trackedActivity` `type='Scrap'`, `sourceDocument='Job Operation'`, with
   `trackedActivityInput` (entity, qty 1); entity `status='Scrapped'`,
   attributes stamped (`Operation ${jobOperationId}`, `Scrap Reason`). The
   entity's consumed-material genealogy is preserved — the scrapped unit keeps
   its full input tree.
4. **GL** (when `accountingEnabled`): Dr `scrapAccount` / Cr
   `workInProgressAccount` for the unit's **accumulated consumed-material
   cost**: the current-op backflush cost (computed in-transaction) plus the
   cost of prior consumption ledger rows reachable from the entity's genealogy
   inputs. Labor/overhead already absorbed stay in WIP and settle via
   `close-job` variance (v1 — see Design Decision 6). `sourceType`
   `'Job Consumption'`-family journal with `documentType='Scrap'`,
   `documentId=jobId`. **Dimension tags** (Brad, 2026-08-07): every scrap
   journal line carries `journalLineDimension` rows for whichever of these
   dimensions are active on the company group — Item, ItemPostingGroup,
   Location (the adjustment precedent) **plus ScrapReason (new
   `dimensionEntityType` value, valueId = `scrapReason.id`), WorkCenter (the
   operation's `workCenterId`), and Employee (the scrapping user)** — so one
   flat `scrapAccount` slices by reason/work center/operator/item in
   reporting instead of ever needing multiple scrap accounts.
5. **Spawn the next serial** (the user-visible headline): same
   `getNextSerialNumbers` + `Reserved`-entity insert as
   `jobOperationSerialComplete:1301-1367`, spawned whenever good (non-Scrapped)
   entities for the make method < the good quantity still required. Return
   `newTrackedEntityId`; the client navigates to it exactly as the complete
   flow does.
6. **Auto-Done predicate fix + reopen** (Brad, 2026-08-07): the migration
   redefines `sync_update_job_operation_quantities` (fork the **newest** body,
   `20260706181125`) so the Done predicate becomes
   `(quantityComplete + quantityReworked) >= targetQuantity` — scrap no longer
   counts toward the good target. `targetQuantity` is already the good
   quantity (`20260119120000`), so an operation now stays open until the good
   units are actually made; no `targetQuantity` mutation on scrap, ever.
   In the scrap transaction itself:
   - Reopen `status='Done'` operations of the affected `jobMakeMethod` to
     `'Ready'` — the replacement unit must pass through **all** operations,
     not just the current one. (A reopened op re-flips Done via the
     interceptor as soon as the replacement's quantities are recorded.)
   - **Capacity top-up only beyond plan**: when cumulative actual scrap
     exceeds the planned allowance (`operationQuantity − targetQuantity`),
     bump `operationQuantity` by the excess, bump `job.scrapQuantity`
     likewise when the make method is the root (keeps the generated
     `job.productionQuantity` and serial planning coherent), and refresh the
     make method's `jobMaterial` estimated quantities
     (`quantityPerParent × new operationQuantity` — mirroring
     `recalculateJobRequirements` math, which is ERP-side and unavailable in
     Deno). Within the allowance, capacity already exists — no writes.
   - Reschedule via the same invoke `trigger-rework` uses.

**Batch parent being made**: scrap quantity `q` is recorded as
`productionQuantity` `type='Scrap'` (as today) + the same WIP→scrap GL leg for
`q` units' material cost; the in-progress lot's `trackedEntity.quantity` only
ever receives good quantity at `jobOperationBatchComplete`, so no entity write
is needed pre-completion; the §1.6 reopen/top-up applies identically (no
serial spawn — the lot absorbs the replacement quantity).

### 2. MES: scrap an already-made BOM part (use case 2)

Rework of `issue` case **`scrapTrackedEntity`** (route
`x+/entity+/$materialId.$trackedEntityId.scrap.tsx`, reachable from the
Materials section of both views). Payload gains required `scrapReasonId` and
`makeReplacement: boolean`. Branches by `jobMaterial.methodType`:

- **Pull from Inventory / Purchase to Order** (the part physically came from
  stock): the part is scrapped **from stock**, not consumed into the job:
  - `itemLedger` `entryType='Negative Adjmt.'`, `documentType='Scrap'`,
    `scrapReasonId`, negative quantity at the entity's actual on-hand bin
    (`resolveTrackedEntityBin` — lesson: never `.find(...)?.storageUnitId`).
  - Cost layers via `calculateCOGS`; GL Dr `scrapAccount` / Cr inventory
    (`resolveInventoryAccount`) through the shared `bookAdjustment` core.
  - Entity `status='Scrapped'`; `trackedActivity` `type='Scrap'` with the
    entity as input (and `parentTrackedEntityId` output when passed, as today).
  - **`jobMaterial.quantityIssued` is NOT bumped** (behavior change — today it
    is): the requirement stays open, so the operator issues a replacement from
    stock ("just scrap the part" + pull another). Batch partial scrap uses
    `buildBatchSplitRecords` — the departing child becomes the `Scrapped`
    entity; the parent keeps its id (spec `2026-08-04`).
- **Make to Order** (a subassembly made inside this job — never in inventory):
  - No stock ledger row (correct today, kept — its cost is already in WIP).
  - Entity `status='Scrapped'` + `Scrap` activity (today: `Consumed` +
    attribute).
  - GL: Dr `scrapAccount` / Cr WIP at the subassembly's accumulated
    consumed-material cost (same valuation rule as §1.4 — it *is* a unit being
    made, one level down).
  - **Replacement flow** when `makeReplacement` (modal checkbox, default ON —
    "made 3, scrapped 1 → make 1 more"): apply §1.6's reopen/top-up to the
    subassembly's `jobMakeMethod` (reopen its Done ops; bump
    `operationQuantity` + material estimates only for scrap beyond the planned
    allowance — `targetQuantity` untouched) and spawn the replacement
    `Reserved` serial entity (serial) — batch lots need only the reopen. The
    subassembly's ops won't re-flip Done until the replacement's good quantity
    reaches their target (§1.6 predicate). Record a
    `rework` row (`triggeredAtJobOperationId` = the operation the scrap came
    from, `targetJobOperationId` = the subassembly's first operation,
    `reason` = scrap reason name) so the existing rework surfaces show it.

### 3. ERP: scrap / unscrap available stock

Extends `post-inventory-adjustment` + `shared/post-adjustment.ts` (no new
edge function):

- Payload `adjustmentType` gains **`'Scrap'`** and **`'Unscrap'`**;
  `scrapReasonId` required for **Scrap only** — Unscrap inherits the reason from
  the original scrap movement it reverses (falls back to any supplied reason,
  then null), so the operator never re-enters it; `unscrapOfItemLedgerId`
  optional (set by the Unscrap UI).
- **Scrap** = the existing negative-adjustment machinery with:
  `offsetAccount = accountDefault.scrapAccount` (runtime fallback to
  `inventoryAdjustmentVarianceAccount`, per the seed comment),
  `documentType='Scrap'`, `scrapReasonId` on the ledger row; tracked entity →
  `status='Scrapped'` keeping its `quantity` (the record of what was
  scrapped), `trackedActivity` `type='Scrap'`. Serial = whole entity; batch =
  partial via the split convention (departing child is `Scrapped`). Journal
  lines carry the §1.4 dimension set minus WorkCenter (no operation context);
  Employee = the adjusting user.
- **Unscrap** (Oracle Return-from-Scrap pattern) = mirrored positive movement:
  - Tracked: select a `Scrapped` entity → `status='Available'`, positive
    `itemLedger` (`documentType='Scrap'`,
    `correctionOfItemLedgerId` = the original scrap row, same bin), cost layer
    + journal (Dr inventory / Cr `scrapAccount`) **at the original scrapped
    cost** read from the linked scrap movement's `costLedger` — not current
    cost (Fusion precedent; avoids P&L leakage on round-trips).
  - Untracked: positive adjustment with `scrapAccount` offset at current cost
    (v1 — no original-movement linkage to reverse against).
- **UI** (copy the adjustment-drawer precedent,
  `x+/inventory+/quantities+/$itemId.adjustment.tsx`):
  - The adjustment form's type select gains **Scrap** (shows required
    `ScrapReason` + notes).
  - The item's tracking view gains a **Scrapped** filter listing `Scrapped`
    entities with an **Unscrap** row action (optional comment + confirm; the
    reason is inherited from the original scrap movement, not re-entered).
  - Detail overlays follow the Drawer convention. All new strings through
    Lingui. Permission: `inventory_update` (same as adjustments today);
    MES scrap routes stay `production_update`-gated.

### 4. Ripple updates

- Status-aware readers: add `'Scrapped'` to every exclusion that lists
  `'Rejected'` (`get_inventory_quantities`, availability/picking RPCs,
  `TrackedEntityPicker` filters). Grep for `'Rejected'` in migrations + app
  code; redefine touched SQL functions by forking the **newest** body
  (grep-all-migrations lesson).
- `complete_job_to_inventory` is untouched: it keys on `quantityComplete`
  (good units only) and its serial loop reads `Reserved` entities — a
  `Scrapped` entity never reaches Assembly Output. Verify the serial-selection
  predicate excludes `Scrapped` explicitly.
- MES `getNextIncompleteSerialEntity` / `isSerialEntityIncompleteForOperation`
  treat `Scrapped` like `Consumed` (skip).
- App-side mirrors of the Done predicate: `InspectionView.tsx:385` computes
  `opRemaining = target − complete − scrapped − reworked` — drop the
  `quantityScrapped` term to match the new predicate; sweep every
  `quantityScrapped` usage in remaining/progress/Done math across MES + ERP
  (display-only usages like the JobDag badge and step-record navigation
  `operationQuantity + quantityScrapped` stay).
- Docs: `docs/` production + inventory pages; `.claude/rules/`
  traceability-model + inventory-system + mes-job-operation-ui updates; ERP
  `ProductionQuantityForm` (the ERP mirror of the MES modal) keeps working —
  it writes `productionQuantity` only and is out of scope for entity effects.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Multi-tenancy (heuristic 1) | No new tables. Every write carries `companyId` + audit fields; edge-function payloads require `userId` (zod) | House convention; null-audit-column lesson |
| 2 | Service shape (heuristic 2) | Posting logic in `issue` cases + `shared/post-adjustment.ts`; ERP/MES services stay thin `{data,error}` wrappers | Matches `post-*` family + adjustment-spec precedent |
| 3 | RLS (heuristic 3) | N/A — no new tables; new column/enum values inherit existing policies | — |
| 4 | Permissions (heuristic 4) | MES scrap: `production_update` (existing routes); ERP scrap/unscrap: `inventory_update` | Scrapping stock is an inventory action; shop-floor scrap is production |
| 5 | Forms (heuristic 5) | Extend `QuantityModal` scrap branch, entity-scrap modal, ERP adjustment form — `ValidatedForm` + zod validators, `scrapReasonId` required on every scrap | Fulcrum one-tap UX; reason mandatory is universal consensus |
| 6 | WIP scrap valuation | Materials-only at report time (Dr scrap / Cr WIP for consumed-material cost from genealogy); labor/overhead stay in WIP → `close-job` variance. Full cost-through-operation (SyteLine) deferred | Deterministic and implementable now; Carbon already has close-variance machinery; avoids per-unit labor attribution |
| 7 | Terminal status | New `Scrapped` status, not `Consumed`/`Rejected` reuse | Scrapped ≠ consumed-into-parent; unscrap must find them; Epicor SCRAPPED / SAP ME precedent |
| 8 | Replacement is explicit, effects are in-txn | Serial-being-made: spawn always (the user's ask; beats all competitors). MTO subassembly: `makeReplacement` checkbox default ON. Capacity writes only when scrap exceeds the planned allowance (`operationQuantity` + `job.scrapQuantity` top-up) | Universal "no auto-inflation" consensus, adapted — the operator action IS the explicit trigger |
| 9 | Reopen ops vs clone ops | Reopen Done ops on the same routing; `targetQuantity` never mutated; `operationQuantity` topped up only beyond the planned allowance | `trigger-rework`'s cloned path is for re-work of existing units; a replacement is new work on the same method |
| 10 | Stock-component scrap accounting | Dr `scrapAccount` / Cr inventory (not through WIP); `quantityIssued` not bumped | "Just scrap the part" + pull another; scrap loss is cost-of-quality, not product cost; SAP reverse-and-scrap pattern collapsed to one movement |
| 11 | Unscrap cost | Original scrapped cost via `correctionOfItemLedgerId` linkage (tracked); current cost (untracked v1) | Fusion Return-from-Scrap; NetSuite's current-cost reversal is a documented audit weakness |
| 12 | Scrap offset account | ONE flat `accountDefault.scrapAccount` (by id), both directions; analysis via `journalLineDimension` tags (ScrapReason / WorkCenter / Employee / Item / ItemPostingGroup / Location) — per-reason account mapping **rejected**, not deferred (Brad, 2026-08-07) | Account exists (`20260726012013`); no-matrix-config rule; dimensions give Fusion-grade reporting without account proliferation |
| 13 | Ledger identity | `documentType='Scrap'` + `itemLedger.scrapReasonId`; entry types stay `Positive/Negative Adjmt.` (no new `itemLedgerType`) | Additive; keeps every on-hand/valuation reader working unchanged |
| 14 | Backward compat (heuristic 7) | Additive enums/column; TWO deliberate behavior changes: (a) `scrapTrackedEntity` stops bumping `quantityIssued` and posts to scrap instead of WIP; (b) the auto-Done predicate drops `quantityScrapped` (Brad, 2026-08-07) — in-flight ops that would have auto-Done via scrap now stay open until good qty reaches target (manual Finish still available) | `targetQuantity` is already defined as the good quantity — counting scrap against it was shorting jobs even within planned scrap |
| 15 | Module layout (heuristic 6) | Additions live in existing `inventory.service.ts` / `production.service.ts` / MES services; no new modules | One service/models file per module |

## Data Model Changes

No new tables. One migration (`pnpm db:migrate:new scrap-unscrap-flow`,
HHMMSS randomized, idempotent, enum ADD VALUE outside dependent statements):

```sql
ALTER TYPE "trackedEntityStatus" ADD VALUE IF NOT EXISTS 'Scrapped';
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Scrap';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Scrap';
ALTER TYPE "dimensionEntityType" ADD VALUE IF NOT EXISTS 'ScrapReason';

ALTER TABLE "itemLedger" ADD COLUMN IF NOT EXISTS "scrapReasonId" TEXT;
ALTER TABLE "itemLedger" DROP CONSTRAINT IF EXISTS "itemLedger_scrapReasonId_fkey";
ALTER TABLE "itemLedger" ADD CONSTRAINT "itemLedger_scrapReasonId_fkey"
  FOREIGN KEY ("scrapReasonId") REFERENCES "scrapReason"("id") ON DELETE SET NULL;
```

Follow-up statements (same migration, forked from **newest** bodies): (a)
redefine `sync_update_job_operation_quantities` (newest: `20260706181125`)
with the Done predicate
`("quantityComplete" + "quantityReworked") >= "targetQuantity"` — scrap
removed (Brad, 2026-08-07); (b) add `'Scrapped'` to the `'Rejected'`
exclusions in `get_inventory_quantities`, `get_available_tracked_entities`,
`get_picking_list_tracked_available` (list every migration touching each
function first — sibling-branch lesson). Then
`pnpm run generate:types` before typechecking. `config.toml` unchanged (no new
functions).

## API / Service Changes

- `issue` edge function: new case `jobOperationSerialScrap`; reworked case
  `scrapTrackedEntity` (reason required, `makeReplacement`, methodType
  branches per §2); shared capacity-bump helper used by both.
- `post-inventory-adjustment`: `adjustmentType` `'Scrap'`/`'Unscrap'`,
  `scrapReasonId`, `unscrapOfItemLedgerId`; `bookAdjustment` gains
  `scrapReasonId` passthrough + fixed-cost override for unscrap reversal. The
  Unscrap branch reads `scrapReasonId` off the resolved original scrap movement
  and books the ledger row, `trackedActivity`, and ScrapReason journal
  dimension with that inherited value.
- MES `x+/scrap.tsx`: routes serial-tracked parents to
  `jobOperationSerialScrap`; batch/untracked path adds the WIP→scrap GL leg.
- Entity-scrap route action: validator gains `scrapReasonId` (required) +
  `makeReplacement`.
- ERP `inventory.service.ts`: wrapper params for scrap/unscrap;
  `getTrackedEntities` filter for `Scrapped`.
- No Inngest changes. Reschedule via the existing schedule invoke.

## UI Changes

- MES `QuantityModal` (shared by both views): scrap branch shows the selected
  serial `readableId` when serial-tracked; reason already required.
- MES entity-scrap modal (Materials section, both views): adds `ScrapReason`
  (required), notes, and the `makeReplacement` checkbox (MTO only, default ON).
- ERP adjustment drawer: `Scrap` type option with reason; tracking view gains
  `Scrapped` filter + `Unscrap` row action (Drawer overlay convention,
  `size="md"`; MES additions `size="lg"`). All strings through Lingui.

## Acceptance Criteria

- [ ] **Serial WIP scrap + spawn.** Serial job qty 3 (no planned scrap): scrap
  the in-progress serial at op 2 with reason → entity `Scrapped`,
  `productionQuantity` Scrap row, a `Scrap` activity with the entity as input,
  op 1 (Done) reopens to Ready, `targetQuantity` stays 3 on every op,
  `operationQuantity` 3→4 and `job.scrapQuantity` 0→1 (scrap exceeded the
  zero planned allowance), a new `Reserved` serial exists and the view
  navigates to it; no op flips Done until its good quantity reaches 3; job
  completion receives exactly 3 to inventory.
- [ ] **Planned-scrap allowance.** Job qty 10 with 20% planned scrap
  (`targetQuantity` 10, `operationQuantity` 12): completing 8 good + scrapping
  2 does NOT auto-Done the op (today it does); no capacity writes occur
  (within allowance); the op flips Done when good quantity reaches 10.
- [ ] **Serial WIP scrap GL + dimensions.** With accounting enabled and $40 of
  materials backflushed into the scrapped unit across ops: one balanced
  journal Dr scrapAccount $40 / Cr WIP $40, `documentType='Scrap'`; with
  Item, ScrapReason, WorkCenter, and Employee dimensions active on the
  company group, every line carries `journalLineDimension` tags for the
  item, the chosen scrap reason, the operation's work center, and the
  operator; with accounting disabled: identical ledger writes, zero journals.
- [ ] **Assembly view parity.** The same scrap (serial + entity scrap) driven
  from `/x/assembly/:id` produces byte-identical DB effects to the operation
  view.
- [ ] **Stock component scrap.** Scrap a picked (Available) batch entity qty 2
  of 5 from lineside: split per the identity-flip (parent keeps id, qty 5→3;
  child qty 2 `Scrapped`), `itemLedger` −2 `Negative Adjmt.`/`Scrap` with
  `scrapReasonId` at the lineside bin, layers consumed via `calculateCOGS`,
  Dr scrapAccount / Cr inventory at that cost, `quantityIssued` unchanged, and
  the material's issue requirement still shows the outstanding quantity.
- [ ] **MTO subassembly scrap + replacement.** Subassembly make method built 3
  serials, scrap 1 with Make Replacement ON: entity `Scrapped`, Dr scrap / Cr
  WIP at its consumed-material cost, no stock ledger row, subassembly Done ops
  reopened (`targetQuantity` unchanged; `operationQuantity` topped up only
  past the allowance), replacement `Reserved` serial spawned, a `rework` row
  recorded; with Make Replacement OFF only the scrap effects occur.
- [ ] **ERP scrap.** Scrap an Available serial entity from the quantities page
  with reason: status `Scrapped`, `itemLedger` −1 `documentType='Scrap'` +
  `scrapReasonId`, Dr scrapAccount / Cr inventory at COGS cost; entity
  disappears from on-hand, availability, and picker RPCs but appears under the
  Scrapped filter.
- [ ] **ERP unscrap at original cost.** Item cost moves $10→$12 after
  scrapping at $10: Unscrap restores the entity to `Available` at its original
  bin, positive ledger linked via `correctionOfItemLedgerId`, Dr inventory /
  Cr scrapAccount at **$10**, and a subsequent shipment consumes the restored
  layer at $10.
- [ ] **Untracked scrap/unscrap.** Untracked item: Scrap −5 with reason posts
  the scrapAccount pair; Unscrap +5 posts the mirror at current cost.
- [ ] **Batch WIP scrap.** Batch parent op `targetQuantity` 10 (no planned
  scrap): scrap 2 pre-completion → Scrap productionQuantity row, WIP→scrap GL
  for 2 units' material cost, `operationQuantity` 10→12, target stays 10, the
  op stays open until 10 good complete, lot completes with good quantity only.
- [ ] **No regressions**: a plain Negative Adjmt. still offsets to
  `inventoryAdjustmentVarianceAccount` with NULL documentType (byte-identical);
  `complete_job_to_inventory` output rows never reference `Scrapped` entities;
  picking/return sweeps ignore `Scrapped` entities.
- [ ] `pnpm run generate:types` then
  `pnpm exec turbo run typecheck --filter=erp --filter=mes` green; migration
  re-runs safely; edge-function own-file `deno check` error delta = 0.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Predicate change strands in-flight ops (good < target after scrap already counted) or fights reopened ops (premature re-flip when good already ≥ target) | High | Operator Finish still force-Dones any op; predicate only fires on productionQuantity changes (no retroactive flips); acceptance criteria pin the reopen→re-flip flow; test the last-op case (job already Completed → serial scrap blocked, entity is then stock — use ERP scrap) |
| Pre-`20260120` ops were backfilled `targetQuantity = operationQuantity` (includes planned scrap allowance) — with scrap excluded they auto-Done only at good = target-with-allowance | Med | Acceptable strictness (manual Finish covers); optional backfill for open ops (`targetQuantity = operationQuantity − plannedScrapShare`) evaluated at plan time |
| Genealogy-derived material cost is incomplete (untracked components consumed without entity linkage) | Med | Fall back to current-op backflush cost + `jobMaterial` unit estimates for prior ops; state valuation basis in the journal description; labor already excluded by decision 6 |
| Behavior change on `scrapTrackedEntity` (no `quantityIssued` bump, scrap-not-WIP posting) surprises existing users | Med | Flagged as decision 10/14 for Brad's veto; release note; the old absorb-into-job semantics remain available by issuing normally |
| `Scrapped` exclusion missed in one status-aware reader → phantom on-hand | Med | Single grep sweep for `'Rejected'` across migrations + app; fork newest function bodies; tie-out panel verifies subledger↔GL after scrap |
| Unscrap original-cost reversal when the layer was partially consumed since | Low | Reversal creates a NEW layer at original unit cost (no resurrection of the old layer); `correctionOfItemLedgerId` keeps the audit chain |
| Enum ADD VALUE + same-migration usage (Postgres restriction) | Low | ADD VALUE statements first, function redefinitions second; migration validated in a rolled-back psql txn |

## Open Questions

> All resolved autonomously (no human available mid-loop). Each is a veto
> point — review before implementation. **Ask-First flag:** items 1–2 touch
> production-critical table schemas (additive-only); per root AGENTS.md this
> spec does NOT authorize implementation until Brad approves it.

- [x] New terminal status vs reuse `Consumed`/`Rejected`? — **Autonomous:**
  add `'Scrapped'` (decision 7). Reuse would make unscrap and scrap analysis
  impossible to query and conflates distinct physical states.
- [x] Ledger identity: new `itemLedgerType` vs documentType? — **Autonomous:**
  keep `Positive/Negative Adjmt.` entry types; add `'Scrap'` documentType +
  `itemLedger.scrapReasonId` (decision 13). New entry types would ripple
  through every valuation/on-hand reader for zero information gain.
- [x] WIP scrap valuation basis? — **Autonomous:** consumed-material cost
  only, labor to close variance (decision 6). SyteLine-style full
  cost-through-operation deferred until per-unit labor attribution exists.
- [x] Does stock-component scrap absorb into the job (today's behavior) or
  post to scrap? — **Autonomous:** post to scrap, don't bump `quantityIssued`
  (decision 10) — matches the user's "just scrap the part" framing; flagged
  as the one deliberate behavior change.
- [x] Replacement mechanics: reopen + bump vs clone ops vs new job? —
  **Autonomous:** bump quantities + reopen on the same routing (decision 9);
  `trigger-rework` cloning is for reprocessing existing units, a replacement
  is new units of planned work.
- [x] Unscrap cost basis? — **Autonomous:** original scrapped cost for
  tracked, current cost for untracked v1 (decision 11, Fusion precedent).
- [x] Auto-Done predicate: exclude scrap instead of bumping targets? —
  **Answer (Brad, 2026-08-07): exclude `quantityScrapped` from the
  predicate.** Overrides the initial autonomous resolution. Cross-checked
  against the schema: `targetQuantity` is documented as the good quantity
  before scrap (`20260119120000`) and `operationQuantity` carries the planned
  allowance, so the old predicate was shorting jobs even within planned
  scrap. `targetQuantity` is never mutated by scrap; in-flight-op impact
  covered in Risks; `quantityReworked` stays in the predicate (out of scope).
- [x] Per-reason GL account mapping (Fusion/Epicor)? — **Answer (Brad,
  2026-08-07): rejected permanently — ONE `scrapAccount`, with scrap reason
  as a journal dimension instead.** Add `dimensionEntityType` value
  `'ScrapReason'`; scrap journal lines tag ScrapReason, WorkCenter, and
  Employee alongside the existing Item / ItemPostingGroup / Location, for
  whichever dimensions the company group has active. `valueId` is
  polymorphic by design (no FK), so `scrapReason.id` slots in cleanly.

## Changelog

- 2026-08-07: Subcomponent scrap reworked to be **state-based** (Brad) — the
  original `scrapTrackedEntity` branched on `methodType` and rejected
  `Consumed` entities, but the only UI entry (the Unconsume tab) lists consumed
  subcomponents, so it never worked. Now: entity **state** drives the posting
  (`Available` → scrap from stock; `Consumed` → relieve WIP + decrement
  `jobMaterial.quantityIssued` to reopen the requirement); `methodType` only
  gates the MTO make-replacement flow. UI: a dedicated **Scrap tab** in
  `IssueMaterialModal` (`ScrapTab`) lists Available + Consumed entities for the
  material, replacing the (broken) per-row Scrap button in the Unconsume tab.
  Two judgment calls: state (not methodType) drives accounting; consumed-scrap
  decrements `quantityIssued`.
- 2026-08-07: Implemented on `mes-scrap-serial-rework-flow` — see
  `.ai/plans/2026-08-07-scrap-unscrap-flow.md`. Notable deviations from the
  plan: (1) the status-aware RPCs needed no `Scrapped` exclusion — scrap posts
  negative ledger movements and availability RPCs already filter
  `status='Available'`; (2) the serial/batch/untracked scrap consolidated into
  ONE `issue` case `jobOperationScrap`; (3) the entity-scrap route had **no UI
  caller** before this — added `ScrapEntityModal` + a Scrap action in the
  IssueMaterialModal unconsume tab; (4) `rework.trackedEntityId` no longer
  exists so it was omitted from the rework insert; (5) ERP Unscrap resolves
  location/bin/cost server-side from the scrap movement (a Scrapped
  tracked-entity row carries no location), so `locationId` is optional for
  Unscrap. Browser verification pending (Task 14).

- 2026-08-07: Auto-Done predicate now excludes `quantityScrapped` (Brad) —
  `targetQuantity` is already the good-quantity target, so ops stay open
  until good units are made; replaced the target-bump design with reopen +
  `operationQuantity` top-up beyond the planned allowance. Ripple: app-side
  predicate mirrors (`InspectionView.opRemaining`) swept; new planned-scrap
  acceptance criterion; in-flight-op risk rows added.
- 2026-08-07: Single scrap account + dimensions (Brad) — per-reason account
  mapping rejected permanently; scrap journal lines carry ScrapReason (new
  `dimensionEntityType`), WorkCenter, and Employee dimensions alongside
  Item / ItemPostingGroup / Location.
- 2026-08-06: Created (autonomous mode). Grounded in: competitor research
  (`.ai/research/scrap-unscrap-flow.md`, 4-track survey), code exploration of
  the scrap/completion/adjustment/rework machinery (`issue` cases
  `jobOperationSerialComplete:1173`/`scrapTrackedEntity:1682`,
  `sync_update_job_operation_quantities` auto-Done predicate
  `20260706181125:91`, `bookAdjustment` offset-account support,
  `accountDefault.scrapAccount` seed `20260726012013`, `trigger-rework`
  quantity pattern, batch-split identity flip). All Open Questions carry
  **Autonomous:** resolutions pending Brad's review; implementation gated on
  spec approval.
