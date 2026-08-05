---
paths:
  - "apps/erp/app/modules/production/ui/CutLists/**"
  - "apps/erp/app/routes/x+/cut-list+/**"
  - "apps/erp/app/routes/x+/production+/cut-lists*"
  - "apps/erp/app/routes/x+/production+/cutting-runs.tsx"
  - "packages/database/supabase/functions/lib/cutting/**"
  - "packages/database/supabase/functions/optimize-cuts/**"
  - "packages/database/supabase/functions/issue/cut-list-confirm.ts"
---

# Cut List System

A cut list tells a saw/laser operator which pieces to cut, at what dimensions,
from which stock. It is the bridge between demand in **pieces** and supply in
**stock units**: a job needs 40 pieces of 1" 4140 at 5.7"; inventory holds 20 ft
bars and a rack of drops.

Design spec: `.ai/specs/2026-08-04-cut-lists.md`.
Research (~60 primary sources): `.ai/research/2026-08-04-cut-lists.md`.

## Data model

| Table | Purpose |
|---|---|
| `cutList` | The stateful document. Saw parameters (`kerf`, `endTrim`, `gripMargin`, `minRemnantLength`, `unitOfDimension`) live on the header, seeded from the process defaults but editable per run. `status` enum `cutListStatus`. `plannedYieldPct` / `actualYieldPct`. Readable id `CL000001` from the `cutList` sequence. |
| `cutListLine` | Demand: N pieces of one `pieceLength` (+ `pieceWidth` for 2D). Carries `jobId` + `jobMaterialId` — the **demand pedigree** that lets one run serve many jobs and still settle cost and traceability per job. |
| `cutPattern` | One stock unit's cut sequence, produced by the optimizer. `pattern` JSONB is `[{ cutListLineId, pieceLength }]` in cut order. **Rewritten wholesale** on every optimize run — never hold a long-lived reference to a pattern id. |
| `itemStockDimension` | 1:1 with a material size-item: `stockLength` / `stockWidth` / `stockThickness` + `unitOfDimension`. Without a row here an item contributes **no stock** to the optimizer (it can't know whether a piece fits). |
| `cutLists` (view) | List read: joins location/process/work center names and aggregates line counts. |

Columns added to existing tables:

- `methodMaterial` / `quoteMaterial` / `jobMaterial`: `cutLength`, `cutWidth`,
  `grainLocked`. **`cutLength` is the length of ONE piece** — quantity stays the
  piece count. 4 pieces of 5.7" is `quantity 4` + `cutLength 5.7`, never 22.8
  smeared into quantity (which loses the piece count the saw needs).
- `process`: `isCuttingProcess` + `defaultKerf` / `defaultEndTrim` /
  `defaultGripMargin` / `defaultMinRemnantLength`. The flag is on the **process,
  not the part** — a bracket is cut on the saw and formed on the brake.
- `materialForm`: `dimensionality` (`1D` bar/tube vs `2D` sheet/plate), seeded
  for the system shapes. Drives which cut fields show and which optimizer runs.
- `itemLedgerDocumentType`: `Cut List Consumption`.

Permissions: cut list tables use `production_*`; `itemStockDimension` uses
`parts_*` (matching `material`). No new permission family — see `.ai/lessons.md`
"Features live inside existing permission modules".

## Lifecycle

```
Draft ──release──▶ Released ──start──▶ In Progress ──confirm──▶ Completed
  │                   │                     (posts inventory + cost)
  └──cancel──▶ Cancelled ◀──cancel──────────┘
```

Transitions are gated **server-side** in `x+/cut-list+/$id.status.tsx`
(`ALLOWED_TRANSITIONS`); anything else is rejected with a flash. `Completed` is
reachable **only** through the confirmation route, which also posts inventory —
the status route can't shortcut it. Lines and saw parameters are editable in
Draft only (`isCutListEditable`).

## The 1D optimizer

`packages/database/supabase/functions/lib/cutting/ffd.ts` — pure, deterministic,
zero imports (so `deno test` type-checks it cleanly). Best-fit-decreasing:

- **Kerf model:** n pieces from one stock unit consume **(n − 1) kerfs** — the
  blade passes *between* pieces. Matches `piecesPerStock()`, which quoting uses:
  `floor((usable + kerf) / (piece + kerf))`. A 240" bar, 5.7" pieces, 0.06" kerf
  → **41** pieces, not 42.
- Usable length = `length − endTrim − gripMargin`.
- **Remnants sort before full stock**, shortest first — drops get used before a
  new bar is broken.
- Leftover ≥ `minRemnantLength` is a planned remnant; below it, waste.
- Unplaceable pieces are **reported** (`unplaced` with `no-stock-long-enough` vs
  `stock-exhausted`), never silently dropped.

`optimize-cuts/index.ts` wraps it: Draft-only, expands lots into individual
physical stock units (a lot of 3 bars is 3 things you can cut from; a remnant
carries its own `Length` attribute), deletes + reinserts every `cutPattern`, and
stamps `plannedYieldPct`.

## Confirmation (the `cutListComplete` case in `issue`)

Posting logic is a pure helper — `issue/cut-list-confirm.ts`
(`buildCutListPostingPlan`), unit-tested in `cut-list-confirm.test.ts`. The
edge-function case does the I/O. What it gets right:

1. **Cost splits by nested length.** A job that took 40" of the bar carries twice
   the cost of one that took 20". The last allocation absorbs rounding so the
   shares always sum to exactly what was consumed — no stranded fractional cost
   (the documented failure mode of naive job batching).
2. **Remnants keep their heat.** A drop becomes a new `trackedEntity` with
   `attributes` `{ Remnant: true, Length, Unit, "Heat Number" }` inherited from
   the parent, plus a `Split` `trackedActivity` and a `Positive Adjmt.` ledger
   row. Partial lot draws reuse `buildBatchSplitRecords` (`shared/batch-split.ts`)
   — do **not** re-implement splitting.
3. **Bins come from net on-hand** via `resolveTrackedEntityBin`, never the first
   ledger row (a picked lot has rows in two bins).
4. **Below-minimum drops post as scrap**, not inventory.
5. Partial confirmations leave the run `In Progress`; it completes only when
   every line is fully cut.

Yield counts only material actually used up: a returned drop is still stock, so
200" of parts from a 240" bar with a 40" returned drop is **100%**, not 83%.

## Surfaces

| Route | Purpose |
|---|---|
| `x+/production+/cut-lists.tsx` (+ `.new`) | List + create modal |
| `x+/production+/cutting-runs.tsx` | Cross-job planning board: open cut demand grouped by material, select → create + auto-optimize |
| `x+/cut-list+/$id.tsx` | Full-screen detail: header, actions, lines, pattern diagram |
| `x+/cut-list+/$id.{status,optimize,complete}.tsx` | Action-only routes |
| `x+/cut-list+/$id.lines.*` | Line CRUD |
| `file+/cut-list+/$id[.]pdf.tsx` | Operator sheet (permission-free like the traveler, explicit `companyId` check) |

## Gotchas

- **`cutPattern` is disposable.** Re-optimizing deletes every row for the list.
- **Remnant tracking needs batch tracking.** An untracked material can carry cut
  lengths and a printed list, but a drop has no lot to descend from — the
  complete modal says so inline.
- **`get_method_tree` has an explicit `RETURNS TABLE`.** Cut fields flow BOM→job
  only because `20260805155314_method-tree-cut-fields.sql` names them. Any new
  material-line column needs the same treatment, plus the three explicit copy
  sites in `get-method/index.ts`.
- **An item with no `itemStockDimension` contributes no stock.** The optimizer
  reports these in `itemsMissingStockDimensions` rather than guessing a length.
- Embeds on `cutListLine`/`cutPattern` → `cutList` must use the **target table
  name**, not `alias:fkColumn(...)` — those are composite FKs (PGRST200).
