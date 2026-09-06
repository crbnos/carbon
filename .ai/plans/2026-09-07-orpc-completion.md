# Carbon API oRPC — completion (MCP + agent on `call()`, API-key cache, parity tests)

Branch: `feat/carbon-api-orpc`. Continuation of `.ai/plans/2026-09-04-carbon-api-orpc.md`
(Part A HTTP transport + Part B docs are done and committed). This plan covers ONLY the
remaining unchecked Part A work. Read the parent plan's "Verified grounding facts" and
locked decisions before starting; decision 4 (the oRPC router is the single canonical
execution layer) is what this plan finishes.

Concurrent change, do NOT touch: `resolveAuth`'s OAuth branch in
`apps/erp/app/routes/api+/mcp+/_index.ts` is gaining a Redis rate limit (60/min per user,
`@carbon/kv` `Ratelimit`) in a separate change. Every edit this plan makes to that file is
additive and outside the OAuth branch's body (Task 5, step 2) — if you hit a merge
conflict there, keep BOTH: the rate-limit call and the two extra context fields.

## Status of the parent plan's unchecked items (verified against code 2026-09-07)

| Parent plan item | Real state |
|---|---|
| Phase 0 spike (deps, splat route, converter) | DONE — `@orpc/*` pinned `^1.15.0` in `pnpm-workspace.yaml` catalog; `apps/erp/app/routes/api+/v1+/$.ts` + `openapi[.]json.ts` live; 8 assertions in `apps/erp/app/routes/api+/v1+/lib/orpc-mechanics.test.ts` green. Checkboxes were never ticked. |
| Phase 1 `scripts/lib/service-metadata.ts` + `permission` field | DONE (1029 lines, `derivePermission` at ~line 635, `PERMISSION_MODULE_MAP`, empty `PERMISSION_OVERRIDES`). **Missing: the unit test of the mapping + the ~20-op spot-check** → Task 8. |
| Per-module manifest shards (line ~206, `[~]`) | **DEFERRED — see D1.** |
| `packages/api` + turbo wiring | DONE (`//#generate:mcp` root task; `typecheck`/`build`/`test` depend on it; `tool-metadata.json` gitignored; `tool-manifest.digest.json` + `pnpm check:manifest` + pre-commit gate). |
| Phase 2 server files | DONE, but laid out differently from the sketch: no `api+/lib/operation-gate.server.ts` and no per-module `lib/modules/*.server.ts` — the gate lives in `lib/base.server.ts` and the whole router is built at module load from the manifest in `lib/router.server.ts`. That is equivalent; do not "fix" it. |
| MCP `call_tool` + agent on `call()` | **NOT DONE** → Tasks 4–7. |
| API-key auth cache | **NOT DONE** → Tasks 2–3. |
| Parity tests | **NOT DONE** → Task 1 (+ converted in Task 7). |
| Live smoke (200/403/404/429, MCP JSON-RPC) | **NOT DONE** (the earlier attempt was blocked by a stale `.env.local`) → Task 9. |

## Grounding facts discovered while planning (trust these; re-verify line numbers)

1. **There is a THIRD caller of `executeFunction`, which the parent plan never mentions:**
   `apps/erp/app/routes/api+/inngest.ts:34` does `setWorkflowDispatch(executeFunction)`.
   `packages/jobs/src/workflows/actions/create.ts` runs every workflow `*.create` action
   through it. Deleting `executeFunction` without migrating this breaks customer workflows.
   Good news: `create.ts` already tolerates an unwrapped payload — it checks
   `envelope.error` first, then `idIn(envelope.data ?? result.data)`, and `idIn` walks
   arrays — so a `{ success, data }` result carrying UNWRAPPED data works unchanged.
   The four `call` ids in `packages/workflows/src/catalog/actions.ts` are
   `production_insertJob`, `quality_insertIssue`, `purchasing_insertPurchaseOrder`,
   `sales_insertSalesOrder` — all `insert*`, so none carries `_operation`.
2. **Blocked tools are already absent from the manifest.**
   `scripts/lib/service-metadata.ts:935` skips `MCP_BLOCKED_TOOL_NAMES`, so they never
   reach `OPERATIONS` and therefore never reach the router. The runtime denylist checks in
   `server.ts` and `agent.tools.ts` are the only ones that produce the "Tool disabled"
   message — keep them.
3. **`apps/erp/app/routes/api+/mcp+/_index.ts` declares its OWN local `McpContext`**
   (lines 32–37, `SupabaseClient` untyped) that duplicates the one in `lib/types.ts`
   (`SupabaseClient<Database>`). `getUserScopedClient` returns `SupabaseClient<Database>`,
   so collapsing them onto `AuthedContext` typechecks.
4. **`dispatch.server.ts` already IS the shared bridge** — it imports
   `functionRegistry` / `enrichWithAuthContext` / `extractOperation` / `ExecutorContext`
   *from* `../../mcp+/lib/direct-executor`. The dependency currently points the wrong way
   (canonical layer → legacy executor); Task 4 inverts it.
5. **`getCompanyIdFromAPIKey` has exactly two callers**:
   `packages/auth/src/services/auth.server.ts:237` (inside `requirePermissions`) and
   `apps/erp/app/routes/api+/v1+/lib/authenticate.server.ts:46`. So ONE HTTP API call
   already does two `apiKey` selects today.
6. **`apps/erp/app/modules/settings/index.ts` does NOT export `settings.server.ts`** —
   safe home for `@carbon/kv` cache busting. `apps/erp/app/modules/agent/index.ts` DOES
   re-export `agent.tools`, but no client component imports `~/modules/agent` (only the
   four resource routes under `routes/api+/agent+/`), which is why today's transitive
   `~/services/database.server` import already builds. Task 6 adds an explicitly
   `.server`-named import there — the `pnpm --filter erp build` in Task 9 is what proves
   the `react-router:dot-server` plugin still accepts it.
7. `oncePerRequest` (`packages/logger/src/context.server.ts:86`) is a pass-through when
   there is no request context (jobs, tests) — safe to use unconditionally.
8. `tool-metadata.json` is now **1.9 MB** (was 1.3 MB before response schemas landed) with
   **8 importers**: `mcp+/lib/{server,direct-executor,manifest,manifest.test}.ts`,
   `v1+/lib/operations.server.ts`, `modules/agent/{agent.tools,agent.prompt}.ts`,
   `apps/erp/test/mcp-tool-metadata.test.ts`, plus `docs/scripts/generate-api-docs.mjs`
   and `scripts/check-workflow-catalog.ts` reading it from disk.

## Decisions taken in this plan (do not relitigate mid-execution)

**D1 — Per-module manifest shards: DEFER, explicitly.** The parent plan's `[~]` item stays
open, with the deferral now on record instead of "partial".
*Why:* the two problems sharding was meant to solve are gone — commit churn (the file is
gitignored, with `tool-manifest.digest.json` + `pnpm check:manifest` giving reviewers a
one-line-per-operation contract diff) and tsserver inference (every consumer already casts
through `ManifestEntry`). What remains is a mechanical rewrite of 8 importers plus the
generator, the digest, the docs generator and the workflow-catalog checker — a broad blast
radius landing in the same PR as a production auth/behaviour change, for no user-visible
gain. Docs Phase 2 already has to touch the docs generator and `@carbon/api` to merge the
OpenAPI spec with the manifest; sharding belongs there.
*Trigger to revisit (record it in the parent plan):* do it when EITHER `pnpm exec turbo run
typecheck --filter=erp` regresses measurably against the manifest, OR the erp server bundle
carries the manifest more than once, OR the file passes ~4 MB. Note the size for the record:
1.9 MB today.

**D2 — The workflow dispatcher migrates too.** `callOperation` (the shim built in Task 4)
becomes the single entry point for all three non-HTTP callers: MCP `call_tool`, the in-app
agent, and `setWorkflowDispatch`. Only then can `direct-executor.ts` be deleted.

**D3 — `AuthedContext.authKind` gains a third value: `"session"`.** The in-app agent and the
workflow engine run as an already-authorized user (route `requirePermissions` / the
workflow owner's client). Reusing `"oauth"` for them would overload a wire-protocol name
with "trust me"; `"session"` says what it means. The gate condition stays
`authKind === "api-key"` — unchanged behaviour for both existing kinds.

**D4 — Output/error parity mapping (MCP `call_tool` text must stay byte-identical).**

| Case | Today (`executeFunction` + `server.ts`) | After (`callOperation` + `server.ts`) |
|---|---|---|
| Supabase result, no error | `JSON.stringify(result.data.data, null, 2)` (count dropped) | `JSON.stringify(result.data, null, 2)` (count dropped) — identical |
| Supabase result, `data: null` | `"null"` | `"null"` (the check is `data === undefined`, not falsiness) |
| Supabase result, `error` set | `Database error: ${JSON.stringify(error)}`, `isError` | identical — `dispatchOperation` attaches the raw error as `ORPCError.data.supabase`, `callOperation` returns `errorKind: "database"` and `server.ts` prints it without the `Error: ` prefix |
| Non-Supabase truthy result | `JSON.stringify(result.data, null, 2)` | identical |
| Non-Supabase `undefined` result | `"Operation completed successfully"` | identical |
| Non-Supabase falsy scalar (`0`/`""`/`false`) | `"Operation completed successfully"` | `"0"` / `""` / `"false"` — **accepted delta**, strictly more informative; no service in the registry returns a bare scalar |
| Service throws | `Error: ${error.message}` | identical (`callOperation` catches; `errorKind: "execution"`) |
| Blocked tool | `Tool disabled: ${name} is not available via MCP.` | identical (denylist check stays in `server.ts`, and is repeated in `callOperation`) |
| Unknown name | `Error: Function not found: x in module y` (thrown, caught by `withErrorHandling`) | `Error: Operation not found: ${name}` — **accepted delta**, wording only |
| `arguments` as an unparseable JSON string | `Invalid JSON arguments` | identical |

Side effect on HTTP, accepted deliberately: a Supabase failure's 400 body now carries
`data.supabase` (Postgres `code`/`details`/`hint`) alongside the message — the same fields
Supabase's own REST API returns, and a real improvement for API integrators.

**D5 — Blocked tools get belt-and-braces enforcement.** Manifest exclusion is the primary
gate; add (a) an `ORPCError("NOT_FOUND")` throw in `gate()` for any entry whose name is
blocked, and (b) a test asserting no `MCP_BLOCKED_TOOL_NAMES` entry appears in `OPERATIONS`.
If exclusion ever regresses, the surface stays closed instead of silently opening.

**D6 — Changelog note (required, from the parent plan's risk list):** after Task 5, an MCP
caller authenticating with an **API key** is subject to the per-operation scope gate.
Under-scoped keys that RLS previously allowed now get 403. OAuth connector sessions are
unaffected. This must appear in the PR description and the release notes.

---

## Task 1 — Parity harness: pin `executeFunction` vs the oRPC dispatch, A/B, before anything moves

Test-first. This test is the contract the rest of the plan must not break; it runs against
BOTH implementations while both still exist.

**Files**
- Create `apps/erp/app/routes/api+/v1+/lib/dispatch-parity.test.ts`.

**Steps**
1. Mock the service layer, not the manifest. At the top of the file:
   - `vi.mock("~/services/database.server", () => ({ getDatabaseClient: () => FAKE_DB }))`
     where `const FAKE_DB = { __kysely: true }`.
   - `vi.mock("../../mcp+/lib/direct-executor", ...)` is **NOT** allowed — the point is to
     exercise the real one. Instead build the fake service namespaces by mocking the module
     that owns them. Since Task 4 has not run yet, mock the two service modules used by the
     exemplars directly, e.g.
     `vi.mock("~/modules/accounting/accounting.ee.service", () => ({ getAccountLedger: spy, upsertAccount: spy }))`,
     `vi.mock("~/modules/sales/sales.service", () => ({ upsertQuoteLinePrices: spy }))`,
     `vi.mock("~/modules/inventory/inventory.service", () => ({ generateInventoryCountLines: spy }))`.
     Every spy records `(...args)` and returns a scripted result.
   - Mock the remaining 12 service modules with `{}` so `direct-executor`'s namespace
     imports don't drag real app code into the test.
2. Use REAL manifest entries (`OPERATIONS` from `./operations.server`) — never hand-written
   metadata — for these exemplars, chosen to cover every dispatch branch:
   | Exemplar | `serviceParams` | Covers |
   |---|---|---|
   | `accounting_getAccountLedger` | `["client","args"]` | READ, `args` passthrough, Supabase unwrap incl. `count` |
   | `accounting_getTrialBalance` | `["client","companyGroupId","companyId","args"]` | context positional params |
   | `accounting_upsertAccount` | `["client","account"]`, `injectAuth ["companyId","createdBy","updatedBy"]`, `_operation` required | `_operation` create/update, `createdBy` suppression on update, named-param stamping |
   | `sales_upsertQuoteLinePrices` | `["db","companyId","quoteId","lineId","quoteLinePrices"]` | Kysely `db` injection + per-element `createdBy` on an ARRAY payload |
   | `inventory_generateInventoryCountLines` | `["db","args"]` | `db` as first param |
   | `account_upsertNotificationPreference` | `["client","preference"]`, `permission.module === null` | the null-permission gate path |
3. Case table (each case asserted against `executeFunction(name, ctx, args)` AND against
   `dispatchOperation(meta, ctx, args)`, comparing the captured service arguments
   element-by-element, plus the mapped result per D4):
   a. `args` passthrough and `client` from context.
   b. `_operation: "create"` at top level → stripped from the payload, `createdBy = userId`,
      `updatedBy = userId`, `companyId` stamped.
   c. `_operation: "update"` nested inside `{ args: {...} }` → stripped from the nested
      object, `createdBy` **deleted**, `updatedBy` stamped.
   d. Caller-supplied `createdBy` on an update → removed (no forged attribution).
   e. Conflicting `_operation` values (top level `create`, nested `update`) → rejected
      before the service is called; service spy not invoked.
   f. Missing/invalid `_operation` on a tool that requires it → rejected, service spy not
      invoked.
   g. Array payload + create → EVERY element gets `createdBy`, stamped AFTER the spread;
      non-object elements pass through untouched; `companyId`/`updatedBy` NOT added to
      elements.
   h. Array payload + update → array returned untouched.
   i. `db` param → `getDatabaseClient()` value injected at the right position.
   j. Thenable-but-not-Promise result (a fake `{ then(res){res({data:1})} }` standing in for
      a Supabase builder) → awaited.
   k. Supabase `{ data: null, error: { message, code, details, hint } }` → `executeFunction`
      returns `{success:true, data:{error}}` and `server.ts` would print `Database error: …`;
      `dispatchOperation` throws `ORPCError("BAD_REQUEST")` whose `.data.supabase` deep-equals
      the raw error and whose `.message` is `error.message`.
   l. Single-key payload whose key matches no param → unwrapped positionally.
   m. Flat-field payload matching no param → whole object passed positionally.
   n. Supabase `{ data, count }` → `count` preserved on the dispatch result.
4. Add the D5 guard in the same file:
   `it("excludes every blocked tool from the operation catalog")` — for each
   `MCP_BLOCKED_TOOL_NAMES` entry, `expect(operationsByName.has(name)).toBe(false)`.

**Verify**
```bash
pnpm --filter erp exec vitest run app/routes/api+/v1+/lib/dispatch-parity.test.ts
```
Expected: all cases pass on the FIRST run against both implementations, printing
`Test Files 1 passed` and ≥ 15 assertions. A failure here means the ported dispatch already
diverges from `executeFunction` — STOP and report the diverging case; do not adjust the
expectation to match the new code.

---

## Task 2 — API-key auth cache (~30s, `@carbon/kv`)

**Files**
- Create `packages/auth/src/services/api-key.server.ts`.
- Modify `packages/auth/src/services/auth.server.ts`.
- Create `packages/auth/src/services/api-key-cache.test.ts`.

**Steps**
1. New module `api-key.server.ts`:
   - `const API_KEY_CACHE_PREFIX = "apikey:auth:"; const API_KEY_CACHE_TTL_SECONDS = 30;`
   - `export function apiKeyCacheKey(keyHash: string)` → `` `${API_KEY_CACHE_PREFIX}${keyHash}` ``.
   - `export async function getApiKeyRecord(rawKey: string): Promise<ApiKeyRecord | null>`:
     hash the key with the existing `hashApiKey`; wrap the whole body in
     `oncePerRequest(\`apikey:${keyHash}\`, …)` from `@carbon/logger/middleware.server`
     (per-request memo collapses the double lookup noted in grounding fact 5 — this is NOT
     `oncePerRead`, but the memoized value is a credential row read at the very start of the
     request, and the request is authenticated *by* that credential);
     then: Redis `get` inside try/catch (log and fall through on error, mirroring
     `loadUserClaims` in `users.server.ts`) → `"null"` means a cached negative → return
     `null`; a JSON payload → return it; on a miss run the same service-role select as
     today's `getCompanyIdFromAPIKey`, then `redis.set(key, JSON.stringify(row ?? null),
     "EX", API_KEY_CACHE_TTL_SECONDS)` best-effort (a failed write must never abort the
     request) and return the row.
     Negative results ARE cached (a bad key hammering the endpoint must not hammer Postgres);
     the same ≤ TTL staleness applies.
   - `export async function bustApiKeyCache(keyHash: string): Promise<void>` — `redis.del`,
     errors swallowed and logged.
   - Move the `ApiKeyRecord` type here and re-export it from `auth.server.ts` so no consumer
     import path changes.
2. In `auth.server.ts`:
   - Re-export from the new module so `@carbon/auth/auth.server` stays the only subpath
     consumers use (do NOT add a new `exports` subpath — see the "new package exports subpath
     500s until every dev server restarts" lesson):
     `export { getApiKeyRecord, bustApiKeyCache, apiKeyCacheKey } from "./api-key.server";`
   - Reimplement `getCompanyIdFromAPIKey` over the cache, keeping its `{ data, error }`
     return shape (both callers only read `.data`):
     `const data = await getApiKeyRecord(apiKey); return { data, error: data ? null : new Error("API key not found") };`
     — it must stay `async`-compatible with `await getCompanyIdFromAPIKey(...)` at line 237.
   - Nothing else in the carbon-key branch changes: the rate-limit counter
     (`checkApiKeyRateLimit`) stays UNCACHED, `lastUsedAt` stays fire-and-forget, expiry /
     scope / plan checks keep running on every request against the (possibly cached) row.
3. Test `api-key-cache.test.ts`, modelled on
   `packages/auth/src/services/auth-redis-resilience.test.ts` (copy its `vi.mock("@carbon/kv")`
   and `vi.mock("../config/env")` preamble verbatim), with `getCarbonServiceRole` mocked to a
   chainable stub that counts `single()` calls:
   - miss → one DB read, one `redis.set` with `"EX", 30`;
   - hit (redis `get` returns the JSON) → **zero** DB reads;
   - unknown key → `null` returned AND `"null"` written to Redis; a second call does zero DB reads;
   - Redis down (`get`/`set` resolve `null`) → falls through to the DB, returns the row, does not throw;
   - `bustApiKeyCache("abc")` → `redis.del` called with `apikey:auth:abc`.

**Verify**
```bash
pnpm --filter @carbon/auth exec vitest run src/services/api-key-cache.test.ts
pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp
```
Expected: 5 passing tests; typecheck clean for both packages.

Measurement (a memo is a performance claim — run it, or defer it to Task 9 and record the
numbers there; requires the user's running `crbn up` stack, never rebuild the DB):
```bash
redis-cli -u "$REDIS_URL" monitor | grep --line-buffered apikey:auth &
for i in 1 2 3 4 5; do curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $CARBON_TEST_KEY" -H 'content-type: application/json' \
  -d '{}' "$ERP_URL/api/v1/shared/getCustomFieldsList"; done
```
Expected: exactly ONE `SETEX`/`SET … EX 30` and the remaining calls served by `GET` hits;
five `200`s. Before the change the same loop produces 10 `apiKey` selects (two per request).

---

## Task 3 — Bust the cache when a key is edited or revoked

**Files**
- Modify `apps/erp/app/modules/settings/settings.server.ts` (server-only; NOT in the module barrel).
- Modify `apps/erp/app/routes/x+/settings+/api-keys.$id.tsx`.
- Modify `apps/erp/app/routes/x+/settings+/api-keys.delete.$id.tsx`.
- Create `apps/erp/app/modules/settings/api-key-cache-bust.test.ts`.

**Steps**
1. In `settings.server.ts` add:
   ```ts
   export async function invalidateApiKeyCache(
     client: SupabaseClient<Database>,
     id: string
   ): Promise<void> {
     const { data } = await client.from("apiKey").select("keyHash").eq("id", id).single();
     if (data?.keyHash) await bustApiKeyCache(data.keyHash);
   }
   ```
   importing `bustApiKeyCache` from `@carbon/auth/auth.server`. Never put this in
   `settings.service.ts` — that file is browser-bundled through `~/modules/settings`.
2. `api-keys.$id.tsx`: after `upsertApiKey` succeeds and BEFORE the redirect, `await
   invalidateApiKeyCache(client, id)`. Scope changes must not lag by 30s.
3. `api-keys.delete.$id.tsx`: call `await invalidateApiKeyCache(client, id)` **before**
   `deleteApiKey(client, id)` — after the delete the row (and its `keyHash`) is gone.
4. `api-keys.new.tsx` needs nothing: a freshly generated random key has no cache entry.
5. Test: mock `@carbon/auth/auth.server`'s `bustApiKeyCache` and pass a fake client whose
   `single()` resolves `{ data: { keyHash: "hash-1" } }`; assert `bustApiKeyCache` called
   once with `"hash-1"`, and that a missing row calls it zero times.

**Verify**
```bash
pnpm --filter erp exec vitest run app/modules/settings/api-key-cache-bust.test.ts
pnpm exec turbo run typecheck --filter=erp
```
Expected: 2 passing tests, clean typecheck.

---

## Task 4 — Invert the dependency: own the registry, own the enrichment, add `callOperation`

No behaviour change in this task; it is pure relocation plus one new entry point.

**Files**
- Create `apps/erp/app/routes/api+/v1+/lib/registry.server.ts`.
- Create `apps/erp/app/routes/api+/v1+/lib/call.server.ts`.
- Modify `apps/erp/app/routes/api+/v1+/lib/dispatch.server.ts`.
- Modify `apps/erp/app/routes/api+/v1+/lib/base.server.ts`.
- Modify `apps/erp/app/routes/api+/mcp+/lib/direct-executor.ts` (temporarily; deleted in Task 7).

**Steps**
1. `registry.server.ts`: move the 15 `import * as …Functions` statements and the exported
   `functionRegistry` object out of `direct-executor.ts` verbatim (including the
   `production: { ...productionFunctions, ...productionMcpFunctions }` merge and its comment).
2. `dispatch.server.ts`:
   - Move `enrichWithAuthContext`, `extractOperation` and `type McpOperation` in from
     `direct-executor.ts` **with their comments intact** — those comments record why
     `createdBy` is stamped after the spread, why array elements get only `createdBy`, and
     why `_operation: "update"` deletes `createdBy`. Do not paraphrase them.
     Keep `AuthField` imported as a type from `@carbon/api`.
   - Change the `context` parameter type from `ExecutorContext` to
     `AuthedContext` (import from `./base.server`); import `functionRegistry` from
     `./registry.server`.
   - Attach the raw Supabase error to the thrown error (D4):
     `throw new ORPCError("BAD_REQUEST", { message: supabaseErrorMessage(r.error), data: { supabase: r.error } });`
   - Export `enrichWithAuthContext` / `extractOperation` so the (still-live)
     `direct-executor.ts` can import them back.
3. `direct-executor.ts` (transitional): delete its copies of `functionRegistry`,
   `enrichWithAuthContext`, `extractOperation`, and import them from
   `../../v1+/lib/{registry,dispatch}.server` instead. `ExecutorContext`, `executeFunction`
   and `searchFunctions` stay for now. This keeps Task 1's parity test exercising ONE copy
   of the enrichment logic from here on.
4. `base.server.ts`: widen `authKind` to `"api-key" | "oauth" | "session"` with a comment
   naming the three callers (D3), and add the D5 blocked-name guard as the first statement of
   `gate`:
   ```ts
   if (isMcpBlockedTool(meta.name)) throw new ORPCError("NOT_FOUND");
   ```
   (import from `../../mcp+/lib/mcp-blocked-tools`).
5. New `call.server.ts` — the ONE server-side entry point for MCP, the agent and workflows:
   ```ts
   export type CallResult =
     | { success: true; data: unknown; count?: number }
     | { success: false; error: string; errorKind: "database" | "execution" };

   export async function callOperation(
     name: string,
     context: AuthedContext,
     args?: Record<string, unknown> | string
   ): Promise<CallResult>
   ```
   Body, in this order (order is the contract — it reproduces `executeFunction`'s):
   1. `args` given as a string → `JSON.parse` a non-empty value, else `{}`; on a throw return
      `{ success: false, error: "Invalid JSON arguments", errorKind: "execution" }`.
   2. `isMcpBlockedTool(name)` → `{ success: false, error: \`Tool disabled: ${name} is not available via MCP.\`, errorKind: "execution" }`.
   3. `operationsByName.get(name)` → the procedure via `router[meta.module]?.[operationId(meta)]`;
      either missing → `{ success: false, error: \`Operation not found: ${name}\`, errorKind: "execution" }`.
   4. `const result = await call(procedure, args ?? {}, { context });` →
      `{ success: true, data: result.data, ...(result.count !== undefined ? { count: result.count } : {}) }`.
   5. `catch (err)`: an `ORPCError` carrying `data.supabase` →
      `{ success:false, error: \`Database error: ${JSON.stringify(err.data.supabase)}\`, errorKind: "database" }`;
      any other error → `{ success:false, error: err instanceof Error ? err.message : "Function execution failed", errorKind: "execution" }`.

**Verify**
```bash
pnpm --filter erp exec vitest run app/routes/api+/v1+/lib/
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/api
```
Expected: `dispatch-parity.test.ts` and `orpc-mechanics.test.ts` both pass unchanged (the
parity test is asserting on relocated code now — that is the point); typecheck clean.

---

## Task 5 — MCP `call_tool` on `call()`

**Files**
- Modify `apps/erp/app/routes/api+/mcp+/lib/types.ts`.
- Modify `apps/erp/app/routes/api+/mcp+/_index.ts`.
- Modify `apps/erp/app/routes/api+/mcp+/lib/server.ts`.

**Steps**
1. `lib/types.ts`: replace the `McpContext` interface with
   `export type McpContext = AuthedContext;` (type-only import from
   `~/routes/api+/v1+/lib/base.server` — erased at runtime, so no server module enters a
   client graph).
2. `_index.ts` — **additive edits only, stay out of the OAuth branch's body** (the
   concurrent rate-limit change lives there):
   - Delete the local `type McpContext = {…}` (lines 32–37) and
     `import type { McpContext } from "./lib/types";`.
   - OAuth branch: add `authKind: "oauth" as const, scopes: {}` to the returned `ctx` object
     literal. Nothing else.
   - carbon-key branch: after `requirePermissions(request, {})`, read the key's scopes —
     ```ts
     const rawKey = request.headers.get("carbon-key") ?? "";
     const { data: keyRow } = await getCompanyIdFromAPIKey(rawKey);
     const scopes = (keyRow as { scopes?: Record<string, string[]> } | null)?.scopes ?? {};
     ```
     and return `{ …, authKind: "api-key" as const, scopes }`. `request` at that point is the
     rewritten one carrying the `carbon-key` header, so this works for both `Bearer crbn_…`
     and a raw `carbon-key`. Thanks to Task 2 this is a Redis hit, not a second DB read.
3. `lib/server.ts` (`// @ts-nocheck` at the top stays — do not attempt to type this file in
   this task):
   - Replace `import { executeFunction } from "./direct-executor";` with
     `import { callOperation } from "../../v1+/lib/call.server";`.
   - Keep the existing `isMcpBlockedTool(name)` early return verbatim.
   - `const result = await callOperation(name, ctx, args);`
   - Replace the whole success-formatting block with, exactly:
     ```ts
     if (result.success) {
       const output =
         result.data === undefined
           ? "Operation completed successfully"
           : JSON.stringify(result.data, null, 2);
       return { content: [{ type: "text" as const, text: output }] };
     }
     return {
       content: [{
         type: "text" as const,
         text: result.errorKind === "database" ? result.error : `Error: ${result.error}`
       }],
       isError: true
     };
     ```
   - Leave `search_tools` / `describe_tool` untouched — they read the manifest, which is
     unchanged.

**Verify**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm --filter erp exec vitest run app/routes/api+/
```
Expected: clean typecheck; all MCP/v1 tests green. Live MCP verification is Task 9 — do not
declare this task done on typecheck alone, but do commit it (the live sweep covers Tasks 5–7
together).

---

## Task 6 — In-app agent on `call()`

**Files**
- Modify `apps/erp/app/modules/agent/agent.tools.ts`.
- Modify `apps/erp/app/modules/agent/agent.service.ts`.
- Create `apps/erp/app/modules/agent/agent.tools.test.ts`.

**Steps**
1. `agent.tools.ts`:
   - Replace the `direct-executor` import with
     `import type { AuthedContext } from "~/routes/api+/v1+/lib/base.server";` and
     `import { callOperation } from "~/routes/api+/v1+/lib/call.server";`.
   - `createAgentTools(ctx: AuthedContext)` and `createDataTools(ctx: AuthedContext)`.
   - `call_tool.execute`: keep the READ-index guard EXACTLY as it is (the safety property
     lives in that lookup — see the comment at the top of the file, keep it), then
     `return callOperation(name, ctx, args as Record<string, unknown> | undefined);`.
   - Leave the `toolMetadata` import (the READ index) alone — D1 defers that move.
2. `agent.service.ts`: add `authKind: "session" as const, scopes: {}` to the `ctx` object
   literal (~line 237).
3. Test: with `callOperation` mocked, assert (a) a non-READ tool name returns
   `{ error: 'Tool "…" is not available.' }` and never calls `callOperation`; (b) a blocked
   name likewise; (c) a READ name forwards `(name, ctx, args)` verbatim and returns the
   `CallResult` unchanged (the model now sees UNWRAPPED `data`, not the Supabase envelope —
   pin it, it is the one intentional agent-facing change, and it is inert while
   `AGENT_DATA_TOOLS_ENABLED` is false).

**Verify**
```bash
pnpm --filter erp exec vitest run app/modules/agent/agent.tools.test.ts
pnpm exec turbo run typecheck --filter=erp
```
Expected: 3 passing tests; clean typecheck.

Escape hatch: if `pnpm --filter erp build` (Task 9) fails with *"Server-only module
referenced by client"* pointing at `agent.tools.ts`, the fix is to drop
`export * from "./agent.tools"` from `apps/erp/app/modules/agent/index.ts` and import it
directly in `agent.service.ts` — NOT to un-suffix any `.server` file. Report before doing it.

---

## Task 7 — Workflow dispatcher on `call()`, then delete `direct-executor.ts`

**Files**
- Modify `apps/erp/app/routes/api+/inngest.ts`.
- Delete `apps/erp/app/routes/api+/mcp+/lib/direct-executor.ts`.
- Modify `apps/erp/app/routes/api+/v1+/lib/dispatch-parity.test.ts`.

**Steps**
1. `inngest.ts`: replace the `executeFunction` import with `callOperation` from
   `./v1+/lib/call.server`, and wire
   ```ts
   setWorkflowDispatch((name, context, args) =>
     callOperation(name, { ...context, authKind: "session", scopes: {} }, args)
   );
   ```
   Keep the lazy `wireWorkflowDispatch()` pattern and its comment exactly — a module-scope
   side effect would drag the server graph into the browser bundle.
   `CallResult` satisfies `WorkflowDispatch` structurally; if TS objects to the union, add a
   small explicit adapter returning `{ success, data, error }` rather than casting.
2. Delete `direct-executor.ts`. `searchFunctions` has no other caller (verified); it goes
   with the file. Confirm zero references remain:
   ```bash
   grep -rn "direct-executor\|executeFunction\|searchFunctions" apps packages scripts .claude docs | grep -v node_modules
   ```
   Expected: only `.claude/rules/*.md`, `packages/jobs/AGENTS.md` and the parent plan file —
   all of which Task 9 rewrites.
3. Convert the parity test: delete the `executeFunction` half of every case, keeping the
   `dispatchOperation`/`callOperation` assertions with the values Task 1 captured (they are
   now golden literals, not comparisons). Add two new cases at this point:
   - `callOperation` with the four workflow `call` ids
     (`production_insertJob`, `quality_insertIssue`, `purchasing_insertPurchaseOrder`,
     `sales_insertSalesOrder`) returns `{ success: true, data }` whose `data` is what
     `packages/jobs/src/workflows/actions/create.ts` `idIn()` can read an `id` out of — assert
     `idIn`-equivalent extraction on both an object and a single-element array result.
   - a Supabase error through `callOperation` returns
     `{ success: false, errorKind: "database", error: 'Database error: {…}' }`.

**Verify**
```bash
pnpm --filter erp exec vitest run app/routes/api+/v1+/lib/
pnpm --filter @carbon/jobs exec vitest run src/workflows/actions/
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs
pnpm run check:workflow-catalog
```
Expected: all green; `check:workflow-catalog` prints its OK line (it reads the manifest from
disk, which is unchanged).

---

## Task 8 — Close out Phase 1: permission-derivation tests + the 20-op spot-check

**Files**
- Create `apps/erp/test/mcp-tool-permissions.test.ts`.
- Modify `scripts/lib/service-metadata.ts` (only if the spot-check finds exceptions).

**Steps**
1. The test runs against the REAL generated manifest (turbo's `test` task already depends on
   `//#generate:mcp`), asserting the mapping rules from the parent plan over all 1495 ops:
   - every `items_*` op has `permission.module === "parts"`;
   - every `account_*` and `shared_*` op has `permission.module === null`;
   - every other module maps to itself;
   - every `READ` op has `actions === ["view"]`;
   - every `delete*` op has `actions === ["delete"]`;
   - every `upsert*` op has `actions === ["create","update"]` (the parent plan's open
     question 2 — the current behaviour; pin it so a change is deliberate);
   - `insert|create|add|new|copy|duplicate|generate*` → `["create"]`;
   - the update-verb list → `["update"]`;
   - every op has a non-empty `actions` array;
   - anything in `PERMISSION_OVERRIDES` wins (assert one entry if any exist).
2. Spot-check ~20 operations against the ERP routes that call them, ONE module at a time:
   ```bash
   grep -rn "<serviceFnName>(" apps/erp/app/routes | grep -v node_modules
   grep -n "requirePermissions" -A 3 <route file>
   ```
   Suggested spread (adjust to what exists): 3 sales, 3 purchasing, 3 items, 2 production,
   2 quality, 2 inventory, 2 accounting, 1 people, 1 resources, 1 settings. Record every
   mismatch as an entry in `PERMISSION_OVERRIDES` in `scripts/lib/service-metadata.ts`, with
   a one-line comment naming the route that proves it, then regenerate.
3. **Escape hatch:** if more than 5 of the 20 mismatch, the verb heuristic is wrong rather
   than incomplete — STOP and report with the list; do not paper over it with 20 overrides.

**Verify**
```bash
pnpm run generate:mcp && pnpm run generate:mcp   # determinism
pnpm run check:manifest
pnpm --filter erp exec vitest run test/mcp-tool-permissions.test.ts
```
Expected: the second `generate:mcp` leaves the digest untouched (`check:manifest` prints its
up-to-date line); all permission assertions pass. If overrides were added, the digest DOES
change on the first run — commit the regenerated digest with the override.

---

## Task 9 — Live smoke on the running stack + doc/rule sync

Requires the user's `crbn up` stack. **Never rebuild or reset the database.** If no stack is
reachable, stop and report — do not mark the plan complete on unit tests alone (the parent
plan already carries one round of "not live-verified").

**Steps**
1. HTTP surface (needs an API key with, say, `sales_view` scoped to the company, and one
   without it):
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$ERP_URL/api/v1/sales/getCustomers" \
     -H "Authorization: Bearer $KEY_WITH_SCOPE" -H 'content-type: application/json' -d '{"args":{"limit":1}}'   # 200
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$ERP_URL/api/v1/sales/getCustomers" \
     -H "Authorization: Bearer $KEY_WITHOUT_SCOPE" -H 'content-type: application/json' -d '{}'                   # 403
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$ERP_URL/api/v1/settings/seedCompany" \
     -H "Authorization: Bearer $KEY_WITH_SCOPE" -H 'content-type: application/json' -d '{}'                      # 404 (blocked)
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$ERP_URL/api/v1/sales/nope" \
     -H "Authorization: Bearer $KEY_WITH_SCOPE" -H 'content-type: application/json' -d '{}'                      # 404 (unknown)
   for i in $(seq 1 70); do curl -s -o /dev/null -w '%{http_code} ' -X POST "$ERP_URL/api/v1/sales/getCustomers" \
     -H "Authorization: Bearer $KEY_WITH_SCOPE" -H 'content-type: application/json' -d '{}'; done                # trailing 429s
   curl -s "$ERP_URL/api/v1/openapi.json" | jq '.paths | length'                                                 # 1495
   ```
2. MCP surface, over JSON-RPC with the SAME key (this is the D6 behaviour change — verify
   both directions):
   ```bash
   curl -s -X POST "$ERP_URL/api/mcp" -H "Authorization: Bearer $KEY_WITH_SCOPE" \
     -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"call_tool","arguments":{"name":"sales_getCustomers","arguments":{"args":{"limit":1}}}}}'
   ```
   Expected: a `content[0].text` JSON array of customers (unwrapped, same as before the
   migration). Repeat with `$KEY_WITHOUT_SCOPE` → `isError: true` and text
   `Error: API key lacks the required scope: sales_view` (the D6 change). Then
   `search_tools` and `describe_tool` once each → unchanged output.
3. A write through MCP that exercises the `_operation` path and the `createdBy` stamp — pick
   a low-risk op on a throwaway record (e.g. `sales_upsertCustomerContact` with
   `_operation: "create"`, then `"update"`), and confirm in the DB that `createdBy` is the
   key's user on the insert and unchanged on the update.
4. `pnpm --filter erp build` — proves the `react-router:dot-server` plugin accepts
   `agent.tools.ts`'s new `.server` import (grounding fact 6).
5. Doc/rule sync (keep-sources-in-sync rule — same commit as the code):
   - `.claude/rules/mcp-tools-reference.md`: rewrite the "How `call_tool` actually runs a
     tool" section — it now runs `callOperation` → `call(router[module][op])` →
     `dispatch.server.ts`; `direct-executor.ts` is gone; the registry lives at
     `api+/v1+/lib/registry.server.ts`; API-key MCP callers are scope-gated (D6); the
     `db`-first-param and `_operation` notes move to `dispatch.server.ts`.
   - `.claude/rules/workflow-actions.md` (the dispatch-seam code block, ~line 91) and
     `packages/jobs/AGENTS.md` (~line 161): the ERP now registers `callOperation`.
   - `.claude/rules/authentication-system.md`: add the 30s API-key cache to the "API key
     auth" section (key shape, TTL, negative caching, busting from the api-keys routes,
     revocation lag ≤ TTL).
   - `.ai/plans/2026-09-04-carbon-api-orpc.md`: tick Phases 0/1/2 and record D1 (shards
     deferred, with the trigger) in place of the `[~]`.
   - `.ai/lessons.md`: add a lesson ONLY if something surprised you (a strong candidate is
     grounding fact 1 — "a shared executor acquires callers you didn't plan for; grep every
     importer before you delete one").
6. PR description + release notes must carry the D6 changelog note.

**Verify**
```bash
pnpm test
pnpm run lint
```
Expected: repo-wide tests green, lint clean, plus the curl/DB results above pasted into the
run log at `.ai/runs/`.

---

## Progress

- [x] T1 — Parity harness: `dispatch-parity.test.ts` A/B against `executeFunction`
- [x] T2 — API-key auth cache (`packages/auth/src/services/api-key.server.ts`, 30s, negative caching)
- [x] T3 — Cache busting from the api-keys route actions + test
- [x] T4 — `registry.server.ts`, enrichment moved into `dispatch.server.ts`, `call.server.ts`, `authKind: "session"`, blocked-name guard in `gate`
- [x] T5 — MCP `call_tool` on `callOperation` (+ `resolveAuth` carries `authKind`/`scopes`)
- [x] T6 — In-app agent on `callOperation`
- [x] T7 — Workflow dispatcher on `callOperation`; `direct-executor.ts` deleted; parity test converted
- [x] T8 — Permission-derivation tests + 20-op spot-check (+ overrides if any)
- [~] T9 — `pnpm --filter erp build` PASSED + doc/rule sync done; live smoke (steps 1–3) BLOCKED: crbn up stack not running (only Redis up, erp.main.dev 502). Changelog note (D6) pending PR.

## Risks and escape hatches

- **Under-scoped API keys start getting 403 on MCP** (D6). Accepted; it is the whole point of
  the shared gate. Mitigation is communication, not code: changelog + release notes. If a
  named customer would break, STOP and get a decision — do not silently exempt MCP.
- **`resolveAuth` merge conflict** with the concurrent OAuth rate-limit change. Keep both
  hunks; the rate limit belongs before the OAuth branch's return, the two context fields
  inside the returned literal.
- **`react-router:dot-server` rejecting `agent.tools.ts`** — escape hatch in Task 6.
- **Router build cost at import**: `router.server.ts` constructs ~1495 procedures at module
  load, and MCP/agent/inngest now all import it. It is a one-time per-process cost that the
  HTTP route already pays. If cold-start time regresses noticeably in Task 9, report it —
  the fix (lazy per-module segments via `os.prefix().lazy()`) is a separate change, not an
  improvisation inside this plan.
- **Error-text drift** in MCP beyond the two accepted deltas in D4 → treat as a parity-test
  failure, not an expectation to update.
- **Cache staleness** on key edit/revoke is ≤ 30s only if Task 3's busting is wired to BOTH
  the update and the delete route; the delete must bust before the row disappears.

## Out of scope (do not fold in)

Per-module manifest shards (D1); Ajv request validation; OAuth bearer auth on `/api/v1`;
READ→GET routing with ETag/Cache-Control; oRPC batch plugin and the MCP `call_tools` batch
meta-tool; typed client outputs; Docs Phase 2 (`operations-data.generated.ts`, HTTP transport
tabs); the `/api-reference` → `/data-api` cutover.
