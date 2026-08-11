# Workflow builder round 6 — edge delete, canvas overlay, centred ports, architecture pass

**Spec / source:** user description (round 6), plus `.ai/research/2026-08-03-builder-architecture-audit.md`
**Branch:** `feat/automation`
**Decisions taken by the user (2026-08-03):**
- Success/Failure handles → **pair straddling the card's vertical midline**, floating on the
  right edge, independent of form height.
- Architecture pass scope → **correctness + perf only**: audit findings 1, 2, 4, 7.
  Findings 3, 5, 6, 8–17 are explicitly OUT of scope for this round.

## Progress

Phase A — user-visible fixes
- [x] Task 1: Two-click disconnect button at the centre of every edge
- [x] Task 2: Default the trigger schedule timezone to the user's local zone
- [x] Task 3: One composed canvas overlay — controls stacked above the minimap
- [x] Task 4: Centre Success/Failure handles on the card's vertical midline
- [x] Task 5: Correct the "Nothing happens if this fails" copy
- [x] Task 6: Verify Phase A

Phase B — architecture pass (audit findings 1, 2, 4, 7)
- [x] Task 7: Type `node.data` through the form registry (finding 1)
- [x] Task 8: `ports.ts` — one source of truth for port labels/tones/placement (finding 2)
- [x] Task 9: `selectors.ts` — scalar store subscriptions, stop the drag-frame re-render storm (finding 4)
- [x] Task 10: `useDefinition` / `useAvailableVariables` hooks (finding 7)
- [x] Task 11: Verify Phase B, add the `portsFor ≡ getNodeHandles` test, sync module AGENTS.md

## Deviations from plan

- **Condition ports use `anchor: "inline"`, but a collapsed condition still needs handles.**
  The plan had `NodeCard` render only `anchor === "card"`, which would have left a collapsed
  condition node unwireable. `NodeCard` now renders `anchor === "card" || !formVisible`, where
  `formVisible = isExpanded && !!children`. `hidePortStrip` is still gone; the rule lives in one
  commented place.
- **`conditionPathLabel` returns the kind label, not the positional one.** Returning the
  positional label made the pill and the heading render identical text and lost the
  If / Else if / Otherwise distinction. It now returns `If` / `Else if N` / `Otherwise` (used by
  the pill AND the port), with a separate exported `conditionPathIndex` for the heading — still
  one implementation of each.
- **`takenNames` stayed in `WorkflowNodeCard`** as a lazy `store.getState()` read inside the
  `isTaken` callback, rather than moving the logic into `InlineNodeName`. Same effect, one file
  fewer touched, and `InlineNodeName`'s prop contract is unchanged.
- **Success/Failure labels are `title` + `aria-label`, not visible text** (flagged in Task 4).
- **Not committed** — the user authorises commits explicitly.

## Dependencies

- Tasks 1, 2, 3, 5 are independent of each other and of everything else — may run in parallel.
- Task 4 must land before Task 8 (Task 8 moves the code Task 4 writes).
- Task 6 needs Tasks 1–5.
- Task 7 must land before Task 8 (Task 8's `portsFor` wants the narrowed node type).
- Tasks 9 and 10 are independent of 7 and 8 and of each other.
- Task 11 needs Tasks 7–10.

## Project commands (confirmed to exist in this repo)

```bash
pnpm exec turbo run typecheck --filter=erp        # the erp package is named `erp`, NOT `@carbon/erp`
pnpm exec biome check apps/erp/app/modules/workflows
cd apps/erp && npx vitest run app/modules/workflows && cd -
```

Never use `npm`. Whole-repo `typecheck` OOMs — always scope with `--filter`.

---

## Task 1: Two-click disconnect button at the centre of every edge

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/edges/WorkflowEdge.tsx` — capture
  `labelX`/`labelY`, render an `EdgeLabelRenderer` button, wire it to the store.
- Copy from (precedent): `apps/erp/app/modules/workflows/ui/Builder/nodes/WorkflowNodeCard.tsx:81-90`
  and `:147-161` — the existing two-click "arm then delete" pattern (state + 3 s auto-disarm +
  `onBlur` disarm). Mirror it exactly; do not invent a second idiom.

**Steps:**

1. Extend the import from `@xyflow/react` to include `EdgeLabelRenderer`:
   ```tsx
   import { EdgeLabelRenderer, getSmoothStepPath, useStore } from "@xyflow/react";
   ```
2. Add these imports:
   ```tsx
   import { cn, IconButton } from "@carbon/react";
   import { useLingui } from "@lingui/react/macro";
   import { useEffect, useState } from "react";
   import { LuCircleX } from "react-icons/lu";
   import { useBuilderStore } from "../context";
   ```
3. Capture the label coordinates — the current code discards them:
   ```tsx
   const [edgePath, labelX, labelY] = getSmoothStepPath({ ...unchanged });
   ```
4. Add the arm state and the store hooks inside `WorkflowEdgeImpl`:
   ```tsx
   const { t } = useLingui();
   const isReadOnly = useBuilderStore((s) => s.isReadOnly);
   const onEdgesChange = useBuilderStore((s) => s.onEdgesChange);
   const [armed, setArmed] = useState(false);

   // Two-click disconnect, same as the node delete button. Disarms itself so a
   // stray click never lingers.
   useEffect(() => {
     if (!armed) return;
     const timer = setTimeout(() => setArmed(false), 3000);
     return () => clearTimeout(timer);
   }, [armed]);
   ```
5. Wrap the existing `<path>` in a fragment and add the button after it. `EdgeLabelRenderer`'s
   container is `pointer-events: none`, so the button MUST re-enable them:
   ```tsx
   return (
     <>
       <path ...unchanged />
       {!isReadOnly && (
         <EdgeLabelRenderer>
           <div
             className="nodrag nopan pointer-events-auto absolute"
             style={{
               transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
             }}
           >
             <IconButton
               aria-label={armed ? t`Confirm disconnect` : t`Disconnect`}
               icon={<LuCircleX />}
               variant="ghost"
               size="sm"
               className={cn(
                 "rounded-full bg-card shadow-sm",
                 armed && "text-destructive hover:text-destructive"
               )}
               onClick={(e) => {
                 e.stopPropagation();
                 if (armed) onEdgesChange([{ type: "remove", id }]);
                 else setArmed(true);
               }}
               onBlur={() => setArmed(false)}
             />
           </div>
         </EdgeLabelRenderer>
       )}
     </>
   );
   ```
6. Leave `edgeTypes` and the `memo` wrapper as they are.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
```
Manual check (browser, when the user runs it): a circled X sits at the middle of every edge;
first click turns it red, second click removes the edge; clicking elsewhere reverts it to black;
no button appears on a published/read-only version.

**Out of scope:** hover-only visibility, edge selection styling, the keyboard Delete path
(`deleteKeyCode` already works and must keep working).

**If** `EdgeLabelRenderer` is not exported by the installed `@xyflow/react` (v12.10.2), STOP and
report — do not hand-roll an SVG `<foreignObject>`.

---

## Task 2: Default the trigger schedule timezone to the user's local zone

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/TriggerForm.tsx` — line 48
  and the Select at line 309.
- Copy from (precedent): `apps/erp/app/components/Form/Location.tsx:70` —
  `timezone: getLocalTimeZone()`. This is the repo-wide idiom; `TriggerForm.tsx:48` is the only
  file in the ERP app that calls `Intl.DateTimeFormat().resolvedOptions().timeZone` directly.

**Steps:**

1. Add the import:
   ```tsx
   import { getLocalTimeZone } from "@internationalized/date";
   ```
   (`@internationalized/date` is already a dependency of `apps/erp` — verified via
   `apps/erp/app/components/Form/Location.tsx`.)
2. In `defaultSchedule()` (around line 43-50) replace
   `tz: Intl.DateTimeFormat().resolvedOptions().timeZone` with `tz: getLocalTimeZone()`.
3. A trigger node saved before this change can carry `tz: ""`, which leaves the Select showing
   its placeholder. Immediately above the `<Select>` at line 309, add:
   ```tsx
   // A schedule saved before we defaulted the zone can carry an empty tz.
   const tz = schedule.tz || getLocalTimeZone();
   ```
   and change the Select to `value={tz}`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
```
```bash
grep -rn "resolvedOptions().timeZone" apps/erp/app
# Expected: no output
```

**Out of scope:** adding a timezone column to the user/employee record, switching to the shared
`Timezone` component from `@carbon/form` (it is `remix-validated-form`-bound and will not bind to
the zustand store), and changing `scheduleSchema` in `packages/workflows`.

---

## Task 3: One composed canvas overlay — controls stacked above the minimap

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/BuilderControls.tsx` — own the whole
  overlay, minimap included.
- Modify: `apps/erp/app/modules/workflows/ui/Builder/WorkflowBuilder.tsx` — drop the wrapping
  `<Panel>` and the standalone `<MiniMap>`.

**Root cause (verified):** both are React Flow `<Panel>`s anchored bottom-right with the same
`z-index: 5` and a 15 px margin from `@xyflow/react/dist/style.css`. `MiniMap` is itself a Panel
(default `position="bottom-right"`, 200×150) and is rendered *after* the controls Panel in the
DOM, so it paints on top. The `style={{ bottom: 136, right: 10 }}` on the controls Panel
(`WorkflowBuilder.tsx:141`) is a magic-number workaround that does not survive a size change.
The fix is **one** Panel containing both, with the minimap's own Panel positioning neutralised.

**Steps:**

1. In `BuilderControls.tsx`, add to the imports:
   ```tsx
   import { MiniMap, Panel, useReactFlow } from "@xyflow/react";
   ```
2. Rename the current returned element to an inner `<div>` (unchanged markup) and wrap the whole
   export in a single Panel that stacks the toolbar above the minimap:
   ```tsx
   return (
     // One Panel owns the whole bottom-right overlay. The minimap is a Panel of its
     // own by default, so `!static !m-0` drops it into this column instead.
     <Panel position="bottom-right" className="flex flex-col items-end gap-2">
       <div className="flex items-center gap-0.5 rounded-lg border bg-card p-1 shadow-sm">
         {...the seven existing IconButtons, unchanged...}
       </div>
       <MiniMap
         pannable
         zoomable
         className="!static !m-0 rounded-lg border shadow-sm"
         style={{ width: 180, height: 120 }}
       />
     </Panel>
   );
   ```
3. In `WorkflowBuilder.tsx`:
   - Remove `MiniMap` and `Panel` from the `@xyflow/react` import (keep `Background`,
     `BackgroundVariant`, `ReactFlow`, `useReactFlow`).
   - Replace lines 141-147 (the `<Panel>` wrapper, `<BuilderControls>`, and `<MiniMap>`) with a
     bare:
     ```tsx
     <BuilderControls
       panOnScroll={panOnScroll}
       onTogglePanOnScroll={() => setPanOnScroll((p) => !p)}
     />
     ```
   - Leave `<Background>` where it is.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
```
```bash
grep -n "MiniMap\|Panel" apps/erp/app/modules/workflows/ui/Builder/WorkflowBuilder.tsx
# Expected: no output
```
Manual check: the toolbar sits directly above the minimap in the bottom-right corner with a
consistent gap, nothing overlaps at any window size, and the minimap still pans and zooms.

**Out of scope:** adding new controls, changing the minimap's node colouring, moving the overlay
to a different corner.

**If** `!static` does not neutralise the minimap's positioning (i.e. it still absolutely
positions itself), STOP and report rather than reintroducing pixel offsets — the pixel-offset
approach is what is being removed.

---

## Task 4: Centre Success/Failure handles on the card's vertical midline

**Depends on:** none (but must land before Task 8)
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/NodeCard.tsx` — replace the bottom port
  strip with a centred overlay.
- Copy from (precedent): the same file's single-port branch at `NodeCard.tsx:116-123` and the
  condition node's `PortAnchor` treatment at
  `apps/erp/app/modules/workflows/ui/Builder/PortAnchor.tsx` — a `<Handle>` inside a
  `position: relative` box, with **zero pixel measurement**. React Flow measures handle bounds
  from the DOM and divides by zoom itself; any `getBoundingClientRect` here is a regression.
  See `.ai/lessons.md` — "Never hand-measure React Flow handle positions".

**Current wrong behaviour:** `NodeCard.tsx:157-185` renders multi-port nodes as a labelled strip
appended after the form body, so Success/Failure end up at the bottom of a tall card instead of
on its midline.

**Steps:**

1. Add `relative` to the card root's className (line ~101), so the overlay anchors to the card:
   ```tsx
   "relative rounded-lg border bg-card shadow-sm transition-shadow",
   ```
2. Delete the entire `{ports.length > 1 && !hidePortStrip && ( ... )}` block (lines 157-185),
   including the `PORT_LABEL_TONE` map at lines 27-31 which becomes unused.
3. In its place — still inside the card root, as the last child — add the centred overlay:
   ```tsx
   {ports.length > 1 && !hidePortStrip && (
     // Handles straddle the card's midline instead of trailing the body, so a tall
     // form never pushes them to the bottom. Zero-width rows: the Handle's own
     // `right: -4px` lands it on the card border.
     <div className="pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-center gap-6">
       {ports.map((port) => (
         <div key={port.id} className="pointer-events-auto relative">
           <Handle
             type="source"
             position={Position.Right}
             id={port.id}
             title={port.label}
             aria-label={port.label}
             className={handleClass(port.tone)}
           />
         </div>
       ))}
     </div>
   )}
   ```
4. `PORT_LABEL_TONE` is now unused — remove it. `handleClass`, `HANDLE_CLASS`, `HANDLE_BASE` and
   `HANDLE_TONE` all stay.
5. Do NOT touch the `useUpdateNodeInternals` effect at lines 89-96 — it is what tells React Flow
   to re-measure when the port set or expanded state changes, and it is still required.

**Note on the dropped labels:** the visible "SUCCESS"/"FAILURE" text is replaced by the green/red
dot colour plus a native tooltip (`title`) and an accessible name (`aria-label`). Rendering the
text inside the card would sit it on top of the form fields; rendering it outside would sit it on
top of the outgoing edge. Flag this to the user in the summary — a hover-revealed chip is the
fallback if they want the words back.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
```
```bash
grep -n "getBoundingClientRect" apps/erp/app/modules/workflows/ui/Builder/NodeCard.tsx
# Expected: no output
```
Manual check: on an **action** and a **lookup** node, expanded and collapsed, the green Success
dot sits just above the card's vertical centre and the red Failure dot just below it; both stay
put while zooming and while the form grows; the condition node is unchanged (its handles still
centre on each path block); edges still attach to the right dot.

**Out of scope:** the condition node's inline `PortAnchor`s, the single-port branch, the target
(`in`) handle, and `hidePortStrip` — that flag is removed in Task 8, not here.

---

## Task 5: Correct the "Nothing happens if this fails" copy

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/WorkflowNodeCard.tsx:187-192`

**Why (verified against the engine, not assumed):** the sentence is wrong in the two ways that
matter.
- The step is written as `Failed` with its error text —
  `packages/jobs/src/workflows/engine/execute.ts:186`.
- The **whole run** is marked `Failed` — `execute.ts:446-448` sets `failed = true` from
  `outcome.status`, and `execute.ts:460-463` settles the run. So "nothing happens" is the
  opposite of the truth.
- Wiring a failure edge does **not** make the run green; `failed` is set from the outcome, never
  from whether an edge exists. A failure edge only lets recovery steps run before the run settles
  as Failed.
- What actually stops is the continuation on that path: `outgoing()` returns `[]`
  (`packages/jobs/src/workflows/engine/walk.ts:38-40`). Sibling branches already on the frontier
  still run.

**Steps:**

1. Replace the `<Trans>` content on line 190 with:
   ```tsx
   <Trans>No failure path — the run stops here and is marked failed</Trans>
   ```
2. Leave the warning's trigger condition (`hasFailureHandle && !hasFailureEdge`), its styling and
   its icon unchanged.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
```
```bash
grep -rn "Nothing happens if this fails" apps/erp/app packages
# Expected: no output outside packages/locale/locales/**/*.po
```

**Out of scope:** changing engine behaviour, adding retries, changing when the warning shows, and
running `pnpm lingui:extract` (it dumps ~120k lines of stale `.po` churn on this branch — leave
the catalogues to the pre-commit hook).

---

## Task 6: Verify Phase A

**Depends on:** Tasks 1, 2, 3, 4, 5
**Files:** none

**Steps:**

1. Run all three commands below from the repo root.
2. Fix only **error**-severity biome findings and any warning introduced by Tasks 1–5. The repo
   has ~419 pre-existing warnings — leave them. `NodeCard.tsx` has one known false-positive
   `lint/correctness/useExhaustiveDependencies` on the `isExpanded` **prop**; leave it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
pnpm exec biome check apps/erp/app/modules/workflows
# Expected: "Found 1 warning" (the known NodeCard.tsx false positive), zero errors
cd apps/erp && npx vitest run app/modules/workflows && cd -
# Expected: "Test Files  1 passed (1)" and "Tests  15 passed (15)"
```

**Out of scope:** committing. Do not commit — the user authorises commits explicitly.

---

## Task 7: Type `node.data` through the form registry (audit finding 1)

**Depends on:** none (but must land before Task 8)
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/index.ts` — narrow
  `NodeFormProps` by kind.
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/WorkflowNodeCard.tsx:184` — pass the
  narrowed node.
- Modify: all six forms in `apps/erp/app/modules/workflows/ui/Builder/config/forms/` — delete the
  hand-written `const data = node.data as {…}` cast.

**The problem (verified):** `BuilderNode.data` is `Record<string, unknown>`
(`apps/erp/app/modules/workflows/types.ts:4-10`), so every form re-declares the node's data shape
by hand — six copies of a schema that lives in `packages/workflows`. Renaming a field in
`packages/workflows/src/definition/schema.ts` leaves `typecheck --filter=erp` green while the
builder writes a definition the publish validator rejects. The six copies are at
`TriggerForm.tsx:337-341`, `ConditionForm.tsx:127`, `EntityForm.tsx:121-124`,
`LookupForm.tsx:54-58`, `FilterForm.tsx:48-52`, `ActionForm.tsx:224-228`.

**Steps:**

1. In `config/forms/index.ts`, make the props generic over the node kind:
   ```ts
   import type { WorkflowNode, WorkflowNodeType } from "@carbon/workflows";

   export type NodeFormProps<K extends WorkflowNodeType = WorkflowNodeType> = {
     node: Omit<BuilderNode, "type" | "data"> & {
       type: K;
       data: Extract<WorkflowNode, { type: K }>["data"];
     };
     /** Issues for this node, so forms can highlight the affected field. */
     issues?: WorkflowIssue[];
   };

   /** Spelled out: a missing kind is a TS2741, not a blank panel. */
   export const NODE_FORMS: {
     [K in WorkflowNodeType]: ComponentType<NodeFormProps<K>>;
   } = { trigger: TriggerForm, condition: ConditionForm, entity: EntityForm,
         lookup: LookupForm, filter: FilterForm, action: ActionForm };
   ```
2. Each form's signature becomes `({ node }: NodeFormProps<"trigger">)` (etc. per kind).
3. Delete each form's `const data = node.data as {…}` line and use `node.data` directly. Remove
   the `?? []` / `?? ""` fallbacks **only** where the zod schema has a `.default()` for that key
   (`packages/workflows/src/definition/schema.ts:34-98` — `events`, `origin`, `paths`, `inputs`,
   `returns`, `match`, `clauses`, `combinator`, `batch` all have one, so those keys are never
   absent on a parsed node). Keep any other fallback.
4. Delete `LookupForm.tsx`'s private `WorkingMatch` type (lines 19-23) — it is `lookupMatchSchema`
   with `value` widened. Use the shared `LookupMatch` and widen only at the single edit site with
   `Partial<…>`. Keep the `matchToClause` / `clauseToMatch` converters.
5. In `WorkflowNodeCard.tsx`, `<Form>` (line 184) is dispatched off a `WorkflowNodeType` value, so
   TypeScript cannot prove the component and the props share the same `K`. Resolve it in the one
   place with a single, commented cast rather than sprinkling casts:
   ```tsx
   // One narrowing site: the registry is keyed by kind but dispatched from a value.
   const Form = NODE_FORMS[node.type] as ComponentType<NodeFormProps>;
   ```
   and pass a node object that carries `name`/`expanded` from `builderNode` alongside the narrowed
   `type`/`data` from `asWorkflowNode`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
```
```bash
grep -rn "node.data as" apps/erp/app/modules/workflows/ui/Builder/config/forms
# Expected: no output
```

**Out of scope:** changing anything in `packages/workflows`, changing `BuilderNode` in
`apps/erp/app/modules/workflows/types.ts` (React Flow requires the index-signature-compatible
`Record<string, unknown>` there), and audit finding 5 (field-level issues).

**If** narrowing `BuilderNode` breaks React Flow's `Node<…>` constraint, STOP and report — do not
weaken `NodeFormProps` back to `Record<string, unknown>`.

---

## Task 8: `ports.ts` — one source of truth for port labels, tones and placement (audit finding 2)

**Depends on:** Tasks 4 and 7
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/ports.ts`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/WorkflowNodeCard.tsx` — delete
  `portsFor`, `PORT_LABEL`, `PORT_TONE`, `hidePortStrip` and the second `getNodeHandles` call.
- Modify: `apps/erp/app/modules/workflows/ui/Builder/NodeCard.tsx` — filter on `anchor`, drop the
  `hidePortStrip` prop.
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/ConditionForm.tsx` — take the
  pill/heading text from the shared helper instead of its local `KIND_PILL` + `pathIndex`.

**The problem (verified, with a live divergence):** four files decide what a port is called and
where it renders — `getNodeHandles` (`packages/workflows/src/definition/nodes.ts:567`, which
decides *which* handles exist and is correct), `portsFor()` (`WorkflowNodeCard.tsx:36-53`),
`NodeCard`'s port rendering, and `ConditionForm`'s inline `<PortAnchor>` (line 257) — glued by the
`hidePortStrip` boolean that exists only to stop two of them double-rendering the same ids. Today
the same condition port reads **"Otherwise"** when collapsed (`WorkflowNodeCard.tsx:42`,
untranslated) and **"Else"** when expanded (`ConditionForm.tsx:115-119`, translated), with two
separate implementations of the path index (`ConditionForm.tsx:205-209` vs the inline
`filter(...).findIndex(...)` at `WorkflowNodeCard.tsx:43`).

**Steps:**

1. Create `ports.ts` exporting:
   ```ts
   export type PortAnchorKind = "card" | "inline";
   export type BuilderPort = { id: string; label: string; tone: PortTone; anchor: PortAnchorKind };

   /** The one place a handle gets a label, a tone and a place to render. */
   export function portsFor(node: WorkflowNode, t: TFn): BuilderPort[];

   /** One implementation of "what is this condition path called". */
   export function conditionPathLabel(paths: ConditionPath[], pathId: string, t: TFn): string;
   ```
   - `portsFor` MUST derive its ids from `getNodeHandles(node)` and nothing else — never a
     hand-written list. This is the invariant `apps/erp/app/modules/workflows/AGENTS.md` calls out.
   - Key the label/tone maps off the exported constants `DEFAULT_HANDLE`, `SUCCESS_HANDLE`,
     `FAILURE_HANDLE` (`packages/workflows/src/definition/schema.ts:136-138`), not the string
     literals `"out"` / `"success"` / `"failure"` currently hard-coded at
     `WorkflowNodeCard.tsx:23-32`.
   - Condition paths get `anchor: "inline"`; everything else gets `anchor: "card"`.
   - `t` is the function from `useLingui()`. Pass it in rather than calling the hook, so `ports.ts`
     stays callable outside React.
2. `NodeCard` renders only `ports.filter(p => p.anchor === "card")`, using the Task 4 overlay for
   two-or-more and the existing centred single `<Handle>` for exactly one. Delete the
   `hidePortStrip` prop from `NodeCardProps` and from the call site.
3. `ConditionForm` calls `conditionPathLabel(...)` for both the pill and the `posLabel` heading;
   delete its local `KIND_PILL` map and `pathIndex()` helper. `<PortAnchor>` stays where it is
   (it already centres correctly on the whole path block and the user approved it).
4. In `WorkflowNodeCard`, derive `hasFailureHandle` from the ports array
   (`ports.some(p => p.id === FAILURE_HANDLE)`) instead of calling `getNodeHandles` a second time
   at line 102.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
```
```bash
grep -rn "hidePortStrip\|KIND_PILL" apps/erp/app/modules/workflows
# Expected: no output
```
Manual check: a condition path shows the **same** word on its pill and in its port tooltip,
collapsed and expanded, and that word is translated.

**Out of scope:** changing `getNodeHandles` or anything else in `packages/workflows`; the
`NODE_KIND_META` i18n sweep (audit finding 11).

---

## Task 9: `selectors.ts` — scalar store subscriptions (audit finding 4)

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/selectors.ts`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/WorkflowNodeCard.tsx:62-79, 117-119`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/BuilderControls.tsx:22, 55, 64`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/InlineNodeName.tsx` — compute
  `takenNames` lazily.
- Copy from (precedent): `WorkflowBuilder.tsx:47-57` and `Autosave.tsx:30` — the correct
  "read once in a callback via `useBuilderStoreApi`, don't subscribe" pattern already used in
  this codebase.

**The problem (verified):** `WorkflowNodeCard` takes seven store subscriptions, three of which
read the whole `nodes` array (`:72`, `:76`, `:77-79`). `onNodesChange` (`store.ts:69-90`) replaces
`nodes` on every React Flow position change — i.e. every pointer move during a drag — so dragging
one node re-renders **every** card, and each re-render then runs `getNodeHandles` twice, an
`edges.some()` over all edges, and a full `new Set(allNodes.filter(...).map(...))`. That is
O(nodes² + nodes·edges) per animation frame. `memo(WorkflowNodeCardImpl)` cannot help, because the
subscriptions are inside the component.

**Steps:**

1. Create `selectors.ts`:
   ```ts
   export const selectNode = (id: string) => (s: BuilderState) => s.nodes.find((n) => n.id === id);
   export const selectTriggerCount = (s: BuilderState) =>
     s.nodes.reduce((n, x) => n + (x.type === "trigger" ? 1 : 0), 0);
   export const selectHasEdgeFrom = (id: string, handle: string) => (s: BuilderState) =>
     s.edges.some((e) => e.source === id && e.sourceHandle === handle);
   ```
   These return primitives (or a stable element reference), so zustand's default `Object.is`
   comparison stops the re-render at the subscription.
2. `WorkflowNodeCard` uses `selectTriggerCount` and `selectHasEdgeFrom` and **stops** subscribing
   to `state.edges` (line 72) and `state.nodes` (line 76).
3. Delete the eager `takenNames` Set (`WorkflowNodeCard.tsx:117-119`). `InlineNodeName` only needs
   it while editing — have it build the Set inside its `isTaken` callback from
   `useBuilderStoreApi().getState().nodes`. Adjust the `isTaken` prop's plumbing accordingly.
4. `BuilderControls` subscribes to the whole `nodes` array (line 22) only to iterate ids in two
   onClick handlers. Replace with `useBuilderStoreApi()` and read
   `store.getState().nodes` inside each handler. Keep the `for...of` loops — an arrow returning a
   value there trips `lint/suspicious/useIterableCallbackReturn`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
pnpm exec biome check apps/erp/app/modules/workflows
# Expected: zero errors; no new warnings beyond the known NodeCard.tsx one
```
```bash
grep -n "useBuilderStore((s\?t\?a\?t\?e\?) => s\?t\?a\?t\?e\?.nodes)" apps/erp/app/modules/workflows/ui/Builder/nodes/WorkflowNodeCard.tsx apps/erp/app/modules/workflows/ui/Builder/BuilderControls.tsx
# Expected: no output
```
Manual check: dragging a node on a 10+ node workflow is visibly smooth; renaming still refuses a
duplicate name; Collapse-all / Expand-all still work.

**Out of scope:** memoising `WorkflowBuilder`'s own `nodes`/`edges` subscriptions — React Flow
genuinely needs those arrays. Do not touch `useBuilderStoreShallow` or the store's internals.

---

## Task 10: `useDefinition` / `useAvailableVariables` hooks (audit finding 7)

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/useDefinition.ts`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/ActionForm.tsx:239-240, 288-289`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/FilterForm.tsx:62-63`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/fields/VariablePicker.tsx:82-83`

**The problem (verified):** the `fromReactFlow(nodes, edges)` → `availableVariables(...)` pipeline
runs at five call sites. `ActionForm` runs it twice in one component over identical inputs.
`VariablePicker` runs it **unmemoised on every render**, and a picker is mounted per `ValueField`
and per `TemplateField` — i.e. once per input on the card. Combined with Task 9's drag-frame
storm, a 20-node / 60-input workflow currently walks the whole graph ~60× per frame while
dragging.

**Steps:**

1. Create `useDefinition.ts`:
   ```ts
   /** The current graph as a definition. Memoised so the graph is walked once per change. */
   export function useDefinition(): WorkflowDefinition;
   /** Variables visible to one node. Memoised over `useDefinition()`. */
   export function useAvailableVariables(nodeId: string): Variable[];
   ```
   `useDefinition` reads `nodes` and `edges` with `useBuilderStoreShallow`
   (`Builder/context.tsx:25-29` — it exists for exactly this) and wraps `fromReactFlow` in a
   `useMemo`. Match the existing call signature of `availableVariables(definition, nodeId, catalog)`
   at `ActionForm.tsx:239-240`.
2. Replace all four call sites with the hook. `ActionForm`'s two `useMemo`s collapse to one call.
3. Leave `fromReactFlow` in `Autosave.tsx:31` and `store.ts:52` (`snapshot`) alone — those are
   serialisation, not rendering.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
```
```bash
grep -rn "availableVariables(" apps/erp/app/modules/workflows/ui/Builder --include=*.tsx
# Expected: no output (the only remaining call is inside useDefinition.ts)
```
Manual check: the variable picker still lists exactly the same variables as before on an action
node, a filter node, and a template field.

**Out of scope:** caching the definition on the store itself, and changing `availableVariables` in
`packages/workflows`.

---

## Task 11: Verify Phase B, add the port invariant test, sync module AGENTS.md

**Depends on:** Tasks 7, 8, 9, 10
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/graph.test.ts` — or create
  `ports.test.ts` alongside it, matching that file's existing vitest idiom.
- Modify: `apps/erp/app/modules/workflows/AGENTS.md` — three verified stale claims.

**Steps:**

1. Add a test asserting the invariant that Task 8's refactor is protecting:
   for **every** `WorkflowNodeType`, `portsFor(createNode(kind, {x:0,y:0}), identity).map(p => p.id)`
   deep-equals `getNodeHandles(asWorkflowNode(...))`. Use `createNode` from `./graph` so the test
   covers a schema-valid node of each kind, exactly as `graph.test.ts:125-132` already does.
   Pass a stub `t` that returns its template input.
2. Fix the three verified drift items in `apps/erp/app/modules/workflows/AGENTS.md`
   (per `.claude/rules/keep-sources-in-sync.md`):
   - line 79 — there is no `LOD_ZOOM` anywhere in the repo; collapse is a per-node `expanded`
     flag (`store.ts:202-205`), toggled by the card button and `BuilderControls`.
   - line 80 — the `Not configured yet` placeholder does not exist; all six forms in
     `config/forms/` are implemented.
   - line 12 — `CURRENT_DEFINITION_FORMAT_VERSION` is **3**, not 2. This one is dangerous: an
     agent trusting it could write `2`.
3. Add two short rules to that AGENTS.md now that they are real: ports get their label/tone/anchor
   from `ui/Builder/ports.ts` (never a hand-written list), and card components subscribe to
   scalars via `ui/Builder/selectors.ts`, never to `state.nodes`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total"
pnpm exec biome check apps/erp/app/modules/workflows
# Expected: zero errors
cd apps/erp && npx vitest run app/modules/workflows && cd -
# Expected: all test files pass; the new port-invariant test appears in the count
```

**Out of scope:** committing (the user authorises commits explicitly), audit findings 3, 5, 6,
8–17, and any change to `packages/workflows`.
