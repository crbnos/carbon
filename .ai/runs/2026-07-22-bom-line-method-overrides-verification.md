# Per-BoM-line Replenishment / Method Type / Sourcing overrides — change summary & verification guide

**Branch:** `feat/overriding-properties`
**Plan:** `.ai/plans/2026-07-21-bom-line-method-overrides.md`
**Status:** Tasks 1–7 implemented & statically verified (typecheck + unit test + lint + docs). Task 8 (browser) still to run.

---

## 1. What we changed (and why)

A Master Part carries three item-level defaults: **Replenishment System** (`Buy` / `Make` / `Buy and Make`), **Method Type** (`Purchase to Order` / `Pull from Inventory` / `Make to Order`), and **Sourcing Type** (`Specified` / `Drop Ship` / `Ship from Inventory`). Previously every BoM component line was a **read-only mirror** of its component item for these fields. Now each is **editable per BoM line**, defaulting to (inherited from) the item but overridable — and an override is **sticky** (a later change to the item default won't stomp a line the user deliberately edited).

Three mechanisms make it more than "let the field be edited":
1. **Override flags** — a new boolean per field records that the user edited it.
2. **Interlock** — editing one field auto-pins another (reused item-level `deriveItemMethodUpdate`).
3. **Guarded cascade + re-derive** — the item→line propagation and the upsert re-derive both skip a field once its flag is set.

**Explicitly unchanged:** the MRP engine and `get_method_tree`. The effective columns stay `NOT NULL` and downstream reads them as before. Per-line replenishment/sourcing only reach jobs/quotes **through** the interlocked `methodType` (see Edge Cases §4).

### File-by-file

| Task | File | Change |
|---|---|---|
| 1 | `packages/database/supabase/migrations/20260721164847_method-material-line-overrides.sql` | Adds `replenishmentSystem "itemReplenishmentSystem" NOT NULL DEFAULT 'Buy'` + `replenishmentSystemOverridden` / `methodTypeOverridden` / `sourcingTypeOverridden` `BOOLEAN NOT NULL DEFAULT false` to `methodMaterial`. Backfills `replenishmentSystem` from the component `item` (all existing flags stay `false`). |
| 2 | `packages/database/src/types.ts` (+ `swagger-docs-schema.ts`, `functions/lib/types.ts`) | Regenerated so the four new columns are typed. |
| 3 | `apps/erp/app/modules/items/items.models.ts` | `methodMaterialValidator` gains `replenishmentSystem` (enum) + the three `*Overridden` (`zfd.checkbox()`). |
| 3 | `apps/erp/app/modules/items/deriveItemMethodUpdate.test.ts` | New unit test locking the interlock (5 cases). |
| 4 | `apps/erp/app/modules/items/items.service.ts` → `upsertMethodMaterial` | Re-derives `methodType`/`sourcingType`/`replenishmentSystem` from the item **only when the matching flag is false**; overridden fields keep the submitted value. Item select now includes `replenishmentSystem`. |
| 5 | `apps/erp/app/modules/items/items.service.ts` → `cascadeSourcingAndMethodTypeToMethodMaterials` (+ caller `updateItemMethodAndSourcing`) | The single cascade UPDATE became **three field-targeted UPDATEs**, each guarded by `<field>Overridden = false`, still limited to `Draft` make methods. New `replenishmentSystem` cascade threaded from `args.itemUpdate.replenishmentSystem`. |
| 6 | `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx` | The three controls are now editable (`SelectControlled` for replenishment/sourcing, `DefaultMethodType` for method type). Editing sets the field's flag + applies the interlock; each overridden field shows a **"Reset to item default"** link. The Sourcing card is always shown (was gated on `Buy and Make`). Flags submit as hidden inputs valued `"on"` when set. |
| 7 | `.claude/rules/method-material-sourcing.md`, `apps/erp/app/modules/items/AGENTS.md` | Rewrote the "read-only mirror" guidance to describe per-line overrides + flags + guarded cascade. |

### Two deviations from the plan text (both corrections)
- **Test import** — plan's static `import` trips the untransformed Lingui `msg` macro in `@carbon/glossary`. Used the sibling `items.service.test.ts` idiom (mock glossary + dynamic import). Assertions identical.
- **Flag submission value** — plan said submit `"true"`; `zfd.checkbox()` here uses `trueValue = "on"`, so `"true"` would **fail** the union parse and reject the save. We submit `"on"`. This is load-bearing for the whole feature.

---

## 2. Static verification (no running app)

Run from repo root.

```bash
# Migration present with the four columns
ls packages/database/supabase/migrations/ | grep method-material-line-overrides
grep -c "ADD COLUMN IF NOT EXISTS" packages/database/supabase/migrations/*_method-material-line-overrides.sql   # -> 4

# Types regenerated (Row/Insert/Update shapes)
grep -n "replenishmentSystemOverridden\|methodTypeOverridden\|sourcingTypeOverridden" packages/database/src/types.ts | head

# Interlock unit test (from apps/erp)
cd apps/erp && pnpm exec vitest run app/modules/items/deriveItemMethodUpdate.test.ts   # -> 5 passed
cd -

# Typecheck + lint the touched module
pnpm exec turbo run typecheck --filter=erp                     # -> 1 successful
pnpm exec biome check apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx \
  apps/erp/app/modules/items/items.service.ts \
  apps/erp/app/modules/items/items.models.ts \
  apps/erp/app/modules/items/deriveItemMethodUpdate.test.ts    # -> No fixes applied

# Docs mention the flags
grep -c "Overridden" .claude/rules/method-material-sourcing.md apps/erp/app/modules/items/AGENTS.md
```

### DB-level sanity (optional, against the local dev DB)
```sql
-- Columns exist with correct types/defaults
SELECT column_name, data_type, udt_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'methodMaterial'
  AND column_name IN ('replenishmentSystem','replenishmentSystemOverridden',
                      'methodTypeOverridden','sourcingTypeOverridden');

-- Backfill worked: existing rows mirror their item, all flags false
SELECT COUNT(*) AS mismatched
FROM "methodMaterial" mm
JOIN "item" i ON i.id = mm."itemId" AND i."companyId" = mm."companyId"
WHERE mm."replenishmentSystem" IS DISTINCT FROM i."replenishmentSystem";   -- expect 0
SELECT COUNT(*) FILTER (WHERE "replenishmentSystemOverridden"
   OR "methodTypeOverridden" OR "sourcingTypeOverridden") AS any_flag_set
FROM "methodMaterial";                                                     -- expect 0 right after migration
```

---

## 3. Manual / browser verification (Task 8)

Needs the running stack (`crbn up`) and login (`/auth`). Open a **Part with a Make (or Buy and Make) make method** that has BoM component lines.

1. **Edit + interlock** — On a component line, set **Sourcing** = `Ship from Inventory`; confirm **Method Type** auto-flips to `Pull from Inventory`. On another line, change **Replenishment** and confirm Method Type pins accordingly (`Make` → `Make to Order`, `Buy` → `Purchase to Order`). Save.
2. **Persistence** — Reload the BoM; the overridden line shows the override, not the item default. A **"Reset to item default"** link appears under each overridden field.
3. **Sticky cascade (the core proof)** — Change the **component item's** default (Method Type / Sourcing / Replenishment) in its Properties sidebar. The **overridden** line keeps its value; a **non-overridden sibling** line updates to the new default. Only **Draft** methods change.
4. **Reset** — Click "Reset to item default" on the overridden line; it returns to inheriting, and a *subsequent* item-default change flows through again.
5. **New line** — Add a new component line and pick an item; it inherits the item's three values with all flags off (no stale override carried over).

**DB spot-check while doing the above:**
```sql
SELECT "itemId","replenishmentSystem","methodType","sourcingType",
       "replenishmentSystemOverridden","methodTypeOverridden","sourcingTypeOverridden"
FROM "methodMaterial" WHERE "makeMethodId" = '<the draft makeMethodId>' ORDER BY "order";
```
After step 1 the edited line's flag(s) should be `true` and the value should match what you picked. After step 3 the overridden line is unchanged; the sibling changed.

---

## 4. Edge cases to probe

1. **`"on"` vs `"true"` flag encoding (regression-critical).** If a flag ever reaches the server as `"true"`, `zfd.checkbox()` (trueValue `"on"`) rejects the whole submission — the save fails validation, not silently. Verify a save with an override actually persists (step 1 above). If saves start failing after any form refactor, check the hidden-input value first.

2. **`sanitize` and boolean `false`.** The update path is `sanitize({ ...methodMaterial })`. `sanitize` only turns `undefined`→`null`, so `false` round-trips. Confirm: set a flag true, save, then reset it (flag omitted → validator yields `false`), save — the column must go back to `false`, not stick at `true`.

3. **"Specified" sourcing has no downstream effect on jobs/quotes.** The interlock leaves `methodType` unset for `Specified`. Because `jobMaterial`/`quoteMaterial` have **no** `sourcingType`/`replenishmentSystem` columns, only `methodType` is copied at job/quote creation (`get-method` edge fn). So a line overridden to Sourcing=`Specified` (with no methodType change) persists the flag but changes **nothing** at explosion time. This is by design per the plan, but confirm it matches the customer's expectation — a standalone sourcing override is informational at the BoM level.

4. **Per-line replenishment realized only via `methodType`.** Same root cause as §3: overriding a line's Replenishment matters downstream only through the `methodType` it pins. Overriding a line to `Make` → `Make to Order` should make `get-method` spawn a sub-job for that line; `Buy`/`Pull` should not. Verify by creating a job from the method and checking the resulting `jobMaterial.methodType` and whether a sub-assembly job was created. (No MRP change was made — behavior flows through the copied `jobMaterial`.)

5. **`Make to Order` override resolves `materialMakeMethodId`.** Both `upsertMethodMaterial` and the `methodType` cascade set `materialMakeMethodId` from `activeMakeMethods` for a Make-to-Order line, else `null`. Override a line to Make to Order whose component **has** an active make method (should link) and one that **has none** (should be `null`, not error).

6. **Active/Archived methods are frozen.** The cascade only touches `Draft` make methods. Editing an item default must **not** change materials on Active/Archived versions. Verify with an item used on both a Draft and an Active method.

7. **Cascade only hits non-overridden lines.** If step 3 shows an overridden line getting stomped, the `<field>Overridden = false` guard in the cascade is wrong — do not "fix" by widening scope; the guard is the feature.

8. **New/temporary lines.** `initialMethodMaterial` and the pending-material path now carry the four new fields. Adding a line and saving before it's persisted (temporary state) should still submit a valid `replenishmentSystem` (defaults `Buy`) and flags off — no validation error.

9. **Backfill vs. new default.** New `methodMaterial` rows default `replenishmentSystem` to `'Buy'` at the DB level, but `upsertMethodMaterial` overwrites it from the item when not overridden — so a freshly inserted line reflects the item, not a literal `'Buy'`. Confirm a new line on a `Make` item shows `Make`, not `Buy`.

10. **Interlock edits mark *two* flags.** Changing Sourcing to `Ship from Inventory` sets `sourcingTypeOverridden` **and** (because it pins method type) `methodTypeOverridden`. Confirm both flags are true after such an edit, and that "Reset" on one doesn't silently un-override the other.

---

## 5. Not yet done / follow-ups

- **Task 8 browser run** — execute §3 against `crbn up`.
- **Full test pass** — `pnpm test` (repo-wide, turbo-cached) before PR.
- **`/self-review`** on the branch diff.
- **Open design question (from research, unresolved):** whether a standalone `sourcingType`/`replenishmentSystem` override should have *any* downstream effect beyond the interlocked `methodType` (§3/§4). If yes, that's a larger change (new `jobMaterial`/`quoteMaterial` columns + `get-method`/MRP work) and out of this plan's scope.
