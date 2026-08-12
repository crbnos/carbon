# Phase 4 research — executing background work AS the workflow owner

Branch `feat/automation`. Read-only research. All paths absolute-from-repo-root
(`/Users/aashu/work/carbon/carbon-feat-automation`).

**Headline:** the mechanism already exists and is already wired end-to-end. A
background job in `packages/jobs` can call `getUserScopedClient(ownerId, { workflowRunId })`
today — the package already depends on `@carbon/auth`, the env var is already in the
process, and the `workflow_run_id` claim is already consumed by `dispatch_event_batch()`.
The only thing missing is a caller.

---

## 1. `getUserScopedClient` — full source

`packages/auth/src/lib/supabase/client.server.ts` (37 lines, whole file):

```ts
 1  import type { Database } from "@carbon/database";
 2  import type { SupabaseClient } from "@supabase/supabase-js";
 3  import { SignJWT } from "jose";
 4  import {
 5    SUPABASE_JWT_SECRET,
 6    SUPABASE_SERVICE_ROLE_KEY
 7  } from "../../config/env";
 8  import { getCarbon, getCarbonClient } from "./client";
 9
10  export const getCarbonServiceRole = (): SupabaseClient<Database> => {
11    return getCarbonClient(SUPABASE_SERVICE_ROLE_KEY!);
12  };
13
14  export async function getUserScopedClient(
15    userId: string,
16    options?: { workflowRunId?: string }
17  ): Promise<SupabaseClient<Database>> {
18    if (!SUPABASE_JWT_SECRET) {
19      throw new Error("SUPABASE_JWT_SECRET is required for user-scoped clients");
20    }
21
22    const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
23    const jwt = await new SignJWT({
24      sub: userId,
25      aud: "authenticated",
26      role: "authenticated",
27      ...(options?.workflowRunId
28        ? { workflow_run_id: options.workflowRunId }
29        : {})
30    })
31      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
32      .setIssuedAt()
33      .setExpirationTime("5m")
34      .sign(secret);
35
36    return getCarbon(jwt);
37  }
```

### Facts

| Aspect | Value |
|---|---|
| Signature | `(userId: string, options?: { workflowRunId?: string }) => Promise<SupabaseClient<Database>>` |
| Signing | `jose` `SignJWT`, HS256, secret = `SUPABASE_JWT_SECRET` (UTF-8 bytes) |
| TTL | **5 minutes** (`.setExpirationTime("5m")`), `iat` set via `.setIssuedAt()` |
| Claims | `sub` = userId, `aud` = `"authenticated"`, `role` = `"authenticated"`, **plus `workflow_run_id`** when `options.workflowRunId` is passed. Nothing else — no `email`, no `app_metadata`, no `iss`. |
| Returns | `getCarbon(jwt)` → `getCarbonClient(SUPABASE_ANON_KEY!, jwt)` → `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: "Bearer <jwt>" }, fetch: fetchWithRetry }, auth: { autoRefreshToken: false, persistSession: false } })`. **Anon key + user bearer ⇒ RLS fully enforced.** |
| Env needed | `SUPABASE_JWT_SECRET` (throws if absent), `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| Throws | only on missing `SUPABASE_JWT_SECRET`. It does **not** verify the user exists, is active, or belongs to the company. |

`getCarbon` / `getCarbonClient` — `packages/auth/src/lib/supabase/client.ts:56-76` and `:112-116`:

```ts
56  export const getCarbonClient = (
57    supabaseKey: string,
58    accessToken?: string
59  ): SupabaseClient<Database, "public"> => {
60    const headers = accessToken
61      ? { Authorization: `Bearer ${accessToken}` }
62      : undefined;
63
64    const client = createClient<Database, "public">(SUPABASE_URL!, supabaseKey, {
65      auth: {
66        autoRefreshToken: false,
67        persistSession: false
68      },
69      global: {
70        fetch: fetchWithRetry,
71        ...(headers ? { headers } : {})
72      }
73    });
74
75    return client;
76  };
...
112  export const getCarbon = (
113    accessToken?: string
114  ): SupabaseClient<Database, "public"> => {
115    return getCarbonClient(SUPABASE_ANON_KEY!, accessToken);
116  };
```

`fetchWithRetry` (`client.ts:29-54`): 25 s per-attempt timeout, 2 retries with
500 ms / 1000 ms backoff on 500/502/503/504/512/408/524. Storage uploads bypass it
(`isStorageUpload`, `client.ts:20-27`).

### Consequence for phase 4: the 5-minute TTL

A workflow run that walks many steps will outlive one token. **Mint the client per
step**, not once per run — which the matcher spec already assumes:

> `.ai/specs/2026-07-30-workflows-matcher.md:339` — "The engine mints a client per step
> anyway, so every write through it is tagged automatically and no call site can forget."

Minting is cheap (one HMAC + one `createClient`); there is no network round trip and no
cache to bust.

### The `workflow_run_id` claim is already consumed

`packages/database/supabase/migrations/20260730135206_workflows-run-tag.sql:1-14, 38-40`:

```sql
 1  -- Phase 3 (workflows): tag queue messages with the causing workflow run.
 2  --
 3  -- dispatch_event_batch() gains one payload field, `workflowRunId`, read from
 4  -- the `workflow_run_id` claim on the caller's verified JWT
 5  -- (request.jwt.claims). The workflow engine (phase 4) mints its per-step
 6  -- owner token with that claim, so every write a running workflow makes
 7  -- announces which run made it; a normal user or API token carries no such
 8  -- claim and the field is null. This is what makes the origin filter and the
 9  -- loop guards possible.
...
38    current_actor_id := auth.uid()::TEXT;
39    current_workflow_run_id :=
40      (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'workflow_run_id';
```

Stamped into every pgmq message at lines 88, 119, 150 (`''workflowRunId'', $10`).
Consumed downstream by `packages/jobs/src/inngest/functions/events/queue.ts:119`,
`packages/jobs/src/inngest/functions/events/workflow.ts:14,58`, and
`packages/jobs/src/workflows/matcher.ts:16-18, 70, 84, 160-183` (origin filter
`Automation` vs `Person`, and the loop guards).

Note this only works because PostgREST verified the JWT with the same
`PGRST_JWT_SECRET`; a service-role client would produce `workflow_run_id = NULL` and
`auth.uid() = NULL`, i.e. an untraceable, unfiltered write. **This is the concrete
reason phase 4 cannot use service role.**

**Grep result: `getUserScopedClient` has exactly 3 call sites today** (plus its own
definition) — `apps/erp/app/routes/api+/mcp+/_index.ts:81`,
`apps/erp/app/routes/download.$token.tsx:40`, and a doc reference in
`packages/auth/src/lib/download-token.server.ts:15`. **Nothing passes `workflowRunId`
yet.** The option was added ahead of phase 4.

---

## 2. Can `packages/jobs` import `@carbon/auth`? — YES, already does

`packages/jobs/package.json` dependencies include `"@carbon/auth": "workspace:*"`
(also `@carbon/env`, `@carbon/kv`, `@carbon/database`, `@carbon/workflows`, `kysely`).

45+ files in `packages/jobs/src` already import from it. Examples:

- `packages/jobs/src/inngest/functions/tasks/update-permissions.ts:1-5`:
  ```ts
  import type { Result } from "@carbon/auth";
  import { error, getClaims, getPermissionCacheKey, success } from "@carbon/auth";
  import { getCarbonServiceRole } from "@carbon/auth/client.server";
  import type { Database } from "@carbon/database";
  import { redis } from "@carbon/kv";
  ```
- `packages/jobs/src/inngest/functions/tasks/user-admin.ts:1-3` also imports
  `@carbon/auth/users.server`.

`@carbon/auth` `package.json` `exports` already publishes `"./client.server":
"./src/lib/supabase/client.server.ts"`, which is the subpath every job uses for
`getCarbonServiceRole`. `getUserScopedClient` lives in the **same file**, so:

```ts
import { getUserScopedClient } from "@carbon/auth/client.server";
```

works today with **zero packaging changes** — no new dep, no new export entry, no
tsconfig change. `jose` is a dependency of `@carbon/auth`, resolved transitively.

Caveat: `@carbon/auth`'s `peerDependencies` list `react-router`, `@carbon/react`, etc.
That is fine — `client.server.ts` imports only `@carbon/database` (types),
`@supabase/supabase-js`, `jose`, and `../../config/env`, none of which pull React
Router in. Contrast `@carbon/auth/auth.server` (the app-side `requirePermissions`),
which **does** import `react-router` (`redirect`) and `~`-style app paths — do **not**
import that from jobs (see §3).

---

## 3. `get_claims` and permission checking

### 3a. The SQL

`packages/database/supabase/migrations/20230123004206_claims.sql:135-149` — still the
live definition, never redefined by a later migration:

```sql
135  CREATE OR REPLACE FUNCTION get_claims(uid text, company text) RETURNS "jsonb"
136    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
137    AS $$
138    DECLARE company_role text;
139    DECLARE role_object jsonb;
140    DECLARE perms jsonb;
141    BEGIN
142      select role from "userToCompany" into company_role where "userId" = uid AND "companyId" = company;
143      select permissions from "userPermission" into perms where id = uid;
144      role_object := jsonb_build_object('role', company_role);
145
146
147      return (role_object || perms)::jsonb;
148    END;
149  $$;
```

Shape: `{ "role": "employee", "sales_view": ["companyId", ...], "sales_update": [...], ... }`.
`SECURITY DEFINER` and takes `uid` as an **argument**, so it can be called for an
arbitrary user by any caller that can reach it — this is the only "check permissions for
user X without user X's token" primitive in the codebase.

Underlying storage: the `userPermission` table (one row per user, `permissions jsonb`
keyed `<module>_<action>` → array of companyIds), plus `userToCompany` for the role.
`"0"` in the array is the **wildcard for all companies**.

Related RLS predicates (used by policies, all read `auth.uid()` — i.e. they only work
under a user-scoped JWT, which is exactly what `getUserScopedClient` provides):

`packages/database/supabase/migrations/20241210140215_rls-performance.sql:1-30`:

```sql
 1  CREATE OR REPLACE FUNCTION has_role(required_role text, company text) RETURNS "bool"
 2      LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
 3      AS $$
 4      DECLARE
 5        user_role text;
 6      BEGIN
 7        SELECT role INTO user_role FROM public."userToCompany" WHERE "userId" = (SELECT auth.uid()::text) AND "companyId" = company;
 8        return user_role = required_role;
 9      END;
10  $$;
11
12  CREATE OR REPLACE FUNCTION has_company_permission(claim text, company text) RETURNS "bool"
13      LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
14      AS $$
15      DECLARE
16        permission_value text[];
17      BEGIN
18        -- TODO: (current_setting('request.jwt.claims', true)::jsonb)->'app_metadata'->claim
19        SELECT jsonb_to_text_array(coalesce(permissions->claim, '[]')) INTO permission_value FROM public."userPermission" WHERE id = (SELECT auth.uid()::text);
20        IF permission_value IS NULL THEN
21          return false;
22        ELSIF '0' = ANY(permission_value::text[]) THEN
23          return true;
24        ELSIF company = ANY(permission_value::text[]) THEN
25          return true;
26        ELSE
27          return false;
28        END IF;
29      END;
30  $$;
```

`get_companies_with_employee_permission(permission text)` — latest at
`packages/database/supabase/migrations/20260219162954_api-key-scopes-rate-limits.sql:280-...`.
Handles both the API-key path (via `get_company_id_from_api_key()` / `get_api_key_scopes()`)
and the normal user path (lines 308-326), intersecting `userToCompany` rows with
`role = 'employee'` against `userPermission.permissions->permission`, then expanding the
`'0'` wildcard. **Important for phase 4: this function requires the owner's
`userToCompany.role = 'employee'` for the company** — a customer/supplier-portal user
would silently see nothing from most policies even with the permission array set.

Other helpers in `20230123004206_claims.sql`: `is_claims_admin()` (:3),
`get_my_permission(claim)` (:32), `get_my_claim(claim)` (:44), `jsonb_to_text_array`
(:56), `get_permission_companies(claim)` (:63), `has_any_company_permission(claim)`
(:106), `get_company_id_from_foreign_key(foreign_key, tbl)` (:124).
`20250201181148_rls-refactor.sql` adds `get_customer_ids_with_customer_permission` (:97)
and `get_supplier_ids_with_supplier_permission` (:143).
`20260228023426_company-groups.sql:109` adds `get_company_groups_for_root_permission`.

### 3b. TypeScript wrapper — `getClaims`

`packages/auth/src/services/users.ts:9-19`:

```ts
 9  export async function getClaims(
10    client: SupabaseClient<Database>,
11    uid: string,
12    company?: string
13  ) {
14    return client.rpc("get_claims", { uid, company: company ?? "" });
15  }
16
17  export function getPermissionCacheKey(userId: string) {
18    return `permissions:${userId}`;
19  }
```

`makePermissionsFromClaims(claims)` — `users.ts:91-141` — turns the flat jsonb into
`{ permissions: Record<module, {view,create,update,delete}: string[]>, role }`.
Note `users.ts:135-138` **deletes the `items` module** from the result.
Both are exported from the package root (`packages/auth/src/index.ts:3` →
`export * from "./lib/supabase"`, and `:4` → `./services/users`), so
`import { getClaims, makePermissionsFromClaims } from "@carbon/auth"` works in jobs —
`update-permissions.ts:2` already does it.

### 3c. App-side `requirePermissions` — `packages/auth/src/services/auth.server.ts:172-382`

Signature (`:172-190`):

```ts
172  export async function requirePermissions(
173    request: Request,
174    requiredPermissions: {
175      view?: string | string[];
176      create?: string | string[];
177      update?: string | string[];
178      delete?: string | string[];
179      role?: string;
180      bypassRls?: boolean;
181    }
182  ): Promise<{
183    client: SupabaseClient<Database>;
184    companyId: string;
185    companyGroupId: string;
186    email: string;
187    userId: string;
188    sessionUserId: string;
189    consoleMode: boolean;
190  }>
```

**Not reusable from a job**: it takes a `Request`, calls `requireAuthSession(request)`
(:304), and on failure `throw redirect(...)` with `flash(...)` (:357-368). But its
**decision core** (`:326-355`) is exactly the check phase 4 needs, and is pure over the
claims object:

```ts
326    const hasRequiredPermissions = Object.entries(requiredPermissions).every(
327      ([action, permission]) => {
328        if (action === "bypassRls") return true;
329        if (typeof permission === "string") {
330          if (action === "role") {
331            return myClaims.role === permission;
332          }
333          if (!(permission in myClaims.permissions)) return false;
334          const permissionForCompany =
335            myClaims.permissions[permission]?.[
336              action as "view" | "create" | "update" | "delete"
337            ];
338          return (
339            permissionForCompany?.includes("0") || // 0 is the wildcard for all companies
340            permissionForCompany?.includes(companyId) ||
341            false
342          );
343        } else if (Array.isArray(permission)) {
344          return permission.every((p) => {
345            const permissionForCompany =
346              myClaims.permissions[p]?.[
347                action as "view" | "create" | "update" | "delete"
348              ];
349            return permissionForCompany?.includes(companyId) ?? false;
350          });
351        } else {
352          return false;
353        }
354      }
355    );
```

Note the **inconsistency at :349** — the array branch does *not* honor the `"0"`
wildcard, unlike the string branch at :339. If phase 4 reimplements this check, prefer
the string-branch semantics.

It sources claims at `:308` via `getUserClaims(userId, companyId)` (see §6), and
selects the client at `:370-374`:

```ts
370    return {
371      client:
372        !!requiredPermissions.bypassRls && myClaims.role === "employee"
373          ? getCarbonServiceRole()
374          : getCarbon(accessToken),
```

### 3d. Edge-side `requirePermissions` — `packages/database/supabase/functions/lib/supabase.ts:257-368`

**This is the closest existing analogue to what phase 4 needs**, because it checks
"does user X hold permission P in company Y" from a `userId` + `companyId` alone.

```ts
257  export async function requirePermissions(
258    req: Request,
259    companyId: string,
260    userId: string,
261    permissions: RequiredPermissions
262  ): Promise<ReturnType<typeof createClient<Database>>> {
```

The JWT branch (`:346-365`):

```ts
346    if (role === "authenticated") {
347      const claimsResult = await serviceRole.rpc("get_claims", {
348        uid: userId,
349        company: companyId,
350      });
351
352      if (claimsResult.error || !claimsResult.data) {
353        throw new Error("Failed to get user permissions");
354      }
355
356      const parsed = parseClaimsPermissions(
357        claimsResult.data as unknown as Record<string, unknown>
358      );
359
360      if (!checkPermissions(parsed.permissions, companyId, permissions)) {
361        throw new Error("Insufficient permissions");
362      }
363
364      return serviceRole;
365    }
```

with (`:210-255`) `parseClaimsPermissions` (same `<module>_<action>` split as
`makePermissionsFromClaims`, but keeps `items` and does not special-case anything) and:

```ts
239  function checkPermissions(
240    claims: Record<string, Permission>,
241    companyId: string,
242    required: RequiredPermissions
243  ): boolean {
244    for (const [action, modules] of Object.entries(required)) {
245      const moduleList =
246        typeof modules === "string" ? [modules] : (modules as string[]);
247      for (const mod of moduleList) {
248        const perm = claims[mod]?.[action as keyof Permission];
249        if (!perm || !perm.includes(companyId)) {
250          return false;
251        }
252      }
253    }
254    return true;
255  }
```

Also missing the `"0"` wildcard (`:249`). Notably, having passed the check, it returns a
**service-role** client (`:364`) — it authorizes then escalates. Phase 4 should not copy
that half; it should authorize *and* keep the user-scoped client.

### 3e. Summary: every way to answer "does user X hold `sales_update` in company Y" server-side

| # | Mechanism | Where | Needs a request? | Notes |
|---|---|---|---|---|
| 1 | `client.rpc("get_claims", { uid, company })` with a service-role client, then check `permissions["sales"].update` includes `companyId` or `"0"` | `packages/auth/src/services/users.ts:9-15` + `:91-141` | **No** | The canonical primitive. Directly usable from a job. |
| 2 | Direct read of `userPermission` | e.g. `packages/auth/src/services/users.server.ts:90-94` (`deactivateCustomer`) | No | `serviceRole.from("userPermission").select("*").eq("id", userId).maybeSingle()` → `.permissions` jsonb, key `sales_update`. Skips the `role` join. |
| 3 | Redis claims cache | `packages/auth/src/services/users.server.ts:29-83` (`getUserClaims`) | No | Cache-then-`get_claims`, 1 h TTL. See §6 — **avoid** for authorization decisions in a job. |
| 4 | App `requirePermissions` | `packages/auth/src/services/auth.server.ts:172` | **Yes** | Not usable from a job (Request + `throw redirect`). |
| 5 | Edge `requirePermissions` | `packages/database/supabase/functions/lib/supabase.ts:257` | **Yes** (Request, for the token role) | Deno-only; not importable from Node. Pattern is copyable. |
| 6 | Just let RLS decide | `getUserScopedClient(ownerId)` + the query | No | Zero extra round trips; failure mode is an empty result / RLS error rather than an explicit "denied". |

For phase 4 the robust combination is **#6 as the enforcement** (RLS is the real
boundary and cannot be forgotten) plus **#1 as a pre-flight** so the run can be failed
with a legible "the owner no longer has `sales_update`" message rather than an opaque
empty result set.

---

## 4. The MCP act-as-user path

`apps/erp/app/routes/api+/mcp+/_index.ts`.

Token lookup with service role (`:37-54`):

```ts
37  async function authenticateOAuthToken(
38    accessToken: string
39  ): Promise<{ userId: string; companyId: string } | null> {
40    const serviceRole = getCarbonServiceRole();
41    const tokenResult = await serviceRole
42      .from("oauthToken")
43      .select("userId, companyId, expiresAt")
44      .eq("accessToken", hashOAuthSecret(accessToken))
45      .single();
46
47    if (!tokenResult.data) return null;
48    if (new Date(tokenResult.data.expiresAt) < new Date()) return null;
49
50    return {
51      userId: tokenResult.data.userId,
52      companyId: tokenResult.data.companyId
53    };
54  }
```

Then the act-as-user swap (`:74-101`):

```ts
74    if (authHeader?.startsWith("Bearer ") && !hasCarbonKey) {
75      const token = authHeader.slice(7);
76
77      // Try OAuth for non-API-key tokens
78      if (!token.startsWith("crbn_")) {
79        const oauthAuth = await authenticateOAuthToken(token);
80        if (oauthAuth) {
81          const client = await getUserScopedClient(oauthAuth.userId);
82          const companyResult = await client
83            .from("company")
84            .select("companyGroupId")
85            .eq("id", oauthAuth.companyId)
86            .single();
87
88          return {
89            ctx: {
90              client,
91              companyId: oauthAuth.companyId,
92              companyGroupId:
93                companyResult.data?.companyGroupId ?? oauthAuth.companyId,
94              userId: oauthAuth.userId
95            },
96            request
97          };
98        }
99
100         throw make401Response(request);
101       }
```

**The pattern to copy:** service role is used *only* to resolve the identity
(`oauthToken` row → `userId`/`companyId`); everything after that runs through the
user-scoped client, including the first read (`.from("company")`) which doubles as an
implicit membership check — if the user is not in that company, RLS returns no row.
No explicit permission check is performed anywhere on this path; RLS is the whole
boundary. The context is `McpContext` (`:30-35`): `{ client, companyId, companyGroupId, userId }`.

The non-OAuth branch (`:114-115`) falls back to `await requirePermissions(request, {})`
— an **empty** required-permission set, i.e. authenticate-only.

### `download.$token.tsx` — the cleanest precedent

`apps/erp/app/routes/download.$token.tsx:33-66`:

```ts
33    const { userId, companyId, documentId } = payload;
34
35    try {
36      // Permission + availability in one shot: read the document AS the encoded
37      // user via RLS. No row => the user lacks documents_view / readGroups access,
38      // or the document was deleted. companyId is enforced to prevent any
39      // cross-tenant access even if document ids were to collide.
40      const userClient = await getUserScopedClient(userId);
41      const doc = await userClient
42        .from("document")
43        .select("id, name, path")
44        .eq("id", documentId)
45        .eq("companyId", companyId)
46        .maybeSingle();
47
48      if (doc.error || !doc.data?.path) return fail("unavailable");
49
50      // Access already proven above; fetch the bytes with the service role.
51      const file = await getCarbonServiceRole()
52        .storage.from(DOCUMENTS_BUCKET)
53        .download(doc.data.path);
54
55      if (file.error || !file.data) return fail("unavailable");
56
57      // Best-effort audit log mirroring useDocument's "Download" transaction, so
58      // history stays consistent. Never block the download on a logging failure.
59      try {
60        await userClient
61          .from("documentTransaction")
62          .insert({ documentId, type: "Download", companyId, userId });
63      } catch {
64        // ignore
64      } catch {
65        // ignore
66      }
```

Two idioms worth stealing for phase 4:

1. **`.eq("companyId", companyId)` is always applied explicitly**, even though RLS
   already scopes — defense in depth against id collision. Phase 4 must do the same:
   the owner may belong to several companies, and the run is bound to exactly one.
2. **Authorize with the user client, then do the privileged mechanical part with
   service role** (storage bytes), never the other way around. And the write-back
   (`documentTransaction`) goes through the *user* client so RLS and — critically for
   phase 4 — `dispatch_event_batch()`'s `auth.uid()` see the real actor.

---

## 5. The dispatcher

**`apps/erp/app/routes/api+/mcp+/lib/direct-executor.ts`** — `executeFunction`.

Signature (`:84-88`):

```ts
84  export async function executeFunction(
85    functionName: string,
86    context: ExecutorContext,
87    args?: Record<string, any> | string
88  ) {
```

Context (`:46-51`):

```ts
46  export interface ExecutorContext {
47    client: SupabaseClient<Database>;
48    companyId: string;
49    companyGroupId: string;
50    userId: string;
51  }
```

The registry is a plain namespace map of the 15 ERP service modules (`:27-44`,
`const functionRegistry = { account: accountFunctions, ... }`); tool names are
`"<module>_<funcName>"`, split at `:109-131`. ~1397 tools.

### How auth is injected — two mechanisms, both driven by generated metadata

**(a) Positional injection** from `serviceParams` in `lib/tool-metadata.json` (`:146-190`):

```ts
146      // Build arguments array based on parameter names
147      const functionArgs: any[] = [];
148
149      for (const paramName of paramNames) {
150        if (paramName === "client") {
151          functionArgs.push(context.client);
152        } else if (paramName === "userId") {
153          functionArgs.push(context.userId);
154        } else if (paramName === "companyId") {
155          functionArgs.push(context.companyId);
156        } else if (paramName === "companyGroupId") {
157          functionArgs.push(context.companyGroupId);
158        } else if (paramName === "args") {
159          // For 'args' parameter, pass the entire args object or a default
160          // This is the parameter that most service functions expect
161          const argsValue = normalizedArgs || {};
162          functionArgs.push(argsValue);
163        } else if (normalizedArgs && paramName in normalizedArgs) {
164          functionArgs.push(
165            enrichWithAuthContext(normalizedArgs[paramName], context, injectAuth)
166          );
167        } else if (
```

Executed at `:193`: `let result = await (func as Function)(...functionArgs);`

**(b) Payload stamping** — `enrichWithAuthContext` (`:56-82`):

```ts
56  function enrichWithAuthContext(
57    value: unknown,
58    context: ExecutorContext,
59    fields: AuthField[]
60  ): unknown {
61    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
62    if (fields.length === 0) return value;
63
64    const enriched: Record<string, unknown> = {
65      ...(value as Record<string, unknown>)
66    };
67
68    if (fields.includes("createdBy") && !("createdBy" in enriched)) {
69      enriched.createdBy = context.userId;
70    }
71    if (fields.includes("updatedBy")) {
72      enriched.updatedBy = context.userId;
73    }
74    if (fields.includes("companyId")) {
75      enriched.companyId = context.companyId;
76    }
77    if (fields.includes("companyGroupId")) {
78      enriched.companyGroupId = context.companyGroupId;
79    }
80
81    return enriched;
82  }
```

`AuthField = "companyId" | "companyGroupId" | "createdBy" | "updatedBy"` —
`apps/erp/app/routes/api+/mcp+/lib/types.ts:14-18`.

Which fields get stamped per tool is decided at **generation** time by
`computeInjectAuth` in `scripts/generate-mcp.ts:449-470` (READ/DESTRUCTIVE →
`["companyId"]`; `upsert|create|insert|add|new|copy|duplicate|generate*` →
`+createdBy,updatedBy`; `update|set|sync|run|…` → `+updatedBy`). `serviceParams` is
emitted at `scripts/generate-mcp.ts:607` from the parsed service function's real
parameter names. `lib/tool-metadata.json` is generated — never hand-edited.

### The dispatcher performs NO authorization

Its only gate is a blocklist (`:101-106`), `isMcpBlockedTool(functionName)` against
`MCP_BLOCKED_TOOL_NAMES` in
`apps/erp/app/routes/api+/mcp+/lib/mcp-blocked-tools.ts` — currently only
`"settings_seedCompany"`. Re-checked in `lib/server.ts:141-149` and
`apps/erp/app/modules/agent/agent.tools.ts:152-154`.

**Authorization is entirely `context.client`.** Whatever client you hand it defines the
blast radius. This is precisely why it composes with `getUserScopedClient`: pass an
owner-scoped client and every one of the 1397 tools is automatically constrained to that
owner's RLS, with no per-tool permission table to maintain.

### Callers

- **MCP endpoint** — `lib/server.ts:113-202`, dispatch at `:152`:
  `const result = await executeFunction(name, ctx, args);` — ctx from `resolveAuth`
  (§4), i.e. a **user-scoped** client on the OAuth path.
- **AI agent / chat** — `apps/erp/app/modules/agent/agent.tools.ts:26`
  (`export function createAgentTools(ctx: ExecutorContext)`), dispatch at `:155-159`.
  ctx built in `apps/erp/app/modules/agent/agent.service.ts:237-242`, originating at
  `apps/erp/app/routes/api+/agent+/chat.ts:31-32` from `requirePermissions(request, {})`
  (user-session client, RLS enforced) plus a plan gate and a rate limit. The agent path
  additionally restricts itself to READ-classified tools (`agent.tools.ts:23-24, 152`).

### Gotcha for phase 4

`direct-executor.ts:167-189` has fallback branches that pass the whole flattened args
object as a positional parameter when no key matches — so a caller-supplied `companyId`
inside `arguments` can land in the payload. `enrichWithAuthContext` runs *after* the
spread and overwrites `companyId` / `companyGroupId` / `updatedBy` from ctx, so those
cannot be spoofed. **`createdBy` is the exception** (`:68`): it is only stamped
`if (!("createdBy" in enriched))`, so a caller-supplied `createdBy` wins. If workflow
action payloads are user-authored, sanitize `createdBy` before dispatch.

---

## 6. Claims caching — what to reuse and what to avoid

Cache key (`packages/auth/src/services/users.ts:17-19`): `` `permissions:${userId}` ``.
**Keyed by userId only — not by company.** The cached value is the *whole*
`userPermission` row expanded across all companies plus **the role for whichever company
the caller happened to ask about first**.

`packages/auth/src/services/users.server.ts:16-83`:

```ts
16  // TTL for the cached permission claims. Bounds staleness if an invalidation
17  // (company switch / deactivation) fails to delete the key — the cache heals
18  // itself on expiry. 1 hour, matching the auth package's other short-lived keys.
19  const PERMISSION_CACHE_TTL_SECONDS = 3600;
...
29  export async function getUserClaims(userId: string, companyId: string) {
30    let claims: {
31      permissions: Record<string, Permission>;
32      role: string | null;
33    } | null = null;
34
35    try {
36      const cachedClaims = await redis.get(getPermissionCacheKey(userId));
37      if (cachedClaims) {
38        claims = JSON.parse(cachedClaims) as {
39          permissions: Record<string, Permission>;
40          role: string | null;
41        };
42      }
43    } catch (e) {
44      log.error("Failed to get claims from redis", { error: e });
45    } finally {
46      // if we don't have permissions from redis, get them from the database
47      if (!claims) {
48        // TODO: remove service role from here, and move it up a level
49        const rawClaims = await getClaims(
50          getCarbonServiceRole(),
51          userId,
52          companyId
53        );
```

…then `makePermissionsFromClaims` (`:60`), a best-effort `redis.set(..., "EX", 3600)`
(`:65-74`), and `return claims` from the `finally` block (`:81`).

### Invalidation sites (complete grep for `getPermissionCacheKey`)

| Site | What it does |
|---|---|
| `packages/auth/src/services/users.ts:17` | definition |
| `packages/auth/src/services/users.server.ts:36, 67` | read / write |
| `packages/auth/src/services/users.server.ts:301` | `redis.del` |
| `packages/auth/src/services/session.server.ts:251` | `redis.del(getPermissionCacheKey(authSession?.userId!))` — on company switch |
| `packages/jobs/src/inngest/functions/tasks/update-permissions.ts:2, 176` | `redis.del(getPermissionCacheKey(id))` after a permission update — **already inside jobs** |
| `apps/erp/app/modules/users/users.server.ts:623, 651, 678, 1360, 1527` | a **duplicate, drifted copy** |

### The duplicate is a real hazard

`apps/erp/app/modules/users/users.server.ts:644-687` is a near-copy of
`getUserClaims` that writes the **same key** with **no TTL**:

```ts
677        // store claims in redis
678        await redis.set(getPermissionCacheKey(userId), JSON.stringify(claims));
```

vs. the package version's `redis.set(..., "EX", PERMISSION_CACHE_TTL_SECONDS)`. Whichever
code path populates the key last determines whether it ever expires. A permanent entry
written by the ERP copy will only clear on an explicit `del`.

### Recommendation for phase 4

**Do not authorize a workflow run off this cache.**

1. It is keyed by `userId` alone, so the `role` field belongs to an arbitrary company —
   a cross-company role read is possible for a multi-company owner. The `permissions`
   map is company-safe (arrays of companyIds), the `role` is not.
2. Up to 1 h stale (indefinite if the ERP copy wrote it), so a revoked permission keeps
   working. For an interactive request that is an acceptable trade; for an unattended
   automation running repeatedly it is a silent privilege-retention bug.
3. `getUserClaims` is not exported from the package root anyway (it lives in
   `users.server.ts`, which is exported as `@carbon/auth/users.server` — importable, but
   it pulls in `@carbon/kv`/redis, an extra dependency at run time for the job).

Instead: call `getClaims(getCarbonServiceRole(), ownerId, companyId)` directly
(uncached, one RPC) for the pre-flight, and let RLS on the user-scoped client be the
actual enforcement. Neither path touches redis, so a workflow run cannot be affected by
— or pollute — the interactive cache. `@carbon/kv`'s `redis` *is* available to jobs
(`update-permissions.ts:5`) if you later want caching, but scope any new key by
`userId + companyId` and give it a short TTL rather than reusing `permissions:${userId}`.

---

## 7. Env vars in the Inngest execution context

### Where Inngest functions actually run

There is **no separate Inngest container**. Functions are served by the ERP app:

`apps/erp/app/routes/api+/inngest.ts:17-27`:

```ts
17  const handler = serve({
18    client: inngest,
19    functions,
20    // Enable streaming for long-running functions on Vercel
21    streaming: "allow",
22    serveHost: process.env.INNGEST_SERVE_HOST || process.env.ERP_URL
23  });
24
25  // In connect mode, we still serve for discovery but can log/track differently
26  export const loader = handler;
27  export const action = handler;
```

(An optional `INNGEST_MODE=connect` WebSocket worker exists —
`packages/jobs/src/inngest/worker.ts`, exported as `@carbon/jobs/worker` — but the
`serve` path is the default and the mode switch is commented out at `:15`.)

**So the job's `process.env` is the ERP service's `process.env`.** Anything
`getCarbonServiceRole()` can read today, `getUserScopedClient` can read too.

### Confirmation the vars are present

`sst.config.ts` — ERP ECS service environment block:

```
 89        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
 90        SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
 91        SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
 92        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
 93        SUPABASE_URL: process.env.SUPABASE_URL,
```

(and identically for MES at `:169-173`.) CI plumbs it at `ci/src/deploy.ts:303`
(`SUPABASE_JWT_SECRET: jwt_secret ?? undefined`). Local dev generates one —
`packages/dev/src/env.ts:89` (`lines.push(\`SUPABASE_JWT_SECRET=${jwt.secret}\`)`) — and
feeds the same value to every Supabase service in
`packages/dev/docker/docker-compose.dev.yml` (`JWT_SECRET` :31, `GOTRUE_JWT_SECRET` :86,
`PGRST_JWT_SECRET` :135 and :202, `PGRST_APP_SETTINGS_JWT_SECRET` :143,
`API_JWT_SECRET`/`METRICS_JWT_SECRET` :170-171, `JWT_SECRET` :286). Self-hosting
recipes: `contrib/deploying/simple-docker-caddy/scripts/gen-supabase-keys.sh:38` and
`docker-compose.prod.yml:75,117`.

That PostgREST shares the secret (`PGRST_JWT_SECRET`) is what makes the minted token
verify — and therefore what makes `auth.uid()` and the `workflow_run_id` claim readable
inside `dispatch_event_batch()`.

### The export chain

```
packages/env/src/index.ts:287-290   export const SUPABASE_JWT_SECRET = getEnv("SUPABASE_JWT_SECRET", { isSecret: true, isRequired: false });
packages/env/src/index.ts:389-392   export const SUPABASE_URL / SUPABASE_ANON_KEY  (isSecret: false)
packages/env/src/index.ts:286       export const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");
        ↓
packages/auth/src/config/env.ts:1   export * from "@carbon/env";     // the entire file is this one line
        ↓
packages/auth/src/lib/supabase/client.server.ts:4-7   imports SUPABASE_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY
```

`getEnv` reads `(isBrowser ? window.env : process.env)` — `packages/env/src/index.ts:100-108`:

```ts
100    const source = (isBrowser ? window.env : process.env) ?? {};
101
102    const value = source[name as keyof typeof source];
103
104    if (!value && isRequired) {
105      throw new Error(`${name} is not set`);
106    }
107
108    return value;
```

### The one caveat

`SUPABASE_JWT_SECRET` is `isRequired: false` (`:289`). It is **not** validated at
process start, and a self-hosted deployment that omits it boots fine — the failure
surfaces only when `getUserScopedClient` is first called, as
`Error("SUPABASE_JWT_SECRET is required for user-scoped clients")`
(`client.server.ts:18-20`). Since a workflow run *cannot* proceed without it, phase 4
should fail the run with an explicit, legible message (and ideally check once at
engine entry) rather than letting an Inngest retry storm bury the real cause.

Also note `SUPABASE_JWT_SECRET` is **absent** from the browser-facing
`window.env` declaration (`packages/env/src/index.ts:4-30`) and correctly marked
`isSecret: true` — never let it reach a loader's client payload.

---

## 8. What phase 4 should do — synthesis

```ts
// packages/jobs/src/inngest/functions/workflows/run.ts (today a stub, :20-32)
import { getUserScopedClient, getCarbonServiceRole } from "@carbon/auth/client.server";
import { getClaims, makePermissionsFromClaims } from "@carbon/auth";
```

1. **Per step, not per run.** `const client = await getUserScopedClient(ownerId, { workflowRunId: runId })`
   inside each `step.run`. 5-minute TTL; a step boundary is also an Inngest retry
   boundary, so a fresh token per step is both correct and free.
2. **Pre-flight the owner once at run start** with
   `getClaims(getCarbonServiceRole(), ownerId, companyId)` +
   `makePermissionsFromClaims`, checking the action's `<module>_<action>` array contains
   `companyId` **or `"0"`**, and that `role === "employee"` (required by
   `get_companies_with_employee_permission`). Fail the run with a legible reason if not
   — RLS alone would just return empty rows.
3. **Never `getCarbonServiceRole()` for the action itself.** Beyond the obvious, a
   service-role write produces `auth.uid() = NULL` and `workflow_run_id = NULL` in
   `dispatch_event_batch()`, which defeats the phase-3 origin filter and loop guards
   that `matcher.ts:16-18, 160-183` depend on. Service role is fine for engine
   bookkeeping (`workflowRun` status rows) — which the matcher already does via Kysely.
4. **Always add `.eq("companyId", companyId)`** explicitly, per the `download.$token.tsx`
   precedent — the owner may be a member of several companies.
5. **Reuse `executeFunction`** if actions are expressed as service-function calls: build
   an `ExecutorContext` with the owner-scoped client and it inherits the whole 1397-tool
   surface with RLS as the boundary. Sanitize `createdBy` in user-authored payloads
   (`direct-executor.ts:68`).
6. **Stay off the redis claims cache** (`permissions:${userId}`) — userId-only key,
   1 h stale, and a drifted no-TTL duplicate in
   `apps/erp/app/modules/users/users.server.ts:678`.
7. **No packaging work is needed** — `@carbon/auth` is already a dependency,
   `./client.server` is already an export subpath, and `SUPABASE_JWT_SECRET` is already
   in the ERP process where Inngest functions execute.
