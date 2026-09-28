# Assembly editor side panels — small UX changes — implementation plan

**Spec / source:** approved design `/Users/aashu/work/carbon/local-docs/assembly-editor-ux-review.html`, section "The final version" (changes L1–L5, R1–R7). User approved it ("i liked it lets build this one") and chose **glossary terms** (LabelWithHelp) for the ⓘ help.
**Branch:** `feat/asembly-view-isolation` (worktree `/Users/aashu/work/carbon/carbon-feat-asembly-view-isolation`). Never commit without the user's permission.
**Design rules:** `/Users/aashu/work/carbon/carbon/.claude/skills/carbon-design/references/` (`foundations.md`, `status-and-feedback.md`, `forms.md`, `anti-patterns.md`). Quiet chrome, no coloured prose (amber only as an icon), `Subheading` instead of hand-rolled uppercase labels, status colour by lifecycle position from `status-colors.ts`, icon-only status in dense rows + tooltip, help via `termId` → `LabelWithHelp`, every string in Lingui.
**Scope:** left panel (Steps list, Components tree) and right panel (Properties header, Details form, BOM tab, Slides). **Out of scope for every task:** the 3D viewer, `AssemblyPlayer`, the editor header, the instructions list, any service/route/DB change.

## Progress
- [x] Task 1: Glossary terms for the four help icons
- [x] Task 2: Shared assembly-step status colours + status components
- [x] Task 3: Steps list rows (L1, L2, L3)
- [x] Task 4: Components tree rows (L4, L5)
- [x] Task 5: Properties header (R1) + status pill
- [x] Task 6: Details form order, Components + Hidden blocks (R4, part of R3)
- [x] Task 7: One Playback box + compact "Build off to the side" (R2, R3)
- [x] Task 8: Save pinned to the bottom (R5)
- [x] Task 9: BOM tab without the duplicate list (R6)
- [x] Task 10: Slides copy + tooltips (R7)
- [x] Task 11: Lingui extract
- [x] Task 12: End-to-end verification

## Dependencies
Task 1 before Task 6/7. Task 2 before Tasks 3 and 5. Tasks 3, 4, 9, 10 are independent of each other. Tasks 6 → 7 → 8 touch the same file (`AssemblyInstructionProperties.tsx`) — run in order. Task 11 after all code tasks; Task 12 last.

---

## Task 1: Glossary terms for the four help icons

**Depends on:** none
**Files:**
- Modify: `packages/glossary/src/terms.ts` — add four entries.
- Copy from (precedent): existing entries in the same file (e.g. `subassembly`, ~line 89).

**Steps:**
1. Add these keys to the `terms` object (place them next to `subassembly`), one-sentence definitions, no `href`:
   ```ts
   "assembly-step-motion": {
     term: msg`Motion`,
     definition: msg`The path this step's components travel into place during playback; worked out from the model, or drawn by hand with Edit Path.`
   },
   "assembly-step-camera": {
     term: msg`Camera`,
     definition: msg`The view a step plays from; without a saved view the step frames its own components.`
   },
   "assembly-step-build-aside": {
     term: msg`Build off to the side`,
     definition: msg`Builds this step's components beside the model as a group, then carries the group in at a later join step.`
   },
   "assembly-step-hidden-components": {
     term: msg`Hidden on this step`,
     definition: msg`Components hidden only while this step plays, such as a fixture in the way; use the eye in the Components tab to hide one.`
   }
   ```
2. If `terms.test.ts` asserts a fixed count or a list of keys, update it to include the four keys (read it first).

**Verify:**
```bash
pnpm --filter @carbon/glossary typecheck && pnpm --filter @carbon/glossary test
# Expected: no type errors; all tests pass
```
**Out of scope:** any other glossary entry, docs pages.

## Task 2: Shared assembly-step status colours + status components

**Depends on:** none
**Files:**
- Modify: `packages/utils/src/status-colors.ts` — add `ASSEMBLY_STEP_STATUS_COLOR_MAP` and register it.
- Create: `apps/erp/app/modules/production/ui/Assemblies/AssemblyStepStatus.tsx`
- Copy from (precedent): `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionStatus.tsx` (wrapper) and `packages/react/src/Status.tsx` (icon per colour).

**Steps:**
1. In `status-colors.ts`, next to `JOB_OPERATION_STATUS_COLOR_MAP`:
   ```ts
   /* assemblyInstructionStep.status (production.models.ts `assemblyStepStatuses`):
    * not started → gray, waiting on a reviewer → yellow, finished → green. */
   export const ASSEMBLY_STEP_STATUS_COLOR_MAP = {
     Todo: "gray",
     Review: "yellow",
     Done: "green"
   } as const satisfies Record<string, StatusColor>;
   ```
   and add `assemblyStep: ASSEMBLY_STEP_STATUS_COLOR_MAP,` to `statusColorMaps`.
2. Create `AssemblyStepStatus.tsx` exporting:
   - `assemblyStepStatuses` re-used from `../../production.models` (`assemblyStepStatuses = ["Todo","Review","Done"]`, line ~1209) and `type AssemblyStepStatusValue`.
   - `normalizeStepStatus(status: string | null | undefined): AssemblyStepStatusValue` → the value if it is in the list, else `"Todo"`.
   - `stepStatusLabel(t, status)` returning translated `t\`Todo\`` / `t\`Review\`` / `t\`Done\`` (use `useLingui` inside the components instead if simpler — no raw enum rendering).
   - `AssemblyStepStatus({ status })` → `<Status color={ASSEMBLY_STEP_STATUS_COLOR_MAP[status]}>{label}</Status>` (the header pill).
   - `AssemblyStepStatusIcon({ status, className })` → the same icon `Status` uses per colour (gray `LuCircleDashed`, yellow `LuClock`, green `LuCircleCheck`) with hue classes `text-muted-foreground` / `text-yellow-500` / `text-emerald-500`, `aria-hidden`.
3. Import `ASSEMBLY_STEP_STATUS_COLOR_MAP` from `@carbon/utils` (check how other ERP files import status maps: `grep -rn "STATUS_COLOR_MAP" apps/erp/app | head`; use the same import path).

**Verify:**
```bash
pnpm --filter @carbon/utils test && pnpm --filter @carbon/utils typecheck
# Expected: status-colors tests pass; no type errors
```
**Out of scope:** other status maps; `Status.tsx`.

## Task 3: Steps list rows (L1, L2, L3)

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionExplorer.tsx` — `StepStatusDot`, `StepStatusControl`, `StepItem` (lines ~920–1166).
- Copy from (precedent): icon-only status in dense rows per `status-and-feedback.md` §2.5; `TruncatedTooltipText` (`packages/react/src/TruncatedTooltipText.tsx`); existing `LuBoxes` icon span in `StepItem` for icon + tooltip.

**Steps:**
1. Delete the local `stepStatusStyles` map and `StepStatusDot`; use `AssemblyStepStatusIcon` / `normalizeStepStatus` from Task 2.
2. `StepStatusControl`: trigger becomes an icon-only ghost button (`size-6`, `rounded-md`, hover `bg-accent`, focus ring as today) showing `AssemblyStepStatusIcon` (`size-4`), wrapped in `Tooltip` with the translated status label. `aria-label={t\`Step status: ${label}. Change status\`}`. Dropdown items keep icon + translated label. Disabled: the icon alone inside a `Tooltip` (no chip). Keep the optimistic `displayed` logic and the submit path unchanged.
3. `StepItem`:
   - Render `ProcedureStepTypeIcon` only when `(step.type ?? "Task") !== "Task"`.
   - Replace the title `<span title>` with `<TruncatedTooltipText tooltip={title} className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</TruncatedTooltipText>` (check its `className` lands on the truncating span; if not, wrap it in a `min-w-0 flex-1` span).
   - Add a flagged icon: compute `flagged` with `stepPlanWarningsSchema.safeParse(step.warnings).data?.flagged === true` (import from `../../production.models`); render `<LuTriangleAlert className="size-3.5 text-amber-500" />` in a `Tooltip` "No collision-free path" (`role="img"`, translated `aria-label`), placed before the `×count`.
   - Convert the existing `title=` attributes on the `LuHand` and `LuBoxes` spans to `Tooltip`s with the same (translated) text.
   - Translate remaining literals in these components ("Delete Step", "More", "Drag handle", "Double-click to play this step", the component-count title) with `t`/`Trans`.

**Verify:**
```bash
pnpm --filter erp typecheck && pnpm exec biome check apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionExplorer.tsx
# Expected: no type errors; Biome reports no errors (the 7 existing useExhaustiveDependencies warnings in this file are pre-existing)
```
**Out of scope:** reordering, the explorer's toolbar/footer, generate/re-plan flows.

## Task 4: Components tree rows (L4, L5)

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyBomTree.tsx` — unit row (~1115–1131), `UnitChildRow` (~1234–1238), group row (~1609–1614), `ThisStepBadge` (~1657), hover-reveal classes (~1147, 1160, 1632, 1695, 1711).

**Steps:**
1. Unit row: replace the `Auto` `Badge` with `LuSparkles` (`size-3.5 text-muted-foreground`, `role="img"`, translated `aria-label`) in a `Tooltip` "Detected by the motion planner".
2. Replace `ThisStepBadge` with `ThisStepIcon`: `LuCircleDot` `size-3.5 text-blue-500` (blue = the viewer's active-step tint, as the badge comment says) in a `Tooltip` "In this step", `role="img"`, translated `aria-label`.
3. Row counts: in the three tree rows (unit `memberCount`, `UnitChildRow` `count`, group row `group.count`) render the `×N` `Badge` only when the value is `> 1`. Leave the popover detail (~1450) and the unit editor list (~1840) unchanged.
4. Every `opacity-0 group-hover:opacity-100` in these rows also gets `group-focus-within:opacity-100` (keyboard reveal, `anti-patterns.md` §3).
5. Translate the literals touched (`Collapse/Expand …`, `Edit/Delete subassembly …`, `Component details: …`, "Detected by the motion planner").

**Verify:**
```bash
pnpm --filter erp typecheck && pnpm exec biome check apps/erp/app/modules/production/ui/Assemblies/AssemblyBomTree.tsx
# Expected: no type errors; no Biome errors
```
**Out of scope:** tree data, selection, hide logic, mapping popover content.

## Task 5: Properties header (R1) + status pill

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionProperties.tsx` — header block (~164–199), delete `stepStatusStyles`/`normalizeStatus`/`StepStatusPill` (~296–319), move `planFlag` computation (~429–438) into a shared helper.

**Steps:**
1. Add a module-level helper `getPlanFlag(warnings: unknown, graphIndex: AssemblyGraphIndex | null): { blockers: string[] } | null` with the exact body of today's `planFlag` memo; use it in both the header (memoised) and `StepForm`.
2. Header: `StepStatusPill` → `<AssemblyStepStatus status={normalizeStepStatus(step.status)} />`. "Step N of M" and "components" via Lingui (`<Plural>` for the component count).
3. Flag line: `<span className="inline-flex items-center gap-1 text-muted-foreground"><LuTriangleAlert className="size-3 text-amber-500" />{t\`No clear path\`}</span>`, wrapped in a `Tooltip` whose content is `t\`Blocked by ${blockers.join(", ")}\`` when `blockers.length > 0` (no tooltip otherwise). No amber text.
4. Translate the header/empty-state literals ("Step", "Untitled step", "No step selected", the pick-a-step sentence, tab labels "Details"/"BOM"/"Slides").

**Verify:**
```bash
pnpm --filter erp typecheck && pnpm exec biome check apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionProperties.tsx
# Expected: no type errors; no Biome errors
```
**Out of scope:** tabs structure, `StepForm` body (Tasks 6–8).

## Task 6: Details form order, Components + Hidden blocks (R4, part of R3)

**Depends on:** Tasks 1, 5
**Files:**
- Modify: `AssemblyInstructionProperties.tsx` — `StepForm` JSX order (~466–646), `StepComponentsEditor` (~659–776), `StepHiddenComponentsEditor` (~779–886).
- Copy from (precedent): `Subheading` usage already at line ~529; `LabelWithHelp` from `@carbon/react` (`packages/react/src/LabelWithHelp.tsx`).

**Steps:**
1. `StepForm` order becomes: Type, Title, Instruction, [Measurement / List fields], Required, **Components** (`StepComponentsEditor`), **Hidden on this step** (`StepHiddenComponentsEditor`), **Playback** (Task 7), Save (Task 8). Remove the "Playback & components" `Subheading`.
2. Required: `description={t\`Operator must record this step\`}`, `label={t\`Required\`}`. Translate the Type/Title/Instruction/Unit of Measure/Minimum/Maximum/List Options labels. Keep the "Optional" tags (automatic).
3. `StepComponentsEditor`: drop the bordered `bg-muted/40` wrapper box; heading row = `<Subheading variant="heavy">{t\`Components\`} · {count}</Subheading>` (count = number of node ids, tabular-nums) + the existing Add/Done button (labels `t\`Add\`` / `t\`Done Adding\``). Keep the adding-mode hint but shorten it to `t\`Click components in the viewer to add them. Shift-click adds several.\``. Empty state: `t\`No components yet\``. List rows: `×N` badge only when `group.count > 1`; translate the remove aria-label.
4. `StepHiddenComponentsEditor`: drop the wrapper box; heading row = `<Subheading variant="heavy"><LabelWithHelp termId="assembly-step-hidden-components" variant="inline">{t\`Hidden on this step\`}</LabelWithHelp></Subheading>` + (when nothing hidden) a muted `t\`None\`` on the right, else the existing Show all / Hide again buttons. Remove the "Nothing hidden. Use the eye…" paragraph (the glossary help now carries it). List rows: `×N` only when `> 1`.
5. Remove the three hand-rolled `Label className="text-xxs font-medium uppercase tracking-wide …"` usages in these blocks.

**Verify:**
```bash
pnpm --filter erp typecheck && pnpm exec biome check apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionProperties.tsx
# Expected: no type errors; no Biome errors
```
**Out of scope:** add/remove/hide behaviour and their fetchers.

## Task 7: One Playback box + compact "Build off to the side" (R2, R3)

**Depends on:** Tasks 1, 6
**Files:**
- Modify: `AssemblyInstructionProperties.tsx` — replace the Motion and Camera boxes (~533–613) with one Playback block.
- Modify: `apps/erp/app/modules/production/ui/Assemblies/AssemblyStepJoin.tsx` — render as a row (no box, no uppercase label, no paragraph).

**Steps:**
1. Playback block: `<Subheading variant="heavy">{t\`Playback\`}</Subheading>` followed by `<div className="w-full divide-y divide-border rounded-lg border border-border bg-card">` with three rows, each `flex items-center justify-between gap-2 px-3 py-2`:
   - **Motion** — left: `<LabelWithHelp termId="assembly-step-motion" variant="inline">` label (`text-xs font-medium text-muted-foreground`) and under it a value line (`text-sm`): `planFlag` → amber `LuTriangleAlert` icon + `t\`No clear path\``; `isEditingMotion` → `t\`Drag the red waypoints in the viewer\``; no components → `t\`Add components first\``; otherwise `t\`Automatic\``. Right: the existing Edit Path / Done Editing Path button (labels translated, same disabled rule, hidden when `isDisabled`).
   - **Camera** — label with `termId="assembly-step-camera"`; value `hasCamera ? t\`Saved view\` : t\`Automatic\``; right: `Button variant="secondary" size="sm"` `t\`Use Current View\`` (same `onSetCamera`) and, when `hasCamera`, ghost `t\`Clear\`` (same `onClearCamera`); hidden when `isDisabled`.
   - **Build off to the side** — `<AssemblyStepJoin … />`.
   Delete the old helper paragraphs ("Edit the path to adjust…", "A saved view frames…", "This step auto-frames…", the long flagged sentence, the waypoint instructions).
2. `AssemblyStepJoin.tsx`: return a row fragment matching the rows above — left `<LabelWithHelp termId="assembly-step-build-aside" variant="inline">{t\`Build off to the side\`}</LabelWithHelp>`; right the control:
   - trigger label `selected ? t\`Joins step ${selected.number}\` : t\`No\``; dropdown items `t\`No, build in place\`` and `t\`Joins step ${number}: ${title}\`` (full title stays in the menu);
   - `locked === "base"` → muted text `t\`No, it's the base\``; `locked === "join"` → `t\`Brings in steps\`` + the existing step-number link buttons; `isDisabled` → the label text.
   Remove the wrapper `VStack` box, the uppercase `Label`, and the helper `<p>`. Keep `joinTargets`, the fetcher submit and the optimistic value exactly as they are. Trigger stays compact (`h-6`, `text-xs`, border, `max-w-[10rem] truncate`).

**Verify:**
```bash
pnpm --filter erp typecheck && pnpm exec biome check apps/erp/app/modules/production/ui/Assemblies/AssemblyInstructionProperties.tsx apps/erp/app/modules/production/ui/Assemblies/AssemblyStepJoin.tsx
# Expected: no type errors; no Biome errors
```
**Out of scope:** motion editing, camera capture, `joinTargets`, the join route/service.

## Task 8: Save pinned to the bottom (R5)

**Depends on:** Task 7
**Files:**
- Modify: `AssemblyInstructionProperties.tsx` — the `Submit` at the end of `StepForm`.

**Steps:**
1. Wrap `Submit` in `<div className="sticky bottom-0 z-10 -mx-4 w-[calc(100%+2rem)] border-t border-border bg-background/95 px-4 py-3 backdrop-blur">` (mirrors the sticky header's surface at line ~166; the panel `VStack` is the scroll container, and `px-4` comes from the `Tabs` wrapper).
2. Label `<Trans>Save</Trans>` (the ⌘↵ shortcut is Submit's default). Keep `isDisabled`/`isLoading` as they are.
3. If the sticky bar doesn't stick because an ancestor between it and the panel has `overflow` set, STOP and report — do not restructure the panel.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: no type errors
```
**Out of scope:** save behaviour, validators, the step route.

## Task 9: BOM tab without the duplicate list (R6)

**Depends on:** none (touches `AssemblyInstructionProperties.tsx` — if Tasks 5–8 are in flight, run after Task 8)
**Files:**
- Modify: `AssemblyInstructionProperties.tsx` — remove `<AssemblyStepBom …/>` from the BOM tab (~259–264) and change the import to `import { ComponentColorSwatch } from "./AssemblyStepBom";`.
- Modify: `AssemblyStepBom.tsx` — delete the now-unused default-export component (keep `ComponentColorSwatch`, used by `AssemblyBomTree.tsx`).

**Steps:** as above; confirm with `grep -rn "AssemblyStepBom" apps/erp/app` that nothing else imports the default export.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: no type errors
```
**Out of scope:** `AssemblyStepMaterials`, `AssemblyStepTools`, the Empty component.

## Task 10: Slides copy + tooltips (R7)

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/components/SlidesEditor.tsx` — "No slides" (~236), Add slide / Add model buttons (~210–231). Shared with the BOP step editor; the copy works for both.

**Steps:**
1. `No slides` → `<Trans>No slides yet</Trans>`.
2. Button labels `<Trans>Add Slide</Trans>` / `<Trans>Add Model</Trans>` (Title Case per `content-and-copy.md`); wrap each in a `Tooltip` (`@carbon/react`): `t\`A photo or PDF the operator sees on this step\`` and `t\`A 3D model the operator can turn around\``.

**Verify:**
```bash
pnpm --filter erp typecheck && pnpm exec biome check apps/erp/app/components/SlidesEditor.tsx
# Expected: no type errors; no Biome errors
```
**Out of scope:** upload, annotation and caption logic.

## Task 11: Lingui extract

**Depends on:** Tasks 1–10
**Steps:**
1. `pnpm run lingui:extract` then `pnpm run lingui:clean`.
2. `git diff --stat packages/locale/locales` — only `erp.po`/`mes.po` catalogs should change. New non-English entries stay empty (no translate run).

**Verify:**
```bash
git diff --stat packages/locale/locales | tail -1
# Expected: only files under packages/locale/locales/*/ changed
```

## Task 12: End-to-end verification

**Depends on:** Task 11
**Steps:**
1. `pnpm --filter erp typecheck`, `pnpm --filter @carbon/utils test`, `pnpm --filter @carbon/glossary test`, `pnpm exec biome check apps/erp/app/modules/production/ui/Assemblies apps/erp/app/components/SlidesEditor.tsx packages/utils/src/status-colors.ts packages/glossary/src/terms.ts`.
2. Browser (agent-browser, `DEV_BYPASS_EMAIL` test@carbon.ms, `https://erp.asembly-view-isolation.dev/x/assembly/GkCD68SBwhaY5fEY-7two`), screenshot and confirm:
   - rows show full titles ("Add 32006JR Roller"), no Task icon, a status icon with tooltip, Todo gray; step 3 shows the amber warning icon;
   - Components tab: "Main Frame" unit row readable, sparkle + dot icons with tooltips, no ×1 badges;
   - right panel: status pill, "No clear path" grey with tooltip on step 3; order Type/Title/Instruction/Required/Components/Hidden/Playback; ⓘ opens the glossary card; Save visible without scrolling;
   - status change, Add components, Edit path, Use current view and Build off to the side still work (then restore any change made).
3. Update `apps/erp/app/modules/production/AGENTS.md` only if a documented name changed (none expected).

**Verify:** all commands exit 0; screenshots match the checklist above.
