# Workflows — Phase 5: actions, entity operations and lookups

**Status:** Draft — awaiting approval
**Phase:** 5 of 9 (`/Users/aashu/work/carbon/plans/automations-engine/phases/phase-5-catalogs.md`)
**Depends on:** phase 1 (foundation), phase 2 (event catalog), phase 3 (matcher), phase 4 (engine)

## TLDR

Phase 4 built a walker that can evaluate conditions and filter lists but cannot *do*
anything: `action`, `entity` and `lookup` nodes fail with "This kind of step is not
available yet." This phase gives them work.

Three catalogues join the event catalogue — **actions** (what a workflow may change),
**entity operations** (what it may work out from a record it already holds) and the
**lookup** target list (what it may search) — plus the four executors that run them. After
this phase a workflow runs end to end for the first time: something happens, a condition is
checked, and a record is updated, a record is created, someone is notified, or an outside
URL is called.

## Problem Statement

The PRD's whole point is "when this happens, do that." Everything built so far is the
"when this happens" half plus the plumbing. `EXECUTORS` in
`packages/workflows/src/runtime/executors.ts` holds two entries, `condition` and `filter`,
and `packages/jobs/src/workflows/engine/execute.ts:84` fails any node whose kind is absent.

Four things are missing, and they are not symmetrical.

**1. There is no action catalogue and no way to reach business logic.** `CatalogAction` and
`CatalogOperation` are declared types with no data behind them:
`createEventCatalog()` (`packages/workflows/src/catalog/catalog.ts`) resolves `getAction`
and `getOperation` through optional callbacks, and the engine calls it with no options, so
both always return `undefined`. Worse, the layer the technical design assumed we would wrap
— the generic dispatcher at `apps/erp/app/routes/api+/mcp+/lib/direct-executor.ts:84` —
imports `~/modules/*` and therefore **cannot be imported from `packages/jobs`**, where the
engine lives.

**2. Nothing describes which columns a workflow may write.** The entity registry
(`packages/workflows/src/catalog/entities.ts`) has `watch`, which drives triggers and is
deliberately permissive. It has no `write`. A trigger firing too often is an annoyance; a
wrong write corrupts a customer's ERP, so the two lists cannot share a posture and cannot
share a derivation.

**3. A Lookup node cannot express what it is looking for.** `lookup.data.match` is
`clauseSchema[]`, whose `left` is a value or a variable reference. There is no form meaning
"the `status` of the record being searched" — `{kind:"item"}` is rejected because
`NODE_KINDS.lookup.loopList` returns `undefined`. The node validates clean today (it gates on
`getEntity`, which is real) and would fail only at run time, which is the worst of both.

**4. A message cannot mention the thing it is about.** Every input is one whole value, so
"Purchase order PO-1042 is over $10,000" is unrepresentable — a customer can send fixed text
or one bare variable, nothing else. Every notification example in the PRD needs the sentence.

Two further gaps this phase must close because nothing else will: **batch mode is built but
unwired** (`planBatch`/`itemKeyFor` have no callers, and `execute.ts:115` hardcodes
`itemKey: ""`), and **the permission gate only ever asks for `"view"`** (`execute.ts:89`),
which is the wrong question for a step that writes.

## Goals

- One flat `ACTIONS` catalogue and one flat `OPERATIONS` catalogue, generated and committed
  the way `events.generated.ts` already is, from hand-written inputs.
- The four PRD actions working end to end: notify, create a record, update a field, call an
  outside URL — the last one signed, which neither existing webhook system does.
- A shared update executor whose foreign-key validation is a tenancy guarantee, not a nicety.
- A Lookup executor that turns match rules into a real database query on the owner's
  connection.
- Batch mode wired into the walk, one step row per item.
- Every read and write on the owner-scoped, run-tagged client — no service role, no Kysely,
  no edge function for business data.

## Non-goals

- **The builder.** No canvas, no forms, no variable picker. Phases 7 and 8. Verification here
  is by seeded definitions and unit tests.
- **The scheduler.** Phase 6.
- **Run history UI, compaction, purge.** Phase 9.
- **A general action surface over all ~1,400 service functions.** The catalogue is editorial
  and hand-curated; that is the decision problem 4 of the technical document settled.
- **Fixing the two existing webhook systems.** Their lack of signing and URL restriction is
  real debt, recorded in Risks, but changing them alters behaviour customers rely on today.
- **All-or-nothing action groups.** The PRD defers this to v2.

## Proposed Solution

### A. Where the code lives

```
packages/workflows/src/catalog/          declarations, generation, and the flat catalogues
├── entities.ts                 HAND-WRITTEN  + `write` allowlist per entity
├── actions.ts                  HAND-WRITTEN  the hand-written action declarations
├── operations.ts               HAND-WRITTEN  the entity-operation declarations
├── build.ts                    extended: expands `write` into one update action per entity
├── actions.generated.ts        COMMITTED     flat ACTIONS + OPERATIONS data, no Lingui
├── labels.generated.ts         COMMITTED     extended with action + operation labels
└── catalog.ts                  createWorkflowCatalog(): all four lookups now real

packages/workflows/src/runtime/          pure: resolution, type handling, no I/O
├── action.ts     the Action executor      ─┐
├── entity.ts     the Entity executor       ├─ resolve inputs, then call an injected port
├── lookup.ts     the Lookup executor      ─┘
├── template.ts   resolving the template value form
├── types.ts      + WorkflowServices, + permission returns module and action
└── executors.ts  three new registry lines

packages/jobs/src/workflows/actions/      everything that touches the world
├── services.ts   the WorkflowServices implementation the engine injects
├── dispatcher.ts the injection seam the ERP app fills at boot
├── update.ts     the shared update executor (types, enums, FK + same-company)
├── create.ts     the four create actions, through the dispatcher
├── notify.ts     the notify action
├── webhook.ts    the signed outbound call, and the URL guard
├── operations.ts the entity-operation implementations
└── search.ts     the lookup query builder
```

The split follows phase 4 exactly: `packages/workflows/src/runtime/` stays pure so the
phase-7 builder can compile it for the browser, and every executor resolves its inputs there
and hands the resolved values to a port implemented in `packages/jobs`.

### B. Reaching business logic — the dispatcher is injected, not imported

`packages/jobs` cannot import `apps/erp`. But every Inngest function **runs inside the ERP
app**: `apps/erp/app/routes/api+/inngest.ts` is the only place `@carbon/jobs/inngest` is
served, and the `./worker` export in `packages/jobs/package.json` points at a file that does
not exist. So the two halves are in one process and the barrier is a code boundary, not a
network one.

→ **The ERP app hands the dispatcher to the engine at boot.**

```ts
// packages/jobs/src/workflows/actions/dispatcher.ts
export type WorkflowDispatch = (
  functionName: string,
  context: { client: SupabaseClient<Database>; companyId: string; companyGroupId: string; userId: string },
  args: Record<string, unknown>
) => Promise<{ success: true; data: unknown } | { success: false; error: string }>;

let dispatch: WorkflowDispatch | undefined;
export function setWorkflowDispatch(fn: WorkflowDispatch): void { dispatch = fn; }
export function getWorkflowDispatch(): WorkflowDispatch | undefined { return dispatch; }
```

```ts
// apps/erp/app/routes/api+/inngest.ts — before serve()
import { setWorkflowDispatch } from "@carbon/jobs";
import { executeFunction } from "./mcp+/lib/direct-executor";
setWorkflowDispatch(executeFunction);
```

The type is declared by `packages/jobs` and satisfied structurally by `executeFunction`, so
the dependency points the right way and neither side imports the other's internals.

An action that needs the dispatcher and finds none registered returns
`{status: "Failed", error: "This step is not available in this environment."}` rather than
throwing — a clear failure in the run log, not a crash.

Two consequences to hold onto:

- `ExecutorContext` needs `companyGroupId`, which `RunPayload` does not carry. The engine
  reads it once per run, in the existing `"load"` step, from `company.companyGroupId`
  (the same read `apps/erp/app/routes/api+/mcp+/_index.ts:82-86` does), defaulting to
  `companyId`.
- The dispatcher does **no** permission checking — its only gate is a one-entry blocklist.
  That is fine here precisely because the workflow engine checks the declared permission
  itself (§F) and passes an owner-scoped client, so RLS is the backstop rather than the
  whole story.

### C. The action catalogue — two sources, one flat file

Same shape as the event catalogue, opposite posture. Nothing downstream branches on which
source produced an entry.

| | Hand-written source | What it generates |
|---|---|---|
| **From the entity registry** | a `write` allowlist of inert columns per entity | one `<entity>.update` action per entity |
| **From `defineAction`** | one declaration each: label, inputs, outputs, permission | one action each, passed through |

`RegistryEntry` gains a `write` key, bound to the entry's own table exactly as `watch` is, so
a renamed column is a compile error at the registry line:

```ts
// packages/workflows/src/catalog/build.ts
export interface WritableColumnLike {
  label: string;
  /** Registry entity this column points at; needed only when the schema has no fk note. */
  ref?: string;
}

export interface RegistryEntry {
  table: string;
  label: string;
  permission: string;
  article?: "A" | "An";
  watch?: Record<string, WatchedColumnLike | undefined>;   // → events. Permissive.
  write?: Record<string, WritableColumnLike | undefined>;  // → actions. Restrictive.
}
```

`watch` and `write` are unrelated lists; overlap is incidental. `buildCatalog` validates
`write` the same way it validates `watch` — the column exists, is not in `DROPPED_COLUMNS`,
and a declared `ref` agrees with any foreign key the schema does know about — and adds one
further check: a write column may not be `id`, `companyId`, `createdBy`, `createdAt`,
`updatedBy` or `updatedAt`.

An entity with a non-empty `write` expands to exactly one action:

```jsonc
"purchaseOrder.update": {
  inputs: {
    purchaseOrder:     { type: entity("purchaseOrder"), required: true },
    supplierReference: { type: string, required: false },
    orderDate:         { type: date,   required: false },
    assignee:          { type: entity("user"), required: false }
  },
  outputs: { record: entity("purchaseOrder") },
  batchable: true,
  permission: { module: "purchasing", action: "update" },
  update: { entity: "purchaseOrder" }        // executor only, the mirror of `match`
}
```

**One action per entity, not per field.** Three fields become one write, one audit entry and
one step row. Restricting the field map to `write` is what makes the PRD's "a workflow cannot
invent a new field" structurally true rather than a promise. Column types and enum values come
from the schema for free; the label template is `Update a {entity}`.

Validation today silently ignores an input a catalogue entry does not declare, which fails
closed but leaves a customer staring at a field that never gets written. This phase adds one
issue code, `UNKNOWN_INPUT`, so an undeclared field is reported at activation instead.

Hand-written entries carry the same shape and add a `call` block naming the service function:

```ts
// packages/workflows/src/catalog/actions.ts
defineAction("job.create", {
  label: msg`Create a job`,
  permission: { module: "production", action: "create" },
  inputs: {
    itemId:   { type: t.entity("item"), required: true },
    quantity: { type: t.number, required: true },
    dueDate:  { type: t.date,   required: false },
    salesOrderLineId: { type: t.string, required: false }
  },
  outputs: { record: t.entity("job") },
  batchable: true,
  call: "production_upsertJob"
});
```

`call` names a tool in the generated `tool-metadata.json`, and a build check fails if the
name is absent — the same class of check as "every moment has a raise site".

### D. The `write` allowlist — the judgement call

Restrictive by default. A column qualifies only when writing it has no state machine, no
cascade and no downstream calculation. Anything else is a hand-written action or nothing at
all. Every column below is compile-checked against its table by `ColumnOf<T>` and re-verified
against `swagger-docs-schema.ts` during implementation.

| Entity | `write` | Deliberately excluded |
|---|---|---|
| purchaseOrder | `supplierReference`, `orderDate`, `assignee` | `status` (state machine), `supplierId` (re-prices the order) |
| salesOrder | `customerReference`, `orderDate`, `assignee`, `salesPersonId` | `status`, `customerId` |
| job | `dueDate`, `startDate`, `assignee`, `priority`, `deadlineType` | `status`, `quantity` (drives material demand) |
| item | `name`, `assignee` | `active`, `replenishmentSystem`, `itemTrackingType`, `unitOfMeasureCode` — each changes how the item behaves everywhere |
| receipt | `assignee` | `postingDate` (sets the accounting period), `status`, `invoiced` |
| shipment | `trackingNumber`, `assignee`, `shippingMethodId` | `postingDate`, `status` |
| quote | `expirationDate`, `dueDate`, `assignee`, `estimatorId`, `salesPersonId`, `customerReference` | `status` |
| supplier | `accountManagerId`, `assignee`, `supplierTypeId` | `supplierStatus`, `currencyCode`, `taxPercent` (all re-price) |
| customer | `accountManagerId`, `assignee`, `customerTypeId` | `customerStatusId`, `currencyCode` |
| nonConformance | `assignee`, `priority`, `dueDate`, `nonConformanceTypeId` | `status`, `closeDate` (closing runs a workflow of its own) |

`receipt` gets a single writable column, and that is the correct answer rather than a thin
one: almost everything on a receipt either posts to the ledger or drives inventory.

### E. The four PRD actions

**Update a field** — the generated family above. Executor in §H.

**Create a record** — four hand-written entries, each straight onto the existing upsert
service function through the dispatcher, so sequence numbers, defaults and required-field
logic are the ones the ERP already uses:

| Action | Service function | Permission |
|---|---|---|
| `job.create` | `production_upsertJob` | `production` / `create` |
| `nonConformance.create` (label "Create an issue") | `quality_upsertIssue` | `quality` / `create` |
| `purchaseOrder.create` | `purchasing_upsertPurchaseOrder` | `purchasing` / `create` |
| `salesOrder.create` | `sales_upsertSalesOrder` | `sales` / `create` |

The dispatcher stamps `companyId`, `createdBy` and `updatedBy` from the context, so a created
record is owned by the workflow's owner and tagged with the run.

**Notify** — one action, `notify`, reusing the existing pipeline end to end (in-app, email,
Slack, per-person opt-outs, plan gating, digesting). Inputs:

| Input | Type | Required |
|---|---|---|
| `user` | `entity("user")` | no |
| `role` | `entity("group")` | no |
| `subject` | string (template) | yes |
| `message` | string (template) | no |
| `about` | entity | no — links the notification to a record |

At least one of `user` / `role` must be set: a configuration check, reported as an
incomplete node rather than a run-time failure. `batchable: true`, so a `list<user>` from a
lookup or filter runs it once per person.

Roles are groups in Carbon: an `employeeType` is mirrored 1:1 into a `group` row with the
same id, and each user has an identity group whose id *is* the user id, so both resolve
uniformly through `users_for_groups`. This phase therefore adds `group` to the entity
registry as a reference-only entry (no `watch`, no `write`), which is what lets `role` be a
typed input rather than a free-text id.

The pipeline currently builds every message by looking up the source document — one switch,
~27 cases, in `packages/jobs/src/inngest/functions/notifications/content.ts`. This phase adds
the first kind that reads its text from the payload:

- `NotificationEvent.Workflow = "workflow"`, topic `General`, default destinations
  `[InApp, Email]`.
- `EventContentOptions` gains `message` / `details`, and the new case returns them with no
  database read.
- `carbon/notify`'s payload gains the text fields.
- `notify.ts`'s `documentId ?? documentIds[0]` guard is satisfied by the `about` record when
  there is one, and by the workflow run id when there is not.
- **A case in `apps/erp/app/components/Layout/Topbar/Notifications.tsx` is mandatory**: its
  switch ends in `default: return null`, so without one the row is written and then renders
  as nothing. This is the only ERP UI change in an otherwise backend phase, and it is not
  optional.
- `apps/erp/app/routes/api+/link.ts` gains a case so the email CTA lands on the `about`
  record; with no `about`, no link is offered rather than a link to the app root.

**Call an outside URL** — a `webhook` action, sent inside the workflow's own step so the
outcome reaches the run log and both handles work. Inputs: `url` (string), `body`
(template), and optional `headers`. Signing and URL safety are §I.

### F. Permission — module *and* action

`NodeExecutor.permission` returns a module today and `execute.ts:89` always asks for `"view"`.
That is the wrong question for a step that writes, and it is the check most likely to drift
silently, so it is widened rather than worked around:

```ts
export type PermissionAction = "view" | "create" | "update" | "delete";
export interface RequiredPermission { module: string; action: PermissionAction; }

export interface NodeExecutor<N extends WorkflowNode> {
  permission(node: N, catalog: WorkflowCatalog): RequiredPermission | undefined;
  execute(node: N, ctx: RuntimeContext): Promise<NodeResult>;
}
```

`CatalogAction` and `CatalogOperation` gain a `permission: RequiredPermission` field, which is
what the executor returns; Lookup returns the target entity's registry `permission` at
`"view"`; Condition and Filter keep returning `undefined`. The engine's message is unchanged
— "The owner of this workflow no longer has access to Purchasing." — because naming the
module is what makes it useful.

This keeps the phase-4 invariant that the permission gate and the work come from the same
registry entry, so they cannot drift.

### G. The template value form

A fourth value shape beside a fixed value, a variable reference and the current item:

```ts
export const templateSchema = z.object({
  kind: z.literal("template"),
  parts: z.array(
    z.union([
      z.object({ kind: z.literal("text"), text: z.string() }),
      variableRefSchema,
      itemRefSchema
    ])
  ).default([])
});
```

It is only ever valid where a `string` is expected; validation reports a type error otherwise.
Every referenced part must resolve exactly as any other variable does, so the existing
resolver and its one failure vocabulary are reused rather than duplicated — an unresolvable
part is a skip with a reason, not an empty string silently pasted into a customer's email.
Rendering is `runtime/template.ts`: dates through the existing detail formatter, numbers
plainly, an entity as its readable id where the loaded row has one and its id otherwise.

This is additive to `valueOrRefSchema`, so every stored definition still parses.

### H. The shared update executor

One function for every entity, in `packages/jobs/src/workflows/actions/update.ts`, on the
owner-scoped client. In order:

1. **The record exists and is ours.** Read it by `id` and `companyId`. Absent — including
   absent *because RLS refused it* — is a failure naming the record type, not a silent skip.
2. **Type and enum.** Coerce each supplied value to its column type and check enum membership
   against `swagger-docs-schema.ts`. This lives job-side precisely because
   `packages/workflows` may not import `@carbon/database` at run time.
3. **Foreign keys exist and belong to the same company.** For every supplied column with a
   `ref`, read the target by `id` and `companyId` through the **owner's** client. This is the
   security requirement, not a nicety: without it a workflow could point one tenant's purchase
   order at another tenant's supplier. RLS makes the cross-tenant read return nothing, and
   this check turns that nothing into a refusal rather than a write of an id that does not
   resolve.
4. **Write** the field map plus `updatedBy` (the owner) and `updatedAt`, scoped by `id` and
   `companyId`.

Setting a value twice leaves the same value, so an update is idempotent for free.

### I. The outbound call — signing and URL safety

**Signing.** Each workflow gets its own secret, generated on creation and stored on the
workflow row, shown in the builder so a customer can paste it into their receiver. Rotatable
and revocable per workflow; a leak from one receiver compromises one workflow.

The scheme mirrors Slack's, which Carbon already verifies inbound:

```
Carbon-Timestamp: 1785408000
Carbon-Signature: v1=<hex HMAC-SHA256 of "v1:<timestamp>:<raw body>" with the workflow secret>
```

The signed string is the **serialized body bytes**, so it is independent of payload shape.
We publish no replay window: the engine retries can span hours, and a five-minute window
would reject a legitimate late attempt. The timestamp is sent so a receiver may choose one.

**URL safety.** Neither existing webhook system restricts the destination at all — no scheme
check, no private-address block, no redirect limit, no timeout. A workflow hands that
capability to any workflow author, from inside the ERP process, so this phase adds a guard
for the workflow action:

- **HTTPS only.** `http://` is refused at validation time and again at run time.
- **Resolve the hostname first and check every resolved address**, refusing loopback,
  private ranges, link-local and the cloud metadata address. Resolving first is what stops a
  public name that points inward.
- **Do not follow redirects.** A redirect is reported as a failure, since following one
  re-opens everything the address check just closed.
- **10-second timeout**, and a response cap.
- **Never store** request headers, the secret, or more than the status code and a short
  response excerpt. Redact by key name.

The two existing webhook systems keep their current behaviour; the gap is recorded in Risks.

### J. Entity operations — read-only, and generous

Same authoring shape as actions, opposite risk profile: no side effects, so an entry is not a
liability. Each declares the permission it needs to read and runs on the owner's connection.

```ts
defineOperation("job.totalScrapQuantity", {
  label: msg`Total scrap quantity`,
  entity: "job",
  permission: { module: "production", action: "view" },
  output: t.number
});
```

The v1 slate — roughly fifteen, aimed at what the PRD's examples need plus the document
totals phase 2 explicitly deferred here (they live only on views, which carry no trigger and
are not reachable by typing a dot):

- **Totals:** `purchaseOrder.total`, `salesOrder.total`, `quote.total`
- **Counts:** `purchaseOrder.lineCount`, `salesOrder.lineCount`, `receipt.lineCount`,
  `shipment.lineCount`, `job.operationCount`, `job.openOperationCount`,
  `nonConformance.openTaskCount`
- **Derived quantities:** `job.totalScrapQuantity`, `job.scrapPercentage`,
  `item.quantityOnHand`
- **Dates:** `job.earliestOperationStart`, `job.latestOperationEnd`

Being side-effect free, an operation is idempotent by definition; the step is still logged.

### K. The Lookup executor, and its match shape

A lookup's match rules gain their own shape, because a clause with a value on both sides
cannot name the field of the record being searched:

```ts
export const lookupMatchSchema = z.object({
  field: z.string().min(1),          // a property of the target entity
  operator: operatorSchema,
  value: valueOrRefSchema
});
```

The field is checked against the target entity's property map, and the operator against that
property's type, using the same `OPERATORS_BY_TYPE` vocabulary as everywhere else. This is a
stored-shape change, so `CURRENT_DEFINITION_FORMAT_VERSION` becomes `2` and
`migrateDefinition` rewrites a v1 lookup's `match` to `[]`. Nothing is lost: no lookup can be
activated today, so no meaningful match rules can exist.

The executor translates the rules into one query on the owner's client, always scoped by
`companyId` as well as by RLS: `eq`/`neq`/`gt`/`gte`/`lt`/`lte` map directly, and
`contains`/`startsWith`/`endsWith` map to a case-insensitive pattern, matching
`runtime/compare.ts`'s semantics so the builder and the engine agree.

- `returns: "list"` — capped at `MAX_LIST_ITEMS` (100), newest first, with the summary saying
  how many matched and whether the list was cut short.
- `returns: "one"` — the newest match, with the summary saying how many matched. **No match
  is a failure**, routed down the failure handle, because "carry on with nothing" is exactly
  the silent-nothing behaviour the PRD rules out.

Lookup has no batch mode, per the PRD: a lookup per item would produce a list of lists.

### L. Batch mode, wired

`planBatch` and `itemKeyFor` exist and are tested; nothing calls them. The walk gains the one
thing it lacks — a node may now occupy more than one step:

- A node with `batch: true` resolves its single list input (the same `loopList` rule
  validation already enforces), and `planBatch` caps it at 100.
- **One Inngest step and one `workflowStepRun` row per item**, claimed under
  `itemKeyFor(item)` — the record's own id, or a hash of the value. Never a position: a list
  that comes back in a different order would otherwise re-run everything against the wrong
  items.
- The step id is `` `node:${nodeId}:${itemKey}` `` — deterministic, as every step id must be.
- One item failing does not stop the others. The node succeeds if any item did, and its
  output is a list of the per-item primary outputs, in item order.
- Items dropped by the cap are named in the summary, never silently discarded.

`ctx.item` is populated by the engine for the item being processed, which is what makes
`{kind:"item"}` usable inside a batched action's inputs.

### M. What the step log records

`workflowStepRun.input` exists in the schema and the engine never writes it. This phase fills
it with the resolved inputs of every node execution — the only durable record of what the
workflow actually saw, and the thing that makes "why did my workflow do that" answerable.
Secrets and headers are redacted by key name, and genuinely large free text (a webhook body)
is capped on write; everything else is written in full, because phase 9's nightly compaction
is what shortens it later.

### Design Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The ERP app injects `executeFunction` into the engine at boot | The dispatcher cannot be imported across the package boundary, but both halves run in one process, so injection reuses the real business logic with no network hop and no duplicated argument assembly |
| 2 | `write` is a hand-curated allowlist on the entity registry, not derived | "Does this column exist" is answerable from the schema; "is this write safe" is not, because safety is state-dependent |
| 3 | One `<entity>.update` action taking a field map, not one action per field | Three fields become one write, one audit entry and one step row; and restricting the map to `write` is what makes "cannot invent a new field" structural |
| 4 | Update on all 10 entities, create on 4 | The update half is mechanical once the allowlist is curated; each create is real business logic, and four covers every PRD example |
| 5 | Create actions call the existing upsert service functions | Sequence numbers, defaults and required-field logic already work and must not be re-implemented |
| 6 | A `template` value form for text with variables in it | Every notification example in the PRD needs a sentence around a value; the alternative is fixed text or one bare variable |
| 7 | Lookup gets its own `field / operator / value` match shape | A clause with a value on both sides cannot name the searched record's field; explicit and type-checkable beats overloading "the current item" |
| 8 | Format version 2, with a v1 lookup's match rewritten to empty | No lookup can be activated today, so nothing meaningful is discarded |
| 9 | `NodeExecutor.permission` returns module **and** action | `"view"` is the wrong question for a step that writes, and this keeps the gate and the work in one registry entry |
| 10 | Per-workflow webhook secret, HMAC-SHA256 over timestamp plus body | Rotatable and revocable per workflow; mirrors the Slack shape Carbon already verifies inbound |
| 11 | No replay window published | Engine retries can span hours; a five-minute window would reject legitimate late attempts. The timestamp is sent so the receiver may choose one |
| 12 | The webhook is sent inside the workflow's own step | The PRD's "if the webhook fails, notify me instead" requires the workflow to learn the outcome, which delegating to the existing background sender cannot provide |
| 13 | HTTPS only, resolved-address check, no redirects, timeout — for the workflow action only | New capability aimed at customer-supplied URLs from inside the ERP process; changing the two existing systems would alter behaviour customers rely on |
| 14 | Roles are targeted through a new reference-only `group` registry entity | An employee type is already mirrored 1:1 into a group, and identity groups make a user id resolve uniformly, so one typed input covers both |
| 15 | Notify adds the first payload-text notification kind | Every existing kind reads its text from a document; a workflow's text is authored by the customer |
| 16 | No per-action idempotency flag | The step ledger claims before acting, so a node runs at most once per run and item; "one effect per triggering event" is already structural |
| 17 | Lookup returning nothing for `returns: "one"` is a failure | Routed down the failure handle, so it is visible; carrying on with nothing is the silent behaviour the PRD rules out |
| 18 | Entity operations are generous, actions are stingy | Read-only entries cannot corrupt anything, so the cost of a wrong one is a useless menu item rather than a bad write |

### What this phase deliberately does not build

- Any builder UI beyond the one mandatory notification-row case.
- Hand-written domain actions with state machines (release a job, post a receipt, confirm an
  order). The `defineAction` shape makes each a one-file entry when it is wanted.
- Signing or URL restriction for the two pre-existing webhook systems.
- The workflow secret's rotation UI — the column and the value ship here, the screen is
  phase 7.

## Data Model Changes

One migration, three small changes:

1. `workflow."webhookSecret" TEXT` — generated on insert, readable only through the workflow's
   own RLS policies. Plaintext, consistent with `apiKey.key`; there is no encryption-at-rest
   pattern in the schema to inherit, and inventing one here would be its own project.
2. Nothing else. `workflowStepRun.input` already exists; the run and step tables are otherwise
   as phase 1 built them.
3. No change to `notification` — `event` and `topic` are plain `TEXT` with no constraint.

## API / Service Changes

**New files** — as laid out in §A: three executors plus template resolution in
`packages/workflows/src/runtime/`, two hand-written catalogue inputs plus one generated
catalogue in `packages/workflows/src/catalog/`, and eight files under
`packages/jobs/src/workflows/actions/`.

**Modified**

- `packages/workflows/src/definition/types.ts` — `templateSchema`, `lookupMatchSchema`,
  `RequiredPermission`.
- `packages/workflows/src/definition/schema.ts` — format version 2, lookup `match` retyped.
- `packages/workflows/src/definition/normalize.ts` — the v1→v2 upgrade.
- `packages/workflows/src/definition/catalog.ts` — `permission` on `CatalogAction` and
  `CatalogOperation`.
- `packages/workflows/src/definition/issues.ts` — the `UNKNOWN_INPUT` code.
- `packages/workflows/src/definition/nodes.ts` — lookup's `values`/`checkTypes` for the new
  match shape; notify's at-least-one-recipient check.
- `packages/workflows/src/runtime/types.ts` — `WorkflowServices` on `RuntimeContext`, widened
  `permission`.
- `packages/workflows/src/runtime/executors.ts` — three registry lines.
- `packages/workflows/src/catalog/build.ts` — `write` validation and expansion.
- `packages/jobs/src/workflows/engine/execute.ts` — module-and-action gate, `companyGroupId`,
  batch stepping, `input` recording, services injection.
- `packages/jobs/src/workflows/engine/ledger.ts` — write `input`.
- `packages/jobs/src/inngest/functions/notifications/{content,notify}.ts` and
  `packages/lib/src/events.ts`, `packages/notifications/src/index.ts` — the payload-text kind.
- `apps/erp/app/routes/api+/inngest.ts` — the dispatcher injection.
- `apps/erp/app/components/Layout/Topbar/Notifications.tsx`, `apps/erp/app/routes/api+/link.ts`
  — the new notification kind.
- `scripts/generate-workflow-catalog.ts`, `scripts/check-workflow-catalog.ts` — the two new
  catalogues and their checks.

## UI Changes

One, and it is not optional: a case in the topbar notification switch for the workflow kind,
because that switch ends in `default: return null` and the row would otherwise be written and
render as nothing. Everything else is phases 7 to 9.

## Acceptance Criteria

**End to end**

1. A seeded workflow triggered by `purchaseOrder.status.changed`, with a condition
   `record.orderTotal > 10000` and a `notify` action addressed to a role, produces one
   in-app row and one email per member of that role, with the subject reading
   "Purchase order PO-1042 is over $10,000" — the number substituted from the record.
2. A seeded workflow on `sales.quoteAccepted` creates a sales order through
   `sales_upsertSalesOrder` and hands the new record forward, so a following `notify` names
   the created order's readable id.
3. A seeded workflow with a Lookup for jobs whose `status` is `Ready`, a Filter, and a
   batched `job.update` setting `priority`, updates every matching job and writes one
   `workflowStepRun` row per job, each keyed by that job's id.
4. A seeded workflow with an Entity node computing `job.totalScrapQuantity`, a condition on
   `> 5`, and a `nonConformance.create` action, opens exactly one issue for a job whose
   operations total more than 5 scrap.

**Correctness and safety**

5. An update naming a supplier id belonging to another company fails with a message naming
   the field, and writes nothing.
6. An update naming a column absent from that entity's `write` list fails validation before
   activation with `UNKNOWN_INPUT`, so it never reaches the engine.
7. A workflow whose owner has lost `purchasing_update` fails at the action step with "The
   owner of this workflow no longer has access to Purchasing.", not with zero rows.
8. A webhook to `http://…`, to `http://127.0.0.1/…`, to a name resolving to `10.0.0.5`, and
   to a URL that redirects, each fail with a distinct reason and send nothing.
9. A successful webhook arrives with `Carbon-Timestamp` and `Carbon-Signature: v1=…`, and
   recomputing the HMAC over `v1:<timestamp>:<body>` with the workflow's secret matches.
10. A webhook failure routes down the failure handle, so a `notify` wired there runs.
11. Re-delivering the same event runs no node a second time: every step row is already
    terminal and the run is refused at `claimRun`.
12. A batch over a 150-item list runs 100 times and the step summary says 50 were dropped.
13. A lookup with `returns: "one"` and no match routes down the failure handle, with the
    reason in the step row.

**Catalogue integrity**

14. `pnpm run check:workflow-catalog` fails when a `write` column no longer exists, when a
    hand-written action's `call` names no tool in `tool-metadata.json`, and when the committed
    catalogue differs from a fresh build.
15. `pnpm --filter @carbon/workflows exec tsgo --noEmit` fails at the registry line when a
    `write` key is renamed in the database.
16. A v1 definition containing a lookup opens as v2 with an empty match and does not throw.

## Risks

- **The dispatcher injection is invisible coupling.** If Inngest ever moves to a standalone
  worker, actions stop working and the failure is a run-time message rather than a build
  error. Mitigation: the engine reports "not available in this environment" explicitly, and
  a test asserts the dispatcher is registered when the ERP app serves Inngest.
- **The `write` allowlist is a judgement call and this spec is where it gets reviewed.** A
  column that turns out to cascade is a data-integrity bug in a customer's ERP, not a bug
  report. Mitigation: the table in §D is deliberately short, exclusions are stated with
  reasons, and every entry is compile-checked against the schema.
- **The two existing webhook systems remain unsigned and unrestricted.** This phase makes the
  contrast visible without fixing it. Recorded as debt; the signer built here is reusable
  when they are.
- **`tool-metadata.json` carries no permission module**, so an action's declared permission is
  hand-written beside its `call` and could disagree with what the service function actually
  needs. Mitigation: the explicit gate is a *narrowing* check on top of RLS, so a wrong
  declaration refuses work rather than permitting it.
- **`packages/workflows` is near the erp instantiation budget.** Three new node executors and
  two new catalogues add type surface; TS2589 can surface in unrelated files. Mitigation:
  flat unions, no recursive generics, and `pnpm exec turbo run typecheck --filter=erp` after
  every step rather than at the end.
- **Notification volume.** A batched notify over 100 items sends 100 notifications. The list
  cap is the only limit. Accepted for v1, matching the PRD's own cap-and-carry-on posture.

## Open Questions

- [x] The dispatcher lives in `apps/erp` and cannot be imported from `packages/jobs`, where
      the engine runs. How does an action reach Carbon's business logic? — **Answer:** The
      ERP app injects `executeFunction` into the engine at boot. Both halves already run in
      one process (Inngest is served only from `apps/erp/app/routes/api+/inngest.ts`), so the
      barrier is a code boundary, not a network one, and injection reuses the real service
      functions with no second auth path. Rejected: owner-scoped table writes only, which
      loses the defaults and sequence logic that make "create a record" correct; and an HTTP
      call between two things in the same process.
- [x] How does a customer put a variable inside a message? — **Answer:** Add a `template`
      value form: a list of text pieces and variable references, valid wherever a string is
      expected. Every notification example in the PRD needs a sentence around a value, and the
      form is reusable by the webhook body and any future text input. Rejected: fixed text or
      one bare variable, which cannot express any of them.
- [x] A Lookup cannot name the field of the record it is searching. How is that closed? —
      **Answer:** Give Lookup its own match shape — field, test, value — with the field
      checked against the target entity's properties. Explicit, type-checkable while drawing,
      and it translates straight into a query. Safe now because no lookup can be activated
      today. Rejected: overloading `{kind:"item"}`, which today means the item a repeating
      step is on.
- [x] How wide is the write surface in v1? — **Answer:** An update action on all ten registry
      entities, each limited to a curated inert-field allowlist, plus four hand-written create
      actions (job, issue, purchase order, sales order). The update half is mechanical; each
      create is real business logic, and four covers every PRD example. Rejected: five
      entities (too thin for common asks like stamping a shipment's tracking number) and ten
      creates (too much business logic to get right at once).
- [x] How are outgoing webhooks signed, and where does the secret live? — **Answer:** A secret
      per workflow, stored on the workflow row and shown in the builder, with HMAC-SHA256 over
      timestamp plus body in two headers — the shape Carbon already verifies inbound from
      Slack and Paperless Parts. Rotatable and revocable per workflow. Rejected: deriving from
      the server session secret (cannot rotate one workflow) and one secret per company (one
      leaked receiver compromises them all).
- [x] Should the workflow's outbound call be protected against internal addresses? —
      **Answer:** Yes, for the workflow action. HTTPS only, resolved-address check, no
      redirects, timeout and response cap. This is new capability aimed at customer-supplied
      URLs from inside the ERP process. The two existing systems keep their behaviour and the
      gap is recorded as debt. Rejected: matching existing behaviour, and fixing all three
      systems here.
- [x] The technical doc says reuse the existing webhook sender, but it is a separate job that
      never reports back. Which wins? — **Answer:** The PRD. The call is made inside the
      workflow's own step so the outcome reaches the run log and the failure handle works;
      without that, "if the webhook fails, notify me instead" is unbuildable. Retries and
      duplicate suppression already come from the engine's step ledger.

## Cross-phase dependencies this phase creates

- **Phase 6** needs no change here: a scheduled run's first node is usually a Lookup, which
  this phase makes real.
- **Phase 7** must generate `workflow.webhookSecret` on create, surface it once in the
  builder, and enforce the new format version on save. The activation gate gets the real
  action and operation catalogues, so `UNKNOWN_ACTION` starts meaning a stale id rather than
  an unbuilt feature.
- **Phase 8** renders the `template` value form in every string input, the new lookup match
  shape as a field picker over the target entity, and must not re-implement rendering or
  comparison semantics — `runtime/template.ts` and `runtime/compare.ts` are the one
  definition of each.
- **Phase 9** reads `workflowStepRun.input`, which starts being written here, and its
  compaction pass must respect the redaction rules in §M rather than re-deriving them.

## Research

- `.ai/research/workflows-phase5-catalogs.md` — the engine seams, the dispatcher and
  owner-scoped auth, the notification pipeline, and both webhook systems, with file
  references.

## Changelog

- **2026-07-30** — Initial spec. Seven open questions raised and answered before writing:
  how actions reach business logic across the package boundary, text with variables in it,
  the missing lookup match shape, the width of the write surface, webhook signing and secret
  storage, outbound URL safety, and whether to reuse the existing webhook sender.

## Divergences, as built (2026-07-31)

Recorded at implementation. Each was a fact about the codebase the spec did not know.

- **`purchaseOrder.orderTotal` is not a readable property**, so acceptance criterion 1's
  `record.orderTotal > 10000` cannot be a bare condition. The stored total lives on the
  `purchaseOrders` view, which has no trigger; a customer reaches it through an Entity node
  running the `purchaseOrder.total` operation. Sales orders are the same. Phase 7's builder
  has to make that obvious, or the PRD's flagship example reads as broken.
- **`quote.total` is declared but refuses.** There is no stored quote total anywhere: pricing
  lives in `quoteLinePrice`, one row per quantity break per line, and the share/PDF routes
  compute the total from the quantity the customer picked. One company-scoped read cannot
  answer it, so the operation returns a readable refusal and makes zero database calls.
- **The `user` table has no `companyId`**, and every entity-typed writable column points at
  it. The update executor's tenancy check therefore routes `user` through
  `userToCompany(userId, companyId)` — the same guarantee, the correct query.
- **`notify` takes `aboutId` + `aboutType` strings**, not a polymorphic `about` value. The
  `carbon/notify` payload types `documentType` as the approval enum while the column is plain
  `TEXT`, so the action casts at that one site; `link.ts` and the topbar row read the
  workflow entity name back out through `getWorkflowRecordPath`.
- **A batched node that loses one item marks the run Failed**, while the node itself still
  succeeds and follows its success handle. The spec set the node's rule but not the run's; a
  partial batch must not show a customer a green tick.
- **`jobOperation` scrap is `quantityScrapped`**, not `scrapQuantity` (which exists only on
  `job`), and an operation's finish is `dueDate` — the scheduler writes `startDate`/`dueDate`
  as computed start and finish, and there is no `endDate`.
- **The lost-claim divergence at `execute.ts` is left in place**: a lost claim always returns
  `Skipped` rather than reusing a terminal row's output. Noted in `workflow-engine.md`.
