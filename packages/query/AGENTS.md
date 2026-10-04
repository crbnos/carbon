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
- Store a server checksum beside a list that was patched from a broadcast (see the note in `useLiveList.tsx`).

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
| `setClientCompanyId` / `getCompanyId` | The shell layout sets the company during render; the `companyId` cookie is httpOnly and unreadable in the browser |
| `createInvalidationMiddleware({ getCache, skipPaths })` | Root `clientMiddleware`; skip POSTs that change no data (`/refresh-session`) |
| `RouteRealtime`, `useRealtimeTable`, `useTableChanges`, `useRealtimeRevalidator` | Realtime over private broadcast topics. Revalidation waits for a submitting fetcher |
| `useRealtimeChannel` | One channel with retry, reconnect on focus, `private` and `onSubscribed(isReconnect)` |
| `LiveLists`, `useLiveList`, `LiveList` | Whole lists kept in the cache (items, customers, suppliers, people): IndexedDB first, fetched only when `list_checksums` differs, patched from broadcasts |

## Cross-References

- `.claude/rules/authz-manifest.md` — the `realtime.messages` policies and the event-trigger attachments
- `packages/database/src/event-system/functions/broadcast_*.sql` — what a message contains
- `.ai/specs/2026-10-04-client-query-cache-and-realtime-broadcast.md` — the design and its decisions
