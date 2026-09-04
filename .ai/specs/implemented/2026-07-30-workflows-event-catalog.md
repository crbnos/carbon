# Workflows — Phase 2: the event catalog

> Status: draft
> Author: aashu
> Date: 2026-07-30
> Phase doc: `/Users/aashu/work/carbon/plans/automations-engine/phases/phase-2-event-catalog.md`
> PRD: `/Users/aashu/work/carbon/plans/automations-engine/prd.md`
> Technical decisions: `/Users/aashu/work/carbon/plans/automations-engine/technical-decisions.md` (problem 2)
> Phase 1 spec: `.ai/specs/2026-07-30-workflows-foundation.md`
> Research: N/A — no external precedent applies. This phase is entirely internal plumbing over
> Carbon's own schema and service code; the product-level survey of how other ERPs ship automation
> already lives in `/Users/aashu/work/carbon/plans/automations-engine/research/research.md` and is
> cited by the PRD. Nothing here needed new domain research.

## TLDR

The list of things a customer can trigger a workflow on. Two hand-written inputs — an **entity
registry** (10 record types, each with its table and the handful of columns worth watching) and
**9 moment declarations** (business events a row change cannot express, like "a job is released") —
feed a generator that emits one flat committed catalog file. That file is the single source of truth
every later phase reads: the builder renders a picker from it, the activation validator checks ids
against it, and the matcher in phase 3 turns a record change into event ids with it.

Roughly **97 record events + 9 moments = 106 events from about 40 hand-written lines**, and the shape
holds at the 400–500 it grows to after a few releases.

No matcher, no engine, no UI. The deliverables are the two inputs, the generator, the committed
output, the checks that keep it honest, and the `WorkflowCatalog` conformance phase 1 left as a seam.

**Vocabulary.** An **entity** is a record type a customer can watch (a purchase order, a job). A
**watched column** is one of the ~8 columns per entity whose change produces its own event. A
**moment** is a named business event raised from the code that performs the action. An **event** is
one entry in the generated catalog — the customer picks these; nothing downstream knows or cares
which of the two inputs produced it.

## Problem Statement

Phase 1 built the tables and the definition contract, and deliberately left the catalog as an
interface (`WorkflowCatalog`) with a test fixture behind it. Nothing can be built or matched until a
real, trustworthy catalog exists:

- **Phase 3's matcher** needs to turn "row 4 of `purchaseOrder` changed, and `status` was one of the
  columns that moved" into the event id `purchaseOrder.status.changed`, so it can do one indexed read
  for subscribers. That translation table has to come from somewhere.
- **Phase 7's builder and phase 8's node forms** render the trigger picker straight off the catalog's
  labels and outputs. If the catalog does not carry them, the front end hand-maintains 106 strings.
- **Phase 1's validator** already resolves `record.supplier.name` against
  `catalog.getEntity(name).properties`. Today that is a five-entity fixture. Without real property
  maps, no real workflow can validate.

And two failure modes make the *guarantees* as important as the data:

1. **A dead trigger is worse than a missing one.** A customer builds a rule on "a job is released";
   if nothing in the code ever raises it, the rule silently never fires and looks like our bug for as
   long as it takes someone to notice.
2. **A renamed column silently breaks live customer workflows at run time.** A migration renaming
   `purchaseOrder.status` must fail the build, not surface months later as a workflow that stopped
   firing.

## Proposed Solution

Five deliverables, in dependency order.

### A. The entity registry — hand-written

`packages/workflows/src/catalog/entities.ts`. One entry per record type, not per event. It is an
authoring input: the generator and the checks read it, nothing at run time does.

```ts
import type { ColumnOf, TableName } from "@carbon/database/audit.config";

purchaseOrder: {
  table: "purchaseOrder",
  label: "Purchase order",
  permission: "purchasing",
  watch: {
    status:            { label: "status" },
    supplierId:        { label: "supplier", ref: "supplier" },
    assignee:          { label: "assignee", ref: "user" },
    orderDate:         { label: "order date" },
    purchaseOrderType: { label: "type" },
    supplierReference: { label: "supplier reference" },
    supplierLocationId:{ label: "supplier location" },
    tags:              { label: "tags" },
  },
},
```

`table` is typed `TableName` and every `watch` key is typed `ColumnOf<typeof table>` — both imported
**type-only** from `@carbon/database/audit.config`, which already defines them off the generated
schema. A migration renaming a column therefore fails `turbo run typecheck` immediately, in the
registry, with the column named. That is build check 3 as a compile error rather than a script, and
the script below keeps a second, friendlier copy of the same check.

`permission` is the existing lowercase module prefix a subscribing workflow's owner must hold
(`purchasing`, `sales`, `production`, `parts`, `inventory`, `quality`) — never a new permission
family.

Two tiers of entry:

- **Triggerable** (10): has a `watch` map, so it generates events, and is offered in the Lookup node.
- **Reference-only** (5): no `watch` map, so it generates no events. It exists because a moment hands
  one out, or because a foreign key points at it and the customer should be able to type a dot
  through it. `user`, `jobOperation`, `salesInvoice`, `purchaseInvoice`, `location`.

`write` (the field-update allowlist that `technical-decisions.md` problem 4 sketches in this same
file) is **not** in scope here. It belongs to phase 5's action catalog and would be dead weight now.

#### The v1 slate

Confirmed with the user on 2026-07-30. The technical document's slate, with two corrections against
the real schema: **`part` is not the record type** — `item` is, and `part` is a 12-column subtype
extension that has never been attached to the event system at all; and **`issue` is not a table** —
`nonConformance` is, with `issues` a view over it and "Issue" the label the ERP UI already uses.

| Entity | Table | Permission | Watched columns |
|---|---|---|---|
| Purchase order | `purchaseOrder` | `purchasing` | `status`, `supplierId`, `assignee`, `orderDate`, `purchaseOrderType`, `supplierReference`, `supplierLocationId`, `tags` |
| Sales order | `salesOrder` | `sales` | `status`, `customerId`, `assignee`, `salesPersonId`, `orderDate`, `locationId`, `customerReference`, `completedDate` |
| Job | `job` | `production` | `status`, `assignee`, `dueDate`, `startDate`, `quantity`, `priority`, `deadlineType`, `scrapQuantity` |
| Item | `item` | `parts` | `active`, `revisionStatus`, `replenishmentSystem`, `itemTrackingType`, `defaultMethodType`, `assignee`, `name`, `unitOfMeasureCode` |
| Receipt | `receipt` | `inventory` | `status`, `supplierId`, `locationId`, `assignee`, `postingDate`, `invoiced`, `sourceDocument` |
| Shipment | `shipment` | `inventory` | `status`, `customerId`, `locationId`, `assignee`, `postingDate`, `trackingNumber`, `shippingMethodId` |
| Quote | `quote` | `sales` | `status`, `customerId`, `assignee`, `estimatorId`, `salesPersonId`, `expirationDate`, `dueDate`, `completedDate` |
| Supplier | `supplier` | `purchasing` | `supplierStatus`, `supplierTypeId`, `accountManagerId`, `assignee`, `name`, `currencyCode`, `taxPercent` |
| Customer | `customer` | `sales` | `customerStatusId`, `customerTypeId`, `accountManagerId`, `assignee`, `name`, `currencyCode`, `salesContactId` |
| Issue (non-conformance) | `nonConformance` | `quality` | `status`, `priority`, `assignee`, `source`, `nonConformanceTypeId`, `dueDate`, `closeDate`, `locationId`, `quantity` |

77 watched columns → **97 record events** (77 changed + 10 created + 10 deleted).

Every one of these ten tables already has the record-change trigger attached, so no migration is
needed to make them announce. (Verified against every `attach_event_trigger` call site; `part` is the
only candidate that was never attached, which is a second reason it is not the entity.)

Two notes on columns that look surprising and are deliberate:

- `job.scrapQuantity` is a stored column that Carbon maintains, so it is genuinely watchable. Totals
  that are *not* stored — `purchaseOrder.orderTotal` lives only on the `purchaseOrders` view — are
  neither watchable nor dot-readable in v1; they arrive as Entity-node operations in phase 5.
- `supplier.supplierStatus` and `customer.customerStatusId` are not called `status`. Carbon's naming
  is inconsistent here and the registry records reality, not a tidied version of it.

### B. Moment declarations, `raiseMoment`, and its call sites — hand-written

`packages/workflows/src/catalog/moments.ts`. One declaration each: a mandatory label, the permission,
and its own typed outputs.

```ts
"production.jobReleased": {
  label: "A job is released",
  permission: "production",
  outputs: { job: entity("job"), releasedBy: entity("user") },
},
```

`raiseMoment` is typed `<K extends keyof typeof moments>(key: K, payload: PayloadOf<K>)`, so a typo
does not compile and the payload must supply exactly that moment's declared outputs. **That is build
check 2, free from the type system**, and it is why a moment's variables are trustworthy in the
builder — the type system guarantees the raise site provided them.

`raiseMoment` **sends one background event and returns**: a new Inngest event name
`carbon/workflow-moment.raised`, registered in `packages/lib/src/events.ts` alongside the other 45.
Nothing consumes it yet — phase 3 adds the listener. So the call sites are real and exercisable now
rather than a stub with a dead body, and nothing fires because no workflow can subscribe yet.

It lives in `packages/lib` (which already owns the Inngest client) and imports the moment types from
`@carbon/workflows`. Declarations are data and stay in the workflows package; the side effect stays
in the package that owns side effects. This layering matters because the raise sites are spread
across `apps/erp`, `apps/mes` and `packages/jobs`, and only `@carbon/lib` is importable by all three.

#### The v1 moments

Confirmed with the user on 2026-07-30. A sweep of the real write sites found that **7 of the 14
candidate moments have two or more independent code paths** — job completed happens in a Postgres
function and is also reached from an operation-finish interceptor; a purchase order can be issued
directly or after an approval; a sales order is confirmed inline in a route and also by the quote
conversion; quote-lost has two unrelated writers; a non-conformance is opened from two service
functions in two apps plus a Slack callback; closing one has both a validated path and an
MCP-reachable status setter; and an inspection can fail from disposition or from sample entry.

Those seven are **deferred to phase 3**, where the delivery path is real and each can be done
properly. The nine that ship are the ones with a single honest place to raise them from:

| Moment | Outputs | Raised from |
|---|---|---|
| `production.jobReleased` | `job`, `releasedBy` | `updateJobStatus`, `apps/erp/app/modules/production/production.service.ts` — when the new status is `Ready` |
| `production.jobHeld` | `job`, `heldBy` | same function — when the new status is `Paused` |
| `production.jobOperationCompleted` | `job`, `jobOperation`, `completedBy` | `finishJobOperation`, `apps/mes/app/services/operations.service.ts:151` |
| `sales.quoteSent` | `quote`, `sentBy` | `finalizeQuote`, `apps/erp/app/modules/sales/sales.service.ts:1952` |
| `sales.quoteAccepted` | `quote`, `salesOrder` | `convertQuoteToOrder`, `apps/erp/app/modules/sales/sales.service.ts:183` |
| `inventory.receiptPosted` | `receipt`, `postedBy` | `apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx` **and** `packages/jobs/src/inngest/functions/tasks/post-transaction.ts` |
| `inventory.shipmentPosted` | `shipment`, `postedBy` | `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx` **and** `post-transaction.ts` |
| `invoicing.salesInvoicePosted` | `salesInvoice`, `postedBy` | `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.post.tsx` |
| `invoicing.purchaseInvoicePosted` | `purchaseInvoice`, `postedBy` | `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.post.tsx` **and** `post-transaction.ts` |

Two rules the raise sites follow, both learned from the sweep:

- **Raise in the service function, not the route, wherever a service function exists.** Every
  `modules/*/*.service.ts` export is also callable over `POST /api/mcp` through
  `apps/erp/app/routes/api+/mcp+/lib/direct-executor.ts`, whose only blocklist is
  `["settings_seedCompany"]`. A moment raised in the route silently misses every MCP caller.
- **Raise after the write commits, and only if it did.** For the four posting moments the write
  happens inside a Supabase edge function (Deno), which cannot import app code — so the moment is
  raised by each caller once the invoke returns cleanly. That is 2–3 call sites for those, which the
  dead-event check permits (it needs at least one) and which the run-level dedupe key from phase 1
  makes safe.

The two job moments are the one place a raise site needs a value comparison: `updateJobStatus` is a
generic setter that every status transition funnels through, so it reads the prior status and raises
only on an actual transition into `Ready` or `Paused`.

### C. The generator and the two committed files

Committed, not computed at boot — so renaming a column shows up in a pull request as a **deleted
event id**, which is exactly the signal that a live customer workflow is about to break. Precedent:
`pnpm run generate:types`.

```
scripts/generate-workflow-catalog.ts        # root script, tsx, like every other generator here
packages/workflows/src/catalog/build.ts     # the pure transform — schema injected, unit-tested
packages/workflows/src/catalog/events.generated.ts   # committed. ids, outputs, permission, match
packages/workflows/src/catalog/labels.generated.ts   # committed. one msg descriptor per event id
```

The transform is a pure function `buildCatalog(entities, moments, schema)`, so it can be unit-tested
inside `packages/workflows` without that package ever importing `@carbon/database` as a value. The
root script supplies the schema and writes the files; `packages/workflows` keeps `zod` as its only
runtime dependency.

**Where the schema comes from.** `packages/database/src/swagger-docs-schema.ts` — already generated
and committed, and unlike `types.ts` it is a *runtime value*, carrying every table's columns with
their type, enum values, nullability and foreign-key target. So entity property maps and the
column-existence check both fall out of a file the repo already maintains, with no new generation
step and no parsing of TypeScript.

**What an event entry looks like:**

```ts
"purchaseOrder.status.changed": {
  outputs: { record: entity("purchaseOrder"),
             before: entity("purchaseOrder"),
             after:  entity("purchaseOrder") },
  permission: "purchasing",
  match: { table: "purchaseOrder", operation: "UPDATE", field: "status" },
},
"production.jobReleased": {
  outputs: { job: entity("job"), releasedBy: entity("user") },
  permission: "production",
  match: { moment: "production.jobReleased" },
},
```

Every entry has the same shape whichever input produced it. `outputs` differ per event, which is the
point. The `match` block is the only place the record-versus-moment distinction survives, and only the
matcher reads it — the builder uses labels and outputs and never looks at it.

Three label templates cover the whole generated side: `A {entity} is created`, `A {entity} is
deleted`, `A {entity}'s {field} changes`. Moment labels are hand-written and mandatory.

**Entity properties**, which is what makes `record.supplier.name` resolve, are generated from the
table's own columns with four rules:

1. Drop the columns nobody should reach: `companyId`, `customFields`, `embedding`, plus the existing
   `auditConfig.skipFields` (`updatedAt`, `updatedBy`).
2. Map the swagger type to a workflow type: `string`/`integer`/`number`/`boolean`, `format: "date"`
   and `"timestamp with time zone"` → `date`, an array column → `list<...>`.
3. A foreign-key column becomes `entity(target)` **only when the target is in the registry**;
   otherwise it stays a plain string id. That keeps dot-chaining honest — every entity a path can
   reach is one the catalog can describe — without dragging 40 lookup tables into v1.
4. A `Json` column has no useful type, so it is a `string` and the builder shows it as opaque.

**Labels live in their own generated file, and that is forced rather than stylistic.** Carbon's
convention for a translatable string outside a React component is `msg` from `@lingui/core/macro`
(never `t`, which throws outside a locale provider), and `msg` is a build-time macro: importing an
untransformed one from plain Node — the matcher in `packages/jobs`, or any vitest run, neither of
which has the macro plugin — throws. Splitting them means the runtime catalog and every check import
only the label-free file, and the label file is imported solely by the builder, which is built by
Vite. The matcher never needed labels anyway.

Making them extractable also needs `packages/workflows/src` added to the `erp` catalog's `include`
list in `lingui.config.js` and to `//#lingui:compile`'s `inputs` in `turbo.json`. Precedent to copy:
`packages/glossary`, which is plain TypeScript with `msg` and `@lingui/core` and is already in both.

The generator's output is normalised with biome, because a generator whose committed output is not
formatter-normalised produces whole-file churn on every run that drowns the intended diff:

```
"generate:workflow-catalog": "tsx scripts/generate-workflow-catalog.ts && pnpm exec biome check --write packages/workflows/src/catalog/"
```

### D. The checks that keep it honest

`scripts/check-workflow-catalog.ts`, exiting non-zero, wired as a new `catalog` job in
`.github/workflows/check.yml` alongside the existing `lint` / `typecheck` / `lingui` / `test` jobs.

1. **Every declared moment has at least one raise site.** A source scan for `raiseMoment("<key>"` over
   `apps/**` and `packages/**`. A moment nothing raises fails the build — the PRD's dead-event rule.
2. **Every raise site references a declared key.** Free from the type system; the script does not
   duplicate it.
3. **Every registry table and watched column still exists.** Also free at compile time via
   `TableName`/`ColumnOf<T>`; the script repeats it against the swagger schema so the failure names
   the entity and column in plain English, and so a skew between the two generated schema artifacts
   is caught rather than hidden.
4. **The committed catalog is what the generator would produce.** Re-runs `buildCatalog` in memory
   and compares against the committed file. A registry edit without a regenerate fails here, which is
   the whole reason the artifact is committed.
5. **Every moment has a label**, and every moment's outputs name a registry entity.

Plus one **deploy-time** check, not build-time, which is the drift check phase 1 asked this phase to
add: for every active workflow, its `workflowTriggerEvent` rows must equal the event ids on its active
version's trigger nodes, and every one of those ids must still exist in the catalog. It needs a live
database, so it goes where `packages/checks`' invariants already live rather than into CI.

### E. `WorkflowCatalog` conformance

`packages/workflows/src/catalog/catalog.ts` exports `createEventCatalog()`, returning a
`WorkflowCatalog` built from the generated file. Phase 1's interface grows **additively** —
`CatalogEvent` gains `label`, `permission` and `match` — so the validator, its three callers and the
`createFixtureCatalog` seam all keep working untouched. Injection stays real: nothing in
`packages/workflows/src/definition/` imports the generated catalog, and the fixture's `omit*` options
still prove it.

`getAction` and `getOperation` return `undefined` until phase 5 supplies them. The composer takes
them as optional arguments now so phase 5 plugs in without changing this file's shape.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Entity slate | The technical document's ten, with `item` for `part` and `nonConformance` for `issue` | `part` is a 12-column subtype extension that has never had the record-change trigger attached, so it cannot announce anything; `issue` is a view, and views cannot carry triggers. Both corrections were verified against the generated schema and every `attach_event_trigger` call site |
| Moment slate | The nine with a single honest raise site; the other seven deferred to phase 3 | User decision. A moment raised from only one of several real paths is a dead trigger for the others, which is the exact failure the PRD singles out as worse than a missing trigger |
| Where a moment is raised | In the service function, not the route, wherever a service function exists | Every `*.service.ts` export is also reachable over `POST /api/mcp` via `direct-executor.ts`, whose blocklist is one entry long. A route-level raise silently misses those callers |
| Posting moments (receipt, shipment, both invoices) | Raised by each caller once the edge-function invoke returns cleanly | The write happens in a Deno edge function that cannot import app code. Each has 2–3 callers (a route plus the `post-transaction` background job); the dead-event check needs only one, and phase 1's run dedupe key makes a duplicate delivery harmless |
| What `raiseMoment` does in this phase | Sends one `carbon/workflow-moment.raised` Inngest event and returns | User decision. Real, exercisable call sites rather than a function with a dead body. Nothing consumes it until phase 3, and nothing can fire because no workflow can subscribe yet |
| Where `raiseMoment` lives | `packages/lib` (which owns the Inngest client), importing moment types from `@carbon/workflows` | Raise sites span `apps/erp`, `apps/mes` and `packages/jobs`; `@carbon/lib` is the only one all three can import. Declarations are data and stay in the workflows package; the side effect stays where side effects live |
| Column-existence check | Compile-time, via type-only `TableName` / `ColumnOf<T>` from `@carbon/database/audit.config`, **and** repeated in the check script | The technical document proposes a script only. The type is strictly better — a rename fails `turbo run typecheck --filter='*'` at the registry line, naming the column — and it costs a devDependency and no runtime code. The script is kept for a readable message and to catch skew between the two generated schema files |
| Schema source for the generator | `packages/database/src/swagger-docs-schema.ts` | Already generated and committed, and it is a runtime *value* carrying columns, types, enums, nullability and FK targets — where `types.ts` is types only and would need the TypeScript compiler API to walk. No new generation step |
| Where the generator lives | Root `scripts/generate-workflow-catalog.ts`, with the pure transform in `packages/workflows/src/catalog/build.ts` | Matches every other generator in the repo (`generate-db-types`, `generate-mcp`, `generate-agent-kb`). Splitting the transform out keeps `zod` as the workflows package's only runtime dependency while still letting it be unit-tested in place |
| Labels | `msg` from `@lingui/core/macro`, in a **separate** generated file from the catalog | `t` throws outside a locale provider — a documented Carbon trap. `msg` is a build-time macro, so a file containing one cannot be imported from plain Node; the matcher and every check import the label-free file, and only the Vite-built builder imports labels |
| Entity properties | Generated from the table's columns, minus audit/internal ones; FK columns become entity refs only when the target is in the registry | The PRD's "reach any property by typing a dot" wants completeness, and generating it means zero maintenance across 15 entities. Gating FK refs on registry membership keeps every reachable path describable without pulling in 40 lookup tables |
| Stored totals | Not watchable and not dot-readable in v1 | `purchaseOrder.orderTotal` and `salesOrder.orderTotal` exist only on the `purchaseOrders` / `salesOrders` views, and a view has no trigger and no announcement. They arrive as Entity-node operations in phase 5, which is where derived values belong |
| `write` (field-update allowlist) | Not in this phase | `technical-decisions.md` sketches it in the same registry file, but nothing reads it until phase 5's action catalog. Adding it now is dead weight with a restrictive-by-default posture nobody is yet enforcing |
| `WorkflowCatalog` growth | Additive: `CatalogEvent` gains `label`, `permission`, `match` | Phase 1's validator and all three of its callers keep working unchanged, and the review specifically blessed the injected-interface-plus-`omit*`-fixture seam. Nothing in `src/definition/` may import the generated catalog |
| Where the build checks run | A root script as a new `catalog` job in `check.yml`; unit tests for the transform in `packages/workflows` | `check.yml` is the only pull-request gate, and its `lingui` job is the shape to copy. The drift check needs a live database, so it goes with `packages/checks`' invariants instead |
| Generated output formatting | `biome check --write` as part of the generate script | A generator whose committed output is not formatter-normalised produces whole-file churn every run, which hides the intended diff and makes the freshness check flap |
| Event id casing | Dotted camelCase (`purchaseOrder.status.changed`, `production.jobReleased`) | Fixed by `technical-decisions.md`. Note this is deliberately unlike Carbon's PascalCase enum convention — these are identifiers in a generated file, not database enum values |

### What this phase deliberately does not build

- No matcher, no subscription management, no loop protection (phase 3). Nothing consumes
  `carbon/workflow-moment.raised` yet, and `workflow.ts`'s stub is left alone.
- No engine, no execution of anything (phase 4).
- No action catalog, no entity-operation catalog, no `write` allowlist (phase 5).
- No scheduling (phase 6) — the trigger node's schedule field already exists from phase 1.
- No UI, no route, no navigation entry (phases 7–9).
- No migration. This phase adds no tables, no columns and no enum values.
- The seven scattered moments, by explicit decision, not omission.

## Data Model Changes

**None.** No migration, so no `pnpm db:migrate` and no `pnpm run generate:types` in this phase. The
one database-adjacent fact worth restating: all ten registry tables already have the record-change
trigger attached, so nothing needs to be made to announce.

Because a turbo run can regenerate `@carbon/database` artifacts as ride-along churn, `git status` must
be checked for `packages/database/src/types.ts`, `src/swagger-docs-schema.ts` and
`supabase/functions/lib/types.ts` before committing, and any of them reverted with `git checkout --`.

## API / Service Changes

### New files

```
packages/workflows/src/catalog/
├── entities.ts              # hand-written registry: 10 triggerable + 5 reference-only
├── moments.ts               # hand-written: 9 declarations + PayloadOf<K>
├── build.ts                 # buildCatalog(entities, moments, schema) — pure
├── events.generated.ts      # committed. do not edit
├── labels.generated.ts      # committed. do not edit. msg descriptors only
├── catalog.ts               # createEventCatalog() -> WorkflowCatalog
├── build.test.ts
└── index.ts                 # barrel; re-exported from src/index.ts

packages/lib/src/workflows/raise-moment.ts   # raiseMoment
scripts/generate-workflow-catalog.ts
scripts/check-workflow-catalog.ts
```

### Modified files

- `packages/workflows/src/definition/catalog.ts` — `CatalogEvent` gains `label`, `permission`,
  `match`; `createFixtureCatalog` updated to supply them. No behaviour change.
- `packages/workflows/package.json` — `@carbon/database` as a **devDependency** (type-only),
  `@lingui/core` as a dependency for the label file's `MessageDescriptor`.
- `packages/lib/src/events.ts` — one new event name, `carbon/workflow-moment.raised`, with its typed
  payload.
- `lingui.config.js` — `packages/workflows/src` added to the `erp` catalog's `include`.
- `turbo.json` — the same path added to `//#lingui:compile`'s `inputs`.
- `package.json` — `generate:workflow-catalog` and `check:workflow-catalog` scripts.
- `.github/workflows/check.yml` — a new `catalog` job.
- Nine raise sites across `apps/erp/app/modules/{production,sales}`, `apps/mes/app/services`,
  four `apps/erp/app/routes/x+/**` post routes, and
  `packages/jobs/src/inngest/functions/tasks/post-transaction.ts`.
- `packages/workflows/AGENTS.md` — the catalog's layout, the "regenerate, never hand-edit" rule, and
  the label-file split with its reason.
- `.claude/rules/` — a new rule for the catalog, since it is a subsystem later phases will read.

### `raiseMoment`

```ts
export async function raiseMoment<K extends MomentKey>(
  key: K,
  payload: MomentPayload<K> & { companyId: string; actorId: string | null }
): Promise<void>;
```

`MomentPayload<K>` is derived from the declaration's `outputs`, so an entity output must be supplied
as `{ type, id }` and a typo in either the key or a field name fails to compile. Entities are passed
as a type plus an id, never a row snapshot — the same rule phase 1 set for run logs.

It never throws into its caller. A moment that fails to send must not roll back the business action
that already committed; it logs and returns, and the run log is phase 9's place to surface it.

## UI Changes

N/A. The trigger picker that reads this catalog is phase 7's canvas and phase 8's node forms. Adding
anything now would be a screen with no route.

## Acceptance Criteria

Registry and generation:

- [ ] `pnpm run generate:workflow-catalog` writes `events.generated.ts` and `labels.generated.ts`, and
      running it twice in a row leaves `git status` clean.
- [ ] `events.generated.ts` contains exactly 106 entries: 97 record events and 9 moments.
- [ ] `purchaseOrder.created`, `purchaseOrder.deleted` and `purchaseOrder.status.changed` all exist,
      and **`purchaseOrder.updated` does not** — there is no generic updated event.
- [ ] `purchaseOrder.status.changed` carries `match: { table: "purchaseOrder", operation: "UPDATE",
      field: "status" }` and outputs `record`, `before` and `after`, all typed
      `entity("purchaseOrder")`.
- [ ] `production.jobReleased` carries `match: { moment: "production.jobReleased" }` and the outputs
      its declaration names, passed through unchanged.
- [ ] `labels.generated.ts` has one entry per event id in `events.generated.ts`, and
      `events.generated.ts` imports nothing from `@lingui/*`.
- [ ] The generated label for `purchaseOrder.created` renders as "A purchase order is created" and for
      `purchaseOrder.status.changed` as "A purchase order's status changes".
- [ ] `getEntity("purchaseOrder").properties.supplierId` is `entity("supplier")` (a registry member),
      while a foreign key to a table outside the registry is a plain `string`.
- [ ] `getEntity("purchaseOrder").properties` contains no `companyId`, `customFields`, `updatedAt` or
      `updatedBy`, and contains no `orderTotal` (a view-only column).
- [ ] `validateDefinition` resolves a reference to `record.supplier.name` against the real catalog
      with no issues, and returns `UNKNOWN_VARIABLE` for `record.supplier.notAColumn`.

Checks:

- [ ] `pnpm run check:workflow-catalog` exits 0 on a clean tree.
- [ ] Deleting one `raiseMoment` call site makes it exit non-zero, naming the unraised moment.
- [ ] Adding a watched column to the registry without regenerating makes it exit non-zero.
- [ ] Renaming a watched column in the registry to one that does not exist fails
      `pnpm exec turbo run typecheck --filter=@carbon/workflows` at the registry line, and also makes
      the check script exit non-zero with the entity and column named.
- [ ] Removing a moment's label fails to compile (the field is required), and a moment whose output
      names an entity absent from the registry makes the check script exit non-zero.

Conformance and integration:

- [ ] `createEventCatalog()` satisfies `WorkflowCatalog`; `getAction` and `getOperation` return
      `undefined` for every id until phase 5.
- [ ] Every existing `packages/workflows` test still passes, and nothing under `src/definition/`
      imports anything under `src/catalog/`.
- [ ] A trigger node listing two events whose outputs differ still validates, exposing only the
      outputs both supply — the existing intersection behaviour, now against real events.
- [ ] Releasing a job in the ERP sends exactly one `carbon/workflow-moment.raised` event visible in
      the Inngest dev UI, carrying `production.jobReleased`, the job id and the acting user; moving a
      job from `Ready` to `Ready` sends none.
- [ ] Posting a receipt sends `inventory.receiptPosted` once, and posting the same receipt again does
      not send a second (the status guard already prevents the second post).
- [ ] `pnpm --filter @carbon/workflows test`, `pnpm exec turbo run typecheck --filter=@carbon/workflows
      --filter=erp --filter=mes --filter=@carbon/jobs --filter=@carbon/lib` and
      `pnpm exec biome check packages/workflows packages/lib scripts` all pass.
- [ ] `pnpm run lingui:check` extracts the new catalog labels into `packages/locale/locales/en/erp.po`.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A `msg` macro reaches a Node-only consumer (the phase 3 matcher, or a vitest run) and throws at import | High | The split into `events.generated.ts` and `labels.generated.ts` is exactly this guard, and an acceptance criterion asserts `events.generated.ts` imports nothing from `@lingui/*`. A `build.test.ts` that imports the generated catalog under plain vitest proves it, because vitest has no macro plugin |
| A moment is raised before the write commits, so a workflow reads the old row | High | Every raise site sits after the awaited write returns, and for the four edge-function moments after the invoke resolves without error. The PRD is explicit that moments fire only after the save |
| The seven deferred moments are forgotten, and phase 3 ships without them | Medium | Listed by name in this spec's "does not build" section and in the cross-phase dependencies below, and `phase-3-matcher.md` is where they land |
| A 106-entry generated literal with nested union types tips `erp` over TypeScript's instantiation budget (TS2589) in an unrelated file | Medium | A known chronic issue on this repo. Keep the generated file's types shallow — a widened `Record<string, CatalogEventEntry>` with one `satisfies` at the boundary rather than inferring a deep literal type across 106 entries. Verify with `tsgo` directly, not the turbo cache, and use `@ts-ignore` not `@ts-expect-error` if it surfaces |
| `raiseMoment` failing takes down the business action that already committed | Medium | It never throws into its caller: it logs and returns. Losing a moment is a missed workflow; failing the caller is a corrupted purchase order |
| Two raise sites for the same posting moment double-deliver | Low | They are alternative callers, not sequential ones, so in practice only one fires. If both ever did, phase 1's `workflowRun_dedupe_key` makes the second a no-op |
| `swagger-docs-schema.ts` and `types.ts` drift, because they are produced by separate manual commands | Low | Check 3 runs against both — the compile-time version reads `types.ts`, the script reads the swagger schema — so a skew fails rather than silently picking one |
| The generator's output churns on every run and hides the real diff | Low | `biome check --write` is part of the generate script, and the freshness check would flap loudly if it were not |
| `packages/workflows` gaining `@carbon/database` breaks the browser bundle | Low | Type-only import, declared as a devDependency, erased at build. An acceptance criterion typechecks `erp` and `mes` alongside it |
| A turbo run commits regenerated `@carbon/database` artifacts as ride-along churn | Low | Check `git status` for the three generated files after any turbo run and `git checkout --` them |

## Open Questions

All resolved with the user on 2026-07-30, before this spec was written. Recorded as an audit trail.

- [x] Which 8–10 entities ship in v1? — **Answer:** the technical document's ten, with two corrections
      the user accepted as part of the recommendation: `item` rather than `part` (a 12-column subtype
      extension that has never had the record-change trigger attached, so it cannot announce), and
      `nonConformance` rather than `issue` (`issues` is a view, and a view carries no trigger; "Issue"
      stays the customer-facing label the ERP already uses). Line-level records
      (`purchaseOrderLine`, `jobOperation` as a trigger source) and a smaller six-entity slate were
      both offered and declined — lines would nearly double the event count and are where the noisiest
      edits happen.
- [x] Which moments ship in v1? — **Answer:** initially the fourteen across the same modules; then,
      after a sweep of the real write sites found that seven of them have two or more independent code
      paths, the user chose to ship only the nine with a single honest raise site and defer the other
      seven to phase 3. Deferred: job completed (it happens in a Postgres function, also reached from
      an operation-finish interceptor), purchase order issued (direct finalize versus post-approval),
      sales order confirmed (route-inline versus the quote conversion edge function), quote lost (two
      unrelated writers), non-conformance opened (two service functions across two apps plus a Slack
      callback), non-conformance closed (a validated path plus an MCP-reachable status setter), and
      inspection failed (disposition versus sample entry). Rejected: raising at every path now (~22
      call sites for a phase with no consumer), and raising from database triggers (a different
      mechanism from the typed `raiseMoment` this phase exists to build, and it loses the typed
      payload the builder depends on).
- [x] How far should the moment plumbing go, given there is no matcher until phase 3? — **Answer:**
      `raiseMoment` really sends one `carbon/workflow-moment.raised` background event and returns, so
      the call sites are real and exercisable; phase 3 adds the listener. Rejected: a typed stub with a
      dead body (a reviewer would flag it, and it proves nothing at run time), and deferring the call
      sites entirely (the phase document asks for them here).
- [x] Posting a receipt or a shipment happens in a Deno edge function that cannot import app code — how
      does that moment get raised? — **Answer:** by each caller, once the invoke returns cleanly. The
      user's first choice was "from the ERP route that posts"; the write-site sweep then showed that
      those actions are also performed by the `post-transaction` background job and are reachable over
      MCP, so the rule was widened to "raise at each real caller, in the service function wherever one
      exists" and `raiseMoment` moved to `packages/lib` so all three trees can import it. Rejected: a
      Deno twin of the moment list inside the edge function (a second copy of the ids for the check to
      scan), and dropping the two moments.

Decided from the codebase rather than asked, and recorded in Design Decisions above: where the
generator lives, that the schema comes from `swagger-docs-schema.ts`, that labels use `msg` in a
separate file, that entity properties are generated with FK refs gated on registry membership, that
`write` waits for phase 5, that `CatalogEvent` grows additively, and that the checks ride a new
`check.yml` job.

## Cross-phase dependencies this phase creates

- **Phase 3** consumes `carbon/workflow-moment.raised` (nothing does yet), reads `match` blocks to
  turn an announcement into event ids, and owns the seven deferred moments. It must reuse
  `computeDiff` in `packages/jobs/src/inngest/functions/events/diff.ts` rather than write a second
  differ, and note that `computeDiff` returns `null` when nothing changed and applies
  `auditConfig.skipFields`. It also inherits the deploy-time drift check defined here.
- **Phase 5** reuses the entity registry for its `write` allowlist and plugs `getAction` /
  `getOperation` into `createEventCatalog()`'s optional arguments. Stored totals
  (`purchaseOrder.orderTotal` and friends, which live only on the list views) become Entity-node
  operations there.
- **Phases 7 and 8** read `labels.generated.ts` for the picker and `outputs` for the variable picker,
  and must import labels only from a Vite-built tree.
- **Anyone adding an entity or a moment** edits one hand-written file and re-runs
  `pnpm run generate:workflow-catalog`. Never hand-edit a `*.generated.ts`.

## Changelog

- 2026-07-30: Created. Four open questions resolved with the user before writing (see Open Questions).
  Three deliberate deviations from `technical-decisions.md`, each recorded in Design Decisions with
  rationale: the column-existence check is a compile-time type as well as a script; labels are split
  into a second generated file because `msg` is a build-time macro that cannot be imported from plain
  Node; and the entity slate substitutes `item` for `part` and `nonConformance` for `issue` because
  the originals cannot emit record-change announcements. The moment count is 9 rather than the
  document's ~30, by user decision, with the seven scattered candidates named and deferred to phase 3.
- 2026-07-30: Implemented per `.ai/plans/2026-07-30-workflows-event-catalog.md`. 106 events (97 record
  + 9 moments) and 15 entity property maps generated; all nine raise sites in place; five build checks
  green as the `catalog` job. Four corrections found while building, all against the real schema:
  - **`CatalogEvent` gains `permission` and `match` only — no `label`.** Labels live solely in
    `labels.generated.ts` (keyed by event id) so the runtime catalog never imports Lingui. A `label`
    field on the interface would always be undefined at run time; the spec's Deliverable E said
    otherwise but its Deliverable C already implied this split.
  - **`customer.salesContactId` takes no entity ref** — its foreign key targets `customerContact`,
    not `user` as this spec's slate table implied. `buildCatalog` now *throws* when a declared `ref`
    disagrees with a foreign key present in the schema, so that class of error cannot recur silently.
    `ref` is still required where a composite key like `(supplierId, companyId)` carries no `<fk>`
    note, which is what makes the `supplierId → entity("supplier")` criterion pass.
  - **Property paths use column names.** The criterion written as `record.supplier.name` is really
    `record.supplierId.name`; there is no de-suffixed alias in v1.
  - **Labels pick their article** — `An item is created`, not `A item is created`.
  - Two service signatures grew a `companyId` (`updateJobStatus`, `finalizeQuote`) and
    `convertQuoteToOrder` now awaits its invoke, so the moment could be raised in the service
    function rather than the route (per this spec's MCP rule). `pnpm run generate:mcp` was re-run;
    `direct-executor.ts` supplies `companyId` from context in both cases.
  - The deploy-time drift check landed as two pieces: the `workflow-trigger-event-drift` SQL
    invariant (row ↔ trigger-node equality, no catalog needed) plus
    `pnpm --filter @carbon/checks workflow-events` for the half that must consult the catalog.
- 2026-07-30: Post-implementation quality audit. Six defects found and fixed, plus the
  structural cleanups they exposed:
  - **`raiseMoment` was sending through an untyped client.** `packages/lib/src/inngest/client.ts`
    is built without `EventSchemas`, so `inngest.send()` accepts any name and any payload — the
    `Events` entry this spec added enforced nothing, and a drifted payload would have failed
    silently inside a function designed never to throw. It now dispatches through the repo's
    typed `trigger()` helper (`packages/lib/AGENTS.md` mandates this), with
    `"workflow-moment"` added to `taskToEvent`. Verified by breaking the payload and watching
    `tsgo` reject it at both the send and the call site.
  - **The receipt and shipment raises sat inside the `try` whose `catch` reverts status to
    Draft.** `raiseMoment` not throwing prevents it from *causing* a rollback, not from being
    reached before later code (`update-purchased-prices`) throws. Both moved below the catch,
    matching what the invoice routes already did.
  - **`post-transaction.ts` is dead code** — nothing sends `carbon/post-transaction`
    (verified by `git grep`). The raise block added there was unreachable, and this spec's
    "each has 2–3 callers (a route plus the `post-transaction` background job)" justification
    was false. Block deleted; there is exactly one live caller per posting moment.
  - **`sales.quoteSent` was gated on the `quoteLine` write** rather than the quote reaching
    'Sent' — a line-update error suppressed the moment for a quote that was genuinely sent.
    Now gated on the header write (guaranteed by the early return above it).
  - **`sales.quoteAccepted` misattributed `actorId`** on the digital-quote path, where
    `userId` is the employee who *created* the quote, not the customer accepting it. A digital
    acceptance now reports `actorId: null`, matching the field's documented meaning.
  - **The sales-invoice raise preceded the route's own cross-tenant guard.** Moved below it.
  - `payload` is now `{ outputs, companyId, actorId }` rather than spreading outputs at the top
    level, which removed a `as unknown as` double cast and the possibility of a moment output
    named `companyId` colliding with the envelope.
  - Structural: `validateCatalogInputs` split out of `buildCatalog` so it collects every
    problem instead of throwing on the first (and the check script's duplicated copy of that
    walk was deleted, along with a comment claiming it compared two schema artifacts, which it
    never did); canonical `t.*` `ValueType` constructors added to `definition/types.ts` and the
    three private copies removed; `RegistryEntry`/`WatchedColumnLike`/`MomentDeclarationLike`
    now have one definition each; the generator emits via `JSON.stringify` and lets the biome
    pass format (149 → 83 lines); the check script's 35-line directory walker became one
    `git grep` (187 → 145 lines); `build.ts` is no longer in the package's public API.
  - Two missing guards added: watching a column that is dropped from every property map is now
    an error (it would have emitted an event whose field could not resolve), and the MES
    `jobOperation → jobId` query is no longer duplicated one line after the helper that
    already resolved it.
