# @carbon/workflows

The shared contract for a **workflow definition** — the zod schema, the read-time
normaliser, and the validator that decides whether a workflow may be activated.

"Workflow" here means the customer-facing feature: a "when this happens, do that" rule a customer
builds on a canvas. It is **not** the generic sense used by the `.claude/rules/workflow-*.md`
developer-procedure files, and unrelated to `nonConformanceWorkflow`.

Spec: `.ai/specs/2026-07-30-workflows-foundation.md`.

## Always

- Change the schema **here**, never in a consumer. The builder (phase 7), the activation gate
  (phase 7) and the engine (phase 4) all read this one package — if any of them can disagree about
  what is valid, a customer can activate something broken and it will act on real records.
- Turn a stored row into a definition with `readWorkflowVersion(row)`. It is the single boundary
  where untyped JSON becomes the typed model, and it returns `{ok: true, definition}` or
  `{ok: false, failure, message}` — never a blank canvas standing in for a row it could not read,
  because the builder would then save over a definition nobody could see.
- Upgrade an older stored shape only inside `migrateDefinition` in `src/definition/normalize.ts`.
  It is private, pass-through at v1, and runs on the **raw JSON before** the current-schema parse —
  a document old enough to need upgrading cannot satisfy the current schema, so migrating after that
  parse could never run.
- Bump `CURRENT_DEFINITION_FORMAT_VERSION` when the stored shape changes, and add the upgrade to
  `migrateDefinition` in the same change.
- Pass a `WorkflowCatalog` into `validateDefinition`. Phases 2 and 5 supply the real event and
  action catalogs; `createFixtureCatalog()` is for tests only.
- Add a node type by adding one entry to `NODE_KINDS` in `src/definition/nodes.ts`. The mapped type
  makes a missing entry a compile error, which is the only thing stopping a new node type from
  validating clean with no handles and no checks at all.
- Take operator names from `Operator` in `@carbon/utils` — Carbon's one condition vocabulary, shared
  with storage rules. `OPERATORS_BY_TYPE` decides which of them a workflow may use where; it does not
  invent names.
- Keep zod unions **flat** and avoid recursive generics. `apps/erp` sits near TypeScript's
  instantiation budget, so new type surface here can trip TS2589 in unrelated files.
- Add an entity or a moment by editing **one hand-written file** in `src/catalog/`, then run
  `pnpm run generate:workflow-catalog`. Nothing else is authored by hand.

## Never

- Never import from `@carbon/react` or anything app-specific. `@carbon/database` is a
  **devDependency used for types only** (`ColumnOf` / `TableName` in `src/catalog/entities.ts`) —
  never import it as a value. Runtime dependencies are `zod`, `@carbon/utils` and `@lingui/core`,
  which is what lets both the browser builder and the server engine use this package.
- Never hand-edit `src/catalog/*.generated.ts` — regenerate instead.
- Never import `src/catalog/labels.generated.ts` from anything but a Vite-built app. `msg` is a
  build-time macro; plain Node (the phase-3 matcher, any vitest run) throws on import. That is why
  labels are a separate file from the runtime catalog, and why `src/catalog/index.ts` does not
  re-export them.
- Never import `src/catalog/` from `src/definition/`. The catalog is injected into the validator,
  not baked into it; `createFixtureCatalog`'s `omit*` options exist to prove that.
- Never let a stored node/edge shape reach a consumer without going through the schema.
- Never represent a list of lists — a list's `of` accepts scalars only, by construction.

## Layout

```
src/definition/
├── types.ts      # value types, operators, refs, literals, clauses, schedules
├── issues.ts     # WorkflowIssueCode + WorkflowIssue
├── schema.ts     # node/edge/definition schemas, format version, handle names, PRD caps
├── nodes.ts      # NODE_KINDS — what each node type declares about itself
├── normalize.ts  # readWorkflowVersion + the migrateDefinition seam
├── catalog.ts    # the WorkflowCatalog interface + walkPath + createFixtureCatalog
└── validate.ts   # validateDefinition -> WorkflowIssue[]

src/catalog/
├── entities.ts             # HAND-WRITTEN. 10 triggerable record types + 5 reference-only
├── moments.ts              # HAND-WRITTEN. 9 business events, their labels and outputs
├── build.ts                # buildCatalog(registry, moments, schema) — pure, schema injected
├── events.generated.ts     # COMMITTED. ids, outputs, permission, match. No Lingui import
├── labels.generated.ts     # COMMITTED. one msg`` descriptor per event id
├── catalog.ts              # createEventCatalog() -> WorkflowCatalog
└── index.ts                # barrel (labels deliberately excluded)

src/runtime/
├── types.ts     # RuntimeValue, Resolution, EntityLoader, RuntimeContext, NodeResult, NodeExecutor
├── values.ts    # value constructors + fromColumn coercion
├── resolve.ts   # structured refs and the current item -> a value, or a readable reason
├── compare.ts   # operator semantics + clause evaluation
├── condition.ts # the Condition executor
├── filter.ts    # the Filter executor
├── batch.ts     # planBatch + itemKeyFor
├── fixtures.ts  # TEST-ONLY fake loader/context. Not exported from the package root
└── index.ts     # barrel

src/sync.ts       # trigger-event + subscription reconciler (phase 3)
```

`src/runtime/` is pure: no I/O, no database client, no Supabase. Records are read
through the injected `EntityLoader`, which the engine in `@carbon/jobs` implements
over the workflow owner's own connection. Comparison semantics live in
`runtime/compare.ts` and must not be re-implemented anywhere else.

## `sync.ts` — deriving what the matcher reads

Four exports, all re-exported from the package root:

- `deriveWorkflowTriggerRows(nodes)` — trigger nodes → one desired `workflowTriggerEvent`
  row per event id, carrying that node's origin (a duplicated id keeps the first origin).
  Throws if the stored nodes do not parse.
- `deriveWorkflowSubscriptions(eventIds)` — event ids → one `workflow-<table>`
  `eventSystemSubscription` per distinct table with exactly the operations those events
  need, resolved through each event's catalog `match`. Moments contribute nothing.
- `syncWorkflowTriggers(db, companyId, workflowId)` — rewrites one workflow's trigger rows
  **and** reconciles the company's subscriptions in one transaction. This is what upholds
  the invariant below; call it on promote, on trigger edit, and on activate/deactivate.
- `syncWorkflowSubscriptions(db, companyId)` — standalone repair from existing rows.

Kysely is imported **type-only** (`import type { Kysely, Transaction } from "kysely"`), so
it stays a devDependency and this package keeps its three runtime dependencies. Kysely also
**bypasses RLS** — the caller authorizes first (phase 7's activation route gates on
`workflows_update`).

This is the one thing here that lives in this package for a dependency reason rather than a
conceptual one: it needs `WORKFLOW_EVENTS`, and `@carbon/database` (its more natural home,
beside `event.ts`) cannot depend on `@carbon/workflows` without creating the package cycle
Turborepo rejects. See `.claude/rules/workflow-matcher.md`.

## The event catalog

One customer-facing concept — an **event** — from two hand-written inputs. A record type with
8 watched columns yields 10 events (created, deleted, one per column); there is deliberately
**no generic `updated` event**. Moments cover what a row change cannot express. Downstream,
nothing knows which input produced an event: only the `match` block distinguishes them, and only
the phase-3 matcher reads it.

`buildCatalog` takes the swagger schema as an argument rather than importing it, which is what
keeps `@carbon/database` out of this package's runtime graph and lets the transform be unit-tested
in place. Entity properties are generated from the table's own columns so a customer can reach any
property by typing a dot; a foreign key becomes an entity ref only when its target is in the
registry, and a `ref` that disagrees with the schema's foreign key is a build error.

`scripts/check-workflow-catalog.ts` (CI job `catalog`) enforces: every moment is raised somewhere,
every raise site names a declared moment, every watched column still exists, and the committed
catalog matches a fresh build. A declared-but-never-raised moment is a trigger a customer can
subscribe to that can never fire — worse than a missing one, so it fails the build.

## Node kinds

Everything one node type does — handles, values, outputs, the list it loops over, type checks,
config checks — lives in its single `NODE_KINDS` entry, seven members the mapped type makes
mandatory. `validate.ts` owns only the cross-cutting layers below; it never switches on a node type.

`loopList` is where "which single list does this step work through" is answered **once**: a filter's
source, a batched action's one list-typed input, and `undefined` for every other kind. A filter's
outputs are its loop list; the item a `{kind:"item"}` value reads is that list's `of`; the batch
config check is that list failing to settle. Inputs that are themselves `{kind:"item"}` are skipped
when looking for it, which is what stops the item type asking for itself.

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
   the action is in batch mode.
7. Configuration — every event/action/operation/entity id exists; nothing left half-configured.

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

## The `workflowTriggerEvent` invariant (for phase 7)

A `workflowTriggerEvent` row exists **if and only if** the workflow is active, has a promoted
version, and that version's trigger nodes list that event id. Promoting a version, editing the
active version's trigger, and toggling `active` must all rewrite the workflow's rows —
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
pnpm run generate:workflow-catalog                 # after editing entities.ts / moments.ts
pnpm run check:workflow-catalog                    # the CI `catalog` job
```

Changing `Operator` in `@carbon/utils` also needs
`pnpm --filter @carbon/utils test` and `pnpm exec turbo run typecheck --filter=erp`.
