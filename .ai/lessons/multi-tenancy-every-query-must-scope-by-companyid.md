---
paths: ["apps/erp/app/modules/*/*.service.ts"]
triggers: ["selectFrom(", "updateTable(", "deleteFrom("]
promoted: null
---
# Multi-tenancy: every query must scope by companyId

**Context:** Writing service functions that query the database.

**Problem:** Forgetting to include `.eq("companyId", companyId)` in a query exposes cross-tenant data. RLS provides a safety net, but defense in depth requires application-level scoping too.

**Rule:** Every database query in a service function MUST include `companyId` scoping. Never rely solely on RLS for tenant isolation — treat it as a backup, not the primary guard.

**Applies to:** All `*.service.ts` files, any Kysely or Supabase query.
