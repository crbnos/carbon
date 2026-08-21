---
description: The workflow catalog — four hand-written inputs generate one committed catalog of every trigger, action and operation a customer can pick; never hand-edit the generated files, and every declared moment must be raised somewhere or the build fails.
paths:
  - "packages/workflows/src/catalog/**"
  - "packages/lib/src/workflows/**"
  - "scripts/generate-workflow-catalog.ts"
  - "scripts/check-workflow-catalog.ts"
---

# Workflow Event Catalog

The list of things a customer can trigger a workflow on, and of the actions and
operations a workflow can then use. "Workflow" here is the
customer-facing feature (a "when this happens, do that" rule built on a canvas) — not the
`.claude/rules/workflow-*.md` developer-procedure files, and unrelated to
`nonConformanceWorkflow`.

Spec: `.ai/specs/2026-07-30-workflows-event-catalog.md`. Package guide:
`packages/workflows/AGENTS.md`.

## Four hand-written inputs, three generated files

```
packages/workflows/src/catalog/entities.ts   HAND-WRITTEN  record types + watched columns + write allowlist
packages/workflows/src/catalog/moments.ts    HAND-WRITTEN  business events + labels + outputs
packages/workflows/src/catalog/actions.ts    HAND-WRITTEN  the actions with no generic form
packages/workflows/src/catalog/operations.ts HAND-WRITTEN  read-only computations
                    │
                    ▼  scripts/generate-workflow-catalog.ts  (buildCatalog, pure)
packages/workflows/src/catalog/events.generated.ts   COMMITTED  ids, outputs, permission, match
packages/workflows/src/catalog/actions.generated.ts  COMMITTED  action + operation catalogs
packages/workflows/src/catalog/labels.generated.ts   COMMITTED  one msg`` per event, action and operation id
```

Today: 10 triggerable entities with 77 watched columns → 97 record events, plus 9 moments
= **106 events**, plus property maps for 17 entities (the 10 triggerable ones and 7
reference-only: `user`, `group`, `jobOperation`, `nonConformanceType`, `salesInvoice`,
`purchaseInvoice`, `location`), plus **16 actions** and **15 operations**.

To add an entity, a moment, an action or an operation, edit the one hand-written file
and run:

```bash
pnpm run generate:workflow-catalog   # generates + biome-normalises the three outputs
pnpm run check:workflow-catalog      # the CI `catalog` job
```

**Never hand-edit a `*.generated.ts`.** The check script compares the committed data to a
fresh build and fails with "run pnpm run generate:workflow-catalog".

## One kind of event

A record type with 8 watched columns yields 10 events: `<entity>.created`,
`<entity>.deleted`, and `<entity>.<column>.changed` per column. There is deliberately **no
generic `updated` event** — a customer picks the field they care about.

Ids are dotted camelCase (`purchaseOrder.status.changed`, `production.jobReleased`) —
deliberately unlike Carbon's PascalCase enum convention, because these are identifiers in a
generated file, not database enum values.

Only the `match` block distinguishes a record event from a moment, and only the phase-3
matcher reads it:

```ts
match: { table: "purchaseOrder", operation: "UPDATE", field: "status" }   // record
match: { moment: "production.jobReleased" }                              // moment
```

A `.changed` event hands out `record`, `before` and `after`; `created`/`deleted` hand out
`record`; a moment hands out exactly its declared outputs.

## Why the schema is injected

`buildCatalog(registry, moments, actions, operations, schema)` takes
`packages/database/src/swagger-docs-schema.ts` as an **argument**. That file is already generated and committed and — unlike `types.ts` — is
a runtime *value* carrying every column's type, enum values and foreign-key target, so no
TypeScript-compiler-API parsing is needed. Injecting it keeps `@carbon/database` out of
`@carbon/workflows`' runtime graph (it is a **devDependency, types only**) and lets the
transform be unit-tested in `build.test.ts`.

Entity properties are generated from the table's own columns, minus `companyId`,
`customFields`, `embedding`, `updatedAt` and `updatedBy`. A foreign key becomes
`entity(target)` **only when the target is in the registry**, which keeps dot-chaining honest
without dragging 40 lookup tables in. Property paths use column names —
`record.supplierId.name`, not a de-suffixed `supplier` alias.

Composite foreign keys like `(supplierId, companyId)` carry no `<fk>` note in the swagger
schema, so those columns declare `ref` in the registry. A `ref` that **disagrees** with a
present foreign key is a build error, so a wrong one can never silently mislabel a property.

## Labels are a separate file, and that is forced

Carbon's convention for a translatable string outside a React component is `msg` from
`@lingui/core/macro` (never `t`, which throws outside a locale provider). `msg` is a
**build-time macro**: importing an untransformed one from plain Node — the matcher in
`packages/jobs`, or any vitest run — throws.

So `events.generated.ts` imports nothing from `@lingui/*` and is what the runtime catalog and
every check read; `labels.generated.ts` is imported only by Vite-built app code, by its
explicit deep path. `src/catalog/index.ts` does not re-export it.

Four templates cover the generated side, with the article derived from the label
(`An item is created`, not `A item is created`). The vowel test is wrong for u-words, so a
registry entry can set `article: "A"` — `user` does:

```
A/An {entity} is created
A/An {entity} is deleted
A/An {entity}'s {field} changes
Update a/an {entity}                 the generated <entity>.update action
```

Moment, action and operation labels are hand-written and mandatory (an empty one is a
build failure from `validateCatalogInputs`).
`packages/workflows/src` is in `lingui.config.js`'s `erp` catalog `include` and in
`//#lingui:compile`'s `inputs` in `turbo.json`. After regenerating, run
`pnpm run lingui:extract && pnpm run lingui:clean` — the clean step strips the origin
references that otherwise churn every `.po` file.

## Moments and `raiseMoment`

A moment is a business event a row change cannot express. `raiseMoment` lives in
`packages/lib/src/workflows/raise-moment.ts` (exported as `@carbon/lib/workflows`) because
raise sites span `apps/erp` and `apps/mes`, and `@carbon/lib` is the only package both import.
It mints a `momentId` (nanoid) and sends one `carbon/workflow-moment.raised` Inngest event with
that id set as **both** a payload field and the Inngest event id, so a double send is suppressed
upstream. The listener is the `workflow-moment` function in `packages/jobs`, which feeds the same
matcher core as record changes and uses `moment:<momentId>` as its `sourceEventId` — see
`workflow-matcher.md`.

```ts
await raiseMoment("production.jobReleased", {
  outputs: { job: { id }, releasedBy: { id: updatedBy } },
  companyId,
  actorId: updatedBy
});
```

The key and every output name are compile-checked against the declaration, which is why a
moment's variables are trustworthy in the builder — the type system guarantees the raise site
supplied them. `raiseMoment` dispatches through `trigger()` from `packages/lib/src/trigger.ts`
rather than calling `inngest.send()` directly: the Inngest client is constructed without
`EventSchemas`, so a direct send is entirely untyped and a drifted payload would fail silently
inside a function designed never to throw.

Three rules the raise sites follow:

- **Raise in the service function, not the route, wherever a service function exists.** Every
  `apps/erp/app/modules/*/*.service.ts` export is also callable over `POST /api/mcp` through
  `apps/erp/app/routes/api+/mcp+/lib/direct-executor.ts`, whose blocklist is one entry long. A
  route-level raise silently misses every MCP caller. After changing a service signature, run
  `pnpm run generate:mcp` — the executor maps arguments by declared parameter name.
- **Raise after the write commits, and only if it did.** For the four posting moments the write
  happens inside a Deno edge function that cannot import app code, so the route raises once the
  invoke returns cleanly. Place the raise **below** the route's rollback `catch`, not inside the
  `try`: `raiseMoment` not throwing stops it from *causing* a rollback, but not from being
  reached before later code throws and reverts the document to Draft. Announcing a post that
  then got rolled back would fire workflows on a record the UI still shows as Draft.
- **`raiseMoment` never throws into its caller** — it logs and returns. Losing a moment is a
  missed workflow; failing the caller would break a business action that already committed.

The nine v1 moments and their sites:

| Moment | Raised from |
|---|---|
| `production.jobReleased` / `production.jobHeld` | `updateJobStatus`, `modules/production/production.service.ts` — only on a real transition into `Ready` / `Paused` (it reads the prior status; every transition funnels through this one setter) |
| `production.jobOperationCompleted` | `finishJobOperation`, `apps/mes/app/services/operations.service.ts` |
| `sales.quoteSent` | `finalizeQuote`, `modules/sales/sales.service.ts` |
| `sales.quoteAccepted` | `convertQuoteToOrder`, same file |
| `inventory.receiptPosted` | `x+/receipt+/$receiptId.post.tsx`, below the rollback catch |
| `inventory.shipmentPosted` | `x+/shipment+/$shipmentId.post.tsx`, below the rollback catch |
| `invoicing.salesInvoicePosted` | `x+/sales-invoice+/$invoiceId.post.tsx`, below the tenant guard |
| `invoicing.purchaseInvoicePosted` | `x+/purchase-invoice+/$invoiceId.post.tsx`, below the rollback catch |

`packages/jobs/.../tasks/post-transaction.ts` posts the same three documents and looks like a
second caller, but **nothing sends `carbon/post-transaction`** — it is dead code. Don't add a
raise there until something triggers it.

Seven further candidates are **still undeclared** because each has two or more independent
write paths, so one raise site would not cover them: job completed, purchase order issued,
sales order confirmed, quote lost, non-conformance opened, non-conformance closed,
inspection failed.

## Actions and operations

The same generator also expands two more hand-written files and each entity's `write`
allowlist into `actions.generated.ts`, which holds **both** `WORKFLOW_ACTION_CATALOG` and
`WORKFLOW_OPERATION_CATALOG`:

- **Actions** are what a workflow does. 6 hand-written (`job.create`,
  `nonConformance.create`, `purchaseOrder.create`, `salesOrder.create`, `notify`,
  `webhook`) plus one `<entity>.update` generated per entity that declares `write`.
- **Operations** are read-only computations over things a property map cannot reach —
  stored totals live only on views, and counts span child tables.

`watch` and `write` sit side by side in `entities.ts` and are **not** symmetric: a watched
column is inert, a written one is an effect the workflow performs as the owner, so `write`
is a restrictive allowlist. `createWorkflowCatalog()` in `catalog/catalog.ts` exposes all
four maps (`getEvent`, `getEntity`, `getAction`, `getOperation`); `getActionRoute(id)` is
deliberately kept off `CatalogAction`.

Everything about how these actually run — the dispatcher seam, the update executor's
tenancy checks, webhook signing and the SSRF guard — is in
[workflow-actions.md](workflow-actions.md).

## The checks

`scripts/check-workflow-catalog.ts`, wired as the `catalog` job in
`.github/workflows/check.yml`:

1. **Every declared moment has at least one raise site.** A dead trigger is worse than a
   missing one: a customer builds a rule, nothing ever raises it, and it silently never fires.
2. **Every raise site names a declared moment** (the type system covers this too).
3. **Every registry table, watched column and writable column still exists.** Also a compile
   error, via type-only `TableName` / `ColumnOf<T>` from `@carbon/database/audit.config` — a
   migration renaming a column fails `tsgo` at the registry line, naming the column. The
   script repeats it in plain English and catches skew between the two generated schema
   artifacts. A writable column that is identity or audit (`id`, `companyId`, `createdBy`,
   `createdAt`, `updatedBy`, `updatedAt`) is refused outright.
4. **The committed catalog equals a fresh build** — events, entities, actions and operations
   each compared separately so the failure names which one drifted. Compares data, not file
   text, so formatting can never make it flap.
5. **Every moment, action and operation has a label**, and names only registry entities for
   its outputs, inputs and output.
6. **Every action has an implementation route** — a `call` that is a real tool in
   `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json` (run `pnpm run generate:mcp`), or
   membership in the built-in set (`notify`, `webhook`).

Deploy-time, against a live database (so not CI — they sit with `packages/checks`' invariants):
the `workflow-trigger-event-drift` SQL invariant and
`pnpm --filter @carbon/checks workflow-events`.

## Gotchas

- The entity is `item`, not `part` — `part` is a 12-column subtype extension that has never had
  the record-change trigger attached, so it cannot announce anything. And it is
  `nonConformance`, not `issue` — `issues` is a **view**, and a view carries no trigger. "Issue"
  is only the customer-facing label.
- Stored totals are not watchable and not dot-readable. `purchaseOrder.orderTotal` exists only
  on the `purchaseOrders` **view**, which has no trigger and no announcement. They are reachable
  as operations instead (`purchaseOrder.total`, `salesOrder.total`).
- Carbon's status columns are inconsistently named and the registry records reality:
  `supplier.supplierStatus`, `customer.customerStatusId`.
- `CatalogEvent` carries `permission` and `match` but **no `label`** — labels are keyed by
  event id in the separate generated file, which also holds action and operation labels.
- A hand-written action id that collides with a generated `<entity>.update` is a build error,
  not a silent overwrite.

## Custom fields — the per-company overlay

The catalog is build-time and global; a company's custom fields are runtime and per company,
so they cannot be generated into `events.generated.ts`. Instead `catalog/custom-fields.ts`
builds a `CatalogOverlay` from the company's `customField` rows, and
`createWorkflowCatalog(overlay)` merges it — **generated first, overlay second**, so a real
column always wins and a customer cannot shadow one.

- The property path is ONE segment: the literal string `customFields.<fieldId>`, keyed by the
  field's **id**, which is the key inside the JSONB blob. That keeps `walkPath` and the runtime
  `walk` single-step, and matches the differ, which never emits the bare `customFields` key.
- `custom-fields.ts` holds the ONLY `DataType → ValueType` map. List → `string` plus `choices`
  from `listOptions`; User/Customer/Supplier → `t.entity(...)`; File → the stored path as a
  string, not a link.
- Trigger ids are `<entity>.customFields.<fieldId>.changed` and are **parsed, not looked up**:
  `WORKFLOW_EVENTS` stays a closed, committed, drift-checked record. `getCatalogEvent(id)` is
  the single lookup — the static map first, then `resolveCustomFieldEvent`. Every consumer goes
  through it, including `sync.ts`'s `deriveWorkflowSubscriptions`.
- `item` is excluded: its custom fields attach to the subtypes (`part`, `material`, `tool`, …)
  while the catalog triggers on the shared `item` table. Reference-only entities are excluded
  too — no `watch` block means no change events at all.
- The matcher stays **company-blind**: `computeEventIds` derives the id from the
  `customFields.<id>` diff key the nested differ already emits, and the existing
  `workflowTriggerEvent` join does the filtering. No company lookup enters the hot path.
- Writes go through the `workflow_merge_custom_fields` RPC (SECURITY INVOKER, `p_table`
  validated against `customFieldTable`) so setting one field cannot erase the others.
- The engine builds the overlay once per run in the `custom-fields` durable step, reading
  `customField` through the **owner's** client like every other business read.
