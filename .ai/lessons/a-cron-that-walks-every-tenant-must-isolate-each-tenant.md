---
paths: ["packages/jobs/src/inngest/functions/**/*sweep*.ts", "packages/jobs/src/inngest/functions/**/accounting-reconciliation*.ts", "packages/jobs/src/inngest/functions/**/accounting-consolidation*.ts", "packages/jobs/src/inngest/functions/scheduled/mrp.ts", "packages/jobs/src/inngest/functions/integrations/accounting-auth-failure.ts"]
triggers: ["runIsolatedCompanyStep", "AccountingAuthError", "cron:"]
promoted: null
---
# A cron that walks every tenant must isolate each tenant

**Context:** `accounting-pull-sweep` looped `for (target of targets) await step.run(...)` over every active accounting integration; `mrp` ran every company inside ONE `step.run`. One Xero tenant's refresh token died (`invalid_grant` "Refresh token not found"); one MRP run outgrew Vercel's function timeout.

**Problem:** An Inngest step that exhausts its retries throws into the function and fails the run, so the dead-token company silently skipped every company after it on every sweep — for weeks, with no notification. The single-step MRP was one Vercel invocation for all tenants, timed out, and every retry restarted from company #1. In both cases the run's status said what happened to the run, not to the tenants.

**Rule:** One `step.run` per tenant, wrapped in `try/catch` that records `{ error }` and continues; return the per-tenant outcomes so the run output says who failed. Classify terminal failures (a refused OAuth grant is `AccountingAuthError`) and return them from the step instead of throwing — retries cannot fix them and only delay the next tenant. Pair the per-tenant step with a `maxDuration` on the serve route: a step's ceiling is that function's ceiling.

**Applies to:** `packages/jobs/src/inngest/functions/**` — every cron with a per-company loop (`accounting-*-sweep`, `accounting-reconciliation`, `accounting-consolidation`, `scheduled/mrp.ts`); use `runIsolatedCompanyStep` (`integrations/accounting-auth-failure.ts`) for the accounting ones.
