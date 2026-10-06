# @carbon/query

The client data layer shared by the ERP and the MES: the TanStack Query cache in front of route loaders, and the realtime system that keeps it and the pages current.

## Always

- **There is no app-level cache file.** Import from `@carbon/query` (components) or `@carbon/query/cache` (route modules); `~/utils/react-query` is gone.
- **Cache a loader by URL, never by a hand-written key.** `export const clientLoader = cachedClientLoader<typeof loader>()`. The key is `[LOADER, companyId, pathname, search]`.
- **Let the root middleware invalidate.** `createInvalidationMiddleware` marks every `LOADER` entry stale after any non-GET request. A route does not name the lists its action changes, and exports no `clientAction` for that.
- **Declare a route's tables in `handle.realtime`.** `RouteRealtime` (rendered once in each app shell) subscribes to them and reloads the page when one changes. A component that is not a route uses the app's `useRealtime(table, filter?)`.
- **A realtime table must have a broadcast handler** in `packages/database/src/event-system/attachments.ts`. `RealtimeTable` is derived from it, so an unknown table does not compile.
- **Import `@carbon/query/cache` from a route module.** It has no React or UI import. The package root (`@carbon/query`) pulls in `@carbon/react`.

## Ask First

- Changing the cache key shape, or what the middleware invalidates
- Adding a topic shape other than `company:<companyId>:<table>`, `company:<companyId>:reference` and `user:<userId>:<table>` (each needs a `realtime.messages` policy in the authz manifest)

## Never

- Name a module here `*.client.ts` or `*.server.ts` if a route calls it at module load: React Router empties `.client` modules on the server, and `root.tsx` calls `createInvalidationMiddleware(...)` while it is evaluated there.
- Subscribe with `postgres_changes`. The `supabase_realtime` publication is empty; a subscription to it delivers nothing and reports no error.
- Read `payload.new` / `payload.old`. A broadcast carries `{ table, op, ids }` and no row data; re-read the rows by id through PostgREST, so table RLS still decides what the user sees.
- Use a row count, a sequence value or a timestamp as a live list's cursor. The cursor is the transaction id `table_changes_since` hands back (a snapshot's xmin): a sequence value is taken before commit, so "the highest I saw" skips a row whose transaction commits late.

## Validation Commands

```bash
pnpm exec turbo run typecheck --filter=@carbon/query
pnpm --filter @carbon/query test
```

## Key Patterns

| Export | Use |
|---|---|
| `cachedClientLoader`, `loaderQueryKey`, `LOADER`, `RefreshRate` | Cache an `api+` loader; build the same key for a component read |
| `useLoaderQuery(url)` | Read an `api+` URL in a component: one shared request per URL, refetched when invalidated. Replaces `useFetcher` + `fetcher.load` in a mount effect |
| `cachedApiQuery(url)` | The same read from an event handler or an effect |
| `useAction({ onSuccess, onError, onSettled })` | A mutation fetcher with callbacks. `onSettled` runs whenever a submission finishes, also when the action redirects and returns no data; `onSuccess` / `onError` need data |
| `setClientCompanyId(companyId, userId)` / `getCompanyId` | The shell layout sets both during render; the `companyId` cookie is httpOnly and unreadable in the browser. A different user empties the cache; leaving a company drops its loader entries |
| `useRevalidator()` | React Router's `useRevalidator`, held while a fetcher is submitting or a navigation is in flight. The only one app code may import (`no-raw-revalidator` check): a revalidation during the redirect after a save restarts it as a plain navigation and the layouts skip their reload |
| `createInvalidationMiddleware({ getCache, skipPaths })` | Root `clientMiddleware`; skip POSTs that change no data (`/refresh-session`) |
| `RouteRealtime`, `useRealtimeTable`, `useTableChanges`, `useRealtimeRevalidator` | Realtime over private broadcast topics. Reloads go through `useRevalidator`, so they wait for a save in flight. A route entry `{ table, column, param }` and a `<name>Id=eq.` filter follow one record's rows only (`matchesFilter`) |
| `useRealtimeChannel` | One channel with retry, `private` and `onSubscribed(isReconnect)`. It reconnects when the tab returns after 5 minutes hidden or with a channel that is not joined — every reconnect reloads the page's data, so time in another tab does not |
| `LiveLists`, `useLiveList`, `LiveList` | Whole lists kept in the cache (items, customers, suppliers, people). IndexedDB first (the stored copy is keyed by company AND user: it is that user's RLS view); then `table_changes_since(cursor)` names the rows that changed since the stored copy and only those are re-read. The full list is fetched once per device, and again only when the log cannot answer (no cursor, a server restart, a cursor older than 7 days, more than 500 changed rows). Broadcasts patch it in memory while the tab is open; the stored copy is written only when the log is read (a patch does not move the cursor, so storing it buys nothing). Stored lists are removed from the device when they are no longer the user's: another user's or a company outside `companyIds` at page load, the current company when `table_changes_since` answers `42501`, everything on the login page, and any list not written for 24 hours (`STORED_LIST_MAX_AGE_MS`). An open page repeats the check every hour and asks the log again, which rewrites its own lists and notices a user who has left the company |

## Cross-References

- `.claude/rules/authz-manifest.md` — the `realtime.messages` policies and the event-trigger attachments
- `packages/database/src/event-system/functions/broadcast_*.sql` — what a message contains
- `packages/database/src/event-system/functions/log_*.sql` and `20261004200418_table-change-log.sql` — the change log (`tableChange`, UNLOGGED) and its reader
- `.ai/specs/2026-10-04-client-query-cache-and-realtime-broadcast.md` — the design and its decisions
