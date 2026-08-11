# PR #1294 review — analysis & work order

Companion to `2026-08-10-pr-1294-workflows-review.md`. Every P0, plus the load-bearing P1/P2
claims, was independently re-verified against the working tree at HEAD `d34af6ce3` (the review
was written at `5e180ddfe`). Verdicts below are from that re-check, not from the review's own
assertions.

**Headline: the review is accurate.** 22 of 23 re-verified claims are CONFIRMED at the exact
file:line given. One (P0-5) is real but materially less severe than stated. One (P2-7) is
partly fixed already by HEAD. Two new findings surfaced during verification and are added at
the bottom.

---

## Verdict table

| Item | Verdict | Note |
|---|---|---|
| P0-1 walk ordering | CONFIRMED | BFS + visited set, no join readiness (`walk.ts:51-87`); `resolveRef` is reverse-reachability (`variables.ts:116-131`) |
| P0-2 retention pass 4 stalls | CONFIRMED (+worse) | see New-1 |
| P0-3 unbounded `Promise.all` | CONFIRMED | pool `max: 5`, `connectionTimeoutMillis: 10_000`; fan-out is per company group, still thousands of rows |
| P0-4 autosave loses edits | CONFIRMED | `rebaseline()` takes no argument at all (`store.ts:253`); `savedRef` is a bare boolean |
| P0-5 orphan subscription | **DOWNGRADE to P1** | see below |
| P0-6 no advisory lock | CONFIRMED | no `pg_advisory*` anywhere in `packages/workflows`; see refinement below |
| P0-7 Tooltip blast radius | CONFIRMED | new on branch, blamed to `bebeda2003` (a workflows variable-picker commit) |
| P1-1 missing indexes | CONFIRMED | no index leads `("companyId","createdAt")`; closest puts `workflowId` second |
| P1-2 dead indexes | CONFIRMED | `purge_idx` was superseded by `retention_idx` in the run-history migration and never dropped |
| P1-4 reap loop | CONFIRMED (minor correction) | both calls are UPDATEs, not "SELECT then UPDATE" |
| P1-5 exact count | CONFIRMED | line 225 exact; line 19 fine as stated |
| P1-7 migration no WHERE | **DOWNGRADE — but see New-2** | it is the established repo pattern |
| P1-8 unbounded steps | CONFIRMED | neighbouring `getWorkflowRunChain` caps at 50 — omission looks accidental |
| P1-9 `select("*")` | CONFIRMED | `search.ts:49` exact |
| P1-10 lock check cost | CONFIRMED (understated) | `getWorkflowVersion` pulls `nodes`+`edges` to read one `workflowId` |
| P2-1 `detail` unredacted | CONFIRMED | only one of the three payload columns written raw |
| P2-2 negative `durationMs` | CONFIRMED | durable `settleStep` is the only one of three writers without the clamp |
| P2-3 sequence collision | CONFIRMED | already half-worked-around in `WorkflowRunSteps.tsx:344-350`; display-only impact |
| P2-6 dead `actorId` | CONFIRMED | populated in `queue.ts:118`, consumed by the audit path, dropped by the workflow path |
| P2-7 SSRF gaps | **PARTLY FIXED** | DNS rebinding closed by `d34af6ce3` (`guardedLookup` + undici dispatcher). CGNAT `100.64/10`, `198.18/15` and `user:pass@` remain open |
| P2-11 canvas leaks | CONFIRMED | both new on branch; the `onWheel` half matches a documented UI rule, the `immediate: true` half has no precedent |
| P2-12 debug dump | CONFIRMED | only `console.error` in all erp routes; schema-failure path only, so volume is bounded |
| D-1 – D-4 | CONFIRMED | with one wording correction: `ensureSchedulerChain` also appears throughout `.ai/specs/` and `.ai/plans/`, not only `packages/jobs/AGENTS.md:70` |

---

## The one real downgrade — P0-5

`eventSystemSubscription` rows are **per-company-per-table, not per-workflow**
(`sync.ts:57-66`, `name = workflow-${table}`, unique on `("companyId","name","table")`).
`reconcileWorkflowSubscriptions` reads every trigger row in the company with no `workflowId`
filter. So deleting a workflow only orphans a subscription when it was the **last** workflow in
that company subscribing to that table — and the next publish or toggle of any workflow
reconciles it away.

Impact is dead event traffic (matcher finds zero trigger rows and returns), not wrong execution
and not a tenancy leak. Still worth the one-line fix, but it is not a ship blocker. **P1.**

### Refinement to P0-6

The unique constraint means the duplicate-insert interleaving fails loudly with a unique
violation and aborts the publish. The genuinely silent failure is delete-then-insert ordering
across two transactions (`sync.ts:107-113` vs `:117-131`), which can leave a table
unsubscribed. Real, needs two concurrent publishes in one company, and the advisory-lock fix
the review proposes is the right one.

### Why P1-7 drops

Two already-shipped migrations use the byte-identical no-WHERE pattern —
`20260326000000_print-manager.sql:25-31` and `20250325103806_quality-module.sql:26-32`. A
full-table rewrite is the intent: every user must receive the new keys. The only argument left
is lock duration on a large `userPermission`, which is a repo-wide question, not a PR-1294
defect. Do not fix it here.

---

## New findings from verification

### New-1 · Retention pass 4 outruns pass 3, so `compactedAt` can be null when steps vanish

Pass 3 is capped at `COMPACT_BATCH = 200` runs/night; pass 4 at `BATCH = 500`. The comment at
`workflow-run-retention.ts:178-179` asserts "Runs here already had compactedAt set in pass 3",
but nothing enforces it. Under backlog, a run's step rows get deleted with `compactedAt` still
null — and the run-detail UI uses exactly `run.compactedAt !== null` to tell "steps purged"
apart from "run has no steps yet". Fold this into the P0-2 fix; the `detailDroppedAt` marker
the review proposes resolves both.

### New-2 · The workflows migration will sort behind already-applied migrations on merge

`20260730142317_workflows-foundation.sql` is not on `origin/main`, but `origin/main` has since
advanced to `20260809211324_purchases-pivot-report.sql`. On merge, every workflows migration
timestamped `202607xx`/`202608xx` lands **before** migrations already applied in production.
Depending on the runner this is either silently skipped or applied out of order. This needs a
decision before merge and is arguably the highest-risk item on the whole list — it is not in
the review at all.

---

## Decisions taken (do not re-raise)

- **P2-4** — test runs write a real `workflowRun` row flagged `isTest`, plus step rows, recorded
  against the version open in the builder. Folded into the unshipped foundation migration.
- **P2-6** — keep the two-way origin split as built. `Person` is renamed only in the UI
  ("Everything else"); actor-level classification would confuse customers more than it helps.
  Dead `actorId` parses dropped from the two workflow handlers.
- **P2-9** — **WON'T FIX.** Last-write-wins on the shared canvas is accepted. A stale-version
  reject is not the right answer; a genuine fix is live collaborative editing over sockets,
  which is its own project.
- **P2-10** — **SKIPPED.** Synchronous delete cascade stays. Retention already caps history at
  90 days, so the row count a delete can face is bounded; revisit only if a delete times out.
- **P2-15** — batched items run in groups of `BATCH_CONCURRENCY = 5`, not one at a time. Bounded
  on purpose: unbounded fan-out is the P0-3 pool exhaustion again.
- **P3-1** — went further than proposed: `records()` AND the whole memory ledger are gone.
  The durable ledger writes every step row, so `$id.test-run.tsx` reads them back with
  `getWorkflowRunSteps` — one reader for the panel and the run-history page.
  `executeManualWorkflowRun` returns `{ runId, status, error }` and closes its own row via
  `failCrashedRun` on a throw.
- **P3-2** — `getEntityPath` and `getWorkflowRecordPath` collapsed into one table in
  `apps/erp/app/utils/entity.ts` (`getRecordPath` by entity name, `getEntityPath` by id prefix).
  `getItemDetailPath` is **not** merged: it maps an item's *type* to one of five item routes,
  which is a different question. The review was wrong to group it.
- **P3-3** — **CANNOT BE WIRED AS REVIEWED.** `workflow-events` needs a live Postgres connection,
  and no CI job has database credentials; it is also **not** interchangeable with
  `workflow-trigger-event-drift.sql`, which asks a different question. Both are operational
  scripts. `packages/checks/AGENTS.md` corrected — it wrongly claimed the SQL invariant ran in CI.
  Open decision: give the deploy workflow a connection string, or accept manual runs.
- **P3-5** — **LEAVE AS IS.** Live step updates stay; the run-detail page depends on them and the
  cost needs production traffic to measure.

## Suggested order of work

1. **New-2** — resolve the migration-ordering question first; it gates the merge itself.
2. **P0-4** — data loss the user can see. Cheapest high-value fix: `rebaseline(submitted)`.
3. **P0-1** — pick (a) engine in-degree or (b) validator dominance. Product call needed; (b)
   ships sooner but narrows what customers can wire.
4. **P0-2 + New-1 + P0-3 + P1-6** — one retention pass fixes all four together.
5. **P0-7 + P2-11** — revert the three shared-component leaks, re-fix inside the canvas.
6. **P0-6** — one-line advisory lock.
7. **P1-1 / P1-2** — one migration, indexes in and out.
8. Everything else in listed priority. **Skip P1-7.** **P2-7 is now three items, not four.**

Every fix needs a test that fails before and passes after — the review's baseline note is
correct, none of these are covered by the existing 641 tests.
