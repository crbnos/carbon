# Run record — accounting sync delivery robustness (v4)

Spec: `.ai/specs/implemented/2026-08-11-accounting-sync-delivery-robustness.md` (approved 2026-08-11)
Branch: `feat/rillet` — all work uncommitted, verification per phase below.

## Phase 0 — converged subscriptions + truthful ledger ✅ (code-verified)

- `packages/ee/src/accounting/core/subscriptions.ts` (NEW): `REQUIRED_SYNC_SUBSCRIPTIONS`
  per provider (journal everywhere; payment Rillet-only; address dropped as a dead
  letter) + idempotent `ensureProviderSubscriptions` convergence (create RPC upserts;
  extras deleted). Exported via the accounting barrel.
- Install hooks rewritten to convergence: rillet/xero/quickbooks `hooks.server.ts`
  (QBO's no-op install hook was stale — its syncers shipped); `quickbooksOnUninstall`
  added. New `onUpdate` hook (`packages/ee/src/types.ts`, registry in
  `packages/ee/src/hooks.server.ts`) re-converges on every settings save of an
  installed integration; wired in `apps/erp/app/routes/x+/settings+/integrations.$id.tsx`.
- Truthful ledger: `skipOperation` in `core/operations.ts`; drain closes via new
  `getSyncOperationCloseDecision` (skip+remoteId→Completed; skip w/o→Skipped w/ reason;
  push success w/o remoteId→Failed POSTCONDITION). `Skipped→Pending` transition allowed
  (guard table + operations.test + SyncActivity retry).
- Invariant test `packages/jobs/.../events/subscriptions-mapping.test.ts`: every
  subscribed table ↔ `TABLE_TO_ENTITY_MAP` (moved to import-light `sync-tables.ts`,
  `salesOrder` mapping added — was a dead Xero subscription) ↔ registered syncer.

## Phase 1 — outbound reconciliation sweep ✅ (code-verified; live-heal pending)

- `packages/jobs/.../integrations/accounting-outbound-sweep.ts` (NEW), cron
  `15,45 * * * *` (offset from pull sweep), registered in both indexes. Per active
  integration: subscription convergence → journal completeness diff (I1, same policy
  routing as backfill, 7-day `SWEEP_LOOKBACK_DAYS` window raised by syncFromDate) →
  bill/invoice diff (`shouldEnqueueMissingDocument`: no mapping + no live op + latest
  null/Completed; parked statuses excluded) → payment diff (Rillet, no-op-rows only) →
  re-drive Warning UNMAPPED_ACCOUNTS bills whose posted PI journal now exists
  (`MAX_REDRIVE_ATTEMPTS = 5`) → drain (gives Xero its first periodic drain).
- Pure helpers + tests live in `accounting-sync-operations.ts/.test.ts`.
- **Pending (needs running stack)**: observe the sweep heal `je_9G1UYT9VXmBgMrvqtyTq5t`
  and `pi_RhnzjmMsWURrWC92Ma4ocP` (company `d9oi7og780h02mltro10`), which also
  backfills that company's missing journal/payment subscriptions via convergence.

## Phase 2 — ordering, cooldown, idempotency ✅ (code-verified)

- Status transitions bypass the cooldown: `isStatusTransitionEvent` routes generic
  UPDATE transitions onto the non-cooldown "posting" trigger in `events/sync.ts`.
  **Spec deviation (D.1)**: post-route event emission NOT moved — evidence showed the
  post edge fn already emits the invoice's Pending→Open UPDATE after the journal
  insert; the loss was the false-Completed cooldown swallowing it. Truthful ledger +
  transition bypass + sweep close F5 without touching the posting flow.
- Rillet idempotency keys entity-scoped (payload no longer hashed) —
  `buildRilletIdempotencyKey` + 8 call sites; provider.test updated to pin the new
  contract (payload drift must NOT mint a fresh key).
- `MAX_SYNC_OPERATION_ATTEMPTS = 10` cap in the drain → `ATTEMPTS_EXHAUSTED` Failed.
- Batch/single push preserves structured `JournalEntrySyncError` failures
  (`toSyncResultError` in `core/types.ts`) so Warnings stay Warnings with metadata.
- **Deferred to sweep coverage (F7)**: mid-flight absorption unchanged — the partial
  unique live index forbids a second live row; the sweep re-diffs within 30 min.

## Verification (all green as of this run)

- `pnpm --filter @carbon/ee test` → 530 passed
- `pnpm --filter @carbon/jobs test` → 431 passed
- `turbo typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp` → clean
- `pnpm run lint` → clean

## Phase 3 — tie-out + period-close gate ✅ (live-verified 2026-08-11)

- Migration `20260811223145_accounting-sync-tieout.sql`: `accountingSyncTieOut` table
  (single-col FK to accountingPeriod — its PK is `(id)`, the v3 spec's composite FK was
  invalid), RLS SELECT accounting_view, cell-unique upsert index; + idempotent reconcile
  of the 'External GL sync complete' periodCloseTaskDefinition (Auto/'external-gl-sync'/
  Blocker) for existing companies; seed.data.ts entry for new companies.
- `accounting-reconciliation.ts` rewritten: provider-agnostic (all three providers, was
  Xero-only) via new `core/remote-journal.ts` `fetchRemoteJournalTotals` (per-provider
  debit-signed line sums); presence check kept; monthly-aggregate check replaced by
  per-period × per-account tie-out cells (dispositions bucketed least-delivered-first;
  DOC_BACKED delivered only while the backing document is Completed/mapped; provider
  sums strictly reuse presence fetches).
- ERP: `x+/accounting+/sync-tieout.tsx` + `$cellId` drawer drill-down, SyncTieOutTable,
  nav item (Reports), path helpers; `getPeriodExternalGlSyncReadiness` wired into
  `computePeriodReadiness` as the 'external-gl-sync' Blocker auto-check; SyncActivity
  tie-out summary card + Failed/Warning count badge on the Sync Activity tab.

## Phase 4 — alerting, dead-letter, scoped suppression ✅ (live-verified 2026-08-11)

- Migration `20260811224732_scoped-sync-trigger-suppression.sql`: dispatch_event_batch
  now suppresses only SYNC/WEBHOOK/WORKFLOW during sync writes (loop/echo-prone);
  SEARCH/AUDIT/EMBEDDING observers see sync-written rows (F13).
- Queue drainer: unknown-handlerType messages archive to pgmq's dead-letter
  (`pgmq.a_event_system`) instead of crash-looping the whole drain (F8).
- `NotificationEvent.IntegrationSync`: the outbound sweep notifies the integration's
  configurer (in-app) when a drain fails ops; Topbar rendering links to the
  integration's settings page.

## Live verification (dev stack, company d9oi7og780h02mltro10, 2026-08-11 evening)

The 22:45 sweep cron self-healed the original incident with zero manual intervention:
- Subscriptions converged: `journal` + `payment` added, dead `address` removed.
- `je_9G1…` (fixed-asset Purchase Receipt journal): discovered, enqueued, drained →
  **Warning UNMAPPED_ACCOUNTS** with an actionable message (the Machinery & Equipment
  account has no Rillet mapping — user maps it, retries, done). Silence → visibility.
- `pi_Rhnz…` (phantom-Completed fixed-asset bill): re-detected via the
  Completed-no-mapping signature, re-pushed → **Completed, Rillet external id
  `019ff3db-f318-72ce-bd69-886764cfdaa1`** — the bill now exists in the Rillet sandbox.
- 3 more journals pushed Completed; 5 recorded Excluded DOC_BACKED (spec I1 total).
- The 23:15 sweep enqueued nothing — the diff is convergent.
- Payment push surfaced a REAL latent bug (`.slice` on a pg-driver Date) — fixed via
  `toPostingDateString`; retry then reached Rillet and got a genuine provider response
  (400 Constraint Violation on create bill payment — the VERIFY-flagged endpoint, see
  Follow-ups). The failure fired the **integrationSync in-app notification** ✅.
- Tie-out (invoked via Inngest): 5 cells, **internalDelta = 0 on every cell**,
  **externalDelta = 0** on both provider-fetched cells — I1 + I5 hold live.
- Migrations applied + `generate:types` regenerated (via crbn migrate); full suite
  green after regen: ee 537 + jobs 458 tests, 4 typechecks, lint.

## Follow-ups

- Rillet `create bill payment` returns 400 Constraint Violation (sandbox) — the
  Phase G VERIFY gate; needs payload/endpoint verification against Rillet support docs.
- Map the Machinery & Equipment (and any other asset) account in the Rillet account
  mapping, then Retry the je_9G1 Warning op.
- Consider a Rillet field-mapping for `journalEntry` on the tie-out drill-down (nice-to-have).

## Pre-commit TODO

- Update `.claude/rules/accounting-sync-handlers.md` (+ `packages/ee/AGENTS.md`,
  `packages/jobs/AGENTS.md`) for: subscriptions convergence, Skipped semantics,
  outbound sweep, idempotency-key contract — same PR as the code, per
  keep-sources-in-sync.

## v5 — reconciler unification ✅ (2026-08-12, spec Steps A–D)

Spec: `.ai/specs/2026-08-12-accounting-sync-reconciler-unification.md` (implemented).

- **Step A** — `reconcile-golden.test.ts`: 26-scenario golden matrix pinning the
  legacy→state-shaped translation; FIX-1..4 document every deliberate difference
  (no Draft/mid-posting churn; changed-since-failure retry; updatedAt-vs-
  lastSyncedAt replaces the cooldown; no void-echo enqueue).
- **Step B** — `reconcile.ts` (pure `computeReconcileDecision`; journal policy via
  the extracted shared `planJournalPostingFromState`) + `reconcile-executor.ts`
  (batch-first `reconcileEntities`, one query per concern per type, trigger
  `"reconcile"` — migration `20260812093418` widened the CHECK); the outbound
  sweep now pages candidate refs and delegates every decision.
- **Step C** — `events/sync.ts` is a hint dispatcher: table→ref→`reconcileEntities`
  →drain. No per-table branches, no cooldown on this path, no transition routing.
- **Step D** — deleted `isStatusTransitionEvent` + `getPaymentPushDecision` (+ 11
  legacy tests, superseded by the golden matrix); rule + jobs AGENTS.md updated;
  spec changelog records the two deviations (cooldown survives ONLY on the
  inbound/webhook entry points; changed-since-failure document retry).
- Verification: jobs 473 + ee 537 tests, typecheck jobs/ee/erp clean, migration
  applied to the dev DB (CHECK includes 'reconcile').
