# Accounting Sync — Delivery Robustness (v4)

**Status:** implemented (2026-08-11, all phases 0–4; live-verified against the
dev stack — see `.ai/runs/2026-08-11-sync-robustness-run.md`) — authoritative
capstone for accounting-sync delivery correctness; where it conflicts with
v2/v3/document-representation, this spec wins (superseded passages are
annotated in those files). Implementation deviations recorded in the run
record: D.1 (post-route event reordering) was unnecessary — transition events
now bypass the cooldown instead; F7 absorption is covered by the sweep.
**Date:** 2026-08-11
**Builds on:** `.ai/specs/implemented/2026-07-09-accounting-sync-engine.md` (v2),
`.ai/specs/2026-08-02-accounting-sync-engine-v3.md` (v3),
`.ai/specs/implemented/2026-08-05-accounting-document-representation.md`

## Why this spec exists

A fixed-asset purchase surfaced two silent losses in one flow: the Purchase
Receipt journal (`je_9G1UYT9VXmBgMrvqtyTq5t`) never produced a sync operation
(no `journal` event subscription exists for any provider), and the fixed-asset
bill (`pi_RhnzjmMsWURrWC92Ma4ocP`) was recorded **Completed** without ever
creating a bill in Rillet (its sync drained 7s before the Purchase Invoice
journal posted; the empty replay was closed as success).

Neither is a one-off bug. A full audit of the outbound pipeline found ~24
distinct failure classes, and they share one root: **outbound sync treats event
delivery as the correctness guarantee, and the specs' own strongest invariants
(v3 I1 "total delivery", I5 "verifiable replication") have no enforcement
mechanism built.** Inbound already has the right doctrine — "webhooks are
latency, not correctness; the pull sweep is the guarantee" (v2 Phase E).
Outbound has no equivalent. This spec closes that asymmetry.

## Goal

The external accounting system knows about, and stays in sync with, everything
that happens in Carbon — **provably**. Concretely:

- Every accounting-relevant state change in Carbon reaches the provider, or
  carries an explicit, truthful, visible disposition explaining why not (v3 I1).
- No failure mode is silent: every loss either self-heals within a bounded
  window or surfaces as an actionable alert.
- Carbon can prove the replication per account per period (v3 I5 tie-out).

## Non-goals

- Changing the representation model (doc-backed bills, journal push policy,
  dimensions) — v3 and the document-representation spec own that.
- DELETE sync, tax-aware bill replay, multi-settlement payments — existing
  documented v1 limits, unchanged here.
- Auditing provider-originated entries (tie-out stays Carbon-originated-only).

## Principles

- **P1 — Events are latency, not correctness.** The event system makes sync
  fast. A state-based outbound reconciliation sweep makes it correct. Any
  lost event becomes bounded staleness (≤ sweep interval), never permanent loss.
- **P2 — Work is derived from state, not from deliveries.** "What must exist
  remotely" is a query over Carbon state + policy (posted journals, posted
  documents, master data) LEFT JOIN the op ledger + mappings. The sweep
  enqueues the diff.
- **P3 — The ledger never lies.** `Completed` means "verified represented
  remotely" (externalId/mapping present, or an explicit doc-backed/excluded
  disposition). A no-op is `Skipped` with its reason, never `Completed`.
- **P4 — No config drift.** The subscription set a provider needs is derived
  from code and converged automatically — never a write-once install artifact.
- **P5 — Everything parked has a re-drive path.** Failed, Warning, Skipped,
  cooldown-deferred, and dependency-blocked items are re-driven by time or by
  their dependency completing — never only by the next unrelated event.
- **P6 — Prove it.** Tie-out + period-close gate (v3 Phase 3) turn "we synced
  everything" from a hope into a query.

## Failure-class inventory (audit 2026-08-11, branch feat/rillet)

Grouped; full details in the audit. Evidence is file:line-verified.

| # | Class | Mechanism | Today's detection |
|---|-------|-----------|-------------------|
| F1 | No `journal` subscription, any provider | `rilletOnInstall`/`xeroOnInstall` table lists omit `journal`; `quickbooksOnInstall` creates **zero** subscriptions (QBO outbound fully event-dead) | none |
| F2 | Missing/mismatched subscription = silent non-dispatch | `dispatch_event_batch()` returns with no trace when no active subscription matches; dead-letter subscriptions exist (`address`, Xero `salesOrder` not in `TABLE_TO_ENTITY_MAP`) | none |
| F3 | False green: no-op recorded Completed | drain maps syncer `skipped` → `completeOperation`, which **clears** error fields; `externalId NULL` is the only clue | invisible (green row) |
| F4 | 60s cooldown swallows real transitions | Draft-event op completes; the post-transition event within 60s returns `{data:null}` — no row, nothing re-drives | none |
| F5 | Posting race: bill drains before its journal posts | invoice status flips (event fires) **before** the `post-purchase-invoice` edge fn inserts the journal; empty costing replay → Warning (current) or false-Completed (observed); no re-drive | Warning at best |
| F6 | Failed/Warning terminal-until-human; UI Retry only flips to Pending, nothing drains it (Xero has no periodic drain at all) | drain runs only on next event / pull-sweep (Rillet+QBO only) / manual backfill | row visible, non-progress invisible |
| F7 | Mid-flight deltas absorbed | enqueue into an already-claimed In Flight op; entity re-read never happens; no follow-up op | none |
| F8 | Event-loss at queue layer | poison message crash-loops the whole drainer; handler failure after PGMQ delete = permanent loss, no dead letter | Inngest dashboard only |
| F9 | Ledger-less skips in the sync handler | integration resolution failure, disabled entities, plan/payment decision skips, enqueue errors — event consumed, nothing persisted | Inngest logs only |
| F10 | Remote-create/link crash window | crash between provider create and `linkEntities` → re-push; payload-hash idempotency keys can mint duplicates | none |
| F11 | No outbound backstop | pull sweep is inbound; backfill is manual, Xero-hardcoded, covers master data + journal dispositions only — **bills/invoices/payments have no backfill path**; reconciliation cron presence-checks Completed journal ops only | none |
| F12 | No alerting | one buried Sync Activity tab; the worst classes produce no row or a green row there | none |
| F13 | `app.sync_in_progress` suppresses ALL handler types | sync-transaction writes emit no SEARCH/AUDIT/WEBHOOK/WORKFLOW events either | none |
| F14 | Multi-company statement truncation | batch trigger reads `companyId` from one row, filters the batch to it | none |
| F15 | Unbounded attempts / fragile drain↔syncer id contract / batch push degrades structured Warnings to Failed | misc hardening | partial |

## Architecture

### Pillar A — Converged subscriptions (kills F1, F2, prevents recurrence)

One source of truth per provider: a `REQUIRED_SUBSCRIPTIONS[providerId]` table
list in `@carbon/ee` (journal, payment, purchaseInvoice, salesInvoice, item,
customer, supplier, address, …). Three consumers:

1. Install hook: iterates the list (replaces the hand-maintained arrays).
2. **Convergence:** an idempotent `ensureProviderSubscriptions(client, companyId,
   providerId)` that upserts missing rows / deactivates extras, called from the
   install hook, the integration-settings save path, and the outbound sweep
   (Pillar B) as a self-healing invariant check. Existing installs converge at
   runtime through those same call sites — no migration-backfilled subscription
   rows. Migrations only attach table triggers (the shipped payment-trigger
   migration, `20260807152238`, is the precedent: trigger in SQL, subscription
   rows from the install hook / convergence).
3. A startup/CI assertion that every listed table is in `TABLE_TO_ENTITY_MAP`
   (or explicitly annotated why not) — no more dead-letter subscriptions.

QBO's no-op install hook gets the same treatment.

### Pillar B — Outbound reconciliation sweep (kills F4–F7, F11; bounds F8, F9)

The outbound analog of the pull sweep. A cron (reuse/extend
`accounting-pull-sweep` cadence, 30 min) that per active integration:

1. **Completeness diff (state → work).** Policy-scoped queries produce the set
   of things that must be represented remotely, LEFT JOIN ledger + mappings:
   - journals: `status IN ('Posted','Reversed')`, posting-policy push-enabled,
     `postingDate ≥ syncFromDate`, with **no terminal disposition** → enqueue.
   - documents (bill/invoice): posted, entity enabled, **no mapping with
     externalId** and no terminal Excluded row → enqueue.
   - payments: Posted/Voided per Phase G gates, same shape.
   - master data: mapping-less customers/vendors/items referenced by any of
     the above (JIT deps still handle the rest).
2. **Re-drive.** Claim Pending rows (today only Rillet/QBO get this, via the
   pull sweep; Xero gets nothing) and re-enqueue retryable Warning classes
   (`UNMAPPED_ACCOUNTS` where the backing journal **now** exists — this is
   what heals the F5 race) with capped attempts + backoff.
3. **Invariant checks.** `ensureProviderSubscriptions`; alert on PGMQ depth
   and on ops stuck Pending/In Flight beyond a threshold.

This single mechanism converts every lost-event class into ≤30-min staleness
and gives the two live incidents (`je_9G1…`, `pi_Rhnz…`) their automated
remediation — no hand-run backfills.

### Pillar C — Truthful ledger (kills F3; hardens F10, F15)

1. **`Skipped` becomes a real recorded outcome**: drain writes `Skipped` with
   the skip reason preserved — never `Completed` with cleared error fields.
   (The enum value has existed since the v2 migration, but today only the human
   Skip row-action ever sets it; the drain never writes it.) UI shows it
   neutrally (not green).
2. **Post-condition on Completed**: completing a push op asserts an
   `externalIntegrationMapping.externalId` exists for the entity (or the op is
   explicitly doc-backed/excluded). Violation → op lands `Failed
   POSTCONDITION`, alertable, instead of lying.
3. **Cooldown never drops transitions**: cooldown may coalesce, but a
   suppressed enqueue that follows a *state transition* records a Pending op
   (absorbed by the sweep) instead of returning null. Simplest form: cooldown
   only applies when an identical content-hash op just completed.
4. Stable remote idempotency keys (entity-scoped, not payload-hash) so a
   crash-retry with a changed payload cannot mint a duplicate remote doc.
5. Attempt caps (`attemptCount` bound → terminal Failed + alert), and batch
   push preserves structured `JournalEntrySyncError` → Warning (not Failed).

### Pillar D — Ordering & dependencies (kills F5 at the source, F7, payment-after-bill)

1. **Fire the document event after posting completes.** The post routes flip
   status → "Pending" (event fires) before the edge function posts the
   journal. Move the sync-relevant transition so the event the syncer acts on
   is emitted from the edge function's transaction **after** the journal
   insert (the invoice UPDATE to `status='Open'`/posted inside the edge fn is
   the natural signal). The Draft→Pending flip stays UI-only.
2. **Dependency re-drive**: when a bill/invoice op completes, re-enqueue
   parked ops that named it as their blocker (payment Warnings referencing the
   bill). Cheap version: the sweep's re-drive covers it; targeted version:
   `completeOperation` enqueues dependents.
3. Mid-flight absorption fix: enqueue against a claimed In Flight op creates a
   fresh Pending row instead of absorbing.

### Pillar E — Tie-out + period-close gate (v3 Phase 3, unbuilt)

Implement as specced in v3 §5: `accountingSyncTieOut` per account × period —
`carbonPostedAmount = synced + docBacked + excluded + pending + blocked`
(internal completeness, pure SQL) and `synced = providerAmount` (external
fidelity, provider fetch) — surfaced at `x+/accounting+/sync-tieout` with
drill-down, plus the "External GL sync complete" period-close check. This is
the detective control that proves I1/I5 rather than asserting them.

### Pillar F — Observability & alerting (kills F12; bounds F8)

1. Notifications (existing `@carbon/notifications` infra) for: op → Failed /
   Warning / POSTCONDITION, sweep-detected missing dispositions, subscription
   convergence repairs, PGMQ depth threshold, poison-message dead-letter.
2. Queue hardening: unknown `handlerType` messages go to a dead-letter table
   (not a crash loop); handler-side ultimate failures write a dead-letter row
   before the message is lost.
3. Sync Activity: badge count for non-green ops at the settings level;
   `Skipped` rendered distinctly.

### Pillar G — Scoped trigger suppression (F13, adjacent)

`withTriggersDisabled` should suppress only SYNC-handler dispatch (loop
break), not SEARCH/AUDIT/WEBHOOK/WORKFLOW. Mechanism: keep the GUC but move
the check from the top of `dispatch_event_batch()` into the SYNC-subscription
filter. Separate migration; independently shippable.

## Phasing

Each phase is independently shippable and verifiable; per-phase implementation
plans go to `.ai/plans/` after veto.

- **Phase 0 — Stop the bleeding (small, immediate).**
  Pillar A (required-subscriptions list + runtime convergence covering existing
  installs, incl. QBO hook; migrations only attach table triggers) +
  Pillar C.1/C.2 (truthful Skipped, Completed post-condition). Re-drives nothing yet, but from here on every
  loss at least leaves an honest trace.
  *Accept:* journal events dispatch for a Rillet company; a no-op push shows
  `Skipped` + reason; CI fails if a subscribed table isn't handler-mapped.
- **Phase 1 — The correctness backstop.**
  Pillar B (outbound sweep: completeness diff, re-drive, invariant checks) +
  extend backfill coverage to bills/invoices/payments for all providers.
  *Accept:* deleting an op row / suppressing an event for a posted journal or
  invoice self-heals within one sweep cycle; `je_9G1…` and `pi_Rhnz…` reach
  Rillet with no manual intervention.
- **Phase 2 — Ordering, cooldown, idempotency.**
  Pillar D + C.3/C.4/C.5.
  *Accept:* post-invoice race test (drain before journal) converges without
  the sweep; Draft→post-within-60s reaches the provider; crash between remote
  create and link does not duplicate.
- **Phase 3 — Prove it.**
  Pillar E (tie-out + close gate).
  *Accept:* v3 §5 acceptance criteria; close blocked while any period journal
  is non-terminal.
- **Phase 4 — See it.**
  Pillar F (alerting, dead-letter, badges) + Pillar G (scoped suppression).
  *Accept:* every failure class in the inventory row-maps to either a
  self-heal (Phase 1/2) or an alert (this phase); none map to "silent".

## Decisions taken (surface for veto)

1. **State-based sweep over event-delivery hardening** as the correctness
   layer (P1/P2). Hardening alone can't fix "the event was never generated".
2. **Drain-recorded `Skipped` outcomes** (reusing the existing enum value,
   today human-set only, + UI treatment) rather than overloading Completed.
   Honest ledger is a precondition for the sweep's completeness diff being
   meaningful.
3. **Post-routes stop firing the sync-relevant event pre-posting** (D.1) —
   touches the posting flow; the alternative (sweep-only healing) works but
   leaves a 30-min visible lag on every posted invoice.
4. **Tie-out is in scope** (Phase 3) — it's the enforcement of I5 and the only
   way "extremely accurate" is provable. Deferring it leaves the plan
   preventive-only.
5. **Cooldown semantics change** to content-hash dedupe (C.3) — the current
   time-based form is provably lossy.
6. Existing missed entries (`je_9G1…` journal, `pi_Rhnz…` bill, and the
   company's missing `payment`/`journal` subscriptions) are remediated by
   Phase 0+1 mechanisms, not hand-run SQL.

## Verification strategy

- Unit: policy diff queries, convergence idempotency, cooldown content-hash,
  post-condition assertion, drain status mapping (skipped→Skipped).
- Integration (local stack): kill-the-event chaos test — post an invoice with
  the subscription deactivated, assert sweep self-heals; race test per Phase 2.
- Sandbox (env-gated): duplicate-prevention on crash-retry; tie-out external
  fidelity against Rillet sandbox.
- The v3 completeness LEFT JOIN becomes a CI-runnable assertion against seed
  data.
