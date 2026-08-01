# Plan: Picking Lists Honor Item Supersession (#1210)

- **Date:** 2026-07-30
- **Branch:** `fix/picking-supersession-1210` → PR base `main`
- **Issue:** https://github.com/crbnos/carbon/issues/1210

## Problem

Picking ignores `itemSupersession` entirely:
1. **Superseded predecessors surface for picking** — `get_picking_schedule` counts
   `Stock Only` (spares-only) and `No Stock` (obsolete) materials as production pick demand.
2. **Successors are never considered** — when a job material references a superseded item that
   is out of stock, generation/availability never redirect to the effective successor
   (`successorItemId`, effectivity date, conversion factor), so jobs show false shortages.

## Grounded current state

- `itemSupersession(itemId PK, companyId, supersessionMode, successorItemId, discontinuationDate,
  successorEffectivityDate, conversionFactor DEFAULT 1)`. `minimumReserveQuantity` lives on
  `itemPlanning` (per item+location). Modes: `Consume First`, `Prefer New`, `Stock Only`, `No Stock`.
- Precedent — `get_purchasing_planning`/`get_production_planning` (`20260618171234`) exclude
  `No Stock` + past-discontinuation phase-out items and floor `Stock Only` to the reserve.
- Precedent — shared `buildSupersessionRedirectMap` (`functions/lib/supersession-pick.ts`) used by
  MRP + job creation; **only** `Consume First`/`Prefer New` redirect there (Stock Only is
  reserve-governed for *planning*). Picking differs — see D2.
- `get_picking_schedule` (`20260720160557`): per-**operation** aggregate; the `picks` CTE reads
  `jobMaterial` where `quantityToIssue > 0`. The material `itemId` is used only in the staged-lineside
  check (not surfaced). Output `itemId` is the make-method's parent assembly.
- `generatePickingList` (`inventory.service.ts` ~L3151): copies `jobMaterial.itemId` verbatim onto
  each `pickingListLine`. **The substitution injection point.**
- `get_picking_list_availability` (`20260614183507`): per line, warehouse on-hand of `pll.itemId`.
- `pickingListLine.jobMaterialId` FK already links back to the source material → a substitution is
  derivable as `line.itemId != jobMaterial.itemId`. **No new column needed.**

## Design decisions

- **D1 — No schema/type changes.** RPCs keep their exact `RETURNS TABLE` (filter rows only);
  substitution reuses existing columns and `itemSupersession` is already in the generated types, so
  no generated type is expected to change. Even so, per repo convention **run `pnpm run generate:types`
  after any migration change, before typechecking** (regenerate in CI or an approved DB environment
  when local Postgres is unavailable) rather than relying on the committed generated types.
- **D2 — Picking-specific redirect semantics** (differs from MRP's map):
  | Mode | Pick behavior |
  |------|---------------|
  | `Consume First` | Pick predecessor; **only** when predecessor has zero warehouse on-hand AND an effective successor with stock exists → substitute the line to the successor. (Conservative: never leaves predecessor stock unused, satisfies "predecessor out of stock → pick successor".) |
  | `Prefer New` | Effective successor → pick successor; else predecessor (fallback until effective). |
  | `Stock Only` | Effective successor → pick successor (no production use of the reserved predecessor); else **skip** (nothing valid to pick). |
  | `No Stock` | **Skip** (obsolete, no successor). |
  - "Effective successor" = `successorItemId` set AND (`successorEffectivityDate` IS NULL OR `<= today`).
  - Conversion: successor `quantityToPick = quantityToIssue * conversionFactor`.
- **D3 — No line splitting.** One `pickingListLine` per `jobMaterial` preserved (downstream
  consumption assumes it). Consume First substitutes the *whole* line only when the predecessor is
  fully out — avoids a 2-line split whose FK/consumption impact can't be verified without a DB.
- **D4 — Discontinuation date does NOT suppress picks.** Planning suppresses *new orders* past
  discontinuation; picking *fulfills existing job demand*. A job that already needs the part must
  still be pickable. Only supersession *mode* + successor effectivity gate picking.
  - **Effective-date rule (one basis for both layers).** Successor effectivity is evaluated against
    the **UTC calendar date** everywhere: the SQL uses `(now() AT TIME ZONE 'UTC')::date` and
    `generatePickingList` uses `today("UTC")`. This removes any DB-session / server-process timezone
    skew, so generation and the schedule/availability RPCs always resolve the same effective successor
    (no boundary case where availability checks the predecessor while generation writes the successor).
- **D5 — Availability RPC** reports the line's OWN pick item warehouse on-hand. Because generation
  already redirects a substituted line's `itemId` to the effective successor (D2/D3), `availableQuantity`
  reflects exactly what the line consumes — no successor fold-in. Folding a successor's stock into a
  line still targeting the predecessor is deliberately avoided: with no line-splitting (D3) that line
  consumes the predecessor, so a fold-in would mask a real predecessor shortage and could double-count
  a successor that also has its own line on the list. Shape unchanged.
- **D6 — UI marker** (polish): `getPickingListLines` also selects `jobMaterial(itemId)`; the line
  table shows a "↩ from &lt;predecessor&gt;" marker when `line.itemId != jobMaterial.itemId`.

## Tasks

1. **Migration** `packages/database/supabase/migrations/{ts}_picking-supersession.sql`:
   - `CREATE OR REPLACE FUNCTION get_picking_schedule(...)` — same signature/return; in the `picks`
     CTE add a LEFT JOIN LATERAL resolving each material's `pickItemId` (D2, single-hop), exclude
     rows where `pickItemId IS NULL`, and key the staged-lineside check on `pickItemId`.
   - `CREATE OR REPLACE FUNCTION get_picking_list_availability(...)` — same signature/return; the
     line's own pick-item warehouse on-hand, no successor fold-in (D5).
   - Verify: no precision on `NUMERIC`; `SECURITY INVOKER`; identical `RETURNS TABLE`.
2. **`generatePickingList`** (`inventory.service.ts`): fetch `itemSupersession` for the materials'
   items; a pure `resolvePickTarget(...)` helper (D2) chooses `{ itemId, factor }` or skip; compute
   on-hand/source for the resolved item; write `itemId` = resolved, `quantityToPick` = converted.
3. **`getPickingListLines`**: add `jobMaterial(itemId)` to the select (D6).
4. **UI** `PickingListLines.tsx`: render the substituted-from marker (D6).
5. **Test** (`inventory` vitest): unit-test `resolvePickTarget` across all four modes + effectivity +
   conversion + out-of-stock branch (red→green).
6. **Verify:** `pnpm run generate:types` (after the migration, before typecheck — run in CI/an approved
   DB env if local Postgres is unavailable); `pnpm exec turbo run typecheck --filter=erp
   --filter=@carbon/database`; `pnpm run lint`; the new unit test. (No local DB → RPC bodies verified by
   SQL review, not applied.)

## Out of scope / risks

- Multi-hop supersession chains in SQL are single-hop only (matches planning-function style); the TS
  resolver can collapse if needed but MRP/job-creation already redirect at creation, so a chained
  predecessor reaching picking is an edge case.
- No browser/DB verification here (env has no Postgres). Migration correctness is by review; the PR is
  `agent:needs-verification` for a human to apply + smoke-test.
</content>
</invoke>
