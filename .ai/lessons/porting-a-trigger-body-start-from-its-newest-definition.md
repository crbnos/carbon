---
paths: ["packages/database/src/event-system/handlers/*.sql"]
triggers: ["CREATE OR REPLACE FUNCTION", "sync_insert_company_related_records"]
promoted: null
---
# Porting a trigger body: start from its newest definition

**Context:** The event-system port (`20260410031811_remaining-interceptors.sql`) turned `insert_company_related_records` into the interceptor `sync_insert_company_related_records` (found 2026-10-24).

**Problem:** The interceptor inserts `companySettings` with only its id. The trigger it replaced also set `useMetric` from the company's country (`20250725212215_metric-default.sql`) and created the two billing address rows (`20260304112615_purchasing-info.sql`). For six months every new company started imperial, and nothing failed: the column has a default and the address reads use `maybeSingle`.

**Rule:** Before porting a function, find its newest definition (`grep -l "FUNCTION <name>" migrations/*.sql | tail -1`) and carry every statement across, or drop one on purpose with a note. A behavior that only sets a default value has no test to fail when it is lost: pin it with one (`seed-company.test.ts` pins `useMetric` per country).

**Applies to:** `packages/database/src/event-system/handlers/*.sql`, any migration that replaces a trigger function.
