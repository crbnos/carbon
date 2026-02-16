# Audit Log System

## Overview

Per-company audit log system that tracks changes to key business entities. Audit logs are stored in dynamically created `auditLog_{companyId}` tables accessed via PostgreSQL RPC functions.

## Schema

Each audit log entry has:

- `id` (TEXT, default `id('aud')`)
- `companyId` (TEXT)
- `entityType` (TEXT) — one of the auditable entity types
- `entityId` (TEXT) — the primary key of the entity that changed
- `operation` (TEXT) — INSERT, UPDATE, or DELETE
- `actorId` (TEXT | null) — the user who made the change (null = system)
- `diff` (JSONB | null) — field-level changes `{ fieldName: { old, new } }`
- `metadata` (JSONB | null) — ipAddress, userAgent, origin, requestId
- `createdAt` (TIMESTAMPTZ)

## Auditable Entities

Configured in `packages/database/src/audit.config.ts`:

| Entity Type       | UI Label            | DB ID Prefix          | Linkable Detail Page            |
| ----------------- | ------------------- | --------------------- | ------------------------------- |
| `purchaseInvoice` | Purchasing Invoice  | `pi_`                 | `/x/purchase-invoice/:id`       |
| `salesInvoice`    | Sales Invoice       | `si_`                 | `/x/sales-invoice/:id`          |
| `purchaseOrder`   | Purchasing Order    | `po_`                 | `/x/purchase-order/:id`         |
| `salesOrder`      | Sales Order         | `so_`                 | `/x/sales-order/:id`            |
| `customer`        | Sales Customer      | `cust_`               | `/x/customer/:id`               |
| `supplier`        | Purchasing Supplier | `sup_`                | `/x/supplier/:id`               |
| `item`            | Inventory Item      | `item_`               | `/x/part/:id`                   |
| `itemCost`        | Inventory Item      | `item_` (uses itemId) | `/x/part/:id` (via item prefix) |
| `job`             | Production Job      | `job_`                | `/x/job/:id`                    |
| `quote`           | Sales Quote         | `quote_`              | `/x/quote/:id`                  |
| `employee`        | Employee            | `emp_`                | `/x/users/employees/:id`        |

Labels use domain prefixes to group related entities (e.g., "Inventory Item" for both `item` and `itemCost`).

## Key Files

### Configuration

- `packages/database/src/audit.config.ts` — auditable entities list, labels, skip fields, retention config
- `packages/database/src/audit.types.ts` — TypeScript types (AuditLogEntry, AuditDiff, AuditLogFilters, etc.)

### Backend

- `packages/database/src/audit.ts` — database query functions (CRUD, enable/disable, archival)
- `packages/jobs/trigger/event/audit.ts` — Trigger.dev task that processes audit events and inserts entries

### UI Components

- `apps/erp/app/modules/settings/ui/AuditLog/AuditLogTable.tsx` — main audit log table with entity linking, actor linking, expandable diffs
- `apps/erp/app/modules/settings/ui/AuditLog/AuditLogSettings.tsx` — settings card to enable/disable + archive list
- `apps/erp/app/components/AuditLog/AuditLogDrawer.tsx` — per-entity history drawer (used on entity detail pages)

### Routes

- `apps/erp/app/routes/x+/settings+/audit-logs.tsx` — settings page (enable/disable/download)
- `apps/erp/app/routes/x+/settings+/audit-logs.details.tsx` — full-screen table view
- `apps/erp/app/routes/api+/audit-log.ts` — API endpoint for entity-specific audit logs

### Migrations

- `packages/database/supabase/migrations/20260212152709_audit_log_system.sql` — initial system
- `packages/database/supabase/migrations/20260212154954_fix_audit_log_table_name_ambiguity.sql` — fix
- `packages/database/supabase/migrations/20260212174458_remove_actor_name_from_audit_log.sql` — UI resolves from actorId

## Entity Linking

Entity IDs in the audit log table are linked to their detail pages based on the **ID prefix** (the part before the first `_`). The `getEntityPath()` function in `AuditLogTable.tsx` maps prefixes to `path.to.*` helpers:

```
pi → path.to.purchaseInvoice
si → path.to.salesInvoice
po → path.to.purchaseOrder
so → path.to.salesOrder
cust → path.to.customer
sup → path.to.supplier
item → path.to.part
job → path.to.job
quote → path.to.quote
emp → path.to.employeeAccount
```

IDs without a recognized prefix render as plain text. The `itemCost` entity uses `itemId` as its key, so its entityId has the `item_` prefix and links to the part page.

## Actor Linking

The "Changed By" column wraps the `<EmployeeAvatar>` in a `<Link>` to `path.to.employeeAccount(actorId)`. System entries (null actorId) display as plain "System" text.

## Architecture Notes

- Per-company tables: `auditLog_{companyId}` accessed via RPC
- `actorName` column was removed; UI resolves via `<EmployeeAvatar employeeId={actorId} />`
- Uses `@tanstack/react-table` via shared `<Table>` component with expandable rows, search, pagination, and static column filters
- Skip fields: `updatedAt`, `updatedBy` are excluded from diff computation
- Retention: 30 days default before archival
- Archives stored in `private` bucket at `audit-logs/{companyId}/{year}/{month}.jsonl.gz`
