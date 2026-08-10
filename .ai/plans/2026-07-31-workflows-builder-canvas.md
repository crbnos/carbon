# Workflows phase 7 — the builder canvas — implementation plan

**Spec / source:** `.ai/specs/2026-07-31-workflows-builder-canvas.md`
**Branch:** `feat/automation`

Read the spec before starting. Read `packages/workflows/AGENTS.md` before touching anything that
imports `@carbon/workflows`. Everything the engine needs already exists; this plan adds only ERP app
code plus one line in `packages/lib`.

## Progress

- [x] Task 1: Add path helpers and the workflows module validators
- [x] Task 2: Write the workflows service layer
- [x] Task 3: Add the scheduler-wake trigger entry
- [x] Task 4: Write the workflows server layer (locks, publish, toggle)
- [x] Task 5: Build the list route, table and create/rename/delete routes
- [x] Task 6: Wire the module into navigation and search
- [x] Task 7: Write the graph helpers and their unit tests
- [x] Task 8: Build the builder store and provider
- [x] Task 9: Build the node card and the six node components
- [x] Task 10: Build the canvas, palette and builder shell
- [x] Task 11: Build the builder route and autosave
- [x] Task 12: Build the versions menu, lock alert and version routes
- [x] Task 13: Build publish, toggle, owner and the issues panel
- [x] Task 14: End-to-end verification and module AGENTS.md

## Dependencies

- Task 2 needs Task 1. Task 4 needs Tasks 2 and 3. Task 5 needs Task 4. Task 6 needs Task 5.
- Task 7 is independent of Tasks 1–6 and may run in parallel with them.
- Task 8 needs Task 7. Task 9 needs Task 8. Task 10 needs Task 9. Task 11 needs Tasks 4 and 10.
- Tasks 12 and 13 need Task 11. Task 14 needs everything.
- **Tasks 5 and 7 may be run as parallel subagents** once Task 4 is done.

## Commands used in this plan (all verified to exist)

```bash
pnpm exec turbo run typecheck --filter=erp          # the erp package is named `erp`, not @carbon/erp
pnpm exec turbo run typecheck --filter=@carbon/lib
pnpm --filter erp exec vitest run <path>            # erp has no `test` script; call vitest directly
pnpm exec biome check <paths>
pnpm --filter @carbon/checks workflow-events
```

Do **not** run a whole-repo typecheck — it runs out of memory. Do not run `pnpm run build`.

---

## Task 1: Add path helpers and the workflows module validators

**Depends on:** none

**Files:**
- Modify: `apps/erp/app/utils/path.ts` — add workflow routes
- Create: `apps/erp/app/modules/workflows/workflows.models.ts`
- Create: `apps/erp/app/modules/workflows/types.ts`
- Create: `apps/erp/app/modules/workflows/index.ts`
- Copy from (precedent): `apps/erp/app/modules/quality/quality.models.ts`

**Steps:**

1. In `apps/erp/app/utils/path.ts`, find the alphabetical region near the other `x`-prefixed module
   entries and add, in the same style as the surrounding entries:

   ```ts
   workflows: `${x}/workflows`,
   newWorkflow: `${x}/workflows/new`,
   renameWorkflow: (id: string) => generatePath(`${x}/workflows/${id}/rename`),
   deleteWorkflow: (id: string) => generatePath(`${x}/workflows/delete/${id}`),
   workflow: (id: string) => generatePath(`${x}/workflow/${id}`),
   workflowSave: (id: string) => generatePath(`${x}/workflow/${id}/save`),
   workflowPublish: (id: string) => generatePath(`${x}/workflow/${id}/publish`),
   workflowToggle: (id: string) => generatePath(`${x}/workflow/${id}/toggle`),
   workflowOwner: (id: string) => generatePath(`${x}/workflow/${id}/owner`),
   newWorkflowVersion: (id: string) => generatePath(`${x}/workflow/${id}/version/new`),
   deleteWorkflowVersion: (id: string, versionId: string) =>
     generatePath(`${x}/workflow/${id}/version/delete/${versionId}`),
   ```

   Match the exact quoting and comma style already used in the file.

2. Create `apps/erp/app/modules/workflows/workflows.models.ts` with zod validators. Import `z` from
   `zod` the same way `quality.models.ts` does.

   ```ts
   export const workflowValidator = z.object({
     id: zfd.text(z.string().optional()),
     name: z.string().min(1, { message: "Name is required" }),
     description: zfd.text(z.string().optional())
   });

   export const workflowDefinitionSaveValidator = z.object({
     versionId: z.string().min(1),
     nodes: z.string().min(1),          // JSON string, parsed in the route
     edges: z.string().min(1),          // JSON string, parsed in the route
     formatVersion: zfd.numeric(z.number().int())
   });

   export const workflowPublishValidator = z.object({ versionId: z.string().min(1) });
   export const workflowToggleValidator = z.object({ active: zfd.checkbox() });
   export const workflowVersionValidator = z.object({ copyFromVersionId: z.string().min(1) });
   ```

   Use `zfd` from `@carbon/form` exactly as the neighbouring models files do — check
   `apps/erp/app/modules/quality/quality.models.ts` for the import line and the `zfd.checkbox()` /
   `zfd.numeric()` usage before writing.

3. Create `apps/erp/app/modules/workflows/types.ts`:

   ```ts
   import type { WorkflowDefinition, WorkflowNode } from "@carbon/workflows";
   import type { Edge, Node } from "@xyflow/react";

   export type BuilderNode = Node<Record<string, unknown>, WorkflowNode["type"]>;
   export type BuilderEdge = Edge;
   export type { WorkflowDefinition };
   ```

4. Create `apps/erp/app/modules/workflows/index.ts` re-exporting `./workflows.models`,
   `./workflows.service`, `./types` — mirror the export style of
   `apps/erp/app/modules/quality/index.ts`. Leave the service export commented out until Task 2, or
   do Task 2 first and add both together.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0, no errors mentioning apps/erp/app/modules/workflows or utils/path.ts
```

**Out of scope:** any UI, any route file, `useModules.tsx`.

---

## Task 2: Write the workflows service layer

**Depends on:** Task 1

**Files:**
- Create: `apps/erp/app/modules/workflows/workflows.service.ts`
- Copy from (precedent): `apps/erp/app/modules/quality/quality.service.ts` — specifically its
  `getIssueWorkflows` function for the list-query shape (`GenericQueryFilters`, `search`, `sorts`,
  `filters`, `.range(offset, offset + limit - 1)`)

**Steps:**

1. Write these functions. All take a `SupabaseClient<Database>` as the first argument and scope every
   query by `companyId`. Use **flat selects** — do not use nested PostgREST embeds, which trip
   `TS2589` in this app (see `.ai/lessons.md:302`).

   ```ts
   getWorkflows(client, companyId, args: GenericQueryFilters & { search: string | null })
   getWorkflow(client, id, companyId)
   getWorkflowVersions(client, workflowId, companyId)      // ordered versionNumber desc
   getWorkflowVersion(client, versionId, companyId)
   upsertWorkflow(client, workflow)                        // insert sets ownerId + createdBy = userId
   insertWorkflowVersion(client, { workflowId, companyId, versionNumber, nodes, edges, formatVersion, createdBy })
   updateWorkflowDefinition(client, { versionId, companyId, nodes, edges, formatVersion, updatedBy })
   deleteWorkflow(client, id, companyId)
   deleteWorkflowVersion(client, versionId, companyId)
   ```

2. `getWorkflows` selects `id, name, description, ownerId, active, activeVersionId, updatedAt,
   createdAt` from `"workflow"`. Owner display names are resolved client-side through the existing
   people store, the way other tables in this app do — check how `IssueWorkflowsTable.tsx` renders an
   assignee before writing this.

3. `insertWorkflowVersion` and `updateWorkflowDefinition` must build their insert/update object with
   every key explicitly present. **Never spread a partial object** — PostgREST writes `NULL` for a
   present-but-`undefined` key, which would null `nodes`/`edges` past their `'[]'` defaults
   (`.ai/lessons.md:451`).

4. Export the return types with `Awaited<ReturnType<typeof …>>["data"]` the way the other service
   files in this app do.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
```

**Out of scope:** anything touching Kysely, `syncWorkflowTriggers`, or the trigger index — that is
Task 4. No route files.

---

## Task 3: Add the scheduler-wake trigger entry

**Depends on:** none

**Files:**
- Modify: `packages/lib/src/trigger.ts` — one entry in `taskToEvent`

**Steps:**

1. In the `taskToEvent` object, add — keeping the existing alphabetical-ish grouping of the two
   workflow entries already there:

   ```ts
   "workflow-scheduler-wake": "carbon/workflow-scheduler.wake",
   ```

2. Change nothing else. The event and its payload type already exist at
   `packages/lib/src/events.ts:592` as `{ data: { bookedFor: number | null } }`, so
   `trigger("workflow-scheduler-wake", { bookedFor: null })` becomes fully typed with no other edit.

3. If `packages/lib/src/events.ts:592` does **not** contain `"carbon/workflow-scheduler.wake"`, STOP
   and report — do not add the event type yourself.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib
# Expected: exits 0
```

**Out of scope:** `packages/jobs/src/inngest/index.ts` — do not widen that server-only subpath.
`ensureSchedulerChain` stays where it is and is not exported to the app.

---

## Task 4: Write the workflows server layer (locks, publish, toggle)

**Depends on:** Tasks 2, 3

**Files:**
- Create: `apps/erp/app/modules/workflows/workflows.server.ts`
- Copy from (precedent): `apps/erp/app/modules/items/items.server.ts` — the `getReleaseLockFlags` /
  `checkRevisionLock` / `LockCheck` shape at lines 14–185; and
  `apps/erp/app/modules/sales/sales.server.ts:73` for how a route gets a Kysely client
  (`getDatabaseClient` from `~/services/database.server`)

**Steps:**

1. Lock helpers, mirroring `items.server.ts`:

   ```ts
   export const LOCKED_VERSION_MESSAGE =
     "This version is live. Create a new version to make changes.";

   export function getWorkflowLockFlags({ versionId, activeVersionId }: {
     versionId: string; activeVersionId: string | null;
   }) {
     const isLive = activeVersionId !== null && versionId === activeVersionId;
     return { isLive, isVersionLocked: isLive };
   }

   export async function checkWorkflowVersionLock(
     client: SupabaseClient<Database>,
     { versionId, companyId }: { versionId: string; companyId: string }
   ): Promise<{ ok: boolean; message?: string }>
   ```

   `checkWorkflowVersionLock` reads the version's `workflowId`, then that workflow's
   `activeVersionId`, and returns `{ ok: false, message: LOCKED_VERSION_MESSAGE }` when they match.
   Every mutating route calls it. An unresolvable id returns `{ ok: true }`, matching
   `checkRevisionLock`'s "unresolvable ⇒ unlocked by design".

2. `publishWorkflowVersion({ workflowId, versionId, companyId, userId })`:

   ```ts
   // 1. read version, readWorkflowVersion(row) -> definition (bail on !ok)
   // 2. const issues = validateDefinition(definition, createWorkflowCatalog());
   //    if (issues.length) return { ok: false as const, issues };
   // 3. UPDATE "workflow" SET "activeVersionId" = versionId, "active" = true,
   //    "updatedBy" = userId, "updatedAt" = now  WHERE id = workflowId AND "companyId" = companyId
   // 4. const sync = await syncWorkflowTriggers(getDatabaseClient(), companyId, workflowId);
   // 5. if (sync.scheduled) await trigger("workflow-scheduler-wake", { bookedFor: null });
   // 6. return { ok: true as const, sync };
   ```

   Imports: `readWorkflowVersion`, `validateDefinition`, `createWorkflowCatalog`,
   `syncWorkflowTriggers` all from `@carbon/workflows`; `trigger` from `@carbon/jobs`;
   `getDatabaseClient` from `~/services/database.server`.

3. `setWorkflowActive({ workflowId, companyId, userId, active })` — updates `active`, then runs the
   same steps 4–5. Turning a workflow off must still call `syncWorkflowTriggers`; that is what
   deletes its `workflowTriggerEvent` rows.

4. Add this comment above both functions, because it is the single most dangerous property in the
   file: `syncWorkflowTriggers` uses Kysely and **bypasses RLS entirely**, so the calling route's
   `requirePermissions` is the only authorization gate.

5. If `syncWorkflowTriggers` is not exported from `@carbon/workflows`, or its signature is not
   `(db, companyId, workflowId)`, STOP and report — do not reimplement the trigger-row rewrite by
   hand. It is the invariant the whole matcher depends on.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
```

**Out of scope:** route files, UI, `workflowTriggerEvent` direct writes (only `syncWorkflowTriggers`
ever writes that table).

---

## Task 5: Build the list route, table and create/rename/delete routes

**Depends on:** Task 4

**Files:**
- Create: `apps/erp/app/routes/x+/workflows+/_layout.tsx`
- Create: `apps/erp/app/routes/x+/workflows+/_index.tsx`
- Create: `apps/erp/app/routes/x+/workflows+/new.tsx` (action only)
- Create: `apps/erp/app/routes/x+/workflows+/$id.rename.tsx` (action only)
- Create: `apps/erp/app/routes/x+/workflows+/delete.$id.tsx` (action only)
- Create: `apps/erp/app/modules/workflows/ui/WorkflowsTable.tsx`
- Create: `apps/erp/app/modules/workflows/ui/WorkflowForm.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/quality+/issue-workflows.tsx` (loader shape),
  `apps/erp/app/modules/quality/ui/IssueWorkflows/IssueWorkflowsTable.tsx` (table),
  `apps/erp/app/modules/quality/ui/RequiredActions/RequiredActionForm.tsx` (fetcher-driven modal
  form), `apps/erp/app/routes/x+/quality+/required-actions.new.tsx` (action-only route)

**Steps:**

1. `_layout.tsx` — copy `apps/erp/app/routes/x+/quality+/_layout.tsx`, replacing the submodules hook
   with `useWorkflowsSubmodules` (created in Task 6 — import it and create a minimal version now
   returning one group with a single "Workflows" link). `handle` is
   `{ breadcrumb: msg\`Workflows\`, to: path.to.workflows, module: "workflows" }`.

2. `_index.tsx` — the list. Loader:

   ```ts
   const { client, companyId } = await requirePermissions(request, {
     view: "workflows", role: "employee"
   });
   const url = new URL(request.url);
   const searchParams = new URLSearchParams(url.search);
   const search = searchParams.get("search");
   const { limit, offset, sorts, filters } = getGenericQueryFilters(searchParams);
   const workflows = await getWorkflows(client, companyId, { search, limit, offset, sorts, filters });
   if (workflows.error) { /* flash error, return empty */ }
   return { count: workflows.count ?? 0, data: workflows.data ?? [] };
   ```

   Return a plain object — never `json(...)` (`.claude/rules/coding-conventions.md`). Component
   renders `<VStack spacing={0} className="h-full"><WorkflowsTable data={data} count={count} /></VStack>`.
   There is **no `<Outlet/>`**: an index route cannot nest children, so the modals are local state
   (step 4).

3. `WorkflowsTable.tsx` — columns: name (links to `path.to.workflow(row.id)`), description, owner,
   live version, an on/off `Switch` posting to `path.to.workflowToggle(id)` with `useFetcher`, and
   updated at. `primaryAction` is a `New` button gated on `permissions.can("create", "workflows")`.
   Add a `renderContextMenu` with Edit / Rename / Delete gated on the matching permissions. Copy the
   column and `meta: { icon }` conventions from `IssueWorkflowsTable.tsx` exactly.

4. `WorkflowForm.tsx` — a `ModalDrawerProvider` + `ModalDrawer type="modal"` wrapping a
   `ValidatedForm`. **Pass `validator(workflowValidator)`, not the raw zod schema** — the raw schema
   silently disables validation (`.ai/lessons.md:39`). Fields: `Input name="name"`,
   `Input name="description"`, `Hidden name="id"` when editing. Give the form a distinct stable `key`
   per mode (`key={isEditing ? \`edit-${id}\` : "new"}`) — twin `ValidatedForm`s at one JSX slot share
   one store and render blank fields otherwise (`.ai/lessons.md:461`).

5. `new.tsx` action: `assertIsPost`, `requirePermissions(request, { create: "workflows" })`, validate,
   then insert the workflow (`ownerId = userId`, `active = false`) **and** its first
   `workflowVersion` (`versionNumber: 1`, `formatVersion: CURRENT_DEFINITION_FORMAT_VERSION`, one
   trigger node — build it with the `createNode` helper from Task 7). On success
   `throw redirect(path.to.workflow(newId))`. On failure
   `return data({}, await flash(request, error(...)))`.

6. After a successful create, the response must let the UI show `workflow.webhookSecret` once. Select
   it back from the insert and pass it through the redirect's flash message, or render it in the
   create modal's success state before redirecting — pick whichever the `flash` helper supports
   cleanly, and if neither is clean, STOP and report rather than persisting the secret anywhere else.

7. `$id.rename.tsx` — action only, `update: "workflows"`, name and description only. It must **not**
   accept `ownerId`. `delete.$id.tsx` — action only, `delete: "workflows"`, copy
   `apps/erp/app/routes/x+/issue-workflow+/delete.$id.tsx`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec biome check apps/erp/app/routes/x+/workflows+ apps/erp/app/modules/workflows
# Expected: typecheck exits 0; biome reports no error-severity findings
# (~419 pre-existing warnings across the repo are expected and are not yours to fix)
```

**Out of scope:** the builder page, nav registration, anything under `x+/workflow+/`.

---

## Task 6: Wire the module into navigation and search

**Depends on:** Task 5

**Files:**
- Modify: `apps/erp/app/hooks/useModules.tsx` — add the `workflows` module definition
- Modify: `apps/erp/app/components/Layout/Topbar/Search.tsx` — register the submodules hook
- Create: `apps/erp/app/modules/workflows/ui/useWorkflowsSubmodules.tsx`
- Copy from (precedent): `apps/erp/app/modules/quality/ui/useQualitySubmodules.tsx`

**Steps:**

1. In `useModuleDefinitions()` in `apps/erp/app/hooks/useModules.tsx`, add — placed alphabetically,
   after the last existing entry:

   ```ts
   {
     key: "workflows",
     permission: "workflows",
     name: t`Workflows`,
     to: path.to.workflows,
     icon: LuWorkflow
   }
   ```

   Import `LuWorkflow` from `react-icons/lu` alongside the other `Lu*` icons in that file.

2. Create `useWorkflowsSubmodules.tsx` as a default-exported hook returning
   `{ groups: AuthenticatedRouteGroup[] }` with one group containing a link to `path.to.workflows`.
   Copy the exact shape from `useQualitySubmodules.tsx`; the types are in
   `apps/erp/app/types/index.ts:13-22`.

3. In `apps/erp/app/components/Layout/Topbar/Search.tsx`, find `useGroupedSubmodules()` (around lines
   436–475) and add `workflows: useWorkflowsSubmodules()` to the `groupedSubmodules` record, keyed the
   same way the neighbouring modules are keyed. **This step is easy to forget and has its own
   acceptance criterion** — without it the command palette cannot find the routes.

4. Do not touch `apps/erp/app/components/PermissionMatrix.tsx`. It is driven by the `modules`
   database view and already includes Workflows.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
grep -n "workflows" apps/erp/app/hooks/useModules.tsx apps/erp/app/components/Layout/Topbar/Search.tsx
# Expected: typecheck exits 0; grep shows one entry in each file
```

Manual check (the user runs the app; do not start it yourself unless asked): the **Workflows** entry
appears in the module sidebar for a user with `workflows_view`, and typing "workflows" in the command
palette finds the list.

**Out of scope:** any migration. The `Workflows` module enum value and its permissions already exist.

---

## Task 7: Write the graph helpers and their unit tests

**Depends on:** none (may run in parallel with Tasks 1–6)

**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/graph.ts`
- Create: `apps/erp/app/modules/workflows/ui/Builder/graph.test.ts`

**Steps:**

1. Read `packages/workflows/src/definition/schema.ts` first. It is the source of truth for node and
   edge shapes and **must not be modified**.

2. Write these pure functions in `graph.ts`:

   ```ts
   // WorkflowDefinition -> React Flow. Near-identity: WorkflowNode is already {id,type,position,data}.
   toReactFlow(definition: WorkflowDefinition): { nodes: BuilderNode[]; edges: BuilderEdge[] }

   // React Flow -> WorkflowDefinition. Strips React Flow's runtime fields (selected, dragging,
   // measured, width, height, ...) and keeps ONLY {id, type, position, data} per node and
   // {id, source, sourceHandle, target, targetHandle} per edge.
   // sourceHandle/targetHandle are non-nullable strings in our schema but nullable in React Flow:
   // drop any edge whose sourceHandle is null, and default targetHandle to "in".
   fromReactFlow(nodes: BuilderNode[], edges: BuilderEdge[]): WorkflowDefinition

   // True when adding source -> target would create a cycle: depth-first from `target` over the
   // existing edges looking for `source`. Also true for source === target.
   wouldCreateCycle(edges: BuilderEdge[], source: string, target: string): boolean

   // A new node with the minimum its schema accepts, so it parses and renders unconfigured.
   createNode(type: WorkflowNodeType, position: { x: number; y: number }): WorkflowNode

   // Placement for a palette click: below `from`, nudged right until it collides with nothing.
   nextNodePosition(nodes: BuilderNode[], from: BuilderNode | undefined): { x: number; y: number }
   ```

3. `createNode` defaults, one per kind:

   ```ts
   trigger:   { events: [], origin: "Both" }
   condition: { paths: [ { id: "p1",   kind: "if",   combinator: "and", clauses: [] },
                         { id: "else", kind: "else", combinator: "and", clauses: [] } ] }
   entity:    { operation: "", inputs: {} }
   lookup:    { entity: "", returns: "one", match: [] }
   filter:    { combinator: "and", clauses: [] }
   action:    { action: "", inputs: {}, batch: false }
   ```

   The condition seeding is load-bearing: a condition's output handles **are** its paths, so a
   condition with no paths has no outputs and nothing can be wired downstream of it.

   Every result must satisfy `nodeSchema.parse(...)`. **If any of these defaults is rejected by the
   schema** (for example if `operation` is `z.string().min(1)`), read the schema and use the minimal
   value that field actually accepts — and if no value is acceptable, STOP and report. Do not change
   `packages/workflows`.

4. Write `graph.test.ts` covering, at minimum:
   - `fromReactFlow` drops React Flow runtime fields and the result passes
     `workflowDefinitionSchema.safeParse` with `success: true`.
   - `fromReactFlow` drops an edge whose `sourceHandle` is `null`.
   - `wouldCreateCycle` returns `true` for a direct back edge (`b -> a` when `a -> b` exists), `true`
     for a three-node cycle, `true` for a self-connection, and `false` for a diamond
     (`a -> b`, `a -> c`, `b -> d`, `c -> d`).
   - `createNode("condition", …)` produces exactly two paths, and every kind's output passes
     `nodeSchema.safeParse`.
   - `toReactFlow(fromReactFlow(...))` round-trips a small graph unchanged.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/workflows/ui/Builder/graph.test.ts
# Expected: all tests pass, 0 failed
```

**Out of scope:** any React component. Any change to `packages/workflows`.

---

## Task 8: Build the builder store and provider

**Depends on:** Task 7

**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/store.ts`
- Create: `apps/erp/app/modules/workflows/ui/Builder/context.tsx`
- Copy from (precedent): `apps/erp/app/components/DocumentTemplateEditor/context.tsx` — the vanilla
  `createStore` held in a `useRef` inside a provider, exposed through a context, with a
  `useEditorStore<T>(selector)` selector hook

**Steps:**

1. `store.ts` exports `createBuilderStore(initial)` using zustand's **vanilla** `createStore` (not the
   `create` hook), holding:

   ```ts
   { nodes: BuilderNode[]; edges: BuilderEdge[];
     selectedNodeId: string | null;
     issues: WorkflowIssue[];
     saveState: "idle" | "saving" | "saved" | "error";
     isReadOnly: boolean;
     baseline: string;                 // JSON.stringify of the last saved definition
     onNodesChange, onEdgesChange, onConnect,
     addNode(type), setSelected(id), setIssues(issues), setSaveState(s), rebaseline() }
   ```

2. `onConnect` calls `wouldCreateCycle` and returns without adding the edge when it is true; it also
   refuses a duplicate `(source, sourceHandle, target)`. New edges are added with
   `targetHandle: "in"`.

3. `onNodesChange` filters out any `remove` change whose id is the trigger node's, so the trigger can
   never be deleted. It also drops every change when `isReadOnly`.

4. `context.tsx` exports `WorkflowBuilderProvider` (creates the store in a `useRef`) and
   `useBuilderStore<T>(selector)`. **Use zustand exactly as already resolved for this app — add no new
   dependency.** `@xyflow/react` bundles its own zustand and a dual-major resolution crashes the SSR
   bundle with a green build (`.ai/lessons.md:292`).

5. There is **no undo stack** and no history state. This is a deliberate decision recorded in the
   spec; do not add one.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
```

**Out of scope:** rendering, the autosave effect (Task 11).

---

## Task 9: Build the node card and the six node components

**Depends on:** Task 8

**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/NodeCard.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/nodes/TriggerNode.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/nodes/ConditionNode.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/nodes/EntityNode.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/nodes/LookupNode.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/nodes/FilterNode.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/nodes/ActionNode.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/nodes/index.ts` — the `nodeTypes` map
- Create: `apps/erp/app/modules/workflows/ui/Builder/edges/WorkflowEdge.tsx`
- Copy from (precedent): `apps/erp/app/modules/inventory/ui/Traceability/nodes/EntityNode.tsx` and
  `.../nodes/ActivityNode.tsx` (memoised custom node using `Handle` / `Position`),
  `.../edges/QuantityEdge.tsx` (custom edge)

**Steps:**

1. `NodeCard` is the shared chrome and takes: `kind` label, `title`, `description`, `accent` colour,
   `ports` (from `getNodeHandles(node)`), `issueCount`, `isSelected`, `isCollapsed`, and `children`
   (the body slot).

   Layout: a header row (icon square, uppercase kind, title, one-line description), a body slot, and
   a footer row of named ports each rendering a React Flow `<Handle type="source" position={Position.Bottom} id={portId} />`.
   A single `<Handle type="target" position={Position.Top} id="in" />` sits on the top edge for every
   kind except `trigger`, which has no target handle.

2. Port names: `out` renders as "next"; `success` / `failure` render as "worked" / "failed"; a
   condition's path ids render as "If", "Else if", "Otherwise" by their `kind`. **Get the ids from
   `getNodeHandles(node)`** — the same function the validator uses — never from a hand-written list,
   or the canvas can draw a handle the validator calls `UNKNOWN_HANDLE`.

3. When `isCollapsed`, render only the header row and no body and no port labels (the handles
   themselves still render so existing edges stay attached).

4. When `issueCount > 0`, the card gets a red outline and an "n problems" badge.

5. Each of the six node components: derives its title from
   `WORKFLOW_LABELS[<the configured id>]` when configured, falling back to the kind name. Import
   labels by deep path — `import { WORKFLOW_LABELS } from "@carbon/workflows/src/catalog/labels.generated"`
   — because `msg` is a build-time macro and the package barrel deliberately does not re-export it.
   The **body renders a muted "Not configured yet" placeholder**; the real fields are phase 8.

6. `nodes/index.ts` exports
   `export const nodeTypes: Record<WorkflowNodeType, ComponentType<NodeProps>> = { trigger: …, condition: …, entity: …, lookup: …, filter: …, action: … }`.
   Write it as an exhaustive `Record` keyed by `WorkflowNodeType` with **no `default:` arm anywhere**,
   so adding a seventh node kind later fails the build instead of shipping invisibly
   (`.ai/lessons.md:605`).

7. Wrap every node component in `memo`, as the traceability nodes do.

8. Any pop-up inside a node body (there are none yet, but the pattern must be set) portals to
   `document.body` rather than rendering inside the node, so it is not scaled by the canvas
   transform or clipped by the node bounds.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec biome check apps/erp/app/modules/workflows/ui/Builder
# Expected: typecheck exits 0; biome reports no error-severity findings
```

**Out of scope:** any field control, any picker, any catalog-driven form — all phase 8.

---

## Task 10: Build the canvas, palette and builder shell

**Depends on:** Task 9

**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/WorkflowBuilder.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/NodePalette.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/BuilderHeader.tsx`
- Copy from (precedent): `apps/erp/app/modules/inventory/ui/Traceability/TraceabilityGraph.tsx` —
  lines 594–618 for the `<ReactFlow>` prop set, `proOptions`, `<Background variant={Dots}>`,
  `<MiniMap pannable zoomable>`, `onlyRenderVisibleElements`; and its `onNodesChange` wrapper at
  lines 262–271 for how to filter changes before they reach the store

**Steps:**

1. `WorkflowBuilder.tsx` renders the shell: `BuilderHeader` on top, then a flex row of `NodePalette`
   (118px, hidden when `isReadOnly`) and the canvas filling the rest. Height is
   `h-[calc(100dvh-49px)]`, the idiom used by the other full-screen editors in this app.

2. The `<ReactFlow>` element, with the props from the spec §D:

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

   `isValidConnection` returns `false` when `wouldCreateCycle(edges, connection.source, connection.target)`.
   This is the first connectable React Flow surface in this repo — `onConnect`, `addEdge` and
   `isValidConnection` appear nowhere else — so there is no exact precedent for these three; the rest
   of the props are copied.

3. Level of detail: read live zoom with `useStore((s) => s.transform[2])` and pass
   `isCollapsed={zoom < 0.66}` down to every node. Export the threshold as
   `export const LOD_ZOOM = 0.66`.

4. `NodePalette.tsx` — the six kinds with a colour swatch and name. Click adds via
   `createNode` + `nextNodePosition` relative to the current selection and connects it from the
   selection's first free handle when one exists; drag sets
   `event.dataTransfer.setData("application/carbon-workflow-node", type)` and the canvas's `onDrop`
   creates it at the pointer via `screenToFlowPosition`. The trigger entry is disabled with a
   tooltip once a trigger exists.

5. `BuilderHeader.tsx` — name (inline-editable when writable), version chip, live chip, autosave
   marker, On/Off `Switch`, `Versions` button, `Publish` button. The Versions and Publish behaviours
   are Tasks 12 and 13; render the buttons disabled with a `TODO`-free placeholder handler now, and
   wire them in those tasks.

6. Key handling: the node body must stop key events reaching the canvas while a field has focus, and
   must skip events whose target is inside a portaled overlay
   (`[data-radix-popper-content-wrapper]`, `[role=menu]`, `[role=listbox]`, `[role=dialog]`) — see
   `.ai/lessons.md:371`. There are no fields yet, so add the handler and its selector list now so
   phase 8 inherits it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
```

**Out of scope:** the route, the loader, autosave, versions, publish.

---

## Task 11: Build the builder route and autosave

**Depends on:** Tasks 4, 10

**Files:**
- Create: `apps/erp/app/routes/x+/workflow+/_layout.tsx`
- Create: `apps/erp/app/routes/x+/workflow+/$id.tsx`
- Create: `apps/erp/app/routes/x+/workflow+/$id.save.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/templates+/_layout.tsx` (bare full-screen layout
  with no module sidebar), `apps/erp/app/routes/x+/templates+/$type.tsx` (loader + action + editor),
  `apps/erp/app/routes/x+/traceability+/graph.tsx` (the `links()` React Flow CSS import and the
  route-level `<ReactFlowProvider>`)

**Steps:**

1. `_layout.tsx` — `<Outlet/>` plus `meta` and `handle`. No sidebar, matching `templates+/_layout.tsx`.

2. `$id.tsx` loader:
   - `requirePermissions(request, { view: "workflows", role: "employee" })`
   - load the workflow, its versions, and the requested version (`?version=<id>`, defaulting to the
     active version, else the highest `versionNumber`)
   - `readWorkflowVersion(versionRow)` — **the only legal read path**. On `{ ok: false }` return the
     failure and message and render an error state; **do not render the canvas** and do not fall back
     to a blank definition, or an autosave will overwrite a definition nobody could see.
   - compute `isReadOnly = !permissions.can("update", "workflows") || versionId === workflow.activeVersionId`

3. Add the React Flow stylesheet at route level:
   ```ts
   import XYFlowStyle from "@xyflow/react/dist/style.css?url";
   export const links: LinksFunction = () => [{ rel: "stylesheet", href: XYFlowStyle }];
   ```
   (copied from `x+/traceability+/graph.tsx`).

4. Wrap the page in `<ReactFlowProvider>` at route level so the header and palette can call
   `useReactFlow`, then `<WorkflowBuilderProvider>` inside it.

5. `$id.save.tsx` — action only:
   - `assertIsPost`; `requirePermissions(request, { update: "workflows" })`
   - validate with `validator(workflowDefinitionSaveValidator)`
   - `checkWorkflowVersionLock(...)` — if not ok, return `data({ error: message }, ...)` and write
     nothing. The lock is enforced here, not only in the UI.
   - `JSON.parse` nodes and edges, then parse the whole document through `workflowDefinitionSchema`
     so malformed JSON never reaches the column; on parse failure return an error and write nothing
   - `updateWorkflowDefinition(...)` with `formatVersion: CURRENT_DEFINITION_FORMAT_VERSION` — write
     the **constant**, which is `2`; the SQL column default is a stale `1`
   - return `data({ ok: true })`

6. Autosave in the builder: a 1s debounce on any change to `nodes`/`edges`, comparing
   `JSON.stringify(fromReactFlow(nodes, edges))` against `baseline`, submitted with `useFetcher` to
   `path.to.workflowSave(id)`. Set `saveState` to `"saving"` then `"saved"`, and `rebaseline()` once
   `fetcher.data?.ok` lands — the `savedRef` + effect pattern from
   `apps/erp/app/components/DocumentTemplateEditor/context.tsx:332-352`. Skip entirely when
   `isReadOnly`.

7. In `$id.tsx` export:
   ```ts
   export function shouldRevalidate({ formAction }: ShouldRevalidateFunctionArgs) {
     return !formAction?.includes("/save");
   }
   ```
   Without this, every autosave revalidates the loader and re-seeds the canvas from server state
   mid-edit, losing the selection and any in-flight drag (`.ai/lessons.md:381`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec biome check apps/erp/app/routes/x+/workflow+
# Expected: typecheck exits 0; biome reports no error-severity findings
```

Manual check: open a workflow, drag a node, wait ~1s, see `Saved`, reload, node is where you left it,
and the canvas does not flicker or lose selection during the save.

**Out of scope:** versions, publish, toggle, owner.

---

## Task 12: Build the versions menu, lock alert and version routes

**Depends on:** Task 11

**Files:**
- Create: `apps/erp/app/modules/workflows/ui/WorkflowLockAlert.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/VersionMenu.tsx`
- Create: `apps/erp/app/routes/x+/workflow+/$id.version.new.tsx`
- Create: `apps/erp/app/routes/x+/workflow+/$id.version.delete.$versionId.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/BuilderHeader.tsx` — wire the Versions button
- Copy from (precedent): `apps/erp/app/modules/items/ui/Item/ReleaseLockAlert.tsx` (the whole file,
  58 lines — flag helper + warning `Alert` banner), `apps/erp/app/modules/quality/ui/Documents/QualityDocumentHeader.tsx:209-230`
  (the Versions dropdown: `New Version` + separator + a `DropdownMenuRadioGroup` of versions)

**Steps:**

1. `WorkflowLockAlert.tsx` mirrors `ReleaseLockAlert.tsx` line for line: an `Alert variant="warning"`
   with `LuTriangleAlert`, `AlertTitle` "This version is live", and `AlertDescription` "Create a new
   version to make changes.", plus a `New version` button inside it. Copy is `<Trans>` from
   `@lingui/react/macro`.

2. Render it at the top of the canvas area whenever `isReadOnly` is caused by the live-version lock
   (not by a missing permission — that case shows nothing extra, the affordances are simply absent).
   Also add an `LuLock` icon with a `Tooltip` next to the version chip in the header, matching
   `BillOfMaterial.tsx:463-482`.

3. `VersionMenu.tsx` — a `Button variant="secondary"` labelled "Versions" opening a dropdown:
   `New version` at the top (gated on `workflows_create`), a separator, then a
   `DropdownMenuRadioGroup` of versions showing `V{n}` as an outline `Badge` with a `Live` chip on the
   promoted one. Selecting one navigates to `?version=<id>`.

4. `$id.version.new.tsx` — action only, `create: "workflows"`. Reads the source version, inserts a new
   row at `max(versionNumber) + 1` copying `nodes`, `edges` and `formatVersion`, then
   `throw redirect(path.to.workflow(id) + "?version=" + newVersionId)`.

5. `$id.version.delete.$versionId.tsx` — action only, `delete: "workflows"`. **Refuse when the
   version is the workflow's `activeVersionId`**, returning a flash error. Deleting it would let the
   database's `ON DELETE SET NULL ("activeVersionId")` silently deactivate the workflow.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
```

Manual checks: opening the live version shows the warning banner and hides the palette; a direct
`POST` to the save route for that version is refused; `New version` copies the graph and navigates to
an editable copy while the old one stays live; deleting the active version is refused.

**Out of scope:** publish, toggle, owner, the issues panel.

---

## Task 13: Build publish, toggle, owner and the issues panel

**Depends on:** Task 11

**Files:**
- Create: `apps/erp/app/routes/x+/workflow+/$id.publish.tsx`
- Create: `apps/erp/app/routes/x+/workflow+/$id.toggle.tsx`
- Create: `apps/erp/app/routes/x+/workflow+/$id.owner.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Builder/IssuesPanel.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/BuilderHeader.tsx` — wire Publish, the On/Off
  switch and the owner control
- Copy from (precedent): `apps/erp/app/modules/items/ui/Item/MakeMethodTools.tsx:647-665` — the
  shared `Confirm` component used before "Set as Active Version"

**Steps:**

1. `$id.publish.tsx` — action only. `assertIsPost`,
   `requirePermissions(request, { update: "workflows" })`, validate with
   `validator(workflowPublishValidator)`, then call `publishWorkflowVersion(...)` from Task 4. When it
   returns `{ ok: false, issues }`, return `data({ issues }, ...)` and write nothing. When it returns
   `{ ok: true }`, return `data({ ok: true }, await flash(request, success("Published")))`.

2. `$id.toggle.tsx` — action only, `update: "workflows"`, calls `setWorkflowActive(...)`. This is the
   single route both the list's switch and the header's switch post to, so there is exactly one place
   that has to remember to re-sync the trigger rows.

3. `$id.owner.tsx` — action only, `update: "workflows"`. It **ignores any submitted id** and writes
   the session `userId` to `workflow.ownerId`. A workflow runs with its owner's permissions, so a
   route that accepted an arbitrary id would let anyone who can edit a workflow borrow someone else's
   access. If you find yourself adding an `ownerId` form field, STOP — that is the hole this design
   deliberately closes.

4. Header wiring: the Publish button posts `versionId` for the version currently open. When a
   *different* version is already live, ask first through the shared `Confirm` component — "Publish
   v4? Version 3 is live now and will be replaced." Publishing the first version does not ask.

5. `IssuesPanel.tsx` — opens over the bottom of the canvas when the publish action returns issues.
   One row per `WorkflowIssue`, showing `issue.message` and, underneath, the title of the node named
   by `issue.nodeId`. Clicking a row calls `setSelected(issue.nodeId)` and centres it with
   `setCenter` from `useReactFlow`. Push the issues into the store with `setIssues` so the affected
   nodes pick up their red outline and problem count. Dismissible; re-opens on the next failed
   publish.

6. Do **not** render `WorkflowIssue.field` against a specific control. It is a dotted path into
   `data` and only resolves to a control once phase 8 has built the controls.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec biome check apps/erp/app/routes/x+/workflow+ apps/erp/app/modules/workflows
# Expected: typecheck exits 0; biome reports no error-severity findings
```

**Out of scope:** run history, live run streaming, retention — all phase 9.

---

## Task 14: End-to-end verification and module AGENTS.md

**Depends on:** all previous tasks

**Files:**
- Create: `apps/erp/app/modules/workflows/AGENTS.md`
- Copy from (precedent): `apps/erp/app/modules/quality/AGENTS.md`

**Steps:**

1. Write the module `AGENTS.md`: layout, the rule that only `syncWorkflowTriggers` ever writes
   `workflowTriggerEvent`, the rule that `readWorkflowVersion` is the only legal read path, the
   live-version lock, the owner-is-always-yourself rule, that there is deliberately no undo, and the
   verification commands from this plan.

2. Run the full verification set:

   ```bash
   pnpm exec turbo run typecheck --filter=erp
   pnpm exec turbo run typecheck --filter=@carbon/lib
   pnpm --filter erp exec vitest run app/modules/workflows/ui/Builder/graph.test.ts
   pnpm exec biome check apps/erp/app/modules/workflows apps/erp/app/routes/x+/workflows+ apps/erp/app/routes/x+/workflow+
   ```

   Expected: all exit 0. Report the actual output; do not claim success without it.

3. **Ask the user to run the app** — do not start it, rebuild the database, or run migrations
   yourself. Then walk the acceptance criteria in the spec, in particular the end-to-end one: build a
   workflow that triggers on a purchase order's total changing with one condition and one notify
   action, publish it, switch it on, edit a purchase order's total, and confirm a `workflowRun` row
   appears.

4. After a publish, a toggle off, a toggle on and a publish of a different version, run:

   ```bash
   pnpm --filter @carbon/checks workflow-events
   # Expected: no drift reported between workflowTriggerEvent and the promoted versions
   ```

5. Report anything that failed, with the command output. Do not commit unless the user asks.

**Out of scope:** fixing the lopsided-diamond engine defect recorded in the spec's Risks — that is a
separate ticket against `packages/jobs/src/workflows/engine/walk.ts`.

---

## Execution notes (2026-07-31)

All 14 tasks done. Static verification green; runtime verification is still owed (see below).

**Deviations from the plan, and why:**

1. **`packages/workflows/package.json` gained one export subpath.** The plan said nodes import
   labels by deep path (`@carbon/workflows/src/catalog/labels.generated`). That path does not
   resolve — the package's `exports` map only declares `"."`, so the deep import fails with
   `TS2307: Cannot find module`. Added `"./labels": "./src/catalog/labels.generated.ts"` and
   updated the comment in `src/catalog/index.ts` that already documented the intent. Nodes import
   `@carbon/workflows/labels`. No schema, validator or catalog code changed.
2. **`upsertWorkflow` split into `insertWorkflow` + `updateWorkflow`.** The union return type made
   `webhookSecret` unreachable on the insert branch (`TS2339`). Splitting them also means only the
   insert path can ever select the secret back, which is the property we want.
3. **The create modal returns the new workflow instead of redirecting.** The plan left the choice
   open ("pick whichever the `flash` helper supports cleanly"). `new.tsx` returns
   `data({ id, webhookSecret }, { status: 201 })`; the modal shows the secret once with a copy
   button and an *Open workflow* button that navigates to the builder. This keeps the secret out
   of the flash cookie entirely.
4. **Publish's replace-a-live-version confirmation is a local `Modal`, not the shared `Confirm`.**
   `Confirm` posts through its own internal fetcher, so the `{ ok, issues }` response would be
   unreachable and the issues panel could never open. The dialog uses the same
   `Modal`/`ModalOverlay`/`ModalContent` primitives and the same copy.
5. **`isReadOnly` is composed in the route component, not the loader.** The loader returns whether
   the open version is the live one; the component ORs in `!permissions.can("update", "workflows")`,
   since permissions are a client hook. The provider is keyed on both so a change remounts the store.
6. **Added `getWorkflowVersionNumbers`.** The list needs `v2` in the live-version column, and the
   flat `workflow` select has no version number. A separate flat query avoids the nested embed that
   trips TS2589.
7. **`asWorkflowNode` lives in `graph.ts`, not `nodes/shared.ts`.** The store needs it, and
   `nodes/shared.ts` imports the context, which imports the store — a cycle. `nodes/shared.ts`
   re-exports it.

**Verification run:**

```
pnpm exec turbo run typecheck --filter=erp                                    → 1 successful
pnpm exec turbo run typecheck --filter=@carbon/lib                            → 1 successful
pnpm exec turbo run typecheck --filter=@carbon/workflows                      → 1 successful
pnpm --filter erp exec vitest run app/modules/workflows/ui/Builder/graph.test.ts → 11 passed
pnpm --filter @carbon/workflows test                                          → 246 passed (18 files)
pnpm exec biome check <every touched path>                                    → no findings
```

**Still owed (needs the app running — the user starts it, not the agent):**

- Every runtime acceptance criterion in the spec: nav entry, command palette, create → builder,
  webhook secret shown once, palette click/drag, condition ports, rejected loop, converging edges,
  LOD collapse, trigger not deletable, autosave + no revalidation flicker, live-version lock
  (including a direct POST to the save route), new version, refused delete of the active version,
  publish with issues, publish clean, toggle off/on, scheduled `nextRunAt` + scheduler wake.
- `pnpm --filter @carbon/checks workflow-events` after a publish, a toggle-off, a toggle-on and a
  re-publish of a different version.

Nothing is committed — per the no-unprompted-commits rule.

---

## Post-implementation quality review (2026-07-31)

Ran a strict structural audit of the branch. Five blockers found and fixed; behavior unchanged.

1. **Per-kind metadata was scattered across eight files.** Six node components
   (`TriggerNode`, `ConditionNode`, `EntityNode`, `LookupNode`, `FilterNode`, `ActionNode`) were
   near-identical — same imports, same hooks, same `NodeCard` call — differing only in a label, an
   icon, a colour and one accessor. On top of that, `NODE_ACCENT` (in `constants.ts`) and `PALETTE`
   (in `NodePalette.tsx`) each held a *second* and *third* copy of per-kind data, so the rail and
   the card could silently disagree about what a kind is called.
   **Fixed:** one `NODE_KIND_META` table (`ui/Builder/nodes/meta.ts`) and one `WorkflowNodeCard`.
   Deleted eight files (the six components, `NotConfigured.tsx`, `nodes/shared.ts`). `nodeTypes`
   stays a spelled-out exhaustive `Record`, so a seventh kind still fails the build.

2. **The on/off switch was implemented twice, verbatim** — `WorkflowToggle` in `WorkflowsTable.tsx`
   and an inline copy in `BuilderHeader.tsx`, including the same optimistic
   `formData.get("active") === "on"` read. **Fixed:** one `ui/WorkflowActiveSwitch.tsx`, used by both.

3. **`WorkflowNode → BuilderNode` conversion was written three times** (`toReactFlow`,
   `store.addNode`, `WorkflowBuilder.onDrop`), and `onDrop` reached into `store.setState(...)` from
   the component, bypassing the store's own action — a boundary leak that meant drag-drop silently
   skipped the read-only guard the store applies. **Fixed:** one `toBuilderNode` helper;
   `addNode(type, position?)` owns creation for both the click and the drop path.

4. **`workflows.server.ts` re-implemented service reads inline.** `publishWorkflowVersion` and
   `checkWorkflowVersionLock` hand-rolled `client.from("workflowVersion").select(...)` /
   `.from("workflow").select(...)` that `getWorkflowVersion` / `getWorkflow` already do — a second
   source of truth for the same fetch. The sync-then-wake tail was also duplicated between publish
   and toggle, and the two functions returned differently-shaped results.
   **Fixed:** both call the canonical service readers, share a `syncAndWake` helper, and return one
   `WorkflowSyncResult` union.

5. **Autosave round-tripped through JSON to split a value it had already built** — `snapshot()` to a
   string, `JSON.parse` it back, then re-stringify the parts. **Fixed:** call `fromReactFlow` once
   and stringify the pieces directly.

Largest file in the module is now 240 lines. Re-verified after the refactor:

```
pnpm exec turbo run typecheck --filter=erp / --filter=@carbon/lib / --filter=@carbon/workflows → all pass
pnpm --filter erp exec vitest run app/modules/workflows/ui/Builder/graph.test.ts → 11 passed
pnpm --filter @carbon/workflows test → 246 passed
pnpm exec biome check <every touched path> → no findings
```

Runtime verification is still owed — see the previous section.
