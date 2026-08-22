# Workflow improvements, round 2 — implementation plan

**Spec / source:** `.ai/specs/2026-08-19-workflow-improvements-round-2.md`
**Research:** `.ai/research/2026-08-19-workflow-improvements-round-2.md`
**Branch:** `feat/workflow-improvements`

> Read the spec first. Every design decision (D-1…D-16) referenced below is defined there.
> Do NOT commit anything unless the user explicitly asks.

## Progress

- [x] Task 1: Quieter canvas grid and bezier edges
- [x] Task 2: Relabel the notify action's `role` input to "Group"
- [x] Task 3: Restrict the group and person pickers to employee groups
- [x] Task 4: Split the builder store's read-only flag into `isVersionLocked` + `canEdit`
- [x] Task 5: Wire the two flags through the provider and the route
- [x] Task 6: Gate the canvas and builder controls on the new flags
- [x] Task 7: Teach the shared value/field components an `isReadOnly` prop
- [x] Task 8: Disable every control in the six node config forms
- [x] Task 9: Build `WorkflowLockAlert` and mount it above the canvas
- [x] Task 10: Add the positions-only writer (service + route + path)
- [x] Task 11: Split autosave so a locked version saves positions only
- [x] Task 12: Let a whole record render as text
- [x] Task 13: Add `linkify` to the catalog and set it on the notify message
- [x] Task 14: Render an entity part as a markdown link when a `linkFor` is supplied
- [x] Task 15: Supply `linkFor` from the engine
- [x] Task 16: Add `renderInlineLinks` to `@carbon/notifications`
- [x] Task 17: Render inline links in the notification email
- [x] Task 18: Render the message body and its links in the in-app bell
- [x] Task 19: Build the per-company catalog overlay module
- [x] Task 20: Accept the overlay in the catalog facade and resolve custom-field events
- [x] Task 21: Derive custom-field event ids in the matcher
- [x] Task 22: Add the `workflow_merge_custom_fields` RPC
- [x] Task 23: Write custom fields from the update action
- [x] Task 24: Load the company's custom fields in the engine
- [x] Task 25: Move the builder from a catalog singleton to a per-company catalog hook
- [x] Task 26: Offer custom-field triggers in the event picker
- [x] Task 27: Extend the trigger-event drift invariant
- [x] Task 28: Sync AGENTS.md and rules
- [~] Task 29: End-to-end verification — static gates PASS; browser walk of the 30 acceptance criteria NOT run (needs the user)

## Blocked — needs a decision before Task 17

`packages/documents` does NOT depend on `@carbon/notifications` (verified: its `dependencies`
are `@carbon/env`, `@carbon/react`, `@carbon/utils`, `@react-email/*`, …). Task 17 step 2's
escape hatch therefore fires. Three options, none of which should be picked by guess:

1. **Add `@carbon/notifications` to `packages/documents` dependencies.** Smallest diff. It is a
   private workspace package of pure enums and helpers with no I/O, so the coupling is cheap —
   but `NotificationEmail.tsx` currently keeps a LOCAL copy of `NotificationDetail` precisely so
   the email package need not depend on it, and that comment says the avoidance is deliberate.
2. **Move `renderInlineLinks` into `@carbon/utils`**, which `documents` already depends on.
   `@carbon/notifications` would need `@carbon/utils` added instead (it currently depends on
   nothing at runtime), so it trades one new edge for another.
3. **Pre-split in `packages/jobs`**: widen the `NotificationDetail` shape to carry optional
   segments, so the email renders data rather than parsing a string. Cleanest layering, widest
   blast radius — `NotificationDetail` is consumed by email, Slack text and `payload.details`.

Task 18 (the in-app bell) is unaffected — `apps/erp` may import `@carbon/notifications` today.

## Dependencies

- Tasks 1, 2, 3 are independent of everything and of each other.
- Task 4 → 5 → 6; Task 7 → 8; Tasks 9, 10 independent of 4–8; Task 11 needs 4 and 10.
- Task 12 → 13 → 14 → 15; Task 16 → 17 and 16 → 18.
- Task 19 → 20 → {21, 24, 25}; Task 22 → 23; Task 24 needs 20 and 22-free; Task 25 → 26.
- Task 27 needs 19. Task 28 needs everything. Task 29 is last.
- Parallelisable groups: {1,2,3}, {4…11}, {12…18}, {19…27} touch disjoint files except
  `packages/workflows/src/catalog/actions.ts` (Tasks 2 and 13 — do Task 2 first) and
  `packages/workflows/src/catalog/catalog.ts` (Tasks 14 and 20 — do Task 14 first).

---

## Task 1: Quieter canvas grid and bezier edges

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/WorkflowBuilder.tsx` — `<Background>` props
- Modify: `apps/erp/app/modules/workflows/ui/Builder/edges/WorkflowEdge.tsx` — path function
- Modify: `apps/erp/app/modules/workflows/ui/Builder/edges/workflow-edge.css` — add the dot-colour override

**Steps:**

1. In `WorkflowBuilder.tsx`, replace the single `<Background>` line (currently
   `<Background variant={BackgroundVariant.Dots} gap={16} />`) with:
   ```tsx
   <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
   ```
2. In `edges/workflow-edge.css`, append a light/dark override for xyflow's dot colour.
   This file is already loaded as a route-level stylesheet by `routes/x+/workflow+/$id.tsx`
   (`export const links`), so it is the right home. Append:
   ```css
   /* xyflow ships an opaque default; the grid must sit under the content, not compete
      with it. Scoped to the pane so no other canvas in the app is affected. */
   .react-flow__pane {
     --xy-background-pattern-dots-color: hsl(var(--muted-foreground) / 0.25);
   }
   ```
   If `.react-flow__pane` turns out not to be an ancestor of the rendered
   `<svg class="react-flow__background">` (inspect in the browser), move the declaration to
   `.react-flow` instead. If neither works, STOP and report — do not hard-code a hex colour.
3. In `edges/WorkflowEdge.tsx` line 4, change the import from `getSmoothStepPath` to
   `getBezierPath`:
   ```tsx
   import { EdgeLabelRenderer, getBezierPath, useStore } from "@xyflow/react";
   ```
4. In the same file, replace the geometry call (currently lines 40-48) with:
   ```tsx
   const [edgePath, labelX, labelY] = getBezierPath({
     sourceX,
     sourceY,
     sourcePosition,
     targetX,
     targetY,
     targetPosition
   });
   ```
   `getBezierPath` takes no `borderRadius` — drop it. It returns the same
   `[path, labelX, labelY]` tuple, so the disconnect button below is unaffected.
5. Change NOTHING else in `WorkflowEdge.tsx`. The `strokeDasharray="8 4"`, the
   `strokeOpacity` dimming and `className="workflow-edge-animated"` all stay (D-15).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm exec biome check apps/erp/app/modules/workflows/ui/Builder
# Expected: no error-severity findings in the three touched files
```

**Out of scope:** `modules/production/ui/Jobs/JobDag.tsx`, `apps/mes/app/components/JobDag/JobDag.tsx`,
`inventory/ui/Traceability/TraceabilityGraph.tsx` — other canvases, not part of this ask.

---

## Task 2: Relabel the notify action's `role` input to "Group"

**Depends on:** none
**Files:**
- Modify: `packages/workflows/src/catalog/actions.ts` — one label string
- Regenerated: `packages/workflows/src/catalog/{events,actions,labels,help}.generated.ts`
- Regenerated: `packages/locale/locales/*/erp.po`

**Steps:**

1. In `packages/workflows/src/catalog/actions.ts`, inside the `notify` entry, change line 145
   from:
   ```ts
   role: { type: t.entity("group"), required: false, label: "role" },
   ```
   to:
   ```ts
   // The stored input key stays `role` — renaming it would need a v4 definition
   // format migration for a label change (D-9). The value is already a group id.
   role: { type: t.entity("group"), required: false, label: "group" },
   ```
2. Do NOT touch `requireOneOf: [["user", "role"]]` (line 174), `notify.ts`, or `notify.test.ts`.
3. Regenerate the catalog and format it:
   ```bash
   pnpm run generate:workflow-catalog
   pnpm exec biome check --write packages/workflows/src/catalog/
   ```
   Confirm `packages/workflows/src/catalog/labels.generated.ts` now reads
   `"action.notify.input.role": msg\`Group\`` (the key keeps `role`; only the message changes).
4. Refresh the translation catalogs:
   ```bash
   pnpm run lingui:extract && pnpm run lingui:clean
   ```
   `lingui:extract` on this branch produces a large diff across every locale. That is expected
   (see `.ai/lessons.md`); commit whatever it writes when the user asks for a commit.

**Verify:**
```bash
pnpm run check:workflow-catalog
# Expected: "check-workflow-catalog: ok — … actions, … operations" and exit 0
pnpm --filter @carbon/workflows test
# Expected: all tests pass
```

**Out of scope:** the input key `role`, `requireOneOf`, the runtime `notify.ts`, and any
definition-format migration. Label only.

---

## Task 3: Restrict the group and person pickers to employee groups

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/recordPickers.tsx` — two components

**Steps:**

1. In `recordPickers.tsx`, add `type="employee"` to `UserPicker`'s `<UserSelect>`:
   ```tsx
   const UserPicker = ({ value, onChange, isDisabled }: RecordPickerProps) => (
     <UserSelect
       value={value}
       usersOnly
       // "employee" is defined negatively by get_user_select_groups: not customer- and
       // not supplier-flagged. Ad-hoc company groups stay listed (D-10).
       type="employee"
       isMulti={false}
       insideCanvas
       disabled={isDisabled}
       onChange={(items) => handleUserChange(items, onChange)}
     />
   );
   ```
2. Add the same `type="employee"` to `GroupPicker`'s `<UserSelect>`, keeping every other prop.
3. Confirm `UserSelect` accepts it: `apps/erp/app/components/Selectors/UserSelect/types.ts`
   declares `type?: "employee" | "supplier" | "customer"`. If that prop is gone, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```
Manual (during Task 29): open a notify action, open the Group field, confirm no customer or
supplier group appears and a hand-made company group still does.

**Out of scope:** `validate.ts` (it checks the entity type, not the group flags — existing
definitions pointing at a customer or supplier group must keep working), the RPC, and every
other `UserSelect` call site in the app.

---

## Task 4: Split the builder store's read-only flag into `isVersionLocked` + `canEdit`

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/store.ts`

**Why two flags:** a live version still allows dragging; a missing `workflows_update`
permission does not (D-14). Movement follows permission, not the lock (D-12).

**Steps:**

1. In `BuilderState` (currently line 54), replace `isReadOnly: boolean;` with:
   ```ts
   /** This version is the promoted one. Behaviour edits are refused; positions are not. */
   isVersionLocked: boolean;
   /** The user holds workflows_update. */
   canEdit: boolean;
   /** Behaviour edits: config, nodes, edges, expand state. */
   canChangeDefinition: boolean;
   /** Layout only. Follows permission, NOT the lock — see D-12. */
   canMoveNodes: boolean;
   ```
2. Change the factory signature (currently line 111) to take the two source flags and derive
   the two answers once:
   ```ts
   export function createBuilderStore(initial: {
     nodes: BuilderNode[];
     edges: BuilderEdge[];
     isVersionLocked: boolean;
     canEdit: boolean;
     isOwner: boolean;
   }) {
     const canChangeDefinition = initial.canEdit && !initial.isVersionLocked;
     const canMoveNodes = initial.canEdit;
     return createStore<BuilderState>((set, get) => ({
   ```
   and in the initial-values block (currently lines 118-130) replace
   `isReadOnly: initial.isReadOnly,` with:
   ```ts
   isVersionLocked: initial.isVersionLocked,
   canEdit: initial.canEdit,
   canChangeDefinition,
   canMoveNodes,
   ```
3. Rewrite `onNodesChange` (currently lines 132-153) so layout changes pass on a locked
   version but structural ones never do:
   ```ts
   onNodesChange: (changes) => {
     const { canChangeDefinition, canMoveNodes, nodes } = get();

     // Position, size and selection carry no behaviour, so they follow permission
     // rather than the version lock — a live workflow can still be tidied and read.
     const isLayout = (c: NodeChange<BuilderNode>) =>
       c.type === "position" || c.type === "dimensions" || c.type === "select";

     let incoming = changes;
     if (!canChangeDefinition) {
       if (!canMoveNodes) return;
       incoming = changes.filter(isLayout);
       if (!incoming.length) return;
     }

     // Protect the last trigger — deletion is allowed only when another remains.
     const isRemove = (
       c: NodeChange<BuilderNode>
     ): c is { type: "remove"; id: string } => c.type === "remove";
     const triggerIds = new Set(
       nodes.filter((n) => n.type === "trigger").map((n) => n.id)
     );
     const triggerRemoveCount = incoming
       .filter(isRemove)
       .filter((c) => triggerIds.has(c.id)).length;
     const allowed =
       triggerRemoveCount >= triggerIds.size
         ? incoming.filter((c) => !(isRemove(c) && triggerIds.has(c.id)))
         : incoming;
     if (!allowed.length) return;

     set({ nodes: applyNodeChanges(allowed, nodes) });
   },
   ```
4. In `onEdgesChange`, `onConnect`, and `addNode`, replace the existing
   `const { isReadOnly, … } = get(); if (isReadOnly) return;` guard with
   `const { canChangeDefinition, … } = get(); if (!canChangeDefinition) return;`.
5. Change `arrangeNodes` (currently lines 294-298) and `setNodePositions` (300-308) to guard on
   `canMoveNodes` instead of `isReadOnly`:
   ```ts
   arrangeNodes: () => {
     const { nodes, edges, canMoveNodes, setNodePositions } = get();
     if (!canMoveNodes) return;
     setNodePositions(layoutPositions(nodes, edges));
   },

   setNodePositions: (positions) => {
     const { canMoveNodes, nodes } = get();
     if (!canMoveNodes) return;
     set({
       nodes: nodes.map((n) =>
         positions[n.id] ? { ...n, position: positions[n.id] } : n
       )
     });
   },
   ```
6. **This is the reported bug.** Add the missing guard to the five ungated mutators. Each gets
   the same first line. `updateNodeData` is the one every node config form funnels through:
   ```ts
   updateNodeData: (id, patch) => {
     // The single gate every node config form goes through. Without it a live version's
     // trigger could be switched to Schedule, and — autosave being off — the edit
     // silently evaporated on reload with no toast.
     if (!get().canChangeDefinition) return;
     set(({ nodes }) => ({
       nodes: nodes.map((n) =>
         n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
       )
     }));
   },
   ```
   Apply the same `if (!get().canChangeDefinition) return;` opener to `renameNode`,
   `setNodeExpanded`, `setAllNodesExpanded` and `removeNode`, converting each from a
   concise-body arrow to a block body where needed. `expanded` is part of the persisted
   definition (`graph.ts` `fromReactFlow`), which is why expand/collapse counts as a
   behaviour edit.
7. Leave every other member of the store untouched.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: errors ONLY of the form "Property 'isReadOnly' does not exist on type 'BuilderState'"
# in the consumer files Tasks 5-8 fix. Record that list; it is the work-list for those tasks.
```

**Out of scope:** any consumer of `isReadOnly` outside `store.ts` — Tasks 5-8 own those.

---

## Task 5: Wire the two flags through the provider and the route

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/context.tsx` — provider props
- Modify: `apps/erp/app/routes/x+/workflow+/$id.tsx` — compute and pass both flags

**Steps:**

1. In `context.tsx`, change `WorkflowBuilderProviderProps` from `isReadOnly: boolean;` to:
   ```ts
   isVersionLocked: boolean;
   canEdit: boolean;
   ```
   Nothing else changes — the provider already spreads `props` straight into
   `createBuilderStore(props)`.
2. In `routes/x+/workflow+/$id.tsx`, the loader already returns `isReadOnly: versionId ===
   workflow.activeVersionId`, i.e. "this is the live version". Rename that loader field to
   `isVersionLocked` in **all three** return shapes (the no-versions branch ~line 100, the
   unreadable-version branch ~line 120, and the success branch ~line 135). The first two
   currently return `isReadOnly: true`; they become `isVersionLocked: true`.
3. In the component (currently lines 159-163), replace the destructure alias and the derived
   flag with:
   ```tsx
     isVersionLocked
   } = useLoaderData<typeof loader>();

   const canEdit = permissions.can("update", "workflows");
   const isOwner = workflow.ownerId === userId;
   ```
   Delete the old `const isReadOnly = isLiveVersion || !permissions.can(...)` line.
4. Update the provider mount (currently lines 181-189). The `key` must cover both flags,
   because the store is created once in a ref and never updated after mount:
   ```tsx
   <WorkflowBuilderProvider
     key={`${versionId}:${isVersionLocked}:${canEdit}:${isOwner}`}
     nodes={nodes}
     edges={edges}
     isVersionLocked={isVersionLocked}
     canEdit={canEdit}
     isOwner={isOwner}
   >
   ```
5. Fix any other reference to the removed `isReadOnly` in this file that the typecheck reports.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in context.tsx or routes/x+/workflow+/$id.tsx
# (errors may remain in WorkflowBuilder.tsx / BuilderControls.tsx / node + form files — Tasks 6-8)
```

**Out of scope:** `shouldRevalidate` (Task 10 adds `/positions` to it).

---

## Task 6: Gate the canvas and builder controls on the new flags

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/WorkflowBuilder.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/BuilderControls.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/WorkflowNodeCard.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/edges/WorkflowEdge.tsx`

**Steps:**

1. `WorkflowBuilder.tsx` — replace the single `isReadOnly` selector with two:
   ```tsx
   const canChangeDefinition = useBuilderStore((s) => s.canChangeDefinition);
   const canMoveNodes = useBuilderStore((s) => s.canMoveNodes);
   ```
   Then, on the `<ReactFlow>` block (currently lines 136-171):
   - `nodesDraggable={canMoveNodes}` (was `!isReadOnly`)
   - `nodesConnectable={canChangeDefinition}` (was `!isReadOnly`)
   - `deleteKeyCode={canChangeDefinition ? ["Delete"] : null}`
   And on the surrounding wrapper: the drop handler (~lines 82, 92), the palette gate
   (~lines 114, 125) and `onKeyDownCapture` all become `canChangeDefinition` /
   `!canChangeDefinition` — a person who may not change the definition must not drop new
   nodes onto a live version.
2. `BuilderControls.tsx` — replace `const isReadOnly = useBuilderStore((s) => s.isReadOnly);`
   with both selectors, then:
   - auto-arrange button (~line 90): `isDisabled={!canMoveNodes}` (was `isDisabled={isReadOnly}`)
   - expand/collapse-all button (~line 96): add `isDisabled={!canChangeDefinition}`. It is
     currently ungated, and `expanded` is persisted.
3. `nodes/WorkflowNodeCard.tsx` — line 66 currently reads
   `const isReadOnly = useBuilderStore((state) => state.isReadOnly);`. Replace with:
   ```tsx
   const canChangeDefinition = useBuilderStore((state) => state.canChangeDefinition);
   const isReadOnly = !canChangeDefinition;
   ```
   Keeping the local name `isReadOnly` means the rest of the file (the `InlineNodeName`
   `isReadOnly` prop at line 130, and the expand/delete gates at lines 175-207) needs no edit.
   The test-run button (lines 149-172) stays ungated — running a workflow does not modify it.
4. `edges/WorkflowEdge.tsx` line 28 — same substitution:
   ```tsx
   const canChangeDefinition = useBuilderStore((s) => s.canChangeDefinition);
   const isReadOnly = !canChangeDefinition;
   ```
   so the disconnect button (line 63) stays hidden on a live version.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in these four files
```

**Out of scope:** the six node config forms and the shared field components — Tasks 7 and 8.

---

## Task 7: Teach the shared value/field components an `isReadOnly` prop

**Depends on:** none (do before Task 8)
**Files:**
- Modify: `packages/react/src/VariableText/VariableText.tsx` — add `isReadOnly`
- Modify: `packages/react/src/Input.tsx` — fix the prop-order bug
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/types.ts` — `ValueFieldProps`
- Modify: `.../fields/ValueField.tsx`, `.../fields/LiteralControl.tsx`,
  `.../fields/InlineValueEditor.tsx`, `.../fields/PairsField.tsx`,
  `.../fields/TemplateField.tsx`, `.../fields/VariableChip.tsx`,
  `.../fields/VariablePickControl.tsx`
- Modify: `.../config/ClauseRow.tsx`, `.../config/CombinatorToggle.tsx`

**Prop-name reference — verified against each component's own definition. Using the wrong
one silently does nothing:**

| Component | Prop |
|---|---|
| `Button`, `IconButton`, `Input`, `NumberField`, `NumberInput`, `DatePicker`, `RECORD_PICKERS[*]` | `isDisabled` |
| `Combobox`, `CreatableCombobox` | `isReadOnly` |
| `Select` / `SelectTrigger`, `ToggleGroup` / `ToggleGroupItem`, `Switch`, `CommandInput`, `CommandItem`, raw `<button>`, `OperatorCombobox` | `disabled` |

**Steps:**

1. **Fix the `Input` bug first.** `packages/react/src/Input.tsx` applies
   `disabled={isDisabled}` *after* `{...props}` (~lines 215-221), so a bare `disabled` passed
   by a caller is silently overwritten with `false`. Change the spread order so an explicit
   `disabled` prop survives:
   ```tsx
   disabled={isDisabled ?? props.disabled}
   ```
   placed after the spread. Add the comment: `// Explicit disabled must survive the spread; it was being overwritten.`
   Then grep for callers that rely on the old (broken) behaviour:
   ```bash
   grep -rn "<Input" packages/ apps/ --include=*.tsx | grep -w "disabled"
   ```
   If a caller passes `disabled` expecting it to be ignored, STOP and report — do not guess.
2. `packages/react/src/VariableText/VariableText.tsx` — add to `VariableTextProps`:
   ```ts
   /** Renders the same value but refuses edits. The Tiptap shell stays, so the
    * read-only rendition matches the editable one exactly. */
   isReadOnly?: boolean;
   ```
   Pass it to the Tiptap editor as `editable: !isReadOnly` in the `useEditor` options, and add
   `isReadOnly` to that hook's dependency array if it has one. Setting `suggestionChar` to
   `undefined` is NOT enough — it only kills the token menu, not typing.
3. `fields/types.ts` — add one optional flag to `ValueFieldProps` (shared by `ValueField`,
   `PairsField` and `TemplateField`, so this covers all three):
   ```ts
   /** The version is published: show the value, refuse every edit. */
   isReadOnly?: boolean;
   ```
4. `fields/InlineValueEditor.tsx` — add `isReadOnly?: boolean;` to its `Props`, pass
   `isReadOnly` through to `<VariableText>`, and short-circuit the two handlers that can dirty
   the definition without a keystroke: `onFocusCapture` (~line 99, calls
   `publishVariableMenuData`) and `onBlurCapture` (~lines 104-112, calls `onChange` with a
   trimmed value). Both become no-ops when `isReadOnly`.
5. `fields/ValueField.tsx` — accept `isReadOnly` and thread it to `<InlineValueEditor>` (~49),
   `<VariablePickControl>` (~88), `<VariableChip>` (~92) and `<LiteralControl>` (~105); force
   the `<VariableMenuPopover>` (~79) closed (`open={isReadOnly ? false : open}`).
6. `fields/LiteralControl.tsx` — add `isReadOnly?: boolean;` to `LiteralControlProps`, make the
   `{` handler (~lines 64-69, `braceOpens`) a no-op when set, and disable each branch with the
   prop from the table above:
   - `<Select>` ~83 and `<SelectTrigger>` ~84 → `disabled`
   - `<Input>` ~105 → `isDisabled`
   - `<NumberField>` ~124 → `isDisabled` (steppers inherit)
   - `<Switch>` ~152 → `disabled`
   - `<DatePicker>` ~162 → `isDisabled`
   - `<Picker>` from `RECORD_PICKERS[type.of]` ~181 → `isDisabled`
   - the fallback `<Input … disabled />` ~189-195 → change `disabled` to `isDisabled`
7. `fields/PairsField.tsx` — thread `isReadOnly` to `<Input>` ~65 (`isDisabled`),
   `<InlineValueEditor>` ~76, the remove `<IconButton>` ~85 (`isDisabled`) and the
   "Add header" `<Button>` ~101 (`isDisabled`).
8. `fields/TemplateField.tsx` — thread `isReadOnly` to its single `<InlineValueEditor>` (~28).
9. `fields/VariablePickControl.tsx` — add `isReadOnly?: boolean;`; suppress the outer
   `<div onClick={onOpen}>` (~30) handler and add `disabled` to the raw `<button>` (~38).
10. `fields/VariableChip.tsx` — add `isReadOnly?: boolean;` and `disabled` on both raw
    `<button>`s (~49 reopen menu, ~56 clear value).
11. `config/CombinatorToggle.tsx` — add `isReadOnly?: boolean;` to its `Props` and pass
    `disabled={isReadOnly}` to `<ToggleGroup>` (~11) and both `<ToggleGroupItem>`s (~19, ~25).
12. `config/ClauseRow.tsx` — add `isReadOnly?: boolean;` to `ClauseRowProps`, then:
    - `<Combobox>` ~141 → `isReadOnly={isReadOnly}` (it takes `isReadOnly`, NOT `isDisabled`)
    - `<ValueField>` ~166 and ~213 → `isReadOnly={isReadOnly}`
    - `<OperatorCombobox>` ~199 → `disabled={!leftType || isReadOnly}` (it already has a
      `disabled={!leftType}`)
    - remove `<IconButton>` ~242 → `isDisabled={!canRemove || isReadOnly}`
    The `memo` wrapper at the bottom stays; a boolean prop is memo-safe.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec turbo run typecheck --filter=@carbon/react
# Expected: no errors
pnpm --filter @carbon/react test
# Expected: all tests pass (or "no test files")
```

**Out of scope:** the six node config forms (Task 8). Do not change any component's default
behaviour — `isReadOnly` is optional and defaults to editable everywhere.

---

## Task 8: Disable every control in the six node config forms

**Depends on:** Tasks 4, 6, 7
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/index.ts` — `NodeFormProps`
- Modify: `.../nodes/WorkflowNodeCard.tsx` — pass the flag to `<Form>`
- Modify: `.../config/forms/{TriggerForm,ConditionForm,ActionForm,EntityForm,LookupForm,FilterForm}.tsx`

**Steps:**

1. `config/forms/index.ts` — add the flag to both the generic and the erased form type:
   ```ts
   export type NodeFormProps<K extends WorkflowNodeType = WorkflowNodeType> = {
     node: …;
     issues?: WorkflowIssue[];
     /** The version is published: render every control disabled rather than inert. */
     isReadOnly?: boolean;
   };

   export type AnyNodeForm = ComponentType<{
     node: BuilderNode;
     issues?: WorkflowIssue[];
     isReadOnly?: boolean;
   }>;
   ```
2. `nodes/WorkflowNodeCard.tsx` ~line 228 — pass it:
   ```tsx
   <Form key={id} node={builderNode} issues={nodeIssues} isReadOnly={isReadOnly} />
   ```
   (`isReadOnly` is already in scope from Task 6.)
3. Work through the checklist below file by file. Every entry must end up disabled. Use the
   prop-name table from Task 7 — a raw `<button>` takes native `disabled`; `Select`,
   `SelectTrigger`, `ToggleGroup`, `ToggleGroupItem`, `Switch`, `CommandInput` and
   `CommandItem` take `disabled`; `Button` and `IconButton` take `isDisabled`; `Combobox`
   takes `isReadOnly`. Where a local sub-component has no such prop, add
   `isReadOnly?: boolean` to its props type and thread it.

   **TriggerForm.tsx** — add `isReadOnly` to the local `EventPickerProps` (~84-90) and
   `ScheduleEditorProps` (~187-190), then:
   raw `<button>` ~107 (event-picker trigger), `CommandInput` ~126, `CommandItem` ~137 and
   ~159, `Select`+`SelectTrigger` ~204/208 (frequency), raw `<button>` ~235 (weekday toggle,
   one per abbreviation), `Select`+`SelectTrigger` ~269/275 (day of month), ~298/302 (hour),
   ~314/318 (minute), ~337/338 (timezone), **raw `<button>` ~431 ("Event") and ~443
   ("Schedule") — this pair is the reported bug**, `<EventPicker>` ~465, `<ToggleGroup>` ~479
   and its three `<ToggleGroupItem>`s ~487/493/499, `<ScheduleEditor>` ~517.

   **ConditionForm.tsx** — add `isReadOnly` to `SortableClauseItem`'s props (~43-56), then:
   raw `<button>` ~89 (drag grip) **and** pass `disabled: isReadOnly` into the
   `useSortable({ id: sortId })` call ~80 so dragging is inert, `<ClauseRow>` ~102,
   `<CombinatorToggle>` ~115, `<Button>` ~231 ("Add clause"), `<IconButton>` ~246
   ("Remove path"), `<SortableClauseItem>` ~296, `<Button>` ~331 ("Add path"), `<Button>`
   ~343 ("Add otherwise").

   **ActionForm.tsx** — add `isReadOnly` to `ActionPicker`'s props (~93-98) and
   `NotifyAboutField`'s props (~182-187), then: raw `<button>` ~126 (action-picker trigger),
   `CommandInput` ~144, `CommandItem` ~153, `Select`+`SelectTrigger` ~227/228,
   `<ValueField>` ~240, and inside `renderInput` (~354-418, a closure that can read
   `isReadOnly` straight from props) `<PairsField>` ~370, `<TemplateField>` ~387,
   `<ValueField>` ~404; `<ActionPicker>` ~443, raw `<button>` ~461 (the `requireOneOf` group
   switch, one per member), `<NotifyAboutField>` ~500.

   **EntityForm.tsx** — add `isReadOnly` to `OperationPicker`'s props (~35-39), then:
   raw `<button>` ~62, `CommandInput` ~81, `CommandItem` ~92, `<OperationPicker>` ~166,
   `<ValueField>` ~189.

   **LookupForm.tsx** — `<Combobox>` ~120 (`isReadOnly`), raw `<button>` ~137 ("Just one"),
   ~149 ("Every match"), `<ClauseRow>` ~170, raw `<button>` ~184 ("Add match").

   **FilterForm.tsx** — raw `<button>` ~106 (source picker trigger), `CommandInput` ~127,
   `CommandItem` ~134, raw `<button>` ~153 ("Clear"), `<CombinatorToggle>` ~174 and ~194,
   `<ClauseRow>` ~182, `<Button>` ~203 ("Add rule").

4. Line numbers will drift as you edit. After finishing a file, grep it to prove nothing was
   missed:
   ```bash
   grep -n "<button\|<Button\|<IconButton\|<Select\|<Switch\|<ToggleGroup\|<Combobox\|<Command\|<ValueField\|<ClauseRow\|<CombinatorToggle\|<PairsField\|<TemplateField\|<Input\|<NumberField\|<DatePicker" \
     apps/erp/app/modules/workflows/ui/Builder/config/forms/<File>.tsx
   ```
   Every hit must carry a disabling prop wired to `isReadOnly`, or be a nested render of a
   component that already received it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm exec biome check apps/erp/app/modules/workflows
# Expected: no error-severity findings
```
Acceptance criteria 18 and 19 are checked by hand in Task 29.

**Out of scope:** hiding controls. They stay visible and become disabled — a live version must
read as "this is what it does", not as an empty panel.

---

## Task 9: Build `WorkflowLockAlert` and mount it above the canvas

**Depends on:** Task 5
**Files:**
- Create: `apps/erp/app/modules/workflows/ui/WorkflowLockAlert.tsx`
- Modify: `apps/erp/app/routes/x+/workflow+/$id.tsx` — mount it
- Copy from (precedent): `apps/erp/app/modules/items/ui/Item/ReleaseLockAlert.tsx`

**Steps:**

1. Create the component, matching the precedent's conventions exactly: default export, arrow
   function, `Alert variant="warning"` + `LuTriangleAlert` from `react-icons/lu`, `<Trans>`
   from `@lingui/react/macro` (NOT `useLingui`), optional `className`.
   ```tsx
   import { Alert, AlertDescription, AlertTitle, Button } from "@carbon/react";
   import { Trans } from "@lingui/react/macro";
   import { LuTriangleAlert } from "react-icons/lu";
   import { Link } from "react-router";
   import { path } from "~/utils/path";

   type WorkflowLockAlertProps = {
     workflowId: string;
     /** The user holds workflows_update. Telling someone without it to "create a new
      * version" would be wrong, so the two cases get different copy. */
     canEdit: boolean;
     className?: string;
   };

   const WorkflowLockAlert = ({
     workflowId,
     canEdit,
     className
   }: WorkflowLockAlertProps) => (
     <Alert variant="warning" className={className}>
       <LuTriangleAlert />
       <AlertTitle>
         <Trans>This version is live</Trans>
       </AlertTitle>
       <AlertDescription>
         {canEdit ? (
           <Trans>
             This version is live. Create a new version to make changes. You can still
             move steps around to tidy the layout.
           </Trans>
         ) : (
           <Trans>
             This version is live and you do not have permission to change workflows.
           </Trans>
         )}
       </AlertDescription>
       {canEdit && (
         <Button asChild variant="secondary" size="sm" className="mt-2 w-fit">
           <Link to={path.to.workflowVersionNew(workflowId)}>
             <Trans>New version</Trans>
           </Link>
         </Button>
       )}
     </Alert>
   );

   export default WorkflowLockAlert;
   ```
   The description's first sentence deliberately matches `LOCKED_VERSION_MESSAGE` in
   `apps/erp/app/modules/workflows/workflows.server.ts` — the banner and the server's 409 must
   say the same thing.
2. Confirm `path.to.workflowVersionNew(id)` exists in `apps/erp/app/utils/path.ts` (it does) and
   that `x+/workflow+/$id.version.new.tsx` accepts a GET-navigable link. If that route is
   POST-only, wrap the button in a `<Form method="post" action={…}>` instead of a `<Link>`
   rather than inventing a new route.
3. Mount it in `routes/x+/workflow+/$id.tsx`, between `<BuilderHeader>` and the
   `<div className="relative flex flex-1 overflow-hidden">`:
   ```tsx
   {isVersionLocked && (
     <WorkflowLockAlert
       workflowId={workflow.id}
       canEdit={canEdit}
       className="mx-4 mt-3"
     />
   )}
   ```
4. Delete the stale line in `apps/erp/app/modules/workflows/AGENTS.md` (line 55) that already
   claims this file exists, replacing it with the real inventory:
   ```
       ├── WorkflowsTable.tsx, WorkflowForm.tsx, WorkflowLockAlert.tsx, WorkflowActiveSwitch.tsx, WorkflowsUpgradeOverlay.tsx
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
ls apps/erp/app/modules/workflows/ui/WorkflowLockAlert.tsx
# Expected: the path prints
```

**Out of scope:** the 14px lock glyph in `BuilderHeader.tsx` and the `Live` badge in
`WorkflowVersionStatus.tsx` — both stay; the banner is additive.

---

## Task 10: Add the positions-only writer (service + route + path)

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/workflows/workflows.models.ts` — a validator
- Modify: `apps/erp/app/modules/workflows/workflows.service.ts` — `updateWorkflowNodePositions`
- Create: `apps/erp/app/routes/x+/workflow+/$id.positions.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `workflowPositions`
- Modify: `apps/erp/app/routes/x+/workflow+/$id.tsx` — `shouldRevalidate`
- Copy from (precedent): `apps/erp/app/routes/x+/workflow+/$id.canvas.tsx` (the deliberately
  unlocked writer) and `$id.save.tsx` (the locked one)

**Why a second route:** `/save` is correctly locked server-side and must stay locked. A narrow
endpoint that ignores unknown node ids and never touches `edges` or `data` cannot change
behaviour even when called by hand (D-13).

**Steps:**

1. Add a validator alongside `workflowDefinitionSaveValidator` in `workflows.models.ts`:
   ```ts
   export const workflowNodePositionsValidator = z.object({
     versionId: zfd.text(z.string()),
     // A JSON string, same shape as the save route's `nodes`/`edges` fields.
     positions: zfd.text(z.string())
   });
   ```
   Export it from the module barrel `apps/erp/app/modules/workflows/index.ts` if that barrel
   lists validators explicitly.
2. Add the service function to `workflows.service.ts`, next to `updateWorkflowCanvasState`:
   ```ts
   /**
    * The ONE writer allowed on a live version. It reads the version's nodes and re-writes
    * only `position`, only for node ids that already exist. `edges`, `data`, `expanded`,
    * `name` and `type` are never touched and an unknown id is ignored, so the endpoint is
    * incapable of changing behaviour even when called by hand (D-13).
    *
    * No audit bump, for the same reason as updateWorkflowCanvasState: tidying a layout is
    * not an edit, and stamping `updatedAt` would reorder the list on every drag.
    */
   export async function updateWorkflowNodePositions(
     client: SupabaseClient<Database>,
     {
       versionId,
       companyId,
       positions
     }: {
       versionId: string;
       companyId: string;
       positions: Record<string, { x: number; y: number }>;
     }
   ) {
     const version = await client
       .from("workflowVersion")
       .select("nodes")
       .eq("id", versionId)
       .eq("companyId", companyId)
       .maybeSingle();

     if (version.error) return { data: null, error: version.error };
     if (!version.data) return { data: null, error: { message: "Version not found" } };

     const nodes = version.data.nodes;
     if (!Array.isArray(nodes)) {
       return { data: null, error: { message: "Version has no nodes" } };
     }

     const next = nodes.map((node) => {
       const id = (node as { id?: unknown })?.id;
       const position = typeof id === "string" ? positions[id] : undefined;
       return position === undefined
         ? node
         : { ...(node as object), position: { x: position.x, y: position.y } };
     });

     return client
       .from("workflowVersion")
       .update({ nodes: next as unknown as Json })
       .eq("id", versionId)
       .eq("companyId", companyId);
   }
   ```
3. Create `apps/erp/app/routes/x+/workflow+/$id.positions.tsx`, modelled on `$id.canvas.tsx`.
   It requires `workflows_update` and deliberately does NOT call `checkWorkflowVersionLock`:
   ```tsx
   import { assertIsPost } from "@carbon/auth";
   import { requirePermissions } from "@carbon/auth/auth.server";
   import { requirePlan } from "@carbon/ee/plan.server";
   import { validationError, validator } from "@carbon/form";
   import type { ActionFunctionArgs } from "react-router";
   import { data } from "react-router";
   import {
     updateWorkflowNodePositions,
     workflowNodePositionsValidator
   } from "~/modules/workflows";
   import { path } from "~/utils/path";

   // Node positions carry no behaviour, so the live-version lock does not apply here —
   // you may tidy a published workflow's layout. The service applies positions only, to
   // node ids that already exist, so this route cannot change what a workflow does.
   export async function action({ request }: ActionFunctionArgs) {
     assertIsPost(request);
     const { client, companyId } = await requirePermissions(request, {
       update: "workflows"
     });
     await requirePlan({
       request,
       client,
       companyId,
       feature: "WORKFLOWS",
       redirectTo: path.to.workflows
     });

     const validation = await validator(workflowNodePositionsValidator).validate(
       await request.formData()
     );
     if (validation.error) return validationError(validation.error);

     let parsed: unknown;
     try {
       parsed = JSON.parse(validation.data.positions);
     } catch {
       return data({ ok: false, error: "Malformed positions" }, { status: 400 });
     }

     const shape = z
       .record(z.string(), z.object({ x: z.number(), y: z.number() }))
       .safeParse(parsed);
     if (!shape.success) {
       return data({ ok: false, error: "Malformed positions" }, { status: 400 });
     }

     const update = await updateWorkflowNodePositions(client, {
       versionId: validation.data.versionId,
       companyId,
       positions: shape.data
     });

     if (update.error) {
       return data({ ok: false, error: update.error.message }, { status: 500 });
     }

     return data({ ok: true });
   }
   ```
   Import `z` from `"zod"`. Note `$id.save.tsx` also takes `versionId` from the body rather
   than `params`, which is why this route does too.
4. Add the path helper to `apps/erp/app/utils/path.ts`, alphabetically between `workflowNew`
   and `workflowPublish`:
   ```ts
   workflowPositions: (id: string) =>
     generatePath(`${x}/workflow/${id}/positions`),
   ```
5. In `routes/x+/workflow+/$id.tsx`, extend `shouldRevalidate` so a positions save does not
   re-run the loader and remount the store:
   ```ts
   return (
     !formAction?.includes("/save") &&
     !formAction?.includes("/canvas") &&
     !formAction?.includes("/positions")
   );
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
grep -n "workflowPositions" apps/erp/app/utils/path.ts
# Expected: one hit
```
Acceptance criteria 23 and 24 are exercised by hand in Task 29.

**Out of scope:** `updateWorkflowDefinition`, `checkWorkflowVersionLock`, and `$id.save.tsx` —
the save route must keep returning 409 on a live version.

---

## Task 11: Split autosave so a locked version saves positions only

**Depends on:** Tasks 4, 10
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/Autosave.tsx`

**Steps:**

1. Replace the `isReadOnly` subscription with the two flags the store now exposes:
   ```tsx
   const isVersionLocked = useBuilderStore((s) => s.isVersionLocked);
   const canMoveNodes = useBuilderStore((s) => s.canMoveNodes);
   const canChangeDefinition = useBuilderStore((s) => s.canChangeDefinition);
   ```
   (Use whichever hook this file already uses to read store state; keep the existing
   `useBuilderStoreApi()` for the un-subscribed reads inside the effect.)
2. In the save effect, replace the `if (isReadOnly) return;` bail with:
   ```tsx
   if (!canChangeDefinition && !(isVersionLocked && canMoveNodes)) return;
   ```
3. Inside the debounce tick, branch on which endpoint to post to. Keep the same 1s debounce and
   the same `submittedRef` / baseline-diff machinery:
   ```tsx
   const state = store.getState();
   const definition = fromReactFlow(state.nodes, state.edges);
   const submitted = JSON.stringify(definition);
   if (submitted === state.baseline) return;

   const formData = new FormData();
   formData.append("versionId", versionId);

   if (canChangeDefinition) {
     formData.append("nodes", JSON.stringify(definition.nodes));
     formData.append("edges", JSON.stringify(definition.edges));
     formData.append("formatVersion", String(definition.formatVersion));
   } else {
     // A live version: positions are the only thing the server will accept, and the
     // only thing the store let the user change.
     const positions = Object.fromEntries(
       definition.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }])
     );
     formData.append("positions", JSON.stringify(positions));
   }

   submittedRef.current = submitted;
   state.setSaveState("saving");
   submit(formData, {
     method: "post",
     action: canChangeDefinition
       ? path.to.workflowSave(workflowId)
       : path.to.workflowPositions(workflowId)
   });
   ```
   Keep `fromReactFlow` as the snapshot source for the baseline diff, so a locked version's
   baseline still rebaselines correctly on success and a drag is the only thing that can make
   the two differ (every other mutator is gated in the store).
4. Add `isVersionLocked`, `canMoveNodes` and `canChangeDefinition` to the effect's dependency
   array in place of `isReadOnly`.
5. Leave the completion effect (`rebaseline` on `ok`, `toast.error` otherwise) exactly as is.
   It now actually fires on a locked version, which is the point — a refused save must say so.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
grep -rn "isReadOnly" apps/erp/app/modules/workflows/ui/Builder/
# Expected: hits only in files where it is a LOCAL const derived from canChangeDefinition,
# or a prop name on a shared field component. No hit reading `state.isReadOnly`.
```
Acceptance criteria 21, 22 and 25 are checked by hand in Task 29.

**Out of scope:** the canvas-state (viewport) autosave, which has its own route and stays as is.

---

## Task 12: Let a whole record render as text

**Depends on:** none
**Files:**
- Modify: `packages/workflows/src/definition/types.ts` — `rendersAsText`
- Modify: `packages/workflows/src/definition/types.test.ts` — extend
- Modify: `packages/workflows/src/definition/validate.test.ts` — extend

**Steps:**

1. Replace `rendersAsText` (currently lines 77-85) with:
   ```ts
   /**
    * Whether a value of this type has a reading inside a sentence. A record does: it
    * prints as its readable id (renderValue falls back to `readableId ?? name ?? id`),
    * which is exactly what someone means by "…for SO000123". A LIST of records does not —
    * a run of ids in a sentence has no good reading (D-8).
    */
   export function rendersAsText(type: ValueType): boolean {
     return type.kind !== "list" || type.of.kind !== "entity";
   }
   ```
2. Extend `definition/types.test.ts` with cases proving `rendersAsText` is now `true` for
   `t.entity("salesOrder")`, still `true` for every primitive, and still `false` for
   `t.list({ kind: "entity", of: "salesOrder" })`.
3. Extend `definition/validate.test.ts`: the existing `TYPE_MISMATCH` test that asserts a
   record in a template is rejected must be changed to assert it is now ACCEPTED, and a new
   test added asserting a **list of records** in a template is still rejected with
   `TYPE_MISMATCH`. Find them by searching the file for `TYPE_MISMATCH` and
   `Pick one of its properties`.
4. This widens the rule for every template field including webhook bodies — that is intended
   (they render as the readable id, criterion 17). Do not add a notify-only special case.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all tests pass, including the new entity/list-of-entity cases
```

**Out of scope:** `renderValue` (it already knows how to print an entity) and the builder's
`variableMenu.ts` (its `textOnly` filter calls `rendersAsText`, so it follows automatically).

---

## Task 13: Add `linkify` to the catalog and set it on the notify message

**Depends on:** Task 2 (same file)
**Files:**
- Modify: `packages/workflows/src/definition/catalog.ts` — `CatalogInput`
- Modify: `packages/workflows/src/catalog/build.ts` — `BuiltActionInput` + the copy-through
- Modify: `packages/workflows/src/catalog/actions.ts` — `ActionInputLike` + the notify message
- Regenerated: `packages/workflows/src/catalog/actions.generated.ts`

**Why a declared flag:** the resolver must not linkify every template, or a webhook body would
ship markdown (criterion 17). The catalog is the only place that knows which input is prose a
human reads.

**Steps:**

1. `definition/catalog.ts` — add to `CatalogInput`, after `template`:
   ```ts
   /** This input is prose a person reads, so a record dropped into it renders as a
    * link when the caller supplies one. Webhook bodies deliberately do not set this. */
   linkify?: boolean;
   ```
2. `catalog/build.ts` — add the identical field to `BuiltActionInput` (after `template`), and
   add one line to the hand-written copy-through loop (currently ~line 615), keeping the
   established `...(spec.x ? { x: true } : {})` idiom:
   ```ts
   ...(spec.template ? { template: true } : {}),
   ...(spec.linkify ? { linkify: true } : {}),
   ```
3. `catalog/actions.ts` — add to `ActionInputLike` (after `template?: boolean;`):
   ```ts
   /** Prose a person reads: a record dropped in renders as a link. Not for webhook bodies. */
   linkify?: boolean;
   ```
   Then set it on the notify action's `message` input only — NOT on `subject` (an email subject
   line renders markdown literally):
   ```ts
   message: {
     type: t.string,
     required: false,
     label: "message",
     template: true,
     linkify: true
   },
   ```
4. Regenerate:
   ```bash
   pnpm run generate:workflow-catalog
   pnpm exec biome check --write packages/workflows/src/catalog/
   ```
   Confirm `actions.generated.ts`'s `notify.inputs.message` now carries `"linkify": true` and
   `webhook.inputs.body` does not.

**Verify:**
```bash
pnpm run check:workflow-catalog
# Expected: exit 0, "check-workflow-catalog: ok"
pnpm --filter @carbon/workflows test
# Expected: all tests pass
```

**Out of scope:** the generated `<entity>.update` action family — none of its inputs is prose.

---

## Task 14: Render an entity part as a markdown link when a `linkFor` is supplied

**Depends on:** Tasks 12, 13
**Files:**
- Modify: `packages/workflows/src/runtime/types.ts` — `RuntimeContext.linkFor`
- Modify: `packages/workflows/src/runtime/resolve.ts` — `renderTemplate` options
- Modify: `packages/workflows/src/runtime/action.ts` — pass the option for `linkify` inputs
- Modify: `packages/workflows/src/runtime/template.test.ts` — extend
- Modify: `packages/workflows/src/runtime/action.test.ts` — extend

**Design constraint:** `packages/workflows` has four runtime deps and targets the browser at
ES2019. It must NOT construct a URL or import `@carbon/env` — it calls a callback the engine
supplies (Task 15).

**Steps:**

1. `runtime/types.ts` — add to `RuntimeContext`, after `record`:
   ```ts
   /** Turns a record into an absolute URL, for the inputs the catalog marks `linkify`.
    * Supplied by the engine, which may read ERP_URL; this package never builds a URL. */
   linkFor?: (of: string, id: string) => string | null;
   ```
2. `runtime/resolve.ts` — give `renderTemplate` an optional third argument and use it only for
   entity parts:
   ```ts
   /** An unresolvable part fails the whole template; a blank would be a silent lie. */
   export async function renderTemplate(
     template: Template,
     ctx: RuntimeContext,
     options?: { linkFor?: (of: string, id: string) => string | null }
   ): Promise<Resolution> {
     const pieces: string[] = [];
     for (const part of template.parts) {
       if (part.kind === "text") {
         pieces.push(part.text);
         continue;
       }
       const resolved =
         part.kind === "item"
           ? await resolveItem(part, ctx)
           : await resolveRef(part, ctx);
       if (!resolved.ok) return resolved;
       pieces.push(renderPart(resolved.value, options?.linkFor));
     }
     return { ok: true, value: primitiveValue("string", pieces.join("")) };
   }

   /** A record in prose reads as its id, and becomes a markdown link when the caller
    * knows where it lives. Every other value renders exactly as before. */
   function renderPart(
     value: RuntimeValue,
     linkFor?: (of: string, id: string) => string | null
   ): string {
     const text = renderValue(value);
     if (linkFor === undefined || value.kind !== "entity" || text === "") return text;
     const href = linkFor(value.of, value.id);
     return href === null ? text : `[${text}](${href})`;
   }
   ```
   `resolveValue`'s own `renderTemplate(value, ctx)` call passes no options, so every existing
   caller renders exactly as today.
3. `runtime/action.ts` — resolve a `linkify` input through `renderTemplate` with the callback.
   Replace the input loop's body (currently lines 22-31):
   ```ts
   for (const [name, value] of Object.entries(node.data.inputs)) {
     // Only a catalog-declared prose input linkifies, and only when the engine
     // supplied a resolver — a webhook body must stay plain text.
     const linkify =
       action.inputs[name]?.linkify === true && value.kind === "template";
     const resolved = linkify
       ? await renderTemplate(value, ctx, { linkFor: ctx.linkFor })
       : await resolveValue(value, ctx);
     if (!resolved.ok) return { status: "Skipped", reason: resolved.reason };
     inputs[name] =
       ctx.item !== undefined && resolved.value.kind === "list"
         ? ctx.item
         : resolved.value;
     ctx.record?.(name, inputs[name]);
   }
   ```
   and extend the import at line 6 to `import { renderTemplate, resolveValue } from "./resolve";`.
4. `runtime/template.test.ts` — add cases: an entity part with no `linkFor` renders its
   `readableId` unchanged; with a `linkFor` returning a URL it renders
   `[SO000123](https://example.test/…)`; with a `linkFor` returning `null` it renders the plain
   id; a null entity value renders `""` and is never wrapped.
5. `runtime/action.test.ts` — add a case proving an input WITHOUT `linkify` is untouched even
   when `ctx.linkFor` is present (the webhook-body guarantee, criterion 17).

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all tests pass, including the new template and action cases
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: no errors
```

**Out of scope:** URL construction, `@carbon/env`, and `renderValue` (unchanged — the wrapping
happens in `renderPart`, so every non-template caller is untouched).

---

## Task 15: Supply `linkFor` from the engine

**Depends on:** Task 14
**Files:**
- Modify: `packages/jobs/src/workflows/engine/execute.ts` — `contextFor`

**Steps:**

1. Find `contextFor` in `execute.ts` (~lines 125-140), where the `RuntimeContext` is assembled.
   Add a `linkFor` to the returned context:
   ```ts
   // The one place a workflow value becomes a URL. `/api/link` performs the company
   // switch before redirecting, so a recipient in another active company still lands
   // on the right record; an entity with no page returns null and renders as plain text.
   linkFor: (of: string, id: string) =>
     buildNotificationLink(NotificationEvent.Workflow, id, payload.companyId, of as never),
   ```
   importing `buildNotificationLink` from
   `../../inngest/functions/notifications/content` and `NotificationEvent` from
   `@carbon/notifications`. Use the same `documentType` cast the notify action already uses
   (`notify.ts` casts the catalog entity name to `ApprovalDocumentType` with the comment that
   the column is TEXT and the resolver reads the workflow entity name) — mirror that cast
   rather than inventing a new one.
2. `/api/link` resolves `documentType` through `getRecordPath`, whose `RECORD_ROUTES` map has
   19 keys. An entity outside that map lands on the dashboard rather than 404ing, which is the
   existing behaviour for the notification row itself — acceptable, and the link text is still
   the readable id.
3. If `contextFor` does not have `payload` in scope, thread `companyId` in from its caller
   rather than reading a module-level value.

**Verify:**
```bash
pnpm --filter @carbon/jobs typecheck
# Expected: no errors  (note: this package uses `tsc --noEmit`, not tsgo)
pnpm --filter @carbon/jobs test
# Expected: all tests pass
```

**Out of scope:** Slack (not a workflow destination) and the `aboutId`/`aboutType` inputs,
which already make the whole notification row clickable and are unchanged.

---

## Task 16: Add `renderInlineLinks` to `@carbon/notifications`

**Depends on:** none
**Files:**
- Modify: `packages/notifications/src/index.ts` — add the helper
- Create: `packages/notifications/src/index.test.ts`
- Modify: `packages/notifications/package.json` — add a `test` script

**This is a security boundary, not a formatting nicety.** The body is customer-authored text.
If the matcher accepted any URL, a workflow author could inject an arbitrary destination into a
notification the recipient trusts (D-11).

**Steps:**

1. Append to `packages/notifications/src/index.ts`:
   ```ts
   export type InlineLinkSegment =
     | { text: string }
     | { text: string; href: string };

   // Deliberately strict: `[label](url)` where url is an absolute https URL on the
   // supplied origin. A relative path, another host, or a javascript: URL is left as
   // literal text — the body is customer-authored and must not be able to choose where
   // a trusted notification points.
   const INLINE_LINK = /\[([^\]\n]+)\]\((https:\/\/[^\s()]+)\)/g;

   export function renderInlineLinks(
     text: string,
     origin: string
   ): InlineLinkSegment[] {
     const segments: InlineLinkSegment[] = [];
     let index = 0;

     let allowed: URL;
     try {
       allowed = new URL(origin);
     } catch {
       return text === "" ? [] : [{ text }];
     }

     INLINE_LINK.lastIndex = 0;
     for (const match of text.matchAll(INLINE_LINK)) {
       const [whole, label, href] = match;
       if (label === undefined || href === undefined) continue;

       let parsed: URL;
       try {
         parsed = new URL(href);
       } catch {
         continue;
       }
       if (parsed.protocol !== "https:" || parsed.origin !== allowed.origin) continue;

       const start = match.index ?? 0;
       if (start > index) segments.push({ text: text.slice(index, start) });
       segments.push({ text: label, href: parsed.toString() });
       index = start + whole.length;
     }

     if (index < text.length) segments.push({ text: text.slice(index) });
     return segments;
   }
   ```
2. Create `packages/notifications/src/index.test.ts` (this package has no tests yet, and
   `@carbon/config/vitest` sets `globals: false`, so import the helpers explicitly):
   ```ts
   import { describe, expect, it } from "vitest";
   import { renderInlineLinks } from "./index";

   const ORIGIN = "https://app.carbon.ms";

   describe("renderInlineLinks", () => {
     it("splits a link out of surrounding text", () => { … });
     it("leaves a javascript: URL as literal text", () => { … });   // criterion 16
     it("leaves another host as literal text", () => { … });
     it("leaves a relative path as literal text", () => { … });
     it("leaves plain text as one segment", () => { … });
     it("handles two links in one body", () => { … });
     it("returns [] for an empty string", () => { … });
   });
   ```
   Fill in each assertion; do not leave a `…` in the committed file.
3. Add the missing runner to `packages/notifications/package.json` scripts:
   ```json
   "test": "vitest run"
   ```
   and add `@carbon/config` + `vitest` to its `devDependencies` (catalog versions) plus a
   one-line `vitest.config.ts` matching the other packages:
   ```ts
   export { default } from "@carbon/config/vitest";
   ```
   Run `pnpm install` afterwards.

**Verify:**
```bash
pnpm --filter @carbon/notifications test
# Expected: 7 tests pass
pnpm --filter @carbon/notifications typecheck
# Expected: no errors
```

**Out of scope:** any other markdown syntax. Bold, italics and lists stay literal text.

---

## Task 17: Render inline links in the notification email

**Depends on:** Task 16
**Files:**
- Modify: `packages/documents/src/email/NotificationEmail.tsx` — the detail value cell
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts` — pass the origin

**Steps:**

1. `NotificationEmail.tsx` renders `{detail.value}` inside a `<Text>` in a right-aligned cell
   (~lines 300-317). Replace the bare value with segments:
   ```tsx
   <Text className={…}>
     {renderInlineLinks(detail.value, erpUrl).map((segment, i) =>
       "href" in segment ? (
         <Link key={i} href={segment.href} style={{ color: "#2563eb" }}>
           {segment.text}
         </Link>
       ) : (
         <span key={i}>{segment.text}</span>
       )
     )}
   </Text>
   ```
   using `Link` from `@react-email/components` (check what this file already imports; if it has
   no `Link`, add it from the same package the other components come from).
2. `NotificationEmail.tsx` deliberately keeps a LOCAL copy of `NotificationDetail` so the email
   package need not depend on `@carbon/notifications`. Do not break that: add an `erpUrl?:
   string` prop to the component and, if `erpUrl` is absent, render `detail.value` exactly as
   today. Import `renderInlineLinks` from `@carbon/notifications` only if that dependency
   already exists; otherwise copy the helper's *call* into the jobs package instead — i.e. have
   `notify.ts` pre-split the segments and pass `details` values through unchanged, and put the
   segment rendering in the email. **Decide by checking `packages/documents/package.json`
   first.** If neither route is clean, STOP and report rather than adding a new cross-package
   dependency by guess.
3. In `packages/jobs/src/inngest/functions/notifications/notify.ts`, pass `erpUrl={ERP_URL}`
   wherever `NotificationEmail` is rendered.
4. The Workflow body is the only detail whose value is long prose, and the cell is
   `textAlign: "right"` with a `whiteSpace: "nowrap"` label. Leave the layout alone in this
   task — criterion 15 only requires the link to work.

**Verify:**
```bash
pnpm --filter @carbon/documents typecheck
pnpm --filter @carbon/jobs typecheck
# Expected: no errors
pnpm --filter @carbon/documents test
# Expected: all tests pass
```

**Out of scope:** redesigning the details table, and every non-Workflow notification event
(they pass through the same code path unchanged because their values contain no `[…](…)`).

---

## Task 18: Render the message body and its links in the in-app bell

**Depends on:** Task 16
**Files:**
- Modify: `apps/erp/app/components/Layout/Topbar/Notifications.tsx`

**Today `payload.details` is written and never read** — a workflow author's message is
invisible in-app, which would make the whole link feature look broken (spec §5.2c).

**Steps:**

1. `GenericNotification` (~lines 185-200) receives the row but not its `payload`. Thread the
   body through: read `payload.details` where the row is unpacked (find where `description` is
   taken off `payload`), take the entry whose `label === "Message"`, and pass it as a new
   optional `body?: string` prop down to `Notification`.
2. In the `Notification` component (~lines 121-183), render the body under the description:
   ```tsx
   <p className="text-sm">
     {description} {byUser && <span>{t`by ${byUser}`}</span>}
   </p>
   {body && (
     <p className="text-xs text-muted-foreground line-clamp-3">{…segments…}</p>
   )}
   ```
3. **The row is currently one `<Link to={to}>` wrapping everything.** A nested `<a>` is invalid
   HTML and browsers will unnest it, so the anchor inside the body would escape the row.
   Restructure: drop the outer `<Link>`, keep the same markup inside a
   `<div role="link" tabIndex={0}>` (or a plain div) whose `onClick` and `onKeyDown` (Enter and
   Space) call `navigate(to)` then `onClose()`, and render the body's link segments as real
   `<Link to={segment.href}>` elements with `e.stopPropagation()` on their click so they do not
   also fire the row navigation. Keep the existing `hover:bg-secondary` row styling and the
   sibling "Mark as read" `IconButton` exactly where they are.
4. Segment the body with `renderInlineLinks(body, window.location.origin)` from
   `@carbon/notifications`. The href produced by Task 15 is an absolute
   `${ERP_URL}/api/link?…` URL, so on the ERP origin it matches and becomes a link; use
   `<a href={…}>` (a full page load through `/api/link`, which performs the company switch)
   rather than a client-side `<Link>` for those — criterion 14 explicitly requires the company
   switch to work.
5. Every other notification event renders through this same component. Verify by eye that a
   non-Workflow notification (which has no `body`) is visually unchanged.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm exec biome check apps/erp/app/components/Layout/Topbar/Notifications.tsx
# Expected: no error-severity findings
```
Criterion 14 and 16 are checked by hand in Task 29. This component renders EVERY notification
type — regression-check at least three different events in the bell during Task 29.

**Out of scope:** the digest child-row payload shape (it carries no `details`), and the
notification detail drawer if one exists elsewhere.

---

## Task 19: Build the per-company catalog overlay module

**Depends on:** none
**Files:**
- Create: `packages/workflows/src/catalog/custom-fields.ts`
- Create: `packages/workflows/src/catalog/custom-fields.test.ts`
- Modify: `packages/workflows/src/catalog/index.ts` — export it

**Why an overlay (D-2):** `events.generated.ts` is committed, global and drift-checked against
a fresh build. Custom fields are per-company and runtime. They cannot be generated; an overlay
merged at the two catalog construction sites is the smallest seam.

**Steps:**

1. Create `packages/workflows/src/catalog/custom-fields.ts`. Pure, no I/O, no DB import:
   ```ts
   import type { CatalogEvent, CatalogInput } from "../definition/catalog";
   import { t, type ValueType } from "../definition/types";
   import { REGISTRY_ENTRIES } from "./entities";

   /** One path segment, not a two-hop drill: `walkPath` and the runtime `walk` stay
    * single-step, and the nested differ never emits the bare `customFields` key (D-3). */
   export const CUSTOM_FIELD_PREFIX = "customFields.";

   /** Custom fields attach to the item SUBTYPES (part, material, tool, …) while the
    * catalog triggers on the shared `item` table. Merging them needs a collision rule
    * and is its own change (D-7). */
   const EXCLUDED_ENTITIES = new Set(["item"]);

   /** The shape the ERP already loads, from `customField` / the `customFieldTables` view. */
   export type CustomFieldDef = {
     table: string;
     /** The key inside the JSONB blob — an id, never the name. */
     id: string;
     name: string;
     dataTypeId: number;
     listOptions: string[] | null;
     active: boolean;
   };

   export type CatalogOverlay = {
     /** entity -> property path -> type */
     properties: Record<string, Record<string, ValueType>>;
     /** label key -> the customer's field name, verbatim and untranslated */
     labels: Record<string, string>;
     /** entity -> property path -> allowed values */
     enums: Record<string, Record<string, readonly string[]>>;
     /** action id -> input name -> spec, for the `<entity>.update` family */
     actionInputs: Record<string, Record<string, CatalogInput>>;
   };

   export const EMPTY_OVERLAY: CatalogOverlay = {
     properties: {},
     labels: {},
     enums: {},
     actionInputs: {}
   };

   /** table -> registry entity name. Built once; the registry is committed data. */
   export const ENTITY_BY_TABLE: Record<string, string> = Object.fromEntries(
     Object.entries(REGISTRY_ENTRIES).map(([name, entry]) => [entry.table, name])
   );

   /** The ONE place DataType (apps/erp/app/modules/shared/types.ts) maps to a ValueType.
    * A File field is exposed as the stored path — comparable and printable, but not a
    * link and not a record to drill into (D-16). */
   function valueTypeFor(dataTypeId: number): ValueType | undefined {
     switch (dataTypeId) {
       case 1: return t.boolean;   // Boolean
       case 2: return t.date;      // Date
       case 3: return t.string;    // List — choices come from listOptions
       case 4: return t.number;    // Numeric
       case 5: return t.string;    // Text
       case 6: return t.entity("user");
       case 7: return t.entity("customer");
       case 8: return t.entity("supplier");
       case 9: return t.string;    // File — the stored path
       default: return undefined;
     }
   }

   export function buildCatalogOverlay(defs: CustomFieldDef[]): CatalogOverlay {
     const overlay: CatalogOverlay = {
       properties: {},
       labels: {},
       enums: {},
       actionInputs: {}
     };

     for (const def of defs) {
       if (!def.active) continue;
       const entity = ENTITY_BY_TABLE[def.table];
       if (entity === undefined || EXCLUDED_ENTITIES.has(entity)) continue;
       const type = valueTypeFor(def.dataTypeId);
       if (type === undefined) continue;

       const property = `${CUSTOM_FIELD_PREFIX}${def.id}`;
       const choices =
         def.dataTypeId === 3 && def.listOptions && def.listOptions.length > 0
           ? def.listOptions
           : undefined;

       (overlay.properties[entity] ??= {})[property] = type;
       overlay.labels[`entity.${entity}.${property}`] = def.name;
       if (choices) (overlay.enums[entity] ??= {})[property] = choices;

       // Writable through the generated update action, when the entity has one.
       const actionId = `${entity}.update`;
       (overlay.actionInputs[actionId] ??= {})[property] = {
         type,
         required: false,
         ...(choices ? { choices } : {})
       };
       overlay.labels[`action.${actionId}.input.${property}`] = def.name;
     }

     return overlay;
   }

   /** `<entity>.customFields.<fieldId>.changed`. Deliberately parallel to the generated
    * `<entity>.<column>.changed`. */
   const CUSTOM_FIELD_EVENT =
     /^([A-Za-z][A-Za-z0-9]*)\.customFields\.([^.]+)\.changed$/;

   export function customFieldEventId(entity: string, fieldId: string): string {
     return `${entity}.${CUSTOM_FIELD_PREFIX}${fieldId}.changed`;
   }

   /**
    * Parses a custom-field event id into a synthetic CatalogEvent. WORKFLOW_EVENTS stays a
    * closed, committed, drift-checked record — a per-company id cannot live there, so the
    * id is PARSED rather than looked up (D-4). Company-blind by design: whether the field
    * actually exists is decided by the workflowTriggerEvent join, not here.
    */
   export function resolveCustomFieldEvent(id: string): CatalogEvent | undefined {
     const match = CUSTOM_FIELD_EVENT.exec(id);
     if (match === null) return undefined;
     const [, entity, fieldId] = match;
     if (entity === undefined || fieldId === undefined) return undefined;
     if (EXCLUDED_ENTITIES.has(entity)) return undefined;
     const entry = REGISTRY_ENTRIES[entity];
     // Reference-only entities have no `watch` and therefore no change events at all.
     if (entry === undefined || entry.watch === undefined) return undefined;

     return {
       id,
       outputs: {
         record: t.entity(entity),
         before: t.entity(entity),
         after: t.entity(entity)
       },
       permission: entry.permission,
       match: {
         table: entry.table,
         operation: "UPDATE",
         field: `${CUSTOM_FIELD_PREFIX}${fieldId}`
       }
     };
   }
   ```
2. Export the module from `packages/workflows/src/catalog/index.ts`:
   ```ts
   export type { CatalogOverlay, CustomFieldDef } from "./custom-fields";
   export {
     buildCatalogOverlay,
     CUSTOM_FIELD_PREFIX,
     customFieldEventId,
     EMPTY_OVERLAY,
     ENTITY_BY_TABLE,
     resolveCustomFieldEvent
   } from "./custom-fields";
   ```
   `src/index.ts` line 1 is `export * from "./catalog";`, so this reaches the public barrel.
3. Create `custom-fields.test.ts` covering: each DataType maps to the right ValueType; an
   inactive field is dropped; a field on `item` is dropped; a field on a table not in the
   registry is dropped; a List field puts its options in `enums` AND on the action input; the
   property key is exactly `customFields.<id>`; `resolveCustomFieldEvent` parses a valid id,
   rejects `item.customFields.x.changed`, rejects a reference-only entity
   (`user.customFields.x.changed`), rejects a malformed id, and returns a `match.field` of
   `customFields.<id>`; `customFieldEventId` round-trips through `resolveCustomFieldEvent`.
   Import `{ describe, expect, it } from "vitest"` explicitly — the shared config sets
   `globals: false`.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all tests pass, including the new custom-fields suite
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: no errors
```

**Out of scope:** `build.ts`'s `DROPPED_COLUMNS` — `customFields` stays out of the generated
property map; the overlay is the only path in.

---

## Task 20: Accept the overlay in the catalog facade and resolve custom-field events

**Depends on:** Tasks 14, 19
**Files:**
- Modify: `packages/workflows/src/definition/catalog.ts` — `WorkflowCatalog` gains two lookups
- Modify: `packages/workflows/src/catalog/catalog.ts` — merge the overlay
- Modify: `packages/workflows/src/sync.ts` — resolve rather than index
- Modify: `packages/workflows/src/catalog/catalog.test.ts` and `src/sync.test.ts` — extend

**Steps:**

1. `definition/catalog.ts` — add to the `WorkflowCatalog` interface:
   ```ts
   /** The customer's own name for a property, when it is a custom field. */
   getPropertyLabel(entity: string, property: string): string | undefined;
   /** The customer's own name for an action input, when it is a custom field. */
   getInputLabel(actionId: string, input: string): string | undefined;
   ```
   `createFixtureCatalog` in the same file must gain both (returning `undefined`) or every
   test that builds one fails to compile.
2. `packages/workflows/src/catalog/catalog.ts` — add the module-level resolver and take the
   overlay:
   ```ts
   /** The single event lookup: the committed catalog first, then the parsed custom-field
    * pattern. Every consumer goes through here, so `WORKFLOW_EVENTS` stays closed (D-4). */
   export function getCatalogEvent(id: string): CatalogEvent | undefined {
     return EVENTS.get(id) ?? resolveCustomFieldEvent(id);
   }

   export function createWorkflowCatalog(
     overlay: CatalogOverlay = EMPTY_OVERLAY
   ): WorkflowCatalog {
     return {
       getEvent: getCatalogEvent,
       getEntity: (name) => {
         const base = ENTITIES.get(name);
         const extra = overlay.properties[name];
         if (base === undefined || extra === undefined) return base;
         // Generated first, overlay second: a real column always wins, so a customer
         // cannot shadow one.
         return { ...base, properties: { ...base.properties, ...extra } };
       },
       getAction: (id) => {
         const base = ACTIONS.get(id);
         const extra = overlay.actionInputs[id];
         if (base === undefined || extra === undefined) return base;
         return { ...base, inputs: { ...base.inputs, ...extra } };
       },
       getOperation: (id) => OPERATIONS.get(id),
       getEnum: (entity, property) =>
         ENUMS.get(entity)?.[property] ?? overlay.enums[entity]?.[property],
       getPropertyLabel: (entity, property) =>
         overlay.labels[`entity.${entity}.${property}`],
       getInputLabel: (actionId, input) =>
         overlay.labels[`action.${actionId}.input.${input}`]
     };
   }
   ```
   Import `CatalogOverlay`, `EMPTY_OVERLAY` and `resolveCustomFieldEvent` from
   `./custom-fields`. Every existing call site passes no argument and is unaffected.
3. `packages/workflows/src/sync.ts` — `deriveWorkflowSubscriptions` currently reads
   `WORKFLOW_EVENTS[eventId]?.match` (line 59). Change the import at line 4 to
   `import { getCatalogEvent } from "./catalog";` and line 59 to:
   ```ts
   const match = getCatalogEvent(eventId)?.match;
   ```
   This is what makes publishing a custom-field trigger create the right
   `eventSystemSubscription` (criterion 2).
4. Extend `catalog.test.ts`: `getEvent("salesOrder.customFields.cf_x.changed")` returns a
   synthetic event with `match.field === "customFields.cf_x"`; an overlay property appears on
   `getEntity`; an overlay property does NOT override a generated column of the same key; an
   overlay enum is returned by `getEnum`; `getAction("salesOrder.update")` includes the overlay
   input; `getPropertyLabel` returns the customer's name.
5. Extend `sync.test.ts`: `deriveWorkflowSubscriptions(["salesOrder.customFields.cf_x.changed"])`
   returns `[{ table: "salesOrder", operations: ["UPDATE"] }]`, and an id for `item` returns `[]`.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/workflows
pnpm exec turbo run typecheck --filter=@carbon/jobs
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors — every existing createWorkflowCatalog() call still compiles
```

**Out of scope:** `event-ids.ts` (Task 21) and the builder (Task 25).

---

## Task 21: Derive custom-field event ids in the matcher

**Depends on:** Task 20
**Files:**
- Modify: `packages/jobs/src/workflows/event-ids.ts`
- Modify: `packages/jobs/src/workflows/event-ids.test.ts` — extend

**The matcher stays company-blind (D-5).** `computeNestedDiff` already emits
`customFields.<id>` keys, so the id is derived from the data and the existing
`workflowTriggerEvent` join does the filtering it already does. No company lookup is added to
the hot path.

**Steps:**

1. Import the helpers and build a table→entity index once at module scope, beside `INDEX`:
   ```ts
   import { ENTITY_BY_TABLE, customFieldEventId, createWorkflowCatalog } from "@carbon/workflows";

   const CATALOG = createWorkflowCatalog();
   ```
2. In `computeEventIds`, after the existing watched-column loop (currently lines 53-57), append
   the custom-field pass:
   ```ts
   const ids: string[] = [];
   for (const [field, id] of entry.changed) {
     if (field in diff) ids.push(id);
   }

   // A custom field's event id is derived from the diff key, not looked up: the id is
   // per company, the catalog is not. resolveCustomFieldEvent decides whether the
   // entity may carry one at all (item is excluded), so the rule lives in one place.
   const entity = ENTITY_BY_TABLE[input.table];
   if (entity !== undefined) {
     for (const key of Object.keys(diff)) {
       const fieldId = key.startsWith("customFields.")
         ? key.slice("customFields.".length)
         : undefined;
       if (fieldId === undefined || fieldId === "") continue;
       const id = customFieldEventId(entity, fieldId);
       if (CATALOG.getEvent(id) !== undefined) ids.push(id);
     }
   }

   return ids;
   ```
   Custom-field ids are appended AFTER the generated `.changed` ids, which keeps the existing
   "one run per workflow per announcement, first event id wins" rule producing the same winner
   as today for any workflow subscribed to both.
3. Extend `event-ids.test.ts`: an UPDATE whose diff contains `customFields.cf_x` on
   `salesOrder` yields `["salesOrder.customFields.cf_x.changed"]`; the same on `item` yields
   `[]`; a bare `customFields` key (which the nested differ never emits) yields `[]`; an update
   touching both a watched column and a custom field yields both ids with the column's id
   first; an unwatched table still yields `[]`.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/workflows/event-ids.test.ts
# Expected: all tests pass
pnpm --filter @carbon/jobs typecheck
# Expected: no errors
```

**Out of scope:** `computeNestedDiff` in `inngest/functions/events/diff.ts` — it already emits
the right keys and must not change.

---

## Task 22: Add the `workflow_merge_custom_fields` RPC

**Depends on:** none
**Files:**
- Create: a new migration under `packages/database/supabase/migrations/`
- Regenerated: `packages/database/src/types.ts` (never hand-edited)

**Why an RPC (D-6):** a read-modify-write on the JSONB blob through the Supabase client races a
concurrent human edit and would erase the other fields. `||` merges server-side in one
statement.

**Steps:**

1. Create the migration:
   ```bash
   pnpm db:migrate:new workflow-merge-custom-fields
   ```
2. Fill it in, following the house style (a `--` rationale block, `SECURITY INVOKER`,
   `SET search_path = public`, `GRANT EXECUTE … TO authenticated` on its own final line):
   ```sql
   -- A workflow may set one custom field without erasing the others. Reading the blob,
   -- merging in app code and writing it back races a concurrent human edit and silently
   -- drops their change, so the merge happens server-side in one statement.
   --
   -- SECURITY INVOKER: the workflow runs as its owner and RLS on the target table is the
   -- authorization gate, exactly as it is for the ordinary column update beside it.
   -- p_table is validated against "customFieldTable" — the existing global allowlist —
   -- before it is ever interpolated into the dynamic statement.
   CREATE OR REPLACE FUNCTION workflow_merge_custom_fields (
     p_table TEXT,
     p_id TEXT,
     p_company_id TEXT,
     p_values JSONB
   )
   RETURNS VOID
   LANGUAGE "plpgsql"
   SECURITY INVOKER
   SET search_path = public
   AS $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM "customFieldTable" WHERE "table" = p_table) THEN
       RAISE EXCEPTION 'Unknown custom field table: %', p_table;
     END IF;

     IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
       RAISE EXCEPTION 'p_values must be a JSON object';
     END IF;

     EXECUTE format(
       'UPDATE %I SET "customFields" = COALESCE("customFields", ''{}''::jsonb) || $1 '
       'WHERE "id" = $2 AND "companyId" = $3',
       p_table
     ) USING p_values, p_id, p_company_id;
   END;
   $$;

   GRANT EXECUTE ON FUNCTION workflow_merge_custom_fields(TEXT, TEXT, TEXT, JSONB) TO authenticated;
   ```
3. Apply it and regenerate the types — **in this order**, before any typecheck that depends on
   the new RPC:
   ```bash
   pnpm db:migrate
   pnpm run generate:types
   ```
   If the local database is not running, STOP and ask the user to start it — never rebuild the
   database to test a change.
4. Confirm the RPC now appears in the generated types:
   ```bash
   grep -n "workflow_merge_custom_fields" packages/database/src/types.ts
   # Expected: at least one hit under Functions
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: no errors
```

**Out of scope:** any schema change to `customField` or `customFieldTable`, and RLS policy
edits. Both stay exactly as they are.

---

## Task 23: Write custom fields from the update action

**Depends on:** Tasks 19, 22
**Files:**
- Modify: `packages/jobs/src/workflows/actions/update.ts`
- Create: `packages/jobs/src/workflows/actions/update.test.ts` (if absent; otherwise extend)

**Steps:**

1. In `runUpdateAction`, split custom-field inputs out of the ordinary column loop. Replace the
   `fields` accumulation loop (currently ~lines 78-96) so keys beginning with the prefix land in
   a second bucket, while all the existing validation still runs on them:
   ```ts
   const fields: Record<string, unknown> = {};
   const customFields: Record<string, unknown> = {};

   for (const [column, value] of Object.entries(inputs)) {
     if (column === entity) continue;
     const spec = action.inputs[column];
     const raw = toPlainValue(value);

     if (raw === undefined) continue;
     if (raw === null && spec?.notNull) continue;

     if (
       raw !== null &&
       spec?.choices !== undefined &&
       !spec.choices.includes(String(raw))
     ) {
       return { ok: false, error: `"${String(raw)}" is not a valid ${column}.` };
     }

     if (column.startsWith(CUSTOM_FIELD_PREFIX)) {
       // The ERP's form layer writes every custom field as a FormData string, so the
       // blob holds strings whatever the declared type. `fromColumn` coerces back by
       // the DECLARED type on read, so writing a string here round-trips exactly.
       customFields[column.slice(CUSTOM_FIELD_PREFIX.length)] =
         raw === null ? null : String(raw);
       continue;
     }

     fields[column] = raw;
   }
   ```
   Import `CUSTOM_FIELD_PREFIX` from `@carbon/workflows`.
2. The tenancy loop that follows must cover custom fields too — a User/Customer/Supplier custom
   field is an entity-typed value and must be proved to belong to this company. Run the same
   loop over `Object.entries(customFields)`, looking the spec up under the prefixed key:
   ```ts
   for (const [fieldId, raw] of Object.entries(customFields)) {
     if (raw === null) continue;
     const spec = action.inputs[`${CUSTOM_FIELD_PREFIX}${fieldId}`];
     const scope =
       spec?.type.kind === "entity"
         ? REGISTRY_ENTRIES[spec.type.of]?.table
         : spec?.scopeTable;
     if (scope === undefined) continue;

     const belongs = await existsInCompany({
       client,
       table: scope,
       id: String(raw),
       companyId
     });
     if (!belongs) {
       return { ok: false, error: `The value you chose is not in this company.` };
     }
   }
   ```
3. Issue the merge as a separate statement AFTER the ordinary update, and only when there is
   something to write. Both live inside the same durable step, whose at-most-once claim already
   covers a partial failure:
   ```ts
   if (Object.keys(customFields).length > 0) {
     // One statement, server-side `||` merge: setting one field must not erase the
     // others, and a read-modify-write here would race a concurrent human edit (D-6).
     const merged = await client.rpc("workflow_merge_custom_fields", {
       p_table: table,
       p_id: target.id,
       p_company_id: companyId,
       p_values: customFields
     });
     if (merged.error) return { ok: false, error: merged.error.message };
   }
   ```
   Place it after the existing `.update(...)` call and before the success return. If
   `fields` is empty, skip the ordinary update entirely rather than writing a bare
   `updatedBy`/`updatedAt` — decide by `Object.keys(fields).length > 0`.
4. Update the success summary so the count includes both:
   ```ts
   summary: `Updated ${Object.keys(fields).length + Object.keys(customFields).length} field(s).`
   ```
5. Add tests for: a custom field write leaves the other keys in the blob intact (criterion 8);
   a List custom field set outside its `listOptions` fails with a reason and writes nothing
   (criterion 9); a User custom field pointing at another company's user is refused; an
   update setting both a real column and a custom field issues both statements. Mock the
   Supabase client the way the neighbouring `notify.test.ts` does.

**Verify:**
```bash
pnpm --filter @carbon/jobs test
pnpm --filter @carbon/jobs typecheck
# Expected: all tests pass, no errors
```

**Out of scope:** creating custom fields, deleting them, and the `create` action family.

---

## Task 24: Load the company's custom fields in the engine

**Depends on:** Tasks 19, 20
**Files:**
- Modify: `packages/jobs/src/workflows/engine/execute.ts`

**Steps:**

1. `executeWorkflowRun` currently builds the catalog on its second line
   (`const catalog = createWorkflowCatalog();`) — before the `"load"` step. `catalog` is not
   read until after `loaded` is settled (`walkWorkflow`, the `"permissions"` step,
   `triggerOutputs`), so it can safely move down.
2. Delete that line. After the `if (loaded.settled !== null) return …` early exit, add a new
   durable step that reads the company's definitions through the **owner-scoped** client — the
   same client every other business read uses, so a field the owner may not see does not reach
   the workflow:
   ```ts
   // Read as the owner, like every other business read: `customField` is company-scoped
   // and RLS-covered. Its own step so a transient read failure retries without redoing
   // the run claim above.
   const customFields = await step.run("custom-fields", async () => {
     const client = await getOwnerClient(payload.ownerId, payload.runId);
     const { data, error } = await client
       .from("customField")
       .select("table, id, name, dataTypeId, listOptions, active")
       .eq("companyId", payload.companyId)
       .eq("active", true);
     // A company with no custom fields, and a refused read, are the same answer here:
     // the workflow runs against the shipped catalog alone.
     return error || !data ? [] : data;
   });

   const catalog = createWorkflowCatalog(
     buildCatalogOverlay(customFields as CustomFieldDef[])
   );
   ```
   Import `buildCatalogOverlay` and the `CustomFieldDef` type from `@carbon/workflows`.
3. Everything downstream works unchanged: `resolve.ts`'s `entity.properties[segment]` gate now
   finds the property, `fromColumn` coerces by the declared `ValueType`, and `compare.ts` is
   untouched. A value that cannot be coerced resolves to nothing, which the engine already
   treats as "skip with a reason", never an error.
4. Confirm `getOwnerClient` is already imported in this file (it is, used by `contextFor` and
   the `"permissions"` step). If `payload.ownerId` is not in scope at that point, STOP and
   report rather than reaching for a privileged client.

**Verify:**
```bash
pnpm --filter @carbon/jobs typecheck
pnpm --filter @carbon/jobs test
# Expected: no errors, all tests pass
```

**Out of scope:** `loader.ts` — it already does `select("*")`, so the JSONB blob is already in
memory. Nothing there changes.

---

## Task 25: Move the builder from a catalog singleton to a per-company catalog hook

**Depends on:** Task 20
**Files:**
- Modify: `apps/erp/app/hooks/useCustomFieldsSchema.tsx` — surface `active`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/catalog.ts` — replace the singleton
- Modify: the seven files that import the `catalog` value (list below)

**Risk being managed:** `catalog.ts` currently exports a module-level singleton. Deleting that
export makes every missed call site a COMPILE ERROR rather than a silently field-less picker —
that is deliberate; do not keep a compatibility export.

**Steps:**

1. `apps/erp/app/hooks/useCustomFieldsSchema.tsx` — the `customFieldTables` view already emits
   `active` in its `fields` JSON, but `fieldValidator` omits it and zod strips unknown keys.
   Add it so the overlay can filter:
   ```ts
   active: z.boolean().nullish().transform((v) => v ?? true),
   ```
   placed alphabetically in the object. Nothing else in that file changes; every existing
   consumer only gains a key.
2. Rewrite `ui/Builder/catalog.ts`. Delete `export const catalog = createWorkflowCatalog();`
   and add:
   ```ts
   /** The company's catalog: shipped entries plus this company's custom fields (D-2).
    * There is deliberately no module singleton — a call site that forgets the hook is a
    * compile error, not a picker that quietly lists no custom fields. */
   export function useWorkflowCatalog(): WorkflowCatalog {
     const schemas = useCustomFieldsSchema();
     return useMemo(() => {
       const defs = Object.entries(schemas).flatMap(([table, fields]) =>
         (fields ?? []).map((field) => ({
           table,
           id: field.id,
           name: field.name,
           dataTypeId: field.dataTypeId,
           listOptions: field.listOptions,
           active: field.active
         }))
       );
       return createWorkflowCatalog(buildCatalogOverlay(defs));
     }, [schemas]);
   }
   ```
   importing `buildCatalogOverlay`, `createWorkflowCatalog` and the `WorkflowCatalog` type from
   `@carbon/workflows`, `useCustomFieldsSchema` from `~/hooks`, and `useMemo` from `react`.
   Keep `useWorkflowLabel`, `workflowFieldHelp` and the `./labelKeys` re-exports exactly as they
   are.
3. Update the seven files that import the `catalog` VALUE, replacing
   `import { catalog } from "../catalog"` (path varies) with the hook and a
   `const catalog = useWorkflowCatalog();` at the top of the component or hook body:
   - `ui/Builder/LiveValidation.tsx`
   - `ui/Builder/useDefinition.ts`
   - `ui/Builder/config/ClauseRow.tsx`
   - `ui/Builder/config/forms/ActionForm.tsx`
   - `ui/Builder/config/forms/EntityForm.tsx`
   - `ui/Builder/fields/useVariableMenuData.ts`
   - `ui/Builder/TestRun/TestRunDialog.tsx`
   All seven are React components or hooks, so the hook is legal in each. Where `catalog` is
   read inside a `useMemo`, add it to that memo's dependency array. The other nine importers
   take only `useWorkflowLabel` / label-key helpers and need no change.
4. `ClauseRow.tsx`'s `columnOptions` memo currently labels a column with
   `label(propertyLabelKey(entity, col), col)`. Change the fallback so a custom field shows the
   customer's own name rather than the raw id:
   ```ts
   label(propertyLabelKey(entity, col), catalog.getPropertyLabel(entity, col) ?? col)
   ```
   and add `catalog` to that memo's deps. Do the same wherever `ActionForm.tsx` labels an
   action input, using `catalog.getInputLabel(actionId, name) ?? name` as the fallback.
   Custom field names are customer data and are deliberately never translated.
5. Verify nothing still reaches for the deleted singleton:
   ```bash
   grep -rn "from \"[./]*catalog\"" apps/erp/app/modules/workflows | grep -w catalog
   # Expected: no hit importing a bare `catalog` binding
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors. If TS2589 ("Type instantiation is excessively deep") appears in an
# unrelated file, that is the known erp instantiation-budget problem (.ai/lessons.md) —
# re-run with `pnpm --filter erp exec tsgo --noEmit` to bypass a stale turbo cache before
# treating it as real.
pnpm --filter erp exec vitest run app/modules/workflows
# Expected: existing workflow tests pass
```

**Out of scope:** the nine files that import only `useWorkflowLabel` or the label-key helpers.

---

## Task 26: Offer custom-field triggers in the event picker

**Depends on:** Task 25
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/TriggerForm.tsx`

**Steps:**

1. `TriggerForm.tsx`'s event grouping memo (~lines 374-393) currently splits
   `Object.keys(WORKFLOW_EVENTS)` by `id.split(".")[0]`. Extend it to append this company's
   custom-field event ids per entity, from the catalog hook added in Task 25:
   ```tsx
   const catalog = useWorkflowCatalog();
   const customFields = useCustomFieldsSchema();
   ```
   Build the extra ids with `customFieldEventId(entity, field.id)` from `@carbon/workflows`,
   keeping only those for which `catalog.getEvent(id) !== undefined` — that single call
   enforces the `item` exclusion and the reference-only-entity rule in one place, so the rule
   never gets restated here.
2. Append the custom-field ids AFTER the generated ones within each entity group, so the
   shipped triggers stay at the top of a familiar list.
3. In the `CommandItem` for a custom-field event, render the field's own name as the label
   (`catalog.getPropertyLabel(entity, "customFields." + fieldId)`) plus a muted "Custom field"
   qualifier, so a custom field called `Priority` is distinguishable from a shipped column of
   the same name. Copy the existing item's markup; do not invent a new row shape.
4. Items are excluded (D-7). When the user picks the Item group and it has custom fields
   defined in the ERP that are not offered here, say so plainly rather than showing nothing
   unusual — add a single muted line under the Item group:
   `<Trans>Custom fields are not available for items yet.</Trans>`. Render it only for the
   `item` group.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm exec biome check apps/erp/app/modules/workflows/ui/Builder/config/forms/TriggerForm.tsx
# Expected: no error-severity findings
```
Criteria 1 and 12 are checked by hand in Task 29.

**Out of scope:** the condition/filter/lookup pickers — they read `catalog.getEntity().properties`
and pick up the overlay automatically once Task 25 lands.

---

## Task 27: Extend the trigger-event drift invariant

**Depends on:** Tasks 19, 20
**Files:**
- Modify: `packages/checks/src/invariants/workflow-trigger-event-drift.sql`
- Modify: `packages/checks/src/scripts/check-workflow-events.ts`

**Steps:**

1. `check-workflow-events.ts` filters on `catalog.getEvent(row.eventId) === undefined`. After
   Task 20 that already accepts a well-formed custom-field id, which is a *pattern* check, not
   an existence check. Strengthen it: for a row whose id matches the custom-field pattern, also
   require that a `customField` row with that id exists for that company and that its `table`
   matches the entity. Add to the SQL query a `LEFT JOIN` is not possible (the id is embedded
   in a string), so do it in a second query:
   ```ts
   const { rows: fields } = await client.query<{ id: string; table: string; companyId: string }>(
     `SELECT "id", "table", "companyId" FROM "customField"`
   );
   const known = new Set(fields.map((f) => `${f.companyId}:${f.table}:${f.id}`));
   ```
   then, for each subscription whose id parses as a custom-field event, resolve the entity's
   table via `REGISTRY_ENTRIES` and check membership. Report a distinct message:
   `subscribes to custom field "<id>", which no longer exists in this company` — that catches a
   trigger left behind after a custom field is deleted, which a bare pattern allow would not
   (criterion 11).
2. Leave `workflow-trigger-event-drift.sql` alone unless it hard-codes a list of known event
   ids. Read it first: it compares `workflowTriggerEvent` rows against the ids on the active
   version's trigger nodes and never consults the catalog, so a custom-field id flows through
   it correctly with no change. If that reading is wrong, STOP and report.
3. Note in a comment at the top of `check-workflow-events.ts` that neither check runs in CI
   (no job has DB credentials, per `packages/checks/AGENTS.md`) — they are operator tools.

**Verify:**
```bash
pnpm --filter @carbon/checks typecheck
# Expected: no errors
pnpm --filter @carbon/checks test
# Expected: all tests pass
```
Running the check itself needs a live database:
```bash
DATABASE_URL=<local> pnpm --filter @carbon/checks workflow-events
# Expected: "PASS  workflow-events  (N subscription(s) all resolve)"
```
Skip that command if the database is not running; do not start or rebuild it.

**Out of scope:** automatically cleaning up an orphaned `workflowTriggerEvent` row. The check
surfaces it; deleting it is deliberately not in scope.

---

## Task 28: Sync AGENTS.md and rules

**Depends on:** Tasks 1–27
**Files:**
- Modify: `apps/erp/app/modules/workflows/AGENTS.md`
- Modify: `packages/workflows/AGENTS.md`
- Modify: `packages/jobs/AGENTS.md`
- Modify: `.claude/rules/workflow-event-catalog.md`
- Modify: `.claude/rules/workflow-engine.md`
- Modify: `.claude/rules/workflow-matcher.md`
- Modify: `.claude/rules/workflow-actions.md`
- Modify: `.ai/specs/2026-08-19-workflow-improvements-round-2.md` — changelog + status
- Modify: `.ai/plans/automation/pending-changes.md` — mark round 2 done

**Steps:**

1. `apps/erp/app/modules/workflows/AGENTS.md`:
   - Line 55's file list is already fixed by Task 9. Confirm it now names
     `WorkflowLockAlert.tsx`, `WorkflowActiveSwitch.tsx` and `WorkflowsUpgradeOverlay.tsx`.
   - Line ~11 (the canvas-state paragraph) and line ~69 (the lock paragraph) must both mention
     the new `$id.positions.tsx` route, `updateWorkflowNodePositions`, and that it is
     deliberately NOT gated by `checkWorkflowVersionLock`.
   - Add the `shouldRevalidate` exclusion for `/positions`.
   - Document the store's two flags (`canChangeDefinition` vs `canMoveNodes`) and that
     movement follows permission, not the lock.
2. `packages/workflows/AGENTS.md` — document `custom-fields.ts`: the overlay, the one-segment
   `customFields.<id>` path, the DataType→ValueType map living in exactly one place, and that
   `WORKFLOW_EVENTS` stays closed with custom-field ids resolved by `getCatalogEvent`.
   Also record the new `CatalogInput.linkify` flag and `RuntimeContext.linkFor`.
3. `packages/jobs/AGENTS.md` — two stale lines to fix while here: it claims `update.ts` "also
   exports `toPlainValue`" (it lives in `actions/values.ts`), and the same claim appears in
   `.claude/rules/workflow-actions.md`. Fix both, and add the custom-field merge RPC to the
   update-action description.
4. `.claude/rules/workflow-event-catalog.md` — it says "6 reference-only" entities; the code has
   7 (it omits `nonConformanceType`). Fix that count, and add the custom-field event id shape.
5. `.claude/rules/workflow-matcher.md` — record that `computeEventIds` derives custom-field ids
   from the diff key and stays company-blind.
6. `.claude/rules/workflow-engine.md` — record the `custom-fields` step and the per-run overlay.
7. Update the spec's Status from `Draft — awaiting review` to `Implemented`, and append a
   changelog entry dated the day the work lands noting anything that diverged from the design.
   If nothing diverged, say so explicitly.
8. In `.ai/plans/automation/pending-changes.md`, mark the `## 8–15. Round 2 (2026-08-19)` block
   as done with a pointer to this plan file.

**Verify:**
```bash
grep -rn "toPlainValue" packages/jobs/AGENTS.md .claude/rules/workflow-actions.md
# Expected: no line claiming it is exported from update.ts
grep -n "WorkflowLockAlert" apps/erp/app/modules/workflows/AGENTS.md
# Expected: one hit, and the file exists
```

**Out of scope:** `docs/content/**` (the customer-facing docs site). If the user wants a docs
page for custom fields in workflows, that is a separate ask — flag it, do not write it.

---

## Task 29: End-to-end verification

**Depends on:** Tasks 1–28
**Files:** none — this task only runs commands and exercises the UI.

**Steps:**

1. Full static gate, scoped (a whole-repo `turbo run typecheck` OOMs — never run it):
   ```bash
   pnpm exec turbo run typecheck --filter=@carbon/workflows
   pnpm exec turbo run typecheck --filter=@carbon/jobs
   pnpm exec turbo run typecheck --filter=@carbon/notifications
   pnpm exec turbo run typecheck --filter=@carbon/documents
   pnpm exec turbo run typecheck --filter=@carbon/react
   pnpm exec turbo run typecheck --filter=@carbon/checks
   pnpm exec turbo run typecheck --filter=erp
   # Expected: no errors anywhere
   ```
2. Tests and the catalog gates:
   ```bash
   pnpm --filter @carbon/workflows test
   pnpm --filter @carbon/jobs test
   pnpm --filter @carbon/notifications test
   pnpm --filter erp exec vitest run app/modules/workflows
   pnpm run check:workflow-catalog
   # Expected: all pass; check-workflow-catalog exits 0
   ```
3. Lint — its own CI gate. Fix only error-severity findings; leave the pre-existing warnings:
   ```bash
   pnpm exec biome check
   # Expected: zero errors (warnings unchanged from the branch baseline)
   ```
4. Ask the user before browser work, then walk the 30 acceptance criteria in the spec's §7.
   The ones no command can prove:
   - **1, 12** — a Text custom field on Sales Order appears in the trigger picker labelled as a
     custom field; the Item group says custom fields are not available yet.
   - **2, 3** — publish it, then check `workflowTriggerEvent` and `eventSystemSubscription`
     rows, edit the field on a sales order and confirm exactly one `workflowRun`; edit an
     unrelated column and confirm none.
   - **4, 5, 6** — a condition on the field evaluates correctly and the step's `detail` records
     the clause; a List field offers exactly its options; a Numeric field compares with `>`.
   - **7, 8, 9, 10** — the field prints in a message; an Update action setting it leaves the
     other keys in the blob intact (read the row before and after); an out-of-range List value
     fails the step and writes nothing; company B's fields are invisible in company A.
   - **11** — deactivate the field: it leaves the pickers, the published workflow still parses,
     and `pnpm --filter @carbon/checks workflow-events` reports it.
   - **13, 14, 15, 16, 17** — the variable menu offers the whole Sales Order record; the in-app
     bell shows subject AND body with a working link (including the company switch); the email
     shows the same; `[click](javascript:alert(1))` renders as literal text with no anchor; the
     same record in a webhook body renders as a bare readable id with no markdown.
   - **18, 19, 20** — on a live version the trigger's Schedule button does nothing and is
     visibly disabled and a reload shows it unchanged; every input in all six node types is
     disabled; the banner appears with a "New version" button, and a user without
     `workflows_update` sees the other copy with no button.
   - **21, 22, 25** — drag a node and reload; run auto-arrange and reload; branch a new version
     and confirm the tidied positions carried over.
   - **23, 24** — hand-craft a POST to `/x/workflow/$id/positions` carrying a changed `data`
     payload and a new node id: only existing nodes' positions change. A POST to
     `/x/workflow/$id/save` on a live version still returns 409.
   - **26, 27, 28** — the notify action's second recipient field reads "Group" and lists no
     customer or supplier group while a hand-made company group is still there; the person
     field lists employees only; a workflow already pointing at a supplier group still runs and
     still displays that group's name.
   - **29, 30** — the grid is quieter at 24px in both light and dark themes; connectors are
     single continuous curves with the marching-ants dashes still running and the disconnect
     button still on the line.
   - Regression: open the notification bell and check at least three non-Workflow notification
     types still render and navigate correctly (Task 18 restructured that row for everyone).
5. Report results honestly. If a criterion fails, say which one and paste the output — do not
   mark the plan complete.
6. Do NOT commit. Stop here and report; the user commits on their own say-so.

**Verify:** the commands above, plus a written pass/fail against each of the 30 criteria.

**Out of scope:** rebuilding the database, deploying, and opening a PR.
