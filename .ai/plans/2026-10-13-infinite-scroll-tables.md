# Infinite scroll for ERP list tables — implementation plan

**Spec / source:** `.ai/specs/2026-10-13-infinite-scroll-tables.md` (read the whole spec, including Autonomous Decisions)
**Research:** `.ai/research/2026-10-13-infinite-scroll-tables.md`
**Branch:** `feat/infinite-scroll` in `/Users/aashu/work/carbon/carbon-feat-infinite-scroll` (work in this checkout; never in `.claude/worktrees`)
**Mode:** autonomous (the user approved the spec and asked for build, test, review and fixes without questions). Record every gap you resolve in the spec's Autonomous Decisions section.

🛑 Never run `git commit`, `git stash`, `git reset` or `git checkout -- <file>`. The user reviews the uncommitted tree. Never rebuild or reset the database.

## Progress

- [x] Task 1: Cursor paging core in `query.ts`
- [x] Task 2: Sort gates
- [x] Task 3: `useInfiniteRows` hook
- [x] Task 4: Desktop Table: virtualization, infinite rows, header count, selection by id
- [x] Task 5: Phone `CompactList`: auto-load and virtualization
- [x] Task 6: Pilot lists: Sales Orders, Parts, Jobs
- [x] Task 7: List registry (server)
- [x] Task 8: "Select all matching" bar and the browser bulk path
- [x] Task 9: CSV export: browser path up to 1,000 rows
- [x] Task 10: Background export job
- [x] Task 11: Background bulk-action job
- [x] Task 12a–12h: Convert the remaining lists, one batch per module
- [x] Task 13: Hand-paged and special lists
- [x] Task 14: Remove the pager code
- [x] Task 15: Docs, rules and lessons
- [x] Task 16: Final verification (browser check blocked: see spec)

## Review fixes

A strict review of the finished tree found 9 blockers. The findings and the fix waves are in `.ai/runs/2026-10-13-infinite-scroll-thermo-review.md`. The spec records each fix as a "Review fix" Autonomous Decision.

- [x] Wave A (table core): `ignoreParams` and `resetKey`, `listError`, the Back store per company, the edits overlay, `useInfiniteScroll`, `useVirtualRows`, `useSelectAllMatching`, `pageUrl`, `idColumn` and `infiniteRows`.
- [x] Wave B (server core and loaders): `loadListPage`, `X_PAGING`, `searchList`, cursor `keys`, offset tokens, no cursor in MCP.
- [x] Wave C (per table and special lists): `mapRows` in place of `onPage`, the planning grids own their rows, the Documents overlay, Sync Activity through `pageUrl`, `SINGLE_LOAD_LIMIT` with `isTruncated`.
- [x] Wave D (jobs and bulk routes): steps of at most 10,000 rows, the Lua lock, per-user export files and their download route, the streamed upload, the 2,000-row limit for Jobs Release and Batches Release, one notification per outcome.
- [ ] Browser check of the Acceptance Criteria after `crbn up` (see the spec, "Verification status").

## Dependencies

- Task 1 → Tasks 3, 6, 7, 12.
- Task 2 is independent.
- Task 3 → Tasks 4, 5.
- Tasks 4, 5 → Task 6.
- Task 6 → Tasks 7, 8, 9, 12.
- Task 7 → Tasks 10, 11.
- Tasks 12a–12h are independent of each other (different modules). Each batch adds its registry entries to its own module file in `apps/erp/app/utils/list-registry/` (Task 7). The files for every batch already exist and `index.server.ts` already merges them, so two batches never edit the same registry file.
- Tasks 12, 13 → Task 14 → Task 15 → Task 16.

## Commands (all confirmed in the repo)

```bash
pnpm --filter erp exec vitest run <path relative to apps/erp>   # one test file
pnpm --filter erp test                                           # all ERP unit tests
pnpm exec turbo run typecheck --filter=erp                       # ERP typecheck (scoped; whole-repo OOMs)
pnpm exec turbo run typecheck --filter=@carbon/jobs              # jobs typecheck
pnpm exec biome check --write --no-errors-on-unmatched <paths>   # format + lint changed files
pnpm --filter @carbon/checks license-headers                     # SPDX header on new files
```

The license fixer reads `git ls-files --cached` only (`packages/checks/src/sources/license-files.ts:24`). It does not see a new file until the file is staged. Never stage files for this. Copy the header from an existing AGPL file in the same app (the first 3 lines and one blank line), then confirm it with `inspectLicenseHeader` from `packages/checks/src/license-headers.ts` (result `ok`).

---

## Task 1: Cursor paging core in `query.ts`

**Depends on:** none
**Files:**
- Create: `apps/erp/app/utils/cursor.ts` — encode, decode, keyset filter builder, `toPage`.
- Create: `apps/erp/app/utils/cursor.test.ts`
- Modify: `apps/erp/app/utils/query.ts` — `GenericQueryFilters`, `getGenericQueryFilters`, `setGenericQueryFilters`.
- Modify: `apps/erp/app/utils/pagination.ts` — add `PAGE_SIZE = 100`.
- Copy from (precedent): `packages/ee/src/accounting/core/operations.ts:902-914` (quoted keyset `.or()`), `apps/erp/app/modules/items/items.service.ts:1634-1637` (escaping), `apps/erp/app/utils/query.test.ts` (test setup with the `@carbon/auth` mock and a query stub).

**Steps:**
1. In `pagination.ts`, add `export const PAGE_SIZE = 100;`. Keep the other exports until Task 14.
2. In `cursor.ts`, define:
   ```ts
   export type CursorValue = string | number | boolean | null | string[];
   export type Cursor = { values: CursorValue[]; id: string };
   export function encodeCursor(cursor: Cursor): string;   // base64url(JSON)
   export function decodeCursor(token: string | null): Cursor | null; // null on any parse error
   export type KeysetSort = { column: string; ascending: boolean };
   export function buildKeysetFilter(sorts: KeysetSort[], cursor: Cursor, idColumn: string): string;
   export function readSortValue(row: Record<string, unknown>, column: string): CursorValue;
   export function toPage<T extends Record<string, unknown>>(rows: T[], args: { limit: number; sorts: KeysetSort[]; idColumn?: string }): { rows: T[]; nextCursor: string | null };
   ```
3. `buildKeysetFilter` returns the string for `query.or(...)`. Rules:
   - Sorts `s1..sn` plus the tie-breaker `idColumn` ascending. For position k, the branch is `and(s1.eq.v1, …, s(k-1).eq.v(k-1), sk.<op>.vk)`; the last branch compares `idColumn.gt.id`. Join branches with `,`. A branch with one term has no `and(...)`.
   - `<op>` is `gt` for ascending, `lt` for descending.
   - NULL ordering follows Postgres: ascending = NULLS LAST, descending = NULLS FIRST.
     - Ascending, value not null: "after" means `col.gt.v` OR `col.is.null`. Ascending, value null: only rows with `col.is.null` and a later tie-breaker can follow (no `gt` term).
     - Descending, value null: "after" means `col.not.is.null` OR (`col.is.null` and later tie-breaker). Descending, value not null: `col.lt.v`.
     - An equality term for a null value is `col.is.null`.
   - Quote every non-null value: `"` + value with `\` → `\\` and `"` → `\"` + `"`. Booleans and numbers are written as their string form, quoted the same way.
   - An array value becomes a quoted Postgres array literal: `"{\"a\",\"b\"}"` with each element escaped as above.
   - A column `customFields->>abc` is used as written in the filter.
4. `readSortValue(row, column)`: if the column starts with `customFields->>`, read `row.customFields?.[key]` (string or null). Otherwise read `row[column]`. Convert `undefined` to `null`.
5. `toPage`: if `rows.length > limit`, drop the extra row and build `nextCursor` from the last kept row (`values` = each sort column's value, `id` = `String(row[idColumn ?? "id"])`). Otherwise `nextCursor = null`. In development (`process.env.NODE_ENV !== "production"`), throw an `Error` naming the column if a sort column is missing from the row (`!(column in row)` and not a `customFields->>` column).
6. In `query.ts`:
   - `GenericQueryFilters` becomes `{ limit: number; cursor: Cursor | null; sorts?: Sort[]; filters?: Filter[] }`. Remove `offset`.
   - `getGenericQueryFilters(params)` returns `limit: PAGE_SIZE`, `cursor: decodeCursor(params.get("after"))`, and the existing `sorts` / `filters` parsing.
   - `setGenericQueryFilters(query, args, defaultSorts, options?: { idColumn?: string })`:
     1. Apply filters as today.
     2. Compute the effective sorts: user sorts when present, else the default sorts. Drop any user sort whose key contains `.` (cross-table sort, Decision 6). Skip default sorts with `foreignTable` for the keyset (they order embedded rows, not the list).
     3. Apply each `.order(...)` as today. Then add `.order(idColumn, { ascending: true })` unless the last sort is already `idColumn`.
     4. If `args.cursor` is set, add `query.or(buildKeysetFilter(effectiveSorts, args.cursor, idColumn))`.
     5. Replace `.range(...)` with `.limit(args.limit + 1)` when `args.limit` is a number.
   - Export a helper `getEffectiveSorts(args, defaultSorts)` that returns the `KeysetSort[]` used in step 2, so loaders can pass the same sorts to `toPage`.
7. Write `cursor.test.ts` with at least these cases: encode/decode round trip; decode of garbage returns `null`; one ascending sort; one descending sort; two sorts; null value ascending and descending; a value with `,`, `(`, `)` and `"`; an array value; a `customFields->>x` sort; `toPage` with `limit + 1` rows and with fewer rows; `toPage` throws for a missing sort column.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/utils/cursor.test.ts
# Expected: all tests pass
pnpm --filter erp exec vitest run app/utils/query.test.ts
# Expected: pass (update the existing tests if they assert offset/range behaviour)
```
Typecheck fails at this point because loaders still read `offset`. That is expected until Task 6 and Task 12.

**Out of scope:** escaping `search` values in services (spec: follow-up).

---

## Task 2: Sort gates

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/components/Table/utils.ts:79-82` — the Sort picker map (`sortKeyToLabel`).
- Modify: `apps/erp/app/components/Table/Table.tsx:1357-1361` — header sort menu gate.
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobsTable.tsx:556,565` — `orderQuantity`, `inventoryQuantity` get `enableSorting: false`.
- Modify: `apps/erp/app/components/Table/utils.test.ts` — add cases.

**Steps:**
1. Write one exported predicate in `utils.ts`: `isServerSortable(column)` returns false when the column has no string `accessorKey`, when the sort key (`meta.sortBy ?? accessorKey`) contains `.`, or when `enableSorting === false`.
2. Use it in `buildColumnMaps` for `sortKeyToLabel` and in the header gate in `Table.tsx`.
3. Add tests: a dotted key and an `enableSorting: false` column are absent from `sortKeyToLabel`.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/components/Table/utils.test.ts
# Expected: pass
```

**Out of scope:** changing views or selects.

---

## Task 3: `useInfiniteRows` hook

**Depends on:** Task 1
**Files:**
- Create: `apps/erp/app/components/Table/useInfiniteRows.ts`
- Create: `apps/erp/app/components/Table/infiniteRowsStore.ts` (module-level back-navigation memory)
- Create: `apps/erp/app/components/Table/infiniteRowsStore.test.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/inventory+/quantities+/$itemId.activity.tsx:230-293` (cursor in refs, one load at a time).

**Steps:**
1. Public type (export it from `components/Table/types.ts`):
   ```ts
   export type InfiniteOptions = {
     dataKey: string;             // key of the rows array in the loader data
     nextCursor: string | null;   // from the loader
     onPage?: (data: Record<string, unknown>) => void; // per-page extras (Jobs batches)
   };
   ```
2. `useInfiniteRows<T>({ initialRows, infinite, getRowId })` returns `{ rows, hasMore, isLoadingMore, loadError, loadMore, retry, loadAll(limit), totalLoaded, restoredScrollTop, rememberScrollTop }`. The Table calls `rememberScrollTop(scrollTop)` from its scroll listener (spec → Autonomous Decisions).
3. Fetch the next page with `useFetcher()`: `fetcher.load(getPageUrl(useFormAction(), cursor))`. `useFormAction()` is the list route's own URL with the current search (spec → Autonomous Decisions: a drawer's child route and an index route). Track a request id in a ref and accept `fetcher.data` only for the request you started (the router re-loads mounted fetchers on revalidation; ignore those results).
4. One fetch at a time. Stop when `nextCursor` is `null`. On error set `loadError`; `retry()` repeats the last request.
5. Reset rule: when `location.search` changes (ignoring `after`), drop the loaded rows and start from `initialRows`.
6. Revalidation rule (same search, new `initialRows` identity): replace page 1 with `initialRows`. Then re-fetch the other loaded pages in order with fresh cursors, up to 20 pages in total (2,000 rows). Drop rows past 2,000 and take the cursor from row 2,000.
7. Back navigation: `infiniteRowsStore` keeps `{ rows, nextCursor, scrollTop }` per `pathname + search`, max 10 entries, oldest dropped first. Save on unmount and on each page load. On mount, if an entry exists for the same key, start from it and expose `restoredScrollTop` so the Table can scroll the container there after the first render.
8. `loadAll(limit)` loads pages until `nextCursor` is `null` or the loaded row count reaches `limit`. It returns `{ rows, complete }`.
9. Unit-test the store (size cap, key match) and any pure helper you extract (for example the 2,000-row cut).

**Verify:**
```bash
pnpm --filter erp exec vitest run app/components/Table/infiniteRowsStore.test.ts
# Expected: pass
```

**Out of scope:** Table rendering (Task 4).

---

## Task 4: Desktop Table: virtualization, infinite rows, header count, selection by id

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/components/Table/Table.tsx`
- Modify: `apps/erp/app/components/Table/components/Row.tsx`, `components/rowMemo.ts` — accept `rowRef` and `data-index`.
- Modify: `apps/erp/app/components/Table/components/TableHeader.tsx` — remove the condensed Prev/Next (`:402-405`); show the row count.
- Copy from (precedent): `apps/erp/app/components/Grid/Grid.tsx:382-465` (virtualizer, `rangeExtractor`, spacer rows) and `apps/erp/app/components/Grid/components/Row.tsx:23-25,57-58` (`rowRef`, `data-index`).

**Steps:**
1. Add the prop `infinite?: InfiniteOptions` to `TableProps`. When it is set, the table rows come from `useInfiniteRows`; `internalData` syncs from those rows instead of `data`.
2. Default `getRowId` to `(row) => String(row.id)` when rows have an `id` and the caller passed no `getRowId`.
3. Replace `row.index in rowSelection` checks (`Table.tsx:1499-1501`, `:1529-1530`) with `row.getIsSelected()`.
4. Key `expandedRows` by `row.id` instead of `row.index` (`:352-359`, `:1487`, `:1749`).
5. Virtualize the Tbody with `useVirtualizer` on `tableContainerRef`, using one virtual item per data row (its group header row and expanded row render inside the same item, measured with `measureElement`). Keep the Grid pattern: spacer rows above and below, `getItemKey` = `row.id`, `overscan: 10`, a `rangeExtractor` that keeps `selectedCell.row` mounted, and `scrollMargin` = the header height. After a keyboard move in edit mode, call `scrollToIndex(selectedCell.row)`.
6. Prefetch: on the container's `scroll` event (the passive listener at `:1052` exists), call `loadMore()` when `scrollHeight - scrollTop - clientHeight < 600`. Also check once after each page renders (a short list must keep loading until it fills the screen).
7. Below the last row, render one row: a spinner while `isLoadingMore`, or "Couldn't load more rows" with a Retry button when `loadError` is set.
8. Remove the `<Pagination>` render (`:1648`) and the selected-cell reset on page change (`:874-877`, keep the `editMode` reset). Remove `usePagination` from Table.
9. Header count in `TableHeader`: "{count} rows" when `count < 1000`, "about {count} rows" otherwise. Use Lingui `plural` inside a function-declaration hook (see `JobsTable.tsx:157-164` and `.claude/rules/i18n-lingui-system.md` → Plurals).
10. Footer label: when the footer row renders (any column with `meta.renderTotal`), add the text "Total of {n} loaded rows" in the first footer cell that has no total.
11. Restore scroll: if `useInfiniteRows` returns `restoredScrollTop`, set `tableContainerRef.current.scrollTop` after the first render.
12. Tables without `infinite` (the 17 `withPagination={false}` tables and any not yet converted) keep working: they show their `data` rows, virtualized, with no fetching.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -E "components/Table" | head
# Expected: no errors in components/Table (loader errors from Task 1 are still expected)
```

**Out of scope:** CompactList (Task 5), export (Task 9), select all (Task 8).

**As built:** one virtual item is one `<tbody>` (`measureElement` + `data-index`) that holds the group header row, the data row and the expanded row. So `Row.tsx` and `rowMemo.ts` did not change (spec → Autonomous Decisions).

---

## Task 5: Phone `CompactList`: auto-load and virtualization

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/components/Table/components/Compact/CompactList.tsx`
- Modify: `apps/erp/app/components/Table/Table.tsx` — the phone branch (`:1138-1183`) passes the infinite state instead of `pagination`.
- Copy from (precedent): Task 4 virtualizer code; the scroll element is `<main>` (`apps/erp/app/routes/x+/_layout.tsx:547`), reached with `document.querySelector("main")` as `components/Layout/Mobile/MobileAppBar.tsx:15-17` does.

**Steps:**
1. Remove the `PAGE`, `visible`, `nextLimit`, "Load more" and Previous/Next logic (`:129-165`, `:332-372`).
2. Virtualize the rows with `useVirtualizer({ getScrollElement: () => document.querySelector("main"), scrollMargin: <list top offset>, estimateSize: () => 72, measureElement })`.
3. Prefetch at 600px from the bottom of `<main>` with the same rule as Task 4.
4. Keep the footer text "Showing {n} of {count}" as "{n} of {count} rows" (exact) or "{n} of about {count} rows".
5. Keep selection mode, group headers, totals and expansion as they are.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -E "Compact" | head
# Expected: no errors in Compact files
```

**Out of scope:** the toolbar sheets.

---

## Task 6: Pilot lists: Sales Orders, Parts, Jobs

**Depends on:** Tasks 1, 4, 5
**Files:**
- Modify: `apps/erp/app/routes/x+/sales+/orders.tsx`, `apps/erp/app/modules/sales/sales.service.ts` (`getSalesOrders`), `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrdersTable.tsx`
- Modify: `apps/erp/app/routes/x+/items+/parts.tsx`, `apps/erp/app/modules/items/items.service.ts` (`getParts`), `apps/erp/app/modules/items/ui/Parts/PartsTable.tsx`
- Modify: `apps/erp/app/routes/x+/production+/jobs.tsx`, `apps/erp/app/modules/production/production.service.ts` (`getJobs`), `apps/erp/app/modules/production/ui/Jobs/JobsTable.tsx`

**Steps (the conversion recipe — Task 12 repeats it for every list):**
1. Loader: read `const { limit, cursor, sorts, filters } = getGenericQueryFilters(searchParams)`. Pass `cursor` instead of `offset` to the service.
2. Service: keep its signature (it takes `GenericQueryFilters`). Ask for the count only on the first page: `{ count: args.cursor ? undefined : LIST_COUNT }`.
3. Loader: build the page with `toPage(result.data ?? [], { limit, sorts: getEffectiveSorts({ sorts }, <the service's default sorts>) })`. Export the default sorts from the service as a constant (for example `SALES_ORDERS_DEFAULT_SORTS`) so the loader and service share one value.
4. Loader return: `{ <rowsKey>: page.rows, count: result.count ?? 0, nextCursor: page.nextCursor, ...other keys }`. When `cursor` is set, skip loading the page's reference data that only the first page needs (for example `tags`, `locations`) only if the component tolerates its absence; otherwise keep it.
5. Table component: pass `infinite={{ dataKey: "<rowsKey>", nextCursor }}` to `<Table>`. Read `nextCursor` from `useLoaderData` in the route and pass it down as a prop.
6. Jobs: the loader computes `batchesByJobId` for the page's rows. `JobsTable` keeps a merged map in state and passes `onPage: (d) => merge(d.batchesByJobId)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -E "sales\+/orders|items\+/parts|production\+/jobs|SalesOrdersTable|PartsTable|JobsTable|sales.service|items.service|production.service" | head
# Expected: no errors in these files
pnpm --filter erp exec vitest run test/list-select-columns.test.ts
# Expected: pass
```
Then run the app for the pilots (use the project's `run` skill or `pnpm dev`; sign in with the `/auth` skill if needed) and check: scroll Sales Orders to the end, sort by two columns, open an order and press Back, switch to a phone viewport. If the app cannot run, record why in the spec and continue.

**Out of scope:** other lists.

**As built:** the pilots use the Task 7 registry directly. The final recipe for every list is in Task 12.

---

## Task 7: List registry (server)

**Depends on:** Task 6
**Files:**
- Create: `apps/erp/app/utils/list-registry/index.server.ts` — the types, `LIST_REGISTRY` (a merge of the module maps), `getListDefinition`, and `fetchListPage`.
- Create: one file per module, `apps/erp/app/utils/list-registry/{module}.server.ts`. Each exports `{module}Lists: Record<string, ListDefinition>`. The pilots fill `sales.server.ts`, `items.server.ts` and `production.server.ts`. The other module files exist empty, so the Task 12 batches can add entries in parallel without a file conflict.
- Create: `apps/erp/app/utils/list-registry/registry.test.ts` — each list key is used once, and `index.server.ts` merges every module file.
- Modify: the 3 pilot routes — call the shared list query function.

**Steps:**
1. Define:
   ```ts
   export type ListDefinition = {
     key: string;                                   // e.g. "sales-orders"
     permission: Parameters<typeof requirePermissions>[1]; // same object the loader uses, minus bypassRls
     idColumn?: string;
     defaultSorts: { column: string; ascending: boolean }[];
     query: (client: SupabaseClient<Database>, companyId: string, params: URLSearchParams, paging: { limit: number; cursor: Cursor | null }) => PostgrestBuilder; // returns the same query the loader runs
   };
   export const LIST_REGISTRY: Record<string, ListDefinition>;
   export function getListDefinition(key: string): ListDefinition | undefined;
   // Runs `query` for one page and cuts it with `toPage`. Default paging: 100 rows after `?after=`.
   export function fetchListPage<TRow>(definition: ListDefinition<TRow>, client, companyId, params: URLSearchParams, paging?: ListPaging): Promise<{ rows: TRow[]; count: number; nextCursor: string | null; error: unknown }>;
   ```
2. Move each pilot loader's service call (reading `search`, `status`, `customerId`, `supplierId` from `params`) into its `query` function, and make the loader call `fetchListPage(<definition>, …)`. The loader and the jobs then share one query. The loader imports the definition from its module file (for example `salesOrdersList` from `list-registry/sales.server.ts`), so the row type stays exact.
3. Pass `infinite={{ dataKey, nextCursor, listKey: "<key>" }}` from the table (add `listKey?: string` to `InfiniteOptions`). A table without `listKey` gets no background export or background bulk path (it falls back to the 1,000-row browser path with the "filter to under 1,000" message).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -E "list-registry|sales\+/orders|items\+/parts|production\+/jobs" | head
# Expected: no errors
pnpm --filter erp exec vitest run app/utils/list-registry/registry.test.ts
# Expected: pass
```

**Out of scope:** registering other lists (Task 12 does it per module).

---

## Task 8: "Select all matching" bar and the browser bulk path

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/components/Table/Table.tsx`, `components/TableHeader.tsx`, `components/Compact/CompactList.tsx`

**Steps:**
1. When every loaded row is selected and `hasMore` is true, show a bar above the rows: "{n} selected · Select all {count} matching" (use "about" above 1,000).
2. Click: if `count <= 1000`, call `loadAll(1000)`, then select every loaded row. The existing `renderActions(selectedRows)` runs unchanged.
3. If `count > 1000`: set a table state `selectAllMatching = { listKey, search: location.search, count }` and show "All {count} matching selected". Pass it to `renderActions` as a second argument: `renderActions(selectedRows, { allMatching })`. Tables whose actions support the background path (Task 11) handle it; others show the action disabled with the tooltip "Filter the list to 1,000 rows or fewer".
4. Clear `selectAllMatching` when the search changes or the user clears the selection.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -E "components/Table" | head
# Expected: no errors
```

**Out of scope:** the server side (Task 11).

---

## Task 9: CSV export: browser path up to 1,000 rows

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/components/Table/components/Download.tsx`, `Table.tsx` (`csvExport` uses the loaded rows), `components/Compact/CompactToolbar.tsx`

**Steps:**
1. `csvExport.data` reads the table's current rows (`internalData`), not the `data` prop (`Table.tsx:1129`, `:1236`).
2. On click: if `count <= 1000` (or the list has no `listKey`), call `loadAll(1000)`, then build the CSV exactly as today (`meta.exportValue`, `idNameMaps`, `selectExportColumns`).
3. If `count > 1000` and the list has a `listKey`, post to the export route (Task 10) with `listKey`, `search`, and the visible columns as `[{ key, label }]` in display order. Show the toast "Your export is being prepared. We'll notify you when it's ready." or the route's "already running" error.
4. A list without `listKey` and more than 1,000 rows exports the first 1,000 rows and shows "Exported the first 1,000 rows."

**Verify:**
```bash
pnpm --filter erp exec vitest run app/components/Table/utils.test.ts
# Expected: pass
```

**Out of scope:** the job (Task 10).

---

## Task 10: Background export job

**Depends on:** Task 7
**Files:**
- Create: `packages/jobs/src/inngest/functions/tasks/table-export.ts`
- Modify: `packages/lib/src/events.ts` (add `"carbon/table-export"` to `Events`), `packages/lib/src/trigger.ts` (`"table-export": "carbon/table-export"`), `packages/jobs/src/inngest/functions/tasks/index.ts`, `packages/jobs/src/inngest/index.ts` (import + `functions` array + export `setTableJobHandlers`)
- Create: `packages/jobs/src/table-jobs/handlers.ts` — `setTableJobHandlers` / `getTableJobHandlers`, same shape as `packages/jobs/src/workflows/actions/dispatcher.ts`.
- Create: `apps/erp/app/routes/api+/table.export.ts` — the route action that starts the job.
- Create: `apps/erp/app/utils/table-jobs.server.ts` — the ERP handlers (page through a list with the registry) and the Redis lock helper.
- Modify: `apps/erp/app/routes/api+/inngest.ts` — wire `setTableJobHandlers` lazily next to `wireWorkflowDispatch` (`:35-48`).
- Modify: `packages/notifications/src/index.ts` (new `NotificationEvent.TableExport`, topic mapping), `packages/jobs/src/inngest/functions/notifications/content.ts` (content case), `packages/jobs/src/inngest/functions/notifications/notify.ts` (default destinations), `apps/erp/app/routes/api+/link.ts` (resolve case), `apps/erp/app/components/Layout/Topbar/Notifications.tsx` (topbar case).
- Copy from (precedent): `packages/jobs/src/inngest/functions/tasks/company-export.ts:363-370` (function header), `packages/jobs/src/inngest/functions/integrations/mount-publish.ts:179-186` (notify), `packages/jobs/src/inngest/functions/integrations/accounting-auth-failure.ts:103-110` (Redis `SET NX`), `apps/erp/app/routes/api+/integrations.journal-backfill.ts:34-75` (route that triggers a job), `packages/files/src/csv/csv.ts:39-77` (`encodeCsv` with `header: false` for later chunks).

**Steps:**
1. Route `api+/table.export.ts` (POST, JSON `{ listKey, search, columns: {key,label}[] }`):
   1. Look up the list definition. Unknown key → 400.
   2. `requirePermissions(request, { ...definition.permission, role: "employee" })`.
   3. Take the lock: `redis.set("table-job:export:" + companyId, userId, "EX", 3600, "NX")`. If the result is not `"OK"` and `redis.get(key)` returns a value → return 409 with "An export is already running for your company". If both return `null` → continue (Redis down, fail-open; Inngest still serializes).
   4. `trigger("table-export", { companyId, userId, listKey, search, columns, exportId: nanoid() })`. Return `{ success: true }`.
2. Job `table-export.ts`:
   ```ts
   // TODO(scale): this job runs inside the ERP containers (api+/inngest.ts) and shares
   // CPU with web requests. Move table export/bulk jobs to a dedicated worker service
   // before large tenants run many 100k-row exports at the same time.
   export const tableExportFunction = inngest.createFunction(
     { id: "table-export", retries: 1, concurrency: { key: "event.data.companyId", limit: 1 } },
     { event: "carbon/table-export" }, async ({ event, step }) => { … });
   ```
   1. Check the user still has the list's view permission (use the ERP handler; the precedent for the permission read is `packages/jobs/src/workflows/engine/owner.ts:58-87`).
   2. Page through the list with the ERP handler `fetchPage(listKey, companyId, search, cursor, limit = 1000)`. Write the header row once (translated labels), then each page with `encodeCsv(rows, { fields, header: false })`. Write the chunks to a temp file (`os.tmpdir()`) so memory stays at one page.
   3. Stop at 100,000 rows.
   4. Upload the file to bucket `temp-staging` at `{companyId}/exports/{exportId}.csv` with the service-role client. Prefer a stream upload; if `storage-js` does not accept a Node stream, read the file into a Buffer (the 100,000-row ceiling bounds it) and record that in the spec.
   5. Notify the user: `trigger("notify", { event: NotificationEvent.TableExport, companyId, documentId: exportId, title, body, recipient: { type: "user", userId } })`. Never set `from` to the requesting user (`notify.ts:326-327` drops it).
   6. Delete the temp file and the Redis lock in a `finally`.
3. Plain values: `row[key]`; `customFields->>id` reads `row.customFields[id]`; arrays join with `; `; objects become JSON.
4. Notification link: the topbar case and `/api/link` resolve to `path.to.file.preview("temp-staging", "{companyId}/exports/{exportId}.csv")` (`apps/erp/app/utils/path.ts:1175-1176`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no errors
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -E "table\.export|table-jobs|inngest|link\.ts|Notifications" | head
# Expected: no errors
```

**Out of scope:** a separate worker service (the `TODO(scale)` comment covers it).

---

## Task 11: Background bulk-action job

**Depends on:** Tasks 7, 8, 10
**Files:**
- Create: `packages/jobs/src/inngest/functions/tasks/table-bulk-action.ts`, events + trigger entries (`"carbon/table-bulk-action"`), registration as in Task 10.
- Modify: the action routes listed below — move each action's logic into a server function in its module's `{module}.server.ts` (create it if missing), called by the route and by the job handler.
- Modify: `apps/erp/app/utils/table-jobs.server.ts` — `runBulkAction(actionKey, ids, context)` handler.
- New notification event `NotificationEvent.TableBulkAction` (same 6 edits as Task 10).

**Supported actions (spec → Autonomous Decisions):**

| Action key | Route (`apps/erp/app/routes/`) | Server checks to keep or add |
|---|---|---|
| `items.update` | `x+/items+/update.tsx` | `update: "parts"` (or the item type's permission); chunk `.in()` by 100 |
| `jobs.release` | `x+/job+/release.tsx` | already server-side (Draft/Planned, readiness) |
| `jobs.delete` | `x+/job+/update.tsx` | ADD: `delete: "production"`; status in Draft/Planned/Due Today/Overdue; `.eq("companyId")` on the status read; chunk by 100 |
| `purchase-orders.delete` | `x+/purchase-order+/update.tsx` | ADD: `.eq("companyId")`; status Draft/Planned; chunk by 100 |
| `batches.release` / `batches.dissolve` | `x+/production+/batches.release.tsx`, `batches.dissolve.tsx` | release: Planned only (exists); dissolve ADD: Planned/Active only; chunk by 100 |
| `users.deactivate` / `users.invite` / `users.permissions` | `x+/users+/deactivate.tsx`, `resend-invite.tsx`, `bulk-edit-permissions.tsx` | keep existing checks (caller not in list, employee of company) |

**Steps:**
1. Each route accepts either `ids` (today) or `{ allMatching: { listKey, search } }`. With `allMatching`, it takes the Redis lock `table-job:bulk:{companyId}` (same fail-open rule as Task 10), triggers `table-bulk-action`, and returns `{ success: true, background: true }`.
2. The job pages through the list's ids (`fetchPage` with `limit = 1000`), calls `runBulkAction(actionKey, idsChunk, ctx)` per chunk of 100, sums `{ done, skipped, failed }`, and notifies the user with the counts. Add the same `TODO(scale)` comment as Task 10.
3. The browser checks in the table components stay (they filter the selection for the small path). The server checks in the table above are the source of truth.
4. In each supporting table component, `renderActions(selectedRows, { allMatching })` posts `allMatching` instead of ids when it is set, and shows the toast "Running in the background. We'll notify you when it's done."
5. Planning tables and Kanban labels: keep the action disabled when `allMatching` is set (Task 8 tooltip).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -E "items\+/update|job\+/(update|release)|purchase-order\+/update|batches\.|users\+/|table-jobs" | head
# Expected: no errors
```

**Out of scope:** planning "Order Parts" / "Create Jobs" / "Apply Suggested Changes" background paths.

---

## Task 12a–12h: Convert the remaining lists, one batch per module

**Depends on:** Tasks 1, 6, 7
**Recipe:** do these steps for every route in the batch. The pilots are the reference: `routes/x+/sales+/orders.tsx`, `list-registry/sales.server.ts`, `getSalesOrders` and `SalesOrdersTable.tsx`.

1. Service: export the default sorts as a constant (`SALES_ORDERS_DEFAULT_SORTS: DefaultSort[]`) and pass it to `setGenericQueryFilters`.
2. Service: ask for the count on the first page only: `{ count: args.cursor ? undefined : LIST_COUNT }`.
3. Registry: add an entry to the batch's module file in `apps/erp/app/utils/list-registry/` (12a `sales.server.ts`, 12b `purchasing.server.ts`, 12c `production.server.ts`, 12d `items.server.ts`, 12e `inventory.server.ts`, 12f `invoicing.server.ts` and `accounting.server.ts`, 12g `quality.server.ts`, 12h `people`, `users`, `resources`, `settings`, `documents` and `workflows.server.ts`). Copy `salesOrdersList`: `key`, `permission` (the loader's object without `bypassRls`), `defaultSorts`, `idColumn` when the source has no `id`, and `query`, which reads the URL params and calls the service with `limit` and `cursor`. End it with `satisfies ListDefinition` and add it to the file's `{module}Lists` map. Never edit `index.server.ts`.
4. Loader: call `requirePermissions(request, { ...xList.permission, bypassRls: true })`, then `fetchListPage(xList, client, companyId, searchParams)`.
5. Loader: return `{ <rowsKey>: page.rows, count: page.count, nextCursor: page.nextCursor, …other keys }`.
6. Loader: if `searchParams.get("after")` is set, skip reference data that only the first page uses (tags, locations). A later page is read for its rows only.
7. Route component: read `nextCursor` from `useLoaderData` and pass it to the table component.
8. Table component: pass `infinite={{ dataKey: "<rowsKey>", nextCursor, listKey: "<key>" }}` to `<Table>`. If the loader computes extras per page, merge them with `onPage` (see `JobsTable.tsx`).

Use the route table in `.ai/research/2026-10-13-infinite-scroll-tables.md` and the per-module lists below. For each list: check that every sortable column of its table is in the select (the `toPage` dev check catches misses). When the source has a default sort on a foreign table, follow the spec's Autonomous Decisions ("single load" lists).

| Batch | Routes |
|---|---|
| 12a Sales | `x+/sales+/` quotes, rfqs, rmas, customers, contracts, rental-agreements, price-list, pricing-rules, customer-portals, customer-statuses, customer-types, no-quote-reasons, return-reasons |
| 12b Purchasing | `x+/purchasing+/` orders (rows key is spelled `purchasOrders` in the code; keep it), planning, quotes, rfqs, supplier-returns, supplier-types, suppliers, leases |
| 12c Production | `x+/production+/` planning, assemblies, batches, demand-forecasts, procedures, scrap-reasons; `x+/job+/` $jobId.events, $jobId.operations, $jobId.quantities, $jobId.steps |
| 12d Items | `x+/items+/` materials, tools, consumables, services, change-notices/_index, change-notice-actions, change-notice-types, dimensions, finishes, forms, grades, groups, substances, types, uom, methods+/materials, methods+/operations |
| 12e Inventory | `x+/inventory+/` quantities, inventory-count, kanbans, picking-lists, receipts, shipments, shipping-methods, stock-movements, stock-transfers, storage-types, storage-units, tracked-entities, warehouse-transfers; `x+/inventory-count+/$id` |
| 12f Invoicing + Accounting | `x+/invoicing+/` sales, purchasing, payments, credit-memos, supplier-credits, charges, reimbursements; `x+/accounting+/` journals, fixed-assets, asset-classes, depreciation-runs, fleet, dimensions, intercompany, payment-terms, projects, lease-runs, revenue-recognition-runs (via `period-runs.server.ts`) |
| 12g Quality | `x+/quality+/` issues, actions, calibrations, documents, gauges, gauge-types, inspection-plans, inspections, issue-types, issue-workflows, required-actions, risks |
| 12h People, Users, Resources, Settings, Documents, Workflows | `x+/people+/` employee, attributes, holidays, shifts, timecard; `x+/users+/` employees, customers, suppliers, employee-types, groups, operators; `x+/resources+/` all 11; `x+/settings+/` api-keys, custom-fields, sequences, serial-numbers, webhooks; `x+/documents+/search`; `x+/workflows+/` _index, runs |

**Verify (per batch):**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -E "<batch route or module path>" | head
# Expected: no errors in the batch's files
pnpm --filter erp exec vitest run app/utils/list-registry/registry.test.ts test/list-select-columns.test.ts
# Expected: pass
```

**Out of scope:** the special lists in Task 13.

---

## Task 13: Hand-paged and special lists

**Depends on:** Tasks 3, 4
**Files:**
- `apps/erp/app/modules/settings/ui/Integrations/SyncActivity.tsx` (page state + `useFetcher`, `:351-353`, `:640-653`)
- `apps/erp/app/modules/accounting/ui/Reports/AccountLedgerDrawer.tsx` (`?offset=` / `?limit=`, `:73-99`, `:226-230`)
- `x+/settings+/printing.jobs.tsx` (`getPrintJobs`, own `.range`), `x+/settings+/audit-logs.details.tsx` (`getGlobalAuditLog`, RPC `p_offset`)
- `share+/customer.$id.tsx`, `x+/users+/customers.tsx`, `x+/users+/suppliers.tsx`, `x+/resources+/contractors.tsx`, `x+/settings+/custom-fields.tsx`

**Steps:**
1. SyncActivity and AccountLedgerDrawer: switch their sources to cursor paging (`setGenericQueryFilters` + `toPage`, or a hand-written keyset on their own order) and load more on scroll inside their existing scroll element.
2. Printing jobs and audit log: keep their offset sources; feed them through `useInfiniteRows` with an `after` token that holds the next offset (encode `{ values: [], id: String(offset) }`). Record this in the spec.
3. The "single load" lists: load up to 1,000 rows, `nextCursor: null`.
4. `contractors` uses `idColumn: "supplierContactId"`; `custom-fields` uses `idColumn: "table"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -E "SyncActivity|AccountLedgerDrawer|printing|audit-logs|customer\.\$id|users\+/|contractors|custom-fields" | head
# Expected: no errors
```

---

## Task 14: Remove the pager code

**Depends on:** Tasks 12, 13
**Steps:**
1. Confirm with grep that nothing imports them, then delete: `components/Table/components/Pagination/` (and its re-exports in `components/Table/components/index.ts`), `getPageSize`, `getPageOffset`, `pageBounds`, `PAGE_SIZES`, `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE` from `utils/pagination.ts`, and `utils/pagination.test.ts` cases for them.
2. Delete `PAGINATION_SHORTCUTS` (`apps/erp/app/shortcuts.ts:61-65`) and its entries in `components/ShortcutHelp.tsx:16`, `:80-89`.
3. Remove `?limit=` / `?offset=` writes left anywhere (`SearchFilter.tsx:30` resets them; change it to reset `after` only if it still matters, else drop it).

**Verify:**
```bash
grep -rn "usePagination\|PAGINATION_SHORTCUTS\|getPageOffset\|pageBounds\|PAGE_SIZES" apps/erp/app | head
# Expected: no output
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

---

## Task 15: Docs, rules and lessons

**Depends on:** Task 14
**Steps:**
1. Update `.claude/rules/table-csv-export.md` for the two export paths.
2. Update `.claude/rules/realtime-system.md` if the list refresh rule changed what it says about list loaders.
3. Add a short section on cursor paging (loader recipe, `toPage`, registry) to `apps/erp/app/components/Table/` docs or the closest AGENTS.md (`packages/react/AGENTS.md` is for the package; use `apps/erp/AGENTS.md` if it exists, else `.claude/rules/conventions-ui.md`).
4. Add a lesson to `.ai/lessons.md` in the `Context → Problem → Rule → Applies to` format for one real pitfall hit during the work.
5. Write all prose in STE-80 (`.claude/rules/writing-ste.md`).

---

## Task 16: Final verification

**Depends on:** all
**Steps:**
1. `pnpm exec turbo run typecheck --filter=erp` and `--filter=@carbon/jobs` — no errors.
2. `pnpm --filter erp test` — all pass.
3. `pnpm exec biome check --write --no-errors-on-unmatched <every changed path>` — clean.
4. `pnpm --filter @carbon/checks license-headers` — new files have SPDX headers.
5. Run the app and walk the spec's Acceptance Criteria that need a browser (pilots, a phone viewport, export of a small list). Record results and anything not verifiable in the spec.
6. Check every Progress box in this file.
