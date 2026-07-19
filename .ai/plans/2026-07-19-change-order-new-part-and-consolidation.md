# Change Orders — Replacement Part rename + net-new New Part + consolidation — implementation plan

**Spec:** .ai/specs/2026-07-19-change-order-new-part-and-consolidation.md
**Research:** .ai/research/2026-07-19-co-part-consolidation.md
**Branch:** feat/change-orders-top-to-bottom (current — continue here)

## Progress
- [x] Task 1: Enum migration (rename `New Part`→`Replacement Part`, add net-new `New Part`) + regenerate types
- [x] Task 2: Models — change-type array + new-part add validator
- [x] Task 3: Service — Replacement Part branch rename + net-new New Part draft branch + add-affected-item mint path + switch guard
- [x] Task 4: Release — supersession gating + New-Part-before-assembly ordering
- [x] Task 5: UI — labels, badge, change-type picker, attribute/cutover gating

> Deviation: Tasks 1, 2, 5 committed together as one commit. The enum rename ripples
> into `ChangeTypeBadge`'s exhaustive `Record<ChangeOrderChangeType,…>`, so the tree
> can only be green once the array (T2) and the badge (T5) both include the new value —
> the per-task green boundary is 1+2+5, not each alone.
- [x] Task 6: UI — Add Affected Item modal: change-type Select drives existing-part picker vs create-new-part form
- [ ] Task 7: UI — assembly BOM picker includes CO New Part drafts + removed-line where-used
- [x] Task 8: Tests + seed — consolidation diff coverage, seed relabel
- [ ] Task 9: Browser verification (end-to-end) via /test
- [ ] Task 10: Docs — items AGENTS.md CO section

## Dependencies
- Task 1 blocks all (regenerated `changeOrderChangeType` type).
- Task 2 needs Task 1. Tasks 3, 5 need Task 2. Task 4 needs Task 2. Task 6 needs Tasks 2+3. Task 7 needs Tasks 3+5. Task 8 needs Task 3. Task 9 needs all. Task 10 last.
- Tasks 5 and 4 are independent of each other (different files) — may run in parallel after Task 2. Tasks 3 and 5 touch different files and may run in parallel after Task 2.

---

## Task 1: Enum migration + regenerate types

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{generated}_co-replacement-part-change-type.sql`
- Precedent (enum defined here): `packages/database/supabase/migrations/20260716101500_change-orders.sql` (line 81, `CREATE TYPE "changeOrderChangeType"`)

**Steps:**
1. `pnpm db:migrate:new co-replacement-part-change-type` (never hand-pick the timestamp).
2. Write this **idempotent** SQL into the new file (retry-safe: the DO-block guard only renames when `New Part` still exists and `Replacement Part` does not; `ADD VALUE IF NOT EXISTS` re-adds the net-new label):
   ```sql
   -- Rename the 1:1-supersession type; existing changeOrderAffectedItem rows carry
   -- over (they all already write affected→new supersession). Then re-introduce
   -- 'New Part' as the net-new (no-predecessor) type.
   DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'changeOrderChangeType' AND e.enumlabel = 'New Part'
     ) AND NOT EXISTS (
       SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'changeOrderChangeType' AND e.enumlabel = 'Replacement Part'
     ) THEN
       ALTER TYPE "changeOrderChangeType" RENAME VALUE 'New Part' TO 'Replacement Part';
     END IF;
   END $$;

   ALTER TYPE "changeOrderChangeType" ADD VALUE IF NOT EXISTS 'New Part';
   ```
   If the migration runner rejects `ALTER TYPE ... ADD VALUE` inside a transaction (older Postgres), STOP and split into two migration files (rename first, add second) — do not improvise the value into a CHECK or TEXT column.
3. Apply: `pnpm db:migrate` (applies pending + regenerates types).

**Verify:**
```bash
grep -n 'changeOrderChangeType' packages/database/src/types.ts | grep -iE "Replacement Part|New Part" | head
# Expected: a line containing "Version" | "Revision" | "Replacement Part" | "New Part"
```
```bash
DB_URL=$(grep -E "^SUPABASE_DB_URL=" .env.local | cut -d= -f2-)
psql "$DB_URL" -tAc "SELECT string_agg(enumlabel,',' ORDER BY enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='changeOrderChangeType';"
# Expected: Version,Revision,Replacement Part,New Part
```

**Out of scope:** the `changeOrders` view (no view string-matches the enum value); any data backfill (rename handles existing rows).

---

## Task 2: Models — change-type array + new-part add validator

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/items/items.models.ts` — `changeOrderChangeTypes` array + add `changeOrderNewPartValidator`
- Precedent: existing `changeOrderChangeTypes` (~line 1038), `changeOrderAffectedItemValidator` (~line just below)

**Steps:**
1. Update `changeOrderChangeTypes` to the four DB values, in DB order:
   ```ts
   export const changeOrderChangeTypes = [
     "Version",
     "Revision",
     "Replacement Part",
     "New Part"
   ] as const;
   ```
2. Add a validator for the "create new part" add path (net-new part, no existing itemId):
   ```ts
   export const changeOrderNewPartValidator = z.object({
     changeOrderId: z.string().min(1, { message: "Change order is required" }),
     readableId: z.string().min(1, { message: "Part number is required" }),
     name: z.string().min(1, { message: "Name is required" }),
     itemType: z.enum(["Part", "Tool"], {
       errorMap: () => ({ message: "Type must be Part or Tool" })
     }),
     replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]).default("Make")
   });
   ```
3. Export both from the module barrel if not already (`index.ts` re-exports `* from "./items.models"` — verify it does; if the barrel lists names explicitly, add `changeOrderNewPartValidator`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: "1 successful" (changeOrderChangeType enum values now match the array)
```

**Out of scope:** the existing `changeOrderAffectedItemValidator` (keep it for the existing-part add path).

---

## Task 3: Service — Replacement Part rename + net-new New Part draft branch + add-mint path + switch guard

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/items.service.ts` — `createChangeOrderDraftMethod`, `addChangeOrderAffectedItem`, `updateChangeOrderAffectedItemChangeType`
- Precedent: the `Revision` branch inside `createChangeOrderDraftMethod` (~line 5579) — mints an inactive item then stamps its make method; the net-new New Part branch mirrors it minus the copy-from-source.

**Steps:**
1. In `createChangeOrderDraftMethod`, the current **New Part logic is an unguarded fall-through** after the `Version` and `Revision` `if` blocks (starts at the comment `// New Part — a new part number derived from...`, ~line 5638). Wrap that entire fall-through block in `if (changeType === "Replacement Part") { ... }` — logic unchanged (still `getItem` source, Parts/Tools guard, `getNextItemIdFromSource`, `copyItem`, stamp, draft refs).
2. Add a **new** net-new branch (net-new New Part has no source):
   ```ts
   if (changeType === "New Part") {
     // Net-new part introduced by the CO: no source, no supersession. The caller
     // (addChangeOrderAffectedItem, New Part path) has already minted the item and
     // passes its id in `itemId`; here we just wire the draft method refs.
     // Mint happens in addChangeOrderAffectedItem so the item exists before insert.
     const draftMethod = await client
       .from("makeMethod")
       .select("id, version")
       .eq("itemId", itemId)          // the minted new item
       .eq("companyId", companyId)
       .order("version", { ascending: false })
       .limit(1)
       .maybeSingle();
     // The item-insert trigger auto-creates makeMethod v1. Stamp it CO-owned so it
     // hides from version lists until release (parity with Revision).
     if (draftMethod.data?.id) {
       const stamp = await client
         .from("makeMethod")
         .update({ changeOrderId, status: "Draft" })
         .eq("id", draftMethod.data.id)
         .eq("companyId", companyId);
       if (stamp.error) return { data: null, error: stamp.error };
     }
     return {
       data: {
         draftMakeMethodId: draftMethod.data?.id ?? null,
         baseMakeMethodId: null,
         newItemId: itemId
       },
       error: null
     };
   }
   ```
   Match the exact return shape of the sibling branches (inspect the Version/Revision `return { data: {...} }` shapes and mirror the field names). If the return type differs, STOP and reconcile — do not guess field names.
3. In `addChangeOrderAffectedItem`, add an optional `newPart` input:
   ```ts
   newPart?: {
     readableId: string;
     name: string;
     itemType: "Part" | "Tool";
     replenishmentSystem: "Buy" | "Make" | "Buy and Make";
   }
   ```
   When `newPart` is present: first mint an **inactive** item (mirror `mintPlaceholderPart` at ~line 5339 but honor `newPart.itemType`/`name`/`readableId`/`replenishmentSystem`, `active: false`, `revisionStatus: "Design"`, `revision: "0"`) and its type row (`part` or `tool`). Use the minted item id as `itemId`, set `changeType = "New Part"`, then proceed through the existing insert + `createChangeOrderDraftMethod` path. Reject `newPart.itemType` not in {Part, Tool} with a clear error.
4. In `updateChangeOrderAffectedItemChangeType`, reject any transition where the current or target type is `New Part`:
   ```ts
   if (changeType === "New Part" || affected.data.changeType === "New Part") {
     return { data: null, error: { message: "New Part change type cannot be switched" } };
   }
   ```
   (Place after the affected-item is loaded, before the discard+recreate.)

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: "1 successful"
```
```bash
grep -n '"Replacement Part"\|=== "New Part"' apps/erp/app/modules/items/items.service.ts
# Expected: a Replacement Part guard AND a New Part branch present
```

**Out of scope:** `releaseAffectedItem` (Task 4); UI (Tasks 5–7).

---

## Task 4: Release — supersession gating + ordering

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/items.server.ts` — `releaseAffectedItem` (guard at line 407), `applyChangeOrder` (release ordering)

**Steps:**
1. Change the supersession guard (currently `if (changeType !== "Version" && newItemId) {`) so only Revision and Replacement Part write supersession — New Part reveals its item but writes none:
   ```ts
   if (
     (changeType === "Revision" || changeType === "Replacement Part") &&
     newItemId
   ) {
   ```
   The reveal block above it (`if (newItemId) { item.active = true, changeOrderId, ... }`) is unchanged — New Part still reveals (its `newItemId` is the minted item), it just skips supersession.
2. In `applyChangeOrder`, order the per-affected-item release so **New Part** items are released before **Version/Revision** items (so an assembly BOM line referencing the new part resolves to an active item). Sort the affected-item list by `changeType === "New Part" ? 0 : 1` before the release loop. Keep per-item idempotency (a released draft has `changeOrderId` cleared → skipped on retry) — do not remove it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: "1 successful"
```
```bash
grep -n 'changeType === "Revision" || changeType === "Replacement Part"' apps/erp/app/modules/items/items.server.ts
# Expected: the new supersession guard
```

**Out of scope:** any change to `upsertItemSupersession` / the supersession redirect map.

---

## Task 5: UI — labels, badge, change-type picker, attribute/cutover gating

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/ui/ChangeOrder/ChangeTypeBadge.tsx` — labels/colors
- Modify: `apps/erp/app/modules/items/ui/ChangeOrder/AffectedItemDetail.tsx` — `changeTypeOptions`/picker filter (line 43, 329), `showAttributes` (line 82), cutover gating (`showCutover`)
- Modify: `apps/erp/app/routes/x+/items+/change-order+/$id.tsx` — `needsAttributes` (line ~148)
- Modify: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.$affectedId.change-type.tsx` — exclude New Part option

**Steps:**
1. `ChangeTypeBadge.tsx` — update `changeTypeBadgeLabel` and the variant map for four types:
   - `New Part` → `"New"` (green) — genuinely new.
   - `Replacement Part` → `"Replacement"` (variant: reuse the old New Part green, or `blue`; pick `orange`/distinct so it reads apart from New — inspect available `BadgeProps["variant"]` values and choose an unused one; if none obvious, use `"blue"` and note it).
   - `Revision` → `"New Revision"` (blue) — unchanged.
   - `Version N` → outline — unchanged.
2. `AffectedItemDetail.tsx`:
   - `showAttributes` (line 82): include New Part → `changeType === "Revision" || changeType === "Replacement Part" || changeType === "New Part"`.
   - `showCutover`: currently `changeType !== "Version"`; change to exclude New Part too → `changeType !== "Version" && changeType !== "New Part"` (a New Part has no predecessor → no cutover/supersession card).
   - The change-type switcher `options` (line 329): exclude `New Part` from the switch picker for an existing affected item → filter it out in addition to the existing Version-for-Buy filter. A `New Part` affected item shows its type read-only (no switcher) — guard the switcher render with `affected.changeType !== "New Part"`.
3. `$id.tsx` `needsAttributes` (line ~148): include New Part → `(changeType === "Revision" || changeType === "Replacement Part" || changeType === "New Part") && item.type === "Part"`. (Tool attribute editing remains a follow-up, as today.)
4. `$id.affected.$affectedId.change-type.tsx`: ensure the action rejects a New Part target (belt-and-suspenders with Task 3's service guard) — return a `validationError`/flash if `changeType === "New Part"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: "1 successful"
```
```bash
grep -c '"Replacement Part"' apps/erp/app/modules/items/ui/ChangeOrder/AffectedItemDetail.tsx apps/erp/app/modules/items/ui/ChangeOrder/ChangeTypeBadge.tsx "apps/erp/app/routes/x+/items+/change-order+/\$id.tsx"
# Expected: each file > 0
```

**Out of scope:** the add-affected-item form (Task 6).

---

## Task 6: UI — Add Affected Item modal: change-type Select drives existing-part picker vs create-new-part form

**Depends on:** Tasks 2, 3
**Files:**
- Modify: `apps/erp/app/modules/items/ui/ChangeOrder/AffectedItemForm.tsx` — add a change-type `Select` at the top that drives the rest of the form
- Modify: `apps/erp/app/routes/x+/items+/change-order+/$id.affected.tsx` — branch on the chosen change type (new-part vs existing)
- Precedent (mini-form fields): `apps/erp/app/modules/items/ui/Parts/PartForm.tsx` — `useNextItemId("Part")` (line 166), `replenishmentSystem` select (line 285). Copy only the minimal fields (readableId, name, type Part/Tool, replenishmentSystem).
- Precedent (Select field): `~/components/Form` `Select` (already used across affected-item UI, e.g. `ChangeOrderForm.tsx` priority Select).

**Steps:**
1. `AffectedItemForm.tsx`: add a **`Select name="changeType"`** at the top of the modal, options `changeTypeOptions` (all four: Version, Revision, Replacement Part, New Part) — this is the single control that makes the form "cleaner" (per the request), replacing any separate mode toggle. Track the selected value in state (`useState`, default `"Version"`).
2. Drive the body off the selected change type:
   - `Version` / `Revision` / `Replacement Part` → render today's existing-part `<Item name="itemId" validItemTypes={["Part","Tool"]} …>` picker; the form posts `changeOrderAffectedItemValidator` fields (`changeOrderId`, `itemId`, `changeType`). (Buy items: the service already coerces a Buy `Version` → `Revision`; optionally hide `Version` from the Select once a Buy item is picked, mirroring `AffectedItemDetail.tsx` line 329 — nice-to-have, not required.)
   - `New Part` → hide the `<Item>` picker and render the new-part mini-form: a readableId field auto-populated by `useNextItemId(itemType)` and overridable, `Input name="name"`, a `Select name="itemType"` of {Part, Tool}, a `Select name="replenishmentSystem"` of {Buy, Make, Buy and Make}. The form posts `changeOrderNewPartValidator` fields plus `changeType="New Part"`.
   Keep the shared `ModalDrawer*` container already in the file. Include `<Hidden name="changeOrderId" />`.
3. `$id.affected.tsx` action: read `formData` once. If `formData.get("changeType") === "New Part"`, validate with `changeOrderNewPartValidator` and call `addChangeOrderAffectedItem(client, { changeOrderId, newPart: { readableId, name, itemType, replenishmentSystem }, changeType: "New Part", companyId, userId })` (itemId is derived from the mint inside the service). Otherwise keep the existing `changeOrderAffectedItemValidator` path — but now `changeType` comes from the Select instead of defaulting to `Version`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: "1 successful"
```
Browser check deferred to Task 9 (added: verify the change-type Select renders and switching to New Part swaps the picker for the mini-form).

**Out of scope:** a full standalone part page — the mini-form only mints the CO-governed draft. The post-add change-type switcher on the affected-item detail (Task 5) still exists for {Version, Revision, Replacement Part}.

---

## Task 7: UI — assembly BOM picker includes CO New Part drafts + removed-line where-used

**Depends on:** Tasks 3, 5
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx` — the add-material `<Item>` picker (line ~822)
- Modify: `apps/erp/app/modules/items/ui/ChangeOrder/ChangeOrderDiffViewer.tsx` (or `AffectedItemDetail.tsx`) — where-used indicator on removed material rows
- Precedent for where-used data: `getPartUsedIn` + `impactUsedIn` already loaded per affected item in the CO `$id` loader (see spec API section)

**Steps:**
1. `BillOfMaterial.tsx`: the `<Item>` picker must be able to select the current CO's **New Part** draft items (they are `active: false`). Inspect how `<Item>` filters (active-only?). If it filters to active, pass through an allow-list of the CO's New Part draft item ids (thread from the CO `$id` loader — the affected items where `changeType === "New Part"`) so those inactive drafts are selectable within a CO assembly BOM. If `<Item>` already lists inactive items, no change — verify by rendering. If threading the allow-list is non-trivial, STOP and report the picker's filter mechanism before改.
2. Removed-material rows in the diff: for each `removed` material entry on an assembly's diff, show a small muted "used in N other assemblies" indicator using the component's where-used count (exclude the current assembly). Reuse `getPartUsedIn`; if the count isn't already in the diff payload, compute it in the CO `$id` loader for removed components and pass it down. No obsolete action.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: "1 successful"
```
Visual check deferred to Task 9.

**Out of scope:** auto-obsoleting removed parts; any global mass-replace.

---

## Task 8: Tests + seed relabel

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/items/items.service.test.ts` — add a consolidation diff test
- Modify: `packages/database/src/seed-change-orders.ts` (line 670) — relabel mapping

**Steps:**
1. Add a `diffMethod` test: given a base method with 3 materials [P1,P2,P3] and a draft method with 1 material [P_new], assert the diff classifies 3 `removed` + 1 `added` and 0 `modified`. Follow the existing test structure in the file (14 tests already there).
2. `seed-change-orders.ts:670`: the mapping `changeType === "NewPart" ? "New Part" : changeType` — decide intent: seed data that meant *replacement* must now emit `"Replacement Part"`; if the seed also wants to exercise the net-new type, add a `"NewPart"` seed case that emits `"New Part"` with no source. At minimum, keep it type-valid against the new enum. If the seed's intent is ambiguous, keep existing rows emitting `"Replacement Part"` (they had supersession).

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/items/items.service.test.ts 2>&1 | tail -6
# Expected: all tests passed (15+), including the new consolidation case
```

**Out of scope:** rewriting unrelated seed data.

---

## Task 9: Browser verification (end-to-end) via /test

**Depends on:** Tasks 1–8
**Files:** none (verification only)

**Steps:** Invoke `/test`. Boot/confirm the dev stack, `/auth`, then drive:
1. Open an existing CO whose affected item was `New Part` → confirm it now reads **Replacement Part** and its cutover card still shows.
2. Create a CO → "Add affected item" → **New part** mode → auto number, name, type Part, replenishment Make → Add. Confirm a **New Part** explorer row appears; open it → attributes + empty BOM/BOP editors, **no** cutover card.
3. Add an existing manufactured assembly as **Version**; in its draft BOM remove ≥2 lines and add a line referencing the New Part draft. Confirm the Changes diff shows the removals + the addition, and each removed line shows a "used in N other" indicator.
4. Release the CO. Confirm: the New Part is now an active part with no `itemSupersession`; the assembly's active method has the new BOM; the removed parts are untouched (still active, still in any other assemblies).

Capture screenshots to `.ai/scratch/e2e/`.

**Verify:** Each of the 4 steps observed in the browser; note any failure and STOP.

**Out of scope:** load testing; non-change-order screens.

---

## Task 10: Docs — items AGENTS.md CO section

**Depends on:** Tasks 1–9 green
**Files:**
- Modify: `apps/erp/app/modules/items/AGENTS.md` — CO change-type section + data-model table

**Steps:** Update the "Change type (capability matrix)" bullet and the `changeOrder` data-model rows to the four-type taxonomy (Version / Revision / Replacement Part / New Part), stating that Replacement Part + Revision write supersession while New Part does not, and that N→1 consolidation is a parent-assembly BOM change (no supersession). Update any `New Part` mention that means *replacement* to `Replacement Part`.

**Verify:**
```bash
grep -n "Replacement Part\|New Part" apps/erp/app/modules/items/AGENTS.md | head
# Expected: the four-type taxonomy described; no stale "New Part = supersession" claim
```

**Out of scope:** the root AGENTS.md Task Router (no new guide file).
