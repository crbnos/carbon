---
paths: []
triggers: []
promoted: null
---
# Composite (`id, companyId`) FKs break PostgREST `alias:column(...)` embeds

**Context:** RFQ supplier linking silently failed — `getPurchasingRFQSuppliersWithLinks` / `getPurchasingRFQSuppliers` (`purchasing.service.ts`) returned an empty `suppliers` array even though the `purchasingRfqSupplier` row existed, so the Properties multiselect never showed linked suppliers and an optimistic add reverted on revalidation.

**Problem:** The embed `.select("*, supplier:supplierId(id, name)")` uses the `alias:foreignKeyColumn(...)` disambiguation form. That only resolves when `supplierId` is a **single-column** FK. Multi-tenant FKs here are **composite** — `purchasingRfqSupplier_supplierId_fkey FOREIGN KEY ("supplierId","companyId") REFERENCES supplier(id,"companyId")` — so PostgREST returns `PGRST200: Could not find a relationship ... 'supplierId' ... Perhaps you meant 'supplier'`. The whole query errors, `data` is null. Loaders that do `result.data?.map(...) ?? []` (and never check `result.error`) swallow it as "no rows". Same bug hit the nested `supplier:supplierId (*)` inside `supplierQuote:supplierQuoteId(*, ...)` for linked-quote reads.

**Rule:** For a composite-FK relationship, embed by **target table name** — `.select("*, supplier(id, name)")` (or the explicit constraint `supplier:supplier!purchasingRfqSupplier_supplierId_fkey(...)`), never `alias:fkColumn(...)`. Verify a PostgREST embed against the running REST API (`/rest/v1/<table>?select=...` with the service-role key) — PGRST200 is a schema-cache error returned even on empty tables. And when a loader powers UI state, check `.error`, don't `?? []` a failed query into silent emptiness.

**Applies to:** any supabase-js embed on a join table with a composite `(entityId, companyId)` FK — `purchasingRfqSupplier`, `supplierQuote.supplierId`, and siblings; `apps/erp/app/modules/purchasing/purchasing.service.ts`.
