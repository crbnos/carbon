# User Select Performance Rewrite

> Status: draft
> Author: Brad Barbin + Claude
> Date: 2026-07-14

## TLDR

Rewrite the `UserSelect` data layer (and the `EmailRecipients` picker that shares its data source) around lazy, paginated, purpose-built endpoints cached in the existing `window.clientCache` (TanStack QueryClient) pattern. The recursive `groups` view — which walks the **entire multi-tenant `membership` table and `jsonb_agg`s full user rows on every open** — leaves the hot path entirely. The bespoke tree combobox shell is kept; interactions change so a group row is click-to-select with a separate chevron to expand, search returns a flat non-expandable list of groups + people, top-level groups load in pages with infinite scroll, and preselected values hydrate from a single mixed-id resolve endpoint.

## Problem Statement

Every open of the user select fetches `/api/users/groups?type=…`, which reads the `groups` view (`20230123004632_groups.sql`). That view has three structural performance problems, all verified in the SQL:

1. **Cross-tenant recursive scan.** `groups` aggregates over `groups_recursive`, a recursive view over ALL memberships of ALL companies. The route's `.eq("companyId", companyId)` cannot be pushed down into a recursive CTE — Postgres computes the full walk, then filters.
2. **Eager `jsonb_agg` of whole user rows.** The view aggregates `to_jsonb(u)` per group even when the caller omits the `users` column from its select.
3. **Multi-row duplication.** A nested group appears once per parent path *and* once at the root (the recursive view's base case emits every membership row with `parentId = NULL`), which is why `users.groups.$groupId.members.tsx` needs a `.limit(1).maybeSingle()` workaround, and why `arrayToTree` receives duplicate ids.

On top of the query cost: the whole group tree is fetched up-front (structure for every group, members already lazy per group), search covers users only (groups are not searchable), preselected group ids can only be labeled by loading the entire tree, and there is no pagination — a company with hundreds of groups renders them all.

`EmailRecipients.tsx` is worse: it uses the `?include=users` variant (`groupsByTypeWithUsers`) — the full recursive tree **with** every member's user JSON — flattened client-side just to build email options.

## Proposed Solution

Keep the bespoke tree-combobox shell (`apps/erp/app/components/Selectors/UserSelect/`) and its WAI-ARIA keyboard model. Replace the data layer with five thin endpoints backed by two new plpgsql RPCs that query `group`/`membership` directly (indexed, company-scoped, non-recursive), cached read-through in `window.clientCache` via `fetchQuery`, invalidated by `clientAction`s on every group-mutating route.

### Data-fetching strategy

| Interaction | Request | Notes |
|---|---|---|
| Open (empty input) | `GET /api/users/select/groups?type=&offset=0&limit=25` | Top-level groups only, with member counts. No user rows. |
| Scroll to bottom of list | same, `offset += 25` | Infinite scroll; pages accumulate in component state. |
| Expand a group (or hover-prefetch) | `GET /api/users/select/groups/:groupId/members` | Direct child groups (with counts) + direct active users. Works at every nesting depth. |
| Type ≥ 2 chars (240 ms debounce) | `GET /api/users/select/search?q=&type=&excludeSelf=&allowedIds=` | Flat result: matching groups (all levels, not just top-level) + matching users. Nothing expandable. |
| Mount with preselected ids | `GET /api/users/select/resolve?ids=a,b,c` | Mixed user/group ids → `{ users, groups }` so chips render immediately. |
| EmailRecipients selects a group | `GET /api/users/select/groups/:groupId/emails` | Recursive member emails via existing `users_for_groups`-based `getGroupEmails`. |

1-character input filters the already-loaded pages client-side (parity with today's `< 2 chars` behavior).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Component shell | Keep bespoke tree combobox (`UserSelect/` + `useUserSelect.ts`); no cmdk rebuild | User decision 2026-07-14. Expand/collapse of children is a kept behavior; perf problem is data, not rendering; ~31 consumer files depend on current behavior. |
| Caching | Existing imperative `window.clientCache` pattern — **no** `QueryClientProvider`, no hooks | User decision 2026-07-14 ("we already have a react query pattern — use that"). Component fetches go through `clientCache.fetchQuery({ queryKey, staleTime, queryFn })`, which gives read-through caching, staleness, and concurrent-call dedupe with the existing client. |
| Cache invalidation | `clientAction`s on every route that mutates groups/memberships (matrix below) call a shared `invalidateUserSelectQueries(companyId)` | User directive: "be sure to clear the cache when we modify/add groups." Today only `groups.new` and `employees.new` invalidate — group **edit/delete** do not; this fixes that gap. |
| Scope | `EmailRecipients` migrates in v1 too | User decision 2026-07-14. Removes the last consumer of the eager `?include=users` endpoint. |
| Type filters | `type="employee" \| "customer" \| "supplier"` and `queryFilters` (`excludeSelf`, `allowedIds`) stay as props; every new endpoint takes them as params | User directive 2026-07-14. Flag semantics identical to the current route: `employee` → all non-customer/supplier flags false-filtered; `customer` → `isCustomerTypeGroup OR isCustomerOrgGroup`; `supplier` → mirror. |
| Group row semantics | Row click **selects** the group; the chevron (separate hit target) expands/collapses; hover still prefetches members. Applies at every depth, not just top level. In `usersOnly` mode groups are not selectable, so row click expands (parity). The redundant "group as first child item" row is removed. | User decision: top-level node is both selectable and expandable when browsing; search results have nothing to expand. |
| Search results | Flat, non-expandable: Groups section then People section. In `usersOnly` mode only people are shown (an unselectable, unexpandable group row would be dead UI). | User's point 2c; groups become name-searchable for the first time. |
| "Top-level" definition | The seeded per-company roots ("All Employees" `00000000-0000-…`, "All Customers" `11111111-1111-…`, "All Suppliers" `22222222-2222-…`) plus direct children of those roots plus groups that are not a member of any group. Roots stay visible, selectable, pinned first. | Matches the real hierarchy (type groups are auto-nested under deterministic-uuid roots by triggers; custom groups are parentless). Roots are genuinely useful "everyone" targets and exist in today's data. |
| Sort order | `is_root DESC, is_type_group DESC, name ASC, id ASC` | Parity with the old view's `isEmployeeTypeGroup DESC … name ASC` while being deterministic for offset pagination. |
| Pagination style | Offset + limit (25/page), `hasMore` via `limit + 1` fetch | Groups change rarely; offset matches table conventions (`setGenericQueryFilters`/`.range()`); cursor precedent exists only for the append-heavy ledger feed. |
| New SQL | One migration adding two `plpgsql` `STABLE SECURITY INVOKER` functions; **no table changes, no changes to existing views/RPCs** | `plpgsql` because PostgREST can drop a `LANGUAGE sql` function's internal `ORDER BY` (known lesson). Existing views/RPCs stay for admin pages and document-RLS (`groups_for_user` / `users_for_groups` untouched). |
| Member counts | `userCount` = direct active member users; `groupCount` = direct child groups. Tree rows show **no count badge** (2026-07-14 user directive) — counts drive expandability (`userCount + groupCount > 0` → chevron) and `usersOnly` filtering only; "N members" appears solely on search-result rows and in EmailRecipients. | Direct counts are one indexed aggregate; recursive counts would reintroduce the recursive walk. EmailRecipients' count becomes direct-count (was recursive unique-email count) — accepted trade-off; emails still resolve recursively on selection. |
| Members on expand | All direct members, un-paginated | Parity with today (the old view aggregated all of them anyway); bounded by real group sizes. |
| Empty groups in `usersOnly` | Hidden when `userCount = 0 AND groupCount = 0` | Parity with today's "group with no known members is filtered out"; a group with child groups stays visible since descendants may hold users. |
| Value contract | `UserSelectProps` unchanged: `value` = raw ids, `onChange(IndividualOrGroup[])`. Group selection items keep a `users` key (empty array when not loaded) so the `"users" in item` discriminator used by `Users.tsx` `verbose` mode keeps working; `memberCount` added. `onExplode` fetches members on demand before exploding. | 31 wrapper call sites compile and behave unchanged. |
| Old endpoints | `users.groups.tsx`, `users.groups.$groupId.members.tsx`, `users.search.tsx`, `users.batch.tsx` + their `path.to.api.*` helpers + `groupsByTypeQuery` are **deleted** once both components migrate (they have no other consumers — verified) | "Never leave stale endpoints." Admin pages (`getGroups`/`groups_query`, `getGroupMembers`) don't use these routes and are out of scope. |
| Permissions | New routes use `requirePermissions(request, { role: "employee" })` + explicit `companyId` scoping in every query/RPC | Parity with the existing select endpoints; these serve option lists, not module data. |
| User search scoping | Users are matched via `ilike` on `fullName` against the **`groupMembers` view** — active users who are members of this company's groups, filtered by the same type flags as the group list; deduped per user, limit 20 (2026-07-14 revision after user feedback) | Consistency by construction: search finds exactly the people the tree can reach (member lists filter on `user.active` only). The earlier `userToCompany` inner-join scoping used a different population rule than the tree, which read as "missing users". |
| Generated types | RPC/response typing via `Awaited<ReturnType<…>>` casts in the service; do **not** commit a local `pnpm db:types` regeneration | Committed types are cloud-generated; local regen produces a huge wrong diff (known reference). |
| Competitor research | Skipped — not an ERP-domain feature | This is a frontend data-fetching pattern (async tree select, keyset/offset paging); design anchors on internal precedent (`InfiniteScroll.tsx`, ledger-activity pagination, clientLoader caching) instead of `.ai/research/`. |

### Heuristics checklist

| # | Heuristic | Answer |
|---|-----------|--------|
| 1 | Multi-tenancy | No new tables. New RPCs take `p_company_id` and filter on it; the legacy `group` table (single-col PK, nullable `companyId`, no RLS) is unchanged — pre-existing gap noted in Risks. |
| 2 | Service shape | New functions in `users.service.ts` take `client` first, return `{ data, error }`, never throw. |
| 3 | RLS coverage | No new tables. RPCs are `SECURITY INVOKER`, so existing `membership`/`user` RLS applies to the caller. |
| 4 | Permission scoping | `role: "employee"` on all five routes (parity with the routes they replace). |
| 5 | Form pattern | N/A — no new forms; existing wrappers (`Users`, `Employees`, `User`) unchanged. |
| 6 | Module layout | Service/model additions go in `apps/erp/app/modules/users/users.service.ts` / `types.ts`; UI stays in `components/Selectors/UserSelect/`. |
| 7 | Backward compatibility | Public component props unchanged; old API routes deleted only after both consumers migrate in the same change; DB views/RPCs (`groups`, `groups_query`, `groups_for_user`, `users_for_groups`) untouched. |

## Data Model Changes

No table changes. One migration (`pnpm db:migrate:new user-select-rpcs`, randomized HHMMSS) adding two functions:

```sql
-- Paginated group list for the user select.
-- p_search NULL  → top-level groups only (roots pinned first)
-- p_search set   → ALL matching groups at any depth (flat search)
CREATE OR REPLACE FUNCTION get_user_select_groups(
  p_company_id TEXT,
  p_type TEXT DEFAULT NULL,      -- 'employee' | 'customer' | 'supplier' | NULL
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  "id" TEXT, "name" TEXT,
  "isEmployeeTypeGroup" BOOLEAN, "isCustomerOrgGroup" BOOLEAN,
  "isCustomerTypeGroup" BOOLEAN, "isSupplierOrgGroup" BOOLEAN,
  "isSupplierTypeGroup" BOOLEAN,
  "userCount" INT, "groupCount" INT, "isRoot" BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  -- deterministic per-company root ids (see 20230123004632_groups.sql triggers)
  _roots TEXT[] := ARRAY[
    '00000000-0000-' || substring(p_company_id, 1, 4) || '-' || substring(p_company_id, 5, 4) || '-' || substring(p_company_id, 9, 12),
    '11111111-1111-' || substring(p_company_id, 1, 4) || '-' || substring(p_company_id, 5, 4) || '-' || substring(p_company_id, 9, 12),
    '22222222-2222-' || substring(p_company_id, 1, 4) || '-' || substring(p_company_id, 5, 4) || '-' || substring(p_company_id, 9, 12)
  ];
BEGIN
  RETURN QUERY
  SELECT g."id", g."name",
    g."isEmployeeTypeGroup", g."isCustomerOrgGroup", g."isCustomerTypeGroup",
    g."isSupplierOrgGroup", g."isSupplierTypeGroup",
    (SELECT count(*)::INT FROM "membership" m JOIN "user" u ON u."id" = m."memberUserId"
      WHERE m."groupId" = g."id" AND u."active" = TRUE)                        AS "userCount",
    (SELECT count(*)::INT FROM "membership" m
      WHERE m."groupId" = g."id" AND m."memberGroupId" IS NOT NULL)            AS "groupCount",
    (g."id" = ANY(_roots))                                                     AS "isRoot"
  FROM "group" g
  WHERE g."companyId" = p_company_id
    AND g."isIdentityGroup" = FALSE
    AND CASE
      WHEN p_type = 'employee' THEN NOT (g."isCustomerOrgGroup" OR g."isCustomerTypeGroup"
                                          OR g."isSupplierOrgGroup" OR g."isSupplierTypeGroup")
      WHEN p_type = 'customer' THEN (g."isCustomerTypeGroup" OR g."isCustomerOrgGroup")
      WHEN p_type = 'supplier' THEN (g."isSupplierTypeGroup" OR g."isSupplierOrgGroup")
      ELSE TRUE END
    AND CASE
      WHEN p_search IS NOT NULL AND p_search <> ''
        THEN g."name" ILIKE '%' || p_search || '%' AND NOT (g."id" = ANY(_roots))
      ELSE (
        g."id" = ANY(_roots)
        OR EXISTS (SELECT 1 FROM "membership" m
                    WHERE m."memberGroupId" = g."id" AND m."groupId" = ANY(_roots))
        OR NOT EXISTS (SELECT 1 FROM "membership" m WHERE m."memberGroupId" = g."id")
      ) END
  ORDER BY (g."id" = ANY(_roots)) DESC,
           (g."isEmployeeTypeGroup" OR g."isCustomerTypeGroup" OR g."isSupplierTypeGroup") DESC,
           g."name" ASC, g."id" ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Direct members of one group: child groups (with counts) + active users.
CREATE OR REPLACE FUNCTION get_user_select_group_members(
  p_company_id TEXT,
  p_group_id TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
  -- { "groups": [{id, name, flags…, userCount, groupCount}],
  --   "users":  [{id, firstName, lastName, fullName, email, avatarUrl}] }
  -- Guards g."companyId" = p_company_id via the parent group row; returns
  -- '{"groups":[],"users":[]}' when the group is not in the company.
  …
$$;
```

Both are additive and idempotent (`CREATE OR REPLACE`). The `groups` search branch and members lookup ride the existing indexes (`group_companyId_idx`, `index_membership_groupId`, `index_membership_memberGroupId`). `NOTIFY pgrst, 'reload schema';` at the end.

## API / Service Changes

### New routes (`apps/erp/app/routes/api+/`), all `role: "employee"`

| Route file | Path (`path.to.api.*`) | Serves | Backing |
|---|---|---|---|
| `users.select.groups.tsx` | `userSelectGroups(type, offset)` | `{ groups, hasMore }` first/next page of top-level groups | RPC `get_user_select_groups` (fetch `limit + 1`) |
| `users.select.groups.$groupId.members.tsx` | `userSelectGroupMembers(groupId)` | `{ groups, users }` direct members | RPC `get_user_select_group_members` |
| `users.select.search.tsx` | `userSelectSearch(q, type, filters)` | `{ groups, users }` flat search, ≥2 chars, limit 20 users / 10 groups | RPC (search branch) + `user` `ilike fullName` inner-joined to `userToCompany` on `companyId`, `active = true`, honoring `excludeSelf`/`allowedIds` |
| `users.select.resolve.tsx` | `userSelectResolve(ids)` | `{ users, groups }` for mixed preselected ids | `user.in("id", ids)` + `group.in("id", ids).eq("companyId", companyId)` with member counts |
| `users.select.groups.$groupId.emails.tsx` | `userSelectGroupEmails(groupId)` | `{ emails }` recursive member emails | existing `getGroupEmails` (`users_for_groups` → `getUserEmails`) |

### Service functions (`users.service.ts`)

`getUserSelectGroups`, `getUserSelectGroupMembers`, `searchUsersAndGroupsForSelect`, `resolveUserSelectIds` — all `(client, companyId, args)` → `{ data, error }`. RPC result typing via casts (no committed type regen).

### Caching (existing pattern, no provider)

- New factories in `apps/erp/app/utils/react-query.ts`:
  `userSelectGroupsQuery(companyId, type, offset)` (Low), `userSelectMembersQuery(companyId, groupId)` (Low), `userSelectSearchQuery(companyId, type, q, excludeSelf, allowedIds)` (High), `userSelectResolveQuery(companyId, sortedIds)` (Low), `groupEmailsQuery(companyId, groupId)` (Low).
- The component fetches through one helper: `window.clientCache.fetchQuery({ queryKey, staleTime, queryFn: () => fetch(url).then(r => r.json()) })` — read-through + staleness + in-flight dedupe (two selects on one page share requests). The current `searchCache` ref and raw uncached fetches are deleted.
- Shared helper `invalidateUserSelectQueries(companyId)` in `react-query.ts`: invalidate by predicate `queryKey[1] === companyId && queryKey[0] ∈ {userSelectGroups, userSelectMembers, userSelectSearch, userSelectResolve, groupEmails}`.

### Cache invalidation matrix (`clientAction`s)

| Route (`x+/users+/`) | Why | Today |
|---|---|---|
| `groups.new.tsx` | creates group + memberships | invalidates old key → **replace** |
| `groups.$groupId.tsx` | edits group + memberships | **missing today → add** |
| `groups.delete.$groupId.tsx` | deletes group | **missing today → add** |
| `employees.new.tsx` | trigger adds user to employee-type group | invalidates old key → **replace** |
| `employees.$employeeId.tsx` | employee-type change moves membership (trigger) | **add** |
| `deactivate.tsx` | deactivated users leave member lists/counts | **add** |
| `employee-types.new.tsx` / `employee-types.$employeeTypeId.tsx` / `employee-types.delete.$employeeTypeId.tsx` | triggers create/rename/remove the mirrored group | **add** |
| `customers.new.tsx` / `suppliers.new.tsx` (and `x+/customer+/new`, `x+/supplier+/new` if they create accounts) | interceptors create org groups / account memberships | **add** |

### Deletions (same change, after both components migrate)

Routes `users.groups.tsx`, `users.groups.$groupId.members.tsx`, `users.search.tsx`, `users.batch.tsx`; path helpers `groupsByType`, `groupsByTypeWithUsers`, `groupMembers`, `usersSearch`, `usersBatch`; key factory `groupsByTypeQuery`. (Verified only `useUserSelect.ts` and `EmailRecipients.tsx` consume them.) DB views/RPCs are **not** dropped — `groups_query` (admin GroupsTable), `groupMembers` view (group edit drawer), `groups_for_user`/`users_for_groups` (document RLS, approvals, MCP `users_getGroupEmails`) remain.

## UI Changes

### `UserSelect` (`components/Selectors/UserSelect/`)

- **Browse mode** (input < 2 chars): paged top-level groups. Group row = name + chevron (a spinner replaces the row's trailing slot while its members load; no count badge). **Row click selects the group** (adds/removes like any option); **chevron click expands** without selecting; hover prefetches members. Expanding renders direct users and child groups; child groups behave identically (selectable + expandable) at every depth. In `usersOnly` mode group rows aren't selectable — row click expands; groups with `userCount = 0 AND groupCount = 0` are hidden.
- **Infinite scroll**: sentinel row at the end of the top-level list via `useInView` (`react-intersection-observer`, already a dependency; the existing `InfiniteScroll` component's render-prop API doesn't fit the tree markup). Spinner row while a page loads; sentinel gone when `hasMore` is false.
- **Search mode** (≥ 2 chars, 240 ms debounce): flat sections — Groups (selectable rows, "Group" badge, member count, **no chevron**) then People. `usersOnly` shows People only. Clearing the input returns to browse mode (pages retained).
- **Selection state**: preselected `value` ids not yet in memory resolve through one `userSelectResolve` call → chips render name/avatar immediately. Group selection items keep `users: []` (discriminator for `Users.tsx` `verbose`) + `memberCount`; `onExplode` first fetches the group's members, then explodes (unchanged semantics: direct users).
- **Keyboard**: existing tree model preserved — Up/Down moves, Right/Left expands/collapses a focused group, Enter selects the focused row (now including group headers), Space toggles. Search mode is a flat list under the same navigation.
- Props unchanged (`isMulti`, `usersOnly`, `type`, `queryFilters`, `alwaysSelected`, `checkedSelections`, `showAvatars`, `resetAfterSelection`, …).

### `EmailRecipients` (`components/Form/EmailRecipients.tsx`)

- Keeps its cmdk chip-input UI. Data goes lazy: empty input shows the first page of top-level groups (with counts); typing ≥ 2 chars hits `userSelectSearch` (users include email); typing a raw valid email + Enter still adds it (unchanged).
- Selecting a user adds their email. Selecting a group fetches `userSelectGroupEmails(groupId)` and adds the deduped recursive member emails (today's semantics, resolved server-side instead of from the eager tree). Groups with `userCount = 0 AND groupCount = 0` hidden.
- No request to `groupsByTypeWithUsers` remains anywhere.

## Acceptance Criteria

- [ ] Opening a `<Users type="employee">` select issues exactly one request (`/api/users/select/groups?...offset=0`) returning at most 25 groups and zero user rows; nothing queries the `groups` view on this path (verify via Postgres logs or `EXPLAIN`-level inspection of the RPC).
- [ ] In a company with more than 25 top-level groups, scrolling the open list to the bottom loads the next page; every top-level group is reachable; the sentinel disappears on the last page.
- [ ] Clicking a group row (non-`usersOnly`) selects it immediately — no expansion required; clicking its chevron expands it without selecting; both work on nested groups. In `usersOnly` mode, row click expands and the group is not selectable.
- [ ] Expanding a group issues one members request and renders its direct users and child groups; re-expanding it (within staleness) issues zero network requests; hovering a collapsed group prefetches its members.
- [ ] Typing "eng" issues one debounced search request; results render as a flat Groups + People list with no chevrons; selecting a group from search adds it as a selection; clearing the input restores the browse tree without refetching page 0.
- [ ] A form whose `value` contains one user id and one group id renders both chips with correct names after a single `resolve` request, without the dropdown ever opening.
- [ ] Two user selects on the same page for the same `type` share the cache — the second mount issues zero group-page requests.
- [ ] After creating, renaming, or deleting a group; changing an employee's type; deactivating a user; or creating an employee type — the next open of any user select refetches fresh data (cache invalidated), without a full page reload.
- [ ] `EmailRecipients`: selecting a group adds all recursive member emails (deduped); no code path requests `groupsByTypeWithUsers`; manual email entry still works.
- [ ] `GroupsForm` (verbose `group_`/`user_` prefixes), `ApprovalRuleForm`, `DocumentForm` (`alwaysSelected`), and the read-only invite/deactivate modals compile and behave unchanged.
- [ ] Old routes/path helpers/`groupsByTypeQuery` are deleted; `rg "groupsByType|usersBatch|usersSearch|groupMembers\("` finds no live references.
- [ ] `pnpm exec turbo run typecheck --filter=erp` and `pnpm run lint` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Behavior drift in the tree (duplicate-id `arrayToTree` quirks disappear; a group nested under multiple parents now appears under each parent lazily) | Low | This is strictly more correct; acceptance criteria pin the visible behaviors that must not drift (ordering, selection, counts). |
| `group` table has no RLS (pre-existing); RPCs could be called cross-tenant via PostgREST | Med | RPCs require `p_company_id` and filter on it; `membership`/`user` RLS still applies (SECURITY INVOKER). Adding `group` RLS is out of scope (auth-layer change — Ask First territory) and noted as follow-up. |
| Stale counts/lists for *other* users within `staleTime` (30 min) after someone else edits groups | Low | Same trade-off as every cached list in the app; own mutations invalidate immediately; staleTime tunable per key. |
| `EmailRecipients` badge shows direct member count instead of recursive unique-email count; browse mode no longer lists every user up-front | Low | Emails still resolve recursively and dedupe on selection; search covers users. Accepted in design review. |
| plpgsql RPC ordering/pagination bugs (offset drift when groups change between pages) | Low | Deterministic sort with `id` tiebreak; groups mutate rarely; duplicates de-duped client-side by id when accumulating pages. |
| Deleting old endpoints breaks an unnoticed consumer | Low | Consumer search verified (only the two components); acceptance criterion greps for stragglers; deletions land in the same PR as the migrations of both consumers. |
| Committed DB types don't know the new RPCs | Low | Service functions cast RPC results (`as` narrow types in `types.ts`); no local type regen committed (cloud-generated types reference). |

## Open Questions

> All resolved with the user on 2026-07-14 before this spec was written (spec-writing Step 5 / grill).

- [x] Keep the bespoke tree-combobox shell or rebuild on cmdk primitives? — **Answer (user):** Keep the bespoke shell; expand/collapse of children is a required behavior. Top-level (and nested) group nodes are both selectable and expandable when browsing; in search mode results are flat with nothing to expand.
- [x] Mount a `QueryClientProvider` + hooks (first hook-based react-query usage), or stay imperative? — **Answer (user):** Use the existing react-query pattern (`window.clientCache` imperative cache); no provider, no hooks. Must clear the cache whenever groups are modified/added — invalidation matrix above.
- [x] Leave `EmailRecipients` on the old eager endpoint for v1? — **Answer (user):** No — refactor `EmailRecipients` too; the eager `groupsByTypeWithUsers` path is removed entirely.
- [x] Do the type filters survive the rewrite? — **Answer (user):** Yes — keep supporting all filters (`employee`, `customer`, `supplier`, plus `queryFilters`) as props; all new endpoints take them as params.

## Changelog

- 2026-07-14: Created after grill interview; all open questions resolved pre-writing (shell kept, imperative react-query pattern, EmailRecipients in scope, filters preserved).
