# Spec — Workflow improvements, round 2

**Status:** Implemented (pending browser verification)
**Date:** 2026-08-19
**Branch:** `feat/workflow-improvements`
**Research:** [`.ai/research/2026-08-19-workflow-improvements-round-2.md`](../research/2026-08-19-workflow-improvements-round-2.md)
**Prior art:** `.ai/specs/2026-07-30-workflows-{engine,matcher,event-catalog}.md`,
`.ai/specs/implemented/2026-07-31-workflows-builder-canvas.md`,
`.ai/plans/automation/pending-changes.md` (items 1–7, shipped)

---

## 1. Summary

Eight customer-raised changes to the Workflows feature, in three groups:

1. **Custom fields become first-class in workflows** — trigger on one changing, read one in
   conditions/filters/messages, and write one from an Update action.
2. **A message can link to the record it is about** — dropping a Sales Order or Purchase Order
   into a notification body produces a clickable link, in email and in the in-app bell.
3. **The published version is genuinely read-only, and says so** — a prominent banner, every
   node control visibly disabled, the trigger-mode bug closed, but node *positions* stay
   editable so a live workflow can still be tidied and read.

Plus three small ones: the notify action's "Role" field becomes "Group" and lists employee
groups only (the person picker gets the same treatment), the canvas grid becomes quieter, and
connectors become true curves.

## 2. Problem

- **Custom fields are invisible to workflows.** Every customer models something Carbon does not
  ship a column for. Today a workflow cannot notice one changing, cannot compare one, cannot
  print one, and cannot set one — so any rule that depends on customer-specific data is
  unbuildable. The data is already in memory at run time (`loader.ts` reads `select("*")`) and
  the matcher already emits `customFields.<id>` diff keys; only the catalog refuses them.
- **A notification cannot point at its record.** `notify` already carries `aboutId`/`aboutType`
  so the whole notification row is clickable, but the *body* is plain text with no way to say
  "…for SO000123" as a link. Worse, the body is never rendered in the in-app bell at all
  (`notification.payload.details` is written and then dropped by `Notifications.tsx`), so a
  workflow author writing a message sees it vanish in-app.
- **The live version is only half locked, and the half that isn't is silent.** `updateNodeData`
  has no read-only guard, so every node config form is fully interactive on a published version
  — the reported case is switching the trigger from Event to Schedule. Because autosave is
  disabled in read-only mode, the change is neither saved nor refused: it silently evaporates on
  reload, with no toast and no explanation. The only lock signal is a 14px lock glyph.
- **You cannot tidy a live workflow.** `onNodesChange` drops *all* changes including drags, so a
  published workflow is frozen in whatever layout it had — unreadable graphs stay unreadable.
- **The "Role" picker lists customers and suppliers.** `GroupPicker` passes no `type`, so the RPC
  returns every non-identity group. A workflow can be pointed at a supplier org group by
  accident. The sibling person picker has the identical leak.
- Canvas grid and connectors read louder than the content.

## 3. Goals

- Custom fields usable as trigger, as readable value, and as writable value, scoped per company.
- A record dropped into a message renders as a clickable link in email and in-app.
- The workflow message body is visible in the in-app bell.
- No edit of any kind to a published version's behaviour is possible from the UI or by a
  hand-rolled request; node positions are the single deliberate exception.
- The read-only state is unmissable before the user tries to edit, not after.
- The notify action's group and person pickers list employees only.
- Quieter grid, curved connectors.

## 4. Non-goals

- **Items do not get custom fields in v1.** Carbon attaches item custom fields to the subtypes
  (`part`, `material`, `tool`, `consumable`, `fixture`); the workflow catalog triggers on the
  shared `item` table. Merging them needs a collision rule and is its own change. The nine other
  triggerable entities are covered.
- **No `File` custom fields as entity values.** A `File` custom field (DataType 9) is exposed as
  a plain string path — comparable and printable, but not a link and not an entity to drill into.
- No change to the workflow permission model, the run-history schema, or retention.
- No rich text in messages. The body stays a single string; the only structure added is an
  inline link.
- No format-version bump. The stored `role` input key is not renamed (see D-9).
- Renaming/reshaping any existing catalog event id. Custom-field event ids are new and additive.

## 5. Design

### 5.1 Custom fields — a per-company catalog overlay

The catalog is built at **build time and is global**; custom fields are **runtime and
per-company**. They therefore cannot be generated into `events.generated.ts`. Instead the
catalog gains an optional overlay that is merged in per company at the two places a catalog is
constructed: the builder (client) and the engine (server).

#### New module — `packages/workflows/src/catalog/custom-fields.ts`

Pure, no I/O, no DB import. Its input is the shape the ERP already loads.

```ts
export type CustomFieldDef = {
  table: string;          // customField."table"
  id: string;             // customField.id — the key inside the JSONB blob
  name: string;           // the customer's label
  dataTypeId: number;     // DataType enum
  listOptions: string[] | null;
  active: boolean;
};

export type CatalogOverlay = {
  properties: Record<string, Record<string, ValueType>>;  // entity -> path -> type
  labels: Record<string, string>;                          // "entity.customFields.<id>" -> name
  enums: Record<string, string[]>;                         // same key -> listOptions
};

export function buildCatalogOverlay(defs: CustomFieldDef[]): CatalogOverlay;
```

- The property **path is one segment**, the literal string `customFields.<fieldId>`. It is not
  a two-hop drill. This keeps `walkPath` (`definition/catalog.ts:82-96`) and `resolve.ts`'s
  `walk` single-step: read `row.customFields?.[fieldId]`. It also means the bare key
  `customFields` never becomes a property, which matches the differ (nested diffs never emit
  the bare key).
- Only `active` fields are included, and only for tables in `WORKFLOW_ENTITY_REGISTRY` **minus
  `item`** (non-goal).

**DataType → ValueType map** (the one place this mapping lives):

| DataType | ValueType | Notes |
|---|---|---|
| Boolean (1) | `t.boolean` | |
| Date (2) | `t.date` | |
| List (3) | `t.string` + `enums[key] = listOptions` | drives the right-hand side of a clause |
| Numeric (4) | `t.number` | |
| Text (5) | `t.string` | |
| User (6) | `t.entity("user")` | drillable — `user` is a reference entity in the registry |
| Customer (7) | `t.entity("customer")` | |
| Supplier (8) | `t.entity("supplier")` | |
| File (9) | `t.string` | the stored path; not linkable (non-goal) |

#### Catalog facade

`createWorkflowCatalog(overlay?: CatalogOverlay)` (`catalog/catalog.ts`). `getEntity` merges
`properties` (generated first, overlay second — a generated column always wins, so a customer
cannot shadow a real column), `getEnum` falls through to `overlay.enums`, and a new
`getPropertyLabel(entity, path)` returns the overlay label when there is one.

`build.ts`'s `DROPPED_COLUMNS` is **unchanged** — `customFields` stays out of the generated
property map. The overlay is the only path in.

#### Trigger events — parsed, not looked up

New event id shape: `<entity>.customFields.<fieldId>.changed` — e.g.
`salesOrder.customFields.cf_a1b2c3.changed`. Deliberately parallel to the generated
`<entity>.<column>.changed`.

`WORKFLOW_EVENTS` stays a closed committed record. Every consumer that currently does
`WORKFLOW_EVENTS[id]` moves to a new **`resolveEvent(id): CatalogEvent | null`** exported from
`catalog/catalog.ts`, which returns the static entry when there is one and otherwise parses the
custom-field pattern into a synthetic `CatalogEvent`:

```
match:      { table: <entity's table>, operation: "UPDATE", field: `customFields.${fieldId}` }
permission:  copied from the entity's registry entry
outputs:     record | before | after   (identical to a generated .changed event)
```

Consumers to switch: `sync.ts` `deriveWorkflowSubscriptions:59`, and anywhere the builder reads
an event by id.

**The matcher needs no per-company knowledge.** `computeNestedDiff` already emits
`customFields.<id>` keys, so `event-ids.ts` gains one extra pass in `computeEventIds`: for each
diff key matching `^customFields\.(.+)$` on a table that is in `INDEX`, emit
`` `${entity}.customFields.${fieldId}.changed` ``. The id is *derived from the data*, and the
existing `workflowTriggerEvent` join then filters to the workflows that actually subscribed. No
company lookup is added to the hot path.

Ordering: custom-field ids are appended after the generated `.changed` ids (which are emitted in
catalog order). The "one run per workflow per announcement, first event id wins" rule is
unchanged; a workflow subscribed to both a real column and a custom field on the same update
still gets exactly one run.

**Drift check.** `workflow-trigger-event-drift` (`packages/checks`) currently asserts every
`workflowTriggerEvent.eventId` is a known catalog id. It gains a second branch: an id matching
the custom-field pattern is valid when a `customField` row with that id exists for that company
and its `table` matches the entity. That is a stronger check than a bare pattern allow — it
catches a trigger left behind after a custom field is deleted.

#### Reading a custom field at run time

`engine/execute.ts`'s existing `"load"` step gains one read: the company's active `customField`
rows (through the **owner-scoped client**, like every other business read — `customField` is
company-scoped and RLS-covered). It builds the overlay once per run and constructs the catalog
with it. Everything downstream — `resolve.ts:134`'s `entity.properties[segment]` gate,
`values.ts`'s `fromColumn` coercion, `compare.ts` — works unchanged, because the property is
now simply declared.

`fromColumn` receives the value straight out of the JSONB blob. Custom-field values are stored
as strings by the ERP's form layer regardless of type, so coercion is by the **declared**
`ValueType`, not by the JS runtime type — this is exactly what `fromColumn` already does for
columns. A value that cannot be coerced resolves to nothing, which the engine already treats as
"skip with a reason", never an error.

#### Writing a custom field

The `<entity>.update` action's input list gains the company's custom fields, from the same
overlay. Two things `update.ts` must do differently:

1. **Never clobber the blob.** A workflow setting one field must not erase the others, and a
   read-modify-write through the Supabase client races with a concurrent human edit. New RPC,
   invoker-rights so RLS still applies:

   ```sql
   workflow_merge_custom_fields(p_table text, p_id text, p_company_id text, p_values jsonb)
   -- UPDATE <table> SET "customFields" = COALESCE("customFields", '{}'::jsonb) || p_values
   --   WHERE id = p_id AND "companyId" = p_company_id
   ```

   `p_table` is validated against `customFieldTable` inside the function (an allowlist that
   already exists) — it is never interpolated from caller-supplied text without that check.
2. **Validate by declared type.** `update.ts` already rejects a value outside a column's enum
   and already proves every entity-typed value belongs to this company. Both extend to custom
   fields unchanged: List options are the enum, and User/Customer/Supplier custom fields go
   through the same tenancy check.

The write is a separate statement from the row's ordinary column update, so an update node that
sets both writes twice. That is acceptable — both are inside the same durable step and the
step's at-most-once claim already covers a partial failure.

#### Builder

`ui/Builder/catalog.ts`'s module-level singleton becomes a **provider**: the route already has
the company's definitions via `useCustomFieldsSchema()` (loaded once per session in
`x+/_layout.tsx`), so the builder builds the overlay client-side and puts the catalog on context.
`ClauseRow.tsx`, `variableMenu.ts`, `ActionForm.tsx` and `TriggerForm.tsx`'s `EventPicker` read
it from there.

**Labels.** `WORKFLOW_LABELS` is a static generated `msg` table and cannot hold a per-company
name. The overlay supplies plain strings; `useWorkflowLabel(key, fallback)`'s existing fallback
path carries the custom field's `name` verbatim. Custom field names are customer data and are
deliberately not translated.

In the event picker, custom-field events are grouped under their entity like any other, with a
"Custom field" qualifier so `Priority` (a custom field) is distinguishable from a shipped column
of the same name.

### 5.2 Linking a record in a message

Three parts.

**(a) A record may be dropped into a template.** `rendersAsText` (`definition/types.ts:82`)
currently returns false for `entity` and `list<entity>`, which is why the variable menu hides
whole records in message fields. It starts returning true for `entity` (not for
`list<entity>` — a list of records in a sentence has no good reading). `renderValue` already
knows what to print for an entity: `row.readableId ?? row.name ?? id`. This is one rule change,
not a notify-only special case, so the validator's `checkTemplateParts` and the builder's
`textOnly` filter both follow automatically.

**(b) The notify action linkifies entity parts.** `renderTemplate` gains an optional
`ctx.linkFor?: (of: string, id: string) => string | null`. When supplied, an entity part renders
as a markdown link `[SO000123](https://…)`; when absent (webhook bodies, condition operands,
every other caller) it renders exactly as today. `packages/workflows` still constructs no URL
and imports nothing new — the callback is supplied by
`packages/jobs/src/workflows/actions/notify.ts`, which may import `ERP_URL` and already knows
`companyId`. The URL is the existing `buildNotificationLink` form
(`${ERP_URL}/api/link?event=workflow&documentId=…&companyId=…&documentType=<of>`), so the
company switch and the `RECORD_ROUTES` lookup are the ones already in production.

**(c) Renderers understand inline links.** One shared helper in `packages/notifications`:

```ts
renderInlineLinks(text: string): Array<{ text: string } | { text: string; href: string }>
```

It matches **only** `[label](url)` where `url` is an absolute `https://` URL on the ERP origin.
Anything else — a user typing `[x](javascript:...)`, a relative path, another host — is left as
literal text. This is a security boundary, not a formatting nicety: the body is customer-authored
and must not be able to inject an arbitrary destination.

Consumed by:
- `packages/documents/src/email/NotificationEmail.tsx` — detail values render the segments,
  anchors for the linked ones.
- `apps/erp/app/components/Layout/Topbar/Notifications.tsx` — **and this is where the body starts
  being rendered at all.** Today `payload.details` is written and never read. The Workflow row
  gains the body beneath the subject. The whole row is currently one `<Link>`; a nested anchor is
  invalid HTML, so the row's outer `<Link>` is replaced with a click handler on the row plus real
  anchors inline (the pattern the rest of the dropdown can keep using).

Slack is not a Workflow destination today and is out of scope.

### 5.3 The published version

#### (a) Strictly no behaviour edits

`store.ts` gains the `isReadOnly` guard on the mutators that lack it: `updateNodeData` (:260),
`renameNode` (:267), `setNodeExpanded` (:280), `setAllNodesExpanded` (:287), `removeNode` (:310).
`updateNodeData` is the one every config form funnels through, so that single guard closes the
trigger-mode bug and every sibling instance of it at once.

`BuilderControls.tsx`'s expand/collapse-all is disabled in read-only mode (`expanded` is part of
the persisted definition).

#### (b) Visibly disabled, not silently inert

`NodeFormProps` (`ui/Builder/config/forms/index.ts`) gains `isReadOnly`;
`WorkflowNodeCard.tsx:226` already has the flag in scope and passes it down. All six forms
(`TriggerForm`, `ConditionForm`, `ActionForm`, `EntityForm`, `LookupForm`, `FilterForm`) render
their controls `disabled`. The Event/Schedule toggle in `TriggerForm.tsx:430-455` is the headline
case: it becomes two disabled buttons showing the current mode rather than two live ones.

#### (c) A prominent lock affordance

Build `apps/erp/app/modules/workflows/ui/WorkflowLockAlert.tsx` — the component the canvas spec
called for and that was never built (and that `modules/workflows/AGENTS.md` already, wrongly,
lists as existing; that stale line gets fixed in the same change).

Copy `apps/erp/app/modules/items/ui/Item/ReleaseLockAlert.tsx`: `Alert variant="warning"` +
`LuTriangleAlert`, title "This version is live", description
`LOCKED_VERSION_MESSAGE` ("This version is live. Create a new version to make changes."), and a
"New version" button for anyone holding `workflows_update`. Mounted between `<BuilderHeader>` and
the canvas in `routes/x+/workflow+/$id.tsx:191-197`.

The no-permission case gets its own copy — a person who simply lacks `workflows_update` should
not be told to create a new version.

#### (d) Rearranging stays allowed

Read-only splits into two reasons, because they want different behaviour:

| | live version | no `workflows_update` |
|---|---|---|
| behaviour edits | blocked | blocked |
| node drag | **allowed** | blocked |
| auto-arrange | **allowed** | blocked |

So the store's single `isReadOnly` becomes `{ isVersionLocked, canEdit }` with a derived
`canMoveNodes = isVersionLocked ? canEdit : canEdit`, i.e. movement follows permission, not the
lock. Concretely:

- `onNodesChange` lets `position` / `dimensions` / `select` changes through whenever
  `canMoveNodes`, and keeps dropping `remove` and everything else.
- `WorkflowBuilder.tsx:155` `nodesDraggable={canMoveNodes}`.
- `arrangeNodes` / `setNodePositions` guard on `canMoveNodes`.

**Persistence.** Positions live in the versioned definition (`schema.ts:36`) and `/save` is
correctly locked server-side, so a second, narrower writer is needed:

- Route `apps/erp/app/routes/x+/workflow+/$id.positions.tsx` — requires `workflows_update`,
  does **not** call `checkWorkflowVersionLock`.
- Service `updateWorkflowNodePositions(client, { versionId, companyId, positions })` — reads the
  version's `nodes`, and for each incoming `{ id, position }` applies the position **only** if
  that node id already exists. Unknown ids are ignored, `edges` is never touched, and no other
  key of any node is written. The endpoint is therefore incapable of changing behaviour even if
  called by hand.
- `Autosave.tsx` splits: when the version is locked it diffs positions only and posts to
  `/positions`; otherwise it behaves exactly as today. Same 1s debounce.
- A refusal from either endpoint raises the existing `toast.error` path — which today never
  fires on a locked version because autosave is switched off entirely.

Nothing else about a live version becomes writable. `workflow.canvasState` (viewport) keeps its
existing deliberately-unlocked route.

### 5.4 Group and person pickers

- `packages/workflows/src/catalog/actions.ts:145` — `label: "role"` → `label: "group"`, then
  `pnpm run generate:workflow-catalog` and `pnpm run lingui:extract && pnpm run lingui:clean`.
  The **stored input key stays `role`** (D-9), so no definition migration and no change to
  `requireOneOf`, `notify.ts` or its test.
- `ui/Builder/fields/recordPickers.tsx` — `GroupPicker` (:145-153) and `UserPicker` (:132-141)
  both pass `type="employee"` to `<UserSelect>`, which routes to
  `get_user_select_groups(p_type => 'employee')`, i.e. *not customer- and not supplier-flagged*.
  That is the RPC's existing definition and matches the ask exactly: ad-hoc groups a company
  created by hand stay available; customer and supplier org/type groups disappear.
- Existing definitions pointing at a customer or supplier group keep working (validation checks
  the type, not the flags). They simply cannot be re-picked from the list. This is deliberate —
  silently breaking a live workflow to enforce a new picker rule would be worse.

### 5.5 Canvas visuals

- `WorkflowBuilder.tsx:166` — `<Background variant={BackgroundVariant.Dots} gap={24} size={1} />`,
  plus a `--xy-background-pattern-dots-color` override with light and dark values in the
  route-level stylesheet. Today no `--xy-*` override exists anywhere in the app, so the dot
  colour is whatever xyflow ships; that is why it reads loud.
- `edges/WorkflowEdge.tsx:40-48` — `getSmoothStepPath` → `getBezierPath`. One import, one call
  site; `labelX`/`labelY` come back from the same call so the disconnect button is unaffected.
  Stroke, dash pattern and the marching-ants animation are **unchanged** (explicitly kept).

## 6. Design Decisions

| # | Decision | Rationale |
|---|---|---|
| D-1 | Custom fields reach workflows as trigger **and** read **and** write | User's call. The engine already has the data; a trigger you cannot read or act on is half a feature. |
| D-2 | Per-company **overlay** on the catalog, not generated entries | The catalog is build-time and global (`events.generated.ts` is committed and drift-checked); custom fields are runtime and per-company. Generation is impossible; an overlay merged at the two construction sites is the smallest seam. |
| D-3 | The property path is one segment, `customFields.<fieldId>` | Keeps `walkPath` and `resolve.ts`'s `walk` single-step, and matches the differ, which never emits the bare `customFields` key. |
| D-4 | Event ids are **parsed** (`resolveEvent`), not added to `WORKFLOW_EVENTS` | `WORKFLOW_EVENTS` is committed, generated and drift-checked against a fresh build; a per-company id cannot live there. Parsing keeps one closed generated file and one open pattern. |
| D-5 | `computeEventIds` derives the id from the diff key, so the matcher stays company-blind | The nested differ already emits `customFields.<id>`; no per-company lookup is added to the hot path, and the `workflowTriggerEvent` join does the filtering it already does. |
| D-6 | Writes go through a `workflow_merge_custom_fields` RPC with `||` merge | A read-modify-write on the JSONB blob through the Supabase client races a concurrent human edit and would erase other fields. Invoker-rights keeps RLS. `p_table` is checked against the existing `customFieldTable` allowlist. |
| D-7 | Items are excluded | User's call. Item custom fields attach to `part`/`material`/`tool`/…; the catalog triggers on the shared `item` table. Merging needs a collision rule and is its own change. |
| D-8 | `rendersAsText` starts allowing `entity` (not `list<entity>`) | One general rule beats a notify-only special case; `renderValue` already knows how to print an entity. A list of records in a sentence has no good reading. |
| D-9 | The notify input key stays `role`; only its label becomes "Group" | Renaming the key needs a v4 definition format migration (`normalize.ts` `migrateDefinition`) plus changes to `requireOneOf`, `notify.ts` and its test, for zero user-visible gain. The stored value is already a group id. |
| D-10 | "Employee" means *not customer- and not supplier-flagged* | That is the existing `get_user_select_groups(p_type => 'employee')` definition (`20260714045245_user-select-rpcs.sql:53-60`) and matches the ask's wording ("not customers or suppliers"). Ad-hoc company groups stay pickable. |
| D-11 | Links are markdown `[label](url)`, linkified only for https URLs on the ERP origin | The body is one string with no structured channel. Restricting the pattern to our own origin is what stops customer-authored text from injecting an arbitrary destination. |
| D-12 | Movement follows **permission**, not the version lock | The ask. Positions carry no behaviour, and run history orders steps topologically (`topologicalNodeOrder`), never by position — so tidying a live version changes nothing a reader depends on, and the layout carries over when the next version is branched. |
| D-13 | A separate `/positions` route that can only write positions | `/save` is correctly locked server-side and must stay locked. A narrow endpoint that ignores unknown node ids and never touches `edges` or `data` is incapable of changing behaviour even when called by hand. |
| D-14 | Read-only splits into `isVersionLocked` vs `canEdit` | The two reasons want different behaviour (a locked version still allows dragging; missing permission does not) and different copy (telling someone without permission to "create a new version" is wrong). |
| D-15 | Connectors become true beziers; dashes and animation stay | User's call on both. `getBezierPath` returns the same `labelX`/`labelY`, so the disconnect button is unaffected. |
| D-16 | `File` custom fields are exposed as plain strings | The stored value is a path; treating it as an entity would imply a drill-through and a link that do not exist. |

## 7. Acceptance criteria

**Custom fields**

1. With a Text custom field "Rush Reason" on Sales Order, the trigger picker offers
   "Sales Order's Rush Reason changes" under Sales Order, labelled as a custom field.
2. Publishing that workflow writes one `workflowTriggerEvent` row with
   `eventId = 'salesOrder.customFields.<id>.changed'` and one `workflow-salesOrder`
   `eventSystemSubscription` with `UPDATE` in its operations.
3. Editing that field on a sales order queues exactly one `workflowRun`; editing an unrelated
   column queues none.
4. In a condition, `record.Rush Reason contains "expedite"` evaluates true for the value
   "Customer expedite" and false for "standard", and the step's `detail` records the clause.
5. A List custom field's condition offers exactly its `listOptions` as right-hand choices.
6. A Numeric custom field compares with `>` correctly (the declared type drives coercion, not
   the JS type of the stored JSON value).
7. Dropping a custom field into a notification body prints its value.
8. An Update action that sets one custom field leaves every other key in that record's
   `customFields` blob untouched, verified by reading the row before and after.
9. An Update action setting a List custom field to a value outside `listOptions` fails the step
   with a reason, and writes nothing.
10. A workflow in company A cannot see or trigger on company B's custom fields.
11. Deactivating a custom field removes it from the pickers; an already-published workflow
    referencing it still parses, and the drift check reports it.
12. Item triggers show no custom fields, and the builder says why rather than showing an empty
    group.

**Message links**

13. In a notify action's Message field, the variable menu offers the whole Sales Order record
    (not only its individual fields).
14. The resulting in-app notification shows the subject **and** the body, and the body's record
    reference is a working link to that sales order — including the company switch when the
    recipient's active company differs.
15. The emailed notification shows the same body with the same working link.
16. A body containing the literal text `[click](javascript:alert(1))` renders as literal text,
    with no anchor.
17. The same record dropped into a **webhook** body renders as its readable id with no URL and
    no markdown.

**Published version**

18. On a live version, clicking Schedule in the trigger node does nothing and the control is
    visibly disabled; reloading shows the trigger unchanged.
19. On a live version, every input in every node's config is disabled — verified for all six
    node types.
20. On a live version, a warning banner above the canvas states the version is live and offers
    "New version"; a user without `workflows_update` sees a different message with no button.
21. On a live version, dragging a node moves it, and the new position survives a reload.
22. On a live version, auto-arrange runs and its layout survives a reload.
23. A hand-crafted POST to `/x/workflow/$id/positions` carrying a changed `data` payload or a new
    node id changes nothing but the positions of already-existing nodes.
24. A hand-crafted POST to `/x/workflow/$id/save` on a live version still returns 409.
25. Branching a new version from a live one carries over the tidied positions.

**Pickers and visuals**

26. The notify action's second recipient field is labelled "Group", and its list contains no
    customer or supplier groups; a company's hand-made group is still listed.
27. The person field on the same action lists employees only.
28. A workflow already pointing at a supplier group continues to run and to display that group's
    name.
29. The canvas grid is dots at 24px spacing with an explicit low-contrast colour that is legible
    in both light and dark themes.
30. Connectors render as single continuous curves; the dashed marching-ants animation still runs
    and the disconnect button still sits on the line.

## 8. Open questions — resolved

- [x] **How far should custom fields reach into workflows?** — **Answer:** trigger **and** read
      everywhere (conditions, filters, messages), via a per-company catalog overlay. The engine
      already carries the data; a trigger whose value cannot be read is half a feature.
- [x] **Should workflows also be able to write a custom field?** — **Answer:** yes. Initially
      scoped out as read+trigger only; the user explicitly extended it to writing. Handled via
      the `workflow_merge_custom_fields` RPC so one field's write cannot clobber the blob, with
      validation reusing the existing enum and tenancy checks (D-6).
- [x] **What about Items, whose custom fields live on the subtypes?** — **Answer:** leave Items
      out for now; the other nine triggerable entities are covered and the builder says so
      plainly rather than showing an empty list (D-7).
- [x] **What should a record link look like in a message?** — **Answer:** the record itself
      becomes insertable and renders as its readable id, clickable, in email and in-app (D-8,
      D-11). A raw-URL property was rejected as uglier to read.
- [x] **Fix the in-app bell dropping the message body?** — **Answer:** yes — otherwise the link
      exists only in email and the feature looks broken in-app.
- [x] **Where do node positions for a live version get saved?** — **Answer:** into the live
      version, positions only, through a narrow endpoint that rejects everything else (D-12,
      D-13). Chosen over a separate layout store so tidying carries over when the next version
      is branched.
- [x] **How strongly should the read-only state be shown?** — **Answer:** a warning banner above
      the canvas **and** every node control visibly disabled. The silent-evaporation behaviour is
      the actual reported bug.
- [x] **Should the person picker get the same employee filter as the group picker?** —
      **Answer:** yes; it is the identical leak and inconsistency between two adjacent fields
      would be worse.
- [x] **Grid style?** — **Answer:** fainter dots, wider apart (24px), with an explicit
      low-contrast colour for both themes.
- [x] **Edge style?** — **Answer:** true curves. The user noted React Flow already ships a
      curvier edge type by default — that is `getBezierPath`, versus the `getSmoothStepPath`
      currently in use (D-15).
- [x] **Keep the dashed marching-ants animation?** — **Answer:** yes, keep it as-is.

## 9. Risks

- **Catalog construction moves from a module singleton to a provider.** `ui/Builder/catalog.ts`
  is imported directly in several files; every one must move to the context or it will silently
  see a catalog with no custom fields. Grep is the mitigation, plus the fact that a missed site
  shows up immediately as a missing property in the picker.
- **`rendersAsText` allowing `entity` widens more than messages.** It is read by the validator
  and by the variable menu, so records become droppable into every template field including
  webhook bodies. That is intended (they render as the readable id), but it is a behaviour change
  to a shared rule and needs the validator's tests extended.
- **Custom-field ids leak into stored trigger rows.** Deleting a custom field leaves a
  `workflowTriggerEvent` row that can never fire again. The extended drift check surfaces it;
  cleaning it up automatically is deliberately not in scope.
- **The notification row's nested-anchor change** touches a component outside the workflows
  module that every notification type renders through. Regression surface is the whole bell.
- `packages/erp` is chronically near TypeScript's instantiation budget (`.ai/lessons.md`); the
  new catalog context type is new type surface in a widely-imported file.

## 10. Changelog

- **2026-08-19** — Initial spec. Eleven open questions resolved with the user before writing
  (§8); the custom-fields scope was extended from read+trigger to include writing during that
  interview.
- **2026-08-19** — Implemented. Plan: `.ai/plans/2026-08-19-workflow-improvements-round-2.md`.
  Four deviations from the design, all decided during execution and all narrower than the spec:
  1. **§5.2c / email links.** `packages/documents` did not depend on `@carbon/notifications`,
     and its local `NotificationDetail` copy carried a comment saying that avoidance was
     deliberate. The user chose to add the dependency rather than duplicate the parser — the
     link matcher is a security boundary and must be the same code in both renderers.
  2. **§5.2c / the bell row.** The outer `<Link>` is dropped only for rows that actually have a
     body. A `role="link"` div loses cmd-click, open-in-new-tab and the status-bar URL, so every
     other notification type keeps its real anchor and is byte-for-byte unchanged. The body
     reader is also gated on `NotificationEvent.Workflow`, because `JobOperationMessage` writes
     a `{label:"Message"}` detail whose text its description already embeds.
  3. **§5.3c / the banner button.** The new-version route is POST-only and takes
     `copyFromVersionId`, so the button submits a fetcher rather than linking, and it is gated on
     `workflows_create` (the permission that route actually requires) rather than
     `workflows_update`.
  4. **§5.1 / writing.** A custom field's value is written as a string, matching what the ERP's
     own form layer stores; `fromColumn` coerces back by the DECLARED type on read, so the
     round-trip is exact. The ordinary column update is skipped entirely when a step sets only
     custom fields, rather than writing a bare `updatedBy`/`updatedAt`.

  Also fixed in passing, both pre-existing: `packages/react`'s `Input` applied
  `disabled={isDisabled}` AFTER the props spread, silently overriding any caller-supplied
  `disabled` (two Linear/Jira search boxes were affected); and `@carbon/notifications` had no
  test runner at all.
