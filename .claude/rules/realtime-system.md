---
paths:
  - "packages/query/**"
  - "packages/database/src/realtime-tables.ts"
  - "packages/database/src/event-system/attachments.ts"
  - "packages/database/src/event-system/functions/broadcast_*.sql"
  - "packages/database/src/event-system/functions/log_*.sql"
  - "apps/*/app/components/RealtimeDataProvider.tsx"
  - "apps/*/app/stores/**"
---

# Realtime: broadcast topics, route declarations, live lists

How a change in the database reaches an open page, and how the app catches up on
what it missed. Client code is in `@carbon/query` (`packages/query`). Nothing
uses `postgres_changes`: the `supabase_realtime` publication is empty, and the
`no-postgres-changes` check (`@carbon/checks`) fails a new subscription to it.

## The message

A statement-level trigger sends ONE message per company per statement:
`{ table, op, ids, parents }`, with `ids` and `parents` null past 100 rows.
`parents` holds each FOREIGN KEY `<name>Id` column of the changed rows and its
values (`{ jobId: ["job_…"] }`), plus the columns its ancestors add, so a page
that shows one record can ignore changes to another's rows; a column with more
than 20 values is left out. A column that only ends in `Id` (`readableId`, an
order's own number, `taxId`) is the row's data and is never sent — any employee
of the company may join any table's topic, so a filter on such a column cannot
work and matches every change. Only ids
leave the database — the client re-reads what it needs through PostgREST, so
table RLS still decides what each user sees.

A route scopes a table to its own record with
`{ table: "jobOperation", column: "jobId", param: "jobId" }` in
`handle.realtime` (`RouteRealtimeTable`; the column is checked against the
table's row type). `{ table, filter: ({ params, data }) => string | undefined }`
builds the filter from the route's loader data, for a record the URL does not
name (the MES operation page follows its job, or everything when it runs in a
batch); it returns `false` to follow nothing (a job with no model). A plain table name follows every change in the company: right for a
list page, wasteful on a detail page. A missing answer always means "it may
concern me": the filter can cause an extra reload, never a missed one. An
UPDATE names the values a row had as well as the ones it has, so a row moved
to another parent reaches both pages.

A table that reaches its record through another table gets that record's id
added: a production event carries `jobId`, read from its operation. The hops
are the `ancestors` constant in `broadcast_table_changes.sql`;
`REALTIME_ANCESTOR_COLUMNS` (`realtime-tables.ts`) types the same columns and
a test keeps the two equal. Add a hop there when a detail page must follow a
grandchild table. A hop with a fourth element looks the other way: a payment
has no invoice column, so its message names the invoices its
`invoiceSettlement` rows apply it to (`targetSalesInvoiceId`,
`targetPurchaseInvoiceId`; an empty list when it is applied to none). An
invoice page follows `invoiceSettlement` and `payment` on that column: voiding
a payment changes the payment row only.

The broadcast functions return at once when `realtime.send` does not exist, so
a database without Supabase Realtime still accepts writes.

| Function (`event-system/functions/`) | Topic | For |
|---|---|---|
| `broadcast_table_changes` | `company:<companyId>:<table>` | pages and live lists |
| `broadcast_reference_changes` | `company:<companyId>:reference` (one shared topic) | cached `api+` reference lists |
| `broadcast_user_changes` | `user:<userId>:<table>` | notifications |

- An UPDATE that changes only `updatedAt` / `updatedBy` / `embedding` sends
  nothing (the same list `dispatch_event_batch` ignores; `event-dispatch.test.ts`
  keeps the copies equal).
- `itemSupersession` has no `id`: its message carries the `itemId`.
  `implementationHub` has no `companyId`: its `id` is the company.
- Which tables broadcast is declared in `event-system/attachments.ts`, never in
  a migration (see `authz-manifest.md` → Event triggers). `REALTIME_TABLES` and
  the `RealtimeTable` type are DERIVED from it (`realtime-tables.ts`), so a table
  name with no handler does not compile.

## Who may listen

Topics are private. Two policies on `realtime.messages`, owned by the authz
manifest (`"realtime.messages"`): an employee of the company may join a
`company:` topic, and a user may join a `user:` topic that carries their own id.
Realtime checks the policy once, at join — not per change per subscriber, which
is what made `postgres_changes` a single-threaded bottleneck across tenants.
Pinned by `supabase/tests/realtime-broadcast.test.sql`.

## Making a page live

A route names the tables it shows:

```ts
export const handle: Handle = {
  realtime: ["job", "jobOperation", "jobMaterial"]
};
```

`RouteRealtime`, rendered once in each app shell, subscribes to the tables of
the matched routes and, 300 ms after the last message, invalidates the cached
loader entries and revalidates the page. A burst is one reload; a route and a
component following the same table reload once; a reload waits while a fetcher
is submitting or a navigation is in flight, and runs when both are done
(`useRevalidator` from `@carbon/query`, the only one app code may import). During
an action React Router drops the fetcher's redirect; during the navigation that
follows a save, a revalidation restarts it WITHOUT the submission, and every
layout whose `shouldRevalidate` skips a plain navigation then keeps its data
from before the save. The save's own broadcast arrives in exactly that window.

- Update the list when the loader starts reading a new table. Nothing checks
  that a list is COMPLETE, only that each name can broadcast.
- A table missing from `attachments.ts`: add `broadcast_table_changes` to its
  entry, `pnpm db:migrate`, then `authz migration <name>`.

| For | Use |
|---|---|
| A component that is not a route | the app's `useRealtime(table, filter?)`. An `id=eq.` / `id=in.()` filter narrows it, and so does the same on a `<name>Id` column (`quoteLineId=eq.…`); a filter on any other column wakes on every change to the table |
| A component that keeps rows in its own state (a chat, running events) | `useChangedRows({ table, columns, onChange, onResync })` — it re-reads the changed rows and hands them over |
| Raw access to a topic | `useTableChanges` / `useTopic` |

**One channel per topic.** The Realtime client returns the SAME channel object
for a topic it already has, so two hooks that each opened one would tear each
other down. Every listener registers in a module-level registry and
`RouteRealtime` owns one channel per topic. Never call `carbon.channel(...)` or
`useRealtimeChannel` for a broadcast topic yourself; nothing is delivered unless
`RouteRealtime` is mounted.

## Live lists

`useItems`, `useCustomers`, `useSuppliers`, `usePeople` (and the MES pair) are
`LiveList` definitions in `apps/*/app/stores/`: the table, the ONE column list,
`fetchAll`, `fetchByIds`, `related` tables and the sort. The rows live in the
query cache under `["live", companyId, <name>]`; the hooks keep their
`[rows, setRows]` shape. `LiveLists` (in `RealtimeDataProvider`) loads them:

1. IndexedDB first (`<name>:<companyId>:<userId>`), so pickers have options at once.
2. One `table_changes_since(cursor)` call.
3. Only the rows it names are re-read; a named row that does not come back is
   removed. The whole list is fetched once per device, and again only when the
   log answers `reset` or names more than 500 rows. Ids are re-read 100 per
   request: `.in()` goes in the URL, and a few hundred ids exceed the gateway's
   limit.
4. While the tab is open, broadcasts patch the list row by row, in memory
   only. After a reconnect, step 2 runs again.

The stored copy is written only in step 3. A broadcast's patch does not move the
cursor, so the next load re-reads those rows whatever was stored, and storing
means writing the whole list (about 150 ms of blocked page for 150,000 items).

**Who may keep a stored list.** It is company data on a device, so it goes when
the user's access does: `LiveLists` takes `companyIds` (the companies the user
is an employee of, from the shell) and at page load removes every stored list
of another company or another user (`staleStoredKeys`); when
`table_changes_since` refuses the caller (`42501`, removed while the page was
open) the current company's lists are emptied in memory and on the device; and
each app's login page clears the store, whichever way the session ended. A
stored list also expires: its write time is kept beside it
(`<key>:at`, so checking it does not read the list) and a list not written for
24 hours is removed (`STORED_LIST_MAX_AGE_MS`). The check runs at page load
and every hour while a page is open (`BACKGROUND_CHECK_MS`); a visible page
also asks the log again then, which rewrites its own lists (so a list in use
does not expire) and catches a user who has left the company. A browser that never opens
Carbon again keeps its copy: nothing can reach it.

### The change log

`tableChange` (`20261004200418_table-change-log.sql`) is an UNLOGGED table: one
row per changed row of a list table, written by the `log_table_changes` /
`log_user_changes` statement handlers, purged after 7 days by `pg_cron`. It has
no API access; `table_changes_since` (SECURITY DEFINER, checks the caller's
company) is the only reader, and the backup engine skips the table.

- **The cursor is a transaction id** — `pg_snapshot_xmin(pg_current_snapshot())`
  — not the table's id or a timestamp. A sequence value is taken before commit,
  so "the highest id I saw" skips a row whose transaction commits late. With
  xmin a few rows are named twice; re-reading them is harmless.
- **`reset`** when there is no cursor, the log was emptied since it was issued,
  or the cursor is older than the retention less a day. The epoch is a token in
  `util."tableChangeEpoch"`, an UNLOGGED table the same crash recovery empties
  (the postmaster start time does not change when a backend crashes). With no
  token every call resets, until the hourly `util.purge_table_changes()` writes
  a new one. A writer that runs with triggers off (company restore) inserts a
  null-`rowId` row per `CHANGE_LOGGED_TABLES` entry itself.
- **`table_changes_since` must stay `STABLE`**: the read of the log and
  `pg_current_snapshot()` then share one snapshot. As `VOLATILE`, a change
  committed between the two is skipped for good.
- **No foreign key to `company`.** Deleting a company cascades to its items,
  whose log trigger inserts a row for a company already gone in that
  transaction; a key would abort the delete. The purge removes those rows.
- **One update of a list at a time** (`inTurn` in `useLiveList.tsx`): a full
  fetch and a broadcast's re-read would otherwise overlap, and the older read
  could land last.
- **A cursor belongs to one company.** `LiveLists` stays mounted across a
  company switch, so it keys cursors by company as well as list.
- **A patch is a function of the current rows** (`commit` in `useLiveList.tsx`),
  never a value computed before an awaited read: two broadcasts inside one
  round-trip would otherwise overwrite each other.
- A renamed `user` has no company; `log_user_changes` records it as an
  `employee` change for each company the user belongs to.
- To give another list a delta: add `log_table_changes` to its tables' entries
  in `attachments.ts`.

## Gotchas

- `payload.new` / `payload.old` do not exist. Re-read by id.
- Do not key a client cache without the company (`.ai/lessons.md`: an unkeyed
  IndexedDB copy once hydrated one company's pickers with another's rows).
- The first message after the first-ever private join on a fresh Realtime
  server was not delivered in one test (the replication slot is created at that
  join). Not reproduced since; the reconnect catch-up does not cover it.
