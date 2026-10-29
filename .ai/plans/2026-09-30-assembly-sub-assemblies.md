# Assembly sub-assemblies — implementation plan

**Spec / source:** `.ai/specs/2026-09-30-assembly-sub-assemblies.md`
**Research:** `.ai/research/2026-09-30-assembly-sub-assemblies-code.md` (line refs used below)
**Branch:** `feat/sub-assemblies` (worktree `/Users/aashu/work/carbon/carbon-feat-sub-assemblies`)
**Prototype (look + flow):** `/Users/aashu/work/carbon/plans/sub-assemblies/prototype.html`

Rules for the executor: run everything from the worktree root; `pnpm` only; never commit
(the user commits); every user-facing string through Lingui (`useLingui().t` / `<Trans>`);
follow `.claude/skills/carbon-design/SKILL.md` for every UI task.

## Progress
- [x] Task 1: Install deps and boot the local stack
- [x] Task 2: Migration — `usedInStepId` + convert build-aside data
- [x] Task 3: Apply migration and regenerate DB types
- [x] Task 4: Viewer — pure `subassembly.ts` model + tests; step type change
- [x] Task 5: Viewer — player: remove staging, add isolation, carry-in, scope, pill
- [x] Task 6: ERP — validators and service functions
- [x] Task 7: ERP — routes and path helpers (and remove the join route)
- [x] Task 8: Job sync and job creation skip header rows
- [x] Task 9: ERP — Explorer: grouped list, dnd-kit, menus, open sub-assembly
- [x] Task 10: ERP — Properties + `$id.tsx` wiring
- [x] Task 11: ERP — rename component-list "Subassembly" → "Component Group"
- [x] Task 12: MES — playback columns + step bar with open/back
- [ ] Task 13: Docs, glossary, AGENTS.md, MCP digest, superseded spec
- [ ] Task 14: Translations
- [ ] Task 15: Verification (typecheck, tests, lint, browser walk-through of all acceptance criteria)

## Dependencies
Task 2 → 3 → (4, 6). 4 → 5. 6 → 7 → (9, 10). 3 → 8. 5 + 7 → 9, 10. 11 independent after 1.
12 needs 3 + 5. 13 after 7. 14 after 9–12. 15 last.
Check-in points with the user (per their preference): after Task 5, after Task 10, after Task 12.

---

## Task 1: Install deps and boot the local stack

**Depends on:** none
**Files:** none
**Steps:**
1. `pnpm install`
2. `crbn up --no-apps` (services only; dev servers are started in Task 15). If Docker is not
   running, STOP and ask the user to start it.
**Verify:**
```bash
crbn status
# Expected: containers healthy (db, api)
```
**Out of scope:** seeding data, changing `.env`.

## Task 2: Migration — `usedInStepId` + convert build-aside data

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_assembly-sub-assemblies.sql` via
  `pnpm db:migrate:new assembly-sub-assemblies`
- Precedent: `packages/database/supabase/migrations/20260910093006_assembly-step-lineage.sql`
**Steps:**
1. Before writing, list NOT NULL columns without defaults on `assemblyInstructionStep`
   (`psql` via `crbn status` DB URL, or read the base migration + later `ALTER`s) so the header
   INSERT supplies them. If any besides the ones below exist, add them with a neutral value.
2. Write:
```sql
-- Sub-assemblies replace "Build off to the side".
--   parentStepId  = the sub-assembly (header step) this step belongs to (was: a later JOIN step).
--   usedInStepId  = on a header: the step that fits the finished sub-assembly.
--                   NULL = nothing uses it, so it joins the main build at the header.
-- ON DELETE SET NULL: deleting the using step leaves the sub-assembly joining the main build.
BEGIN;

ALTER TABLE "assemblyInstructionStep"
  ADD COLUMN IF NOT EXISTS "usedInStepId" TEXT
    REFERENCES "assemblyInstructionStep"("id") ON DELETE SET NULL,
  -- A header row: the sub-assembly itself (can exist before any step is dragged in).
  ADD COLUMN IF NOT EXISTS "isSubAssembly" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "assemblyInstructionStep_usedInStepId_idx"
  ON "assemblyInstructionStep" ("usedInStepId");

-- Convert build-aside data: every join step's staged steps become one sub-assembly
-- used at that join step, placed where the last staged step was.
CREATE TEMP TABLE "_subAssemblyJoin" ON COMMIT DROP AS
SELECT
  j."id"                    AS "joinId",
  j."assemblyInstructionId" AS "assemblyInstructionId",
  j."companyId"             AS "companyId",
  j."createdBy"             AS "createdBy",
  xid()                     AS "headerId",
  MAX(s."sortOrder")        AS "lastStaged"
FROM "assemblyInstructionStep" s
JOIN "assemblyInstructionStep" j ON j."id" = s."parentStepId"
GROUP BY j."id", j."assemblyInstructionId", j."companyId", j."createdBy";

INSERT INTO "assemblyInstructionStep"
  ("id", "assemblyInstructionId", "companyId", "title", "sortOrder",
   "usedInStepId", "isSubAssembly", "componentNodeIds", "planConfidence", "createdBy")
SELECT "headerId", "assemblyInstructionId", "companyId", 'Sub-Assembly', "lastStaged",
       "joinId", true, '{}', 'manual', "createdBy"
FROM "_subAssemblyJoin";

UPDATE "assemblyInstructionStep" s
SET "parentStepId" = jn."headerId"
FROM "_subAssemblyJoin" jn
WHERE s."parentStepId" = jn."joinId";

-- Renumber affected instructions so members sit directly before their header (play order).
WITH keyed AS (
  SELECT
    s."id",
    s."assemblyInstructionId",
    COALESCE(m."lastStaged", h."lastStaged", s."sortOrder") AS k1,
    CASE WHEN h."headerId" IS NOT NULL THEN 1 ELSE 0 END      AS k2,
    s."sortOrder"                                             AS k3
  FROM "assemblyInstructionStep" s
  LEFT JOIN "_subAssemblyJoin" m ON m."headerId" = s."parentStepId"
  LEFT JOIN "_subAssemblyJoin" h ON h."headerId" = s."id"
  WHERE s."assemblyInstructionId" IN (SELECT "assemblyInstructionId" FROM "_subAssemblyJoin")
),
numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "assemblyInstructionId" ORDER BY k1, k2, k3) AS rn
  FROM keyed
)
UPDATE "assemblyInstructionStep" s
SET "sortOrder" = n.rn
FROM numbered n
WHERE s."id" = n."id";

COMMIT;
```
**Verify:** (after Task 3 applies it)
```bash
grep -c "usedInStepId" packages/database/supabase/migrations/*_assembly-sub-assemblies.sql
# Expected: >= 3
```
**Out of scope:** `jobOperationStep` schema (no change), RLS (unchanged table).

## Task 3: Apply migration and regenerate DB types

**Depends on:** 2
**Steps:**
1. `pnpm db:migrate`
2. `pnpm run generate:types`
**Verify:**
```bash
grep -c "usedInStepId" packages/database/src/types.ts
# Expected: >= 3 (Row, Insert, Update)
```
If `db:migrate` fails, STOP and report the SQL error — do not hand-edit types.

## Task 4: Viewer — pure `subassembly.ts` model + tests; step type change

**Depends on:** 3
**Files:**
- Create: `packages/viewer/src/subassembly.ts`, `packages/viewer/src/subassembly.test.ts`
- Modify: `packages/viewer/src/types.ts` — `AssemblyStep`: add `parentStepId?: string | null`,
  `usedInStepId?: string | null`; remove `joinStepId`.
- Modify: `packages/viewer/src/index.ts`, `packages/viewer/src/steps.ts` — export the new
  module (three-free entry `steps.ts` too); remove staging exports.
- Delete: `packages/viewer/src/staging.ts`, `packages/viewer/src/staging.test.ts`.
- Precedent: `packages/viewer/src/staging.ts` (pure helper style), `staging.test.ts` (fixtures).
**Steps:**
1. Implement (all pure, input = steps in `sortOrder` = play order):
```ts
export type SubAssemblyInfo = {
  stepId: string;
  headerId: string | null;        // for members: their header; for headers: own id; else null
  isHeader: boolean;              // has at least one member OR was created as a header (empty)
  number: string;                 // "1", "1.2" — top-level count over headers + main steps
  plays: boolean;                 // false only for a header whose usedInStepId is set
  isolatePartIds: string[] | null;// members: parts of their sub-assembly; else null
  carriesIn: string[];            // header ids whose finished parts arrive at this step
};
export function buildSubAssemblyPlan(steps: AssemblyStep[], headerIds?: Set<string>): Map<string, SubAssemblyInfo>;
export function subAssemblyPartIds(steps: AssemblyStep[], headerId: string): string[]; // recursive via uses
export type SubAssemblyViolation = { stepId: string; rule: 1 | 2 | 3 | 4; message: string };
export function validateSubAssemblies(steps: AssemblyStep[], headerIds?: Set<string>): SubAssemblyViolation[];
export function usableSubAssemblies(steps: AssemblyStep[], stepId: string): { headerId: string; reason: null | "own" | "before" | "header" }[];
export function displayOrder(steps: AssemblyStep[]): { stepId: string; depth: 0 | 1 }[]; // header above members
```
   A header is a step with `isSubAssembly === true` (`AssemblyStep.isSubAssembly?: boolean`,
   mapped by both apps' `toViewerStep`). Drop the `headerIds` parameters from the signatures above.
2. Rules exactly as spec §Data model 1–5. Carry-in: a step carries in every header whose
   `usedInStepId` is that step; an unused header carries in itself (and `plays = true`).
   `isolatePartIds` for a member = `subAssemblyPartIds(header)` (own members' `componentNodeIds`
   plus recursively the parts of headers used by its members).
3. Tests with the spec's example (1 / 1.1–1.3 / 2 / 3 / 4 / 4.1 / 4.2 uses 1 / 5): numbering,
   plays flags, isolation sets (4.x isolate includes Drive Train parts), carry-in at 4.2 = [1] and
   at 4 = [4], each validator rule (non-contiguous members, nesting, use before header, use by own
   member, use of a header by a header), `usableSubAssemblies` reasons, `displayOrder`.
**Verify:**
```bash
pnpm --filter @carbon/viewer test -- subassembly
# Expected: all subassembly tests pass
```
**Out of scope:** AssemblyPlayer changes (Task 5).

## Task 5: Viewer — player: remove staging, add isolation, carry-in, scope, pill

**Depends on:** 4
**Files:**
- Modify: `packages/viewer/src/AssemblyPlayer.tsx`, `packages/viewer/src/motion.ts` (keep glide,
  rename option `glide` semantics unchanged), `packages/viewer/src/motion.test.ts` (rewrite the
  two "join step glides" tests as "carry-in step glides"), `packages/viewer/AGENTS.md`.
**Steps:**
1. Remove every staging reference listed in code research §1 "Staging wiring to delete".
2. `const plan = useMemo(() => buildSubAssemblyPlan(steps), [steps])`.
3. Timeline: a step with `plan.get(id).plays === false` gets a 0-length segment and is skipped
   by prev/next/auto-advance (keep the index mapping intact so hosts still index by position).
4. Carry-in: in `displaySteps`, for each step, widen `componentNodeIds` with
   `subAssemblyPartIds(steps, h)` for every `h` in `carriesIn` (replaces the join merge at
   356-369); give the clip the glide (`STAGING_GLIDE_SECONDS` constant moves into `motion.ts` as
   `CARRY_IN_GLIDE_SECONDS = 1.2`) with offset = +X by 25% of the assembly diagonal (same value
   staging used, `staging.ts:17`), then the step's insertion.
5. Isolation: new scene input `isolateNodeIds: string[] | null` from the ACTIVE step's
   `isolatePartIds` (also while paused). Apply like the focus branch (1252-1266: members,
   ancestors, descendants stay; everything else hidden), after the focus branch, and NOT cleared
   while playing. Camera: when isolated, replace the whole-model box with the union of isolated
   parts' seated bounds in `getAssemblyBox` callers (1679-1695, 1840-1883) and in initial framing.
6. Scope: new prop `scopeStepIds?: string[]`. When set, `segments`, counter, scrubber, prev/next
   and auto-advance cover only those steps (map through indices); installed state still uses all
   `steps`.
7. Pill: new props `isolationLabel?: string | null` and `carryInLabel?: string | null` (hosts pass
   translated text). Render top-centre with the "Planning motion…" pill classes (`$id.tsx:619`):
   `absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border
   border-border bg-card px-3 py-1.5 shadow-lg text-xs font-medium`.
8. Update `packages/viewer/AGENTS.md` (replace staging bullets with sub-assembly behaviour).
**Verify:**
```bash
pnpm --filter @carbon/viewer test && pnpm --filter @carbon/viewer typecheck
# Expected: all tests pass; no type errors
```
**CHECK-IN with the user after this task.**
**Out of scope:** planner (Rust), `assignStepPhases`.

## Task 6: ERP — validators and service functions

**Depends on:** 3, 4
**Files:**
- Modify: `apps/erp/app/modules/production/production.models.ts` — remove
  `assemblyInstructionStepJoinValidator`; add:
```ts
export const assemblySubAssemblyNewValidator = z.object({ stepId: z.string().min(1) });
export const assemblySubAssemblyUpdateValidator = z.object({
  title: zfd.text(z.string().optional()),
  usedInStepId: zfd.text(z.string().optional()) // "" → null (main build)
});
```
- Modify: `apps/erp/app/modules/production/production.service.ts`:
  - Remove `updateAssemblyStepJoin` and the `joinTargets` import.
  - `toViewerStep`: map `parentStepId`, `usedInStepId`, `isSubAssembly` (drop `joinStepId`).
  - `copyAssemblyInstructionAsVersion`: remap `usedInStepId` through `stepIdMap` exactly like
    `parentStepId` (6864-6866).
  - Add (Kysely `db` passed in from the route; precedent `updateAssemblyInstructionStepOrder`
    7706-7739):
    - `makeAssemblySubAssembly(db, { assemblyInstructionId, stepId, companyId, userId })`: in one
      transaction insert a header (`isSubAssembly true`, `title` 'Sub-Assembly', `componentNodeIds
      '{}'`, `motion {"type":"none"}`, `planConfidence 'manual'`) with `sortOrder` = step's
      `sortOrder + 0.5`, set the step's `parentStepId` to it, renumber `1..n`, then
      `validateSubAssemblies` over the instruction's steps; throw on a violation. Refuse when the
      step is already a member or a header. Returns the header id.
    - `updateAssemblySubAssembly(db, { headerId, title?, usedInStepId?, companyId, userId })`:
      validate with `validateSubAssemblies` on the would-be rows; throw a readable message.
    - `ungroupAssemblySubAssembly(db, { headerId, … })`: null members' `parentStepId`, delete the
      header (FK clears any `usedInStepId` pointing elsewhere), renumber.
    - `deleteAssemblySubAssembly(db, { headerId, … })`: delete members and header in one
      transaction, renumber.
  - `updateAssemblyInstructionStepOrder`: accept `updates: { id, sortOrder, parentStepId? }[]`;
    in `afterUpdate`, set `parentStepId` for ids that sent one (`null` allowed), then load the
    instruction's steps and throw if `validateSubAssemblies` returns violations; remove the
    build-aside hook (7719-7737).
  - Every function scopes by `companyId` and checks the instruction is Draft (reuse the check the
    existing step routes use; if they rely on UI-only locking, add a `status = 'Draft'` guard in
    the service and throw "Only draft instructions can be edited").
- Modify: `apps/erp/app/modules/shared/sort-order.ts` — `parseSortOrderUpdates` accepts either
  a number or `{ sortOrder, parentStepId }` per id for this caller (add a sibling parser
  `parseStepOrderUpdates` rather than changing the shared one).
**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in production.service.ts / production.models.ts (other errors from
# callers of removed code are fixed in Tasks 7, 9, 10 — record them, don't fix here)
```
**Out of scope:** UI.

## Task 7: ERP — routes and path helpers

**Depends on:** 6
**Files:**
- Delete: `apps/erp/app/routes/x+/assembly+/$id.steps.join.$stepId.tsx`; remove
  `assemblyInstructionStepJoin` from `apps/erp/app/utils/path.ts`.
- Create (precedent `apps/erp/app/routes/x+/assembly+/$id.steps.order.tsx` for Kysely routes,
  `$id.steps.hidden.$stepId.tsx` for fetcher-autosave shape): 
  - `$id.sub-assemblies.new.tsx` → `makeAssemblySubAssembly`, returns `{ success, id }`
  - `$id.sub-assemblies.$stepId.tsx` → `updateAssemblySubAssembly`
  - `$id.sub-assemblies.$stepId.ungroup.tsx` → `ungroupAssemblySubAssembly`
  - `$id.sub-assemblies.$stepId.delete.tsx` → `deleteAssemblySubAssembly`
  All: `assertIsPost`, `requirePermissions(request, { update: "production" })`,
  `validator(...).validate(formData)`, `getDatabaseClient()`, try/catch → `data({ success:false,
  message }, await flash(request, error(e, t)))` with a logged error (`getLogger("erp", …)`).
- Modify: `$id.steps.order.tsx` — use `parseStepOrderUpdates`.
- Modify: `apps/erp/app/utils/path.ts` — add `assemblySubAssemblyNew(id)`,
  `assemblySubAssembly(id, stepId)`, `assemblySubAssemblyUngroup(id, stepId)`,
  `assemblySubAssemblyDelete(id, stepId)` next to the other `assembly*` helpers (366-401).
**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -c "routes/x+/assembly+" 
# Expected: 0
```

## Task 8: Job sync and job creation skip header rows

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — `syncAssemblyInstructionToOperation`
  (8819+): select `isSubAssembly` and filter those rows out before the upsert; existing stale-marker
  deletion then removes job steps whose instruction row is now a header.
- Modify: `packages/database/supabase/functions/get-method/index.ts` —
  `insertAssemblyDataForJobOperation` (8159-8240): skip rows with `isSubAssembly`.
**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && grep -n "isSubAssembly" packages/database/supabase/functions/get-method/index.ts
# Expected: typecheck passes for these files; grep shows the filter
```

## Task 9: ERP — Explorer: grouped list, dnd-kit, menus, open sub-assembly

**Depends on:** 5, 7
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionExplorer.tsx`
  (split out `AssemblyStepList.tsx` for the list + DnD if the file grows; it is 1194 lines).
- Precedents: row anatomy = current `StepItem` (1055-1178); nested dnd-kit =
  `apps/erp/app/modules/items/ui/Parts/ConfigurationParameters.tsx` (keyboard coordinate getter
  174-176/1204-1290, `onDragOver` 541+, `onDragEnd` 468-539); announcements =
  `apps/erp/app/modules/production/ui/Schedule/Kanban/Kanban.tsx:442-545`; look = prototype.
**Steps:**
1. Build rows from `displayOrder(viewerSteps)` + `buildSubAssemblyPlan`; header row: grip, chevron
   (collapse; local state), number, `LuBoxes` tile, title `font-medium` + muted line
   (`Sub-Assembly · used in {number}` / `Sub-Assembly · joins main build`), parts count, status, ⋮.
   Member rows: `pl-6` + 1px rail. Consumer rows: outline tag `Uses {n}` (click selects the header).
2. Replace framer `Reorder` with dnd-kit (`PointerSensor` distance 8, `KeyboardSensor` with a
   coordinate getter, translated announcements, `DragOverlay` with `dropAnimation={null}`).
   Allowed moves come from `validateSubAssemblies` on the would-be order; illegal drops snap back.
   A header drags with its members. Submit through the existing debounced order fetcher with
   `{ id: { sortOrder, parentStepId } }` in PLAY order (members before header).
3. ⋮ menus (row): Make Sub-Assembly (`path.to.assemblySubAssemblyNew`), Move Into ▸ (lists
   headers), Move Out of Sub-Assembly (disabled at top level), Delete Step. Header: Open
   Sub-Assembly, Ungroup, Delete Sub-Assembly (`ConfirmDelete` pattern:
   `apps/erp/app/components/Modals/ConfirmDelete/ConfirmDelete.tsx`).
4. Open: `?subAssembly=<headerId>` via `useSearchParams`; list shows a back bar
   (`LuArrowLeft` "All steps" · `Sub-Assembly {n} · {title}`) and only members; double-click
   header opens. Empty sub-assembly shows a dashed drop zone "Drag steps here to build them on
   their own."
5. Remove the "Built aside" icon (1134-1140) and the regenerate warning (836-843).
**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm --filter erp exec biome lint app/modules/production/ui/Assemblies
# Expected: no errors
```

## Task 10: ERP — Properties + `$id.tsx` wiring

**Depends on:** 5, 7
**Files:**
- Modify: `apps/erp/app/routes/x+/assembly+/$id.tsx` — add `export function shouldRevalidate`
  that returns `false` when only the `subAssembly` search param changed
  (`currentUrl.pathname === nextUrl.pathname && !formMethod`); pass `scopeStepIds`,
  `isolationLabel`, `carryInLabel` (translated) to `AssemblyPlayer`; remove `stagedGroupNodeIds`
  (21-22, 323-330) — `selectedOwnNodeIds` now adds `subAssemblyPartIds` for carried-in headers;
  pass display numbers to Properties.
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionProperties.tsx` —
  remove `AssemblyStepJoin` (66, 639-646) and the `viewerSteps`/`onSelectStep` join-only props;
  "Step {number}" eyebrow; header selected → Sub-Assembly panel (Name, Steps list, Used in select
  via `usableSubAssemblies`, join Instruction/Camera when unused, Ungroup / Delete); step selected →
  Components header gains "Use Sub-Assembly" dropdown (`DropdownMenu` + reasons) posting to
  `path.to.assemblySubAssembly(id, headerId)` with `usedInStepId`; used sub-assemblies render as a
  component row (tile, name, `Sub-Assembly {n} · {count} parts`, Open).
- Delete: `apps/erp/app/modules/production/ui/Assemblies/AssemblyStepJoin.tsx`.
- Precedent: `AssemblyInstructionProperties.tsx` Components section (706-760), `PlaybackRow`.
**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```
**CHECK-IN with the user after this task.**

## Task 11: ERP — rename component-list "Subassembly" → "Component Group"

**Depends on:** 1
**Files:** Modify `apps/erp/app/modules/production/ui/Assemblies/AssemblyBomTree.tsx` — every
string in code research §6 ("Plan as one component" → "Group as One Component"; "Subassembly
name" → "Component group name"; "Edit subassembly" → "Edit Component Group"; toast "Component
group updated — re-run motion planning to apply the change"; etc.), each wrapped in Lingui.
**Verify:**
```bash
grep -n -i "subassembl" apps/erp/app/modules/production/ui/Assemblies/AssemblyBomTree.tsx | grep -v "^\s*[0-9]*:\s*//" 
# Expected: no user-visible hits (comments only)
```

## Task 12: MES — playback columns + step bar with open/back

**Depends on:** 3, 5
**Files:**
- Modify: `apps/mes/app/services/operations.service.ts:675` — select `parentStepId`,
  `usedInStepId`, `isSubAssembly`.
- Modify: `apps/mes/app/components/AssemblyView.tsx` — `toViewerStep` (212-231) maps the new
  fields; the step bar (1596-1627) shows top-level items: job steps whose marker's instruction row
  has no `parentStepId`, plus one entry per header (title, done when all its job steps are
  recorded). `?subAssembly=` swaps the bar to that header's job steps with a back bar ("All
  steps" · "Sub-Assembly {n} · {title}", touch size `size="lg"`); pass `scopeStepIds` and the
  translated pill labels to the player. Record/complete logic unchanged.
- Precedent: current bar (1596-1627) and `.claude/rules/mes-job-operation-ui.md`.
**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: 0 errors
```
**CHECK-IN with the user after this task.**

## Task 13: Docs, glossary, AGENTS.md, MCP digest, superseded spec

**Depends on:** 7
**Files:** `docs/content/docs/reference/assembly-instructions.mdx` (replace 68, 71-79, 89, 105,
107 with a "Sub-assemblies" section), `docs/content/docs/reference/mes.mdx:76`,
`docs/content/src/glossary/terms.ts` (replace `assembly-step-build-aside` with
`assembly-sub-assembly`), `apps/erp/app/modules/production/AGENTS.md` (15-16),
`.ai/specs/2026-09-28-assembly-subassembly-staging.md` (status → "Superseded by
2026-09-30-assembly-sub-assemblies"). Then `pnpm run generate:mcp`.
**Verify:**
```bash
grep -rn "Build off to the side\|build-aside\|updateAssemblyStepJoin" docs apps packages --include=*.ts --include=*.tsx --include=*.mdx --include=*.json | grep -v node_modules
# Expected: no hits
```

## Task 14: Translations

**Depends on:** 9–12
**Steps:** `pnpm lingui:extract` then `pnpm translate` (if the LLM step lacks a key, STOP and tell
the user; extract alone is acceptable for review).
**Verify:**
```bash
grep -c "Use Sub-Assembly" packages/locale/locales/en/erp.po
# Expected: 1
```

## Task 15: Verification

**Depends on:** all
**Steps:**
1. `pnpm --filter @carbon/viewer test`; `pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/viewer`;
   `pnpm --filter erp test`; `pnpm run lint`.
2. `crbn up` (apps), log in with the `auth` skill, and walk acceptance criteria 1–13 of the spec
   in the browser (screenshots at 1440 and 1024 wide), per carbon-design Step 6.
3. Record results (pass/fail per criterion) in the spec changelog.
**Verify:**
```bash
pnpm --filter @carbon/viewer test
# Expected: all pass
```
