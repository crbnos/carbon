# MES Assembly View — scan-to-complete gate

**File:** `apps/mes/app/components/AssemblyView.tsx`

## Problem

- The standalone "Scan Part" button pre-selects `firstTrackedMaterial`, which uses
  a **job-wide** `remainingToIssue` (`estimatedQuantity − quantityIssued`). A serial
  parent reports `quantityIssued` **per unit**, so the remaining never reaches 0 and
  the button re-opens the **same part** every click instead of walking to the next.
- A step can be completed (Mark done / Record) without its parts ever being issued.
- The "Issue" framing + duplicate scan affordances are confusing.

## Decisions (confirmed with user)

1. **Only tracked (serial/batch) parts assigned to the step gate completion.**
   Non-tracked parts do not gate — loose parts are added to the first step and
   backflushed when that step is recorded.
2. **Soft gate:** keep the Skip button always enabled; **disable** the primary
   Mark done / Record button while the step's tracked parts are unissued, with a hint.

## Changes

1. **`getIssuedForUnit(material, { unitIndex, issuedIsPerUnit, issuedOverride })`** —
   module-level helper returning `{ required, issued, fullyIssued }`. Replaces the
   inline math in `MaterialRow` so the row and the gate share one source of truth.
2. **`visibleMaterialsWithState`** — hoist the per-material `stepNumbers` / `isLoose`
   / `issuedIsPerUnit` / `issuedOverride` / issue-state computation out of the Parts
   JSX. Derive `pendingScanMaterials` = entries that are tracked **and** not
   `fullyIssued` for the current unit; `hasPendingScans` gates the step.
   Remove `rawMaterials`, `isTrackedMat`, `remainingToIssue`, `firstTrackedMaterial`.
3. **Remove the standalone "Scan Part" section** and the now-unused `LuQrCode` import.
   Scanning is per-part via the existing (clear) `MaterialRow` cards.
4. **Soft-gate the action row:** show a "Scan N part(s)…" hint above the buttons when
   `hasPendingScans`; pass `disabled={hasPendingScans}` to `StepCompleteAction`, which
   disables Mark done / Record. Skip stays enabled.

## Verification

- `pnpm exec turbo run typecheck --filter=@carbon/mes` (or the app's package name).
- Manual: a step with two serialized parts — primary action disabled + hint until
  both scanned; each card scans its own part; Skip always works; non-tracked/loose
  parts never block.
