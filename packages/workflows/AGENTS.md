# @carbon/workflows

The shared contract for a **workflow definition** — the zod schema, the read-time
normaliser, the validator that decides whether a workflow may be activated, the
generated catalog of everything a customer can pick, and the pure runtime that
evaluates a node. It runs nothing and reads no database.

"Workflow" here means the customer-facing feature: a "when this happens, do that" rule a customer
builds on a canvas. It is **not** the generic sense used by the `.claude/rules/workflow-*.md`
developer-procedure files, and unrelated to `nonConformanceWorkflow`.

Specs: `.ai/specs/2026-07-30-workflows-foundation.md` (schema, validator, runtime) and
`.ai/specs/implemented/2026-07-30-workflows-catalogs.md` (actions and operations).

## Always

- Change the schema **here**, never in a consumer. The builder, the activation gate and the
  engine all read this one package — if any of them can disagree about what is valid, a
  customer can activate something broken and it will act on real records.
- Turn a stored row into a definition with `readWorkflowVersion(row)`. It is the single boundary
  where untyped JSON becomes the typed model, and it returns `{ok: true, definition}` or
  `{ok: false, failure, message}` — never a blank canvas standing in for a row it could not read,
  because the builder would then save over a definition nobody could see.
- Upgrade an older stored shape only inside `migrateDefinition` in `src/definition/normalize.ts`.
  It is private and runs on the **raw JSON before** the current-schema parse — a document old
  enough to need upgrading cannot satisfy the current schema, so migrating after that parse could
  never run. It carries three upgrades today: v1 → v2 resets a lookup node's `match` to `[]` because
  its shape changed (no v1 lookup could be activated); v2 → v3 backfills node `name`s from
  the old `title`; v3 → v4 renames the `entity` node type to `compute`, leaving stored node
  names alone — a name is an identifier other nodes reference.
- Bump `CURRENT_DEFINITION_FORMAT_VERSION` (now **4**, in `src/definition/schema.ts`) when the
  stored shape changes, and add the upgrade to `migrateDefinition` in the same change.
- Pass a `WorkflowCatalog` into `validateDefinition`. `createWorkflowCatalog()` in
  `src/catalog/catalog.ts` is the real one — events, entities, actions and operations behind one
  interface; `createFixtureCatalog()` is for tests only.
- Add a node type by adding one entry to `NODE_KINDS` in `src/definition/nodes.ts`. The mapped type
  makes a missing entry a compile error, which is the only thing stopping a new node type from
  validating clean with no handles and no checks at all.
- Take operator names from `Operator` in `@carbon/utils` — Carbon's one condition vocabulary, shared
  with storage rules. `OPERATORS_BY_TYPE` decides which of them a workflow may use where; it does not
  invent names.
- Keep zod unions **flat** and avoid recursive generics. `apps/erp` sits near TypeScript's
  instantiation budget, so new type surface here can trip TS2589 in unrelated files.
- Add an entity, a moment, an action or an operation by editing **one hand-written file** in
  `src/catalog/` — `entities.ts`, `moments.ts`, `actions.ts`, `operations.ts` — then run
  `pnpm run generate:workflow-catalog`. Nothing else in `src/catalog/` is authored by hand.
- Declare a `permission: { module, action }` on every action and operation. It is **required** on
  `CatalogAction` and `CatalogOperation` (optional on `CatalogEntity`), and it is what the engine
  checks before the node runs — `NodeExecutor.permission` returns it, so the gate and the work come
  from the same catalog entry and cannot drift.
- Reach the world from `src/runtime/` only through `ctx.services` — the `WorkflowServices` port
  (`runAction` / `runOperation` / `search`) declared in `src/runtime/types.ts` and **required** on
  `RuntimeContext`, so a missing implementation is a compile error rather than a run-time surprise.
  `@carbon/jobs` supplies the one implementation.

## Never

- Never import from `@carbon/react` or anything app-specific. `@carbon/database` is a
  **devDependency used for types only** (`ColumnOf` / `TableName` in `src/catalog/entities.ts`) —
  never import it as a value. Runtime dependencies are `zod`, `@carbon/utils`, `@lingui/core`, and
  `@internationalized/date` (browser-safe, ES2019-safe date/timezone maths). Do not add a fifth
  without asking first.
- Never reimplement timezone-aware schedule maths in a consumer. The next-occurrence logic lives in
  `src/definition/schedule.ts` (`nextOccurrenceAfter`, `nextRunAfter`, `scheduleOffsetSeconds`) and
  is used by the scheduler and the phase-8 preview; both must call this, not re-derive it.
- Never hand-edit `src/catalog/*.generated.ts` — regenerate instead.
- Never import `src/catalog/labels.generated.ts` (`WORKFLOW_LABELS`) from anything but a Vite-built
  app. `msg` is a build-time macro; plain Node (the matcher, the engine, any vitest run) throws on
  import. That is why labels are a separate file from the runtime catalog, and why
  `src/catalog/index.ts` does not re-export them.
- Never import `src/catalog/` from `src/definition/`. The catalog is injected into the validator,
  not baked into it; `createFixtureCatalog`'s `omit*` options exist to prove that.
- Never let a stored node/edge shape reach a consumer without going through the schema.
- Never represent a list of lists — a list's `of` accepts scalars only, by construction.
- Never import a Node builtin (`node:crypto`, `node:dns`, …) or write a BigInt literal here.
  `apps/erp` compiles this package's source for the browser at **ES2019** — that is why hashing
  goes through `fnv1a64` from `@carbon/utils` and why the webhook's HMAC and DNS guard live in
  `@carbon/jobs`, behind `WorkflowServices`.

## Layout

```
src/definition/
├── types.ts      # value types, operators, refs, literals, templates, clauses, schedules
├── issues.ts     # WorkflowIssueCode + WorkflowIssue
├── schema.ts     # node/edge/definition schemas, format version, handle names, caps
├── batch.ts      # batchCandidates + batchPlan — whether an action repeats, read off the wiring
├── nodes.ts      # NODE_KINDS — what each node type declares about itself
├── normalize.ts  # readWorkflowVersion + the migrateDefinition seam
├── catalog.ts    # WorkflowCatalog + RequiredPermission + walkPath + createFixtureCatalog
└── validate.ts   # validateDefinition -> WorkflowIssue[]

src/catalog/
├── entities.ts             # HAND-WRITTEN. 16 record types — 10 triggerable (watch) + 6 reference-only; write = the update allowlist
├── moments.ts              # HAND-WRITTEN. 9 business events, their labels and outputs
├── actions.ts              # HAND-WRITTEN. 6 actions — 4 creates, notify, webhook
├── operations.ts           # HAND-WRITTEN. 15 read-only computations over one record
├── build.ts                # buildCatalog(registry, moments, actions, operations, schema) — pure, schema injected
├── events.generated.ts     # COMMITTED. WORKFLOW_EVENTS (106) + WORKFLOW_ENTITIES (16). No Lingui import
├── actions.generated.ts    # COMMITTED. WORKFLOW_ACTION_CATALOG (16) + WORKFLOW_OPERATION_CATALOG (15)
├── labels.generated.ts     # COMMITTED. WORKFLOW_LABELS — one msg`` per event, action and operation id
├── catalog.ts              # createWorkflowCatalog() -> WorkflowCatalog, plus getActionRoute
└── index.ts                # barrel (labels deliberately excluded)

src/runtime/
├── types.ts     # RuntimeValue, Resolution, EntityLoader, WorkflowServices, RuntimeContext, NodeResult, NodeExecutor
├── values.ts    # value constructors + fromColumn coercion
├── resolve.ts   # refs, the current item and templates -> a value, or a readable reason
├── compare.ts   # operator semantics + clause evaluation
├── condition.ts # the Condition executor
├── filter.ts    # the Filter executor
├── compute.ts   # the Compute executor — one catalog operation
├── lookup.ts    # the Lookup executor — one search
├── action.ts    # the Action executor — one item, never a loop
├── executors.ts # EXECUTORS: node kind -> executor. A kind with no entry refuses to run
├── batch.ts     # planBatch + itemKeyFor
├── template.ts  # re-export of renderTemplate / renderValue (they live in resolve.ts)
├── fixtures.ts  # TEST-ONLY fake loader/context. Not exported from the package root
└── index.ts     # barrel

src/run-trigger.ts # runTriggerSchema — what fired a run; shared with @carbon/lib and @carbon/jobs
src/sync.ts        # trigger-event + subscription reconciler
```

`src/runtime/` is pure: no I/O, no database client, no Supabase. Records are read
through the injected `EntityLoader`, and everything else that touches the world goes
through `WorkflowServices`; `@carbon/jobs` implements both over the workflow owner's
own connection. Comparison semantics live in `runtime/compare.ts` and must not be
re-implemented anywhere else.

Permission and execution share one `EXECUTORS` entry per node kind. Two lookups could
drift, and the one that drifts silently is the permission check — so a new kind is one
registry line, never an extended `node.type` chain.

## `sync.ts` — deriving what the matcher reads

Five exports, all re-exported from the package root:

- `deriveWorkflowTriggerRows(nodes)` — trigger nodes → one desired `workflowTriggerEvent`
  row per event id, carrying that node's origin (a duplicated id keeps the first origin).
  Throws if the stored nodes do not parse.
- `deriveWorkflowSubscriptions(eventIds)` — event ids → one `workflow-<table>`
  `eventSystemSubscription` per distinct table with exactly the operations those events
  need, resolved through each event's catalog `match`. Moments contribute nothing.
- `findTriggerSchedule(nodes)` — returns the `Schedule` from the trigger node, or `null` if
  the workflow is event-triggered. Throws if nodes fail to parse.
- `syncWorkflowTriggers(db, companyId, workflowId)` — rewrites one workflow's trigger rows,
  **writes `workflow.nextRunAt`** (the scheduler's bookmark), and reconciles the company's
  subscriptions in one transaction. Returns `{ eventIds, tables, scheduled }`. Call it on
  promote, on trigger edit, and on activate/deactivate.
- `syncWorkflowSubscriptions(db, companyId)` — standalone repair from existing rows.

Kysely is imported **type-only** (`import type { Kysely, Transaction } from "kysely"`), so
it stays a devDependency and this package keeps its four runtime dependencies
(`zod`, `@carbon/utils`, `@lingui/core`, `@internationalized/date`). Kysely also **bypasses
RLS** — the caller authorizes first (the activation route gates on `workflows_update`).

This is the one thing here that lives in this package for a dependency reason rather than a
conceptual one: it needs `WORKFLOW_EVENTS`, and `@carbon/database` (its more natural home,
beside `event.ts`) cannot depend on `@carbon/workflows` without creating the package cycle
Turborepo rejects. See `.claude/rules/workflow-matcher.md`.

## The event catalog

One customer-facing concept — an **event** — from two hand-written inputs. A record type with
8 watched columns yields 10 events (created, deleted, one per column); there is deliberately
**no generic `updated` event**. Moments cover what a row change cannot express. Downstream,
nothing knows which input produced an event: only the `match` block distinguishes them, and only
the matcher in `@carbon/jobs` reads it.

`buildCatalog` takes the swagger schema as an argument rather than importing it, which is what
keeps `@carbon/database` out of this package's runtime graph and lets the transform be unit-tested
in place. Entity properties are generated from the table's own columns so a customer can reach any
property by typing a dot; a foreign key becomes an entity ref only when its target is in the
registry, and a `ref` that disagrees with the schema's foreign key is a build error.

`scripts/check-workflow-catalog.ts` (CI job `catalog`) enforces: every moment is raised somewhere,
every raise site names a declared moment, every watched and writable column still exists, every
action's `call` names a real tool in `tool-metadata.json`, and the committed catalog — events,
entities, actions, operations and labels — matches a fresh build. A declared-but-never-raised
moment is a trigger a customer can subscribe to that can never fire — worse than a missing one, so
it fails the build.

## Actions and operations

The other half of the catalog: what a workflow can **do**, and what it can **work out**. Both are
built by the same `buildCatalog` into `src/catalog/actions.generated.ts`.

- **Actions** (`WORKFLOW_ACTION_CATALOG`, 16). Six are hand-written in `actions.ts` — four record
  creates (`job.create`, `nonConformance.create`, `purchaseOrder.create`, `salesOrder.create`),
  plus `notify` and `webhook`. The other ten are the `<entity>.update` family, **generated from
  each registry entry's `write` allowlist** — an entity with no `write` block yields no update
  action, which is how "a workflow may set this field" stays a deliberate, reviewed decision
  rather than the whole table. `build.ts` refuses identity and audit columns outright, and a
  hand-written id colliding with a generated one is a build error.
- **Operations** (`WORKFLOW_OPERATION_CATALOG`, 15). Read-only computations over a **single**
  record — one input, one scalar out — for things a property map cannot reach: stored totals live
  only on views (no trigger, not dot-readable) and counts span child tables.

Two fields exist for the job side and are deliberately kept **off** `CatalogAction`, which the
validator reads: `call` (a tool name in `tool-metadata.json`, so a create goes through the ERP's
own upsert service function) and `update` (the entity whose columns to write). Read them through
`getActionRoute(id)` — routing off the shape of an id would let something that merely reads like
`x.update` reach the update path. `requireOneOf` is on `CatalogAction`, because "at least one of
user or role" is a validation rule, not a routing detail. `tool-metadata.json` lives at
`apps/erp/app/routes/api+/mcp+/lib/`; after changing a service signature run `pnpm run generate:mcp`.

Implementations live in `packages/jobs/src/workflows/actions/` — see
`.claude/rules/workflow-actions.md`. Every action and operation declares the permission its
implementation needs; nothing here executes anything.

## Values a customer can plug in

`valueOrRefSchema` is a flat union of five forms: a `literal`, a `{kind:"variable"}` ref, the
`{kind:"item"}` current item, and a `{kind:"template"}` — text with variable and item parts
interleaved, which is how a customer writes "Order {record.readableId} needs attention". A template
is **only** valid where a `string` is expected; anywhere else is a `TYPE_MISMATCH` saying a message
can only be text. Its parts are checked one at a time so a bad variable names its own place, and
`renderTemplate` (in `src/runtime/resolve.ts`, re-exported from `template.ts` to avoid an import
cycle) fails the **whole** template if any part fails to resolve — a blank would be a silent lie.

What a part may hold is narrower than what a value may be: `rendersAsText` (`definition/types.ts`)
rejects a record and a list of records, and `checkTemplateParts` in `validate.ts` raises a
`TYPE_MISMATCH` at `<field>.parts.<n>` for one. A record has no reading as text — it would flatten
to whichever column looked name-ish, or to a raw id — so the property is what the customer meant.
The builder's variable menu passes `textOnly` for the same reason: it hides the record row and
still drills into it.

The fifth form is `{kind:"pairs"}` — named rows, carrying the webhook action's request headers.
It is legal **only** where a catalog input sets `pairs: true`, and such an input accepts nothing
else; both directions are a `TYPE_MISMATCH` in `checkInputs`. A row's value is a `PairValue`, the
four simple forms — a `pairs` inside a `pairs` is unrepresentable rather than merely invalid, so no
recursive schema is needed. Rows flatten to `<field>.entries.<n>` sites in `expandTemplate`, so a
bad reference or a record dropped into a header value reports at its own row.

`CatalogInput.showWhen` (`{ input, equals }`) gates both **visibility and requiredness**: a
gated-off input is never `MISSING_INPUT`, and a value left behind on one is `INCOMPLETE_CONFIG`.
It reads literals only — a gate whose target holds a variable cannot be read at build time, so it
opens rather than hiding the customer's work. `buildCatalog` refuses a `showWhen` naming an unknown
input, one whose target has no `choices`, or one expecting a value outside them.

`CatalogInput.defaultValue` is what the builder seeds a new node's input with; nothing reads it at
run time, and `buildCatalog` refuses one outside the input's `choices`. It is not a fallback — a
required input with a default is still `MISSING_INPUT` when a stored node omits it.

`RuntimeValue` has a matching fourth kind, `{kind:"pairs"}`, which is **runtime-only**: no
`ValueType` names it, so it is never compared, looped over, or produced as a step output. It exists
so a resolved header set stays recognisable to the run log's redactor.

## Node kinds

Everything one node type does — handles, values, outputs, the list it loops over, type checks,
config checks — lives in its single `NODE_KINDS` entry, seven members the mapped type makes
mandatory. `validate.ts` owns only the cross-cutting layers below; it never switches on a node type.

`loopList` is where "which single list does this step work through" is answered **once**: a filter's
source, the one list wired into an action's single-value input, and `undefined` for every other
kind. A filter's outputs are its loop list; the item a `{kind:"item"}` value reads is that list's
`of`. Inputs that are themselves `{kind:"item"}` are skipped when looking for it, which is what
stops the item type asking for itself. An action's answer comes from `batchPlan` in `batch.ts` —
nothing is stored, so the only failure is two lists leaving it ambiguous.

## `validateDefinition`

Returns `WorkflowIssue[]`; **empty means activatable**. Checks run in layers, each assuming the
previous passed, so a customer is never shown type errors that are really a broken shape:

1. Shape — the document parses, no duplicate node ids.
2. Trigger — exactly one; either events or a schedule, never both; the schedule is coherent.
3. Edges — both endpoints exist, and the handle exists on the source node.
4. Graph — no cycle; every non-trigger step is reachable from the trigger.
5. References — every value plugged into a node resolves: a variable names a real, genuinely
   upstream value with a resolvable property path, and "the current item" is only read inside a step
   that works through a list.
6. Types — required inputs supplied, types match, a `list<T>` never feeds a single-`T` input unless
   the action is `batchable` (in which case that wiring is what makes it repeat), and an input the
   catalog does not declare is `UNKNOWN_INPUT` (a
   lookup rule naming a property the entity does not have uses the same code). Without that check a
   definition could quietly carry a field the executor would silently drop.
7. Configuration — every event/action/operation/entity id exists; no action has lists wired into two
   of its single-value inputs; every `requireOneOf` group has at least one of its inputs supplied;
   nothing left half-configured.

There is **one** resolver and one failure vocabulary (`ResolveFailure`): layer 5 walks every value,
whatever form it takes, and every layer's type question goes through it. Adding a second private
pipeline beside it is how a customer ends up shown a symptom above its own cause.

`unconfigured` is the silent failure, and it is what keeps a single mistake to a single issue: layer
5 says nothing when the value it cannot resolve depends on something another layer already reports —
a node whose catalog entry is missing, or a looping node that has not settled on a list. Layer 6
skips such a node outright (`configured()` on its node kind), so an unknown action reports one
`UNKNOWN_ACTION` rather than that plus a pile of consequent input and item errors. A filter is always
`configured` — a source that is not a list is a type error the filter reports itself.

Two invariants worth knowing, both regression-tested: a reference must resolve to a **strict**
ancestor, which is what stops a node reading its own output and is why the output resolver needs no
re-entry guard; and a literal's `value` is checked against its declared `type` at parse time, since
every other check compares declared types only.

## The `workflowTriggerEvent` invariant

A `workflowTriggerEvent` row exists **if and only if** the workflow has a published version and
that version's trigger nodes list that event id. Publishing a version, editing the published
version's trigger, and unpublishing must all rewrite the workflow's rows —
delete-then-insert **in the same transaction** as the change. If these drift, a workflow silently
stops firing or fires when it should not.

Two deploy-time checks in `packages/checks` watch for that drift against a live database (they need
one, so they are not CI jobs): the `workflow-trigger-event-drift` SQL invariant compares the rows to
the trigger nodes, and `pnpm --filter @carbon/checks workflow-events` confirms every subscribed
event id still exists in the catalog.

## Validation Commands

```bash
pnpm --filter @carbon/workflows test               # vitest
pnpm --filter @carbon/workflows exec tsgo --noEmit # typecheck
pnpm exec biome check packages/workflows           # lint
pnpm run generate:workflow-catalog                 # after editing entities/moments/actions/operations.ts
pnpm run check:workflow-catalog                    # the CI `catalog` job
```

Changing `Operator` in `@carbon/utils` also needs
`pnpm --filter @carbon/utils test` and `pnpm exec turbo run typecheck --filter=erp`.

## Custom fields (round 2)

`src/catalog/custom-fields.ts` is the per-company overlay. The catalog is build-time and
global; custom fields are runtime and per company, so they are merged in rather than generated.

- `buildCatalogOverlay(defs)` → `{ properties, labels, enums, actionInputs }`, keyed by the
  ONE-segment property path `customFields.<fieldId>` (the field's id, which is the key inside
  the JSONB blob). One segment keeps `walkPath` and the runtime `walk` single-step.
- It holds the ONLY `DataType → ValueType` map. `item` and reference-only entities are excluded.
- `createWorkflowCatalog(overlay?)` merges **generated first, overlay second** — a real column
  always wins, and the shipped keys keep their order at the top of every picker.
- `WorkflowCatalog` gained `getPropertyLabel(entity, property)` and
  `getInputLabel(actionId, input)`. They return the customer's own field name, which is customer
  data and is deliberately never translated.
- `getCatalogEvent(id)` is the single event lookup: the committed map, then
  `resolveCustomFieldEvent`, which PARSES `<entity>.customFields.<fieldId>.changed` into a
  synthetic `CatalogEvent`. `WORKFLOW_EVENTS` stays closed and drift-checked. `sync.ts` uses it
  too, which is what gives a custom-field trigger its `UPDATE` subscription.

## `linkify` and `ctx.linkFor`

`CatalogInput.linkify` marks an input as prose a person reads. `renderTemplate(template, ctx,
{ linkFor })` wraps an entity part as `[readableId](url)`; `actionExecutor` passes the callback
only for `linkify` inputs, so a webhook body still renders a bare readable id. This package
constructs no URL — it is bundled for the browser with four runtime dependencies and cannot
import `@carbon/env`; the engine supplies `ctx.linkFor`.

`rendersAsText` now accepts a whole record (it prints as its readable id) and still refuses a
LIST of records.
