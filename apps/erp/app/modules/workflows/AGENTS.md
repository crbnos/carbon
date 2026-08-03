# Workflows Module

Customer-authored automation. A workflow is a graph of nodes (trigger, condition, entity, lookup, filter, action) stored as a versioned definition; the engine in `packages/jobs` walks it. This module is the ERP front end: the list page, the full-screen builder canvas, versioning and publishing.

The definition schema, validator, catalogs, matcher and engine all live outside this module in `packages/workflows` and `packages/jobs`. Read `packages/workflows/AGENTS.md` before touching anything that imports `@carbon/workflows`.

## Key Domain Concepts

- **Workflow** — the `workflow` row. Carries `ownerId`, `active` (the on/off kill switch), and `activeVersionId` (the promoted version pointer). The pointer and the boolean are separate columns on purpose: turning a workflow off and back on restores whichever version was promoted.
- **Version** — a `workflowVersion` row holding `nodes`, `edges` and `formatVersion`. Numbered, never named.
- **Definition** — `{ formatVersion, nodes, edges }`, validated by `workflowDefinitionSchema` from `@carbon/workflows`. `CURRENT_DEFINITION_FORMAT_VERSION` is **3**; the SQL column default is a stale **1**, so the app always writes the constant explicitly.
- **Publish** — validate → set `activeVersionId` → set `active` → `syncWorkflowTriggers` → wake the scheduler. One route does all five; splitting them leaves a workflow that looks active and never fires.
- **The live version is read-only.** Editing a live workflow means creating a new version, the same rule released item revisions follow.

## Safety

### Always
- MUST read a version through `readWorkflowVersion(row)` from `@carbon/workflows` — the only legal read path. On `{ ok: false }` render the failure and **do not mount the canvas**; a blank canvas would let an autosave overwrite a definition nobody could see.
- MUST call `checkWorkflowVersionLock` in every mutating route. The live-version lock is enforced server-side, not only in the UI.
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
pnpm --filter @carbon/checks workflow-events   # trigger-row drift after a publish/toggle
```

## Layout

```
modules/workflows/
├── workflows.models.ts     # zod validators
├── workflows.service.ts    # Supabase reads/writes for workflow + workflowVersion
├── workflows.server.ts     # lock predicates, publish, toggle — server only
├── types.ts                # BuilderNode / BuilderEdge React Flow aliases
├── index.ts                # barrel (does NOT export workflows.server)
└── ui/
    ├── WorkflowsTable.tsx, WorkflowForm.tsx, WorkflowLockAlert.tsx
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
- `getWorkflowLockFlags` / `checkWorkflowVersionLock` (server) — the live-version lock
- `publishWorkflowVersion` / `setWorkflowActive` (server) — both call `syncWorkflowTriggers`, which uses Kysely and **bypasses RLS**; the route's `requirePermissions` is the only authorization gate

## Builder Notes

- One zustand store per builder instance, vanilla `createStore` in a ref behind a context — the `DocumentTemplateEditor` idiom. React Flow keeps viewport and interaction state.
- **No undo.** Deliberate; recovery is via versions.
- Autosave is a 1s debounce posting to `$id.save.tsx`. The route exports `shouldRevalidate` returning false for `/save` — without it every autosave re-seeds the canvas from server state mid-edit.
- Drawn loops are blocked at connection time by `isValidConnection` + `wouldCreateCycle`. The validator's `CYCLE` check stays as the backstop.
- Converging edges are allowed: the engine is a first-arrival OR-join by design.
- The trigger node cannot be deleted — `onNodesChange` filters its `remove` change.
- Nodes collapse to a one-line summary via a per-node `expanded` flag (`store.ts` `setNodeExpanded`), toggled by the card's button and by `BuilderControls`' collapse/expand-all. There is no zoom threshold.
- Every node kind has a form in `ui/Builder/config/forms/`. `NodeFormProps<K>` narrows `node.data` to the kind's slice of the shared definition schema — never re-declare a node's data shape in a form.
- Ports get their id, label, tone and anchor from `ui/Builder/ports.ts`, which derives ids from `getNodeHandles`. Never hand-write a handle list, and never label a port anywhere else — `ports.test.ts` enforces the first rule.
- Node cards subscribe through `ui/Builder/selectors.ts` (scalars) or read once via `useBuilderStoreApi()`. Subscribing to `state.nodes` re-renders every card on every drag frame.

## Related

- `packages/workflows` — definition schema, validator, catalogs, `syncWorkflowTriggers`, pure runtime
- `packages/jobs/src/workflows/` — the matcher, engine and scheduler
- `.claude/rules/workflow-engine.md`, `.claude/rules/workflow-matcher.md`, `.claude/rules/workflow-event-catalog.md`
