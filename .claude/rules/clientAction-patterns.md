---
paths:
  - "apps/erp/app/routes/api+/**"
  - "apps/erp/app/routes/x+/**"
  - "apps/erp/app/utils/react-query.ts"
  - "apps/erp/app/root.tsx"
---

# clientLoader / clientAction Patterns

React Router v7 (`react-router`, **not** Remix) client data functions. They run an
in-memory SPA cache in front of the route's own server `loader` / `action`. This is an
**ERP-only** convention — `apps/mes/app` uses neither. As of grounding: ~25 ERP files use
`clientLoader`, ~63 use `clientAction`.

Types are imported from `"react-router"`:

```ts
import type {
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from "react-router";
```

## The cache: a `window.clientCache` QueryClient

The cache is a TanStack `QueryClient` attached to `window.clientCache` — **not** a
module-level Map or localStorage. It is created once on mount in
`apps/erp/app/root.tsx` with everything set to never expire, so it behaves as a
session-lived in-memory cache:

```ts
window.clientCache = new QueryClient({
  defaultOptions: {
    queries: { gcTime: Infinity, refetchOnWindowFocus: false, staleTime: Infinity },
  },
});
```

Query keys come from factory functions in `apps/erp/app/utils/react-query.ts`
(e.g. `customerTypesQuery(companyId)`, `itemPostingGroupsQuery(companyId)`), each
returning `{ queryKey, staleTime }`. Keys are namespaced by company for multi-tenancy.
Helpers in that file: `getCompanyId()` reads the `companyId` cookie client-side (returns
`null` on the server); `getClientCache()` returns `window.clientCache` or `undefined`.

## clientLoader — read-through cache (read routes, `api+/`)

Canonical shape (`apps/erp/app/routes/api+/sales.customer-types.ts`): company-scoped
read-through cache. No company → defer to server. Cache miss → `serverLoader()` then
populate. Cache hit → skip the network.

```ts
export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();
  if (!companyId) return await serverLoader<typeof loader>();

  const queryKey = customerTypesQuery(companyId).queryKey;
  const data =
    window?.clientCache?.getQueryData<Awaited<ReturnType<typeof loader>>>(queryKey);

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(queryKey, serverData);
    return serverData;
  }
  return data;
}
clientLoader.hydrate = true;
```

- `serverLoader<typeof loader>()` is the typed call back to the route's own server `loader`.
- `clientLoader.hydrate = true` makes the client loader run on **initial hydration**, not
  just subsequent client navigations — so the cache warms on first load. Present on all
  `api+` clientLoader files; no `HydrateFallback` is exported anywhere.
- Variants destructure `request` to fold URL search params into the key
  (`apps/erp/app/routes/api+/users.groups.tsx` →
  `groupsByTypeQuery(companyId, type)`).

## clientAction — cache invalidation (mutation routes, `x+/`)

Mutation routes (`*.new`, `*.$id`, `*.delete.*`) invalidate the matching cached query,
then delegate to the server `action`. **No optimistic updates** — invalidation only; the
next `clientLoader` run sees a miss and re-fetches.

Invalidate-by-predicate (`apps/erp/app/routes/x+/items+/groups.$groupId.tsx`):

```ts
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const companyId = getCompanyId();
  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as string[];
      return (
        queryKey[0] === itemPostingGroupsQuery(companyId).queryKey[0] &&
        queryKey[1] === companyId
      );
    },
  });
  return await serverAction();
}
```

Alternative for a single known key — set it to `null` instead of a predicate:

```ts
window?.clientCache?.setQueryData(uomsQuery(getCompanyId()).queryKey, null);
return await serverAction();
```

If you need form data inside the clientAction (e.g. to pick which key to invalidate),
clone the request first — `request.clone().formData()` — so the server `action` can still
read the body.

## Rules

1. **Always end by calling `serverAction()` / `serverLoader()`** — the client function
   wraps the real server function, it does not replace it.
2. **Optional-chain the cache**: `window?.clientCache?.` — it may not exist yet.
3. **Scope by company**: build keys with `getCompanyId()`; bail to the server when it's
   `null`.
4. `invalidateQueries({ predicate })` for bulk/prefix invalidation;
   `setQueryData(key, null)` for one specific key.
5. Set `clientLoader.hydrate = true` so the cache warms on first load.

<!-- UNVERIFIED: claim that clientAction "can handle validation errors before hitting the
server" — the old supplier-processes example wasn't re-confirmed at grounding; treat
validation-in-clientAction as a rare special case, not the standard pattern. -->
