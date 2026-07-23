# Per-BoM-line Replenishment / Method Type / Sourcing overrides — implementation plan

**Spec:** none — explicit user description (Slack thread: Pedal4/Sync4 BoM, "Buy&Make and Specify"). Summary below.
**Research:** two read-only code traces in-session (data model + MRP/`get_method_tree` consumption). Key findings are inlined per task.
**Branch:** `feat/bom-line-method-overrides`

## Background / decisions (read before starting)

Customer ask: a Master Part carries **default** Replenishment, Method Type, and Sourcing, but each of these is **overridable per BoM line**, with a default inherited from the part.

Resolved design decisions (do not re-litigate):

1. **In scope:** per-line `replenishmentSystem`, `methodType`, `sourcingType`.
   **Out of scope:** per-line `itemTrackingType` (Inventory/Non-Inventory) — it stays item-level; the "Specified line doesn't count as stock" need is already satisfied because a purchased (`Buy`) parent assembly is never exploded by MRP (`packages/database/supabase/functions/lib/mrp-engine.ts:170` — `effRepSys !== "Make"` skips explosion).
2. **Overrides are sticky.** A line the user edited must NOT be re-stomped when the part's default later changes. Tracked with three per-field boolean flags on `methodMaterial`; the item→line cascade skips a field on rows whose flag is set.
3. **Per-line Replenishment takes effect via the existing interlock**, not via an MRP-engine change. `methodType` is interlocked with `replenishmentSystem` (`deriveItemMethodUpdate` in `apps/erp/app/modules/items/items.models.ts:71-146`: Make↔Make to Order, Buy↔Purchase to Order, Buy and Make↔Pull from Inventory). `methodMaterial.methodType` is already consumed by `get_method_tree` (migration `20260408000000_method-tree-replenishment.sql`) and the MRP engine. So editing a line's replenishment pins that line's `methodType`, and the effective `methodType` carries the behavior. **The MRP engine and `get_method_tree` are NOT modified by this plan.** If, during UI work, you find the customer needs per-line replenishment to change MRP behavior BEYOND what the interlocked `methodType` already does, STOP and report — that is a separate, larger change.
4. **The effective columns stay `NOT NULL` and populated** (`methodType`, `sourcingType`, and the new `replenishmentSystem`). Downstream consumers keep reading them unchanged. The override flags only gate the cascade and the `upsertMethodMaterial` re-derive.

Reference rule (currently describes the OLD read-only behavior — Task 7 updates it): `.claude/rules/method-material-sourcing.md`. Module guide: `apps/erp/app/modules/items/AGENTS.md` (its "Never edit `methodMaterial.sourcingType`/`methodType` per-row" line is exactly what this plan reverses — Task 7 updates it).

## Progress
- [x] Task 1: Migration — add per-line `replenishmentSystem` + 3 override flag columns to `methodMaterial`
- [x] Task 2: Regenerate DB types
- [x] Task 3: Extend `methodMaterialValidator` (models) + unit test the interlock helper
- [x] Task 4: `upsertMethodMaterial` — honor per-field override flags instead of always re-deriving
- [x] Task 5: Cascade — skip overridden fields + cascade the new `replenishmentSystem`
- [x] Task 6: BoM line editor UI — make the three selects editable with inherit/override + reset
- [x] Task 7: Docs sync — update the rule + module AGENTS.md
- [ ] Task 8: Browser verification via `/test`

## Dependencies
- Task 2 needs Task 1 (types regenerate from the new columns).
- Tasks 3, 4, 5 need Task 2 (typed columns).
- Task 4 and Task 5 are independent of each other (different functions) — may run in parallel.
- Task 6 needs Tasks 3–5 (validator + server behavior).
- Task 7 is independent of 4–6 (docs) but must reflect the final behavior — do it after 6.
- Task 8 needs Tasks 1–6.

---

## Task 1: Migration — add per-line `replenishmentSystem` + 3 override flag columns to `methodMaterial`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{generated}_method-material-line-overrides.sql`
- Precedent (column-add migration on `methodMaterial`): `packages/database/supabase/migrations/20260321230229_sourcing-types.sql`

**Steps:**
1. Create the migration file with the CLI (never hand-pick a timestamp):
   ```bash
   pnpm db:migrate:new method-material-line-overrides
   ```
2. Fill it with this exact SQL. `methodMaterial` already has `companyId`, composite behavior, audit columns, and RLS from `20240619095417_methods.sql` — this only adds columns, so no new PK/RLS/audit is required. All statements are idempotent.
   ```sql
   -- Per-line overrides of the item-level replenishment/method/sourcing defaults.
   -- The effective columns (methodType, sourcingType, replenishmentSystem) stay
   -- NOT NULL and are what downstream consumers (get_method_tree, MRP) read. The
   -- *Overridden flags gate the item->line cascade so a deliberate per-line edit
   -- is not re-stomped when the item default later changes.

   ALTER TABLE "methodMaterial"
     ADD COLUMN IF NOT EXISTS "replenishmentSystem" "itemReplenishmentSystem"
       NOT NULL DEFAULT 'Buy';

   ALTER TABLE "methodMaterial"
     ADD COLUMN IF NOT EXISTS "replenishmentSystemOverridden" BOOLEAN
       NOT NULL DEFAULT false;

   ALTER TABLE "methodMaterial"
     ADD COLUMN IF NOT EXISTS "methodTypeOverridden" BOOLEAN
       NOT NULL DEFAULT false;

   ALTER TABLE "methodMaterial"
     ADD COLUMN IF NOT EXISTS "sourcingTypeOverridden" BOOLEAN
       NOT NULL DEFAULT false;

   -- Backfill replenishmentSystem from the component item. Existing rows are all
   -- read-only mirrors of the item today, so every flag stays false (no prior
   -- overrides exist), which is correct.
   UPDATE "methodMaterial" mm
   SET "replenishmentSystem" = i."replenishmentSystem"
   FROM "item" i
   WHERE i."id" = mm."itemId"
     AND i."companyId" = mm."companyId"
     AND mm."replenishmentSystem" IS DISTINCT FROM i."replenishmentSystem";
   ```
3. Do NOT apply the migration yourself against a shared/prod DB. Local apply happens via the normal dev flow. If `pnpm db:migrate:new` is unavailable or errors, STOP and report — do not hand-create the file with a guessed timestamp.

**Verify:**
```bash
ls packages/database/supabase/migrations/ | grep method-material-line-overrides
# Expected: exactly one file, named {timestamp}_method-material-line-overrides.sql, timestamp newer than 20260707022142
grep -c "ADD COLUMN IF NOT EXISTS" packages/database/supabase/migrations/*_method-material-line-overrides.sql
# Expected: 4
```

**Out of scope:** No changes to `item`, `makeMethod`, `get_method_tree`, or any MRP function. No `itemTrackingType` column. No new enum (`itemReplenishmentSystem` already exists).

---

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify (generated — do not hand-edit): `packages/database/src/types.ts`

**Steps:**
1. Regenerate types so the four new `methodMaterial` columns are typed:
   ```bash
   pnpm run generate:types
   ```
   This requires the local Supabase DB running with all migrations applied (including Task 1's). If it fails because the migration isn't applied locally, apply pending migrations first per the normal dev flow, then re-run. If the DB is not available, STOP and report — do not hand-edit `types.ts`.

**Verify:**
```bash
grep -n "replenishmentSystemOverridden\|methodTypeOverridden\|sourcingTypeOverridden" packages/database/src/types.ts | head
# Expected: at least 3 matches (Row/Insert/Update shapes of methodMaterial)
```

**Out of scope:** Never hand-edit generated types; if the columns are missing, the migration didn't apply — fix that, don't patch the types file.

---

## Task 3: Extend `methodMaterialValidator` (models) + unit test the interlock helper

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/items.models.ts` — add `replenishmentSystem` + 3 override booleans to `methodMaterialValidator`
- Create: `apps/erp/app/modules/items/deriveItemMethodUpdate.test.ts` — pure unit test of the interlock (reused per-line)
- Precedent (validator shape): `methodMaterialValidator` already in the same file (~L436); enum + `zfd.checkbox` usage per `.claude/rules/conventions-forms.md`.

**Steps:**
1. In `items.models.ts`, confirm `itemReplenishmentSystems` is exported (it is, ~L58-62: `["Buy","Make","Buy and Make"]`). Import/use it for the new field.
2. Add these fields to `methodMaterialValidator` (the object starting at ~L436), alongside the existing `methodType`/`sourcingType`:
   ```typescript
   replenishmentSystem: z.enum(itemReplenishmentSystems, {
     errorMap: () => ({ message: "Replenishment system is required" })
   }),
   replenishmentSystemOverridden: zfd.checkbox(),
   methodTypeOverridden: zfd.checkbox(),
   sourcingTypeOverridden: zfd.checkbox(),
   ```
   `zfd.checkbox()` yields `false` when the field is absent — the safe default (line inherits).
3. Do NOT change `deriveItemMethodUpdate` — it is reused as-is (client + server). Add a unit test locking its interlock so the per-line UI can rely on it:
   ```typescript
   import { describe, expect, it } from "vitest";
   import { deriveItemMethodUpdate } from "./items.models";

   describe("deriveItemMethodUpdate (interlock reused per BoM line)", () => {
     it("sourcing Drop Ship pins methodType Purchase to Order", () => {
       const r = deriveItemMethodUpdate("sourcingType", "Drop Ship");
       expect(r.cascade.methodType).toBe("Purchase to Order");
       expect(r.cascade.sourcingType).toBe("Drop Ship");
     });
     it("sourcing Ship from Inventory pins methodType Pull from Inventory", () => {
       const r = deriveItemMethodUpdate("sourcingType", "Ship from Inventory");
       expect(r.cascade.methodType).toBe("Pull from Inventory");
     });
     it("sourcing Specified leaves methodType unset (unchanged)", () => {
       const r = deriveItemMethodUpdate("sourcingType", "Specified");
       expect(r.cascade.methodType).toBeUndefined();
     });
     it("replenishment Make pins methodType Make to Order", () => {
       const r = deriveItemMethodUpdate("replenishmentSystem", "Make");
       expect(r.itemUpdate.defaultMethodType).toBe("Make to Order");
     });
     it("replenishment Buy pins methodType Purchase to Order", () => {
       const r = deriveItemMethodUpdate("replenishmentSystem", "Buy");
       expect(r.itemUpdate.defaultMethodType).toBe("Purchase to Order");
     });
   });
   ```
   If any assertion fails, the interlock differs from this plan's assumption — STOP and report; do not "fix" the test to pass.

**Verify:**
```bash
pnpm --filter erp test -- deriveItemMethodUpdate
# Expected: the 5 tests above pass
pnpm exec turbo run typecheck --filter=erp
# Expected: no type errors (the validator's inferred type now includes the 4 new fields)
```

**Out of scope:** Do not touch `itemValidator`, `partValidator`, or the item-level property editors. Do not add `itemTrackingType` to the validator.

---

## Task 4: `upsertMethodMaterial` — honor per-field override flags instead of always re-deriving

**Depends on:** Task 2 (Task 3 recommended first for the validator type, but the service compiles against the DB type)
**Files:**
- Modify: `apps/erp/app/modules/items/items.service.ts` — the `upsertMethodMaterial` function (starts ~L3863)
- Precedent (same function's current re-derive block): `items.service.ts:3878-3893`

**Steps:**
1. Replace the unconditional re-derive block (currently ~L3878-3893, the comment "sourcingType and methodType are item-level properties…" through the two assignments) with per-field logic: re-derive a field from the item ONLY when its override flag is false; when true, keep the submitted value and also persist the `replenishmentSystem`. Exact replacement:
   ```typescript
   // Per-line overrides: methodType / sourcingType / replenishmentSystem each
   // inherit from the component item UNLESS the caller marked that field
   // overridden (the BoM editor sets the *Overridden flags when the user edits a
   // line). Effective columns stay populated so downstream consumers
   // (get_method_tree, MRP) read a concrete value either way.
   if (methodMaterial.itemId) {
     const item = await client
       .from("item")
       .select("defaultMethodType, sourcingType, replenishmentSystem")
       .eq("id", methodMaterial.itemId)
       .single();

     if (item.error) return item;

     if (!methodMaterial.methodTypeOverridden) {
       methodMaterial.methodType =
         item.data.defaultMethodType ?? methodMaterial.methodType;
     }
     if (!methodMaterial.sourcingTypeOverridden) {
       methodMaterial.sourcingType = item.data.sourcingType;
     }
     if (!methodMaterial.replenishmentSystemOverridden) {
       methodMaterial.replenishmentSystem = item.data.replenishmentSystem;
     }
   }
   ```
2. Leave the `materialMakeMethodId` resolution below it unchanged — it already keys off the (now possibly overridden) `methodMaterial.methodType === "Make to Order"`, which is exactly right: an overridden Make-to-Order line resolves its child active make method.
3. The insert/update payloads spread `...methodMaterial`, so the new columns flow through automatically — no change to the `.insert`/`.update` calls needed. Confirm `sanitize(...)` on the update path does not strip the boolean `false` flags (it strips `undefined`/empty; `false` is preserved). If `sanitize` drops `false`, STOP and report — the flags must round-trip.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no type errors in items.service.ts (item select now includes replenishmentSystem; methodMaterial has the flag + replenishmentSystem fields)
```

**Out of scope:** Do not change the storage-unit seeding block, the `materialMakeMethodId` block, or any other `upsert*` function.

---

## Task 5: Cascade — skip overridden fields + cascade the new `replenishmentSystem`

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/items.service.ts` — `cascadeSourcingAndMethodTypeToMethodMaterials` (starts ~L2992) and its caller `updateItemMethodAndSourcing` (~L2947)
- Precedent (the current single-UPDATE cascade): `items.service.ts:3031-3060`

**Steps:**
1. The current cascade does ONE `UPDATE` that may set `sourcingType` and (conditionally) `methodType`/`materialMakeMethodId` on every Draft-method row for the item. Per-field override flags differ per row, so split it into up to three targeted updates, each guarded by its own `*Overridden = false` predicate. Keep the existing `onDraftMakeMethod` predicate. Replace the body after the `onDraftMakeMethod` definition (currently ~L3021 `const baseSet` through the `.execute()` at ~L3060) with:
   ```typescript
   // sourcingType cascade — skip lines the user overrode.
   if (args.newSourcingType) {
     await trx
       .updateTable("methodMaterial")
       .set({ sourcingType: args.newSourcingType, updatedBy: args.userId, updatedAt })
       .where("itemId", "in", args.itemIds)
       .where("companyId", "=", args.companyId)
       .where("sourcingTypeOverridden", "=", false)
       .where(onDraftMakeMethod)
       .execute();
   }

   // methodType cascade — skip overridden lines; re-resolve materialMakeMethodId
   // for Make to Order (mirrors upsertMethodMaterial), null otherwise.
   if (args.newMethodType) {
     await trx
       .updateTable("methodMaterial")
       .set((eb) => ({
         updatedBy: args.userId,
         updatedAt,
         ...(args.newMethodType === "Make to Order"
           ? {
               methodType: "Make to Order" as const,
               materialMakeMethodId: eb
                 .selectFrom("activeMakeMethods")
                 .select("id")
                 .whereRef("activeMakeMethods.itemId", "=", "methodMaterial.itemId")
                 .where("activeMakeMethods.companyId", "=", args.companyId)
                 .limit(1)
             }
           : { methodType: args.newMethodType, materialMakeMethodId: null })
       }))
       .where("itemId", "in", args.itemIds)
       .where("companyId", "=", args.companyId)
       .where("methodTypeOverridden", "=", false)
       .where(onDraftMakeMethod)
       .execute();
   }

   // replenishmentSystem cascade — new; skip overridden lines.
   if (args.newReplenishmentSystem) {
     await trx
       .updateTable("methodMaterial")
       .set({
         replenishmentSystem: args.newReplenishmentSystem,
         updatedBy: args.userId,
         updatedAt
       })
       .where("itemId", "in", args.itemIds)
       .where("companyId", "=", args.companyId)
       .where("replenishmentSystemOverridden", "=", false)
       .where(onDraftMakeMethod)
       .execute();
   }
   ```
   Delete the now-unused `baseSet` variable. Keep the early return `if (!args.newSourcingType && !args.newMethodType) return;` but extend it to also allow `newReplenishmentSystem`:
   ```typescript
   if (!args.newSourcingType && !args.newMethodType && !args.newReplenishmentSystem) return;
   ```
2. Add `newReplenishmentSystem?: Database["public"]["Enums"]["itemReplenishmentSystem"];` to the `args` type of `cascadeSourcingAndMethodTypeToMethodMaterials`.
3. In `updateItemMethodAndSourcing` (~L2976 call site), pass the item's replenishment when it is part of the update so non-overridden lines mirror it:
   ```typescript
   await cascadeSourcingAndMethodTypeToMethodMaterials(trx, {
     itemIds: args.itemIds,
     companyId: args.companyId,
     userId: args.userId,
     newSourcingType: args.cascade.sourcingType,
     newMethodType: args.cascade.methodType,
     newReplenishmentSystem: args.itemUpdate.replenishmentSystem
   });
   ```
   (`args.itemUpdate.replenishmentSystem` is already on the type at ~L2954. It is set whenever replenishment changes via `deriveItemMethodUpdate`.)

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no type errors; cascade compiles with the new arg and three updates
```

**Out of scope:** Do not change `deriveItemMethodUpdate` or the route `x+/items+/update.tsx`. Do not widen the cascade beyond Draft methods (Active/Archived stay frozen).

---

## Task 6: BoM line editor UI — make the three selects editable with inherit/override + reset

**Depends on:** Tasks 3, 4, 5
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx` — the material line form (fields at ~L800-820; Sourcing block ~L896-957; Method block ~L959-1040)
- Precedent (editable `Select` with options + onChange in a Carbon form): the item-level `SourcingTypeProperty.tsx` and `DefaultMethodType` usages; interlock helper `deriveItemMethodUpdate` (`items.models.ts:71`)
- Precedent (valid method types by replenishment): `getValidMethodTypes(replenishmentSystem)` in `apps/erp/app/modules/shared/shared.models.ts:193`

**Steps:**
1. This component holds line state in `itemData` and currently renders the three controls **read-only**, mirroring the component item's values (`itemData.sourcingType`, `itemData.methodType`, `itemData.itemReplenishmentSystem`). The plan makes them editable and submits the effective value + override flags. First read the whole component to find where `itemData` is initialized and how it is submitted (the `ValidatedForm` at ~L800 with `Hidden` fields). If `itemData` does not already carry the line's own `replenishmentSystem`/override flags (they are new columns), extend the state shape and its initializer to read them from the loaded method material row (`getMethodMaterialsByMakeMethod` selects `*`, so the row includes them after Task 2). If the row source does not include these columns at runtime, STOP and report.
2. Add local override flags to the submitted form. Replace the read-only mirror `Hidden`/`Select` wiring so that:
   - The **Sourcing** `<Select>` (~L940) drops `isReadOnly`, gains an `onChange` that: sets `itemData.sourcingType`, sets `sourcingTypeOverridden = true`, and applies the interlock — call `deriveItemMethodUpdate("sourcingType", value)` and, if it returns `cascade.methodType`, also set `itemData.methodType` + `methodTypeOverridden = true`.
   - The **Method Type** control (`DefaultMethodType`, ~L1025) drops `isReadOnly`, gains an `onChange` that sets `itemData.methodType` + `methodTypeOverridden = true`. Restrict its options to `getValidMethodTypes(itemData.replenishmentSystem)`.
   - Add a **Replenishment** `<Select>` (options from `itemReplenishmentSystems`) in the same source card; `onChange` sets `itemData.replenishmentSystem` + `replenishmentSystemOverridden = true`, then applies `deriveItemMethodUpdate("replenishmentSystem", value)` to pin `itemData.methodType` (+ `methodTypeOverridden = true`) when it returns a `defaultMethodType`.
   - Submit all six values via controlled fields / `Hidden`: `replenishmentSystem`, `methodType`, `sourcingType`, and the three `*Overridden` booleans (as `"true"`/absent to match `zfd.checkbox()`).
   - Remove the `itemData.itemReplenishmentSystem !== "Buy and Make"` gate that today hides the sourcing hidden input (~L816) and the `=== "Buy and Make"` gate that hides the whole Sourcing card (~L896): sourcing is now editable regardless. If removing these gates causes a layout/logic regression you can't cleanly resolve, keep the card always-visible but preserve the disclosure toggle, and report the deviation.
3. Add a small **"Reset to item default"** affordance per overridden field (a button or link) that sets the field's value back to the item's default (available as `itemData.item?.defaultMethodType` / `sourcingType` / `replenishmentSystem` — confirm the exact path when reading the component) and sets the field's `*Overridden` flag back to `false`. If the item's default values are not present in the component's data, add them to the loader select rather than fetching client-side; if that is not feasible without a broader change, STOP and report.
4. Keep everything else (Item picker, Quantity, UoM, storage units, configure hooks) unchanged.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no type errors
pnpm run lint
# Expected: no new lint errors in BillOfMaterial.tsx
```
Browser verification is Task 8.

**Out of scope:** Do not redesign the BoM table/tree, the operations (BillOfProcess) editor, or the item-level Properties sidebar. Do not add per-line `itemTrackingType`.

---

## Task 7: Docs sync — update the rule + module AGENTS.md

**Depends on:** Task 6
**Files:**
- Modify: `.claude/rules/method-material-sourcing.md` — it currently states the fields are read-only mirrors; update to describe per-line overrides + the flags + the cascade skip
- Modify: `apps/erp/app/modules/items/AGENTS.md` — the "Never edit `methodMaterial.sourcingType`/`methodType` per-row" bullet is now false; replace with the override rule

**Steps:**
1. In `.claude/rules/method-material-sourcing.md`: update the intro and the "BOM editor display (read-only)" + "Gotchas" sections to reflect that `methodType`/`sourcingType`/`replenishmentSystem` are now **editable per line**, default-inherited from the item, and tracked by `methodTypeOverridden`/`sourcingTypeOverridden`/`replenishmentSystemOverridden`; the item→line cascade (`cascadeSourcingAndMethodTypeToMethodMaterials`) skips a field on rows whose flag is set; `upsertMethodMaterial` re-derives a field only when its flag is false. Note the effective columns stay `NOT NULL` and are still what `get_method_tree`/MRP read (no MRP change).
2. In `apps/erp/app/modules/items/AGENTS.md`: replace the `Never` bullet "Edit `methodMaterial.sourcingType`/`methodType` per-row — they're derived from the component item…" with a bullet documenting per-line overrides via the flags, and note that changing the item default cascades only to non-overridden Draft-method lines.
3. Document committed behavior only — this task runs after Task 6 is implemented and typechecks.

**Verify:**
```bash
grep -n "Overridden" .claude/rules/method-material-sourcing.md apps/erp/app/modules/items/AGENTS.md
# Expected: at least one match in each file
```

**Out of scope:** Do not rewrite unrelated sections of either file; keep edits scoped to the sourcing/method-type behavior.

---

## Task 8: Browser verification via `/test`

**Depends on:** Tasks 1–6
**Files:** none (verification only)

**Steps:** Use the `/test` skill against the running dev stack. Test plan:
1. Open a Part with a **Make** (or Buy and Make) make method that has BoM component lines (e.g. a manufactured assembly).
2. On a component line, change **Sourcing** to `Ship from Inventory` and confirm **Method Type** auto-updates to `Pull from Inventory` (interlock), and change another line's **Replenishment** and confirm Method Type pins accordingly. Save.
3. Reload the BoM; confirm the overridden values persist (the line shows the override, not the item default).
4. Change the **component item's** default (Method Type/Sourcing/Replenishment) in its Properties sidebar; confirm the **overridden** line keeps its value while a **non-overridden** sibling line updates to the new default (sticky cascade). Only Draft methods should change.
5. Use **Reset to item default** on the overridden line; confirm it returns to inheriting and a later item-default change again flows through.

**Verify:** `/test` reports all five steps pass with no console/app errors. If step 4 shows an overridden line being stomped, the cascade guard (Task 5) is wrong — report before "fixing" by widening scope.

**Out of scope:** Non-BoM screens; MRP run verification (per-line replenishment behavior is realized via the interlocked `methodType`, already covered by existing MRP paths — a full MRP re-verification is not required for this change).
