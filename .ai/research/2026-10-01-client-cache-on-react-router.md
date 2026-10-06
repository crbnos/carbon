# Client cache on React Router — internals and libraries

Date: 2026-10-01. Question: can a TanStack Query–backed cache be tied tightly to React
Router so routes never manage query keys, and is there a library to build on?

Carbon today: `react-router` 7.18.0, React 18.3.1, `@tanstack/react-query` 5.97.0.

## React Router internals (read from the installed 7.18.0 source and bundled docs)

| Fact | Where | Consequence |
|---|---|---|
| Every loader read is `fetch("<path>.data?_routes=…")` through the global `fetch` | `fetchAndDecodeViaTurboStream` | The URL fully identifies the data; a URL is a usable cache key |
| A route with a `clientLoader` leaves the combined request; its `serverLoader()` sends its own `.data?_routes=<routeId>` | `singleFetchLoaderNavigationStrategy` | Caching through `clientLoader` costs one request per cached route on a miss, each authenticating separately on the server |
| `fetcher.load` is one request for one route | `singleFetchLoaderFetcherStrategy` | Selector reads are already per-route; nothing is lost by caching them through `clientLoader` |
| `dataStrategy` is data-mode only. In framework mode it is hard-wired inside `createHydratedRouter`; `HydratedRouter` takes only `getContext`, `onError`, `instrumentations` | `dom-export.mjs`, `docs/how-to/data-strategy.md` | The seam React Router itself calls "the foundation to build … caching layers" is closed to us without forking `HydratedRouter` on `UNSAFE_createRouter` + `UNSAFE_getTurboStreamSingleFetchDataStrategy` |
| Instrumentations are read-only by design | `docs/how-to/instrumentation.md` | They can observe navigations, loaders and actions (invalidation triggers, metrics); they cannot serve cached data |
| `defaultShouldRevalidate` is stable since 7.15 on `<Link>`, `<Form>`, `useSubmit`, `fetcher.submit`, `setSearchParams` | changelog, `.d.mts` | A single submit or link can skip revalidation without route code — e.g. inline cell edits |
| The official client-cache example is URL-keyed: `generateKey(request)` in `clientLoader`, delete in `clientAction` | `docs/how-to/client-data.md` | Keying by URL is the documented pattern, not a hack |
| Route `headers` apply to `.data` responses | `singleFetchLoaders` → `getDocumentHeaders` | A route can state cache policy in a header |
| `pattern` in loader args is the matched leaf pattern | `.d.mts` | Good for tracing, not a per-route identity |
| The router is reachable at `window.__reactRouterDataRouter` | `dom-export.mjs` | `revalidate()`, `subscribe()`, `state.revalidation` are available outside React |

### Version risk

React Router 8.0.0 shipped 2026-06-17: React 19.2.7+, Node 22.22+, Vite 7+, ESM-only, all
`v8_*` flags default. The changelog lists no change to the `.data` wire format or
`clientLoader`. 8.4.0 reworked the internal data-router contexts. Carbon is on the last 7.x
and React 18, so anything built on `UNSAFE_*` exports or the wire format has to survive
that upgrade.

## Libraries

| Library | Version, last publish | What it is | Fit |
|---|---|---|---|
| `remix-client-cache` | 3.0.0, 2025-04-27, peer `react-router ^7` | `clientLoader` cache. Default key is `pathname + search + hash`. Stale-while-revalidate by default: returns cached data plus a deferred promise and hot-swaps. Pluggable storage adapters | Closest to "no keys, tied to React Router". But no staleness or TTL, no in-flight dedupe, no awareness of actions; invalidation is manual by key; components must use its own hook. Unpublished for ~18 months. Useful as a ~200-line reference, not as a dependency |
| `@tanstack/query-core` | 5.104.0, 2026-09-26 | The headless engine Carbon already uses | Keep as the engine. Persistence (`query-persist-client-core`) and cross-tab sync (`query-broadcast-client-experimental`) exist as add-ons |
| `@tanstack/db` + `@tanstack/query-db-collection` | 0.11.0 / 1.3.1, 2026-09-30 | Collections, live queries, optimistic writes. Sync modes: eager, on-demand ("the component's query becomes the API call"), progressive | One key per collection instead of per query. Active but pre-1.0 |
| `@supabase-labs/tanstack-db` | 0.1.0, 2026-09-25 | Supabase's TanStack DB collection: PostgREST reads from the browser, Realtime sync, optimistic writes, RLS applies | A direct replacement for `RealtimeDataProvider`. Alpha: no SSR, Realtime usage "still being stabilized", offset paging can skip rows, 1,000-row cap on some reads |
| `@supabase-cache-helpers/postgrest-react-query` | 1.13.9, 2026-03-12 | Derives keys from the PostgREST query; updates cached queries after mutations | Only for browser-side supabase-js reads and its own mutation hooks |
| oRPC / tRPC TanStack utilities | — | Keys derived from the procedure path; `queryOptions()` usable in loaders | Needs an RPC layer over the services. A large change |
| `@epic-web/cachified` | 5.6.3, 2026-07-02 | Server-side TTL and stale-while-revalidate over any store, including Redis | Would replace hand-written Redis get/set such as the plan and changelog caches |
| `@remix-pwa/sw` | 3.0.10, 2025-03-08, peers on Remix v2 | Service-worker caching of loader requests | Not usable on React Router 7 |
| `@lukemorales/query-key-factory` | 1.3.4, 2024-02-25 | Key registry helper | Stale, and it is the thing we want to stop maintaining |

No maintained library does wire-level caching of `.data` requests for React Router 7.

## What this changes

1. **Reference lists (`api+` loaders):** a URL-keyed `clientLoader` factory on query-core is
   the documented React Router pattern plus the two things `remix-client-cache` lacks,
   staleness and dedupe. About 40 lines of our own; no dependency. Selector reads are
   already one request per route, so the per-route request cost does not apply.
2. **Realtime lists (items, customers, suppliers, people):** `@supabase-labs/tanstack-db` is
   the first library that does what `RealtimeDataProvider` hand-rolls. It is two weeks old
   and alpha, so it is a spike candidate, not an adoption.
3. **Page data:** caching it through `clientLoader` splits one request into many, and the
   proper seam (`dataStrategy`) is closed in framework mode. Leave page data uncached.
4. **New lever:** `defaultShouldRevalidate={false}` at the call site for mutations that
   cannot change anything else on screen.

## Open

- The July client-cache spec (`.ai/specs/2026-07-23-client-query-cache.md`) is not on this
  branch. It rejected a URL-keyed middleware; its reasons need checking against item 1.
- Whether a factory-returned `clientLoader` with `.hydrate = true` is picked up correctly.
- Supabase Realtime cost and RLS behaviour for the alpha collection under multi-tenant load.

## Sources

- React Router changelog — https://reactrouter.com/changelog
- React Router docs bundled in the package (`node_modules/react-router/docs`): `how-to/client-data.md`, `how-to/data-strategy.md`, `how-to/instrumentation.md`
- Call-site revalidation opt-out — https://github.com/remix-run/react-router/pull/14542
- React Router + TanStack Query discussion — https://github.com/remix-run/react-router/discussions/12944
- remix-client-cache — https://github.com/forge-42/remix-client-cache/blob/main/README.md
- TanStack DB — https://tanstack.com/db/latest/docs/overview , https://tanstack.com/blog/tanstack-db-0.5-query-driven-sync
- Supabase TanStack DB collection — https://github.com/supabase/tanstack-db
- oRPC TanStack Query integration — https://orpc.dev/docs/integrations/tanstack-query
- npm registry (`pnpm view`) for versions and publish dates, 2026-10-01
