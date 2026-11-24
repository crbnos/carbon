---
paths: []
triggers: []
promoted: null
---
# Single-column FKs on multi-tenant children accept cross-tenant ids

**Context:** `jobOperationBatch` shipped with `locationId`/`processId`/`workCenterId` FKs referencing only the parent's `id`. The `batch-operations` edge fn wrote `payload.locationId`/`workCenterId` straight into the row after `requirePermissions` — which authorizes the CALLER for a company, not the record ids in the body.

**Problem:** A single-column FK checks only that the id EXISTS, so a company-A row pointing at company-B's location/work center satisfies it, and a service-role edge fn bypasses RLS — the write lands, mis-filing the batch and stamping foreign work centers onto job operations. Nothing fails until an export or a human notices.

**Rule:** In a server function, re-read every payload record id under `companyId` and refuse on a miss (`assertCompanyRecords`, `apps/erp/app/modules/shared/shared.service.ts`). Structurally, make tenant-scoped FKs composite — `(<col>, "companyId") REFERENCES parent(id, "companyId")` — adding `UNIQUE (id, "companyId")` on parents whose PK is single-column, and using PG15 `ON DELETE SET NULL (<col>)` for nullable FKs so `companyId` survives. Precedents: `20260703143904_composite-tenant-fks.sql`, `20260901132702_batch-composite-tenant-fks.sql`.

**Applies to:** postings (`apps/erp/app/modules/*/*.service.ts`) taking record ids in the input; any migration adding an FK from a `companyId`-scoped table to another tenant-scoped parent.
