---
paths: ["apps/erp/app/components/RealtimeDataProvider.tsx", "apps/mes/app/components/RealtimeDataProvider.tsx", "apps/erp/app/stores/**"]
triggers: ["localforage", "indexedDB", "localStorage.setItem"]
promoted: null
---
# Client-side entity caches must be company-keyed in a multi-tenant app

**Context:** A prod company export failed its closure guard: a `salesOrder` (and its `opportunity`) in one company referenced another company's customer. Root cause chain: `RealtimeDataProvider` (ERP + MES) cached the customer/item/supplier/people lists in IndexedDB under **global** keys (`"customers"`), and company switching is a client-side navigation — so after a switch, the previous company's cached list could hydrate the pickers before the properly-scoped server fetch landed. Nothing downstream caught the bad pick: zod validated `customerId` as a bare string, services inserted it blindly, RLS only checks the row's own `companyId`, and the FK was single-column (`customerId → customer(id)`).

**Problem:** Any client cache (IndexedDB/localforage, localStorage, nanostores hydrated from them) that isn't keyed by `companyId` becomes a cross-tenant leak the moment a multi-company user switches companies without a full reload. Multi-company users legitimately pass RLS for both companies, so no server layer notices.

**Rule:** (1) Key every persisted client cache entry by company (`customers:${companyId}`) and guard async hydration callbacks against mid-flight company switches. (2) Tenant-scoped references between tables should be composite FKs `(refId, companyId) → parent(id, companyId)` so the DB rejects cross-company refs from every write path (see `20260703143904_composite-tenant-fks.sql`, which converts customer/supplier refs introspectively and tolerates pre-existing bad rows via NOT VALID + warning).

**Applies to:** `apps/{erp,mes}/app/components/RealtimeDataProvider.tsx`, `apps/erp/app/stores/*`, any new client-side cache; migrations adding FKs to company-scoped parents.
