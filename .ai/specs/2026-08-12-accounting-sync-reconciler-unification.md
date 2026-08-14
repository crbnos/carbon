# Accounting Sync — Reconciler Unification (v5)

**Status:** implemented (2026-08-12, Steps A–D) — see the changelog at the
bottom for the two implementation deviations.
**Date:** 2026-08-12
**Builds on:** the v4 delivery-robustness work (implemented, live-verified; its spec was
removed 2026-08-13 — the behavior now lives in `.claude/rules/accounting-sync-handlers.md`
and git). AR/AP document representation:
`.ai/specs/implemented/2026-08-05-accounting-document-representation.md`. The AR/AP
journal-families mode (formerly v3 Phase 4) is now owned by
`.ai/plans/2026-08-13-accounting-sync-automated-postings-only.md`.

## Why this spec exists

v4 made outbound sync correct, truthful, and provable. It did so by hardening
**two independent decision systems** that must always agree:

1. **The event path** — per-table enqueue decision trees
   (`planJournalPostingOperation`, `getPaymentPushDecision`, the generic
   INSERT/UPDATE rule), cooldown semantics (`SYNC_OPERATION_COOLDOWN_MS`,
   `isCooldownTrigger`), the transition bypass (`isStatusTransitionEvent` →
   `posting` trigger), live-row absorption rules.
2. **The sweep** — its own diff rules (`shouldEnqueueMissingDocument`,
   `getSweepFloorDate` windows, journal-coverage checks, the capped
   `UNMAPPED_ACCOUNTS` re-drive).

Every v4 failure class was, at root, a gap or disagreement between those two
brains, and every v4 fix added another rule to keep them agreeing. The
agreement is enforced today by care and tests, not by construction. Adding
entity #12 or provider #4 means wiring both paths correctly; a future change
can break the agreement without any single test noticing.

**The unification:** adopt the level-triggered controller model (the
Kubernetes lesson). One idempotent reconcile decision — *"what should exist
remotely for this entity, does it, act once"* — computed by ONE pure function.
Events stop carrying decisions and become wake-up hints ("reconcile this
entity now"); the sweep becomes "reconcile everything in the window"; a UI
retry becomes "reconcile this entity now". The cooldown, transition
detection, absorption semantics, and phantom-repair rules stop being code and
become emergent properties of an idempotent reconcile.

This is a **refactor of transport, not behavior**: the posting policy,
document representation, dimensions, tie-out, and every I1–I5 invariant are
unchanged. The 995-test suite v4 left behind is the safety net that makes it
feasible.

## Goal

- One decision function; the event path, the sweep, backfill, and UI retry
  are four callers of it.
- Net deletion of special-case code (cooldown branching, per-table enqueue
  trees, transition routing, sweep-only diff rules).
- Adding an entity type or provider requires implementing "desired remote
  state" + "push it" — correctness comes from the loop, not from each path.

## Non-goals

- No change to POSTING_POLICY, doc-backed representation, families modes
  (v3 Phase 4 stays parked), dimensions, tie-out, or the close gate.
- No change to the `accountingSyncOperation` ledger schema — it remains the
  durable journal of reconcile outcomes and the UI surface.
- No change to inbound sync (pull sweep/webhooks) — already single-brained.
- No latency regression: event-triggered reconciles still land in seconds.

## Design

### D1 — The pure decision core

```
computeReconcileDecision(input: {
  entityType, entityId,
  entitySnapshot,        // status/postingDate/sourceType… (per-type shape)
  mapping,               // externalIntegrationMapping row | null
  latestOperation,       // newest ledger op for the tuple | null
  liveOperation,         // Pending/In Flight op | null
  policy, syncConfig,    // POSTING_POLICY + resolved entity config
}): ReconcileDecision
```

`ReconcileDecision` = `enqueue-push` | `record-terminal (Excluded/Warning +
code)` | `re-drive (existing op → Pending)` | `nothing (+ reason)`.

Pure, import-light, exhaustively unit-tested. It subsumes, in one place:
`planJournalPostingOperation`'s policy routing, `getPaymentPushDecision`'s
transition gate (recast as state: "Posted payment with no op"), the generic
push rule, `shouldEnqueueMissingDocument`, and the re-drive conditions.
The v4 rules become table rows in ONE function instead of guards in five
files.

### D2 — The executor

`reconcileEntity(ctx, ref)` loads the inputs (one snapshot query per type —
the loaders already exist across the sweep/backfill), calls the decision,
and applies it through the EXISTING ledger primitives (`enqueueSyncOperation`
with a new trigger `"reconcile"`, `insertTerminalSyncOperation`,
`transitionOperation`). Draining stays batched and unchanged — reconcile
decides *whether* work exists; the drain still executes it in grouped syncer
batches with the truthful close.

### D3 — Events become hints

`events/sync.ts` shrinks to: map table→entityType (`sync-tables.ts`,
unchanged), collect distinct `(entityType, entityId)` refs from the batch,
call `reconcileEntity` for each, drain. Deleted outright:

- the cooldown decision at enqueue time (`shouldSkipForCooldown` and the
  `isCooldownTrigger` split) — burst coalescing is already provided by
  live-row absorption + the event batch's distinct-refs dedupe; a
  just-Completed entity reconciles to `nothing` because state says so,
  and a *changed* entity reconciles to `enqueue` — the F4 class becomes
  unrepresentable instead of specially handled;
- `isStatusTransitionEvent` routing (no cooldown to bypass);
- the journal/payment special-case branches (their logic lives in D1).

### D4 — The sweep becomes a window walk

`accounting-outbound-sweep.ts` keeps its orchestration (subscription
convergence, window paging, end drain, notification) but its per-entity
logic becomes "call `reconcileEntity`". `shouldEnqueueMissingDocument`,
the journal coverage check, and the re-drive block all fold into D1.
`getSweepFloorDate`/`SWEEP_LOOKBACK_DAYS` remain (they scope the walk, not
the decision).

### D5 — What is explicitly kept

- The ledger + truthful close (`getSyncOperationCloseDecision`) — reconcile
  decides intake; close stays the outcome recorder.
- Consolidation hold (daily-summary journal ops for the cron).
- `MAX_SYNC_OPERATION_ATTEMPTS`, `MAX_REDRIVE_ATTEMPTS` (inputs to D1).
- Idempotency keys, entity-scoped Rillet Idempotency-Key, JIT
  `ensureDependencySynced`.

## Migration plan (each step independently shippable, tests green throughout)

- **Step A — Golden decisions.** Before touching anything, capture the
  CURRENT behavior as a golden test matrix: for a grid of (entity state ×
  ledger state × mapping state × config), record what today's event path and
  sweep each decide. This pins parity and is the refactor's contract.
- **Step B — Extract D1.** Implement `computeReconcileDecision` against the
  golden matrix. The sweep adopts it first (lower blast radius; the sweep
  already runs after the event path and is convergent by design).
- **Step C — Event path adopts it.** `events/sync.ts` delegates; delete the
  per-table branches and cooldown/transition special-casing. The `posting`
  vs `event` trigger distinction collapses into `reconcile`.
- **Step D — Delete dead code + docs.** Remove the superseded helpers, their
  tests migrate to D1's suite; update `accounting-sync-handlers.md` and both
  AGENTS.md files in the same PR.

## Companion quick wins (separate work items, not gated on the refactor)

1. **Nightly provider contract tests (env-gated).** Rillet publishes no
   OpenAPI; several endpoints were built from inference, and the
   `payment_date`→`date` 400 proved the risk class. A small vitest suite
   (skipped unless `RILLET_SANDBOX_API_KEY` is set) that creates and reads
   back each document type against the sandbox nightly, asserting shapes,
   catches provider drift before customers' books do.
2. **One sync-lag number.** Per integration: age of the oldest
   Posted/posted-document entry with no terminal disposition. Surface it on
   the integration card and the Sync Activity tab; alert past a threshold
   (reuse `NotificationEvent.IntegrationSync`). The tie-out proves
   correctness after the fact; this says *right now* whether the engine is
   keeping up.

## Decisions taken (surface for veto)

1. **Level-triggered core with events as hints** — vs. keeping two hardened
   paths. Rationale: every v4 failure class was a two-brain disagreement;
   one brain makes the class unrepresentable and shrinks the code.
2. **Delete the completed-row cooldown outright** (D3) rather than porting
   it — an idempotent reconcile makes it redundant; live-row absorption and
   batch dedupe already bound provider-call volume.
3. **Golden-matrix parity testing before refactor** (Step A) — the refactor
   ships only behind proof that decisions are unchanged (modulo classes we
   deliberately fix, each called out in the matrix).
4. **Drain stays batched** — reconcile is per-entity, execution is batched;
   we do not trade away syncer batch efficiency.
5. **New trigger value `"reconcile"`** on ledger rows (additive enum-free —
   `trigger` is a zod enum in code; widen it) so provenance stays visible in
   Sync Activity.

## Verification

- Step A golden matrix green before and after each step.
- Full existing suites (ee 537 / jobs 458 at time of writing) stay green.
- Chaos check on the dev stack: drop a subscription, post an invoice, kill
  an event mid-flight — assert convergence within one sweep, as v4's run
  record demonstrated (`.ai/runs/2026-08-11-sync-robustness-run.md`).
- Latency check: event→remote push still completes in seconds on the dev
  stack.

## Changelog

- **2026-08-12 — implemented (Steps A–D).** `reconcile.ts` (decision core) +
  `reconcile-executor.ts` (batch executor) + `reconcile-golden.test.ts` (26
  scenarios incl. FIX-1..4); the sweep and `events/sync.ts` both delegate;
  `isStatusTransitionEvent` and `getPaymentPushDecision` deleted; journal
  policy extracted to the shared `planJournalPostingFromState`; trigger
  `"reconcile"` added (migration `20260812093418`). Deviations from the
  draft:
  1. **D3/Decision 2 (cooldown):** deleted from the outbound path as
     specced (reconcile is never cooldown-gated), but the completed-row
     cooldown REMAINS on the inbound/webhook entry points
     (`sync-external-accounting`, pull-sweep enqueues) — inbound is a
     non-goal here and doesn't route through the reconciler.
  2. **D1 refinement:** a parked Failed/Warning document re-enqueues when
     the row changed after the failure (`updatedAt > op.createdAt`) —
     preserves the event path's fix-the-data-and-save retry without its
     retry-on-any-touch churn (golden FIX-2).
