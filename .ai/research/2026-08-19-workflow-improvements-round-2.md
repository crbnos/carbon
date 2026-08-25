# Research — Workflow improvements (round 2)

Codebase research backing `.ai/specs/2026-08-19-workflow-improvements-round-2.md`.
Grounded against the branch `feat/workflow-improvements` as of 2026-08-19. No external
research: every item is internal/mechanical to Carbon's own workflow subsystem, with one
in-repo precedent (storage rules) noted below.

---

## 1. Custom fields in triggers

### How the catalog produces an entity's field list

- Hand-written inputs: `packages/workflows/src/catalog/{entities,moments,actions,operations}.ts`
- Generator: `scripts/generate-workflow-catalog.ts` → `packages/workflows/src/catalog/build.ts`
  (`buildCatalog`, pure) → committed `events.generated.ts` / `actions.generated.ts` /
  `labels.generated.ts`.
- Field lists come from `packages/database/src/swagger-docs-schema.ts`, injected as an
  argument. `entityProperties` at `build.ts:436-450`.
- **The hard gate:** `build.ts:122-129`
  ```ts
  const DROPPED_COLUMNS = new Set(["companyId","customFields","embedding","updatedAt","updatedBy"]);
  ```
  Asserted by `catalog.test.ts:181` and `build.test.ts:328`. A watched/writable column
  inside `DROPPED_COLUMNS` is a hard build error (`build.ts:272-276`, `303-307`).
- Runtime facade: `catalog/catalog.ts` `createWorkflowCatalog()`. The builder holds a
  **module-level singleton**: `apps/erp/app/modules/workflows/ui/Builder/catalog.ts:8`.
- Picker gates: `ui/Builder/config/ClauseRow.tsx:105-129` (condition/filter/lookup rows) and
  `ui/Builder/fields/variableMenu.ts` (`expand()`, `MAX_PATH = 2`).
- Resolver gate: `packages/workflows/src/runtime/resolve.ts:134-137` —
  `entity.properties[segment] === undefined` → `A ${entity} has no "${segment}"`.

### How Carbon's custom fields work

- `customFieldTable` (global catalog of eligible tables) and `customField` (per-company
  definitions) — `packages/database/supabase/migrations/20240311021818_custom-fields.sql`.
  `customField` columns: `id`, `name`, `sortOrder`, `table`, `dataTypeId`, `listOptions TEXT[]`,
  `active`, `companyId`, `required` (`20260505120000_custom-field-required.sql`), `tags`.
  Unique `(table, name, companyId)`.
- View `customFieldTables` — one row per (table × company) with a `fields` JSON array.
- Values: one `customFields JSONB` column per core table; **keys inside the blob are
  customField ids**, not names. `setCustomFields`/`getCustomFields` at
  `apps/erp/app/utils/form.ts:9-60`; rendering `apps/erp/app/components/Form/CustomFormFields.tsx`.
- Definitions reach the client once per session: `apps/erp/app/routes/x+/_layout.tsx:177`
  → `getCustomFieldsSchemas` (`modules/shared/shared.server.ts:54`, Redis-cached) → loader key
  `customFields` → `apps/erp/app/hooks/useCustomFieldsSchema.tsx`.
- `DataType` enum (`apps/erp/app/modules/shared/types.ts:85-95`): Boolean=1, Date=2, List=3,
  Numeric=4, Text=5, User=6, Customer=7, Supplier=8, File=9.

### What already works with no change

- **Reads.** `packages/jobs/src/workflows/engine/loader.ts:39` is `select("*")`, and trigger
  payload rows come straight off the event queue — the JSONB blob is *already in memory*.
  Only the catalog and the resolver refuse it.
- **The matcher.** `computeNestedDiff` (`packages/jobs/src/inngest/functions/events/diff.ts:157-190`)
  already emits keys like `customFields.<fieldId>`, and `computeEventIds`
  (`packages/jobs/src/workflows/event-ids.ts:53-56`) matches `field in diff`. So
  `match: { table, operation: "UPDATE", field: "customFields.<id>" }` would fire today with
  **no matcher change**.
  Caveat: because objects are diffed nested, the bare key `customFields` never appears — a
  watch on the whole column would never match.

### What blocks it

1. The catalog is **build-time and global**; custom fields are **runtime and per-company**.
   They cannot be generated into `events.generated.ts`.
2. `WORKFLOW_EVENTS` is a static committed record consulted by `deriveWorkflowSubscriptions`
   (`packages/workflows/src/sync.ts:53`), `event-ids.ts`'s module-level `INDEX`, and the
   `workflow-trigger-event-drift` deploy check in `packages/checks` — all four assume a
   **closed, committed event id set**.
3. Labels: `WORKFLOW_LABELS` is a static generated `msg` table keyed `entity.<name>.<column>`.
   A per-company field has no key; `useWorkflowLabel(key, fallback)`'s fallback would have to
   carry the customField `name`.
4. Values are untyped JSON. `fromColumn` (`packages/workflows/src/runtime/values.ts`) coerces
   by the catalog's declared `ValueType`, so a `DataType → ValueType` map is needed
   (List → string + `choices` from `listOptions`; User/Customer/Supplier → `t.entity(...)`).
5. **Entity mismatch:** 9 of the 10 triggerable entities are in `customFieldTable`
   (purchaseOrder, salesOrder, job, receipt, shipment, quote, supplier, customer,
   nonConformance). `item` is **not** — the catalog registers `table: "item"`
   (`entities.ts:125`) while custom fields attach to the subtypes `part`, `material`, `tool`,
   `consumable`, `fixture`.

### In-repo precedent

Storage rules (the other feature sharing `Operator` from `@carbon/utils`) already support
custom fields via a dynamic path escape hatch: `packages/utils/src/field-registry.ts:318-334`
(`getFieldDef` synthesizes a `FieldDef` for any `item.customFields.*` path), generic dotted
resolver `packages/utils/src/storage-rules.ts:178-190`. Their picker
(`FieldCombobox.tsx`) does **not** enumerate per-company fields — the user types the path — so
it is a data-model precedent, not a UX one.

---

## 2. Linking a SO/PO in a message

### There is no "message node"

Messaging is the `notify` **action** inside the generic `action` node. Declared at
`packages/workflows/src/catalog/actions.ts:140-172`:

| Input | Type | Notes |
|---|---|---|
| `user` | `entity("user")` | optional |
| `role` | `entity("group")` | optional; `requireOneOf: [["user","role"]]` |
| `subject` | `string` **required**, `template: true` | |
| `message` | `string` optional, `template: true` | the body |
| `aboutId` | `string` optional | linked record's id |
| `aboutType` | `string` optional | catalog entity name |

`aboutId`/`aboutType` already have a hand-written field: `NotifyAboutField` in
`ActionForm.tsx:186-249` (its own comment says "The only hand-written field… Not a pattern.").

### Templates are structured, not `{{ }}`

Typing `{` opens a menu (`fields/InlineValueEditor.tsx:22`); what is stored is a structured
part `{kind:"text"|"ref"|"item"}` (`definition/types.ts:139-153`). Editor is Tiptap:
`packages/react/src/VariableText/VariableText.tsx` + `VariableChip.tsx` — text + chips only.
Chip encoding: `fields/tokenId.ts`. Editor↔value: `fields/valueParts.ts`.

Resolver: `packages/workflows/src/runtime/resolve.ts` — `resolveValue:17`, `renderTemplate:43`
(any unresolvable part fails the whole template), `renderValue:29` (an entity prints
`row.readableId ?? row.name ?? id`).

**Nothing renders as a URL today.** And `rendersAsText` (`definition/types.ts:82`) returns
**false** for `entity` / `list<entity>`, enforced in the validator's `checkTemplateParts`
(`definition/validate.ts`, `TYPE_MISMATCH`) and the builder's `textOnly` filter
(`variableMenu.ts:99`, `:161`) — so today a customer cannot even drop a whole record into a
message; only its scalar properties.

### How Carbon deep-links a record

- `apps/erp/app/utils/entity.ts` — `RECORD_ROUTES:14` keyed by **workflow catalog entity name**
  (`salesOrder`, `purchaseOrder`, `job`, `quote`, `nonConformance`→`path.to.issue`, …);
  `getRecordPath(entity, id):61`; `getEntityPath(entityId):71` from an id prefix
  (`ENTITY_BY_ID_PREFIX:38` — `so`→salesOrder, `po`→purchaseOrder).
- Absolute links for email/Slack: `buildNotificationLink(event, documentId, companyId, documentType)`
  → `${ERP_URL}/api/link?event=…&documentId=…&companyId=…&documentType=…`
  (`packages/jobs/src/inngest/functions/notifications/content.ts:19-27`). Resolver route
  `apps/erp/app/routes/api+/link.ts`; the `NotificationEvent.Workflow` case (`:83`) calls
  `getRecordPath(documentType, documentId)`. `/api/link` also performs the **company switch**
  before redirecting.

### Delivery

`packages/jobs/src/workflows/actions/notify.ts` → `trigger("notify", …)` with
`event: NotificationEvent.Workflow`, `title: subject`, `body: message`,
`documentId: aboutId ?? runId`, `documentType: aboutType`.
Destinations (`inngest/functions/notifications/notify.ts:188`): **InApp + Email** (no Slack).
`content.ts:1188`: `description = title`, and the **body becomes a single detail row**
`[{ label: "Message", value: body }]` (`NotificationDetail {label, value}`,
`packages/notifications/src/index.ts:90`).

**Known gap:** `details` is stored on `notification.payload`
(`inngest/functions/notifications/notify.ts:501`) but is **never rendered in the ERP topbar**
(`apps/erp/app/components/Layout/Topbar/Notifications.tsx`, Workflow case `:423-430`). Today
the workflow message body is invisible in-app; only the subject shows. The whole row is one
`<Link>`, so a nested anchor needs care.

Email renders details as label/value rows: `packages/documents/src/email/NotificationEmail.tsx:269-310`,
single CTA button `ctaUrl`.

### The entity RuntimeValue is a complete link spec

`packages/workflows/src/runtime/types.ts:21`:
`{ kind: "entity"; of: string; id: string; row?: Record<string, unknown> }`.
`of` is exactly the catalog entity name — the same key `RECORD_ROUTES` uses and the same value
`aboutType` carries.

**Constraint:** `packages/workflows` has four runtime deps only (`zod`, `@carbon/utils`,
`@lingui/core`, `@internationalized/date`), targets browser + ES2019, and cannot import
`~/utils/path` or `@carbon/env`. URL construction therefore belongs job-side in
`packages/jobs/src/workflows/actions/notify.ts` (which may import `ERP_URL`), never in
`runtime/resolve.ts`.

---

## 3. Version locking

### There is no status enum — "live" is a pointer comparison

`workflowVersion` has **no status column** (`20260810100100_workflows-foundation.sql:55`).
`workflow.activeVersionId` (`:39`) is the pointer; `workflow.active` is a boolean kill switch;
`workflow.canvasState` (`:41`) is viewport JSONB, **per workflow, not per version**.

`getWorkflowLockFlags({versionId, activeVersionId})` →
`{isLive, isVersionLocked}`, both just `versionId === activeVersionId`
(`apps/erp/app/modules/workflows/workflows.server.ts:25-34`).
`LOCKED_VERSION_MESSAGE` at `:22`.
Publishing: `publishWorkflowVersion` `:99-152` (validate → set `activeVersionId` → `syncAndWake`).

### How read-only propagates

Computed in `apps/erp/app/routes/x+/workflow+/$id.tsx:144` (loader) and `:162`
(`isLiveVersion || !permissions.can("update","workflows")`), passed to the provider at
`:183-189` with `key={versionId:isReadOnly:isOwner}` so it is immutable per mount.
Store field `ui/Builder/store.ts:54,114,125`; context `ui/Builder/context.tsx:44`.

Guarded today: `onNodesChange` (`store.ts:133`), `onEdgesChange` (`:156`), `onConnect` (`:162`),
`addNode` (`:183`), `arrangeNodes` (`:295`), `setNodePositions` (`:301`);
`WorkflowBuilder.tsx` drop (`:82,92`), palette (`:114,125`),
`nodesDraggable={false}`/`nodesConnectable={false}` (`:155-156`), `deleteKeyCode={null}` (`:160`);
`BuilderControls.tsx:67,93`; `WorkflowNodeCard.tsx:66,175,179,191`;
`edges/WorkflowEdge.tsx:28,63`; `config/InlineNodeName.tsx:9,50`;
`Autosave.tsx:26,29` (autosave off entirely); `BuilderHeader.tsx:139,175-190` (lock icon).

### The bug — the entire node-config layer is ungated

`store.ts` `updateNodeData` (`:260-265`) has **no `isReadOnly` guard**, and
`WorkflowNodeCard.tsx:123,226-230` renders the config form unconditionally. No form reads
`isReadOnly`. So on a live version these are all interactive:

- **Trigger mode Event↔Schedule** — `config/forms/TriggerForm.tsx:430-455`, plain buttons
  calling `updateNodeData` (`:397`, `:405`). Also ungated: event picker (`:413-415,465-471`),
  origin ToggleGroup (`:479-505`), whole `ScheduleEditor` (`:192-357` → `patchSchedule:418-421`).
- `ActionForm.tsx:315,339,348`; `ConditionForm.tsx:133` (and `:124` `onEdgesChange`, which *is*
  guarded — so a path delete desyncs data from edges); `FilterForm.tsx:68,75,79,85,91,176,196`;
  `EntityForm.tsx:146,156`; `LookupForm.tsx:79,83,92,99,105`.
- Also ungated in the store: `renameNode` (`:267`), `setNodeExpanded` (`:280`),
  `setAllNodesExpanded` (`:287`), `removeNode` (`:310`). `BuilderControls.tsx`
  expand/collapse-all is **not** disabled and `expanded` is part of the persisted definition.

Net effect: the user changes the trigger to Schedule, the canvas shows it, nothing persists
(autosave is off), and there is **no feedback** — the edit silently evaporates on reload.

Deliberately allowed on a live version: workflow **rename** (name lives on `workflow`, not the
version — `BuilderHeader.tsx:54-55`), **test run** (`WorkflowNodeCard.tsx:149-172`), and
**viewport persistence** (`canPersistCanvasState`, `$id.canvas.tsx:14-15`).

### Positions are part of the versioned definition

`definition/schema.ts:36` — `position: {x, y}` on the node schema (`expanded` rides along too).
Serialized by `ui/Builder/graph.ts:49-74` (`fromReactFlow`, `:62`), read back by
`toBuilderNode:21-29`. Persisted by **autosave only** (`Autosave.tsx:28-54`, 1s debounce,
diffs `JSON.stringify(fromReactFlow(...))` vs `state.baseline`) → POST `path.to.workflowSave`
→ `routes/x+/workflow+/$id.save.tsx` → `updateWorkflowDefinition`
(`workflows.service.ts:163`, the only caller).

So a node move on a live version is a write to the live version's `nodes` JSONB. Allowing
drag cannot be done by flipping `nodesDraggable` alone.

### Server-side guard — exactly one route

`checkWorkflowVersionLock` (`workflows.server.ts:41-61`) → `getWorkflowVersionOwnership`
(`workflows.service.ts:410-421`); deliberately "unresolvable ⇒ unlocked" (`:46-49`).
Only caller: `routes/x+/workflow+/$id.save.tsx:52-56` → `409`. Since `/save` is the only
writer of `nodes`/`edges`, the definition is genuinely protected server-side.
No DB-level guard: RLS on `workflowVersion` (migration `:238-259`) is the standard company +
permission-claim policy set; no CHECK, no trigger.
Client feedback on refusal: `Autosave.tsx:56-69` `toast.error` — but autosave never fires in
read-only mode, so today a blocked edit produces no toast.

### The prominent affordance that was specced but never built

- Today: a 14px `LuLock` + tooltip (`BuilderHeader.tsx:175-190`) and a green `Live` badge shown
  **only inside the version dropdown** (`ui/Builder/WorkflowVersionStatus.tsx`).
- `.ai/specs/implemented/2026-07-31-workflows-builder-canvas.md:15-17,73,293-299,397,530`
  specifies a `WorkflowLockAlert.tsx` that **was never built**.
  `apps/erp/app/modules/workflows/AGENTS.md` also lists `ui/WorkflowLockAlert.tsx` — **stale doc**.
- House pattern to copy: `apps/erp/app/modules/items/ui/Item/ReleaseLockAlert.tsx`
  (`Alert variant="warning"` + `LuTriangleAlert`; also exports `getReleaseLockFlags`, which
  `getWorkflowLockFlags` mirrors). Primitives: `packages/react/src/Alert.tsx`, `Badge.tsx`.
- Mount points: between `<BuilderHeader>` and the canvas in `x+/workflow+/$id.tsx:191-197`,
  and/or a React Flow `<Panel position="top-center">` (idiom in `BuilderControls.tsx`).

---

## 4. "Role" → "Group", employee groups only

### The field is already a group entity

`packages/workflows/src/catalog/actions.ts:145` —
`role: { type: t.entity("group"), required: false, label: "role" }` on the `notify` action,
alongside `user: t.entity("user")` (`:144`), `requireOneOf: [["user","role"]]` (`:174`).
Generated mirror `actions.generated.ts:134,151`; label
`labels.generated.ts:39` → `"action.notify.input.role": msg\`Role\``.
Rendered by `ActionForm.tsx:359` and the `requireOneOf` block `:454-473`.
Control: `LiteralControl.tsx:177` → `RECORD_PICKERS.group` → `GroupPicker` at
`ui/Builder/fields/recordPickers.tsx:145-153` (registry `:174`).

**Not** the `role` enum (`'customer'|'employee'|'supplier'` on `userToCompany`). The hardcoded
`["Buyer","Manager","Admin"]` list is a **test fixture** (`definition/catalog.ts:191-196`).

Stored shape: `{kind:"literal", type:{kind:"entity", of:"group"}, value:"<group.id>"}` under
`node.data.inputs.role`. At runtime `packages/jobs/src/workflows/actions/notify.ts:8-32`
merges `inputs.user` and `inputs.role` into one `groupIds` array (every user has an identity
group whose id == their user id).

### The groups model

**One `group` table**, no type enum — five booleans (`packages/database/src/types.ts:15869-15906`):
`isEmployeeTypeGroup`, `isCustomerTypeGroup`, `isCustomerOrgGroup`, `isSupplierTypeGroup`,
`isSupplierOrgGroup`, plus `isIdentityGroup` (per-user singleton, always excluded from pickers).

"Employee" is defined **negatively** —
`packages/database/supabase/migrations/20260714045245_user-select-rpcs.sql:53-60`:
```
WHEN p_type = 'employee' THEN NOT (isCustomerOrgGroup OR isCustomerTypeGroup
                                   OR isSupplierOrgGroup OR isSupplierTypeGroup)
```

Listing: `getUserSelectGroups` (`apps/erp/app/modules/users/users.service.ts:418`) wraps RPC
`get_user_select_groups(p_company_id, p_type, p_search, p_limit, p_offset)`.
Precedents: `routes/x+/settings+/approval-rules.tsx:33-34` (employee-only),
`routes/x+/sales+/price-list.tsx:35-38` (customer-only).

### The picker already supports the filter

There is no `Form/Group.tsx`; the group picker is `UserSelect`
(`apps/erp/app/components/Selectors/UserSelect/`), whose props include
`type?: "employee" | "supplier" | "customer"` (`types.ts:59`) →
`useUserSelect.ts:130,141-142` → `path.to.api.userSelectGroups(type, …)` → the RPC's `p_type`.

**The gap:** `GroupPicker` (`recordPickers.tsx:145-153`) passes **no `type`**, so `p_type` is
NULL → the RPC's `ELSE TRUE` returns **every** non-identity group, including customer and
supplier ones. The sibling `UserPicker` (`:132-141`) passes `usersOnly` but also no `type`, so
the person picker has the same leak.

### Migration cost

- **Relabel + filter only: zero data migration.** Change `label: "role"` → `"group"` at
  `actions.ts:145`, run `pnpm generate:workflow-catalog`, then `pnpm lingui:extract`.
  Stored key stays `inputs.role`; the value is already a group id.
  Existing definitions pointing at a customer/supplier group keep working (`validate.ts` checks
  only the type, not the flags) — they just can't be re-picked.
- **Renaming the input key `role` → `group` requires a v4 format migration.**
  `CURRENT_DEFINITION_FORMAT_VERSION = 3` (`definition/schema.ts:11`); migrator
  `migrateDefinition(raw, from)` (`definition/normalize.ts:48-93`; v1→v2 lookup match rules,
  v2→v3 `title`→`name`), driven by `readWorkflowVersion` (`:103+`). Also in scope:
  `requireOneOf` (`actions.ts:174`), `notify.ts:28`, `notify.test.ts:57`.

---

## 5. Canvas visuals

- **`@xyflow/react` 12.10.2** (React Flow v12) — `apps/erp/package.json:70`.
- Canvas: `ui/Builder/WorkflowBuilder.tsx`, `<ReactFlow>` at `:136-171`.
  `minZoom={0.25} maxZoom={2}` (`:148-149`), `onlyRenderVisibleElements` (`:161`),
  `defaultEdgeOptions={{type:"workflow"}}` (`:162`), `proOptions={{hideAttribution:true}}` (`:147`).
  Layout is left→right dagre (`layout.ts:43`, `rankdir:"LR"`); handles `Position.Left`
  (`NodeCard.tsx:116`) / `Position.Right` (`OutputHandle.tsx:120`).
- **Grid:** `WorkflowBuilder.tsx:166` —
  `<Background variant={BackgroundVariant.Dots} gap={16} />`. `size` and `color` are **not**
  set, so xyflow defaults apply (`size=1`, CSS var `--xy-background-pattern-dots-color`).
  Knobs: `BackgroundVariant.Lines`/`Cross`, larger `gap`, smaller `size`, a muted `color`, or a
  second `<Background id>` layer for major/minor grid.
- **Edge:** one custom component, `ui/Builder/edges/WorkflowEdge.tsx`
  (`edgeTypes = { workflow: WorkflowEdge }` at `:101`).
  - Geometry `:40-48` — `getSmoothStepPath({..., borderRadius: 12})` (orthogonal with rounded
    corners, **not** a bezier). "Smoother" = raise `borderRadius`, or swap to `getBezierPath`
    / `getSimpleBezierPath` — one import + one call site.
  - Stroke `:52-62`, inline on a hand-rolled `<path>` (no `<BaseEdge>`, no `style` prop):
    `stroke="hsl(var(--primary))"`, `strokeWidth={highlighted ? 2.5 : 1.75}`,
    `strokeLinecap="round"`, `strokeDasharray="8 4"`, `strokeOpacity` dimming to `0.28`,
    `className="workflow-edge-animated"` → `edges/workflow-edge.css`
    (`edge-flow`, `stroke-dashoffset 24 → 0`, 1.2s linear infinite).
  - `EdgeLabelRenderer` block `:63-94` renders the two-click disconnect button.
- Stylesheets are **route-level `<link>`s**, not global imports:
  `routes/x+/workflow+/$id.tsx:14` (`@xyflow/react/dist/style.css?url`), `:32`
  (`workflow-edge.css?url`), wired via `export const links` at `:42`. There are **no**
  `.react-flow__*` / `--xy-*` overrides anywhere in the app.
- Other canvases in the repo (precedent, all separate): `modules/production/ui/Jobs/JobDag.tsx:203`
  and `apps/mes/app/components/JobDag/JobDag.tsx:218` (`<Background gap={20} size={1} />`);
  tree views in accounting/settings/people; `inventory/ui/Traceability/TraceabilityGraph.tsx:647`.

---

## Relevant lessons already recorded

`.ai/lessons.md`:
- "Never hand-measure React Flow handle positions; and never `stopPropagation` inside a node" —
  use `nodrag`, call `useUpdateNodeInternals` on handle/size change.
- "A dropdown that lives inside an editor popup must own its keys on the document" —
  `VariableTreeMenu.tsx`.
- Workflow definition parsing must go through `migrateDefinition`, never the current schema
  directly.
- `packages/workflows` targets ES2019 (no BigInt literals, no `node:crypto`).
