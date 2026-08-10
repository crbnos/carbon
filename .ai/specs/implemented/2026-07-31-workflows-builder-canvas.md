# Workflows — Phase 7: the builder canvas

## TLDR

- The first front-end phase. Adds the `Workflows` module to the ERP app: a list page, a full-screen
  builder page, and the navigation entry that phase 1 deliberately withheld.
- **The canvas is the page.** `x+/workflows+/_index.tsx` lists workflows; `x+/workflow+/$id.tsx` is a
  full-screen builder with a slim header (name, owner, on/off, version menu, Publish) and no module
  sidebar.
- **A node is a form, not a label.** Each node card is a header (name + one-line description) over a
  body of fields, with named output ports along the bottom edge. Phase 7 builds that card and its
  body *slot*; phase 8 renders what goes inside the slot.
- **Nodes are always open**, and swap to a one-line summary automatically below `LOD_ZOOM = 0.66` so a
  large graph stays readable. There is no side inspector panel.
- **The active version is read-only.** Editing a live workflow means creating a new version first —
  the same rule released item revisions and make-method versions already follow, rendered with the
  same `Alert variant="warning"` banner plus a lock icon and tooltip.
- **Autosave**, debounced 1s, with a quiet `Saved` marker. Safe precisely because the version being
  edited is never the live one.
- **Publish** = `validateDefinition(definition, createWorkflowCatalog())` returns `[]` → set
  `workflow.activeVersionId`, turn `active` on if it was off, then `syncWorkflowTriggers` and a
  scheduler wake in the same request. A separate On/Off switch is the kill switch.
- **Drawn loops are blocked at connection time** via `isValidConnection`; the validator's `CYCLE`
  check stays as the backstop. Converging edges (two branches into one node) are allowed — the engine
  is an OR-join by design.
- **A workflow's owner is always the person setting it.** You may take ownership; you may never point
  a workflow at somebody else's permissions.
- **No undo.** A deliberate, recorded deviation from the phase brief.

## Problem Statement

Phases 1–6 built the whole of the workflows engine and nothing a customer can see. The five tables,
the shared definition schema and validator (`packages/workflows`), the matcher, the engine, the
action/event/operation catalogs and the scheduler all exist and are tested. There is no way to create
a workflow.

Concretely, today:

- `apps/erp/app/modules/workflows/` does not exist. No route under `apps/erp/app/routes` mentions
  workflows (`x+/issue-workflow+` is the unrelated quality NCR feature).
- `apps/erp/package.json:34` already declares `"@carbon/workflows": "workspace:*"`, and no file in
  `apps/` imports it.
- `workflows_view` / `_create` / `_update` / `_delete` appear only in
  `packages/database/supabase/migrations/20260730142317_workflows-foundation.sql`. Zero TypeScript
  references. `apps/erp/app/hooks/useModules.tsx` has a hard-coded 14-module list with no `workflows`
  entry, so there is no navigation.
- Nothing anywhere calls `syncWorkflowTriggers`, which is the only writer of `workflowTriggerEvent`
  and of `workflow.nextRunAt`. Until something does, no workflow can ever fire.

The `Workflows` module enum value, the `employeeTypePermission` seeding and the RLS policies are
already in place, so the permission matrix at `apps/erp/app/components/PermissionMatrix.tsx` will
already show Workflows — it is driven by the `modules` database view. Everything else is missing.

## Proposed Solution

### A. Where it lives — module, routes, navigation

Follows the house rule from `.ai/lessons.md`: module folder = permission module = nav module. Two
route trees, matching the `x+/quality+/issue-workflows.tsx` (list) + `x+/issue-workflow+/$id.tsx`
(detail) split, and the full-screen precedent of `x+/templates+/` and `x+/traceability+/graph.tsx`.

```
apps/erp/app/modules/workflows/
├── workflows.models.ts     # zod validators (create, rename, publish, save-definition, toggle)
├── workflows.service.ts    # Supabase reads/writes for workflow + workflowVersion
├── workflows.server.ts     # lock predicates + the sync/scheduler call, server-only
├── types.ts                # BuilderNode/BuilderEdge React Flow aliases
├── index.ts                # barrel
├── AGENTS.md
└── ui/
    ├── WorkflowsTable.tsx
    ├── WorkflowForm.tsx            # create/rename modal
    ├── WorkflowLockAlert.tsx       # mirrors ReleaseLockAlert
    ├── useWorkflowsSubmodules.tsx
    └── Builder/
        ├── WorkflowBuilder.tsx     # ReactFlowProvider + shell
        ├── BuilderHeader.tsx
        ├── NodePalette.tsx
        ├── NodeCard.tsx            # shared card chrome + body slot
        ├── nodes/{Trigger,Condition,Entity,Lookup,Filter,Action}Node.tsx
        ├── edges/WorkflowEdge.tsx
        ├── IssuesPanel.tsx
        ├── VersionMenu.tsx
        ├── store.ts                # per-instance zustand store
        └── context.tsx             # provider + selector hook

apps/erp/app/routes/x+/workflows+/
├── _layout.tsx            # handle: { breadcrumb, to: path.to.workflows, module: "workflows" }
├── _index.tsx             # the list; <Outlet/> renders new/rename/delete as modals
├── new.tsx
├── $id.rename.tsx
└── delete.$id.tsx

apps/erp/app/routes/x+/workflow+/
├── _layout.tsx            # bare <Outlet/>, no module sidebar
├── $id.tsx                # the builder
├── $id.save.tsx           # autosave target, POST only
├── $id.publish.tsx        # POST only
├── $id.toggle.tsx         # POST only
├── $id.owner.tsx          # POST only — take ownership
├── $id.version.new.tsx    # POST only
└── $id.version.delete.$versionId.tsx
```

Navigation additions, all client-side:

1. `apps/erp/app/utils/path.ts` — `workflows`, `newWorkflow`, `workflow(id)`, `workflowSave(id)`,
   `workflowPublish(id)`, `workflowToggle(id)`, `newWorkflowVersion(id)`,
   `deleteWorkflowVersion(id, versionId)`, `deleteWorkflow(id)`.
2. `apps/erp/app/hooks/useModules.tsx` — one entry:
   `{ key: "workflows", permission: "workflows", name: t\`Workflows\`, to: path.to.workflows, icon: LuWorkflow }`.
3. `apps/erp/app/components/Layout/Topbar/Search.tsx` — register `useWorkflowsSubmodules` in
   `useGroupedSubmodules()` so the command palette finds the routes. Easy to miss; it has its own
   acceptance criterion.

### B. The workflow list

`Table` from `~/components` with `withSearch`, modelled on
`apps/erp/app/modules/quality/ui/IssueWorkflows/IssueWorkflowsTable.tsx`. Columns: name, description,
owner (avatar + name), live version (`v3` badge, or `—` when nothing is promoted), on/off switch,
updated at. `primaryAction` is a `New` button gated on `permissions.can("create", "workflows")`.

The on/off switch posts to `path.to.workflowToggle(id)` — the same route the builder header uses, so
there is exactly one place that toggles a workflow, and therefore exactly one place that has to
remember to re-sync triggers (§I).

Creating a workflow opens a `ModalDrawer` `ValidatedForm` with name and description, held in local
`useDisclosure()` state and submitted with `useFetcher` to an action-only route — the
`RequiredActionForm.tsx` idiom. The list is an index route, so it cannot nest child routes; the
create, rename and delete routes therefore have no UI of their own. On success the action
`throw redirect(...)`s straight into the builder, which is where a customer actually wants to be. The new workflow is created with `active = false`, `activeVersionId = null`,
`ownerId = userId`, and a first `workflowVersion` row at `versionNumber = 1` holding a single
trigger node (§L).

`workflow.webhookSecret` is generated by a column default and is shown **once**, in the success state
of the create modal, with a copy button and the line "this is the only time it is shown". It is
needed to verify signed outbound webhook calls; there is no reveal-later route.

### C. The builder page shell

Full-screen, `h-[calc(100dvh-49px)]`, living in its own `x+/workflow+/` tree with a bare `_layout.tsx`
so no module sidebar renders (the same escape used by `templates+` and `traceability+/graph.tsx`,
avoiding the `hideModuleSidebar` handle entirely).

Header, left to right: workflow name (inline-editable when writable), a version chip
(`v4 · editing`), a live chip (`v3 live`, green) when a different version is promoted, an autosave
marker, then on the right the On/Off switch, a **Versions** menu, and the primary **Publish v4**
button.

Body: a 118px palette rail on the left (§F), and the canvas filling the rest. There is no right-hand
inspector — a node's fields live on the node.

State is one zustand store per builder instance, created with vanilla `createStore` inside a `useRef`
in a provider and read through a selector hook, exactly as
`apps/erp/app/components/DocumentTemplateEditor/context.tsx` does. It holds: `nodes`, `edges`,
`selectedNodeId`, `issues`, `saveState` (`idle | saving | saved | error`), `isReadOnly`, and
`baseline` for the autosave dirty check. React Flow's own store handles viewport and interaction.

### D. The canvas

`@xyflow/react` 12.10.2, already a dependency, wrapped in `<ReactFlowProvider>` at the route level so
the header and palette can call `useReactFlow`.

```tsx
<ReactFlow
  nodes={nodes} edges={edges}
  onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
  onConnect={onConnect} isValidConnection={isValidConnection}
  nodeTypes={nodeTypes} edgeTypes={edgeTypes}
  proOptions={{ hideAttribution: true }}
  minZoom={0.25} maxZoom={2}
  nodesDraggable={!isReadOnly} nodesConnectable={!isReadOnly}
  elementsSelectable
  deleteKeyCode={isReadOnly ? null : ["Backspace", "Delete"]}
  onlyRenderVisibleElements
  defaultEdgeOptions={{ type: "workflow" }}
>
  <Background variant={BackgroundVariant.Dots} gap={16} />
  <Controls showInteractive={false} />
  <MiniMap pannable zoomable />
</ReactFlow>
```

This is the first connectable React Flow surface in the repo — `onConnect`, `addEdge` and
`isValidConnection` appear nowhere today — so none of the existing five usages can be copied wholesale.
What *is* copied: `proOptions`, the dot background, `onlyRenderVisibleElements`, and the
route-level `links()` CSS import style from `x+/traceability+/graph.tsx`.

**Level of detail.** `useStore((s) => s.transform[2])` gives the live zoom. Below
`LOD_ZOOM = 0.66` every node renders its collapsed summary row instead of its field body. This is the
concession that makes always-open nodes viable: a condition with three paths and three clauses each
is roughly 700px tall, and six of those do not fit on a screen at any usable zoom.

**Keyboard.** React Flow owns Delete/Backspace and the arrow keys. Per `.ai/lessons.md:371`, the node
body must stop key events from reaching the canvas while a field has focus, and must skip events
targeting portaled overlays (`[data-radix-popper-content-wrapper]`, `[role=menu|listbox|dialog]`).
Field pop-ups (the property picker) portal to `document.body` rather than rendering inside the node,
so they are not scaled by the canvas transform and are not clipped by the node's bounds.

### E. The node card

One shared `NodeCard` component supplies the chrome; the six node components fill it in.

```
┌─────────────────────────────────────────┐
│ [icon]  ACTION                          │  ← kind, uppercase, muted
│         Notify a person                 │  ← title, from the catalog label
│         Sends an in-app or email message│  ← one-line description
├─────────────────────────────────────────┤
│  <body slot — the node's fields>        │  ← phase 8 fills this
├─────────────────────────────────────────┤
│  ( worked )   ( failed )                │  ← named ports, each with its Handle
└─────────────────────────────────────────┘
```

- **Title** comes from `WORKFLOW_LABELS` where the node is configured (`WORKFLOW_LABELS[node.data.action]`)
  and falls back to the kind name when it is not. `labels.generated.ts` is imported by deep path
  (`@carbon/workflows/src/catalog/labels.generated`) because `msg` is a build-time macro and the
  barrel deliberately does not re-export it.
- **Ports** are rendered from `getNodeHandles(node)` — the same function the validator uses, so the
  canvas cannot draw a handle the validator would call `UNKNOWN_HANDLE`. Names: `out` for trigger,
  entity and filter; `success` / `failure` for action and lookup; one per `path.id` for a condition,
  labelled `If`, `Else if`, `Otherwise`.
- **A single target Handle** sits on the top edge with id `"in"`. `edge.targetHandle` is written as
  `"in"` always; the validator never reads it.
- **Issue anchoring.** A node carrying an issue gets a red outline and an `n problems` badge; the
  badge count comes from `issues.filter(i => i.nodeId === node.id)`. Phase 7 does not place issues on
  individual fields — `WorkflowIssue.field` is a dotted path into `data`, and resolving it to a
  control is only meaningful once phase 8 has built the controls.

Node kinds map to types by a `Record<WorkflowNodeType, ComponentType>` with no `default:` arm
anywhere in the file, so adding a seventh kind fails the build rather than shipping invisibly
(`.ai/lessons.md:605`).

### F. The palette

A left rail listing the six kinds with a colour swatch and name, each both clickable and draggable.

- **Click** adds the node below the current selection (or below the trigger if nothing is selected),
  offset to avoid overlapping an existing node, and connects it from the selection's first free
  handle when there is one.
- **Drag** drops it at the pointer, unconnected.
- **A new node is created with the minimum its schema accepts**, so it parses and renders before
  phase 8 configures it. One exception is load-bearing: a condition is seeded with an `if` path and an
  `else` path, because a condition's output handles *are* its paths — with none, the node has no
  outputs and nothing downstream can be wired to it at all.
- **Trigger is special.** Every definition needs exactly one (`NO_TRIGGER` / `MULTIPLE_TRIGGERS`), so
  the trigger entry is disabled with a tooltip once one exists, and the trigger node cannot be
  deleted. Deleting is prevented in `onNodesChange` by filtering out the `remove` change for it.
- The rail is hidden entirely when `isReadOnly`.

### G. Loading and saving a definition

**Load.** The loader reads the `workflowVersion` row and calls `readWorkflowVersion(row)` from
`@carbon/workflows` — the only legal read path. It returns
`{ok: true, definition}` or `{ok: false, failure: "unreadable" | "future-format" | "invalid", message}`.
On failure the builder renders an error state and **the canvas does not mount**. A blank canvas here
would let an autosave overwrite a definition nobody could see.

**Save.** `POST` to `$id.save.tsx` with `nodes`, `edges` and `formatVersion` as `JSON.stringify`'d
form fields (the `DocumentTemplateEditor` idiom). The action:

1. `assertIsPost`, then `requirePermissions(request, { update: "workflows" })`.
2. Refuses if the target version is the workflow's `activeVersionId` — a 409-shaped
   `data({ error }, ...)`. The lock is enforced server-side, not only in the UI.
3. Parses through `workflowDefinitionSchema` so malformed JSON never reaches the column.
4. Writes `nodes`, `edges`, `formatVersion: CURRENT_DEFINITION_FORMAT_VERSION` (**2** — the SQL column
   default is a stale `1`), `updatedBy`, `updatedAt` in one row update.

Positions are stored and never validated for meaning.

**Autosave.** A 1s debounce on any change to `nodes`/`edges`, submitted with `useFetcher`. The header
shows `Saving…` then `Saved`. Two details that matter:

- The save route returns `data({ ok: true })` and the builder route sets `shouldRevalidate: () => false`
  for it. Without that, every autosave revalidates the loader and re-seeds the canvas from server
  state mid-edit — the stale-prop-seeding trap in `.ai/lessons.md:381`.
- Save is skipped entirely when `isReadOnly`.

### H. Versions

A **Versions** menu in the header, following the `QualityDocumentHeader` / `ProcedureHeader` pattern:
`New version` at the top, a separator, then a radio group of existing versions (`V3` badge, a `Live`
chip on the promoted one) that navigates to `?version=<id>`.

- **New version** copies the current version's `nodes`/`edges` into a new row at
  `max(versionNumber) + 1` and navigates to it. This is the only way to change a live workflow.
- **A version cannot be deleted while it is the active one.** The database would set the pointer to
  null via `ON DELETE SET NULL`, silently deactivating the workflow; the route refuses instead.
- Versions carry no name or note — `workflowVersion` has only `versionNumber`. Not adding one:
  the number is the label, and a description field is scope the phase brief does not ask for.

**The active version is read-only.** `isReadOnly = !permissions.can("update", "workflows") || versionId === workflow.activeVersionId`.
Rendered exactly like released item revisions: a `WorkflowLockAlert` (`Alert variant="warning"` with
`LuTriangleAlert`, `AlertTitle`, `AlertDescription`) across the top of the canvas reading *"This
version is live. Create a new version to make changes."* with a `New version` button in it, plus an
`LuLock` icon and `Tooltip` beside the version chip. `getWorkflowLockFlags()` mirrors
`getReleaseLockFlags` in `apps/erp/app/modules/items/ui/Item/ReleaseLockAlert.tsx`, and
`checkWorkflowVersionLock()` in `workflows.server.ts` mirrors `checkRevisionLock` as the server-side
gate every mutating route calls.

### I. Publishing and the on/off switch

**Publish** (`$id.publish.tsx`) is one route doing five things in order:

1. `requirePermissions(request, { update: "workflows" })`.
2. Read the version, `readWorkflowVersion`, then
   `validateDefinition(definition, createWorkflowCatalog())`. A non-empty `WorkflowIssue[]` returns
   `data({ issues }, ...)` and **nothing is written**.
3. `UPDATE "workflow" SET "activeVersionId" = $versionId, "active" = TRUE`.
4. `syncWorkflowTriggers(db, companyId, workflowId)` — rewrites `workflowTriggerEvent` delete-then-insert,
   writes `workflow.nextRunAt`, and reconciles the `eventSystemSubscription` rows. This is what makes
   a workflow able to fire at all.
5. If it returns `{ scheduled: true }`, wake the scheduler chain so a scheduled workflow starts within
   ten minutes instead of waiting up to an hour for the backstop.

**How the wake is sent.** `ensureSchedulerChain()` exists at
`packages/jobs/src/inngest/functions/workflows/scheduler.ts:97` and its own comment says the
activation route calls it — but it is only reachable through the `@carbon/jobs/inngest` subpath,
which is marked *server-only on purpose: the app bundle imports `@carbon/jobs`, not this subpath*.
Rather than widen that boundary, the route uses the helper every other app→jobs call already uses:

```ts
import { trigger } from "@carbon/jobs";
await trigger("workflow-scheduler-wake", { bookedFor: null });
```

This needs one line added to the `taskToEvent` map in `packages/lib/src/trigger.ts`. The event
`carbon/workflow-scheduler.wake` and its payload type already exist at `packages/lib/src/events.ts:592`,
so the call is fully typed. Skipping `ensureSchedulerChain`'s staleness check is safe: the scheduler
function is `singleton skip` and holds a Redis chain token, so a redundant wake converges back to one
chain — a wasted wakeup, never a wrong run.

`syncWorkflowTriggers` takes a Kysely client and **bypasses RLS**, which is why step 1 is the real
authorization gate and why it must not be reachable from anywhere the permission is not checked.

When a *different* version is already live, Publish first asks through the shared `Confirm` component
— "Publish v4? Version 3 is live now and will be replaced." — the same courtesy the make-method
"Set as Active Version" flow already extends. Publishing the first version of a workflow does not ask.

The **On/Off switch** posts to `$id.toggle.tsx`, which sets `active` and then calls the same steps 4–5.
Turning a workflow off deletes its trigger rows; turning it back on restores them for whichever
version is still pointed at by `activeVersionId`, which is the whole reason the pointer and the
boolean are separate columns.

**Issues panel.** When Publish returns issues, a panel opens over the bottom of the canvas listing
each `WorkflowIssue.message`, grouped by node, with the node's title underneath. Clicking a row
selects that node and centres it via `setCenter`. The offending nodes get the red outline described
in §E. The panel is dismissible and re-opens on the next failed publish.

### J. Blocking drawn loops

`isValidConnection(connection)` returns false when the target can already reach the source — a
depth-first walk over the current `edges` starting at `connection.target`, looking for
`connection.source`. It also rejects self-connections and duplicate edges. React Flow renders the
rejected connection line in red and refuses the drop, so the customer never creates a loop to begin
with.

The validator's `CYCLE` check stays as the backstop and is not removed: the canvas is a courtesy, the
validator is the guarantee, and a definition can reach the database by other means (a restored
backup, a future import).

**Converging edges are allowed.** Two branches may meet at one node. The engine walks breadth-first
with a visited set and executes a join exactly once, on first arrival — designed behaviour, tested at
`packages/jobs/src/workflows/engine/walk.test.ts:237`, and documented in
`.claude/rules/workflow-engine.md`. Fan-out from one handle is likewise allowed and is how "do three
things at once" is expressed.

### K. Ownership and permissions

`workflow.ownerId` is the identity a run executes as, with exactly that person's permissions. The
owner picker on the builder header therefore offers **only the current user**: the control reads
"Owned by Priya" with a `Take ownership` action, and there is no way to nominate a third party.

This closes a privilege-escalation hole that a free owner picker would open — anyone with
`workflows_update` could otherwise build a workflow that acts with an owner's rights they do not
themselves hold, which is precisely the property the PRD says must never be true. The cost is that
when someone leaves, each of their workflows must be re-taken individually by a person who does have
the access; that is a deliberate, recorded trade.

The route enforces it: `$id.owner.tsx` ignores any submitted id and writes the session user, so a
forged request cannot nominate anyone else. `$id.rename.tsx` does not accept `ownerId` at all.

Everything else is the ordinary four verbs. `view` to open the list and the builder, `create` to make
a workflow or a version, `update` to edit, publish and toggle, `delete` to remove. Without `update`
the builder mounts fully read-only: no palette, no dragging, no connecting, no autosave.

### L. Empty and error states

- **A brand-new workflow** is seeded server-side with one trigger node at a fixed position, so the
  canvas is never empty and the "exactly one trigger" rule is satisfied from the first render. The
  trigger shows its unconfigured state; the palette invites the next node.
- **A version that will not parse** renders the `readWorkflowVersion` failure message with a
  `New version` action, and no canvas.
- **A workflow with no versions at all** (only reachable if every version was deleted) offers a single
  `Create the first version` action.
- **A read-only canvas** shows the lock banner (§H) and hides every editing affordance rather than
  disabling them one by one.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where the builder lives | Full-screen page, canvas *is* the detail page | A graph needs the whole viewport; a tab would cost height and a click. Precedent: `templates+`, `traceability+/graph.tsx` |
| Settings surface | None — fields live on the node | User's call. A node is a form; a mirror panel would be two surfaces showing the same fields |
| Node display | Always open, collapse to summary below zoom 0.66 | Nothing is ever hidden, and a tall graph is still readable from above |
| Palette | Left rail, click *and* drag | Advertises all six kinds on day one; drag-from-handle is a later accelerator, not the only way in |
| Editing a live workflow | Active version is read-only; make a new version | User's call, and the house pattern for released revisions and make-method versions |
| Read-only presentation | `Alert variant="warning"` + lock icon + tooltip, server-side re-check | Copies `ReleaseLockAlert` / `checkRevisionLock` verbatim rather than inventing a second idiom |
| Saving | Autosave, 1s debounce | The edited version is never live, so there is nothing to protect against; no lost work |
| Undo | None | User's call, overriding the phase brief. Recorded as a deviation, see Risks |
| Concurrent edits | Silent last-write-wins | User's call. Workflows are near-always built by one person |
| Owner | Only ever yourself | A free picker is privilege escalation by design |
| Publish | Validate → promote → turn on → sync triggers → wake scheduler, one route | Splitting them lets a caller do half and leave a workflow that looks active and never fires |
| On/off | Separate switch, same sync path | Keeping the pointer and the boolean separate is what makes off/on remember the promoted version |
| Loops | Blocked in `isValidConnection`, validator unchanged | The canvas is a courtesy; the validator is the guarantee |
| Converging edges | Allowed | The engine is an OR-join by design and tested as one |
| Version labels | `versionNumber` only, no name field | The column does not exist and the brief does not ask for one |
| `formatVersion` on write | Always `CURRENT_DEFINITION_FORMAT_VERSION` (2) | The SQL default is a stale `1`; writing the constant keeps the row honest |
| Property pickers | Portal to `document.body` | A pop-up inside a zooming, clipping canvas is unusable |

### What this phase deliberately does not build

- **The contents of any node's field body** — every control, the property picker, type-aware
  operators, the clause editor, the schedule picker, batch mode, the suggestion logic. That is
  **phase 8**, and it is the larger half of the work. Phase 7 ships the card, the body slot, the
  ports, the collapse behaviour and the save path they all mount on; each node renders a
  `Not configured yet` placeholder in its body until phase 8 lands. This boundary is worth stating
  plainly because the fields are what a customer spends their time in.
- **Run history, step detail, the live run stream, blocked-run linking** — **phase 9**.
- **A "test this workflow" preview.** `packages/workflows/src/runtime/` was kept pure so this becomes
  possible later; nothing here closes that door.
- **An `availableVariables(definition, nodeId, catalog)` helper.** Phase 8 needs it and it does not
  exist — `createContext` and `ancestorsOf` are private to `validate.ts`. Phase 7 does not need it
  (its cycle check is a plain walk over `edges`), so exporting it belongs to phase 8.
- **Auto-layout.** New nodes are placed relative to the selection with simple collision avoidance.
  A dagre "tidy up" pass over variable-height nodes needs measured heights and is not asked for.
- **Bulk owner reassignment** for a departing employee.

## Data Model Changes

**None.** Every table, column, index, constraint and RLS policy this phase needs already exists from
`20260730142317_workflows-foundation.sql` and `20260731025358_workflows-webhook-secret.sql`.

Two existing details this phase must respect rather than change:

- `workflowVersion.formatVersion` defaults to `1` in SQL while `CURRENT_DEFINITION_FORMAT_VERSION` is
  `2`. The application always writes the constant explicitly. Not migrating the default: the value is
  only ever set by code that has the constant, and a migration to change a default that is never
  relied on is noise.
- `workflowTriggerEvent` has no `UPDATE` policy on purpose. It is only ever delete-then-insert, and
  only ever by `syncWorkflowTriggers`. Nothing in this phase writes it directly.

## API / Service Changes

### New files

| Path | Responsibility |
|---|---|
| `apps/erp/app/modules/workflows/workflows.models.ts` | `workflowValidator`, `workflowVersionValidator`, `saveDefinitionValidator`, `publishValidator`, `toggleValidator` |
| `apps/erp/app/modules/workflows/workflows.service.ts` | `getWorkflows`, `getWorkflow`, `getWorkflowVersions`, `getWorkflowVersion`, `upsertWorkflow`, `insertWorkflowVersion`, `updateWorkflowDefinition`, `deleteWorkflow`, `deleteWorkflowVersion` |
| `apps/erp/app/modules/workflows/workflows.server.ts` | `getWorkflowLockFlags`, `checkWorkflowVersionLock`, `publishWorkflowVersion` (promote + sync + scheduler), `setWorkflowActive` |
| `apps/erp/app/modules/workflows/ui/**` | Table, forms, lock alert, submodules hook, and the whole `Builder/` tree |
| `apps/erp/app/routes/x+/workflows+/**` | List, create, rename, delete |
| `apps/erp/app/routes/x+/workflow+/**` | Builder, save, publish, toggle, new/delete version |

### Modified files

| Path | Change |
|---|---|
| `apps/erp/app/utils/path.ts` | Workflow route helpers |
| `apps/erp/app/hooks/useModules.tsx` | The `workflows` module entry — the nav link phase 1 withheld |
| `apps/erp/app/components/Layout/Topbar/Search.tsx` | Register `useWorkflowsSubmodules` in `useGroupedSubmodules()` |
| `packages/lib/src/trigger.ts` | One line in `taskToEvent`: `"workflow-scheduler-wake": "carbon/workflow-scheduler.wake"`. Today the ERP app has no supported way to wake the scheduler chain, so a newly published scheduled workflow would wait up to an hour for the backstop |

No change to `packages/workflows`. Its schema, validator, normaliser and catalogs are consumed
exactly as they are.

## UI Changes

The whole phase is UI; §§B–L above are the specification. Summarised:

- A new top-level **Workflows** module in the sidebar, gated on `workflows_view`.
- A list page with search, an on/off switch per row, and create/rename/delete modals.
- A full-screen builder: header (name, owner, on/off, version menu, autosave marker, Publish), left
  palette rail, canvas with dot background, controls and minimap.
- Node cards with a header, a body slot, and named ports; collapsing to a summary when zoomed out.
- A lock banner on the live version; an issues panel on a failed publish.

## Acceptance Criteria

**Navigation and permissions**

- [ ] A user with `workflows_view` sees a **Workflows** entry in the module sidebar; a user without it
      does not, and navigating to `/x/workflows` directly is refused.
- [ ] Typing "workflows" in the command palette finds the list route.
- [ ] A user with `workflows_view` but not `workflows_update` opens the builder, can pan and zoom and
      select nodes, and sees no palette, cannot drag a node, cannot draw an edge, and triggers no
      autosave request.

**List and creation**

- [ ] Creating a workflow named "Notify on big POs" redirects to its builder, which shows one
      unconfigured trigger node.
- [ ] The webhook secret is shown once in the create modal's success state and is not present in any
      later loader payload for that workflow.
- [ ] The list shows `—` in the live-version column for a workflow that has never been published, and
      `v2` after publishing version 2.

**Canvas**

- [ ] Clicking Action in the palette adds an action node below the selected node and connects it from
      the selection's first free handle; dragging Action onto empty canvas adds it unconnected.
- [ ] A condition node with three paths renders three named ports (`If`, `Else if`, `Otherwise`), and
      an edge drawn from each stores `sourceHandle` equal to that path's `id`.
- [ ] Dragging from a downstream node back to any of its ancestors shows the rejected-connection
      styling and creates no edge; the resulting definition, run through `validateDefinition`, returns
      no `CYCLE` issue because none was ever created.
- [ ] Two action nodes on separate condition branches may both connect to one downstream notify node,
      and the saved definition validates clean.
- [ ] Zooming below 0.66 replaces every node body with its one-line summary; zooming back in restores
      the fields.
- [ ] Deleting the trigger node is not possible; every other node and edge deletes with the Delete key.

**Saving and versions**

- [ ] Moving a node stops for one second and the header shows `Saving…` then `Saved`; reloading the
      page restores the node at its new position.
- [ ] An autosave does not re-run the builder loader (no canvas flicker, no lost selection mid-edit).
- [ ] Opening the live version shows the warning banner and a lock icon, the palette is hidden, and a
      `POST` to the save route for that version is refused server-side even when issued directly.
- [ ] `New version` copies the current graph to `versionNumber + 1`, navigates to it, and the new
      version is editable while the old one stays live.
- [ ] Deleting the active version is refused with a message; deleting any other version succeeds.

**Publishing**

- [ ] Publishing a graph whose action has an unset required input writes nothing, and the issues panel
      lists one row per `WorkflowIssue.message`; clicking a row selects and centres that node, which
      shows a red outline and a problem count.
- [ ] Publishing a valid graph sets `activeVersionId` to that version, sets `active` to true, and
      creates one `workflowTriggerEvent` row per event id on the trigger node with the node's `origin`.
- [ ] Turning the workflow off deletes its `workflowTriggerEvent` rows and leaves `activeVersionId`
      unchanged; turning it back on restores exactly those rows.
- [ ] Publishing a schedule-triggered workflow sets `workflow.nextRunAt` and the scheduler chain is
      woken rather than waiting for the hourly backstop.
- [ ] `pnpm --filter @carbon/checks workflow-events` reports no drift after a publish, a toggle-off,
      a toggle-on and a re-publish of a different version.

**End to end**

- [ ] A workflow that triggers on a purchase order's total changing, with one condition and one notify
      action, published and switched on, produces a `workflowRun` row when a purchase order's total is
      edited in the app.

**Verification commands**

- [ ] `pnpm exec turbo run typecheck --filter=erp` passes (note: the package is named `erp`).
- [ ] `pnpm exec biome check` reports no new error-severity findings.
- [ ] `pnpm run test` passes.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **No undo, with autosave on.** Deleting a node is persisted a second later and cannot be recovered except by duplicating an older version. This overrides the phase brief, which lists undo as a deliverable | High | Explicit user decision, recorded here. The trigger node cannot be deleted; versions are the recovery path. Revisit if it bites in practice |
| **A pre-existing engine bug this phase makes reachable.** In a lopsided diamond (`t→A, t→B, A→C, B→D, D→C`) the breadth-first walk can execute C before D, so a reference from C to D resolves to "the step that produces this value did not run", C is marked `Skipped`, its whole downstream is dropped, and the run still reports `Succeeded`. The validator permits the reference because D genuinely is an ancestor | High | Out of scope here — it is an engine defect, not a canvas one. Raise as a separate ticket against `packages/jobs/src/workflows/engine/walk.ts`; the honest fix is a topological walk or in-degree counting. Until then, converging graphs of unequal depth can fail quietly |
| **`apps/erp` is near TypeScript's instantiation budget.** Joined selects across `workflow` + `workflowVersion` + `user` are exactly the shape that trips `TS2589` in unrelated files | Medium | Prefer flat selects and separate queries over nested embeds. Verify with `tsgo` directly, not the turbo cache. If it surfaces, use `@ts-ignore`, not `@ts-expect-error` (`.ai/lessons.md:302`) |
| **`@xyflow/react` bundles zustand**, and the builder adds its own zustand store. A dual-major resolution crashes the SSR bundle with a green build | Medium | Reuse the zustand already resolved for the app; add no new graph or layout dependency. If one becomes necessary, check `ssr.noExternal` in `apps/erp/vite.config.ts` (`.ai/lessons.md:292`) |
| **Silent last-write-wins.** Two people editing one version means one loses their work with no signal | Medium | Accepted by the user. Cheap to upgrade later to an `updatedAt` precondition on the save route |
| **Tall always-open nodes hurt canvas performance.** Six 700px nodes with live form controls is a lot of DOM | Medium | `onlyRenderVisibleElements`, the zoom-based level of detail, and `memo` on every node component. Measure before optimising further |
| **Pop-up pickers inside a transformed canvas** get clipped or mis-scaled | Medium | Portal to `document.body`; the node's key handler must skip events targeting portaled overlays (`.ai/lessons.md:371`) |
| **Twin `ValidatedForm`s at one JSX slot share an RVF store**, so a create/rename modal that swaps branches renders blank fields | Low | Give each branch a distinct stable `key` (`.ai/lessons.md:461`) |
| **A partial insert nulls a column past its default.** PostgREST writes `NULL` for a present-but-`undefined` key, which would null `nodes`/`edges` | Low | Build the version insert object explicitly; never spread a partial |
| **Permission scope strings are invisible to the typechecker** | Low | Grep for `"workflows"` after any rename; do not trust `tsc` (`.ai/lessons.md:19`) |

## Open Questions

All resolved with the user before this spec was written. Recorded as an audit trail.

- [x] **When someone opens a live workflow and edits it, what happens?** — **Answer:** the active
      version is read-only; you create a new version and edit that. The UI must say why you cannot
      rearrange it. Confirmed against the codebase: this is the existing behaviour for released item
      revisions (`ReleaseLockAlert`) and make-method versions, so the phase copies that presentation
      rather than inventing one. *Rejected: auto-forking on first edit (silent, and surprising);
      editing in place with saves going live (a half-finished edit acting on real records).*
- [x] **How is the detail screen laid out?** — **Answer:** the canvas is the page. Full-screen builder
      with name, owner, on/off, version selector and Publish in a slim header. *Rejected: a tabbed
      detail page (costs canvas height and a click); metadata in a drawer from the list (puts the
      on/off switch two screens from the thing it governs).*
- [x] **How does turning a workflow on work?** — **Answer:** a `Publish` action that validates,
      promotes and turns the workflow on, plus a separate On/Off kill switch that remembers the
      promoted version. Matches the two database columns exactly. *Rejected: two fully independent
      controls (promote-and-forget leaves a workflow that looks ready and never fires); one switch
      that auto-promotes the newest valid version (loses the ability to keep an older version live).*
- [x] **How should the builder screen be arranged?** — **Answer:** palette rail on the left, canvas
      filling the rest. Shown as three mockups; option A chosen, with the note that there are "a ton
      of UI improvements which maybe we can do later" — so this phase ships the arrangement, not the
      final visual polish. *Rejected: no rail with add-from-handle only (nothing advertises the six
      kinds on day one); a bottom drawer (covers the graph exactly where you are working).*
- [x] **What does a node show?** — **Answer, and a correction to the first proposal:** the fields
      *are* the node. Name and a short description on top, the rest of the card is fields, which are
      type-driven — a box that wants a number offers different controls and operators from one that
      wants text, and any box that takes a value also takes a variable, reached by picking a record
      and typing a dot to see its properties. The first mockup showed only titles and handles and was
      rejected as missing the core. *Consequence: the right-hand settings panel from the previous
      answer is dropped — there is nowhere else for fields to live.*
- [x] **How do field-filled nodes sit on the canvas, given a condition can be ~700px tall?** —
      **Answer:** always open, shrinking to a one-line summary automatically when zoomed out.
      *Rejected: expand-only-on-click (the canvas jumps on every open and close); mirroring the fields
      into a side panel (two surfaces showing the same fields, and the panel was already rejected).*
- [x] **How should saving work?** — **Answer:** autosave, quietly, with a `Saved` marker. Safe because
      the version being edited is never the live one. *Rejected: an explicit Save button (loses work
      on a closed tab); splitting positions from fields (two rules on one screen).*
- [x] **What should undo cover?** — **Answer:** nothing. No undo; recovery is via versions. Raised
      again as a conflict, because the phase brief lists undo as a required deliverable and autosave
      makes a delete immediate; the user confirmed the answer stands. Recorded as a deliberate
      deviation. *Rejected: a full undo stack; an "undo" affordance on deletes only.*
- [x] **Two people editing one version at once?** — **Answer:** silent last-write-wins. *Rejected:
      warning on a changed row; locking the version while someone holds it.*
- [x] **Who may set a workflow's owner, given a workflow runs with the owner's permissions?** —
      **Answer:** only yourself. You can take ownership; you can never point a workflow at another
      person's permissions. Closes a privilege-escalation hole at the cost of manual re-taking when
      someone leaves. *Rejected: reassignment by anyone holding `workflows_delete`; a free owner
      picker for anyone with `workflows_update`.*
- [x] **May two branches converge on one node?** — **Answer: yes**, decided from the codebase rather
      than asked. The engine walks breadth-first with a visited set and runs a join exactly once on
      first arrival; this is documented in `.claude/rules/workflow-engine.md` and tested at
      `packages/jobs/src/workflows/engine/walk.test.ts:237`. Investigating it surfaced the lopsided-diamond
      defect now recorded in Risks.

## Cross-phase dependencies this phase creates

- **Phase 8 mounts into `NodeCard`'s body slot.** The card, its header, its ports, the collapse
  behaviour, the selection model and the autosave path are all phase 7's; phase 8 supplies one
  component per node kind that renders the fields inside the slot. Phase 8 changes no route and no
  save path.
- **Phase 8 needs `availableVariables(definition, nodeId, catalog)`** exported from
  `@carbon/workflows`. It does not exist; `createContext` and `ancestorsOf` are private to
  `validate.ts`. Phase 8 opens them up.
- **Phase 8 owns per-field issue anchoring.** Phase 7 anchors a `WorkflowIssue` to its node;
  `WorkflowIssue.field` is a dotted path that only resolves to a control once the controls exist.
- **Phase 9 adds a Runs surface** to the same module folder and sidebar group, and may add a "Runs"
  entry to the builder header. Nothing here blocks it.
- **`packages/lib`'s `taskToEvent` map gains a `workflow-scheduler-wake` entry**, which any future
  activation path can reuse.
- **An engine ticket** for the lopsided-diamond ordering defect described in Risks.

## Research

N/A. This phase invents no domain logic — the data model, the validator, the catalogs and the engine
semantics were all settled in phases 1–6, and the remaining questions were product and interaction
choices resolved with the user directly. Prior art for node-graph builders was consulted informally
while preparing the mockups; nothing about it changed a decision here.

Source documents: `plans/automations-engine/prd.md`,
`plans/automations-engine/technical-decisions.md` (problem 5 — this phase is the detailed pass that
section asks for), `plans/automations-engine/phases/phase-7-builder-canvas.md`.
Mockups shown during the interview are kept at `.superpowers/brainstorm/41665-1785483431/content/`.

## Changelog

- 2026-07-31: Created. All open questions resolved with the user before writing.
