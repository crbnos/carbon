---
description: Cursor paging and infinite scroll for ERP list tables — the loader recipe, toPage, fetchListPage, the list registry, sort rules and the 1,000-row thresholds.
paths:
  - "apps/erp/app/components/Table/**"
  - "apps/erp/app/utils/query.ts"
  - "apps/erp/app/utils/cursor.ts"
  - "apps/erp/app/utils/list-registry/**"
  - "apps/erp/app/routes/x+/**"
  - "apps/erp/app/routes/api+/table.*"
  - "apps/erp/app/modules/**/ui/**/*Table.tsx"
---

# Cursor paging and infinite scroll

Every paged ERP list loads 100 rows (`PAGE_SIZE`, `utils/pagination.ts`). It
loads the next 100 when a sentinel after the rows comes within 600px of the
end of the scroll element (`useInfiniteScroll`, an IntersectionObserver with
`PREFETCH_DISTANCE`, `components/Table/infiniteRowsStore.ts`). There is no
pager, no `?offset=` and no `?limit=` in a list URL. Design and decisions:
`.ai/specs/2026-10-13-infinite-scroll-tables.md`.

## How a page loads

1. The route loader returns page 1: `{ <rows>, count, nextCursor }`.
2. `useInfiniteRows` (`components/Table/useInfiniteRows.ts`) calls
   `fetcher.load` on `pageUrl` plus `after=<nextCursor>`. The default
   `pageUrl` is `useFormAction()`, not `location.pathname`, so a drawer route
   does not catch the request.
3. It appends the page's rows, one request at a time, until `nextCursor` is
   null. It drops a row whose id (`idColumn`, default `id`) is already loaded.
4. A new reset key drops the loaded pages, the scroll offset and an
   uncontrolled selection. The reset key is the URL search without `after` and without
   `ignoreParams` (`getSearchKey`, `getResetKey`). So a filter, sort, search or
   saved view resets the list, and a drawer param in `ignoreParams` does not.
5. A revalidation re-reads the loaded pages, up to 20 (see `realtime-system.md`).
   A `loadMore` during that refresh waits and runs after it.
6. Back (`POP`) restores the loaded rows and the scroll offset from memory.
   The memory key is the company id, `dataKey` and the page URL key.

The cursor (`utils/cursor.ts`) is base64url JSON of the last row's sort values,
its id and `keys`, the order it was cut for (`["createdAt:desc"]`).
`setGenericQueryFilters` (`utils/query.ts`) adds a keyset filter with `.or(…)`,
the id tie-break order and `.limit(limit + 1)`. The extra row tells `toPage`
that a next page exists. NULLs sort last ascending and first descending, and
the keyset filter follows that rule. A cursor whose `keys` differ from the
request's order gives an empty page, so the list ends rather than restarting.
A list that pages by offset (printing jobs, the audit log) uses
`encodeOffsetToken` / `decodeOffsetToken`, not a cursor.

## The row count

The header shows the number of matching rows ("2,345 rows"), exact at any size.

1. Page 1 asks for `LIST_COUNT` (`estimated`). PostgREST counts exactly below
   1,000 rows. From 1,000 rows up it gives the planner's estimate, because an
   exact count (`COUNT(*) OVER ()`) reads every matching row.
2. From 1,000 up, `useExactCount` (`components/Table/useExactCount.ts`) loads
   the list route with `count=exact` in place of `after` (`getCountUrl`)
   after page 1 shows. A revalidation counts again because the router reloads
   a mounted fetcher's last URL; the hook sends no second request for it.
   The rows never wait for the count.
3. `getGenericQueryFilters` reads `count=exact` as `exactCount: true` (and no
   cursor). `listCount(args)` then asks for `exact`, and
   `setGenericQueryFilters` reads one row (`.limit(1)`).
4. `loadListPage` answers that request with the count only: no `firstPage`,
   no `rows` lookup, `{ [dataKey]: [], count, exactCount: true }`. A loader that
   calls `fetchListPage` itself returns `exactCount: page.exactCount`.
5. Until the answer comes, the copy says "about" (header, phone footer,
   select-all bar). A failed request keeps the estimate.

Only a list with `listKey` asks, and only an answer with `exactCount: true`
counts. A loader that builds its own args from `getGenericQueryFilters`
(`{ limit, cursor, sorts, filters }`) drops `exactCount`, so its count stays
the estimate rather than showing an estimate as exact.

## Loader recipe (a registered list)

```ts
// routes/x+/sales+/customers.tsx
export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, customersList, {
    dataKey: "customers",
    bypassRls: true, // only if the loader passed it before
    firstPage: async ({ client, companyId }) => ({
      tags: (await getTagsList(client, companyId, "customer")).data ?? []
    }),
    onError: { redirectTo: path.to.sales, message: "Failed to fetch customers" }
  });
}
```

`loadListPage` (`utils/list-registry/load.server.ts`) runs `requirePermissions`
with the list's permission, `guard` (every page), `fetchListPage` with the
user's company group, `firstPage` (page 1 only, in parallel), then the
list's own `rows` lookup and `mapRows` (every page, after it). It returns
`{ [dataKey]: rows, count, nextCursor, infinite, ...extras }`. `params`
replaces the URL search the query reads. On an error:

- A later page logs it and returns `{ [dataKey]: [], nextCursor: null, listError }`
  (`InfiniteListError`). The Table shows "Couldn't load more rows" with Retry.
  A later page that throws (not a `Response`) is caught and answered the same
  way: a fetcher whose loader throws replaces the list with the route's error
  screen.
- Page 1 throws `redirect(onError.redirectTo)` with an error flash, or shows no
  rows without `onError`.

A loader that does more (an early return, a flash without a redirect) calls
`fetchListPage` itself, returns `infinite: listInfinite(list, dataKey,
nextCursor)` with page 1, and returns `listErrorPage(dataKey)` for a failed
later page (`utils/list-registry/list-error.ts`: no imports, so a service
module can use it without loading the registry).

The table takes `infinite` (`InfiniteOptions`, `components/Table/types.ts`)
as a prop from the loader data and passes it to `<Table>` as is. A table
never types its list's `dataKey`, `listKey` or `idColumn`: `listInfinite`
builds them from the registry entry, so they cannot drift from the server.

```tsx
// route
const { customers, count, infinite } = useLoaderData<typeof loader>();
<CustomersTable data={customers} count={count} infinite={infinite} />
// table
<Table data={data} count={count} infinite={infinite} columns={columns} />
```

A table whose rows do not come from a registered list (an `api+` loader, a
job page's tab) builds the object itself, without `listKey`.

| Option | Meaning |
|---|---|
| `dataKey` | The key of the rows array in the loader data. |
| `nextCursor` | The loader's cursor. Null when page 1 is the whole list. |
| `listKey` | The registry key. Without it, export and "select all" stop at 1,000 rows. |
| `ignoreParams` | URL params that do not define the list. A change of one keeps the loaded pages. The planning grids pass `[PLANNING_DRAWER_PARAM]`, Sync Activity `["tab"]`. |
| `idColumn` | The unique id column when it is not `id`. It de-duplicates and keys the rows. |
| `pageUrl` | The URL that serves the later pages, when it is an `api+` loader (Sync Activity: `path.to.api.integrationSyncActivity`). Same response shape. |

- Values from another table (a lookup the list's view lacks) are the
  registry entry's `rows` (`withJobListExtras`, `withBatchListExtras`,
  `withSupplierReportContacts`, `withWorkflowListExtras`,
  `withWorkflowRunRecordNames`). `loadListPage` runs it on every page and the
  background export on every part, so each page carries its own values, the
  table keeps no merge state, and the export never has a blank column.
  - A column whose `meta.exportValue` computes from the row gets the same
    function in the entry's `exportValues` (`JOB_LIST_EXPORT_VALUES`, shared
    with the column). The background export runs no column code.
  - `mapRows` is for what only the screen needs (a download token per row,
    Documents).
- 🛑 Pass the loader's `data` array to `<Table infinite>`, or a memoized one.
  `useInfiniteRows` reads a new array as a revalidation and re-reads every
  loaded page. A copy built in the render body (`data.map(…)`) re-reads them
  on every render. Nothing checks this automatically.
- Column widths: only the rows in view are rendered (`useVirtualRows`, 10
  rows of overscan), so table layout alone would narrow and widen a column as
  rows scroll by. `useGrowOnlyColumnWidths` holds each column at its widest so
  far as the header's `min-width` (capped at `30dvw`, a body cell's maximum).
  The widths start over on a new list (`resetKey`), a new column set, or a new
  container width. A column still widens once when a wider cell first shows.
  Never lock widths with `table-layout: fixed`: a width measured at one bad
  moment stays wrong, and late content (names from a store) gets cut off.
- A parent that needs every loaded row (the planning grids, Documents) calls
  `useInfiniteRows` itself and passes the result as `<Table infiniteRows={…}>`.
  The Table then runs its own hook with infinite scroll off. A list that is not
  a `<Table>` (Sync Activity) calls `useInfiniteRows` and `useInfiniteScroll`
  itself.

## The service function

```ts
export const SALES_ORDERS_PAGING: Paging = {
  defaultSorts: [{ column: "createdAt", ascending: false }]
  // idColumn: "…"   // when `id` is not unique
};

/** @mcp read */
export async function getSalesOrders(client, companyId, args: GenericQueryFilters & { … }) {
  let query = client
    .from("salesOrders")
    .select(SALES_ORDERS_LIST_COLUMNS, { count: listCount(args) })
    .eq("companyId", companyId);
  // filters, search …
  query = setGenericQueryFilters(query, args, SALES_ORDERS_PAGING);
  return query;
}
```

One `X_PAGING` per list. The service passes it to `setGenericQueryFilters`, a
loader without a registry entry to `toPage(rows, { limit, sorts }, X_PAGING)`,
and the registry entry spreads it.

🛑 Put the `*_PAGING` constant ABOVE the doc block. A constant between
`/** @mcp read */` and its function takes the doc block, and the function stops
being an MCP tool with no error (see `.ai/lessons.md`).

🛑 Never put `cursor` in an `@mcp` function's own args type. Type the args as
`GenericQueryFilters & { … }` (the generator publishes `limit` + `offset`), or
give the loader a function with no `@mcp` tag (`getAccountLedgerLines`).

Rules for the query:

| Rule | Why |
|---|---|
| Count with `listCount(args)` | `LIST_COUNT` on page 1, no count on a later page (`fetchListPage` returns 0), `exact` for the count request (see "The row count"). |
| Every sortable column, the default sorts and the id column are in the select | `toPage` reads the cursor values from the row. A missing one ends the list after the page and logs a warning. |
| Never put an `.order()` before `setGenericQueryFilters` | The cursor follows only the sorts that `setGenericQueryFilters` applies. A fixed first order breaks it. |
| A default sort on a `foreignTable` orders the embedded rows only | `resolveSorts` keeps it out of the keyset. |
| A list with no unique `id` names `idColumn` in its `X_PAGING` | Examples: contractors (`supplierContactId`), custom field tables (`table`), the price list (`itemId`). |
| `args.cursor !== undefined` means cursor paging | Without it, `limit` + `offset` page exactly (MCP, v1 API). |

## Sortable columns

`isServerSortable` (`components/Table/utils.ts`) gates the header sort menu and
the toolbar Sort picker:

- A sort key with a `.` (another table's column) is off. `resolveSorts` also drops it on the server.
- Set `enableSorting: false` on a column the list's view does not have: a
  value the loader computes per page, an embedded record, a joined name.
  Examples: Jobs `orderQuantity`, Batches `memberCount`, the price list columns.

## The list registry

`utils/list-registry/index.server.ts` holds `LIST_REGISTRY`, `getListDefinition`,
`fetchListPage` and `searchList`. Each module keeps its entries in its own file
(`sales.server.ts`, …), merged by the index. Most entries use `searchList`:

```ts
export const salesOrdersList = searchList({
  key: "sales-orders",
  permission: { view: "sales" },          // the loader's check, without bypassRls
  paging: SALES_ORDERS_PAGING,
  service: getSalesOrders,                // gets { search, ...params, limit, cursor, sorts, filters }
  params: { status: "status", customerId: "customerId" }  // or (params) => …
});
```

A list with another service shape writes its own entry:
`{ key, permission, ...X_PAGING, query }`. `query(client, companyId, context)`
gets `{ params, limit, cursor, sorts, filters, companyGroupId? }`, parsed once
by `fetchListPage`. A group-scoped list reads the group with
`resolveCompanyGroupId(client, companyId, context)`: the loader passes it, a
background job does not.

- The loader and the background jobs (export, bulk action) run the same
  `query`. So the query reads everything from `params` and the company. It
  cannot read route params or the user's default location.
- If the list needs either of those, give it no registry entry. The loader
  calls the service, then `toPage(rows, { limit, sorts }, X_PAGING)`.
  Examples: kanbans, stock transfers, quantities, the job sub-lists, the
  planning lists. Such a list has no `listKey`.
- A background job reads as the requesting user (`getUserScopedClient`) and
  checks the list's permission on the user's claims
  (`utils/table-jobs.server.ts`).

## Single-load lists

A list that cannot page passes `{ limit: SINGLE_LOAD_LIMIT, offset: 0 }`
(`utils/pagination.ts`, 1,000) and no `infinite`. Offset mode reads exactly
`.range(0, 999)`: with `cursor: null` the query asks for 1,001 rows, and
PostgREST's `max_rows` cuts that to 1,000, so a full list looked complete.
Examples: groups (a tree), partners (one row per ability, so `id` is not
unique), the storage unit roots (a tree), storage rules, sales rules, the
customer and supplier account lists, the customer portal share page.

When a list with search or filters gets exactly 1,000 rows, the loader returns
`isTruncated` and the table passes it to `<Table isTruncated>`, which shows
"Showing the first 1,000 rows. Search or filter to see the rest." under the
rows (`RowLimitNote`). A table without `infinite` holds all its rows, so it
shows no "loaded rows" footer label.

## Thresholds

| Value | Where | Meaning |
|---|---|---|
| 100 | `PAGE_SIZE` | Rows per page |
| 600px | `PREFETCH_DISTANCE` | Start the next page this close to the end |
| 20 pages | `MAX_REFRESH_PAGES` | At most 2,000 rows stay loaded after a revalidation, and in the Back memory |
| 1,000 | `BROWSER_ROW_LIMIT` | The browser loads at most this many rows for "select all" and CSV export |
| 1,000 | `EXACT_COUNT_LIMIT` | Below it the page-1 count is exact ("245 rows"). From it, `LIST_COUNT` is an estimate: "about N rows" until `useExactCount` gets the exact count |
| 1,000 | `SINGLE_LOAD_LIMIT` | Rows a single-load list reads |
| 500 | `TABLE_JOB_PAGE_SIZE` (`packages/jobs/src/table-jobs/paging.ts`) | Rows per query in a job. `limit + 1` must stay at or below PostgREST `max_rows` (1,000) |
| 10,000 | `TABLE_JOB_ROWS_PER_STEP` | Rows one job step reads (20 pages). One step is one HTTP request, and the load balancer cuts a request at 600 s |
| 100,000 | `MAX_EXPORT_ROWS`, `MAX_BULK_ROWS` | The most rows one background job reads |
| 200 MB | `MAX_EXPORT_BYTES` | The export stops after the page that passes it |
| 2,000 | `ALL_MATCHING_RELEASE_LIMIT` (`utils/table-jobs.ts`) | The most rows Jobs Release and Batches Release act on in the background |

"Select all" (`Table.tsx`, `SelectAllMatchingBar`): when every loaded row is
selected and more rows exist, the bar offers the rest.

| Matching rows | What "select all" does |
|---|---|
| 1,000 or fewer | The browser loads them (`loadAll(1000)`) and selects them. |
| More than 1,000, with `listKey` | The selection becomes "all matching" (`AllMatchingSelection`: list key, URL search, count). A bulk action gets it in `renderActions(rows, { allMatching })`. |
| More than 1,000, no `listKey` | The bar offers "Select the first 1,000 rows". |

`useSelectAllMatching` (`components/Table/components/SelectAllMatching.tsx`)
derives the "all matching" state. A new selection or a new reset key ends it.

CSV export follows the same split: see `table-csv-export.md`.

## The background bulk action

Each bulk action is one entry of `BULK_ACTIONS` (`defineBulkAction`,
`utils/table-jobs.server.ts`): its label, lists, permission, plan `feature`,
`maxRows`, `idsPerStep`, the zod schema of the params its route sends, and
`run`, which calls the route's own service function. Every bulk route calls
`startBackgroundBulkAction(request, actionKey, { allMatching, ids }, params)`
first: null means the route acts on the selection itself; otherwise it
answers `bulkStartFormResponse(BulkActionStart)`. The steps:

1. It checks the action's own permission (`requirePermissions` with the
   entry's `permission`), that the action serves the list, the params
   (the entry's schema; the job parses them again before `run`), and the
   user's permission on the list (`canRunBulkAction`, also the plan
   `feature` of the action).
2. If the action has `maxRows`, it counts the matching rows and refuses past
   the limit (`rowLimitRefusal`). Jobs Release and Batches Release have a
   limit of 2,000. The menu item shows "Filter the list to 2,000 rows or fewer"
   (`useAllMatchingLimitLabel`).
3. `startTableJob("bulk", …)` takes the company's bulk lock (the export's
   start path too, with kind `export`). A busy lock answers the remaining
   time. With all `MAX_RUNNING_TABLE_JOBS` (4) slots across companies taken
   it refuses (`refusal: { code: "full" }`, see `table-csv-export.md`). A
   failed send gives the lock back.
4. It triggers `table-bulk-action`
   (`packages/jobs/src/inngest/functions/tasks/table-bulk-action.ts`,
   `retries: 0`, one run per company at a time).
5. Steps `collect-ids-{n}`: each reads at most 10,000 rows and stores their
   ids as one file in `temp-staging`
   (`{companyId}/bulk-actions/{bulkActionId}/{n}.json`, `tableBulkIdsKey`).
   The job also stops at `maxRows`. A run for selected rows (`ids` in the
   event) has one step `store-selected-ids` instead, and reads no list pages.
6. Steps per slice: each reads `idsPerStep` ids (default 1,000; Jobs Release
   25, Batches Release 10, Batches Dissolve 100) and runs the action 100 ids
   per call (`BULK_CHUNK_SIZE`). Each call gets the `carry` the call before
   it returned and returns the next one. Jobs Release and Batches Release
   carry the PO each supplier went on, so a later slice adds to the PO an
   earlier slice made (`carriedPurchaseOrders` on `releaseJobs` and
   `releaseBatches`, read by `startingPurchaseOrders`) instead of refusing
   the job or batch. Inside one call, `releaseBatches` passes the same map
   from batch to batch. Every slice calls the action route's own service
   function (`releaseJobs`, `deleteJobs`, `deletePurchaseOrders`,
   `releaseBatches`, `dissolveBatches`), so both paths apply one rule.
7. Step `notify` sends `NotificationEvent.TableBulkAction` with the counts
   in the title: done, skipped, failed. Its event id
   (`table-bulk-action:{id}:done`) stops a second send on a retry.
8. Steps `remove-ids` and `release-lock` delete the id folder
   (`removeTableJobFolder`) and the lock. A failed run does the same in
   `onFailure` (`failTableJob`, `table-jobs/failure.ts`, shared with the
   export).

A step returns counts, cursors and the small `carry` only. The function adds
them up outside the steps. The browser side uses `appendBulkSelection` / `bulkSelectionBody`
(`utils/bulk-selection.ts`), `useBulkFormAction` and `useBulkStartToast`
(`hooks/useBulkAction.ts`).

**Selected rows that do not fit one request.** Jobs Release and Batches
Release act on every selected row in the request itself only up to the
action's `idsPerStep` (25 jobs, 10 batches). A bigger selection goes to the
same background job with its ids (`startBackgroundBulkAction` with `ids`),
because each release runs MRP and the load balancer cuts a request at 600 s.

## Known limits

- `TODO(scale)` (`packages/jobs/src/inngest/functions/tasks/table-export.ts`):
  the table jobs run in the ERP containers (`api+/inngest.ts`) and share CPU
  with web requests. One job per company runs at a time, and at most
  `MAX_RUNNING_TABLE_JOBS` (4) across all companies; a request past that is
  refused with a toast, not queued. While Redis is down the lock fails open
  and neither limit holds there (Inngest still runs one per company). A
  separate worker service removes this limit.
- Footer totals (`meta.renderTotal`) add up the loaded rows only. The footer
  says "Total of N loaded rows".
- 49 services put the raw search text into `.or()`. This is independent of
  paging and is not fixed here.

## Tests

`utils/cursor.test.ts` (encode, decode, keys, offset tokens, keyset filter, `toPage`), `utils/query.test.ts`,
`components/Table/infiniteRowsStore.test.ts`, `utils/table-jobs.test.ts` and
`packages/jobs/src/table-jobs/*.test.ts`. The `list-select-covers-columns`
check (`@carbon/checks`) fails when a table's `accessorKey`, or its paging's
sort or id column, is missing from its `*_LIST_COLUMNS`.
