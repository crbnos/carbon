---
paths:
  - "packages/query/**"
  - "apps/erp/app/routes/api+/**"
---

# Client cache: `cachedClientLoader` and the invalidation middleware

How the ERP and the MES cache route data in the browser. All of it lives in
`@carbon/query` (`packages/query`); there is no app-level cache file
(`~/utils/react-query` is gone) and no route exports a `clientAction`.

## The cache

One TanStack `QueryClient` per page. Each app's `root.tsx` creates it and stores
it on `window.clientCache`, so code outside React (a `clientLoader`, the
middleware, the realtime hooks) reaches the same client as `useQuery` does.
`getClientCache()` from `@carbon/query/cache` returns it (undefined on the server).

## Caching a loader: one line, no key

```ts
// apps/erp/app/routes/api+/sales.customer-types.ts
import { cachedClientLoader } from "@carbon/query/cache";

export async function loader({ request }: LoaderFunctionArgs) { /* unchanged */ }

export const clientLoader = cachedClientLoader<typeof loader>();
// or cachedClientLoader<typeof loader>({ staleTime: RefreshRate.Never })
```

- The key is the URL: `[LOADER, companyId, pathname, search]`. Nobody writes a
  query key or a key factory. A route param or a search param is part of the key
  because it is part of the URL.
- It reads with `fetchQuery`, so `staleTime` is honored and concurrent loads of
  one URL share a request. (The old `getQueryData`/`setQueryData` pair ignored
  both: an entry lived for the whole session.)
- `clientLoader.hydrate` is set, so the cache warms on first load.
- With no company yet, or no cache, it calls `serverLoader()` uncached.
- Loader entries are garbage-collected after 30 minutes unused.
- Import from `@carbon/query/cache` in a route module, not `@carbon/query`: the
  subpath has no React or UI import, and a route module also runs on the server.

**Scope: `api+` reference lists only.** Page data is not cached this way. A
route with a `clientLoader` leaves the combined single-fetch request and sends
its own, so caching page loaders turns one request into many.

## Invalidation: once, in `root.tsx`

```ts
export const clientMiddleware = [
  flashClientMiddleware,
  createInvalidationMiddleware({
    getCache: () => window.clientCache,
    skipPaths: [path.to.refreshSession]
  })
];
```

After any non-GET request finishes, every `LOADER` entry is marked stale. The
action and the revalidation that follows it are separate passes through the
middleware, so the entries are already stale when the loaders re-run. Client
middleware wraps fetcher submissions too, so a modal's save is covered.

- A route does not name what its action changes. Do not add a `clientAction`
  to invalidate.
- `skipPaths` is for POSTs that change no data. `/refresh-session` fires on
  every tab focus and would otherwise refetch every list.
- It is deliberately blunt: saving a part also marks customer types stale,
  which costs one extra fetch the next time that list is used.
- Realtime invalidates the same entries when another user changes a reference
  table (see `realtime-system.md`).

## Reading in a component

| Hook | Use |
|---|---|
| `useLoaderQuery<T>(url \| null)` | Render with an `api+` URL's data. One request per URL however many components read it; refetches when invalidated. `T` is the data, or `typeof loader`. `null` waits |
| `cachedApiQuery<T>(url)` | The same read from an event handler or an effect |
| `useAction<T>({ onSuccess, onError, onSettled })` | A mutation fetcher whose result goes to a callback instead of an effect watching `fetcher.data`. Submit with `.submit()` or `<action.Form>` as with `useFetcher`. `onSettled` runs whenever a submission finishes; `onSuccess` / `onError` only when the action returned data (an action that redirects returns none) |

Do not write `useFetcher()` + `fetcher.load(url)` in a mount effect for an
`api+` list: it is one request per component, shows no cached value, and never
refetches after a save. Keep `useFetcher` for a load that happens on an event
(a search box, a drill-down click) or that calls a third party.

## The company in the key

The `companyId` cookie is httpOnly, so the browser cannot read it. Each shell
layout calls `setClientCompanyId(company.id)` during render, and `getCompanyId()`
returns that. Before this, `getCompanyId()` parsed `document.cookie` and always
returned `null`, so every key was scoped to the string `"null"`.

## Naming trap

Never name a module `*.client.ts` if a route calls something from it while the
module is evaluated. React Router empties `.client` modules on the server:
`createInvalidationMiddleware(...)` in `root.tsx` became "is not a function"
during SSR. Typecheck and unit tests pass with that bug in place.
