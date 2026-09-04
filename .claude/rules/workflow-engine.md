---
description: The workflow engine — how a queued run walks its graph, one durable step per node, acting as the workflow's owner. Read before touching the engine, the runtime evaluation layer, or anything that reads records on a running workflow's behalf.
paths:
  - "packages/jobs/src/workflows/engine/**"
  - "packages/workflows/src/runtime/**"
---

# Workflow Engine

Takes one `workflowRun` row the matcher queued and walks it. "Workflow" here is the
customer-facing feature — not the `.claude/rules/workflow-*.md` procedure files.

Spec: `.ai/specs/2026-07-30-workflows-engine.md`. Upstream: `workflow-matcher.md`.
Catalog: `workflow-event-catalog.md`. What the nodes actually do:
`workflow-actions.md`.

## The two halves

```
packages/workflows/src/runtime/     pure. no I/O, no client, no database.
  values.ts    RuntimeValue + fromColumn coercion
  resolve.ts   {kind:"ref"|"item"|"literal"|"template"} -> a value, or a reason
  compare.ts   operator semantics + evaluateClauses
  condition.ts filter.ts compute.ts lookup.ts action.ts   the five executors
  executors.ts the node-kind -> executor registry
  batch.ts     planBatch + itemKeyFor

packages/jobs/src/workflows/engine/  everything that touches the world
  walk.ts    pure graph maths — frontier, handles, MAX_NODE_EXECUTIONS (500)
  owner.ts   getOwnerClient / readOwnerPermissions / hasPermission
  loader.ts  EntityLoader over the owner's connection + triggerOutputs
  ledger.ts  claimStep / settleStep / failInterruptedSteps / redactForLog
  log.ts     loadRunContext / claimRun / finishRun / failCrashedRun (workflowRun)
  execute.ts the orchestration: load -> permissions -> node:* -> finish

packages/jobs/src/workflows/actions/  the WorkflowServices implementation
  services.ts  createWorkflowServices — the one port the runtime calls
```

A node kind runs only if `EXECUTORS` in `runtime/executors.ts` has an entry for
it, and `execute.ts` takes the permission module and the work from that **same**
entry. Two lookups could drift, and the one that drifts silently is the
permission check — so a new kind is one registry line, never an extended
`node.type` chain.

## The services port

The runtime is pure, so an executor that must reach the world calls
`ctx.services` — `runAction`, `runOperation`, `search` — declared as
`WorkflowServices` in `runtime/types.ts` and **required** on `RuntimeContext`.
`execute.ts` builds one per step from the owner's freshly-minted client, so the
port carries the owner's identity with it and cannot be handed a privileged one
by accident. The implementations live in `packages/jobs/src/workflows/actions/`
— see `workflow-actions.md`.

`packages/jobs/src/inngest/functions/workflows/run.ts` is a thin wrapper: parse the
payload, hand it to `executeWorkflowRun`. All the logic is in `engine/`.

## Acting as the owner — the rule that must not be relaxed

A workflow must never be able to do something its owner could not do by hand.

- The owner's client is minted **per step**, inside the step:
  `getUserScopedClient(ownerId, { workflowRunId })`. The token lives five
  minutes; a run outlives that across retries.
- `workflowRunId` is **not optional**. `dispatch_event_batch()` reads that claim
  to tag the write. An untagged write looks like a person's, so the origin filter
  and both loop guards go blind. See `workflow-matcher.md`.
- The declared permission is checked **explicitly** as well as by RLS — the
  trigger event's module at run start, and each node's `{module, action}` before
  it executes. RLS alone returns zero rows, which reads as "no data"; a customer
  needs `"The owner of this workflow no longer has access to Purchasing."` The
  action is part of the gate: an owner who may view Purchasing but not update it
  fails at the update node, not at the trigger.
- **The only privileged access is the two run-log tables.** `getJobDatabaseClient`
  appears in `execute.ts` for `claimStep`/`settleStep`/`loadRunContext`/`claimRun`/
  `finishRun` and nowhere else. RLS on those tables is SELECT-only by design. A
  business read through a privileged client is a security bug, not a shortcut.

## Not doing a thing twice

- **Run level.** `claimRun` is `UPDATE ... WHERE status='Queued' RETURNING id`.
  A second delivery gets no row back and touches nothing.
- **Step level.** `claimStep` inserts `Running` with
  `ON CONFLICT ON CONSTRAINT workflowStepRun_idempotency_key DO NOTHING`.
  Claim-before-acting is **at most once, on purpose**: a duplicated posting is
  worse than a missing one in an ERP. The loss is made visible —
  `failInterruptedSteps` settles anything still `Running` as `Failed` at the end
  of the run rather than leaving it silent.
- `itemKey` is a record's own id, or a hash of the value. **Never a position in a
  list** — a list that comes back in a different order would re-run everything.
- A node reached from two branches runs **once, and only after both branches
  settle**. `walk.ts` tracks a state per *edge* — `live` when its source took
  that handle, `dead` when it took another or was never reached, absent while
  still pending. A node is queued when every incoming edge has settled and at
  least one is `live`; it is **skipped** when they are all `dead`, and a skip
  settles its own outgoing edges dead, so one untaken condition branch retires
  the whole subgraph behind it rather than deadlocking the join below. Without
  this, a shorter branch into a join would run it before a longer branch had
  produced the value it reads — silently, as an unresolved reference. Skipped
  nodes get no step row; the run detail shows them as "Not reached".

## `RunTrigger` — three variants

`runTriggerSchema` / `RunTrigger` in `packages/workflows/src/run-trigger.ts` is a three-member
discriminated union: `kind: "record"` (a DB row change), `kind: "moment"` (a business event),
and `kind: "schedule"` (a scheduler wake, carrying only `dueAt: string`). `triggerOutputs` in
`engine/loader.ts` returns `{}` for `"schedule"` — a scheduled run starts with no record
and seeds no entity cache.

## `before` and `after` share an id

A change trigger hands out `record`, `before` and `after`, and all three are the
same record id. The per-run entity cache is keyed `${entity}:${id}`, so it cannot
hold both. An entity `RuntimeValue` therefore carries an optional inline `row`:
`triggerOutputs` puts each trigger row on its own value, and seeds the shared
cache with the **current** state only. Seeding `before` there would poison every
later read. This is what makes `before.orderTotal <= 10000` mean what it says.

## Gotchas

- Comparison semantics live in `runtime/compare.ts` and must not be
  re-implemented in the builder. `contains`/`startsWith`/`endsWith` ignore case;
  `eq`/`neq` do not. Nothing (a null) is never ordered and never throws.
- Missing data is a **skip with a reason**, not an error. A condition whose
  operand cannot be resolved stops there and does **not** fall through to its
  `else`.
- `packages/workflows` is compiled by `apps/erp`, which targets **ES2019** — no
  BigInt literals, and no `node:crypto` (the phase-7 builder compiles it for the
  browser too). `itemKeyFor` uses `fnv1a64` from `@carbon/utils`, which is two
  32-bit passes for that reason, and is shared with the storage-rules cache key.
- Every `step.run` id must be deterministic: `"load"`, `"permissions"`,
  `` `node:${nodeId}` ``, `` `node:${nodeId}:${itemKey}` ``, `"finish"`. Never a
  timestamp or a counter.
- `claimStep` writes the step's configuration to `input` through `redactForLog`;
  `settleStep` applies the same function to `input`, `output`, `detail`, `error`, and
  `statusReason` (via `redactText`). `settleStep` rewrites `input` only when the step
  resolved something, merging `{ ...claim-time config, resolved }` — so a value that
  only materialises at resolution time (an `authorization` header assembled from a
  reference) is redacted too. Executors report those values through the optional
  `record` callback on `RuntimeContext`, not on `NodeResult`: three of them can reject
  rather than return, and a rejection would lose the values on the one path a customer
  most needs them. `redactForLog` keeps the key and replaces the value with
  `"[REDACTED]"` for any key matching
  `/secret|token|password|passwd|credential|signature|authorization|apikey|api_key|client_secret|clientsecret|private_key|privatekey|bearer|cookie/i`
  and truncates strings over 4 KB. `itemKey`, `authorizedBy`, `keyword`, and
  `sessionId` are deliberately excluded — over-redaction in a debugging tool is a
  failure too. Redaction is by key name **and** by value shape: a `pairs` value
  (the webhook action's request headers) has every entry's value replaced and every
  entry's name kept, so a header called `X-Company-Key` is protected as well as
  `Authorization` — no header name has to match a pattern to be safe. One guard
  covers both the definition-side and the runtime-side `pairs`, which are logged at
  different moments. Anything new that lands in those columns goes through it. The
  `detail` column holds per-clause condition evaluation diagnostics (never node
  data), written only on Succeeded/Skipped; Failed nodes leave it null.
- A **lost claim always returns `Skipped`**, even when the existing row is
  terminal, so a replay does not reuse that row's output. Known divergence from
  the phase-4 spec, deliberately left in place.

## Repeating steps

Nothing is stored on a node saying "repeat". An action node works through a list
when a list is wired into an input the catalog declares as taking a **single**
value. `batchCandidates` + `batchPlan` in
`packages/workflows/src/definition/batch.ts` are the only place that rule lives,
so `execute.ts` and the validator cannot pick different lists. Candidates are the
action's supplied, declared-scalar inputs in **declaration order**; an input
already reading the loop item is skipped, or resolving it would recurse. Two
lists wired in is `INCOMPLETE_CONFIG` at validation time, never a guess.

`resolveBatchItems` resolves that list outside the durable steps, runs
`planBatch` (capped at `MAX_LIST_ITEMS`, 100), then runs one
`` `node:${nodeId}:${itemKeyFor(item)}` `` step per item, each claiming under
that item key. The action executor itself handles **one item only**: `ctx.item`
is the turn's item, and the input that resolved to a list is replaced by it. When
no candidate resolves to a list the node simply runs once, at
`` `node:${nodeId}` ``.

Afterwards one aggregate row is written under `` `node:${nodeId}` `` with
`itemKey: ""`. It succeeds if **at least one item succeeded**, and its handle is
what the walk follows. Its `statusReason` is where a dropped or failed item
becomes visible — `Ran 100 of 150; 50 were not used.` The node's outputs are a
list of each successful item's primary output, in item order. A failed item does
not stop the graph but does mark the **run** Failed, so a partial batch never
shows a customer a green tick.

## Per-run additions (round 2)

- **`custom-fields` step.** `executeWorkflowRun` now runs one extra durable step between
  `"load"` and `"permissions"`, reading the company's active `customField` rows through the
  **owner's** client and building a `CatalogOverlay` from them. The catalog is constructed from
  that overlay, so a custom field is simply a declared property everywhere downstream —
  `resolve.ts`'s `entity.properties[segment]` gate, `values.ts`'s `fromColumn` coercion and
  `compare.ts` all work unchanged. A refused read and a company with no custom fields are the
  same answer: the run proceeds against the shipped catalog alone. Step ids are therefore
  `"load"`, `"custom-fields"`, `"permissions"`, `` `node:${nodeId}` ``, `"finish"`.
- **`ctx.linkFor`.** `contextFor` supplies an optional `(of, id) => string | null` that turns a
  record into the existing `${ERP_URL}/api/link?...` URL. `renderTemplate` uses it ONLY for
  inputs the catalog marks `linkify` (today: the notify action's `message`), wrapping an entity
  part as `[name](url)`. A webhook body has no `linkify`, so it still renders a bare
  name with no markdown. `packages/workflows` constructs no URL — it calls the callback.
- **How a record NAMES itself in prose.** `entityText` in `runtime/resolve.ts` reads the columns
  `CatalogEntity.display` lists, best first, and falls back to the raw id only when none of them
  is readable. `display` is REQUIRED on every registry entry and comes from the hand-written
  registry at run time (`catalog.ts`, the same route as `descriptions`) — the generator never
  sees it, so adding an entity needs no catalog regeneration but does need a display column, or
  it will not compile. It mirrors `fkDisplayRegistry` in `@carbon/database`, which cannot be
  imported here: it is a runtime value and this package is bundled for the browser. Most entity
  values carry no `row` — a moment output, a created record and a foreign key all arrive as a
  bare id — so `entityText` loads one through `ctx.loader` (owner-scoped, cached per run).
  `renderPart` handles a single entity only: `rendersAsText` refuses a LIST of records as a
  template part, so one can never reach it. The synchronous `renderValue` cannot reach the
  catalog or the loader and so reads an entity off its inline row alone — it is not, and must
  not become, a second way to name a record.
- **Slack.** `renderSlackMrkdwn` in `packages/notifications/src/index.ts` re-spells the message's
  `[name](url)` as Slack's `<url|name>`, beside the `renderInlineLinks` matcher it delegates to
  and the in-app and email renditions that share it. Without it Slack shows markdown verbatim.
