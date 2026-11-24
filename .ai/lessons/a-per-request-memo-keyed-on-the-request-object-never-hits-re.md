---
paths: []
triggers: []
promoted: null
---
# A per-request memo keyed on the `Request` object never hits — React Router doesn't share one across loaders

**Context:** Perf work on `sid/perf-audit-hot-paths` (2026-08). Every matched route calls `requirePermissions` independently, so a detail page did one Redis GET for permission claims and one `createClient()` per loader. The obvious fix is to memoize per request.

**Problem:** The first attempt was a `WeakMap<Request, …>` — safe-looking, self-evicting, zero call-site changes, and it passed typecheck plus six unit tests asserting "same Request → same value, different Request → different value". It also did nothing: measured with `redis-cli monitor`, claims lookups on a deep page were **4 both with and without it**, because React Router does not hand the same `Request` instance to every matched loader. The unit tests were green precisely because they constructed the shared-Request case the runtime never produces. The working mechanism is AsyncLocalStorage holding React Router's own per-request `RouterContextProvider` (published by a root middleware) — the same pattern `requestIdMiddleware` already used via LogTape's `withContext`. That took the page from 4 lookups to 1.

**Rule:** A memo is a performance claim, and a performance claim needs a measurement, not a unit test — a test can only prove the memo behaves as written, never that its key is stable in production. Before shipping request-scoped caching, count the underlying calls end-to-end (redis `MONITOR`, `pg_stat_statements`, a temporary counter) with the change toggled off and on. Reach for ALS-over-`context` rather than keying on `Request`. And note the corollary: memoizing **database state** must be gated to GET/HEAD/OPTIONS (`oncePerRead`), because React Router runs an action and its loader revalidation in a single request — an ungated memo there serves pre-write data, which for permission claims means a gate passing on permissions the action just revoked.

**Applies to:** `packages/logger/src/context.server.ts` (`oncePerRequest` / `oncePerRead` / `requestContextMiddleware`), `packages/auth/src/services/{auth,users}.server.ts`, and any future request-scoped cache.
