# Workflows Module

Customer-authored automation. A workflow is a graph of nodes (trigger, condition, compute, lookup, filter, action) stored as a versioned definition; the engine in `packages/jobs` walks it. This module is the ERP front end: the list page, the full-screen builder canvas, versioning and publishing.

The definition schema, validator, catalogs, matcher and engine all live outside this module in `packages/workflows` and `packages/jobs`. Read `packages/workflows/AGENTS.md` before touching anything that imports `@carbon/workflows`.

## Key Domain Concepts

- **Workflow** — the `workflow` row. Carries `ownerId` and `publishedVersionId`. That pointer IS the on/off switch: set means the workflow runs that version, `NULL` means it is a draft and nothing fires. There is no separate `active` boolean — it was a second switch for the same idea and was removed (migration `20260824163808_workflow-publish-unpublish.sql`). Because the pointer names a version rather than carrying a flag, exactly one version can be published at a time by construction.
- **Version** — a `workflowVersion` row holding `nodes`, `edges` and `formatVersion`. Numbered, never named.
- **Canvas state** — `workflow.canvasState` JSONB: `{ x, y, zoom, panOnScroll }`. Per workflow (not per user, not per version), written by `$id.canvas.tsx` through `updateWorkflowCanvasState`, restored as `defaultViewport`. Node collapse is NOT here — `expanded` lives on each node in the definition and rides the autosave. `/save`, `/canvas` and `/positions` are all excluded from `shouldRevalidate`; revalidating on a canvas write would snap the viewport back to where it was on load, and revalidating on a positions write would remount the builder store mid-drag.
- **Definition** — `{ formatVersion, nodes, edges }`, validated by `workflowDefinitionSchema` from `@carbon/workflows`. `CURRENT_DEFINITION_FORMAT_VERSION` is **3**; the SQL column default is a stale **1**, so the app always writes the constant explicitly.
- **Publish** — validate → set `publishedVersionId` → `syncWorkflowTriggers` → wake the scheduler. One route does all four; splitting them leaves a workflow that looks published and never fires.
- **Unpublish** — the inverse and the only off switch: `publishedVersionId = NULL` → the same `syncWorkflowTriggers`, which is what deletes the trigger rows and clears `nextRunAt`. It takes no boolean, because publishing needs a version id and has to validate first.
- **The published version is read-only.** Editing a published workflow means creating a new version, the same rule released item revisions follow.

## Safety

### Always
- MUST read a version through `readWorkflowVersion(row)` from `@carbon/workflows` — the only legal read path. On `{ ok: false }` render the failure and **do not mount the canvas**; a blank canvas would let an autosave overwrite a definition nobody could see.
- MUST call `checkWorkflowVersionLock` in every mutating route. The published-version lock is enforced server-side, not only in the UI. The ONE deliberate exception is `$id.positions.tsx` — node positions carry no behaviour, and `updateWorkflowNodePositions` writes only `position`, only onto node ids that already exist, so that route cannot change what a workflow does even when called by hand.
- MUST write `formatVersion: CURRENT_DEFINITION_FORMAT_VERSION` on every definition write.
- MUST scope every query by `companyId`.
- MUST build version insert/update objects with every key explicitly present — PostgREST writes `NULL` for a present-but-`undefined` key, which would null `nodes`/`edges` past their `'[]'` defaults.

### Ask First
- Changing who may own a workflow. A workflow runs with its owner's permissions.
- Adding undo. Its absence is a deliberate, recorded decision (recovery is via versions).

### Never
- Never write `workflowTriggerEvent`, `workflow.nextRunAt` or `eventSystemSubscription` directly. `syncWorkflowTriggers` is their sole writer, and it is what makes a workflow able to fire at all.
- Never let `$id.owner.tsx` accept a submitted `ownerId`. It writes the session user, always. An arbitrary id would let anyone with `workflows_update` borrow someone else's access.
- Never derive node output handles from a hand-written list — use `getNodeHandles(node)`, the same function the validator uses, or the canvas can draw a handle the validator calls `UNKNOWN_HANDLE`.
- Never add a per-kind component or a second per-kind lookup. All six node kinds render through one `WorkflowNodeCard`; everything that differs between them is data in `ui/Builder/nodes/meta.ts`, which the palette and the card both read. A new kind is a row in `NODE_KIND_META` plus a row in `nodeTypes` — both are exhaustive `Record<WorkflowNodeType, …>`, so missing either fails the build.
- Never re-export `@carbon/workflows/labels` through the package barrel. `msg` is a build-time macro; only Vite-built app code may import it.

## Validation Commands

```bash
pnpm exec turbo run typecheck --filter=erp   # the app package is named `erp`, not @carbon/erp
pnpm --filter erp exec vitest run app/modules/workflows/ui/Builder/graph.test.ts
pnpm exec biome check apps/erp/app/modules/workflows apps/erp/app/routes/x+/workflow+ apps/erp/app/routes/x+/workflows+
pnpm --filter @carbon/checks workflow-events   # trigger-row drift after a publish/unpublish
```

## Layout

```
modules/workflows/
├── workflows.models.ts     # zod validators
├── workflows.service.ts    # Supabase reads/writes for workflow + workflowVersion
├── workflows.server.ts     # lock predicates, publish, unpublish — server only
├── types.ts                # BuilderNode / BuilderEdge React Flow aliases
├── index.ts                # barrel (does NOT export workflows.server)
└── ui/
    ├── WorkflowsTable.tsx, WorkflowForm.tsx, WorkflowLockModal.tsx,
    │   ConfirmUnpublishWorkflow.tsx, WorkflowsUpgradeOverlay.tsx
    ├── useWorkflowsSubmodules.tsx
    └── Builder/            # canvas, store, node cards, palette, versions, issues
```

Routes split in two trees: `x+/workflows+/` (list, create, rename, delete, with the module sidebar) and `x+/workflow+/` (the full-screen builder and its POST-only actions, no sidebar).

## Key Service Functions

- `getWorkflows` / `getWorkflow` — list and detail reads
- `getWorkflowVersions` / `getWorkflowVersion` / `getWorkflowVersionNumbers` — version reads (flat selects; nested embeds across `workflow` + `workflowVersion` trip TS2589 in this app)
- `insertWorkflow` / `updateWorkflow` — separate rather than one `upsert*`
- `insertWorkflowVersion` / `updateWorkflowDefinition` / `deleteWorkflowVersion`
- `updateWorkflowOwner` — takes the session user, never a submitted id
- `checkWorkflowVersionLock` (server) — the published-version lock; the rule is one equality against `publishedVersionId`, so there is no helper wrapping it
- `updateWorkflowNodePositions` (service) — the positions-only writer behind `$id.positions.tsx`
- `publishWorkflowVersion` / `unpublishWorkflow` (server) — both call `syncWorkflowTriggers`, which uses Kysely and **bypasses RLS**; the route's `requirePermissions` is the only authorization gate

## Builder Notes

- One zustand store per builder instance, vanilla `createStore` in a ref behind a context — the `DocumentTemplateEditor` idiom. React Flow keeps viewport and interaction state.
- **No undo.** Deliberate; recovery is via versions.
- Autosave is a 1s debounce with two modes. An editable version posts the whole definition to `$id.save.tsx`; a PUBLISHED version posts positions only, to `$id.positions.tsx`. The route exports `shouldRevalidate` returning false for both — without it every autosave re-seeds the canvas from server state mid-edit.
- The builder store has TWO read-only reasons, not one: `canChangeDefinition` (`canEdit && !isVersionLocked`) gates config, nodes, edges and `expanded`; `canMoveNodes` (`canEdit` alone) gates dragging and auto-arrange. Movement follows PERMISSION, not the lock, so a published workflow can still be tidied. Every store mutator is gated on one of them — `updateNodeData` in particular, since every node config form funnels through it.
- **A draft saves half-filled; only publishing demands completeness.** `clauseSchema.right` and `lookupMatchSchema.value` are optional and `lookupMatchSchema.field` may be `""`, so a node the user is still filling in round-trips through `workflowDefinitionSchema` (and therefore `readWorkflowVersion`) instead of failing autosave. `validateDefinition`'s config layer is what reports each gap as `INCOMPLETE_CONFIG` and blocks publish. Never re-tighten those three fields to make a runtime path simpler — the runtime skips with a reason (`compare.ts`, `lookup.ts`) precisely so it does not have to. When `/save` does return `ok: false`, `Autosave.tsx` raises the server's `error` string as a toast and the route logs the zod issues.
- Drawn loops are blocked at connection time by `isValidConnection` + `wouldCreateCycle`. The validator's `CYCLE` check stays as the backstop.
- Converging edges are allowed: the engine is a first-arrival OR-join by design.
- The trigger node cannot be deleted — `onNodesChange` filters its `remove` change.
- Nodes collapse to a one-line summary via a per-node `expanded` flag (`store.ts` `setNodeExpanded`), toggled by the card's button and by `BuilderControls`' collapse/expand-all. There is no zoom threshold. **Every kind collapses, including `condition`** — a collapsed card drops its port labels and closes the gap between its source handles (`NodeCard.tsx`), so they stack on the midline and read as one dot. That is what makes a many-path card collapsible: without it, the labels smear and the handles look like separate targets that no longer line up with the paths they came from.
- Every node kind has a form in `ui/Builder/config/forms/`. `NodeFormProps<K>` narrows `node.data` to the kind's slice of the shared definition schema — never re-declare a node's data shape in a form.
- Ports get their id, label, tone and anchor from `ui/Builder/ports.ts`, which derives ids from `getNodeHandles`. Never hand-write a handle list, and never label a port anywhere else — `ports.test.ts` enforces the first rule.
- Every source handle is `ui/Builder/OutputHandle.tsx` — there is no bare `<Handle type="source">` left. It draws the dot, the right-side `PortLabel`, and the 2s-hover panel listing what a step wired there could read. Handle *appearance* (`handleClass`, `PortLabel`, `PortTone`) lives in `ui/Builder/handles.tsx` so `NodeCard` and `OutputHandle` do not import each other.
- **Outputs are per node, not per handle.** `packages/workflows/src/definition/nodes.ts` gives each kind an `outputs(node, ctx)` — dynamic (a trigger intersects every selected event; an action reads the catalog), `undefined` when the node is not configured enough to know, `{}` for `condition`, which only routes. The hover panel therefore asks `variablesFromHandle`, which hangs a throwaway node off the handle and re-uses `availableVariables`; branch reachability and the `guaranteed` flag stay in one implementation.
- Node cards subscribe through `ui/Builder/selectors.ts` (scalars) or read once via `useBuilderStoreApi()`. Subscribing to `state.nodes` re-renders every card on every drag frame.

### Value fields

- `fields/control.ts` `pickControl` is the single ordered decision for which control a value renders in — `inline` (the `{` editor), `chip` (an already-picked reference) or `literal` (everything `LiteralControl` dispatches). Order matters: `choices` must disqualify the free-text rule or every enum column loses its dropdown. Add a case there, never an `if` in `ValueField`.
- `fields/Field.tsx` owns the label / required marker / issue shell. No control re-implements it.
- Four controls, dispatched in `config/forms/ActionForm.tsx` in this order: `PairsField` when the catalog input sets `pairs`, `MultiChoiceField` when `isMultiSelect(input)` (`choices` on a `t.list` of text — derived, never a declared flag, so it cannot disagree with the type), `TemplateField` when it sets `template`, `ValueField` otherwise. Only the last consults `pickControl`. `TemplateField` is the prose editor — it takes line breaks (`multiline`, `minRows={4}`) so a JSON payload reads the way it is written; `VariableText` encodes a break as a paragraph and a `"\n"` in the stored text, so newlines survive the round trip.
- `fields/pairsRows.ts` holds `PairsField`'s row maths and is macro-free by the same rule as `variableMenu.ts` — the component pulls in the glossary, which vitest cannot compile. Rows are keyed by position, an emptied set is stored as absent, and per-row errors arrive as `rowIssuesForField(issues, …)` reading `<field>.entries.<n>` (`partIssuesForField` reads `<field>.parts.<n>`; a variable inside a row nests both).
- `fields/multiChoice.ts` holds `MultiChoiceField`'s value round-trip and is macro-free for the same reason as `pairsRows.ts`. Picks are stored in the order the choices are OFFERED, not clicked (two authors ticking the same channels must produce the same definition, or autosave churns), and an emptied set stores as absent. `fields/choiceOptions.tsx` is where a choice gets its title, its description and whether it is available — the notify job skips a channel the company has no plan or integration for in SILENCE, so build time is the only place the author can be told. `choiceState` owns what renders ticked and what the author may not touch, and the two are NOT the same: a choice in `LOCKED` (`inApp`) is ticked and frozen because the platform sends it regardless, while an UNAVAILABLE choice can only never be ADDED — one already stored stays removable, or a node seeded with a channel the company has no plan for is a dead end.
- `CatalogInput.defaultValue` is seeded into `inputs` by `ActionForm` when the action is picked — nothing reads it at run time, so a required input with a default still reports `MISSING_INPUT` on a node saved before the default existed.
- `showWhen` is enforced in **two** places in `ActionForm`: the visible-input list and an early return inside `renderInput`, because a `requireOneOf` member renders through a path the list never touches. Closing a gate clears the gated input's value in the same `updateNodeData` call.
- **`{…}` is display only.** A reference is stored as `{ kind: "ref", nodeId, output, path }` and binds to the node **id**; the braces and the label are a rendering of it, so a rename never touches storage. `fields/tokenId.ts` is the only encoder/decoder and `fields/valueParts.ts` the only converter — a token label must come from `refLabel` so an inserted chip and a stored chip read identically (a mismatch trips the editor's remount check and steals focus mid-keystroke).
- Serialization rule in `valueParts.ts`: plain text stays a `literal`, a lone variable stays a bare `ref`, only mixed content becomes a `template`. Templates are legal only where a string is expected (`packages/workflows/src/definition/nodes.ts`).
- Every field reaches variables through the same `{` trigger. `fields/VariableTreeMenu.tsx` is the only menu; it is hosted by `fields/InlineVariableMenu.tsx` (inside the ProseMirror suggestion popup) and `fields/VariableMenuPopover.tsx` (a Radix popover, for controls you cannot type a brace into — those render `fields/VariablePickControl.tsx` inside their own border). `fields/menuNav.ts` is the single keyboard implementation and is unit-tested apart from both hosts, so a key can never behave differently in one of them. `VariableTreeMenu` binds it to a **document-level capture-phase `keydown`** rather than taking keys from its host: delegating through the ProseMirror suggestion plugin (or the popover's search input) is the thing that kept breaking. Focus deliberately stays in the field so search-as-you-type keeps working; the highlighted row is `aria-selected`, not focused. The listener no-ops when the menu's own root is detached or invisible — the editor popup is *hidden*, not unmounted, on dismissal, and a menu nobody can see must not eat arrow keys. Escape is never claimed; it belongs to whichever popup is wrapping the menu.
- The tiptap popup mounts outside the React tree, so it can reach neither context nor a store hook. `fields/menuBridge.ts` bridges it with one module-level slot. Do not replace this with context — context does not reach a `ReactRenderer` subtree. The slot is published **on focus** (`onFocusCapture` in `InlineValueEditor`), never on mount: every value field mounts an editor, so a mount-time publish hands the slot to whichever one rendered last, and its unmount then blanks the menu for all of them. `retractVariableMenuData` only clears the slot if the caller still holds it.
- `VariableMenuPopover` uses `PopoverAnchor`, not `PopoverTrigger` — the control it wraps contains a Select and text inputs, and a trigger toggles the menu on every click that lands in any of them. `open` is therefore driven only by the field, so the menu's data must be built from an effect on `open`, not from `onOpenChange` (which never fires for a `{}`-button or typed-brace open).
- `fields/variableMenu.ts` exports both shapes: `variableTree` (browse, one level at a time) and `variableMenuItems` (the flat search index). Search matches the full `Step › output › property` breadcrumb, so it must keep coming from the flat list, not from the tree.
- `variableMenu.ts`, `tokenId.ts` and `menuNav.ts` are macro-free by rule so the vitest runner can compile them — pass labels in as a parameter (`labelFor`), never import `catalog.ts` or the Lingui macro.
- Both variable menus read through `useVariablesGetter` (computed on demand from `getState()`), never `useAvailableVariables`, which subscribes and re-renders on every drag frame. Reserve the subscribing hook for code that renders from the list.
- `nodes/kinds.ts` holds the per-kind facts layout and store code need (`NODE_CARD_WIDTH`). It exists because `nodes/meta.ts` reaches the translation catalog, which the unit-test runner cannot compile — importing `meta.ts` from `graph.ts` breaks `graph.test.ts`. Anything macro-free that non-React code needs belongs in `kinds.ts`; label-bearing presentation stays in `meta.ts`, and pure label helpers live in `labelKeys.ts` (re-exported by `catalog.ts` for React callers).
- Per-field issue messages go through `ui/Builder/issues.ts` `issueForField`, which also matches `<field>.parts.<n>` so a bad variable inside a template has somewhere to show. Validation still runs server-side on publish only.
- Card-level issues (the red border plus the message list under the body) are gated on `selectIsConnected` — a node with no edges in either direction shows none of them. An unwired node is a draft parked on the canvas that no run can reach, so flagging it is noise. The node's own form still renders its field errors regardless; only the card chrome is suppressed.

## Related

- `packages/workflows` — definition schema, validator, catalogs, `syncWorkflowTriggers`, pure runtime
- `packages/jobs/src/workflows/` — the matcher, engine and scheduler
- `.claude/rules/workflow-engine.md`, `.claude/rules/workflow-matcher.md`, `.claude/rules/workflow-event-catalog.md`
