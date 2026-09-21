# Installed-component visibility in the assembly viewer

> Status: approved / implemented (branch `feat/hide-installed-parts`, PR #1660; move to implemented/ after merge)
> Author: Aashu
> Date: 2026-09-17

## TLDR

The assembly viewer can ghost or hide components belonging to *future* steps, but
components from *already-completed* steps are hard-coded solid and no control can
change that. Deep into a build the parts an operator is being told to fit are
visually buried inside everything installed before them. This spec adds
`installedMode` — a `solid | ghost | hidden` sibling to the existing `futureMode`
— surfaced as a named-view toolbar control and wired into both the ERP and MES
players. Default stays `solid`, so nothing changes until an operator opts in.

## Problem Statement

`visualForComponent` (`packages/viewer/src/visibility.ts`) resolves a component's
visual from its step index:

```ts
if (stepIndex !== undefined) {
  if (stepIndex < activeStepIndex) return "solid";   // ← unconditional
  if (stepIndex === activeStepIndex) return "active";
}
return futureMode === "ghost" ? "ghost" : futureMode === "hidden" ? "hidden" : "solid";
```

An installed component (`stepIndex < activeStepIndex`) returns `"solid"` with no
path to any other value. The three toolbar buttons in `AssemblyPlayer.tsx`
(~lines 669–692) all write `futureMode`, and their labels say so explicitly:
"Show future components ghosted", "Hide future components", "Show all components
solid". There is no installed-side equivalent.

**Concrete repro** (live, local): ERP instruction `dahpsbnng0ghg1nrqup0` ("Radial
Engine — Build Sequence"), step 7 "Fit the cylinder heads and set valve
clearance". Five cylinder barrels are installed at steps 5–6 and form a solid
star; step 7's five heads seat on their tips. With every component solid the
heads are almost entirely occluded by the barrels — the operator cannot see the
parts the instruction is naming. The same instruction is synced onto MES job
J000001, operation `jo_4f8Tfqsy7WbQzVoAC9TzMo` (display step 12).

The effect worsens monotonically with build depth: the further into an assembly,
the more geometry stands between the camera and the active part — exactly when
the instruction is hardest to read.

MES compounds this by passing neither `hiddenNodeIds` nor `focusedNodeIds`
(`apps/mes/app/components/AssemblyView.tsx` lines 1978–1991), so the two escape
hatches ERP has are unavailable on the shop floor.

## Proposed Solution

Add a fourth parameter to `visualForComponent`, and a toolbar control over it.
(The control shipped as four named views, not the second icon group described
below — see UI Changes and the changelog.)

### 1. `packages/viewer/src/visibility.ts`

```ts
/** How components of steps BEFORE the active one are rendered. */
export type InstalledComponentsMode = "solid" | "ghost" | "hidden";

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

The parameter is trailing and defaults to `"solid"`, so the existing 3-argument
call in `graph.test.ts`/`visibility.test.ts` and any other caller keeps its
current behaviour verbatim.

`InstalledComponentsMode` is declared as its own type rather than reusing
`FutureComponentsMode`: the two are independent axes, and a future change to one
should not silently widen the other. Both are structurally `"ghost" | "hidden" |
"solid"` today.

### 2. `packages/viewer/src/AssemblyPlayer.tsx`

- New optional prop `defaultInstalledMode?: InstalledComponentsMode`, defaulting
  to `"solid"` (mirrors `defaultFutureMode`, which defaults to `"hidden"`).
- New state `const [installedMode, setInstalledMode] = useState(defaultInstalledMode)`
  — plain `useState`, exactly like `futureMode`. No persistence.
- Pass `installedMode` through to the scene component alongside `futureMode`
  (same path as line 491; the scene's props type at ~line 856 gains the field),
  and into the `visualForComponent` call (~line 1101).
- Add `installedMode` to the dependency arrays of the effects that currently
  list `futureMode` (~lines 1221, 1663, 1883) — otherwise the scene will not
  re-render when the operator changes the mode. `futureMode` appears in three
  such arrays; each must be checked, since they drive different effects
  (visual application, ghost-weighted framing, and playback).
- ~~Second `ControlButton` group beside the existing one, three buttons writing
  `installedMode`.~~ **Superseded:** both axes are driven by a single named-view
  control instead, so `AssemblyPlayer` holds one `view` state and derives the two
  modes from `VIEW_MODES`. See UI Changes.

**Camera auto-framing must respect the new mode.** The AABB fallback occluder
scoring decides which view direction sees the active step with the least in the
way. It skipped future components entirely when `futureMode === "hidden"` and
half-weighted them (`0.3`) when `"ghost"`, but installed components were
unconditionally weighted `1`. Left unchanged, an operator selecting "Hide
installed components" would see the parts disappear while the camera still framed
around geometry that is no longer drawn — the control would visibly half-work.

Rather than bolt a second pair of conditionals onto the inline loop, the scoring
moves into an exported `occluderWeight(stepIndex, activeStepIndex, futureMode,
installedMode)` helper in `visibility.ts`, beside `visualForComponent`. It returns
`null` for "not an occluder at all" and otherwise the weight
(`GHOST_OCCLUDER_WEIGHT = 0.3` for a ghosted part, `1` for a solid one). The two
functions now answer the same question — where does this component sit relative to
the active step — from one place, and the test suite asserts the invariant that
links them: **anything `visualForComponent` renders `"hidden"`, `occluderWeight`
must score `null`**, across every mode combination.

This applies only to the live AABB fallback branch. Steps carrying a planner-baked
view direction take the other branch and are unaffected.

### Incidental fix: never-installed components were phantom occluders

Extracting the helper surfaced a **pre-existing bug**, fixed here. The inline code
computed `isFuture = stepIndex !== undefined && stepIndex > activeStepIndex`, so a
component that **no step installs** (`stepIndex === undefined`) failed the test and
kept full occluder weight — even though `visualForComponent` renders exactly those
components per the *future* mode, i.e. **hidden** under the MES default
`futureMode: "hidden"`. The camera was framing around invisible geometry.

`occluderWeight` uses `stepIndex === undefined || stepIndex > activeStepIndex`,
matching `visualForComponent`'s documented contract that such a component "is
treated exactly like a future-step component — it is never already there".

**This changes existing behaviour at default settings**, independently of
`installedMode`: any step that uses the live AABB fallback (no planner-baked view
direction) and has unassigned geometry may now pick a different, less obstructed
view angle. That is the intended correction, but it is not a no-op and reviewers
should know it ships in this change.

**Component-picker interaction.** `effectiveFutureMode` currently forces
`"ghost"` while `componentPickerActive`, so not-yet-installed parts stay visible
and clickable. The installed side needs the mirror-image guard: picker mode must
force `installedMode` to a *pickable* value, because a hidden component cannot be
clicked. Define `effectiveInstalledMode = componentPickerActive ? "solid" : installedMode`
— picker mode already ghosts the future side, so leaving the installed side solid
keeps the two visually distinguishable while both remain pickable.

### 3. Call sites

- **MES** (`apps/mes/app/components/AssemblyView.tsx` ~1978): no new prop needed
  — the default `"solid"` preserves today's rendering and the operator gets the
  toolbar control for free. (`hiddenNodeIds` remains unpassed; wiring it is not
  in scope — see Non-goals.)
- **ERP** (`apps/erp/app/routes/x+/assembly+/$id.tsx` ~598): unchanged; it keeps
  passing `hiddenNodeIds` and inherits the new control.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default installed mode | `"solid"` | Preserves today's behaviour exactly; no existing ERP or MES user sees a different scene after deploy. The fix is one click away when a part is actually buried. (User-resolved, Q1.) |
| Where the choice lives | Component `useState`, no persistence | Mirrors `futureMode` precisely, keeping the two sibling controls symmetrical and adding no storage surface. Verified the MES player does **not** remount per step (no `key` prop, nothing resets the state), so the choice survives step navigation for the whole session — the case that actually matters. (User-resolved, Q2.) |
| i18n of the new labels | Plain English `aria-label`s, exception documented | `@carbon/viewer` has zero `@lingui` imports and no lingui dependency; `packages/viewer/AGENTS.md` requires pure modules stay free of `@carbon/react` router/i18n peers. The six existing toolbar labels are already untranslated English — translating only the new three would produce a half-localized toolbar. Localizing the whole viewer is a separate ticket. (User-resolved, Q3.) |
| API shape | Trailing 4th param with a default | Keeps every existing 3-arg call and all six existing `visibility.test.ts` assertions passing unchanged; no call-site churn. |
| Type reuse | New `InstalledComponentsMode` type | Independent axis from `futureMode`; separate types stop a future change to one from silently widening the other. |
| Picker-mode guard | Force `"solid"` when `componentPickerActive` | A hidden component cannot be clicked (three.js raycasting skips `visible === false`). Mirrors the existing `effectiveFutureMode` ghost-forcing guard, which exists for the same reason. Note `componentPickerActive` is set only by ERP authoring (`isAddingComponents`, `x+/assembly+/$id.tsx`) and never by MES, so the guard cannot interfere with the shop-floor case this feature targets. |
| Occluder scoring | Extracted `occluderWeight` helper rather than inline conditionals | The inline loop and `visualForComponent` were answering the same question in two places and had already drifted (see the incidental fix above). One exported predicate plus a cross-product invariant test is what makes the drift impossible to reintroduce silently. |
| Toolbar overflow | `flex-wrap` on the toolbar row | The row had no wrap and already carried transport controls, a scrubber and two timestamps; the visibility control pushes it past the width of the MES centre column. Wrapping to a second line beats a clipped control. Kept after the named-views redesign — four labelled segments are still wider than one icon triplet. |
| Exposing the two axes | Three named views (`build` / `focus` / `full`), same in ERP and MES | The axes are the renderer's model, not the user's: nine combinations, most meaningless, asked through two identical icon triplets. A named view answers the operator's actual question directly and needs no glyph decoded. Costs reachability — an unnamed combination can no longer be built — accepted because the axes survive underneath, so finer control is a toolbar change away. Supersedes the "Next"/"Built" label row and the MES-only Focus toggle, both rejected on sight. |
| Heuristics 1–7 | N/A | No new table, service function, route, form, or module; nothing touches multi-tenancy, RLS, permissions, or a FROZEN/STABLE surface. This is a pure view-layer change inside one package plus its two consumers. |

## Data Model Changes

N/A — no tables, columns, or migrations. The feature is entirely client-side
render state; nothing is persisted (see Design Decisions, "Where the choice
lives").

## API / Service Changes

N/A — no service functions, loaders, or actions change. Two changes to
`@carbon/viewer`'s exported surface, neither a server-side or cross-service
contract:

- `visualForComponent` gains an optional trailing 4th parameter, so the exported
  signature stays backward-compatible and no call site needed touching.
- `occluderWeight` and `GHOST_OCCLUDER_WEIGHT` are new exports from
  `visibility.ts`. They are additive; nothing consumed the inline logic before
  because it had none.

Note: `visibility.ts` is imported by `AssemblyPlayer.tsx` (a three.js module), not
by `@carbon/viewer/steps`, so the three-free server import path is untouched.

## UI Changes

**Superseded — see changelog. The two-axis toolbar below was built, rejected on
sight, and replaced by named views.** The axes remain exactly as specified in the
sections above; only the control changed.

The toolbar exposes **four named views**, not the two axes. `ASSEMBLY_VIEWS` and
`VIEW_MODES` (`visibility.ts`) map each view to its axis pair; the UI never sets
an axis directly:

| Button | `aria-label` | Installed | Future | Answers |
|--------|--------------|-----------|--------|---------|
| `Build` | `Show the assembly as built so far, hiding later components` | `solid` | `hidden` | What is on my bench right now |
| `Focus` | `Focus this step by fading the already-installed components to see-through` | `ghost` | `hidden` | My part, and where it mounts |
| `Isolate` | `Show only this step's components, hiding everything else` | `hidden` | `hidden` | **Just my part, nothing else** |
| `Full`  | `Show every component solid` | `solid` | `solid` | The finished product |

They are ordered by how much context they strip. The future side is `hidden` in
all but `Full`: Build/Focus/Isolate are all "I am working this step" views, and a
part that is not on the bench yet only adds clutter. `Focus` and `Isolate` differ
in exactly one axis — the ghosted shell of what is already fitted is the whole
distinction, and a test pins it so neither becomes a duplicate of the other.

One segmented group, no icons, in **both ERP and MES** — the same control for both
audiences. `Build` is the historical rendering, so the default is a no-op.
Visible labels are single words to fit the MES centre column; the `aria-label`
carries the fuller description, since "Build" alone does not say what changes.
`VIEW_LABELS` in `AssemblyPlayer.tsx` holds both.

Four of the nine axis combinations are reachable. The five that are not are
future-side variations (`ghost`, or `solid` alongside a non-solid installed
side), none of which answers a question an operator or an author was observed to
ask. Adding one later is a row in `VIEW_MODES`, not a rendering change.

`viewForModes` seats the initial view from the still-axis-shaped `default*Mode`
props (neither call site overrides them today), falling back to `"build"` for a
pair no view names rather than widening the type with an unselectable `"custom"`.

### Why not the axes

Two visually identical icon triplets side by side read as one duplicated control,
and the underlying model — nine combinations, most meaningless — is not something
an operator should have to learn to ask "what am I fitting right now?". A
preceding-label variant ("Next" / "Built") and an audience split (one Focus toggle
in MES, the raw axis in ERP) were both tried and rejected: the first still
required decoding the glyphs, the second made the two screens disagree about what
the toolbar means. Named views cost some reachability — an author can no longer
build a combination we did not name — which was accepted as the price of a
control that reads at a glance. The renderer keeps both axes, so restoring finer
control later is a toolbar change only.

## Acceptance Criteria

Automated — **verified**, `pnpm --filter @carbon/viewer test` (120 passing):

- [x] `visualForComponent(0, 2, "ghost")` returns `"solid"` when called with three
      arguments (existing behaviour preserved; all six original
      `visibility.test.ts` assertions pass unmodified).
- [x] `visualForComponent(0, 2, "ghost", "ghost")` returns `"ghost"` and
      `visualForComponent(0, 2, "ghost", "hidden")` returns `"hidden"`.
- [x] `visualForComponent(2, 2, "ghost", "hidden")` returns `"active"` — the
      active step is never affected by `installedMode`.
- [x] `visualForComponent(3, 1, "ghost", "hidden")` returns `"ghost"` — future
      components are never affected by `installedMode`.
- [x] `visualForComponent(undefined, 5, "hidden", "solid")` returns `"hidden"` —
      a never-installed component is still treated as future, not installed.
- [x] `occluderWeight` returns `null` exactly when `visualForComponent` returns
      `"hidden"`, across every (stepIndex × futureMode × installedMode)
      combination — the invariant that keeps the two from drifting.
- [x] `occluderWeight(undefined, 3, "hidden", "solid")` returns `null` — the
      incidental fix; a never-installed component is no longer a phantom
      occluder while rendering hidden.
- [x] `pnpm --filter @carbon/viewer test`, `pnpm --filter @carbon/viewer
      typecheck`, `pnpm --filter mes typecheck`, `pnpm --filter erp typecheck`
      and `biome check` on the changed files all pass.

Browser — **NOT verified** (the local `main.dev` dev stack was not running and an
ad-hoc server could not complete the dev login; see Risks). These remain open and
must be walked before merge:

- [ ] Opening ERP instruction `dahpsbnng0ghg1nrqup0` at step 7 with no
      interaction renders identically to before this change (all installed parts
      solid).
- [ ] On that same view, clicking "Show installed components ghosted" makes the
      five cylinder barrels translucent and the five red cylinder heads clearly
      visible; clicking "Hide installed components" removes the barrels entirely
      and leaves the heads unobstructed.
- [ ] On MES `jo_4f8Tfqsy7WbQzVoAC9TzMo` at display step 12, the new control
      group is present, and a ghost selection persists when navigating to step 13
      and back (player does not remount).
- [ ] The toolbar fits the MES centre column — with `flex-wrap` it may occupy two
      rows; confirm nothing is clipped and the second row looks deliberate.
- [ ] With component-picker mode active (ERP "Add components"), installed
      components remain clickable regardless of the `installedMode` selected
      before entering picker mode.
- [ ] On a step using the live AABB framing fallback (no planner-baked view
      direction), selecting "Hide installed components" makes the camera frame
      the active parts without treating the hidden geometry as an occluder —
      i.e. the chosen view is at least as unobstructed as with the mode off.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Nothing has been verified in a browser** | **High** | Every browser acceptance criterion is still open. The automated suite covers the visibility/occlusion logic thoroughly, but no one has seen the toolbar render, and the two risks below it are exactly the kind only eyes catch. Must be walked before merge. |
| Toolbar crowding — three labelled segments plus transport controls on a narrow MES panel | Med | Down from six buttons to three after the redesign, but words are wider than glyphs, so the risk stands. `flex-wrap` on the toolbar row means it wraps to a second line instead of clipping. (An earlier draft of this spec claimed the row already wrapped — it did not; `flex items-center gap-2` with no wrap.) Still needs a visual check at the MES panel's real width; `Build`/`Focus`/`Full` were chosen partly for being short. |
| Operators confuse the two visually-identical icon groups | Med | Each group now carries an `aria-hidden` text label ("Next" / "Built") alongside the distinct `aria-label`s and separate bordered containers. Whether that reads clearly on the floor is a browser check. |
| A hidden installed component becomes unclickable in component-picker mode | Low | `effectiveInstalledMode` forces `"solid"` while `componentPickerActive`, mirroring the existing `effectiveFutureMode` guard. Downgraded from Med: `componentPickerActive` is ERP-authoring-only and never set by MES. |
| Ghost-on-ghost renders poorly when both modes are `"ghost"` (transparent-sorting artifacts) | Low | `applyVisual` already sets `renderOrder = 1` on ghosts specifically to limit sorting artifacts; the existing ghost path is reused unchanged. Verify visually during manual testing. |
| The incidental occluder fix changes framing at default settings | Low | Intended correction (see "Incidental fix" above), but it is a real behaviour change independent of `installedMode` and is called out in the PR body rather than buried. Affects only fallback-framed steps with unassigned geometry. |
| Default silently changes for someone relying on current rendering | Low | Default is `"solid"` = today's exact behaviour for the new axis; the first browser criterion asserts no-interaction parity. |

## Non-goals

- **Sub-assembly unit plumbing (F2a).** Investigated and found already built:
  `apps/erp/app/modules/production/production.service.ts` (~8870–8895) resolves
  `assemblyUnit` names through `describeStep(..., namedUnits)` and persists the
  result as the step `title`; MES renders `step.name` from the DB
  (`AssemblyView.tsx:2165`). A unit-named step already displays correctly in MES.
  The flat-parts-list symptom is purely that **0 `assemblyUnit` rows exist** —
  an authoring/data gap, not a code gap. Dropped from this work by the user.
- **Nested instruction references (F2b)** — requires a new instruction→instruction
  schema edge and a decision on how a nested build reports completion to its
  parent. Out of scope.
- **Wiring `hiddenNodeIds` into MES.** The generic mode covers the stated problem;
  per-part hiding needs its own UI (a part list with visibility toggles) and is
  not required to unbury the active step.
- **Localizing the viewer toolbar.** See Design Decisions; the whole package is
  currently i18n-free and localizing it is its own ticket.
- **Persisting the operator's choice** across reloads or per work-center.

## Research

N/A — this is an internal rendering/UI change with no ERP-domain logic (no
accounting, costing, tax, inventory, or planning semantics). Competitor research
would not inform the design. The relevant prior art is in-repo: the existing
`futureMode` control, which this deliberately mirrors.

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [x] **What should the default installed-part mode be?** — **Answer:** `"solid"`,
      preserving today's behaviour exactly. Considered `"ghost"` everywhere (fixes
      the problem out of the box but changes the look of every existing assembly
      view and may read as "unbuilt") and `"solid"` in ERP / `"ghost"` in MES
      (matches where the problem bites, at the cost of two defaults to reason
      about). Chose no-behaviour-change: the burying problem is step-specific and
      one click away, while a changed default would surprise every operator on
      deploy.
- [x] **Should the operator's choice persist beyond the current view?** —
      **Answer:** component `useState` only, mirroring `futureMode`. Verified
      first that the MES player does **not** remount per step (no `key` prop on
      the `AssemblyPlayer`/`ClientOnly`, and nothing resets `futureMode`), so the
      choice already survives step navigation — the scenario that actually
      matters on the floor. `localStorage` persistence was considered and rejected
      as unnecessary surface that would also make the two sibling toggles behave
      inconsistently.
- [x] **How do we satisfy the Lingui rule inside an i18n-free package?** —
      **Answer:** plain English `aria-label`s, exception documented here.
      Verified `@carbon/viewer` has zero `@lingui` imports and no lingui
      dependency, and `packages/viewer/AGENTS.md` requires pure modules stay free
      of `@carbon/react` router/i18n peers (`ModelPreview.tsx` is the sole
      exception). The six existing toolbar labels are already untranslated
      English, so translating only the new three would yield a half-localized
      toolbar. Passing labels in as props from each app was considered (upholds
      the rule without crossing the boundary) but rejected as prop-surface churn
      for screen-reader-only strings; adding Lingui to the viewer crosses an
      explicit Ask-First boundary and is much larger than this feature.

## Changelog

- 2026-09-17: Created. Three open questions resolved with the user before
  writing. F2a (sub-assembly unit plumbing) investigated and dropped — found
  already implemented; the observed symptom is missing data, not missing code.
- 2026-09-17: Implemented, then revised after a strict self-review. Changes from
  the as-designed spec:
  - Occluder scoring was **extracted into `occluderWeight`** rather than added
    inline as originally specced, after the inline version was found to duplicate
    `visualForComponent`'s reasoning.
  - Doing so surfaced a **pre-existing bug** (never-installed components were
    phantom occluders while rendering hidden). Fixed here; documented as its own
    subsection because it changes framing at default settings.
  - Added `flex-wrap` to the toolbar row. The original Risks table wrongly stated
    the row already wrapped; it did not.
  - Added "Next" / "Built" labels to distinguish the two identical icon triplets.
  - Acceptance criteria split into verified (automated) and **not verified**
    (browser). Browser verification remains outstanding.
- 2026-09-17: **Toolbar redesigned — named views.** The user rejected the
  six-button two-group toolbar on sight ("wont work with 6 diff things right
  upfront to the user with similar icons"). Two replacements were tried and
  discarded before the third landed:
  1. "Next"/"Built" labels above the triplets — still six similar glyphs.
  2. An audience split: one Focus toggle in MES (`readOnly`), the raw future
     axis in ERP. Rejected because it made the two screens disagree about what
     the toolbar means, for no gain — neither call site overrides
     `defaultFutureMode`, so the ERP triplet was moving an axis nobody set.
  3. Three named views — `Build` / `Focus` / `Full` — chosen from four variants
     mocked up in `local-docs/viewer-visibility-variants.html`. **Rejected on
     use:** the user asked "if am on a part (step 5) how can I just see that
     part?" and there was no answer. `focus` ghosted everything, so on a
     15-step assembly the active part still sat under fourteen steps of
     translucent geometry. The design had no state for "this part alone", and
     four of the six axis states were unreachable.
  4. **Shipped:** four named views — `Build` / `Focus` / `Isolate` / `Full`,
     chosen by the user from a second round of variants in the same doc, which
     was rewritten to score each design on which of the six axis states it can
     actually reach. `Isolate` (both sides hidden) is the state the three-view
     design was missing. `focus` was also corrected: it hid the future side
     rather than ghosting it, since a part not yet on the bench is clutter
     during a working view. Identical in ERP and MES.

  `ASSEMBLY_VIEWS`, `VIEW_MODES` and `viewForModes` were added to
  `visibility.ts` — the view table lives beside the axes it derives from, so
  the mapping is unit-testable without rendering. `VIEW_LABELS` (button text +
  `aria-label`) stays in `AssemblyPlayer.tsx` as presentation. `FocusIcon`,
  `GhostIcon`, `HiddenIcon` and `SolidIcon` were deleted — the named views use
  no icons and nothing else referenced them.

  The two axes, `occluderWeight`, the picker guard and every existing test are
  untouched: a view is purely a derived pair. 14 tests added (120 total,
  passing), covering the table's completeness, distinctness, the `build`
  no-op-default invariant, the `viewForModes` round-trip and its fallback.
  Browser verification is **still outstanding**.
