---
paths:
  - "packages/jobs/src/inngest/functions/integrations/**"
  - "packages/jobs/src/inngest/functions/events/sync.ts"
  - "packages/ee/src/accounting/**"
---

# Accounting Sync Handlers

Syncs Carbon entities <-> external accounting providers. **Xero is the only live provider** (`ProviderID.XERO = "xero"`; QuickBooks/Sage are commented stubs). Runs on **Inngest** (the old trigger.dev `from-/to-accounting-sync` task design is gone — do not look for `UPSERT_MAP`/`DELETE_MAP` or a `trigger/` dir; neither exists).

## Architecture: class-per-entity syncers, not a handler map

The sync engine lives in `packages/ee/src/accounting/` (package `@carbon/ee/accounting`):
- `core/sync.ts` — `SyncFactory.getSyncer(context)` returns the right syncer by `entityType`.
- `core/types.ts` — `BaseEntitySyncer<TLocal, TRemote, TOmit>` abstract base (~800 lines). Implements `pushToAccounting` / `pullFromAccounting` (+ `*Batch*`) with: mapping lookup, `shouldSync` gate, fast-bailout on unchanged timestamps, `mapToRemote`/`mapToLocal`, then `withTriggersDisabled` DB write + `linkEntities`.
- `providers/xero/entities/*.ts` — concrete syncers: `ContactSyncer` (handles both `customer` AND `vendor`), `ItemSyncer`, `BillSyncer`, `SalesInvoiceSyncer` (`invoice`), `PurchaseOrderSyncer`, `SalesOrderSyncer`, `InventoryAdjustmentSyncer`. `employee`/`payment` are NOT implemented (Xero dropped the Employees API).
- `core/external-mapping.ts` — `ExternalIntegrationMappingService` / `createMappingService(db, companyId)`: all ID linking goes through the `externalIntegrationMapping` table.
- `core/models.ts` — Zod schemas, `ProviderID`, `AccountingSyncSchema`, `ENTITY_DEFINITIONS`, `DEFAULT_SYNC_CONFIG`.
- `core/service.ts` — `getAccountingIntegration()` (reads `companyIntegration` row) + `getProviderIntegration()` (instantiates `XeroProvider`).

## Entity types & directions

`AccountingEntityType` = `customer | vendor | item | employee | purchaseOrder | bill | salesOrder | invoice | payment | inventoryAdjustment`.

`SyncDirection` = `"two-way" | "push-to-accounting" | "pull-from-accounting"` (NOT the old `from-/to-/bi-directional`). Each entity has an `EntityConfig { enabled, direction, owner: "carbon" | "accounting", syncFromDate? }`. Per-entity defaults live in `DEFAULT_SYNC_CONFIG`; `getProviderIntegration()` currently hardcodes `DEFAULT_SYNC_CONFIG` (company-level `syncConfig` from metadata is parsed but not yet applied). `owner` decides the winner on conflict in two-way sync.

## Inngest functions (entry points)

All three are in `packages/jobs/src/inngest/functions/integrations/` (+ `events/sync.ts`), exported via that dir's `index.ts`, and registered in `packages/jobs/src/inngest/index.ts`. Event-name <-> trigger-key map: `packages/lib/src/trigger.ts` & `packages/lib/src/events.ts`. Fire with `trigger("<key>", payload)`.

| Inngest id | event | file | trigger key / fired from |
|---|---|---|---|
| `sync-external-accounting` | `carbon/sync-external-accounting` | `sync-external-accounting.ts` | `sync-external-accounting`; fired by the Xero inbound webhook `apps/erp/app/routes/api+/webhook.xero.ts` |
| `accounting-backfill` | `carbon/accounting-backfill` | `accounting-backfill.ts` | `accounting-backfill`; fired by `apps/erp/app/routes/api+/integrations.xero.backfill.ts` |
| `event-handler-sync` | `carbon/event-sync` | `events/sync.ts` | the SYNC event-system handler (see event-system.md) — DB writes -> push to Xero |

`sync-external-accounting.ts` flow: parse `AccountingSyncSchema` → `getAccountingIntegration` → `getProviderIntegration` → group entities by type → per type `provider.getSyncConfig(type)` (skip if `!enabled`) → `SyncFactory.getSyncer(...)` → resolve `effectiveDirection` (`two-way` uses `entityConfig.direction`) → `pushBatchToAccounting` / `pullBatchFromAccounting` / `handleTwoWaySync`. A **60s per-entity cooldown** (`SYNC_COOLDOWN_MS`, via `mappingService.getByEntity().lastSyncedAt`) skips recently-synced entities. Returns `{ success: BatchSyncResult[], failed[] }`.

`events/sync.ts` maps DB table → entity type via `TABLE_TO_ENTITY_MAP` (`customer→customer`, `supplier→vendor`, `item→item`, `purchaseOrder→purchaseOrder`, `purchaseInvoice→bill`, `salesInvoice→invoice`). INSERT/UPDATE → `pushBatchToAccounting`; **DELETE is logged/skipped (not implemented)**. Wrapped in `step.run` per company+provider for checkpointing; re-throws `RatelimitError` so Inngest retries.

## externalIntegrationMapping table

Source of external-ID truth (the old per-entity `externalId` JSONB columns were dropped). Migrations: `20260128140000_external-integration-mapping.sql` (CREATE), `20260130005853_external-id-migration.sql` (made `externalId` nullable + added back-compat views), `20260204001831_external-integration-mapping-rls.sql` (RLS).

Columns: `id` (PK, `id()`), `entityType`, `entityId` (Carbon internal ID), `integration` (e.g. `'xero'`, `'linear'`), `externalId` (nullable), `allowDuplicateExternalId BOOLEAN DEFAULT false`, `metadata JSONB`, `lastSyncedAt`, `remoteUpdatedAt`, `createdAt/updatedAt/createdBy`, `companyId`.

Constraints:
- `UNIQUE (entityType, entityId, integration, companyId)` — one mapping per integration per entity (the `link`/`linkBatch` upsert conflict target).
- Partial `UNIQUE (integration, externalId, entityType, companyId) WHERE allowDuplicateExternalId = false` — enforces external-ID uniqueness unless many-to-one is opted in.

Back-compat views reconstruct the legacy `externalId` JSONB via `jsonb_object_agg`: `suppliers`, `customers`, `parts`, `materials`, `tools`, `consumables`, `services`, `salesOrders` — so view-reading app code keeps working.

## Gotchas

- All DB writes during sync are wrapped in `withTriggersDisabled(database, tx => ...)` to break the loop (sync writes DB → event trigger → sync again).
- `ContactSyncer.getRemoteId` checks both `customer` and `vendor` mappings (one Xero Contact backs both).
- Transaction syncers (PO, invoice, bill) use `ensureDependencySynced(type, localId)` for JIT dependency syncing (e.g. push the customer before its invoice); `dependsOn` is declared in `ENTITY_DEFINITIONS`.
- DELETE sync is not implemented anywhere yet.
- Don't hand-edit generated DB types; read the newest migration for schema truth.
</content>
