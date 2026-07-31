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
  condition.ts filter.ts entity.ts lookup.ts action.ts   the five executors
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
- A node reached from two branches runs **once**. The second arrival is skipped
  in the walk; the unique constraint means a second row cannot exist anyway.

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
- `claimStep` writes the step's `input` through `redactForLog`, which drops any
  key matching `/secret|token|password|signature|authorization|apikey|api_key/i`
  and truncates strings over 4 KB. Anything new that lands in that column goes
  through it.
- A **lost claim always returns `Skipped`**, even when the existing row is
  terminal, so a replay does not reuse that row's output. Known divergence from
  the phase-4 spec, deliberately left in place.

## Batch mode

An action node with `batch: true` works through the one list among its inputs —
the same single-list rule the validator enforces. `execute.ts` resolves that list
outside the durable steps, runs `planBatch` (capped at `MAX_LIST_ITEMS`, 100),
then runs one `` `node:${nodeId}:${itemKeyFor(item)}` `` step per item, each
claiming under that item key. The action executor itself handles **one item
only**: `ctx.item` is the turn's item, and the input that resolved to a list is
replaced by it.

Afterwards one aggregate row is written under `` `node:${nodeId}` `` with
`itemKey: ""`. It succeeds if **at least one item succeeded**, and its handle is
what the walk follows. Its `statusReason` is where a dropped or failed item
becomes visible — `Ran 100 of 150; 50 were not used.` The node's outputs are a
list of each successful item's primary output, in item order. A failed item does
not stop the graph but does mark the **run** Failed, so a partial batch never
shows a customer a green tick.
