---
paths:
  - "packages/jobs/src/inngest/functions/integrations/**"
  - "packages/jobs/src/inngest/functions/events/sync.ts"
  - "packages/jobs/src/inngest/functions/events/sync-tables.ts"
  - "packages/ee/src/accounting/**"
---

# Accounting Sync Handlers

Syncs Carbon entities <-> external accounting providers. **Three live providers**: Xero (`ProviderID.XERO`), QuickBooks Online (`ProviderID.QBO`), and Rillet (`ProviderID.RILLET`). (QuickBooks *Desktop* shipped then was removed 2026-08-01; Sage was never built.) `SyncFactory` is a **provider-keyed registry** (`registries[providerId][entityType]`) — each provider's `index.ts` barrel calls `SyncFactory.register(...)`. Runs on **Inngest** (the old trigger.dev `from-/to-accounting-sync` task design is gone — do not look for `UPSERT_MAP`/`DELETE_MAP` or a `trigger/` dir; neither exists).

Design specs: `.ai/specs/2026-08-12-accounting-sync-reconciler-unification.md` (v5 — ONE state-shaped decision core; events are hints; the authoritative design of record) and `.ai/specs/implemented/2026-08-05-accounting-document-representation.md` (AR/AP documents replay their posting journal; provider items non-tracked). The superseded v2/v3/v4 specs (engine + ledger + pull sweep + Phase F/G payment sync-back; journal policy/dimensions/tie-out; delivery robustness — converged subscriptions, truthful ledger, outbound sweep, tie-out enforcement) were removed 2026-08-13 — their shipped behavior is documented in THIS rule; their history is in git. **Always-on (implemented 2026-08-13, plan `.ai/plans/2026-08-13-accounting-sync-automated-postings-only.md` Tasks 1–6+8):** posting sync mirrors Carbon's automated GL postings whenever an accounting integration is connected — no master `postingSync.enabled` toggle, no per-source-type on/off, no `journalEntry` entity gate (defaulted on in `DEFAULT_SYNC_CONFIG` and forced on in every `build*SyncConfig`). `Manual` journals NEVER sync (`POSTING_POLICY.Manual.syncable: false` → permanent `MANUAL_DISABLED`). Legacy `enabled` fields stay in the stored schema for parse-compat but are never read; per-type granularity (individual vs daily-summary) remains the only per-type setting. Plan Tasks 7 (reversal/void propagation audit) and 9 (lock AR/AP families to documents) remain open.

## Architecture: class-per-entity syncers, not a handler map

The sync engine lives in `packages/ee/src/accounting/` (package `@carbon/ee/accounting`):
- `core/sync.ts` — `SyncFactory.getSyncer(context)` returns the right syncer by `providerId` + `entityType` from the registry.
- `core/types.ts` — `BaseEntitySyncer<TLocal, TRemote, TOmit>` abstract base (~800 lines). Implements `pushToAccounting` / `pullFromAccounting` (+ `*Batch*`) with: mapping lookup, `shouldSync` gate, fast-bailout on unchanged timestamps, `mapToRemote`/`mapToLocal`, then `withTriggersDisabled` DB write + `linkEntities`. Also `SupportsIncrementalPull` (`listChanges({since}) → ProviderChange[]`) — the pull-sweep contract (QBO CDC, Rillet `updated.gt`, Xero `/Payments` `If-Modified-Since`).
- `providers/{xero,quickbooks-online,rillet}/entities/*.ts` — concrete syncers. Xero `ContactSyncer` backs both `customer` AND `vendor`; QBO/Rillet have separate Customer + Vendor syncers. Each provider has item/bill/invoice(+PO/journalEntry) syncers and a **`PaymentSyncer`** (see Payment sync-back below). `employee` is not implemented.
- `core/external-mapping.ts` — `ExternalIntegrationMappingService` / `createMappingService(db, companyId)`: all ID linking goes through the `externalIntegrationMapping` table.
- `core/models.ts` — Zod schemas, `ProviderID`, `AccountingSyncSchema`, `ENTITY_DEFINITIONS`, `DEFAULT_SYNC_CONFIG`, `PostingSyncSettings` (`families.ar`/`families.ap` = `documents|journals|none`).
- `core/service.ts` — `getAccountingIntegration()` (reads `companyIntegration` row) + `getProviderIntegration()` (instantiates the right provider; applies the merged per-company `syncConfig`).

## Entity types & directions

`AccountingEntityType` = `customer | vendor | item | employee | purchaseOrder | bill | salesOrder | invoice | payment | inventoryAdjustment | journalEntry`. `payment` is `dependsOn: ['invoice','bill']` and **two-way** (Phase G): provider-recorded payments pull back (Phase F) and Carbon-born Posted payments push out as provider payment documents. Routing is per-record by origin (the `payment` mapping), not a static direction — see Payment sync-back.

`SyncDirection` = `"two-way" | "push-to-accounting" | "pull-from-accounting"` (NOT the old `from-/to-/bi-directional`). Each entity has an `EntityConfig { enabled, direction, owner: "carbon" | "accounting", syncFromDate? }`. Per-entity defaults live in `DEFAULT_SYNC_CONFIG`, deep-merged with the company's stored `syncConfig`; providers then force an entity's config in their `build{Xero,Qbo,Rillet}SyncConfig`. **Carbon owns everything** is the standardized stance: every provider forces the master + document entities `customer`/`vendor`/`item`/`invoice`/`bill` to `push-to-accounting` / `owner: "carbon"` (`XERO_CARBON_OWNED_ENTITIES`, `QBO_CARBON_OWNED_ENTITIES`, Rillet's `RILLET_PUSH_ONLY_ENTITIES`) — the provider is a downstream mirror. `payment` is the one accounting-owned exception (forced `pull-from-accounting` / `owner: "accounting"`; Rillet two-way for Phase G push-back). There is **no** per-entity "Source of Truth" setting — it was removed; `owner` is provider-forced, not user-configurable. `owner` decides the winner on conflict: for a Carbon-owned entity, an inbound provider change to an already-linked record is skipped (`BaseEntitySyncer.pullBatchFromAccounting`, `core/types.ts`). Note the webhook path sends an explicit `pull-from-accounting` that overrides `direction`, so a net-new record created directly in the provider can still be ingested — `owner: "carbon"` only guards *linked* records; QBO's CDC pull-sweep (`listChanges`) does honor `direction` and skips push-only entities entirely.

## Inngest functions (entry points)

These live in `packages/jobs/src/inngest/functions/integrations/` (+ `events/sync.ts`), exported via that dir's `index.ts`, and registered in `packages/jobs/src/inngest/index.ts`. Event-name <-> trigger-key map: `packages/lib/src/trigger.ts` & `packages/lib/src/events.ts`. Fire with `trigger("<key>", payload)`.

| Inngest id | event | file | trigger key / fired from |
|---|---|---|---|
| `sync-external-accounting` | `carbon/sync-external-accounting` | `sync-external-accounting.ts` | `sync-external-accounting`; fired by the inbound webhooks — `webhook.xero.ts`, `webhook.rillet.$companyId.ts`, `webhook.quickbooks.$companyId.ts` |
| `accounting-pull-sweep` | — | `accounting-pull-sweep.ts` | cron `*/30 * * * *`; iterates every active integration that implements `SupportsIncrementalPull` (`listChanges`) — the **INBOUND correctness guarantee** behind the webhooks (webhooks are latency, not correctness) |
| `accounting-outbound-sweep` | — | `accounting-outbound-sweep.ts` | cron `15,45 * * * *` (offset from the pull sweep) — the **OUTBOUND correctness guarantee** (v4 Pillar B); see the sweep section below |
| `accounting-backfill` | `carbon/accounting-backfill` | `accounting-backfill.ts` | `accounting-backfill` |
| `accounting-consolidation` | — | `accounting-consolidation.ts` | cron `0 2 * * *`; pushes one aggregated provider journal per posting date for daily-consolidation configs (drains hold those journal ops for it) |
| `accounting-reconciliation` | — | `accounting-reconciliation.ts` | cron `0 3 * * 1` (Mondays 03:00 UTC) — presence drift check + `accountingSyncTieOut` writer; see the tie-out section below |
| `event-handler-sync` | `carbon/event-sync` | `events/sync.ts` | the SYNC event-system handler (see event-system.md) — DB writes -> push to the provider |

### The operation ledger — enqueue, cooldown, truthful close

Every entry point routes through the durable **`accountingSyncOperation`** ledger (`accounting-sync-operations.ts` in jobs + `core/operations.ts` in ee) between enqueue and `SyncFactory.getSyncer(...).pushBatch/pullBatch`:

- **Enqueue.** `enqueueSyncOperations` absorbs re-triggers into the live (Pending/In Flight) row. The v5 reconcile path enqueues with trigger `"reconcile"`, which is **never cooldown-gated** — a state-derived decision is idempotent, so an unchanged entity decides `nothing` instead of needing a window, and a changed one enqueues immediately. The 60s completed-row cooldown (`SYNC_OPERATION_COOLDOWN_MS`, `isCooldownTrigger`: `event`/`webhook`) survives ONLY on the inbound/webhook entry points (`sync-external-accounting`, the pull sweep), which don't route through the reconciler. `isStatusTransitionEvent` and `getPaymentPushDecision` were deleted with v5 (nothing to bypass; payment state lives in the decision core).
- **Drain.** `drainSyncOperations` claims Pending (+ stale In Flight) rows in groups of (entityType, direction); an op claimed more than `MAX_SYNC_OPERATION_ATTEMPTS` (10) times parks as `Failed` `ATTEMPTS_EXHAUSTED` instead of running again (a human Retry resets the loop deliberately).
- **Truthful close (v4 Pillar C).** `getSyncOperationCloseDecision` decides how a claimed op closes: syncer `skipped` WITH a `remoteId` (fast-bailout, already linked) → `Completed` stamping that externalId; `skipped` WITHOUT one (shouldSync gate, disabled entity, parked payment) → `Skipped` via `skipOperation` (reason in `errorMessage`, `errorCode` null so the UI renders it neutrally); push `success` WITHOUT a `remoteId` → `Failed` `POSTCONDITION` (a push success must produce an external id/mapping — recording it green is the phantom-success bug). A no-op is never recorded `Completed`. `Skipped → Pending` is an allowed transition (`SYNC_OPERATION_ALLOWED_TRANSITIONS`, `core/models.ts` — Retry covers the drain's machine no-op closes too). Batch AND single pushes preserve structured `JournalEntrySyncError` failures via `toSyncResultError` (`core/types.ts`), so e.g. `UNMAPPED_ACCOUNTS` lands as a Warning with metadata instead of a flattened Failed string.

`sync-external-accounting.ts` flow: parse `AccountingSyncSchema` → `getAccountingIntegration` → `getProviderIntegration` → enqueue one ledger op per entity + direction (trigger: `webhook` syncs keep `"webhook"`, scheduled/trigger syncs enqueue as `"event"`; both respect the completed-row cooldown) → drain. Returns `{ success, enqueue, drain }` summaries.

`events/sync.ts` (v5) treats events as **hints, not decisions**: it maps DB table → entity type via `TABLE_TO_ENTITY_MAP` in **`events/sync-tables.ts`** (import-light on purpose — no Inngest/env boot — so the subscriptions invariant test can import it): `customer→customer`, `supplier→vendor`, `item→item`, `purchaseOrder→purchaseOrder`, `purchaseInvoice→bill`, `salesInvoice→invoice`, `salesOrder→salesOrder`, `journal→journalEntry`, `payment→payment`; dedupes the batch into `(entityType, entityId)` refs (DELETEs logged/skipped — a deleted row also reconciles to nothing), and calls the same `reconcileEntities` executor the outbound sweep uses, then drains. There are no per-table decision branches here anymore — what happens is decided by `computeReconcileDecision` from CURRENT state, never from the event's old/new delta. Wrapped in `step.run` per company+provider for checkpointing.

## Event subscriptions — code-derived, converged (v4 Pillar A)

`packages/ee/src/accounting/core/subscriptions.ts` (exported from the `./accounting` barrel) is the single source of truth for the SYNC event-system subscriptions each provider's outbound sync needs: `REQUIRED_SYNC_SUBSCRIPTIONS[providerId]` + the idempotent `ensureProviderSubscriptions(client, companyId, providerId)` (the create RPC upserts on `(companyId, name, table)`; rows for tables no longer required are deleted). Subscription name: `${providerId}-sync` (`getSyncSubscriptionName`).

- **Converged from three call sites** — the install hook, the `onUpdate` hook (every settings save of an installed integration), and the outbound sweep — so existing installs self-heal at runtime. **No migration ever backfills subscription rows**; migrations only attach table triggers (`20260807152238_payment-event-trigger.sql` is the precedent).
- **The set**: every provider gets `customer`/`supplier`/`item`/`salesInvoice`/`purchaseInvoice` (INSERT/UPDATE/DELETE) + `journal` (INSERT/UPDATE only — journals are immutable once posted and DELETE sync doesn't exist). all three providers add `payment` (INSERT/UPDATE — Phase G outbound push, now Rillet/Xero/QBO); Xero adds `purchaseOrder` + `salesOrder`; QBO adds `purchaseOrder` only. **`address` is deliberately absent everywhere** — address edits reach sync via the parent-row `updatedAt` bump interceptor; a direct address subscription is a dead letter.
- Provider hooks (`packages/ee/src/{rillet,xero,quickbooks}/hooks.server.ts`) are thin wrappers over the convergence. The QBO install hook is **no longer a no-op** (its syncers shipped), and `quickbooksOnUninstall` exists. `onUpdate` is a new `IntegrationServerHooks` member (`packages/ee/src/types.ts`; registry `packages/ee/src/hooks.server.ts`; wired in `apps/erp/app/routes/x+/settings+/integrations.$id.tsx`).
- **Invariant test**: `packages/jobs/src/inngest/functions/events/subscriptions-mapping.test.ts` pins every subscribed table ↔ a `TABLE_TO_ENTITY_MAP` entry (`events/sync-tables.ts`) ↔ a registered syncer for that provider — a subscription that routes nowhere fails CI. (`salesOrder` got its map entry as part of this; it was a dead Xero subscription before.)

## Outbound reconciliation sweep (v4 Pillar B)

Doctrine, mirroring the inbound pull sweep: **events are latency; the sweep is outbound correctness.** Any lost event (missing subscription, queue loss, cooldown swallow, phantom Completed) becomes ≤30-min staleness, never permanent loss. `accounting-outbound-sweep.ts` (cron `15,45 * * * *`), per company with an active accounting integration:

1. **Subscription convergence** — `ensureProviderSubscriptions` (the self-healing invariant check; runs first so a repaired install's next events flow normally).
2. **Candidate refs (scope, not decisions)** — pages posted journals (Posted/Reversed, `reversalOfId` null), posted documents (`SWEPT_BILL_STATUSES`/`SWEPT_INVOICE_STATUSES` — the posted set minus the transient mid-posting `Pending`), posted payments (Rillet only), and parked `Warning UNMAPPED_ACCOUNTS` bills regardless of window. Window floor: `getSweepFloorDate` = today − `SWEEP_LOOKBACK_DAYS` (7), raised to the entity's `syncFromDate` — deliberately short; history beyond it is the explicit backfill's job.
3. **Reconcile** — every ref goes to `reconcileEntities` (the SAME executor the event path calls); the decisions (missing-remotely enqueue incl. the phantom Completed-without-mapping repair, policy exclusions, the capped `MAX_REDRIVE_ATTEMPTS` re-drive when a bill's posted "Purchase Invoice" journal now exists) all live in `computeReconcileDecision`.
4. **Drain** — including what this run enqueued/re-drove. This is **Xero's only periodic drain** (it has no incremental pull), so UI retries stop rotting as Pending.
5. **Alert (Pillar F)** — failed ops left after the drain fire one in-app `NotificationEvent.IntegrationSync` to the integration's configurer (`integration.updatedBy`), linking to the integration's settings page. A notification failure never fails the sweep.

## The v5 reconciler (one brain)

- **`integrations/reconcile.ts`** — `computeReconcileDecision(input)`: the pure, state-shaped decision for every outbound entity (journals via the shared `planJournalPostingFromState` policy core; documents incl. the re-drive and the changed-since-failure retry; payments; master data via `updatedAt` vs `mapping.lastSyncedAt`). Import-light; exhaustively pinned by **`reconcile-golden.test.ts`** (spec Step A), whose FIX-1..4 entries document every deliberate difference from the legacy paths.
- **`integrations/reconcile-executor.ts`** — `reconcileEntities({refs, …})`: batch-first state loading (one query per concern per entity type — snapshots, ledger rows incl. `:reversal` twins, mappings, the parked-bill backing-journal join), then the pure decision per entity, then application through the existing ledger primitives with trigger `"reconcile"` (migration `20260812093418` widened the CHECK).
- Callers: `events/sync.ts` (hints) and the outbound sweep (window walk). The journal policy core is shared with `planJournalPostingOperation` (still used by the manual backfill), so policy routing cannot diverge between callers.

## Reconciliation + tie-out (v3 §5 / v4 Pillar E)

`accounting-reconciliation.ts` (cron `0 3 * * 1`) is **provider-agnostic** — all three providers, no longer Xero-only:

- **Presence** — pages the last 90 days of Completed journalEntry ops and verifies each distinct externalId still exists remotely via `fetchRemoteJournalTotals` (`core/remote-journal.ts` — dispatches on the concrete provider class: Xero manual journals, Rillet journal entries, QBO journal entries; returns net debit-signed totals per remote account ref, `found: false` for missing/voided/deleted, never throws except `RatelimitError`). Drift entries land at `companyIntegration.metadata.settings.postingSync.lastReconciliation` (the SyncActivity banner's feed).
- **Tie-out** — writes one `accountingSyncTieOut` row per (integration × accountingPeriod × account) (migration `20260811223145`; single-column FK to `accountingPeriod` — its PK is `(id)` alone; RLS is SELECT-only under `accounting_view`, rows written by the cron via service role). Per cell: `carbonPostedAmount` split into `synced/docBacked/excluded/pending/blocked` by each journal's ledger disposition (least-delivered bucket wins across an op + its `:reversal` twin; `DOC_BACKED` counts as delivered only while the backing document really synced), `providerAmount` from the presence fetches (strictly reused, never fetched twice; NULL when uncovered), `internalDelta` (I1: carbonPosted − sum of buckets) and `externalDelta` (I5: synced − provider).
- **ERP surface** — `x+/accounting+/sync-tieout.tsx` (+ `$cellId` drawer drill-down), nav item under Accounting → Reports (`path.to.accountingSyncTieOut`); the SyncActivity tab gets a tie-out summary card + a Failed/Warning count badge. **Period close**: the "External GL sync complete" Blocker auto-check (`autoCheckKey: "external-gl-sync"`, seeded for new companies and reconciled for existing ones in the same migration) is computed by `getPeriodExternalGlSyncReadiness` (apps/erp `accounting.ee.service.ts`) — every journal posted into the period must carry a terminal disposition (Completed/Excluded/Skipped) for every active accounting integration; auto-passes only when NO active accounting integration exists (posting sync is always-on when one is connected).

## externalIntegrationMapping table

Source of external-ID truth (the old per-entity `externalId` JSONB columns were dropped). Migrations: `20260128140000_external-integration-mapping.sql` (CREATE), `20260130005853_external-id-migration.sql` (made `externalId` nullable + added back-compat views), `20260204001831_external-integration-mapping-rls.sql` (RLS).

Columns: `id` (PK, `id()`), `entityType`, `entityId` (Carbon internal ID), `integration` (e.g. `'xero'`, `'linear'`), `externalId` (nullable), `allowDuplicateExternalId BOOLEAN DEFAULT false`, `metadata JSONB`, `lastSyncedAt`, `remoteUpdatedAt`, `createdAt/updatedAt/createdBy`, `companyId`.

Constraints:
- `UNIQUE (entityType, entityId, integration, companyId)` — one mapping per integration per entity (the `link`/`linkBatch` upsert conflict target).
- Partial `UNIQUE (integration, externalId, entityType, companyId) WHERE allowDuplicateExternalId = false` — enforces external-ID uniqueness unless many-to-one is opted in.

Back-compat views reconstruct the legacy `externalId` JSONB via `jsonb_object_agg`: `suppliers`, `customers`, `parts`, `materials`, `tools`, `consumables`, `services`, `salesOrders` — so view-reading app code keeps working.

## Payment sync-back (inbound AR/AP) — the family-agnostic core

Provider payments (a customer invoice paid, or a **vendor bill paid**) flow back
into Carbon as `payment` + `invoiceSettlement` rows that close the
`salesInvoice`/`purchaseInvoice`. All three providers share one core:

- `core/payment-application.ts` — `NormalizedPayment` (`family: 'ar'|'ap'`,
  `documentRemoteId`, `paymentRemoteId`, amount/currency/date/reference, `status`,
  optional `linkedDocuments` for multi-doc fan-out) + `upsertLocalPaymentDraft`,
  which writes a **Draft** `payment` (AR→`Receipt`/`customerId`; AP→`Disbursement`/
  `supplierId`) + one `invoiceSettlement` per mapped document
  (`targetSalesInvoiceId`/`targetPurchaseInvoiceId`), idempotent by the `payment`
  mapping, dropping unmapped documents. Returns a `postAction` (`post`/`void`/`none`).
- `core/payment-syncer.ts` — `PaymentSyncerBase` (pull, plus the Phase G push below). Providers implement
  `mapToNormalized(remote, entityId)` + `fetchRemote`. The base overrides
  `pullFromAccounting`/`pullBatchFromAccounting`: Draft write in the base tx, then
  **after commit** invokes the native `post-payment` edge fn (`{type:'post'|'void'}`
  via a lazily-imported `getCarbonServiceRole()`), which builds the GL journal,
  sets `payment.journalId`, and derives document status. **Pulled payments DO post
  to Carbon's GL** — no double-count because `documents`-mode `Payment` journals are
  DOC_BACKED-excluded from outbound push (the payment journal never re-posts to the
  provider). `getSettledInvoiceStatus` is retained for tests only (status is
  view-derived).
- Provider syncers: `providers/{rillet,quickbooks-online,xero}/entities/payment.ts`.
  Composite entity-id convention: AR = `<documentRemoteId>:<paymentRemoteId>` (no
  prefix, back-compat), AP = `bill:<billRemoteId>:<paymentRemoteId>`.
  Detection: Rillet AR = `/invoice-payments?updated.gt` (poll). Rillet AP has NO
  org-wide feed — `GET /bill-payments` does not exist (verified 404 on sandbox
  2026-08-13; the unguarded call used to kill every pull sweep), so
  `listBillPaymentsUpdatedSince` is composed: `GET /bills?updated.gt` (paying a
  bill bumps its `updated_at`) then `GET /bills/{id}/payments` per changed bill,
  each payment stamped with its bill's `updated_at`. QBO `Payment` +
  `BillPayment` (CDC + `webhook.quickbooks.$companyId.ts`); Xero `/Payments` via a
  new `listChanges` (`If-Modified-Since`) + Invoice-update webhook accelerator.
- Gate: `isPaymentSyncbackEnabled(metadata, family)` — pull-back only when the
  family is in `documents` mode (`PostingSyncSettings.families`); `journals`/`none`
  means Carbon owns the payment (v3 Phase 4 pushes it outbound). `shouldSync` also
  benignly skips a payment whose settled document has no local mapping (ownership).

### Outbound payment write-back (Phase G — Rillet, Xero, QBO)

Payments executed OUTSIDE the provider (e.g. a bill paid through Ramp, recorded
in Carbon, or a manual Carbon payment) push back so the provider's bill/invoice
closes. `PaymentSyncerBase` gained a bespoke `pushToAccounting` (not the templated
fetchLocal→mapToRemote flow): it reads the Carbon `payment` + `invoiceSettlement`
directly, gates on the SAME documents-mode families gate as pull, and routes
per-record by the `payment` mapping — a payment that already carries a mapping is
provider-known and skips (the loop guard: a pulled payment links its mapping
BEFORE post-payment flips it to Posted, so its Posted event finds the mapping and
skips). A mapping-less Carbon-born payment is pushed via the provider adapter
`pushRemotePayment` (one provider payment per settled document), then linked under
the composite id with `metadata.origin = "carbon"` so a later void echoes out and
a later pull no-ops. `supportsPaymentPush` gates the whole thing — **Rillet, Xero,
AND QBO all set it true** (2026-08-14 parity). The capability set
`PAYMENT_PUSH_PROVIDERS` (`core/payment-syncer.ts`, must stay in sync with the
syncer flags) is what the reconcile executor and outbound sweep read instead of the
old `providerId === "rillet"` literal. v1 is single-settlement, base-currency, no
discount, no void-echo — everything else parks as Skipped. The paid date goes
through `toPostingDateString` (Kysely's pg driver returns DATE columns as JS
`Date`s; a bare `.slice` crashed the push). Provider adapters (`pushRemotePayment`):
**Rillet** `createInvoicePayment`/`createBillPayment` (`POST /{invoices,bills}/{id}/payments`,
flat body `{ amount, date, account_code }` — `date`, NOT `payment_date`; bill path
VERIFIED sandbox 2026-08-11). **Xero** `createPayment` (`PUT /Payments`
`{ Payments:[{ Invoice:{InvoiceID}, Account:{Code}, Amount, Date }] }` —
**live-VERIFIED sandbox 2026-08-14**: bill flipped to PAID; the Account must be a
Xero `Type:"BANK"` account, and `EnablePaymentsToAccount` is NOT the gate for bank
accounts). **QBO** AP `createBillPayment` / AR `createPayment` via `writeEntity`
(payload VERIFY-flagged — no QBO sandbox; needs `VendorRef`/`CustomerRef` +
`PayType`/`BankAccountRef` (AP) or `DepositToAccountRef` (AR)). Trigger: the
`payment` table has an event trigger (`20260807152238_payment-event-trigger.sql`)
+ a `${provider}-sync` `payment` subscription from `REQUIRED_SYNC_SUBSCRIPTIONS`
convergence (now Rillet/Xero/QBO; no migration backfill — see the subscriptions
section); the reconciler enqueues push only on a transition to Posted/Voided. (Phase G design lived in the
removed v2 engine spec; the behavior is documented in this section — see git for history.)

## Document representation model (bills, invoices, items)

Every AR/AP **document** Carbon pushes reproduces its Carbon posting journal, so
the provider's GL for that document equals Carbon's. Spec:
`.ai/specs/implemented/2026-08-05-accounting-document-representation.md`.

- **AP bills = account-costed replay of the posted "Purchase Invoice" journal**,
  NOT the item's account. `core/document-costing.ts` is the shared core:
  `loadBillCostingLines(db, { companyId, billId, payablesAccountId })` reads the
  posted journal (`journal.sourceType='Purchase Invoice'`, `status='Posted'`),
  drops the AP control line, and returns base-currency debit-signed
  `CostingLine[]` (+ `currencyCode`/`exchangeRate`). Item labels are joined via
  `journalLine.documentLineReference` (`purchase-invoice:<purchaseOrderLineId>`
  → `purchaseOrderLine.itemId` → `item`); direct no-PO / variance lines have
  `sourceItem: undefined`. `toTransactionCurrencyLines(lines, exchangeRate)`
  converts to the invoice's transaction currency (÷ rate, residue into the
  largest-|amount| line; rate 1 = pass-through). The item is a **description
  label only** (`costingLineItemLabel`). Bill lines are **tax-neutral** (the
  purchase posting folds tax into cost): Rillet no `tax_rate`, QBO no
  `TxnTaxDetail`, Xero `TaxType: "NONE"`. FX bills pin the provider rate
  (Rillet `exchange_rate`, QBO `CurrencyRef`+`ExchangeRate`, Xero `CurrencyRate`).
  Every bill syncer has a posted-status `shouldSync` (Draft excluded — no
  journal to replay). Unmapped/account-less/no-journal lines throw the
  structured `UNMAPPED_ACCOUNTS` Warning.
  - QBO bill emits `AccountBasedExpenseLineDetail` from a NEW bill-only builder
    (`buildQboBillLines`); it no longer uses the shared `buildQboExpenseLines`
    or `ensureDependencySynced("item")`. Xero bill uses `buildXeroBillLineItems`.
    Rillet bill (`mapBillToRilletBill`) is the reference (prepends the label;
    QBO/Xero substitute it). Account codes resolve through the shared
    `loadAccountCodesById` (Xero) / `loadQboAccountRefsById` (QBO) /
    `loadRilletAccountCodesById` (Rillet).
- **AR invoices = item-referenced to the item's REVENUE account**
  (`accountDefault.salesAccount` → the account-mapping code/ref — the same
  resolution for Rillet product `account_code`, QBO `IncomeAccountRef`, Xero
  invoice `AccountCode`), NOT the journal line and NOT the blunt
  `defaultSalesAccountCode`. COGS stays on the pushed `Sales Shipment` journal.
- **Provider items are non-tracked** so the provider never posts inventory
  (bills) or COGS (invoices): Xero pushes `IsTrackedAsInventory: false` on
  create and OMITS the flag on update (Xero rejects untracking an item with
  stock/txns; a still-tracked remote logs a recorded warning to untrack
  manually). QBO items are Service/NonInventory (never Inventory).
- **PO / SO / Quote are unchanged** — item-referenced, no GL constraint (QBO PO
  keeps `buildQboExpenseLines` / `ItemBasedExpenseLineDetail`).

## Dimensions (journal / bill analytics)

Journal-entry and bill line dimensions (`journalLineDimension`) map to provider
analytics fields. **Rillet sends ALL dimensions on every line and auto-provisions
what's missing** — there is no per-company slot/cap (Rillet Fields are unlimited).
`RilletTransactionSyncer.resolveLineDimensions(lines)` (`providers/rillet/entities/shared.ts`)
resolves each distinct dimension to a Rillet Field id (reuse an existing Field by
name, else `createField(name, "EXPENSES")` — journal entries + bills are
expense-side) and each value to a Field-value id (`upsertFieldValue` by the
value's readable label), persisting both in `externalIntegrationMapping`
(`entityType` `"dimension"` for the Field via `upsertDimensionMapping`,
`"dimensionValue"` for the value). The Rillet mappers iterate `line.dimensions`;
a dimension whose Field or value can't be provisioned is dropped from that line's
refs. `createField` (`POST /fields`) is VERIFY-flagged — confirm the payload on
the Rillet sandbox.

**Xero/QBO keep the slot system** (`dimensionSlots` + `maxJournalDimensionSlots`
= 2 each; `validateDimensionSlots`, the Dimensions settings tab). For Rillet the
slot config is now inert (the mapper no longer reads it) — the tab's slot editor
is dead config for Rillet only, left in place for the capped providers.

## Gotchas

- All DB writes during sync are wrapped in `withTriggersDisabled(database, tx => ...)` to break the loop (sync writes DB → event trigger → sync again). Since migration `20260811224732`, that suppression is **scoped**: `dispatch_event_batch()` drops only SYNC/WEBHOOK/WORKFLOW subscriptions while `app.sync_in_progress` is set (the loop/echo-prone types); SEARCH/AUDIT/EMBEDDING observers now see sync-written rows (v4 F13). **Exception:** payment sync-back invokes `post-payment` *outside* that tx (triggers enabled), like a user posting a payment — intended.
- Rillet create POSTs carry a deterministic, **entity-scoped** `Idempotency-Key`: `buildRilletIdempotencyKey` (`providers/rillet/provider.ts`) = sha256 of `companyId:operation:localId`; Rillet replays the stored response for 24h. The payload is deliberately **NOT hashed** (v4 Pillar C): a crash between the remote create and the local mapping write retries with a possibly-drifted payload, and a payload-sensitive key would mint a fresh key and duplicate the remote document. Contract pinned by `providers/rillet/__tests__/provider.test.ts`.
- The event-queue drainer (`events/queue.ts`) archives unknown-`handlerType` messages to pgmq's dead-letter table (`pgmq.a_event_system`) instead of crash-looping the whole drain (v4 F8) — a poison message can no longer wedge ALL event processing.
- `ContactSyncer.getRemoteId` checks both `customer` and `vendor` mappings (one Xero Contact backs both).
- Transaction syncers (PO, invoice, bill) use `ensureDependencySynced(type, localId)` for JIT dependency syncing (e.g. push the customer before its invoice); `dependsOn` is declared in `ENTITY_DEFINITIONS`.
- DELETE sync is not implemented anywhere yet.
- Don't hand-edit generated DB types; read the newest migration for schema truth.
</content>
