# Assembly instructions: sub-assemblies

- **Status:** Approved 2026-09-30
- **Date:** 2026-09-30
- **Branch:** `feat/sub-assemblies`
- **Replaces:** `.ai/specs/2026-09-28-assembly-subassembly-staging.md` ("Build off to the side")
- **Research:** `.ai/research/2026-09-30-assembly-sub-assemblies-domain.md` (other tools),
  `.ai/research/2026-09-30-assembly-sub-assemblies-code.md` (current code)
- **Prototype (agreed look and flow):** `plans/sub-assemblies/prototype.html` in the parent folder
  (`/Users/aashu/work/carbon/plans/sub-assemblies/prototype.html`)

## Summary

"Build off to the side" lets an author point single steps at a later join step. It is a
per-step select, it is hard to see in the step list, and it cannot express "this sub-assembly
uses that one". It is replaced by **sub-assemblies**:

- Any step can be wrapped into a **sub-assembly**, and other steps are dragged into it. Its steps
  are numbered N.1, N.2 … and are built on their own: while they play, the 3D view shows only
  that sub-assembly's parts.
- A step can **use** a finished sub-assembly as one of its parts (4.2 uses 1). At that step the
  whole unit is carried in. A sub-assembly that nothing uses joins the main build right after
  its own steps.
- The author (ERP) and the operator (MES) can **open** a sub-assembly, so the step list and the
  player show only its steps.

Example used throughout (seeded-style demo, not customer data):

| # | Step | Notes |
|---|---|---|
| 1 | **Drive Train** (sub-assembly) | used in 4.2 |
| 1.1 | Place gear plate | shown on its own |
| 1.2 | Seat pinion gear | |
| 1.3 | Seat idler gear | |
| 2 | Place sole plate | main build |
| 3 | Fit heel counter | main build |
| 4 | **Heel Module** (sub-assembly) | nothing uses it → joins the main build |
| 4.1 | Place heel shell | shown on its own |
| 4.2 | Add drive train | **uses 1**: Drive Train is carried in as one piece |
| 5 | Snap on upper shell | main build |

## Goals

- An author builds the structure above in the ERP with drag and drop or menu actions, and sees
  it clearly in the step list (grouping, N.M numbering, "Uses 1" tags).
- Playback shows each sub-assembly on its own while it is built, and carries the finished unit
  in where it is used, in both ERP and MES.
- Author and operator can open a sub-assembly and see only its steps and only its timeline.
- Existing "Build off to the side" data keeps playing the same way after the upgrade.

## Non-goals

- **Nesting** a sub-assembly inside another. "Uses" covers chains of any length (research: linking
  is how flat tools express reuse); the list stays two levels (N, N.M).
- Using one sub-assembly in two places, or a quantity of sub-assemblies (×2).
- Planner (Rust) support: planning still sees one flat sequence (same as today's build-aside).
- Automatic detection of sub-assemblies from the plan (`assignStepPhases` stays unused).
- A job-table change: MES grouping is derived from instruction data (Q4).
- Dragging where the carried-in unit starts from; the glide start is computed as today.

## Design

### Terms

- **Sub-assembly:** a *header* step (an `assemblyInstructionStep` row) plus the steps whose
  `parentStepId` is the header (its *member* steps).
- **Uses:** a header's `usedInStepId` points at the (non-header) step that fits the finished unit.
- **Unused sub-assembly:** `usedInStepId` is NULL → the header itself is where it joins the main build.
- **Parts of a sub-assembly:** every part installed by its member steps, plus the parts of every
  sub-assembly one of its member steps uses (recursively).

### Data model

`assemblyInstructionStep` (existing):

- `parentStepId` (existing column, self-FK `ON DELETE SET NULL`) **changes meaning**:
  = the sub-assembly header this step belongs to. NULL = top level.
- **New:** `usedInStepId TEXT NULL`, self-FK to `assemblyInstructionStep("id")` `ON DELETE SET NULL`
  (deleting the using step makes the sub-assembly unused, i.e. it joins the main build), indexed.
  Only set on header rows.
- **New:** `isSubAssembly BOOLEAN NOT NULL DEFAULT false` — marks a header row, so a sub-assembly
  exists (and shows "Drag steps here") before any step is dragged in.
- `sortOrder` is **play order**, as today: a sub-assembly's member steps come directly before its
  header (contiguous), and everything downstream that reads steps flat by `sortOrder` (job sync,
  job creation, re-motion, MES) keeps working unchanged. The editor *displays* the header above
  its members; that is a view concern only.

A header is a row with `componentNodeIds = []`, `motion = none`, `planConfidence = 'manual'`,
`title` = the sub-assembly name. For an unused sub-assembly its `instructionText`/`camera` describe
the join ("Place the heel module on the sole plate").

Rules (one pure validator, `validateSubAssemblies(steps)` in `@carbon/viewer`, used by the ERP
service on every structural write and by the UI to offer only valid actions):

1. A header's members directly precede it in `sortOrder` (contiguous).
2. No nesting: a member step cannot be a header, and a header has no `parentStepId`.
3. `usedInStepId` is only set on headers; it points at a non-header step of the same instruction
   that comes **after** the header in `sortOrder` and is not one of its own members.
4. A step may use several sub-assemblies; a sub-assembly is used by at most one step (column).
5. A header with no members is allowed (just created, "Drag steps here").

Migration (`pnpm db:migrate:new assembly-sub-assemblies`):

1. Add `usedInStepId` + FK + index.
2. Convert build-aside data (Q2): for each join step J with staged steps S (rows whose
   `parentStepId` = J): insert a header H (`title` 'Sub-Assembly', `usedInStepId` = J,
   `parentStepId` NULL, `planConfidence` 'manual', same instruction/company/audit), set every S's
   `parentStepId` = H, and renumber the instruction's `sortOrder` so S (in their current order)
   followed by H sit at the position of the last S. Playback is equivalent: the group is built on
   its own and carried in at J.
3. Regenerate types; `packages/jobs/manifests/schema.json` refreshes via `db:check:backups`.

### Viewer (`packages/viewer`)

New pure module `subassembly.ts` (unit-tested), replacing `staging.ts`:

- `buildSubAssemblyPlan(steps)` → per step: its header (if any), its number (`"1"`, `"1.2"`), whether
  it is a header, whether it plays (member steps and main steps always; a header only when unused),
  the **isolation set** for member steps (parts of its sub-assembly), and for each step the list of
  sub-assemblies it **carries in** (its own `uses` plus, for an unused header, itself).
- `validateSubAssemblies(steps)` (rules 1–5), `subAssemblyPartIds(steps, headerId)`.

`AssemblyStep` gains `parentStepId?: string | null` and `usedInStepId?: string | null`;
`joinStepId` is removed. `AssemblyPlayer` changes:

- **Isolation.** While a member step is active, only its sub-assembly's parts render. Implemented
  like the existing focus set (ancestors kept visible, `AssemblyPlayer.tsx:1252-1266`) but not
  cleared by playback, and the camera frames the isolated parts' bounds instead of the whole model
  (`getAssemblyBox` → union of member bounds when isolated).
- **Carry-in.** At a step that carries sub-assemblies in, their parts are added to the step's moving
  parts (today's join merge, `displaySteps` 356-369) and glide in before the step's insertion
  (keep `prependGlide`, `motion.ts:595-626`). A header row that does not play (used sub-assembly)
  gets no timeline segment.
- **Scope.** New optional prop `scopeStepIds?: string[]`: the timeline, counter and prev/next only
  cover those steps (used for "open a sub-assembly"); installed state still comes from the full
  `steps`, so earlier parts render correctly.
- **Pill.** While isolated, the player shows a top-centre pill "Sub-Assembly 1 · Drive Train —
  shown on its own" (and "Uses 1 · Drive Train" at a carry-in step), using the existing
  "Planning motion…" pill styling. Strings come in as props (the viewer has no Lingui).
- Delete all staging code listed in the code research §1 and `staging.ts`/tests.

### ERP authoring (`apps/erp/.../ui/Assemblies`, `routes/x+/assembly+`)

Designed with the carbon-design skill; archetype: document workspace (Explorer | 3D | Properties),
sibling = today's assembly editor. Look and flow per the prototype.

**Step list (Explorer)**
- Header row: grip, chevron (collapse), number, boxes tile (`LuBoxes`), name (`font-medium`) with a
  muted line "Sub-Assembly · used in 4.2" or "Sub-Assembly · joins main build", parts count, status,
  ⋮. Member rows are indented with a thin rail; numbers N.M. A step that uses a sub-assembly shows a
  small outline tag "Uses 1" (click selects that sub-assembly).
- **Open** a sub-assembly (⋮ "Open Sub-Assembly", or double-click the header): the list shows a
  back bar "← All steps · Sub-Assembly 1 · Drive Train" and only its member steps; the player is
  scoped to them. State is the URL param `?subAssembly=<headerId>`; the `$id` route gets a
  `shouldRevalidate` that skips search-param-only changes (code research §2).
- Drag and drop moves to **dnd-kit** (keyboard sensor, 8px pointer threshold, translated
  announcements; exemplar `modules/items/ui/Parts/ConfigurationParameters.tsx`): reorder at top level,
  drag a step onto/into a sub-assembly (joins it), drag a member out (leaves it), reorder members.
  Headers move with their members. Saves through the existing order route, whose payload grows a
  `parentStepId` per step; the service validates with `validateSubAssemblies` and renormalizes.
- Row ⋮ menu: "Make Sub-Assembly" (wraps the step, Q1), "Move Into ▸ {sub-assemblies}",
  "Move Out of Sub-Assembly", "Delete Step". Header ⋮: "Open Sub-Assembly", "Ungroup" (members
  return to the top level in place), "Delete Sub-Assembly" (confirm; deletes header and members).
- The "Built aside" icon and the regenerate warning go away.

**Properties**
- Header selected: "Sub-Assembly N" eyebrow + status; Name; Steps list (click to select);
  "Used in" select (valid using steps per rule 3, or "Main build (after its last step)"); for an
  unused sub-assembly also Instruction + Camera for the join; Ungroup / Delete Sub-Assembly.
- Step selected: Components section gains a "Use Sub-Assembly" button (menu of sub-assemblies with
  why one is unavailable: "This step is part of it", "Used in 4.2 — moves here"); a used
  sub-assembly shows as a component row (boxes tile, name, "Sub-Assembly 1 · 3 parts", Open).
- "Step N of M" reads the display number ("Step 4.2").
- The "Build off to the side" playback row is removed.

**Services / routes** (`production.service.ts`, `production.models.ts`, `routes/x+/assembly+`)
- `makeAssemblySubAssembly` (wrap a step: insert header after it, set its `parentStepId`) —
  route `$id.sub-assemblies.new.tsx`.
- `updateAssemblySubAssembly` (name, `usedInStepId`) — route `$id.sub-assemblies.$stepId.tsx`.
- `ungroupAssemblySubAssembly`, `deleteAssemblySubAssembly` (Kysely transaction) — routes
  `$id.sub-assemblies.$stepId.ungroup.tsx`, `$id.sub-assemblies.$stepId.delete.tsx`.
- `updateAssemblyInstructionStepOrder` accepts `{ id: { sortOrder, parentStepId } }` and validates
  in its transaction; its build-aside `afterUpdate` is removed.
- `copyAssemblyInstructionAsVersion` remaps `usedInStepId` like `parentStepId`.
- `toViewerStep` maps `parentStepId`/`usedInStepId`.
- All writes: `production` update permission, instruction must be Draft (existing lock), `companyId`
  scoped. Remove `updateAssemblyStepJoin`, its route, validator, path helper; regenerate the MCP digest.

**Rename** the component-list "Subassembly" (assembly units, "Plan as one component") to
**"Component Group"** in all copy of `AssemblyBomTree.tsx` (strings in code research §6), wrapping
every string in Lingui. Data model and routes unchanged.

### Job steps and MES

- **Job sync / job creation:** unchanged flat copy by `sortOrder`, except **header rows are not
  copied as job steps** (they are not a build action to record). Both `syncAssemblyInstructionToOperation`
  and `insertAssemblyDataForJobOperation` skip rows that have members; a synced job step whose
  instruction row became a header is removed by the existing stale-marker cleanup.
- **MES playback:** `getAssemblyPlaybackByOperationId` selects `parentStepId`, `usedInStepId`; the
  shared player does isolation and carry-in.
- **MES step bar (Q4):** the bar lists top-level items: main job steps plus one entry per
  sub-assembly (grouping derived from each job step's `assemblyInstructionStepId` → instruction
  `parentStepId`; hand-authored job steps stay top level). Tapping a sub-assembly swaps the bar to
  its steps with a back bar "← All steps · Sub-Assembly 1 · Drive Train" (URL `?subAssembly=`), and
  the player plays its steps. A sub-assembly entry shows done when all its steps are recorded.
  Record/complete logic is unchanged (it counts job steps, and headers are not job steps).
  Touch-first sizing per the MES rules.
- Known v1 limit: because an unused header is not a job step, MES never pins the player to its
  join segment. The unit is simply in place from the next top-level step on (installed state comes
  from the full step list); the join glide is only seen in the ERP and in continuous playback.

### Docs, glossary, AGENTS.md, locale

- `docs/content/docs/reference/assembly-instructions.mdx` and `mes.mdx`: replace the build-aside
  section with a "Sub-assemblies" section; glossary: replace `assembly-step-build-aside` with
  `assembly-sub-assembly`.
- Update `packages/viewer/AGENTS.md`, `apps/erp/app/modules/production/AGENTS.md`.
- Mark the 2026-09-28 staging spec as superseded.
- All new copy through Lingui; `pnpm lingui:extract` + `pnpm translate`.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Nesting | None; "uses" link instead | User's model (4.2 uses 1); chains work without nested UI; research §"Implication" |
| Where membership lives | Existing `parentStepId` (header id) | Already FK'd, `ON DELETE SET NULL`, remapped by version copy |
| Where "uses" lives | New `usedInStepId` on the header | One place per sub-assembly (used once); a step can use several |
| Stored order | `sortOrder` = play order (members, then header) | Every flat consumer (sync, job creation, re-motion, MES) keeps working |
| Header row | A real step row, no parts | "Make Sub-Assembly" wraps a step (Q1); unused header carries the join instruction/camera |
| Unused sub-assembly | Joins the main build at its header | Agreed with user; no dangling units |
| Isolation | Focus-style set + isolated camera bounds | Hidden-set approach blanks assembly groups and frames the whole model (code research §1) |
| Carry-in motion | Reuse join merge + glide | Proven in build-aside; keeps insertion motion editable |
| "Open" state | URL `?subAssembly=` + `shouldRevalidate` | Carbon: URL is state; avoid re-running the heavy loader |
| Drag and drop | dnd-kit with keyboard sensor | framer `Reorder` is flat and has no keyboard; nested precedent exists |
| Validation | One pure validator in `@carbon/viewer` | Same rule in UI (offer valid actions) and server (enforce) |
| Headers in job steps | Not copied | Not a build action; MES derives groups from instruction data (Q4) |
| Old data | Converted by migration (Q2) | Playback stays equivalent |
| Component-list rename | "Component Group" | Frees "Sub-Assembly" for steps (user decision) |
| Regenerate | Unchanged rule: refused while any manual step exists (headers are manual) | Regenerate would wipe authored structure |

## Acceptance criteria

Author the example above on a Draft instruction with a model (the seeded demo assembly works).

1. On step "Place gear plate", ⋮ → Make Sub-Assembly: a sub-assembly "Sub-Assembly" appears with
   the step inside as 1.1; renaming it "Drive Train" in Properties saves and shows in the list.
2. Drag "Seat pinion gear" and "Seat idler gear" into Drive Train: they become 1.2 and 1.3. Drag one
   out: it returns to the top level. Keyboard: focus a grip, Space, arrows, Space does the same moves.
3. Build Heel Module (4.1, 4.2). On 4.2, Components → Use Sub-Assembly → "1 · Drive Train": 4.2 shows
   a "Uses 1" tag, the Drive Train header reads "used in 4.2", and 4.2's components list a Drive Train row.
   The menu shows Heel Module disabled ("This step is part of it").
4. Reload: structure, names, and the use link are unchanged.
5. Play from the start in the ERP: during 1.1–1.3 only Drive Train parts are visible and framed, with
   the "Sub-Assembly 1 · Drive Train" pill; 2–3 show the main build; during 4.1–4.2 only Heel Module
   parts; at 4.2 the finished Drive Train glides in as one piece; then Heel Module joins the main
   build; then step 5. Build/Focus/Full views still behave.
6. Open Heel Module (double-click header): the list shows only 4.1 and 4.2 under a back bar, the
   timeline has 2 segments, and `?subAssembly=` is in the URL; Back restores the full list.
7. Trying to use Drive Train on step 1.2 (inside itself) or on a step before its header is not offered;
   a forged request to the route is rejected with an error toast.
8. Ungroup Heel Module: 4.1/4.2 become top-level steps in place. Delete Sub-Assembly (confirmed)
   removes Drive Train and its steps; 4.2 loses its tag.
9. New Version: the copy has the same structure and use link, pointing at the new version's steps.
10. Sync the instruction to a job operation: no job step is created for the Drive Train or Heel Module
    headers; member steps are created in play order.
11. MES: the step bar shows 2, 3, 5 and the two sub-assemblies; tapping Drive Train shows 1.1–1.3 with
    a back bar and plays them isolated; after recording all three, the Drive Train entry shows done.
12. An instruction that had "Build off to the side" before the migration plays equivalently after it
    (group built on its own, carried in at the old join step) and shows as a sub-assembly.
13. The component list says "Component Group" everywhere "Subassembly"/"Plan as one component" was.
14. `pnpm --filter @carbon/viewer test` (incl. new `subassembly.test.ts`), ERP and MES typecheck,
    `pnpm run lint`, and `lingui:extract` pass; no "Build off to the side" string remains.

## Open questions (resolved)

- [x] Q1. What does "Make Sub-Assembly" do to the chosen step? — **Answer:** Wrap it: a new
  sub-assembly is created and the step moves inside as N.1, keeping its parts/motion/instruction.
- [x] Q2. What happens to existing "Build off to the side" data? — **Answer:** Convert it by
  migration into sub-assemblies used at the old join step; playback stays equivalent.
- [x] Q3. How deep can sub-assemblies nest? — **Answer:** They don't nest; a step *uses* a finished
  sub-assembly (4.2 uses 1). Chains work through uses. (User's own model, after competitor research.)
- [x] Q4. How much reaches MES? — **Answer (user's proposal):** a flat bar of top-level items where a
  sub-assembly is one entry; opening it swaps the bar to its steps with a back bar and plays them.
- [x] Q5. Can the user step into a sub-assembly? — **Answer:** Yes — list and player show only its
  steps (ERP and MES).
- [x] Q6. Naming clash with the component-list "Subassembly"? — **Answer:** Rename that one to
  "Component Group".
- [x] Q7. What happens to a sub-assembly nothing uses? — **Answer:** It joins the main build right
  after its own steps.

## Changelog

- 2026-09-30: first draft after Q1–Q7.
- 2026-09-30: approved. Planning added `isSubAssembly` (an empty header is otherwise indistinguishable from a normal step).
