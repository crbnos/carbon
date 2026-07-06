# Lessons Learned

Recurring patterns and mistakes to avoid. Review at session start for relevant tasks.

Format: `Context → Problem → Rule → Applies to`

---

## ioredis retryStrategy returning null kills auto-recovery

**Context:** Making the Redis client (`@carbon/kv`) resilient to outages (issue #1076).

**Problem:** A `retryStrategy` that returns `null` after N attempts (e.g. `if (times > 3) return null`) tells ioredis to **stop reconnecting permanently**. Once Redis is briefly unreachable the client gives up and every later command fails with "Connection is closed." even after Redis is healthy again — the app never recovers without a process restart. Command-level timeouts/try-catch cannot fix this; it is a connection-lifecycle setting. Unit tests with `ioredis-mock` do NOT catch it — only a real kill-and-restart test does.

**Rule:** For long-running servers, `retryStrategy` must keep reconnecting with capped backoff (`min(times * 200, 5000)`) and never return null. Bound per-command latency elsewhere (`maxRetriesPerRequest` + a timeout wrapper), not by abandoning reconnection. Verify recovery by stopping and restarting a real Redis, not just mocks.

**Applies to:** `packages/kv/src/client.ts`, `packages/kv/src/resilient.ts`, any ioredis client config.

## Permission scope renames are invisible to typecheck

**Context:** Renaming DB RLS policies (e.g., `plm_*` → `production_*`) as part of a module rename.

**Problem:** The app layer's `requirePermissions()` and `permissions.can()` calls use string literals like `"plm"`. These are invisible to TypeScript's type checker and linter — the rename passes all automated checks but 403s every route at runtime.

**Rule:** When renaming permission scopes, grep the ENTIRE codebase for all string literal references, not just the DB layer. Check `requirePermissions`, `permissions.can`, `usePermissions`, route loaders, and any conditional UI gating.

**Applies to:** Any permission or scope rename, `apps/erp/app/routes/`, `apps/erp/app/modules/`.

## Multi-tenancy: every query must scope by companyId

**Context:** Writing service functions that query the database.

**Problem:** Forgetting to include `.eq("companyId", companyId)` in a query exposes cross-tenant data. RLS provides a safety net, but defense in depth requires application-level scoping too.

**Rule:** Every database query in a service function MUST include `companyId` scoping. Never rely solely on RLS for tenant isolation — treat it as a backup, not the primary guard.

**Applies to:** All `*.service.ts` files, any Kysely or Supabase query.

## ValidatedForm needs the validator, not the raw schema

**Context:** Building forms with zod validation.

**Problem:** Passing a raw zod schema to `ValidatedForm` instead of wrapping it with `validator()` from `@carbon/form` results in silent validation failures — the form submits without client-side validation.

**Rule:** Always use `validator(schema)` from `@carbon/form`, not the raw zod schema. Validate with `validator(schema).validate(formData)`, not `schema.parse()`.

**Applies to:** All forms in `apps/erp/app/routes/`, `packages/form/`.

## Backdated migration timestamps break remote deploys

**Context:** CI `supabase db push --include-all` failed on all remotes with `column pi.balance does not exist` while applying `20260616061244`, which recreated the `purchaseInvoices` view.

**Problem:** A migration merged with a timestamp OLDER than already-deployed migrations gets applied out of order on remotes: the remote had already run `20260630095023` (drops `purchaseInvoice.balance`), so the backdated view recreation referenced a dropped column. Worse, the newer `20260630*` batch had forked its view body from a pre-fix definition, silently reverting the backdated migration's fix (`supplierShippingCost` multiply vs divide) — the backdated migration was both broken AND dead code.

**Rule:** Never merge a migration whose timestamp is older than the newest migration already on `main`/deployed. Before writing a view/RPC recreation, fork from the NEWEST definition of that view (grep all migrations, take the last). When rescuing a failed backdated migration, strip the superseded parts and re-land the still-wanted change in a fresh forward-dated migration; don't rename already-partially-applied files (re-applies them).

**Applies to:** `packages/database/supabase/migrations/`, `ci/src/migrations.ts`, any long-lived branch adding migrations.

## Never resolve a control account by number/name

**Context:** Posting intercompany invoices/payments needed the "Inter-Company Receivables" control account. The edge functions (`post-sales-invoice`, `post-payment`) fetched it with `.eq("number", "1130")`.

**Problem:** Account `number` and `name` are user-editable at any time. Resolving a control account by a hardcoded number silently mis-posts the moment someone renumbers/renames the account — no error, wrong GL account. It also duplicates a magic constant across posting paths that can drift.

**Rule:** Resolve internal/control accounts by **id** via a column on `accountDefault` scoped to the `companyId` (the same pattern as `receivablesAccount`/`payablesAccount`). If no default column exists, add one to `accountDefault` (+ seed it in `seed.data.ts` and `seed-company`, + one-time backfill migration resolving the seeded number → id), then read `ad.<xxx>Account`. The only legitimate uses of `.where("number"/"eq("number")` on `account` are: building the chart at seed time, and mapping **external** codes in an integration (e.g. Xero AccountCodes) — never resolving an internal control account at posting time.

**Applies to:** `packages/database/supabase/functions/post-*`, `close-job`, `issue`, anything posting to `journalLine`; `accountDefault` schema + `lib/seed.data.ts`.

## Chart-of-accounts group headers have no number — resolve parents by name/key

**Context:** `20260524143827_fixed-assets.sql` seeded a "Deferred Tax Expense" (7090) account for every existing company group, resolving its parent with `number = '7000' AND "isGroup" = true`.

**Problem:** Group header accounts in Carbon's chart carry `number = NULL` (they are identified by seed key/name, e.g. `other-expenses` / "Other Expenses") — only leaf posting accounts have numbers. The lookup silently returned NULL and the account was inserted with `parentId = NULL`, leaving it orphaned at the root of the chart for every pre-existing company. New companies were unaffected because `seed.data.ts` parents via `parentKey`. The bug is invisible in dev (fresh seeds go through `seed.data.ts`) and only shows on long-lived databases.

**Rule:** In migrations that insert `account` rows, resolve the parent group by `"isGroup" = TRUE AND name = '<Group Name>'` (optionally + class), never by number — and treat a NULL parent as an error or explicit fallback, never insert silently orphaned. `20260630093809_ar-ap-payments.sql` is the correct precedent. When a past migration did orphan accounts, ship a follow-up UPDATE re-parenting `parentId IS NULL` rows to the group `seed.data.ts` assigns (see `20260702192816`).

**Applies to:** `packages/database/supabase/migrations/` touching `account`; `packages/database/supabase/functions/lib/seed.data.ts`; anything walking the chart-of-accounts tree.

## Client-side entity caches must be company-keyed in a multi-tenant app

**Context:** A prod company export failed its closure guard: a `salesOrder` (and its `opportunity`) in one company referenced another company's customer. Root cause chain: `RealtimeDataProvider` (ERP + MES) cached the customer/item/supplier/people lists in IndexedDB under **global** keys (`"customers"`), and company switching is a client-side navigation — so after a switch, the previous company's cached list could hydrate the pickers before the properly-scoped server fetch landed. Nothing downstream caught the bad pick: zod validated `customerId` as a bare string, services inserted it blindly, RLS only checks the row's own `companyId`, and the FK was single-column (`customerId → customer(id)`).

**Problem:** Any client cache (IndexedDB/localforage, localStorage, nanostores hydrated from them) that isn't keyed by `companyId` becomes a cross-tenant leak the moment a multi-company user switches companies without a full reload. Multi-company users legitimately pass RLS for both companies, so no server layer notices.

**Rule:** (1) Key every persisted client cache entry by company (`customers:${companyId}`) and guard async hydration callbacks against mid-flight company switches. (2) Tenant-scoped references between tables should be composite FKs `(refId, companyId) → parent(id, companyId)` so the DB rejects cross-company refs from every write path (see `20260703143904_composite-tenant-fks.sql`, which converts customer/supplier refs introspectively and tolerates pre-existing bad rows via NOT VALID + warning).

**Applies to:** `apps/{erp,mes}/app/components/RealtimeDataProvider.tsx`, `apps/erp/app/stores/*`, any new client-side cache; migrations adding FKs to company-scoped parents.
