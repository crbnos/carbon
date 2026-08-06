---
paths:
  - "packages/jobs/src/inngest/functions/integrations/**"
  - "packages/jobs/src/inngest/functions/events/sync.ts"
  - "packages/ee/src/accounting/**"
---

# Accounting Sync Handlers

Syncs Carbon entities <-> external accounting providers. **Three live providers**: Xero (`ProviderID.XERO`), QuickBooks Online (`ProviderID.QBO`), and Rillet (`ProviderID.RILLET`). (QuickBooks *Desktop* shipped then was removed 2026-08-01; Sage was never built.) `SyncFactory` is a **provider-keyed registry** (`registries[providerId][entityType]`) — each provider's `index.ts` barrel calls `SyncFactory.register(...)`. Runs on **Inngest** (the old trigger.dev `from-/to-accounting-sync` task design is gone — do not look for `UPSERT_MAP`/`DELETE_MAP` or a `trigger/` dir; neither exists).

Design specs: `.ai/specs/2026-07-09-accounting-sync-engine.md` (v2 — engine, providers, ledger, pull sweep, **§Phase F inbound payment sync-back**) and `.ai/specs/2026-08-02-accounting-sync-engine-v3.md` (journal policy, dimensions, tie-out).

## Architecture: class-per-entity syncers, not a handler map

The sync engine lives in `packages/ee/src/accounting/` (package `@carbon/ee/accounting`):
- `core/sync.ts` — `SyncFactory.getSyncer(context)` returns the right syncer by `providerId` + `entityType` from the registry.
- `core/types.ts` — `BaseEntitySyncer<TLocal, TRemote, TOmit>` abstract base (~800 lines). Implements `pushToAccounting` / `pullFromAccounting` (+ `*Batch*`) with: mapping lookup, `shouldSync` gate, fast-bailout on unchanged timestamps, `mapToRemote`/`mapToLocal`, then `withTriggersDisabled` DB write + `linkEntities`. Also `SupportsIncrementalPull` (`listChanges({since}) → ProviderChange[]`) — the pull-sweep contract (QBO CDC, Rillet `updated.gt`, Xero `/Payments` `If-Modified-Since`).
- `providers/{xero,quickbooks-online,rillet}/entities/*.ts` — concrete syncers. Xero `ContactSyncer` backs both `customer` AND `vendor`; QBO/Rillet have separate Customer + Vendor syncers. Each provider has item/bill/invoice(+PO/journalEntry) syncers and a **`PaymentSyncer`** (see Payment sync-back below). `employee` is not implemented.
- `core/external-mapping.ts` — `ExternalIntegrationMappingService` / `createMappingService(db, companyId)`: all ID linking goes through the `externalIntegrationMapping` table.
- `core/models.ts` — Zod schemas, `ProviderID`, `AccountingSyncSchema`, `ENTITY_DEFINITIONS`, `DEFAULT_SYNC_CONFIG`, `PostingSyncSettings` (`families.ar`/`families.ap` = `documents|journals|none`).
- `core/service.ts` — `getAccountingIntegration()` (reads `companyIntegration` row) + `getProviderIntegration()` (instantiates the right provider; applies the merged per-company `syncConfig`).

## Entity types & directions

`AccountingEntityType` = `customer | vendor | item | employee | purchaseOrder | bill | salesOrder | invoice | payment | inventoryAdjustment | journalEntry`. `payment` is `dependsOn: ['invoice','bill']`, `pull-from-accounting` only.

`SyncDirection` = `"two-way" | "push-to-accounting" | "pull-from-accounting"` (NOT the old `from-/to-/bi-directional`). Each entity has an `EntityConfig { enabled, direction, owner: "carbon" | "accounting", syncFromDate? }`. Per-entity defaults live in `DEFAULT_SYNC_CONFIG`, deep-merged with the company's stored `syncConfig`; providers may force an entity's config (e.g. each provider forces `payment` to `pull-from-accounting` / `owner: accounting`). `owner` decides the winner on conflict in two-way sync.

## Inngest functions (entry points)

All three are in `packages/jobs/src/inngest/functions/integrations/` (+ `events/sync.ts`), exported via that dir's `index.ts`, and registered in `packages/jobs/src/inngest/index.ts`. Event-name <-> trigger-key map: `packages/lib/src/trigger.ts` & `packages/lib/src/events.ts`. Fire with `trigger("<key>", payload)`.

| Inngest id | event | file | trigger key / fired from |
|---|---|---|---|
| `sync-external-accounting` | `carbon/sync-external-accounting` | `sync-external-accounting.ts` | `sync-external-accounting`; fired by the inbound webhooks — `webhook.xero.ts`, `webhook.rillet.$companyId.ts`, `webhook.quickbooks.$companyId.ts` |
| `accounting-pull-sweep` | — | `accounting-pull-sweep.ts` | cron; iterates every active integration that implements `SupportsIncrementalPull` (`listChanges`) — the **correctness guarantee** behind the webhooks (webhooks are latency, not correctness) |
| `accounting-backfill` | `carbon/accounting-backfill` | `accounting-backfill.ts` | `accounting-backfill` |
| `event-handler-sync` | `carbon/event-sync` | `events/sync.ts` | the SYNC event-system handler (see event-system.md) — DB writes -> push to the provider |

The drain path routes through a durable **`accountingSyncOperation`** ledger (`accounting-sync-operations.ts` — `enqueueSyncOperations`/`drainSyncOperations`, 60s cooldown, retry/skip/re-send) between enqueue and `SyncFactory.getSyncer(...).pushBatch/pullBatch`.

`sync-external-accounting.ts` flow: parse `AccountingSyncSchema` → `getAccountingIntegration` → `getProviderIntegration` → group entities by type → per type `provider.getSyncConfig(type)` (skip if `!enabled`) → `SyncFactory.getSyncer(...)` → resolve `effectiveDirection` (`two-way` uses `entityConfig.direction`) → `pushBatchToAccounting` / `pullBatchFromAccounting` / `handleTwoWaySync`. A **60s per-entity cooldown** (`SYNC_COOLDOWN_MS`, via `mappingService.getByEntity().lastSyncedAt`) skips recently-synced entities. Returns `{ success: BatchSyncResult[], failed[] }`.

`events/sync.ts` maps DB table → entity type via `TABLE_TO_ENTITY_MAP` (`customer→customer`, `supplier→vendor`, `item→item`, `purchaseOrder→purchaseOrder`, `purchaseInvoice→bill`, `salesInvoice→invoice`). INSERT/UPDATE → `pushBatchToAccounting`; **DELETE is logged/skipped (not implemented)**. Wrapped in `step.run` per company+provider for checkpointing; re-throws `RatelimitError` so Inngest retries.

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
- `core/payment-syncer.ts` — `PaymentSyncerBase` (pull-only). Providers implement
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
  Detection: Rillet `/invoice-payments` + `/bill-payments` (poll); QBO `Payment` +
  `BillPayment` (CDC + `webhook.quickbooks.$companyId.ts`); Xero `/Payments` via a
  new `listChanges` (`If-Modified-Since`) + Invoice-update webhook accelerator.
- Gate: `isPaymentSyncbackEnabled(metadata, family)` — pull-back only when the
  family is in `documents` mode (`PostingSyncSettings.families`); `journals`/`none`
  means Carbon owns the payment (v3 Phase 4 pushes it outbound). `shouldSync` also
  benignly skips a payment whose settled document has no local mapping (ownership).

## Document representation model (bills, invoices, items)

Every AR/AP **document** Carbon pushes reproduces its Carbon posting journal, so
the provider's GL for that document equals Carbon's. Spec:
`.ai/specs/2026-08-05-accounting-document-representation.md`.

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

## Gotchas

- All DB writes during sync are wrapped in `withTriggersDisabled(database, tx => ...)` to break the loop (sync writes DB → event trigger → sync again). **Exception:** payment sync-back invokes `post-payment` *outside* that tx (triggers enabled), like a user posting a payment — intended.
- `ContactSyncer.getRemoteId` checks both `customer` and `vendor` mappings (one Xero Contact backs both).
- Transaction syncers (PO, invoice, bill) use `ensureDependencySynced(type, localId)` for JIT dependency syncing (e.g. push the customer before its invoice); `dependsOn` is declared in `ENTITY_DEFINITIONS`.
- DELETE sync is not implemented anywhere yet.
- Don't hand-edit generated DB types; read the newest migration for schema truth.
</content>
