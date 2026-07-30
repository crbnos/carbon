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
Catalog: `workflow-event-catalog.md`.

## The two halves

```
packages/workflows/src/runtime/     pure. no I/O, no client, no database.
  values.ts    RuntimeValue + fromColumn coercion
  resolve.ts   {kind:"ref"|"item"|"literal"} -> a value, or a readable reason
  compare.ts   operator semantics + evaluateClauses
  condition.ts filter.ts            the two executors phase 4 ships
  executors.ts the node-kind -> executor registry
  batch.ts     planBatch + itemKeyFor

packages/jobs/src/workflows/engine/  everything that touches the world
  walk.ts    pure graph maths — frontier, handles, MAX_NODE_EXECUTIONS (500)
  owner.ts   getOwnerClient / readOwnerPermissions / hasPermission
  loader.ts  EntityLoader over the owner's connection + triggerOutputs
  ledger.ts  claimStep / settleStep / failInterruptedSteps  (workflowStepRun)
  log.ts     loadRunContext / claimRun / finishRun / failCrashedRun (workflowRun)
  execute.ts the orchestration: load -> permissions -> node:* -> finish
```

A node kind runs only if `EXECUTORS` in `runtime/executors.ts` has an entry for
it, and `execute.ts` takes the permission module and the work from that **same**
entry. Two lookups could drift, and the one that drifts silently is the
permission check — so phase 5 adds a kind by adding one registry line, never by
extending a `node.type` chain.

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
  trigger event's `permission` at run start, and each node's before it executes.
  RLS alone returns zero rows, which reads as "no data"; the PRD needs
  `"The owner of this workflow no longer has access to Purchasing."`
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
  `` `node:${nodeId}` ``, `"finish"`. Never a timestamp or a counter.
- `lookup`, `entity` and `action` nodes return
  `"This kind of step is not available yet."` — they arrive in phase 5. They
  cannot be activated today, so that is a defence, not a feature.
- Batch mode's machinery (`planBatch`, `itemKeyFor`) is built and tested but not
  wired into the walk: no node can batch until the action executor exists.
