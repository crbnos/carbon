---
paths: []
triggers: []
promoted: null
---
# Audit FK snapshots: constraint-less columns are invisible to schema discovery; junction targets need hops

**Context:** Audit-log diffs resolve FK ids into frozen display names ("Location: Chicago → Dallas") via `get_foreign_key_map` + `fkDisplayRegistry` (`packages/database/src/audit.config.ts`, handler in `packages/jobs/src/inngest/functions/events/{audit,fk-snapshots}.ts`). Found while fixing "audit log shows location id instead of name" (2026-08).

**Problem:** Three distinct shapes made raw ids reach the UI. (1) `get_foreign_key_map` reads `pg_constraint`, so reference columns **without a real FK constraint** are invisible to it — no snapshot no matter what the registry says. This schema has many: `salesOrder.salesPersonId`, `salesInvoice.assignee`, line-level `locationId`s on `purchaseOrderLine`/`salesOrderLine`/`salesInvoiceShipment`, `inventoryCountLine.storageUnitId`, etc. (2) Junction targets (`customerContact`/`supplierContact`, `opportunity`, `fulfillment`…) have no displayable columns of their own — the name lives one hop away (`contact.fullName`), which single-hop resolution can't reach. (3) A target table simply missing from `fkDisplayRegistry` silently degrades to the raw id — no error anywhere.

**Rule:** When adding a reference column to an audited table, either give it a real FK constraint (registry/hops then cover it automatically) or declare a per-column `snapshotFields` override on that table's audit config. For targets whose display value lives on another table, use `fkDisplayHops` (two-stage batched lookup). Resolution precedence is override > hop > registry; hops and registry must stay disjoint, and overrides must not target hop tables — both invariants are enforced by tests in `fk-snapshots.test.ts`. Snapshots are frozen at write time: config changes never backfill existing audit rows.

**Applies to:** `packages/database/src/audit.config.ts` (`fkDisplayRegistry`, `fkDisplayHops`, `snapshotFields`), `packages/jobs/src/inngest/functions/events/fk-snapshots.ts` + `audit.ts`, and any migration adding reference columns to tables listed in `auditConfig.entities`.
