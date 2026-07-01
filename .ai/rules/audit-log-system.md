---
paths:
  - packages/database/src/audit.*
  - packages/jobs/src/inngest/functions/events/audit.ts
  - packages/jobs/src/inngest/functions/scheduled/audit-archive.ts
  - apps/erp/app/components/AuditLog/**
---

# Audit Log System

Per-company change log for key business entities. Rows live in dynamically created
`auditLog_{companyId}` tables, written via the **Inngest** event pipeline (not directly),
and queried through Postgres RPC functions. Entity-centric: a change to any table that
makes up an entity is attributed to the parent entity.

## Schema (`auditLog_{companyId}`)

The partition key *is the table name* — there is **no `companyId` column**. Columns:

- `id` TEXT PK `DEFAULT id('aud')`
- `tableName` TEXT — raw DB table the change came from (e.g. `itemCost`)
- `entityType` TEXT — semantic entity (e.g. `item`); see config below
- `entityId` TEXT — business entity PK the change rolls up to
- `recordId` TEXT — raw PK of the changed row; equals `entityId` for root tables, differs for children
- `operation` TEXT CHECK IN (`INSERT`,`UPDATE`,`DELETE`)
- `actorId` TEXT | null — user who made the change; null = system/service-role (captured via `auth.uid()` in `dispatch_event_batch`)
- `diff` JSONB | null — `{ field: { old, new, snapshot? } }`
- `metadata` JSONB | null — `ipAddress`, `userAgent`, `origin`, `requestId`
- `createdAt` TIMESTAMPTZ — original event time (handler passes `event.timestamp`; falls back to `clock_timestamp()` per row)

Indexes on `(entityType,entityId)`, `tableName`, `recordId`, `actorId`, `createdAt DESC`.
RLS is permissive (`USING true WITH CHECK true`) — isolation is the table name; auth is enforced
at the app layer (`requirePermissions`). A separate `auditLogArchive` table tracks archive metadata
(`archivePath`, `startDate`, `endDate`, `rowCount`, `sizeBytes`).

## Config (`packages/database/src/audit.config.ts`)

`auditConfig.entities` maps an **entity key** → `{ label, tables }`. Each table has a role:
`root` (PK = entityId), `extension` (1:1, PK = parent FK, INSERTs skipped),
`{ entityIdColumn }` (child with own PK), or `{ resolve: { junction, fk, entityIdColumn } }` (indirect via junction, needs a DB query at write time).

Entity keys are **not** all bare table names — notably `salesQuote` (label "Quote", tables `quote`/`quoteLine`),
`productionJob` (label "Job", tables `job`/...), plus `itemShelfLife`, `supplierQuote`, `customer`, `supplier`,
`item`, `salesOrder`, `purchaseOrder`, `salesInvoice`, `purchaseInvoice`, `employee`, `nonConformance`, `gauge`,
`shipment`, `receipt`, `warehouseTransfer`, `stockTransfer`, `workCenter`, `maintenanceSchedule`,
`maintenanceDispatch`, `pricingRule`, `priceOverride`, `priceOverrideBreak`, `fixedAsset`. (~26 entities; the
old `quote`/`job`/`itemCost` entity keys are gone — `itemCost` is now an extension table of `item`.)

Other config knobs:
- `tableLabels` — friendly per-`tableName` labels for diff provenance (fallback: camelCase → Title Case).
- `skipFields: ["updatedAt", "updatedBy", "embedding"]` — excluded from diffs (matched top-level and as nested `.suffix`).
- `retentionDays: 30`
- `archivePath: "audit-logs/{companyId}/{year}/{month}.jsonl.gz"` and `archiveBucket: "private"`.
- `createFields` (allowlist of columns surfaced on INSERT) and `snapshotFields` (FK display values frozen into the diff) are declared per table.

Types live in `audit.types.ts`: `AuditLogEntry`, `CreateAuditLogEntry`, `AuditDiff`, `AuditDiffEntry`,
`AuditMetadata`, `AuditOperation`, `AuditLogFilters`, `AuditLogResponse`, `AuditLogArchive`, `AuditLogConfig`.

## Write path (Inngest)

Old Trigger.dev task (`packages/jobs/trigger/event/audit.ts`) is **gone**.

DB triggers added via `attach_event_trigger(...)` push table changes onto a PGMQ queue with
`handlerType = 'AUDIT'`. The queue dispatcher (`packages/jobs/src/inngest/.../queue.ts`) batches AUDIT
records and emits `carbon/event-audit`. `auditFunction` in
`packages/jobs/src/inngest/functions/events/audit.ts` (Inngest id `event-handler-audit`) computes diffs
(`computeDiff` / `computeCreateDiff` / `computeNestedDiff`, honoring `skipFields`), resolves snapshot FKs,
and writes via `client.rpc("insert_audit_log_batch", { p_company_id, p_entries })`.

## Query / management functions

- RPCs: `create_audit_log_table`, `insert_audit_log_batch`, `get_entity_audit_log` (optional `p_record_id`),
  `get_audit_log` (filters + `totalCount`), `get_audit_logs_for_archive`, `delete_old_audit_logs`.
- `packages/database/src/audit.ts` wrappers: `getEntityAuditLog`, `getGlobalAuditLog`, `insertAuditLogEntries`,
  `enableAuditLog`, `disableAuditLog` (keeps data), `isAuditLogEnabled`, `syncAuditSubscriptions`
  (adds triggers for entities added to config after enable), `getAuditLogArchives`, `getArchiveDownloadUrl`,
  `getAuditLogsForArchive`, `deleteOldAuditLogs`, `recordAuditLogArchive`.

## Archival (scheduled)

`auditArchiveFunction` in `packages/jobs/src/inngest/functions/scheduled/audit-archive.ts`
(Inngest id `audit-log-archive`, cron `0 2 * * *`): per company, fetch rows older than `retentionDays`,
gzip to JSONL, upload to the `private` bucket, record an `auditLogArchive` row, then delete the rows.

GOTCHA: the runtime path is `audit-logs/{companyId}/{year}/{month}/{YYYY-MM-DD}.jsonl.gz`, which does
**not** match `auditConfig.archivePath` (`.../{month}.jsonl.gz`) — the job builds the path inline rather
than from config.

## UI

- `apps/erp/app/modules/settings/ui/AuditLog/AuditLogTable.tsx` — global table (expandable diffs, operation
  badges, actor + entity links). `getEntityPath(entityId)` maps the id **prefix** (before first `_`) to a
  `path.to.*` route: `pi`→purchaseInvoice, `si`→salesInvoice, `po`→purchaseOrder, `so`→salesOrder,
  `cust`→customer, `sup`→supplier, `item`→part, `job`→job, `quote`→quote, `emp`→employeeAccount, `nc`→issue,
  `sh`→shipment, `rec`→receipt, `g`→gauge, `sq`→supplierQuote, `wc`→workCenter, `main`→maintenanceDispatch.
  Unknown prefixes render as plain text.
- `.../AuditLog/AuditLogSettings.tsx` — enable/disable + archive download list.
- `apps/erp/app/components/AuditLog/` — per-entity history `AuditLogDrawer.tsx` + `useAuditLog.tsx` hook,
  fetching `api+/audit-log.ts` by `entityType`/`entityId`/`recordId`.
- Actor column: `<EmployeeAvatar employeeId={actorId} />` linked to `path.to.employeeAccount`; null actor → "System".
  (`actorName` column was removed; the UI resolves names from `actorId`.)

## Routes

- `apps/erp/app/routes/x+/settings+/audit-logs.tsx` — settings (enable/disable, download), syncs subscriptions.
- `apps/erp/app/routes/x+/settings+/audit-logs.details.tsx` — full-screen filtered table (`getGlobalAuditLog`).
- `apps/erp/app/routes/api+/audit-log.ts` — entity-scoped entries endpoint.

## Key migrations (newest = truth)

`20260212152709_audit_log_system.sql` (initial + RPCs/`auditLogArchive`),
`20260212153753_event_system_add_actor.sql` (`actorId` via `auth.uid()`),
`20260212174458_remove_actor_name_from_audit_log.sql`,
`20260217120000_audit_log_add_table_name.sql`, `20260218000000_expand_audit_log_entities.sql`,
`20260418000000_audit_log_add_record_id.sql`, `20260427120000_audit-event-timestamp.sql`,
`20260513130000_audit-item-shelf-life-history.sql`.
