# User Select Performance Rewrite — implementation plan

**Spec:** .ai/specs/2026-07-14-user-select-rewrite.md
**Research:** N/A — skipped with rationale documented in the spec (frontend data-fetching pattern, not ERP-domain)
**Branch:** featuser-select

Global constraints for every task:

- **Types (amended 2026-07-14, user directive):** the local stack is running for this build — apply the migration with `pnpm db:migrate` (regenerates types from the local DB). Then inspect `git diff --stat packages/database/src/types.ts`: if the diff is clean (only the two new RPC signatures plus trivial churn), COMMIT it with Task 1 and use properly typed `client.rpc(...)` calls in Task 2 (no casts). If it contains large unrelated churn (per-company tables etc.), discard it (`git checkout -- packages/database/src/types.ts`) and fall back to `// @ts-ignore` + result casts (precedent: `apps/erp/app/modules/people/people.service.ts:312`, `documents.service.ts:178`).
- Never run a whole-repo typecheck. Scoped: `pnpm exec turbo run typecheck --filter=erp`.
- New user-visible strings in `TreeSelect.tsx` stay plain English (matching that file's existing untranslated strings: "No options found", "Group", "members"). Do not add Lingui macros to it in this PR — `SelectionList.tsx` keeps its existing Lingui usage.
- Counts render as plain numbers — never wrap a count in parentheses.

## Progress

- [x] Task 1: Create the user-select RPC migration (commit 7c3dfa54d — applied by stack boot; types regen kept: clean diff + new RPCs)
- [x] Task 2: Add user-select service functions and types to the users module (commit 7caabce5c — typed rpc calls; pre-commit codegen added MCP tool-metadata entries)
- [x] Task 3: Add query-key factories, cachedApiQuery, and invalidateUserSelectQueries (commit e8932e748)
- [x] Task 4: Create the five API routes and path helpers (commit 01fe515a5 — includes lesson-prescribed @ts-ignore conversion on two supplierPart delete routes)
- [x] Task 5: Rewrite UserSelect internals (hook, tree, focus, chips) (commit 34a4af4d3)
- [x] Task 6: Migrate EmailRecipients off the eager endpoint (commit 8105266b1)
- [x] Task 7: Wire cache invalidation into all group-mutating routes (commit 3c5a91ff4 — 11 routes)
- [x] Task 8: Delete the old endpoints, path helpers, and query key (commit a5b69a066 — Group type + arrayToTree kept: admin groups.tsx uses them)
- [x] Task 9: Run validation gates (typecheck ✓, lint ✓ — 13 warnings all in pre-existing untouched files, tests 21/21 tasks ✓, generated types clean)
- [x] Task 10: Browser-verify via /test (10/11 scenarios PASS; EmailRecipients modal flow SKIP — empty dev DB, its unique endpoint smoke-tested live; two fixes landed: explode ghost chip + sentinel root, commit 17a655389; screenshots in .ai/scratch/e2e/; playbook .ai/playbooks/user-select.md)

## Dependencies

- Task 2 needs Task 1 (RPC names/signatures). Task 3 is independent of Tasks 1–2 (can run in parallel).
- Task 4 needs Tasks 2 + 3. Tasks 5, 6, 7 need Tasks 3 + 4 and are independent of each other (parallelizable).
- Task 8 needs Tasks 5 + 6 (all consumers migrated). Task 9 needs Tasks 1–8. Task 10 needs Task 9.

---

## Task 1: Create the user-select RPC migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<generated-timestamp>_user-select-rpcs.sql`

**Steps:**

1. From the repo root run `pnpm db:migrate:new user-select-rpcs`. Use the file it creates (never hand-pick the timestamp; if the generated filename ends in `000000`, delete it and rerun until the HHMMSS portion is not `000000`).
2. Paste exactly this SQL into the new file:

```sql
-- User-select rewrite: purpose-built, non-recursive, company-scoped group reads.
-- Replaces the recursive "groups" view on the user-select hot path.
-- SECURITY INVOKER: membership/user RLS applies to the caller.
-- plpgsql (not LANGUAGE sql) so the internal ORDER BY survives PostgREST.

CREATE OR REPLACE FUNCTION get_user_select_groups(
  p_company_id TEXT,
  p_type TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  "id" TEXT,
  "name" TEXT,
  "isEmployeeTypeGroup" BOOLEAN,
  "isCustomerOrgGroup" BOOLEAN,
  "isCustomerTypeGroup" BOOLEAN,
  "isSupplierOrgGroup" BOOLEAN,
  "isSupplierTypeGroup" BOOLEAN,
  "userCount" INT,
  "groupCount" INT,
  "isRoot" BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  -- Deterministic per-company root group ids. Must match the expressions in
  -- 20230123004632_groups.sql (create_employee_type_group / create_customer_type_group /
  -- create_supplier_type_group triggers).
  _roots TEXT[] := ARRAY[
    '00000000-0000-' || substring(p_company_id, 1, 4) || '-' || substring(p_company_id, 5, 4) || '-' || substring(p_company_id, 9, 12),
    '11111111-1111-' || substring(p_company_id, 1, 4) || '-' || substring(p_company_id, 5, 4) || '-' || substring(p_company_id, 9, 12),
    '22222222-2222-' || substring(p_company_id, 1, 4) || '-' || substring(p_company_id, 5, 4) || '-' || substring(p_company_id, 9, 12)
  ];
BEGIN
  RETURN QUERY
  SELECT
    g."id",
    g."name",
    g."isEmployeeTypeGroup",
    g."isCustomerOrgGroup",
    g."isCustomerTypeGroup",
    g."isSupplierOrgGroup",
    g."isSupplierTypeGroup",
    (SELECT count(*)::INT FROM "membership" m
       JOIN "user" u ON u."id" = m."memberUserId"
      WHERE m."groupId" = g."id" AND u."active" = TRUE)              AS "userCount",
    (SELECT count(*)::INT FROM "membership" m
      WHERE m."groupId" = g."id" AND m."memberGroupId" IS NOT NULL)  AS "groupCount",
    (g."id" = ANY(_roots))                                           AS "isRoot"
  FROM "group" g
  WHERE g."companyId" = p_company_id
    AND g."isIdentityGroup" = FALSE
    AND CASE
      WHEN p_type = 'employee' THEN NOT (
        g."isCustomerOrgGroup" OR g."isCustomerTypeGroup"
        OR g."isSupplierOrgGroup" OR g."isSupplierTypeGroup")
      WHEN p_type = 'customer' THEN (g."isCustomerTypeGroup" OR g."isCustomerOrgGroup")
      WHEN p_type = 'supplier' THEN (g."isSupplierTypeGroup" OR g."isSupplierOrgGroup")
      ELSE TRUE
    END
    AND CASE
      WHEN p_search IS NOT NULL AND p_search <> ''
        -- search mode: any depth, flat
        THEN g."name" ILIKE '%' || p_search || '%'
        -- browse mode: top-level only (roots, children of roots, parentless groups)
      ELSE (
        g."id" = ANY(_roots)
        OR EXISTS (SELECT 1 FROM "membership" m
                    WHERE m."memberGroupId" = g."id" AND m."groupId" = ANY(_roots))
        OR NOT EXISTS (SELECT 1 FROM "membership" m WHERE m."memberGroupId" = g."id")
      )
    END
  ORDER BY
    (g."id" = ANY(_roots)) DESC,
    (g."isEmployeeTypeGroup" OR g."isCustomerTypeGroup" OR g."isSupplierTypeGroup") DESC,
    g."name" ASC,
    g."id" ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Direct members of one group: child groups (with counts) + direct active users.
CREATE OR REPLACE FUNCTION get_user_select_group_members(
  p_company_id TEXT,
  p_group_id TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  _result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "group" g
    WHERE g."id" = p_group_id AND g."companyId" = p_company_id
  ) THEN
    RETURN jsonb_build_object('groups', '[]'::jsonb, 'users', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cg."id",
        'name', cg."name",
        'isEmployeeTypeGroup', cg."isEmployeeTypeGroup",
        'isCustomerOrgGroup', cg."isCustomerOrgGroup",
        'isCustomerTypeGroup', cg."isCustomerTypeGroup",
        'isSupplierOrgGroup', cg."isSupplierOrgGroup",
        'isSupplierTypeGroup', cg."isSupplierTypeGroup",
        'userCount', (SELECT count(*)::INT FROM "membership" m2
                        JOIN "user" u2 ON u2."id" = m2."memberUserId"
                       WHERE m2."groupId" = cg."id" AND u2."active" = TRUE),
        'groupCount', (SELECT count(*)::INT FROM "membership" m3
                        WHERE m3."groupId" = cg."id" AND m3."memberGroupId" IS NOT NULL)
      ) ORDER BY cg."name" ASC, cg."id" ASC)
      FROM "membership" m
      JOIN "group" cg ON cg."id" = m."memberGroupId"
      WHERE m."groupId" = p_group_id
        AND m."memberGroupId" IS NOT NULL
        AND cg."isIdentityGroup" = FALSE
    ), '[]'::jsonb),
    'users', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u."id",
        'firstName', u."firstName",
        'lastName', u."lastName",
        'fullName', u."fullName",
        'email', u."email",
        'avatarUrl', u."avatarUrl"
      ) ORDER BY u."lastName" ASC, u."firstName" ASC, u."id" ASC)
      FROM "membership" m
      JOIN "user" u ON u."id" = m."memberUserId"
      WHERE m."groupId" = p_group_id
        AND m."memberUserId" IS NOT NULL
        AND u."active" = TRUE
    ), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END;
$$;

NOTIFY pgrst, 'reload schema';
```

3. Validate in a rolled-back transaction BEFORE applying (uses the worktree DB port from `.env.local`):

```bash
DB_PORT=$(grep -E "^PORT_DB=" .env.local | cut -d= -f2)
MIGRATION=$(ls -t packages/database/supabase/migrations/*_user-select-rpcs.sql | head -1)
PGPASSWORD=postgres psql -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
BEGIN;
\i $MIGRATION
DO \$\$
DECLARE
  _company TEXT;
  _n INT;
  _members JSONB;
BEGIN
  SELECT "id" INTO _company FROM "company" LIMIT 1;
  IF _company IS NULL THEN RAISE EXCEPTION 'no seeded company found'; END IF;

  SELECT count(*) INTO _n FROM get_user_select_groups(_company, 'employee', NULL, 25, 0);
  IF _n = 0 THEN RAISE EXCEPTION 'expected at least one top-level employee group'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM get_user_select_groups(_company, 'employee', NULL, 25, 0) WHERE "isRoot"
  ) THEN RAISE EXCEPTION 'expected All Employees root pinned in first page'; END IF;

  SELECT get_user_select_group_members(_company, (
    SELECT "id" FROM get_user_select_groups(_company, 'employee', NULL, 25, 0)
    WHERE NOT "isRoot" LIMIT 1
  )) INTO _members;
  IF _members->'users' IS NULL OR _members->'groups' IS NULL
    THEN RAISE EXCEPTION 'members payload missing keys'; END IF;

  -- cross-company guard
  SELECT get_user_select_group_members('zzzznotacompanyzzzz', (
    SELECT "id" FROM "group" WHERE "companyId" = _company LIMIT 1
  )) INTO _members;
  IF jsonb_array_length(_members->'users') <> 0 OR jsonb_array_length(_members->'groups') <> 0
    THEN RAISE EXCEPTION 'cross-company members leak'; END IF;

  RAISE NOTICE 'user-select RPC assertions passed';
END
\$\$;
ROLLBACK;
SQL
```

4. Apply locally WITH type regeneration: `pnpm db:migrate`. Then inspect the generated-types diff per the amended global constraint (clean → keep and commit; unrelated churn → discard and use casts in Task 2).

**Verify:**
```bash
# (validation script above)
# Expected: NOTICE: user-select RPC assertions passed, then ROLLBACK
pnpm db:migrate
# Expected: the new migration applies with no error; types regenerate
git diff --stat packages/database/src/types.ts
# Expected: a small diff adding get_user_select_groups + get_user_select_group_members
# (if instead it shows large unrelated churn: git checkout -- packages/database/src/types.ts and use the cast fallback in Task 2)
```

**Out of scope:** Do NOT modify the `groups` / `groups_recursive` / `groupMembers` views, `groups_query`, `groups_for_user`, `users_for_groups`, or any table/RLS. Do not add RLS to `group` (Ask First territory, deliberately deferred).

---

## Task 2: Add user-select service functions and types to the users module

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/users/types.ts` — add `UserSelectGroup`, `UserSelectGroupMembers`
- Modify: `apps/erp/app/modules/users/users.service.ts` — add four functions near `getGroupEmails` (~line 249)
- Copy from (precedent): `apps/erp/app/modules/users/users.service.ts:229-262` (`getGroups` for RPC-call shape, `getGroupEmails` for the cast pattern); `apps/erp/app/modules/users/users.service.ts:274-299` (`getSuppliers` for the `!inner` embed + filter)

**Steps:**

1. In `types.ts` add (keep the existing `Group` and `User` types untouched for now — `Group` is removed in Task 8 if orphaned):

```typescript
export type UserSelectGroup = {
  id: string;
  name: string;
  isEmployeeTypeGroup: boolean;
  isCustomerOrgGroup: boolean;
  isCustomerTypeGroup: boolean;
  isSupplierOrgGroup: boolean;
  isSupplierTypeGroup: boolean;
  userCount: number;
  groupCount: number;
  isRoot?: boolean; // present on list results, absent on member child groups
};

export type UserSelectGroupMembers = {
  groups: UserSelectGroup[];
  users: User[];
};
```

2. In `users.service.ts` add four functions. If Task 1 committed regenerated types, call the RPCs directly typed (drop the `// @ts-ignore` lines and the `as unknown as Promise<...>` casts below — but KEEP explicit return-shape types on the functions so downstream code doesn't depend on generated Json shapes for the JSONB result). If Task 1 fell back, use the casts exactly as written:

```typescript
export async function getUserSelectGroups(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { type?: string; search?: string; limit: number; offset: number }
) {
  // @ts-ignore — RPC added in <timestamp>_user-select-rpcs.sql; not in cloud-generated types
  return client.rpc("get_user_select_groups", {
    p_company_id: companyId,
    p_type: args.type ?? null,
    p_search: args.search ?? null,
    p_limit: args.limit,
    p_offset: args.offset
  }) as unknown as Promise<{ data: UserSelectGroup[] | null; error: PostgrestError | null }>;
}

export async function getUserSelectGroupMembers(
  client: SupabaseClient<Database>,
  companyId: string,
  groupId: string
) {
  // @ts-ignore — RPC added in <timestamp>_user-select-rpcs.sql; not in cloud-generated types
  return client.rpc("get_user_select_group_members", {
    p_company_id: companyId,
    p_group_id: groupId
  }) as unknown as Promise<{ data: UserSelectGroupMembers | null; error: PostgrestError | null }>;
}

export async function searchUsersForSelect(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { q: string; excludeSelf?: string | null; allowedIds?: string[]; userId: string }
) {
  const query = client
    .from("user")
    .select(
      "id, firstName, lastName, fullName, email, avatarUrl, userToCompany!inner(companyId)"
    )
    .eq("userToCompany.companyId", companyId)
    .eq("active", true)
    .ilike("fullName", `%${args.q}%`)
    .order("lastName")
    .limit(20);

  if (args.excludeSelf === "true") query.neq("id", args.userId);
  if (args.allowedIds && args.allowedIds.length > 0) query.in("id", args.allowedIds);

  return query;
}

export async function resolveUserSelectIds(
  client: SupabaseClient<Database>,
  companyId: string,
  ids: string[]
) {
  const [users, groups] = await Promise.all([
    client
      .from("user")
      .select("id, firstName, lastName, fullName, email, avatarUrl")
      .in("id", ids),
    client
      .from("group")
      .select("id, name")
      .in("id", ids)
      .eq("companyId", companyId)
      .eq("isIdentityGroup", false)
  ]);
  return { users, groups };
}
```

Import `PostgrestError` from `@supabase/supabase-js` (type-only) if not already imported.

3. Confirm `apps/erp/app/modules/users/index.ts` re-exports `./types` and `./users.service` (it is a barrel — if the new names aren't picked up automatically, add them).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 (no new type errors)
```

**Out of scope:** Do not modify `getGroups`, `getGroupMembers`, `getGroupEmails`, or `upsertGroupMembers`. Do not touch `users.models.ts` (no form changes).

**Escape hatch:** If the `userToCompany!inner(companyId)` embed fails at runtime with PGRST200 (relationship not found), STOP and report — do not silently drop the company scoping. (The FK `userToCompany.userId → user.id` exists in `20230123004116_users-and-companies.sql:42`, so this should resolve.)

---

## Task 3: Add query-key factories, cachedApiQuery, and invalidateUserSelectQueries

**Depends on:** none (parallel with Tasks 1–2)
**Files:**
- Modify: `apps/erp/app/utils/react-query.ts` — append factories + two helpers
- Copy from (precedent): same file, `groupsByTypeQuery` (lines 184-190) for factory shape; `getClientCache` (lines 22-28)

**Steps:**

1. Append to `apps/erp/app/utils/react-query.ts`:

```typescript
export const userSelectGroupsQuery = (
  companyId: string | null,
  type: string | null,
  offset: number
) => ({
  queryKey: ["userSelectGroups", companyId ?? "null", type ?? "all", offset],
  staleTime: RefreshRate.Low
});

export const userSelectMembersQuery = (
  companyId: string | null,
  groupId: string
) => ({
  queryKey: ["userSelectMembers", companyId ?? "null", groupId],
  staleTime: RefreshRate.Low
});

export const userSelectSearchQuery = (
  companyId: string | null,
  type: string | null,
  q: string,
  filters: string
) => ({
  queryKey: ["userSelectSearch", companyId ?? "null", type ?? "all", q, filters],
  staleTime: RefreshRate.High
});

export const userSelectResolveQuery = (
  companyId: string | null,
  ids: string[]
) => ({
  queryKey: ["userSelectResolve", companyId ?? "null", [...ids].sort().join(",")],
  staleTime: RefreshRate.Low
});

export const groupEmailsQuery = (companyId: string | null, groupId: string) => ({
  queryKey: ["groupEmails", companyId ?? "null", groupId],
  staleTime: RefreshRate.Low
});

const USER_SELECT_QUERY_PREFIXES = [
  "userSelectGroups",
  "userSelectMembers",
  "userSelectSearch",
  "userSelectResolve",
  "groupEmails"
];

/**
 * Read-through fetch against an API route, cached in window.clientCache.
 * fetchQuery dedupes concurrent identical calls and honors staleTime.
 * Falls back to a plain fetch when the cache isn't mounted yet.
 */
export async function cachedApiQuery<T>(
  query: { queryKey: unknown[]; staleTime: number },
  url: string
): Promise<T> {
  const queryFn = async (): Promise<T> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
    return res.json();
  };
  const cache = getClientCache();
  if (!cache) return queryFn();
  return cache.fetchQuery({
    queryKey: query.queryKey,
    queryFn,
    staleTime: query.staleTime
  });
}

export function invalidateUserSelectQueries(companyId: string | null) {
  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as unknown[];
      return (
        USER_SELECT_QUERY_PREFIXES.includes(queryKey[0] as string) &&
        queryKey[1] === (companyId ?? "null")
      );
    }
  });
}
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** Do not modify existing factories or `RefreshRate`. Do not remove `groupsByTypeQuery` yet (Task 8).

---

## Task 4: Create the five API routes and path helpers

**Depends on:** Tasks 2, 3
**Files:**
- Create: `apps/erp/app/routes/api+/users.select.groups.tsx`
- Create: `apps/erp/app/routes/api+/users.select.groups.$groupId.members.tsx`
- Create: `apps/erp/app/routes/api+/users.select.search.tsx`
- Create: `apps/erp/app/routes/api+/users.select.resolve.tsx`
- Create: `apps/erp/app/routes/api+/users.select.groups.$groupId.emails.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add five helpers in the `api` block next to `groupsByType` (line 62)
- Copy from (precedent): `apps/erp/app/routes/api+/users.search.tsx` (loader shape: `requirePermissions` role employee → parse params → service → `data({...}, flash)` on error → plain object on success)

**Steps:**

1. Path helpers (in the `api` block of `path.ts`; keep the old ones for now):

```typescript
userSelectGroups: (type: string | undefined, offset: number, limit = 25) =>
  generatePath(
    `${api}/users/select/groups?type=${type ?? ""}&offset=${offset}&limit=${limit}`
  ),
userSelectGroupMembers: (groupId: string) =>
  generatePath(`${api}/users/select/groups/${groupId}/members`),
userSelectSearch: (q: string, type?: string) =>
  generatePath(
    `${api}/users/select/search?q=${encodeURIComponent(q)}&type=${type ?? ""}`
  ),
userSelectResolve: (ids: string[]) =>
  generatePath(`${api}/users/select/resolve?ids=${ids.join(",")}`),
userSelectGroupEmails: (groupId: string) =>
  generatePath(`${api}/users/select/groups/${groupId}/emails`),
```

2. `users.select.groups.tsx` — full file:

```typescript
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getUserSelectGroups } from "~/modules/users";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || undefined;
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit")) || 25)
  );

  const result = await getUserSelectGroups(client, companyId, {
    type,
    limit: limit + 1, // fetch one extra row to compute hasMore
    offset
  });

  if (result.error) {
    return data(
      { groups: [], hasMore: false, error: result.error },
      await flash(request, error(result.error, "Failed to load groups"))
    );
  }

  const rows = result.data ?? [];
  return {
    groups: rows.slice(0, limit),
    hasMore: rows.length > limit
  };
}
```

3. `users.select.groups.$groupId.members.tsx` — same skeleton; read `params.groupId` (return `{ groups: [], users: [] }` with a 400-style flash if missing), call `getUserSelectGroupMembers(client, companyId, groupId)`, on success `return { groups: result.data?.groups ?? [], users: result.data?.users ?? [] }`.
4. `users.select.search.tsx` — same skeleton; params: `q` (trim; if missing or `< 2` chars return `{ groups: [], users: [] }`), `type`, `excludeSelf`, `allowedIds` (comma-split, filter Boolean). Run in parallel:
   - `getUserSelectGroups(client, companyId, { type, search: q, limit: 10, offset: 0 })`
   - `searchUsersForSelect(client, companyId, { q, excludeSelf, allowedIds, userId })` (destructure `userId` from `requirePermissions`)
   On either error, flash + return empty arrays. On success strip the embed from user rows: `users: (usersResult.data ?? []).map(({ userToCompany, ...u }) => u)` and return `{ groups: groupsResult.data ?? [], users }`.
5. `users.select.resolve.tsx` — same skeleton; param `ids` (comma-split, filter Boolean, dedupe, cap at 200; empty → `{ users: [], groups: [] }`), call `resolveUserSelectIds(client, companyId, ids)`; if either sub-result has an error, flash the first error and return empty arrays; else `return { users: users.data ?? [], groups: groups.data ?? [] }`.
6. `users.select.groups.$groupId.emails.tsx` — same skeleton; `getGroupEmails(client, [groupId])` (it returns `string[]`, not `{data,error}`); `return { emails: [...new Set(result)] }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** No `clientLoader`s on these routes (caching lives solely in `cachedApiQuery` — a fetcher-less raw `fetch` never runs a clientLoader). Do not touch the four old routes yet.

---

## Task 5: Rewrite UserSelect internals (hook, tree, focus, chips)

**Depends on:** Tasks 3, 4
**Files:**
- Modify: `apps/erp/app/components/Selectors/UserSelect/useUserSelect.ts` — data layer + handlers
- Modify: `apps/erp/app/components/Selectors/UserSelect/types.ts` — internal types
- Modify: `apps/erp/app/components/Selectors/UserSelect/components/TreeSelect.tsx` — recursive tree + interactions + sentinel
- Modify: `apps/erp/app/components/Selectors/UserSelect/components/Popover.tsx` — depth-N focus builder
- Modify: `apps/erp/app/components/Selectors/UserSelect/components/SelectionList.tsx` — `isGroup` usage only (via the helper change in the hook file)
- Copy from (precedent): `apps/erp/app/components/InfiniteScroll.tsx:47` for the `useInView` sentinel pattern (`react-intersection-observer` is already an erp dependency); keep the existing WAI-ARIA structure of `TreeSelect.tsx`/`Popover.tsx` as the baseline

**Steps:**

1. **types.ts (component)** — replace the data-shape types, keep `UserSelectProps`, `TreeNode`, refs untouched:
   - Import `UserSelectGroup`, `User` from `~/modules/users` (drop the `Group` import).
   - `SelectionGroupWithOptions` becomes `UserSelectGroup & { users: User[]; memberCount: number } & SelectionOptions` (the `users` key stays as the group discriminator — populated `[]` until exploded).
   - Add render-tree types:
     ```typescript
     export type UserOptionItem = User & SelectionOptions;
     export type GroupNode = {
       uid: string;               // path-scoped: parentUid + "_" + groupId + "_group"
       group: UserSelectGroup;
       expanded: boolean;
       loading: boolean;
       members: { groups: GroupNode[]; users: UserOptionItem[] } | null; // null = not fetched
     };
     ```
   - `OptionGroup` is deleted; export a discriminated view model the tree renders:
     ```typescript
     export type UserSelectViewModel =
       | { mode: "browse"; nodes: GroupNode[]; hasMore: boolean; loadingMore: boolean }
       | { mode: "search"; groups: (UserSelectGroup & SelectionOptions)[]; users: UserOptionItem[]; searching: boolean };
     ```

2. **useUserSelect.ts** — replace the data layer; keep the public return-shape field names (`aria`, `selectionItemsById`, `dropdown`, `innerProps`, `refs`, all `on*` handlers) so `Input.tsx`, `Combobox.tsx`, `Container.tsx`, `provider.ts` need no changes:
   - Delete: `groupsFetcher` + its `useEffect`, `searchCache`, the `optionGroups` memo, `makeFilteredOptionGroups`, `filteredOptionGroups` state + its preserve-expansion effect, and the `usersBatch`/`group_`-prefix logic in the value-hydration effect.
   - New state: `topLevelGroups: UserSelectGroup[]`, `hasMore: boolean`, `loadingMore: boolean`, `initialLoading: boolean`, `membersById: Record<string, { groups: UserSelectGroup[]; users: User[] }>`, `loadingGroups` (keep), `expandedUids: Set<string>`, `search: { q: string; results: { groups: UserSelectGroup[]; users: User[] } | null; searching: boolean }`, `errors`.
   - All requests go through `cachedApiQuery` + the Task 3 factories + `getCompanyId()` (import both from `~/utils/react-query`). Company id may be `null` before hydration — factories tolerate it.
   - **Page loading:** on mount and on `type` change, reset pages and load offset 0 (`userSelectGroupsQuery(companyId, type ?? null, 0)` + `path.to.api.userSelectGroups(type, 0)`); `loadMore()` fetches the next offset (`topLevelGroups.length`) and appends, deduping by `id`. Set `errors` from a failed fetch (catch; store `{ message }`) — hook still returns `errors` and `loading` (map `loading` to `initialLoading`).
   - **prefetchGroup(groupId):** unchanged trigger points, new body — `cachedApiQuery(userSelectMembersQuery(companyId, groupId), path.to.api.userSelectGroupMembers(groupId))` → store raw response in `membersById`; keep `loadingGroups` bookkeeping. Apply `queryFilters.allowedIds` filtering to `users` at read time (NOT before caching — the cache entry must stay filter-agnostic).
   - **Expansion:** `onGroupExpand(uid)` adds to `expandedUids` + prefetches the node's groupId; `onGroupCollapse(uid)` removes. `uid` for a top-level node = `getGroupId(instanceId, group.id)`; for a nested node = `getOptionId(parentUid, group.id)` (existing helpers — path-scoped, so the same group under two parents expands independently).
   - **View model memo:** browse mode builds `GroupNode[]` recursively from `topLevelGroups` + `membersById` + `expandedUids` (children materialized only for expanded nodes; guard cycles by skipping a child whose `id` already appears in its own uid path). `usersOnly` drops groups with `userCount + groupCount === 0`. Search mode maps `search.results`.
   - **Search:** keep the 240 ms `debounce`. `q.trim().length >= 2` → `cachedApiQuery(userSelectSearchQuery(companyId, type ?? null, q, `${excludeSelf}|${allowedIds}`), url)` where `url` = `path.to.api.userSelectSearch(q, type)` plus `&excludeSelf=true` / `&allowedIds=...` exactly as the old code appended them; store in `search.results` (groups filtered client-side by `allowedIds`? No — `allowedIds` applies to users only, server-side, as today). `q.length === 1` → stay in browse mode and client-filter top-level nodes by `stringContainsTerm(group.name, q)` (keep the helper). Empty `q` → clear search state.
   - **Value hydration effect:** unknown `value` ids (not in `selectionItemsById`) → one `cachedApiQuery(userSelectResolveQuery(companyId, ids), path.to.api.userSelectResolve(ids))`; hydrate users as today; hydrate groups as `{ ...g, users: [], memberCount: 0, uid: getOptionId("preselected", g.id), label: g.name }`. Track requested ids in a ref so a resolve that legitimately returns nothing (deleted id) doesn't refetch in a loop. Remove the `group_` prefix special-case.
   - **onSelect for groups:** selection item = `{ ...group, users: [], memberCount: group.userCount + group.groupCount, uid, label: group.name }`.
   - **onExplode:** make internally async — if `membersById[item.id]` is missing, first `await` the members fetch (same call as prefetch), then explode into direct users + direct child groups (child groups become selection items with `users: []`), replacing the group selection as today.
   - **isGroup helper (exported):** change to presence-based: `export function isGroup(item: IndividualOrGroup) { return "users" in item; }` — group selection items always carry `users` (possibly `[]`); user items never do. This keeps `SelectionList.tsx` `canExpand` and `Users.tsx` `verbose` working, and makes empty groups expandable-on-explode.
   - **onKeyDown changes:** `Enter` — if the focused node is a group row and groups are selectable (`!usersOnly`), toggle-select it (do NOT require `hasParent`); if `usersOnly`, toggle expansion. `Space` — same toggle semantics for group rows. `ArrowRight`/`ArrowLeft` keep expand/collapse. User rows keep existing behavior. `hasChildren(uid)` now reads `focusableNodes.current[uid].expandable`.
   - Return additionally: `viewModel`, `hasMore`, `loadingMore`, `loadMore`, keeping every existing returned field name.

3. **Popover.tsx** — replace the two-level DOM walk (lines 25-77) with a depth-N walk so nesting works: query `listBoxRef.current.querySelectorAll('[role="treeitem"]')` in DOM order; for each element, `uid = el.id`, `expandable = el.getAttribute("data-expandable") === "true"`, `parentId` = the `id` of the nearest ancestor element with `role="treeitem"` (via `el.parentElement?.closest('[role="treeitem"]')`, `undefined` at top level); then build the same triple linked-list. Keep the effect deps (`[children, ...]`) so it rebuilds when the tree re-renders (expansion, new pages, search).
4. **TreeSelect.tsx** — rewrite rendering:
   - Browse mode: recursive `<GroupRow node={...} depth={n}>`. The row is `role="treeitem"`, `id={node.uid}`, `data-expandable={canExpand}`, and contains: a chevron **button** (`ExpandIcon` wrapped in a 40px-hit-area button; `onClick` stops propagation and toggles expand; hidden when `userCount + groupCount === 0`), the group name, the `userCount` as the plain-number badge (or `Spinner` while loading — keep current pattern), and the same check/selected treatment `Option` rows use. **Row `onClick` = toggle selection** when `!usersOnly` (respect `alwaysSelected` disable), else toggle expansion. `onMouseEnter` prefetches when collapsed (keep). Expanded content: nested `<ul role="group">` with child `GroupRow`s first, then user `Option` rows (reuse the existing `Option` component; drop its group-item branch usage in browse mode — groups render only as `GroupRow` now, so the duplicated "group as first item" disappears). Expanded-but-empty (members loaded, zero items): muted "No members" row.
   - After the last top-level node render the sentinel + load-more UI:
     ```tsx
     {viewModel.hasMore && <SentinelRow onVisible={loadMore} loading={viewModel.loadingMore} />}
     ```
     `SentinelRow` uses `useInView` from `react-intersection-observer` exactly like `apps/erp/app/components/InfiniteScroll.tsx:47` (`threshold: 0`, effect calls `onVisible()` when `inView && !loading`), rendering a `Spinner` row while loading. Give it NO `role`/`id` so the focus builder ignores it.
   - Search mode: two flat sections with plain non-interactive headers ("Groups" — hidden when `usersOnly` or empty; "People") whose rows are `Option`-style `role="treeitem"` items: group rows show `LuUsers` icon + name + "N members" (from `userCount`) + the "Group" badge, are selectable, and have NO chevron and `data-expandable="false"`; user rows unchanged. Keep "No options found" for zero results.
   - Loading: keep the existing top-level `Spinner` block for `initialLoading`.
5. **SelectionList.tsx** — no structural change; verify `canExpand` still works via the new `isGroup` (it will — group items keep `users`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm run lint 2>&1 | tail -5
# Expected: no new errors in apps/erp/app/components/Selectors/UserSelect/**
```

**Out of scope:** `Input.tsx`, `Combobox.tsx`, `Container.tsx`, `provider.ts`, `UserSelect.tsx` stay untouched. Wrapper components (`Form/Users.tsx`, `Form/User.tsx`, `Form/Employees.tsx`, `Assignee.tsx`) and all call sites stay untouched — if any of them fails to compile against the new internals, STOP and report; do not change wrapper contracts.

**Escape hatch:** If the DOM-order focus walk conflicts with how `aria-activedescendant` focus currently behaves (keyboard nav visibly broken in Task 10), STOP and report with the failing interaction — do not silently drop keyboard support.

---

## Task 6: Migrate EmailRecipients off the eager endpoint

**Depends on:** Tasks 3, 4
**Files:**
- Modify: `apps/erp/app/components/Form/EmailRecipients.tsx` — replace `useEmailOptions` (lines 57-120) and `handleSelect` (lines 214-223)
- Copy from (precedent): keep this file's own cmdk structure; fetch pattern from Task 5's `cachedApiQuery` usage

**Steps:**

1. Replace `useEmailOptions(type)`:
   - Delete the `groupsFetcher` + `groupsByTypeWithUsers` load and the recursive `collectGroupEmails`/`processGroup` flattening.
   - On mount: `cachedApiQuery(userSelectGroupsQuery(companyId, type, 0), path.to.api.userSelectGroups(type, 0))` → keep groups with `userCount + groupCount > 0` as `GroupOption`s: `{ type: "group", id, name, emails: [], memberCount: userCount }`.
   - Track `inputValue` (lift it or pass it into the hook): when `inputValue.trim().length >= 2`, `cachedApiQuery(userSelectSearchQuery(companyId, type, q, ""), path.to.api.userSelectSearch(q, type))` → options become matched groups (same mapping) + matched users with an email: `{ type: "user", id, name: fullName, email }` (skip users with null email), deduped by email as today. For shorter input keep the existing client-side filter over the mounted group options.
2. `handleSelect` for groups becomes async: `const { emails } = await cachedApiQuery<{ emails: string[] }>(groupEmailsQuery(companyId, option.id), path.to.api.userSelectGroupEmails(option.id)); addEmails(emails);`. User selection and raw-email Enter entry stay unchanged.
3. Update the `GroupOption` member-count subtitle to render `memberCount` (direct active users) — plain number.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -rn "groupsByTypeWithUsers" apps/erp/app --include="*.tsx" --include="*.ts" | grep -v "utils/path.ts"
# Expected: no output (no consumers left)
```

**Out of scope:** The component's props, hidden-input emission (`name[index]`), validation, and popover UX stay unchanged.

---

## Task 7: Wire cache invalidation into all group-mutating routes

**Depends on:** Task 3
**Files (all Modify, all in `apps/erp/app/routes/x+/users+/` unless noted):**
- `groups.new.tsx` — replace the existing predicate body (lines 75-84)
- `groups.$groupId.tsx` — add `clientAction` (none today)
- `groups.delete.$groupId.tsx` — add `clientAction` (none today)
- `employees.new.tsx` — replace the existing predicate (line ~130-137)
- `employees.$employeeId.tsx` — add `clientAction` (employee-type change moves memberships via DB trigger)
- `deactivate.tsx` — add `clientAction`
- `employee-types.new.tsx`, `employee-types.$employeeTypeId.tsx`, `employee-types.delete.$employeeTypeId.tsx` — add `clientAction` (triggers mirror employeeType rows into groups)
- `customers.new.tsx`, `suppliers.new.tsx` — add `clientAction` (interceptors create org groups)
- Copy from (precedent): `apps/erp/app/routes/x+/users+/groups.new.tsx:75-84` (existing clientAction shape)

**Steps:**

1. In each file add (or replace the body of) the `clientAction` with exactly:

```typescript
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  invalidateUserSelectQueries(getCompanyId());
  return await serverAction();
}
```

with imports `import type { ClientActionFunctionArgs } from "react-router";` and `import { getCompanyId, invalidateUserSelectQueries } from "~/utils/react-query";` (merge into existing imports where present).

2. In `groups.new.tsx` and `employees.new.tsx`, the existing `groupsByType` predicate is REPLACED by the helper call (the old key dies in Task 8) — do not keep both.

**Verify:**
```bash
grep -rln "invalidateUserSelectQueries" apps/erp/app/routes/x+/users+/ | wc -l
# Expected: 11
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** `bulk-edit-permissions.tsx`, invite routes (`resend-invite`, `revoke-invite`), and `operators.*` — they don't change groups or memberships.

---

## Task 8: Delete the old endpoints, path helpers, and query key

**Depends on:** Tasks 5, 6
**Files:**
- Delete: `apps/erp/app/routes/api+/users.groups.tsx`
- Delete: `apps/erp/app/routes/api+/users.groups.$groupId.members.tsx`
- Delete: `apps/erp/app/routes/api+/users.search.tsx`
- Delete: `apps/erp/app/routes/api+/users.batch.tsx`
- Modify: `apps/erp/app/utils/path.ts` — remove `groupsByType`, `groupsByTypeWithUsers`, `groupMembers`, `usersSearch`, `usersBatch` (lines 62-71)
- Modify: `apps/erp/app/utils/react-query.ts` — remove `groupsByTypeQuery` (lines 184-190)
- Modify: `apps/erp/app/modules/users/types.ts` — remove the tree `Group` type (lines 36-49) IF orphaned (see step 3)

**Steps:**

1. Delete the four route files and the five path helpers and `groupsByTypeQuery`.
2. `rg -n "groupsByType|groupsByTypeWithUsers|groupMembers\(|usersSearch|usersBatch|arrayToTree" apps/erp/app` — fix every remaining reference (there should be none after Tasks 5-7; if one appears outside the deleted files, STOP and report before deleting further).
3. `rg -n "Group\b" apps/erp/app/modules/users/ apps/erp/app/components/` for the tree `Group` type: if the only remaining importers were the deleted files / rewritten components, remove the type; if something else (e.g. admin Groups UI) imports it, leave it and note in the plan progress line.
4. Leave `performant-array-to-tree` in `package.json` if other code imports it; remove the import only from deleted files (they're deleted anyway). Run `rg -n "performant-array-to-tree" apps/erp` — if zero hits remain, remove it from `apps/erp/package.json` dependencies.

**Verify:**
```bash
rg -n "groupsByType|usersBatch|usersSearch|api/users/groups|api/users/batch|api/users/search" apps/erp/app
# Expected: no output
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** DB views/RPCs (`groups`, `groups_recursive`, `groupMembers` view, `groups_query`, `groups_for_user`, `users_for_groups`) stay. Admin routes `x+/users+/groups.tsx` / `groups.$groupId.tsx` loaders (using `getGroups`/`getGroupMembers` service functions) stay.

---

## Task 9: Run validation gates

**Depends on:** Tasks 1–8
**Files:** none (verification only)

**Steps:**

1. `pnpm exec turbo run typecheck --filter=erp` — must exit 0.
2. `pnpm run lint` — must report no errors in changed files (pre-existing warnings elsewhere are acceptable).
3. `pnpm run test` — unit suite must pass (no unit tests cover UserSelect today; this guards regressions elsewhere).
4. Confirm generated types untouched: `git status --porcelain packages/database/src/types.ts` → empty.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint && pnpm run test
# Expected: all exit 0
```

**Out of scope:** No `pnpm run build` needed (no vite config/dependency changes). No whole-repo typecheck.

---

## Task 10: Browser-verify via /test

**Depends on:** Task 9
**Files:** none (verification; playbook may be cached to `.ai/playbooks/`)

**Steps:**

1. Ensure the dev stack is up (`crbn up`, plain portless mode). If it cannot boot, STOP — the task is blocked, not done.
2. Invoke the `/test` skill with this scenario list (it handles `/auth` login):
   - **Lazy first page:** Open Settings → Approvals → an approval rule form (`ApprovalRuleForm` renders `<Users type="employee">`). Open the select; confirm the list shows top-level groups with "All Employees" pinned first with a member-count badge, and via the browser network log confirm exactly one request to `/api/users/select/groups?...offset=0` and NO request to `/api/users/groups`.
   - **Click-to-select + chevron:** Click a group row → it becomes selected (chip appears) without expanding. Click its chevron → it expands showing users (and nested groups, if any) without changing selection. Expand a nested group if present.
   - **Hover prefetch + cache:** Collapse, re-expand the same group → no second members request (network log).
   - **Infinite scroll:** If the dev company has ≤25 top-level employee groups, create enough groups via Settings → Users → Groups (or psql fixtures) to exceed 25, reload, open the select, scroll the dropdown to the bottom → a second page request fires and more groups render.
   - **Search:** Type 1 character → list filters client-side, no search request. Type ≥2 chars (e.g. "eng") → one debounced `/api/users/select/search` request; flat Groups + People sections; group rows have no chevron; selecting a group from search works; clearing the input restores the browse list without a new page-0 request.
   - **Preselected resolve:** Open an existing record whose form has saved user+group selections (e.g. the same approval rule after saving, or Documents → share form) → chips render names immediately with a single `/api/users/select/resolve` request.
   - **Invalidation:** Rename a group in Settings → Users → Groups, return to the approval form, open the select → the renamed group shows (fresh `/api/users/select/groups` request after invalidation).
   - **usersOnly:** Open a `<Employees>` usage (Settings → Users → Employees → Bulk Edit Permissions) → group rows expand on click and are NOT selectable; only people can be selected.
   - **Explode:** In a multi select, select a group, click the chip's Expand button → the group is replaced by its direct members.
   - **EmailRecipients:** Open a flow using `EmailRecipients` (e.g. quote/order email dialog) → no `include=users` request; typing ≥2 chars searches; selecting a group adds its member emails; typing a raw email + Enter still adds it.
   - **GroupsForm verbose:** Settings → Users → Groups → edit a group's members → save → members persist (verbose `group_`/`user_` prefixes still round-trip).
3. Capture screenshots of the open select (browse mode with counts, search mode flat list) for the PR.

**Verify:**
```bash
# /test run report
# Expected: every scenario above passes; screenshots saved; any failure loops back to the offending task
```

**Out of scope:** No performance load-testing; the structural guarantees (bounded payload, no recursive view) are verified by the network assertions above.
