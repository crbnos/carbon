# Installed-component visibility in the assembly viewer — implementation plan

**Spec:** .ai/specs/2026-09-17-viewer-installed-component-visibility.md
**Research:** N/A — internal rendering change, no ERP-domain logic (see spec §Research)
**Branch:** worktree-feat-hide-installed-parts

## Progress
- [x] Task 1: Add `InstalledComponentsMode` + 4th param to `visualForComponent`
- [x] Task 2: Extend `visibility.test.ts` for the new parameter
- [x] Task 3: Thread `installedMode` through `AssemblyPlayer` state and scene props
- [x] Task 4: Make camera auto-framing respect `installedMode` — **shipped
      differently**: extracted `occluderWeight` instead of an inline edit, and
      fixed a pre-existing bug it exposed (see the note on Task 4)
- [x] Task 5: Add the toolbar control — **shipped differently, twice.** The
      six-button two-group design this plan describes was built, then rejected
      by the user on sight. An MES-only Focus toggle was tried next and also
      dropped, and so was a three-view version that had no way to show the
      active part on its own. What shipped is four named views
      (`Build`/`Focus`/`Isolate`/`Full`),
      identical in ERP and MES, backed by `ASSEMBLY_VIEWS` / `VIEW_MODES` /
      `viewForModes` in `visibility.ts` and `VIEW_LABELS` in
      `AssemblyPlayer.tsx`. `FocusIcon`/`GhostIcon`/`HiddenIcon`/`SolidIcon`
      were deleted as dead. `flex-wrap` on the row was kept; the "Next"/"Built"
      labels went with the design that needed them. The two axes and every
      pre-existing test are untouched — a view is a derived pair. See the spec
      changelog for why each design was dropped.
- [x] Task 6: Typecheck + full viewer test run — 120 tests pass (14 added for the
      view table in the redesign); viewer, MES and ERP typecheck clean; biome
      clean
- [ ] Task 7: Browser verification in ERP and MES — **NOT DONE.** The local
      `main.dev` dev stack was not running, and an ad-hoc server could not
      complete the dev login ("User record not found"). Nothing in this change
      has been seen rendering. Must be walked before merge.

**Post-review follow-ups (not in the original plan):**
- [x] Update `apps/erp/app/modules/production/AGENTS.md` — its playback-visibility
      paragraph described only one visibility axis
- [x] Add the two-predicates-must-agree invariant to `packages/viewer/AGENTS.md`
- [x] Add a `.ai/lessons.md` entry for the render-vs-reason drift
- [x] Correct the spec (occluder extraction, the incidental fix, the wrong
      "already wraps" claim, verified vs unverified criteria)

## Dependencies
- Task 2 needs Task 1 (the new signature must exist).
- Task 3 needs Task 1.
- Tasks 4 and 5 both need Task 3 (they consume the `installedMode` state it introduces).
- Task 6 needs Tasks 1–5.
- Task 7 needs Task 6.
- Tasks 4 and 5 are independent of each other and may run in parallel.

## Context for the executor

All work is in `packages/viewer` plus one comment-only touch in MES. There is **no**
migration, no service, no route, no form, and no schema change — do not create any.

`@carbon/viewer` is deliberately i18n-free (zero `@lingui` imports, no lingui
dependency). New `aria-label` strings in this package stay plain English by
decision — see the spec's Design Decisions. **Do not add Lingui macros to this
package.**

---

## Task 1: Add `InstalledComponentsMode` + 4th param to `visualForComponent`

**Depends on:** none
**Files:**
- Modify: `packages/viewer/src/visibility.ts` — add the type and the parameter

**Steps:**

1. Open `packages/viewer/src/visibility.ts`. It is ~27 lines; read all of it first.
2. Below the existing `FutureComponentsMode` type, add:

```ts
/** How components of steps BEFORE the active one are rendered. */
export type InstalledComponentsMode = "solid" | "ghost" | "hidden";
```

3. Change the signature of `visualForComponent` to take a trailing, defaulted 4th
   parameter, and replace the unconditional `return "solid"` for installed
   components. The complete function body after the change:

```ts
export function visualForComponent(
  stepIndex: number | undefined,
  activeStepIndex: number,
  futureMode: FutureComponentsMode,
  installedMode: InstalledComponentsMode = "solid"
): ComponentVisual {
  if (stepIndex !== undefined) {
    if (stepIndex < activeStepIndex) {
      return installedMode === "ghost"
        ? "ghost"
        : installedMode === "hidden"
          ? "hidden"
          : "solid";
    }
    if (stepIndex === activeStepIndex) return "active";
  }
  return futureMode === "ghost"
    ? "ghost"
    : futureMode === "hidden"
      ? "hidden"
      : "solid";
}
```

4. Update the function's existing doc comment to mention that installed
   components now follow `installedMode`, which defaults to `"solid"` so
   three-argument callers are unaffected.
5. Export the new type from the package barrel: in `packages/viewer/src/index.ts`,
   find the line that exports `FutureComponentsMode` from `./visibility` and add
   `InstalledComponentsMode` to the same export.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/viewer
# Expected: exits 0, no errors. The new param is optional, so no existing
# call site needs changing yet.
```

**Out of scope:** Do not touch `AssemblyPlayer.tsx` in this task. Do not change
the `active` branch or the future-mode branch — installed mode must never affect
the active step or future components.

---

## Task 2: Extend `visibility.test.ts` for the new parameter

**Depends on:** Task 1
**Files:**
- Modify: `packages/viewer/src/visibility.test.ts` — add cases, change nothing existing
- Copy from (precedent): the same file's existing `describe`/`it` style

**Steps:**

1. Read `packages/viewer/src/visibility.test.ts` (37 lines, 6 `it` blocks).
2. **Do not modify any existing assertion.** They encode the backward-compatible
   three-argument behaviour and must keep passing untouched. If any existing test
   fails after Task 1, STOP and report — the default is wrong.
3. Append these cases inside the existing `describe("visualForComponent", ...)`:

```ts
  it("defaults installed components to solid when the 4th arg is omitted", () => {
    expect(visualForComponent(0, 2, "ghost")).toBe("solid");
    expect(visualForComponent(1, 2, "hidden")).toBe("solid");
  });

  it("renders installed components per the installed mode", () => {
    expect(visualForComponent(0, 2, "ghost", "solid")).toBe("solid");
    expect(visualForComponent(0, 2, "ghost", "ghost")).toBe("ghost");
    expect(visualForComponent(0, 2, "ghost", "hidden")).toBe("hidden");
  });

  it("never lets the installed mode affect the active step", () => {
    for (const mode of ["solid", "ghost", "hidden"] as const) {
      expect(visualForComponent(2, 2, "ghost", mode)).toBe("active");
    }
  });

  it("never lets the installed mode affect future components", () => {
    expect(visualForComponent(3, 1, "ghost", "hidden")).toBe("ghost");
    expect(visualForComponent(3, 1, "hidden", "ghost")).toBe("hidden");
    expect(visualForComponent(3, 1, "solid", "hidden")).toBe("solid");
  });

  it("never lets the installed mode affect never-installed components", () => {
    for (const mode of ["solid", "ghost", "hidden"] as const) {
      expect(visualForComponent(undefined, 5, "hidden", mode)).toBe("hidden");
      expect(visualForComponent(undefined, 5, "ghost", mode)).toBe("ghost");
    }
  });
```

4. Add the `InstalledComponentsMode` import if your assertions need it (they use
   `as const` literals, so an import is likely unnecessary — do not add an unused one).

**Verify:**
```bash
pnpm --filter @carbon/viewer test -- visibility
# Expected: all tests pass, including the 6 pre-existing ones, unmodified.
```

**Out of scope:** Do not change `graph.test.ts` — its `describeStep` tests are
unrelated to visibility.

---

## Task 3: Thread `installedMode` through `AssemblyPlayer` state and scene props

**Depends on:** Task 1
**Files:**
- Modify: `packages/viewer/src/AssemblyPlayer.tsx`
- Copy from (precedent): the existing `futureMode` plumbing in the same file —
  every change below mirrors it exactly

**Steps:**

Work through these in order. Each references the current line number, which will
drift as you edit — locate by the quoted code, not the number.

1. **Import the type.** Find the existing import of `FutureComponentsMode` from
   `./visibility` and add `InstalledComponentsMode` alongside it.

2. **Add the prop** (~line 112, next to `defaultFutureMode?: FutureComponentsMode;`):

```ts
  /**
   * Initial state of the installed-components control. Defaults to "solid" —
   * the historical behaviour, where everything already built renders opaque.
   */
  defaultInstalledMode?: InstalledComponentsMode;
```

3. **Destructure with the default** (~line 190, where `defaultFutureMode = "hidden"`
   is destructured): add `defaultInstalledMode = "solid",`.
   **The default MUST be `"solid"`** — it preserves existing behaviour for every
   current user. If you find yourself writing `"ghost"` here, re-read the spec.

4. **Add the state** (~line 219, next to the `futureMode` `useState`):

```ts
  const [installedMode, setInstalledMode] =
    useState<InstalledComponentsMode>(defaultInstalledMode);
```

5. **Pass to the scene** (~line 491, the JSX block where `futureMode={futureMode}`
   is passed): add `installedMode={installedMode}` directly beneath it.

6. **Add to the scene's props type** (~line 856, where
   `futureMode: FutureComponentsMode;` is declared): add
   `installedMode: InstalledComponentsMode;`.

7. **Destructure it in the scene component** (~line 825, the parameter
   destructuring that includes `futureMode,`): add `installedMode,`.

8. **Add the picker-mode guard and use it.** Immediately after the existing
   `effectiveFutureMode` declaration (~line 1099), add:

```ts
    // A hidden component cannot be clicked, so component-picker mode forces the
    // installed side back to solid — the mirror of the future side's ghost
    // override above. Both stay pickable, and the two remain distinguishable.
    const effectiveInstalledMode: InstalledComponentsMode = componentPickerActive
      ? "solid"
      : installedMode;
```

9. **Pass it into the call** (~line 1101, the `visualForComponent(...)` call): add
   `effectiveInstalledMode` as the 4th argument, after `effectiveFutureMode`.

10. **Add to the effect's dependency array** (~line 1221, the array containing
    `futureMode,`): add `installedMode,`. Without this the scene will not
    re-render when the operator changes the control.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/viewer
# Expected: exits 0. A "declared but never read" error on setInstalledMode is
# EXPECTED at this point — Task 5 adds the buttons that call it. Any OTHER
# error means a step above was missed.
```

**Out of scope:** Do not add the toolbar buttons yet (Task 5). Do not touch the
camera-framing code (Task 4). Do not change `defaultFutureMode` or any existing
`futureMode` behaviour.

**If** `installedMode` cannot be threaded because the scene component's props are
built differently than described, STOP and report — do not improvise a context or
a module-level variable.

---

## Task 4: Make camera auto-framing respect `installedMode`

> **Superseded during execution — read this before the steps below.** The steps
> specify an *inline* edit to the occluder loop. That is not what shipped. The
> inline version duplicated `visualForComponent`'s reasoning about where a
> component sits relative to the active step, so the logic was extracted into an
> exported `occluderWeight()` helper in `visibility.ts` (returning `null` for
> "not an occluder", else the weight; `GHOST_OCCLUDER_WEIGHT = 0.3`), and the
> loop now calls it.
>
> Extracting it exposed a **pre-existing bug**: the inline `isFuture` required
> `stepIndex !== undefined`, so a component no step installs kept full occluder
> weight even though `visualForComponent` renders it hidden under the MES
> default. The camera framed around invisible geometry. Fixed, and locked down
> by a cross-product invariant test ("anything invisible is never an occluder").
>
> The steps below are kept as the original plan of record. See the spec's
> "Incidental fix" section for what actually shipped.

**Depends on:** Task 3
**Files:**
- Modify: `packages/viewer/src/AssemblyPlayer.tsx` — the AABB fallback occluder loop
- Modify (as shipped): `packages/viewer/src/visibility.ts` — new `occluderWeight`
  helper + `GHOST_OCCLUDER_WEIGHT`

**Why:** The live AABB framing fallback picks a view direction by scoring which
components block the line of sight. It already skips future components when
`futureMode === "hidden"` and half-weights them when `"ghost"`, but installed
components are unconditionally weighted `1`. Without the symmetric treatment,
"Hide installed components" would remove the parts visually while the camera still
framed around them — the control would visibly half-work. This also follows the
"occlusion-aware angles" rule in `.ai/lessons.md`.

**Steps:**

1. Find the occluder loop (~lines 1758–1769). It currently reads:

```ts
      for (const leaf of leafBounds ?? []) {
        if (stepComponents.has(leaf.nodeId)) continue;
        if (hiddenSet.has(leaf.nodeId)) continue;
        const leafStep = stepIndexByNode.get(leaf.nodeId);
        const isFuture = leafStep !== undefined && leafStep > activeStepIndex;
        if (isFuture && futureMode === "hidden") continue;
        occluders.push({
          min: new Vector3(...(leaf.bbox.min as [number, number, number])),
          max: new Vector3(...(leaf.bbox.max as [number, number, number])),
          weight: isFuture && futureMode === "ghost" ? 0.3 : 1
        });
      }
```

2. Replace it with the version below. Note `isInstalled` is computed the same way
   `visualForComponent` decides (`leafStep < activeStepIndex`), so the two stay
   consistent:

```ts
      for (const leaf of leafBounds ?? []) {
        if (stepComponents.has(leaf.nodeId)) continue;
        if (hiddenSet.has(leaf.nodeId)) continue;
        const leafStep = stepIndexByNode.get(leaf.nodeId);
        const isFuture = leafStep !== undefined && leafStep > activeStepIndex;
        const isInstalled = leafStep !== undefined && leafStep < activeStepIndex;
        // An occluder the operator has hidden must not push the camera around,
        // and a ghosted one should barely count — mirrored on both axes.
        if (isFuture && futureMode === "hidden") continue;
        if (isInstalled && installedMode === "hidden") continue;
        const isGhosted =
          (isFuture && futureMode === "ghost") ||
          (isInstalled && installedMode === "ghost");
        occluders.push({
          min: new Vector3(...(leaf.bbox.min as [number, number, number])),
          max: new Vector3(...(leaf.bbox.max as [number, number, number])),
          weight: isGhosted ? 0.3 : 1
        });
      }
```

3. **Add `installedMode` to the framing key** (~line 1663). It is a `.join("|")`
   string, not a dependency array. Find the entry `futureMode,` inside that array
   literal and add `installedMode,` after it. Without this, the framing is cached
   against a stale key and will not recompute when the mode changes.

4. **Add `installedMode` to the framing effect's dependency array** (~line 1883,
   the array ending `futureMode, cameraMode`): add `installedMode,`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/viewer
# Expected: exits 0 (the setInstalledMode unused warning from Task 3 may persist
# until Task 5).
```

**Out of scope:** Do not change the planner-baked-direction branch (the `if` side
of this `else`). Steps carrying a baked view direction do not use AABB scoring and
must keep their planner-chosen angle. Do not change the `0.3` ghost weight value.

---

## Task 5: Add the toolbar control group

**Depends on:** Task 3
**Files:**
- Modify: `packages/viewer/src/AssemblyPlayer.tsx` — toolbar JSX
- Copy from (precedent): the existing future-components group in the same file
  (~lines 668–692) — same `ControlButton`, same icons, same active pattern

**Steps:**

1. Find the existing group, which is wrapped in
   `<div className="flex items-center rounded-md border border-border">` and holds
   three `ControlButton`s writing `setFutureMode`.
2. Immediately **after** that closing `</div>`, add a second group with the same
   wrapper class. Order the buttons solid → ghost → hidden (least to most hiding),
   and reuse the existing `SolidIcon`, `GhostIcon`, `HiddenIcon` components:

```tsx
        <div className="flex items-center rounded-md border border-border">
          <ControlButton
            aria-label="Show installed components solid"
            aria-pressed={installedMode === "solid"}
            isActive={installedMode === "solid"}
            onClick={() => setInstalledMode("solid")}
          >
            <SolidIcon />
          </ControlButton>
          <ControlButton
            aria-label="Show installed components ghosted"
            aria-pressed={installedMode === "ghost"}
            isActive={installedMode === "ghost"}
            onClick={() => setInstalledMode("ghost")}
          >
            <GhostIcon />
          </ControlButton>
          <ControlButton
            aria-label="Hide installed components"
            aria-pressed={installedMode === "hidden"}
            isActive={installedMode === "hidden"}
            onClick={() => setInstalledMode("hidden")}
          >
            <HiddenIcon />
          </ControlButton>
        </div>
```

3. Add a brief comment above the new group explaining that the two groups are the
   future and installed halves of the same timeline, so a future reader does not
   mistake them for duplicates.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/viewer
# Expected: exits 0 with NO unused-variable error — setInstalledMode is now used.
```

**Out of scope:** Do not add Lingui macros — this package is i18n-free by
decision (spec Design Decisions). Do not create new icon components; reuse the
three that exist. Do not restyle or reorder the existing future-components group.

---

## Task 6: Typecheck + full viewer test run

**Depends on:** Tasks 1–5
**Files:** none (verification only)

**Steps:**

1. Run the viewer's full test suite and typecheck.
2. If anything fails, fix it before proceeding. A failure in a **pre-existing**
   `visibility.test.ts` assertion means the default is not `"solid"` — recheck
   Task 1 step 3 and Task 3 step 3.
3. Also typecheck the two consuming apps, since the package's exported signature
   changed (additively — these should pass without any app edits).

**Verify:**
```bash
pnpm --filter @carbon/viewer test
# Expected: all suites pass, including camera, fallback, graph, motion, plan,
# visibility. No skipped or failing tests.

pnpm exec turbo run typecheck --filter=@carbon/viewer --filter=mes --filter=erp
# Expected: exits 0 for all three.
```

**Out of scope:** Do not run a whole-repo `pnpm typecheck` — it OOMs.

---

## Task 7: Browser verification in ERP and MES

**Depends on:** Task 6
**Files:** none (verification only)

**Prerequisite:** the local dev stack must be running and serving
`erp.main.dev` / `mes.main.dev`. If it is not, start it (`crbn up`) or report that
verification is blocked — do not mark this task done without running it.

**Steps:**

Use the `/test` skill (or `agent-browser` directly via the `/auth` skill for the
session). Verify each of these and capture a screenshot for the ones marked 📸:

1. **ERP, no-change baseline.** Open
   `http://erp.main.dev/x/assembly/dahpsbnng0ghg1nrqup0`, click step 7 ("Fit the
   cylinder heads and set valve clearance"). With no interaction, all installed
   parts must render solid exactly as before this change. 📸
2. **ERP, ghost.** Click "Show installed components ghosted". The five cylinder
   barrels installed at steps 5–6 must become translucent and the five step-7
   cylinder heads must become clearly visible. 📸
3. **ERP, hidden.** Click "Hide installed components". The barrels must disappear
   entirely, leaving the heads unobstructed. 📸
4. **Two groups present and distinct.** Confirm via an accessibility snapshot that
   six visibility buttons now exist, three labelled "…future components…" and
   three labelled "…installed components…".
5. **MES, control present + state survives navigation.** Open
   `https://mes.main.dev/x/assembly/jo_4f8Tfqsy7WbQzVoAC9TzMo`, go to display step
   12, open the 3D view. Select "Show installed components ghosted", navigate to
   step 13 and back to 12, and confirm the ghost selection is still active (the
   player does not remount, so it must persist). 📸
6. **Toolbar fits.** At the MES panel's real width, confirm both groups are
   visible and not clipped or overlapping the transport controls.
7. **Camera framing.** On a step using the live AABB fallback, confirm that with
   "Hide installed components" the camera frames the active parts without treating
   the hidden geometry as an occluder (the view should be no more obstructed than
   with the mode off).

**Verify:**
```bash
# Manual/agentic verification. Record the outcome of each of the 7 checks above
# with its screenshot path. Every check must pass.
```

**Out of scope:** Do not author `assemblyUnit` rows or test sub-assembly naming —
F2a is explicitly out of scope for this work (see spec §Non-goals). Do not commit
without the user's explicit permission.
