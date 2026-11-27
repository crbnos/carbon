# Routes and loaders lessons

React Router routes, loaders and actions, outlets, revalidation, the client query cache, realtime, service workers.

## A browser-safe env flag isn't live until the root loader's hand-built `env` also carries it

```scope
id: a-browser-safe-env-flag-isn-t-live-until-the-root-loader-s-h
paths: ["apps/erp/app/root.tsx","apps/mes/app/root.tsx","packages/env/src/index.ts"]
triggers: ["getBrowserEnv","window.env"]
```

**Rule:** The root loader's hand-built `env` object, not `getBrowserEnv()`, is what fills `window.env` on the normal render path (the ErrorBoundary path uses `getBrowserEnv()` directly, which hides the gap). When an env-driven feature is dark although the server value is set, diff `getBrowserEnv()`'s keys against the loader's `env` object before touching anything else. The rest is in `.claude/rules/environment-configuration.md`.

**Applies to:** `apps/erp/app/root.tsx` (and `apps/mes/app/root.tsx`) loader `env` objects, `packages/env/src/index.ts` `getBrowserEnv()`, any `window.env`-gated integration/feature flag.

## A `.client.ts` module is empty on the server, even for a value a route only calls at load

```scope
id: a-client-ts-module-is-empty-on-the-server-even-for-a-value-a
paths: ["apps/*/app/root.tsx","packages/query/src/invalidation.ts"]
triggers: ["createInvalidationMiddleware"]
```

**Rule:** Typecheck, lint and unit tests do not see a module that is empty on the server. After adding anything to `root.tsx` or a shell layout, load the page from a running dev server before calling it done. The rest is in `.claude/rules/clientAction-patterns.md`.

**Applies to:** `apps/*/app/root.tsx`, `packages/query/src/invalidation.ts`, any shared module imported by a route.

## A cookie-only save must not re-run every loader on the page

```scope
id: a-cookie-only-save-must-not-re-run-every-loader-on-the-page
paths: ["packages/utils/src/revalidate.ts","apps/*/app/root.tsx","apps/*/app/routes/x+/_layout.tsx","apps/erp/app/routes/x+/workflow+/$id.tsx"]
triggers: ["ROOT_ACTION_SAVE","rootShouldRevalidate","deferRootActionPost","defaultShouldRevalidate","skipPaths"]
```

**Context:** The Appearance pane posts each choice to the host app's root action (`/`), which
only writes a cookie that only the root loader reads.

**Problem:** React Router re-runs every loader on the page after any action, and the client
cache middleware marks every cached list stale. One theme pick on the Production page re-ran
the shell and the page's loaders. A color drag that saved every 150 ms ran about 20 full
revalidations in 3 seconds.

**Rule:** Submit a cookie-only save with `defaultShouldRevalidate: false`. The route that reads
the cookie opts back in from its `shouldRevalidate` (`rootShouldRevalidate`, `@carbon/utils`), and
a shell or page whose `shouldRevalidate` forces a re-run defers to the default for it (`deferRootActionPost`). Put the action's path in the
`createInvalidationMiddleware` `skipPaths`. The URL in the network tab is still
`<page>.data`, but `?_routes=root` shows that only the root loader ran.

**Applies to:** `ROOT_ACTION_SAVE` (`packages/utils/src/revalidate.ts`), each app's `root.tsx`
and `x+/_layout.tsx`, `x+/workflow+/$id.tsx`, and any new action that writes only a browser
preference.

## A fetcher's failed load replaces the whole page

```scope
id: a-fetcher-s-failed-load-replaces-the-whole-page
paths: []
triggers: ["fetcher.load("]
```

- **Context:** A modal loaded an optional extra (the values behind its pencils) with `useFetcher().load`.
- **Problem:** A loader that throws sends a fetcher's error to the nearest route boundary (`setFetcherError`). The record page became an error screen, and the modal and its unsaved draft went with it.
- **Rule:** When a page can work without the data, load it with a plain `fetch` and handle the failure there, or return the failure from the loader as data.
- **Applies to:** Every `fetcher.load` for something optional, especially behind unsaved work.

## A flash on a fetcher's redirect back to the same page is never shown

```scope
id: a-flash-on-a-fetcher-s-redirect-back-to-the-same-page-is-nev
paths: ["apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx"]
triggers: ["useRuleViolations"]
```

**Context:** Refusing a receipt post that still misses serial numbers (2026-10-16). The Post dialog submits through `useRuleViolations`, a fetcher.

**Problem:** The action threw `redirect(path.to.receipt(id), await flash(...))`. The redirect lands on the pathname already on screen, so the root's `shouldRevalidate` (`isSearchParamOnlyNavigation`) skips the root loader, and the root is what reads the flash and shows the toast. The post was refused correctly, but the user saw nothing happen. The route's older flash errors ("Failed to post receipt") have the same gap.

**Rule:** An action submitted through a fetcher returns its error as data (`{ error: { message } }`, which `useRuleViolations` toasts), not as a flash on a redirect to the current page. A flash is for a redirect that navigates somewhere else.

**Applies to:** Post / void / approve actions behind a modal or `useRuleViolations` (`receipt+/$receiptId.post.tsx` and its siblings).

## A layout that skips its loader is only as correct as its skip rule

```scope
id: a-layout-that-skips-its-loader-is-only-as-correct-as-its-ski
paths: ["apps/*/app/routes/**/_layout.tsx","packages/utils/src/revalidate.ts","apps/erp/app/routes/x+/**/_layout.tsx","apps/mes/app/routes/x+/**/_layout.tsx"]
triggers: ["export const shouldRevalidate","shouldRevalidate","defaultShouldRevalidate","useResolved"]
```

**Rule:** To see which loaders a navigation asked for, read the `_routes` query of its `.data` request. The rest is in `.claude/rules/coding-conventions.md` (Routes: a layout does not export `shouldRevalidate`).

**Applies to:** every layout route, and every route with children under `apps/{erp,mes}/app/routes/x+`; `packages/utils/src/revalidate.ts`.

## A per-request memo keyed on the `Request` object never hits — React Router doesn't share one across loaders

```scope
id: a-per-request-memo-keyed-on-the-request-object-never-hits-re
paths: ["packages/logger/src/context.server.ts","packages/auth/src/services/auth.server.ts","packages/auth/src/services/users.server.ts"]
triggers: ["WeakMap<Request","oncePerRequest","oncePerRead","requestContextMiddleware"]
```

**Context:** Perf work on `sid/perf-audit-hot-paths` (2026-08). Every matched route calls `requirePermissions` independently, so a detail page did one Redis GET for permission claims and one `createClient()` per loader. The obvious fix is to memoize per request.

**Problem:** The first attempt was a `WeakMap<Request, …>` — safe-looking, self-evicting, zero call-site changes, and it passed typecheck plus six unit tests asserting "same Request → same value, different Request → different value". It also did nothing: measured with `redis-cli monitor`, claims lookups on a deep page were **4 both with and without it**, because React Router does not hand the same `Request` instance to every matched loader. The unit tests were green precisely because they constructed the shared-Request case the runtime never produces. The working mechanism is AsyncLocalStorage holding React Router's own per-request `RouterContextProvider` (published by a root middleware) — the same pattern `requestIdMiddleware` already used via LogTape's `withContext`. That took the page from 4 lookups to 1.

**Rule:** A memo is a performance claim, and a performance claim needs a measurement, not a unit test — a test can only prove the memo behaves as written, never that its key is stable in production. Before shipping request-scoped caching, count the underlying calls end-to-end (redis `MONITOR`, `pg_stat_statements`, a temporary counter) with the change toggled off and on. Reach for ALS-over-`context` rather than keying on `Request`. And note the corollary: memoizing **database state** must be gated to GET/HEAD/OPTIONS (`oncePerRead`), because React Router runs an action and its loader revalidation in a single request — an ungated memo there serves pre-write data, which for permission claims means a gate passing on permissions the action just revoked.

**Applies to:** `packages/logger/src/context.server.ts` (`oncePerRequest` / `oncePerRead` / `requestContextMiddleware`), `packages/auth/src/services/{auth,users}.server.ts`, and any future request-scoped cache.

## A prefix short-circuit in the server entry outranks every route under it

```scope
id: a-prefix-short-circuit-in-the-server-entry-outranks-every-ro
paths: ["apps/erp/server/app.ts","apps/mes/server/*.ts"]
triggers: ["well-known","pathname.startsWith"]
```

**Context:** `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` each have a route, and each returned an empty **204** in production instead of its JSON. The MCP endpoint hands clients the first of those URLs in its 401 `WWW-Authenticate` header (`api+/mcp+/_index.ts:63`), so OAuth discovery for the remote connector was dead.

**Problem:** `apps/erp/server/app.ts` wrapped `createRequestHandler` with `if (pathname.startsWith("/.well-known/")) return new Response(null, { status: 204 })` — added to keep browser probes out of the dev logs, with the comment "no app route". That was true when it was written; three `.well-known` routes were added later and every one of them became unreachable, because the short-circuit runs BEFORE the router.

**Rule:** A path check in the server entry silently outranks routing for everything under it. If you short-circuit a prefix, derive the exemptions from the build manifest (`build.routes`) rather than assuming the prefix stays route-free — a comment asserting "no app route" is a claim that rots the moment somebody adds one. Three false leads to skip next time this shape appears: it reproduces identically on Vercel AND `react-router-serve` (so it is not the platform); `/.foo` and `/.env` return normal 404s (so it is not dotfile handling); and `matchRoutes` against the full route table picks the RIGHT route and passes WITH the bug present (so a matcher test proves nothing). The tell was that percent-encoding the dot (`/%2Ewell-known/...`) returned `200 application/json` — `new URL().pathname` leaves the escape undecoded so `startsWith` missed, while the router decodes and matched.

**Applies to:** `apps/erp/server/app.ts`, `apps/mes/server/*`, and any request-handler wrapper that inspects `pathname` before delegating.

## Chrome on macOS drops an installed app's Dock badge when its window closes

```scope
id: chrome-on-macos-drops-an-installed-app-s-dock-badge-when-its
paths: ["apps/erp/app/hooks/useAppBadge.ts","apps/erp/public/service-worker.js"]
triggers: ["setAppBadge"]
```

**Context:** The app icon badge is set by the open tab and by each push (`setAppBadge` in the worker), so it should keep counting while the installed app is closed (2026-10-22).

**Problem:** In Chrome on macOS the badge shows while the app's window is open and disappears when it closes; a push that arrives later, and `setAppBadge` run from the worker's own console, both resolve and draw nothing. Chrome's installed app is a helper process that quits with its window, and the badge belongs to it. The badge also needs macOS notification permission with "Badge app icon" on (System Settings → Notifications → the app).

**Rule:** Do not promise a closed-app badge on macOS Chrome. Test the badge with the app hidden (⌘H), not closed, and test the closed case on a platform meant to keep it (an iPhone Home Screen app) before calling it broken.

**Applies to:** `apps/erp/app/hooks/useAppBadge.ts`, `apps/erp/public/service-worker.js`, the `send-push` badge count.

## File downloads can link directly to a resource route

```scope
id: file-downloads-can-link-directly-to-a-resource-route
paths: ["apps/erp/app/routes/x+/reports+/*aging*"]
triggers: ["withCsvExport","csvExportHref","serverExport"]
```

**Context:** The AR/AP aging table needs a complete server-generated CSV rather than its currently expanded browser rows.

**Problem:** Adding a separate Export button required turning off the Table's own CSV control with `withCsvExport={false}`, leaving two download mechanisms to coordinate.

**Rule:** For one format, give the Table the download URL and render its Download control as a plain anchor. For multiple formats on a report, use one Export menu whose links each make one browser GET to a server resource route; hide the Table's single-format control there. Keep the client-side Table export for lists without a download URL.

**Applies to:** Table downloads backed by resource routes and AR/AP aging exports.

## `getCompanyId()` read an httpOnly cookie in the browser and always returned null

```scope
id: getcompanyid-read-an-httponly-cookie-in-the-browser-and-alwa
paths: ["packages/query/src/cache.ts","apps/*/app/routes/x+/_layout.tsx"]
triggers: ["document.cookie","getCompanyId","setClientCompanyId"]
```

**Rule:** Never read a session cookie from `document.cookie`. A value the browser needs comes from loader data. The rest is in `.claude/rules/clientAction-patterns.md` (The company in the key).

**Applies to:** `packages/query/src/cache.ts`, both `apps/*/app/routes/x+/_layout.tsx`, any new client-side tenant scoping.

## macOS silently replaces a web notification that reuses a tag

```scope
id: macos-silently-replaces-a-web-notification-that-reuses-a-tag
paths: ["apps/erp/public/service-worker.js"]
triggers: ["showNotification","getNotifications"]
```

**Rule:** To replace an earlier notification, close it yourself (`registration.getNotifications()`, match on `notification.data.tag`), then show the new one with no `tag`. To debug a push that "does not arrive", read the send's status code first, then the macOS notification log (`log show --predicate 'process == "usernoted"'`, look for `updatedExisting: true`), before changing code. The rest is in `.claude/rules/service-workers.md`.

**Applies to:** `apps/erp/public/service-worker.js`; any future service worker or Notification API caller.

## React Router's instrumentation API can observe a request, not change it

```scope
id: react-router-s-instrumentation-api-can-observe-a-request-not
paths: ["packages/logger/src/middleware.server.ts","packages/logger/src/tracing.server.ts"]
triggers: ["instrumentations","requestMiddleware","timedMiddleware"]
```

**Context:** The request-id, access-log and request-context middlewares looked like candidates to move into `instrumentations`, to shorten the middleware chain.

**Problem:** In React Router 7.18 an instrumentation wrapper receives a read-only view: the request is `{ method, url, headers.get }` with no `signal` and no `clone()`, the context exposes only `get`, and the result carries only `statusCode` and `meta`. It cannot set a response header, open an AsyncLocalStorage scope around the handler, or read the body, which is everything those middlewares do.

**Rule:** Instrumentation is for spans and measurements. Anything that sets a header, provides context to downstream code or reads the request stays a middleware; merge middlewares into one (`requestMiddleware`) instead of moving them. A middleware's own cost is recorded by `timedMiddleware` as `carbon.middleware.<name>.ms`, not by a span, because a middleware span contains everything it calls.

**Applies to:** `packages/logger/src/middleware.server.ts`, `packages/logger/src/tracing.server.ts`, both apps' `root.tsx`.

## A "did my job finish?" baseline must include the rows a FAILED run left behind

```scope
id: a-did-my-job-finish-baseline-must-include-the-rows-a-failed
paths: ["apps/erp/app/routes/x+/settings+/backups.tsx"]
triggers: ["knownBackupNames","runningExport","failedIsStale"]
```

**Context:** The Backups page shows a spinner row while an export runs, and decides the
run finished when a backup appears in the list that was not in a `baseline` snapshot
taken when tracking began. The baseline recorded only backups with status `ready`.

**Problem:** A failed export leaves a **pending** (manifest-less) folder in the list.
When the user clicked "Skip corrupted rows and retry", that leftover folder later
flipped to `ready` — it was not in the ready-only baseline, so it read as "this run
completed" and the spinner vanished a second after the retry started, while the job was
still running. The job was correct throughout; only the completion test was wrong. The
same shape bit the failure banner: a marker cleared by the action could still arrive via
a revalidation already in flight, so the banner reappeared under the running row.

**Rule:** A baseline for "something NEW appeared" must snapshot **every** item already
present, in every status — not just the ones in the terminal state you are waiting for.
A prior failure's debris is exactly what will later transition into that state and fake
a completion. And when a stale record can still arrive after you delete it, identify it
by **identity** (the exact row you superseded), never by comparing a client timestamp
against a server one — clock skew then decides your control flow.

**Applies to:** `apps/erp/app/routes/x+/settings+/backups.tsx` (`runningExport`,
`knownBackupNames`, `failedIsStale`), and any optimistic progress row driven by polling
a list.

## A fetcher action that redirects to a record's index loses its toast

```scope
id: a-fetcher-action-that-redirects-to-a-record-s-index-loses-it
paths: ["apps/erp/app/routes/x+/purchase-order+/*.tsx"]
triggers: ["path.to.purchaseOrder(","rootShouldRevalidate"]
```

**Context:** The purchase order force-delete modal posts through a fetcher, and the
action redirected to `path.to.purchaseOrder(id)` with a flash.

**Problem:** That index route redirects again, to `/details`, in its middleware. The
second hop is a plain GET to the path the form was already on, so
`rootShouldRevalidate` reads it as a search-param-only navigation and skips the
root loader. The flash is never read: no toast, and it surfaces later on an
unrelated page.

**Rule:** Redirect an action straight to the page that renders the record
(`path.to.purchaseOrderDetails(id)`), never to an index that redirects again.

**Applies to:** Any action whose redirect target is a `$id._index.tsx` that
redirects (purchase orders, and the other records with a `/details` index).

## A fetcher's redirect is dropped when anything revalidates during the action

```scope
id: a-fetcher-s-redirect-is-dropped-when-anything-revalidates-du
paths: ["apps/mes/app/hooks/useRealtime.tsx","packages/react/src/hooks/useRevalidator.ts"]
triggers: ["revalidate()","useRevalidator","useRealtimeRevalidator","shouldRevalidate"]
```

**Rule:** Before you explain a skipped loader, log what `shouldRevalidate` received: wrap the route's `shouldRevalidate` on `window.__reactRouterDataRouter.routes` and read `formMethod`, `defaultShouldRevalidate` and both URLs for each call. In single fetch `defaultShouldRevalidate` is `true` for every route on every navigation; do not assume it is `false` after a redirect. The rest is in the `no-raw-revalidator` check (`@carbon/checks`) and `.claude/rules/mes-job-operation-ui.md` (`useRealtimeRevalidator`).

**Applies to:** every realtime- or interval-driven `revalidate()` on a page that submits fetchers — MES `useOperation`, `AssemblyView`, `useRealtime`; `packages/react/src/hooks/useRevalidator.ts`; every route that exports `shouldRevalidate`.

## A flash returned with `data()` from a page loader never shows

```scope
id: a-flash-returned-with-data-from-a-page-loader-never-shows
paths: []
triggers: ["await flash(","flashData(","flashMiddleware"]
```

**Rule:** Do not return a flash with `data()` from a page loader and expect a later page to show it: the root's `flashMiddleware` reads and clears the flash on that page's own document request. The rest is in `.claude/rules/flash-system.md`.

**Applies to:** any loader or action that sets a flash for the page it sends the user to.

## A notification click on an uncontrolled tab opens nothing

```scope
id: a-notification-click-on-an-uncontrolled-tab-opens-nothing
paths: ["apps/erp/public/service-worker.js","apps/mes/public/service-worker.js"]
triggers: ["notificationclick","clients.matchAll","openWindow"]
```

**Rule:** `WindowClient.navigate()` rejects for a tab the worker does not control, so do not pass `includeUncontrolled` to `matchAll` when you will call `navigate()`. Focus first, because the click allows focus for a short time only. Wrap the focus and the navigation in `try`, and call `clients.openWindow()` when either fails. The rest is in `.claude/rules/service-workers.md` (Push).

**Applies to:** `apps/erp/public/service-worker.js`; any service worker that navigates a client.

## A server-only value in a route component, or a dropped side-effect import, fails only the production build

```scope
id: a-server-only-value-in-a-route-component-or-a-dropped-side-e
paths: []
triggers: [".service\"","\"sideEffects\"","LOCK_PERIOD_TASK_NAME"]
```

**Rule:** Both mistakes pass typecheck, the tests and the dev server, and break only `react-router build`. Run `pnpm --filter erp build` before you call a change to imports or module files done. The rest is in the `no-server-code-in-client` and `side-effect-import-declared` checks (`@carbon/checks`).

**Applies to:** ERP and MES modules and routes; every `package.json` that sets `sideEffects`.

## Client-side entity caches must be company-keyed in a multi-tenant app

```scope
id: client-side-entity-caches-must-be-company-keyed-in-a-multi-t
paths: ["apps/erp/app/components/RealtimeDataProvider.tsx","apps/mes/app/components/RealtimeDataProvider.tsx","apps/erp/app/stores/**","packages/query/src/useLiveList.tsx","packages/query/src/cache.ts"]
triggers: ["localforage","indexedDB","localStorage.setItem","IndexedDB","localStorage","setClientCompanyId"]
```

**Context:** A prod company export failed its closure guard: a `salesOrder` (and its `opportunity`) in one company referenced another company's customer. Root cause chain: `RealtimeDataProvider` (ERP + MES) cached the customer/item/supplier/people lists in IndexedDB under **global** keys (`"customers"`), and company switching is a client-side navigation — so after a switch, the previous company's cached list could hydrate the pickers before the properly-scoped server fetch landed. Nothing downstream caught the bad pick: zod validated `customerId` as a bare string, services inserted it blindly, RLS only checks the row's own `companyId`, and the FK was single-column (`customerId → customer(id)`). Later the live lists (items, customers, suppliers, people) were kept in IndexedDB under `<list>:<companyId>` and patched from a change log.

**Problem:** Any client cache (IndexedDB/localforage, localStorage, nanostores hydrated from them) that isn't keyed by `companyId` becomes a cross-tenant leak the moment a multi-company user switches companies without a full reload. Multi-company users legitimately pass RLS for both companies, so no server layer notices. A company key alone is not enough. The rows a user holds are their RLS view. The next person to sign in on that browser hydrated the previous user's rows, and patching only the changed ids never removed them. The in-memory query cache had the same hole inside one tab.

**Rule:** (1) Key every persisted client cache entry by company (`customers:${companyId}`) and guard async hydration callbacks against mid-flight company switches. Key it by user as well as company, and empty the in-memory cache when the user changes (`setClientCompanyId(companyId, userId)`). A cache that is only ever patched needs a path that replaces it. (2) Tenant-scoped references between tables should be composite FKs `(refId, companyId) → parent(id, companyId)` so the DB rejects cross-company refs from every write path (see `20260703143904_composite-tenant-fks.sql`, which converts customer/supplier refs introspectively and tolerates pre-existing bad rows via NOT VALID + warning).

**Applies to:** `apps/{erp,mes}/app/components/RealtimeDataProvider.tsx`, `apps/erp/app/stores/*`, `packages/query/src/useLiveList.tsx`, `packages/query/src/cache.ts`, any new client-side cache or persistence; migrations adding FKs to company-scoped parents.

## React Router v7 middleware `next()` never rejects on thrown Responses/errors

```scope
id: react-router-v7-middleware-next-never-rejects-on-thrown-resp
paths: ["packages/logger/src/middleware.server.ts","packages/auth/src/middleware/*.ts"]
triggers: ["await next()","clientMiddleware","requestIdMiddleware"]
```

**Context:** Writing `requestIdMiddleware` (`@carbon/logger`) that sets an `x-request-id` header on the response after `await next()`, and worrying that thrown redirects/`data()` from loaders/actions would skip the header.

**Problem:** It is easy to assume `next()` propagates the thrown redirect/error (route handlers DO `throw redirect(...)`), which would mean post-`next()` response mutation is skipped on those paths. That assumption is wrong and leads to defensive try/catch that isn't needed.

**Rule:** In RR v7 middleware (`callRouteMiddleware`, react-router dist), `next()` wraps the downstream chain in try/catch and **resolves** with `errorHandler(error)`'s Response — it only rejects if `request.signal.aborted`. So mutating headers on the resolved response after `await next()` correctly covers redirects and error (500) responses; only aborted requests skip it, which is fine (client is gone). Register the middleware first so downstream runs inside its `withContext`/ALS scope.

**Applies to:** any RR v7 `middleware`/`clientMiddleware` that reads or mutates the response after `next()`; `packages/logger/src/middleware.server.ts`, `packages/auth/src/middleware/*`.

## Registering on `load` from entry.client never registers in dev

```scope
id: registering-on-load-from-entry-client-never-registers-in-dev
paths: ["apps/*/app/entry.client.tsx"]
triggers: ["addEventListener(\"load\"","serviceWorker.register"]
```

**Rule:** Check `navigator.serviceWorker.getRegistrations()` in the browser after any change to how a worker is registered; a worker that never registered logs no error. The rest is in `.claude/rules/service-workers.md`.

**Applies to:** `apps/erp/app/entry.client.tsx`, `apps/mes/app/entry.client.tsx`; any code in an entry module that waits for `load`.

## A fetcher's error goes to the boundary above the component that owns it

```scope
id: a-fetcher-s-error-goes-to-the-boundary-above-the-component-t
paths: ["packages/react/src/ErrorBoundary/**","packages/auth/src/lib/supabase/provider.tsx","apps/*/app/routes/**/refresh-session.tsx"]
triggers: ["isNetworkError","navigator.onLine","refresh-session","setInterval"]
```

**Context:** `CarbonProvider` (`@carbon/auth`, rendered by each app's `x+/_layout`) refreshes the session from a one-minute timer with `useFetcher().submit` to `/refresh-session`. In a background tab the POST failed with `TypeError: Failed to fetch` (the laptop asleep, the connection dropped), and the whole app was replaced by the root "Something broke on our end" screen.

**Problem:** React Router sends a fetcher's error to `findNearestBoundary(state.matches, routeId)`, where `routeId` is the route that RENDERED the fetcher, not the route the request was sent to. `refresh-session.tsx` exports an `ErrorBoundary` that never runs for this; the shell layout has none, so the root took it. A fetch that gets no response is not a `Response`, so the boundary showed it as a 500.

**Rule:** A request a timer or event sends on its own (not one the user started) must not be able to fail into a boundary: skip it while `navigator.onLine` is false and retry on `online`. Both error boundaries treat `isNetworkError` as a lost connection and revalidate when the connection or the tab comes back; a successful revalidation clears `state.errors`.

**Applies to:** every `useFetcher` used from a layout or provider, every background timer that submits or loads, `packages/react/src/ErrorBoundary/`.

## A prefetch the browser cannot reuse makes the click slower

```scope
id: a-prefetch-the-browser-cannot-reuse-makes-the-click-slower
paths: ["packages/react/src/PrefetchLink.tsx","packages/utils/src/prefetch.ts"]
triggers: ["prefetch=","PrefetchPageLinks","prefetchCacheMiddleware","Sec-Purpose"]
```

**Context:** Links prefetched their page's data on hover, then (2026-10-02) on press, to give the click a head start.

**Problem:** Single-fetch `.data` responses carry `cache-control: max-age=0, must-revalidate` and no validator, so the browser never serves the click from the prefetched response: both requests reach the server. Chrome also holds a second request for a URL until the first one's response arrives (its HTTP cache admits one writer per URL). The click's request therefore waited behind the prefetch: 781 ms against 518 ms median click-to-page in production, and two same-URL `fetch` calls took 572 / 923 ms where two `cache: "no-store"` ones took 615 / 585 ms.

**Rule:** A prefetch only helps if the browser may reuse its response. Give a prefetch response (`Sec-Purpose: prefetch`) a short `private` lifetime and leave every other response uncached; `prefetchCacheMiddleware` (`@carbon/utils`) does it in each app's root `middleware`, the fix React Router points to (remix-run/react-router#13255). Measure a prefetch by click-to-page time, not by whether the request was sent. A first fix removed the prefetch instead (`6e3bdf7bc6`); it worked but threw away the head start.

**Applies to:** `packages/react/src/PrefetchLink.tsx`; `packages/utils/src/prefetch.ts`; any `<Link prefetch>` or `PrefetchPageLinks`; a revalidation started while a navigation to the same URL is loading.

## A published schema default is a promise the server has to keep

```scope
id: a-published-schema-default-is-a-promise-the-server-has-to-ke
paths: ["scripts/lib/input-docs.ts","packages/api/src/service-fn.server.ts"]
triggers: [".default("]
```

**Context:** API and MCP input schemas come from each service function's `input` validator, whose `.default(0)` was often written for a form that submits every field.

**Problem:** A caller reading `taxPercent: default 0` leaves the field out and expects 0. On a read typed from a validator's output an unfilled default crashed (`state: {}` on a pivot); on an update, filling it overwrites a stored value the caller never mentioned. And a default that looked safe to fill was not: list reads published `limit: default 100`, but the service pages only when it is handed a limit, so filling it would have cut every unpaged list read to 100 rows.

**Rule:** A default in a service function's `input` is both published and filled: `defineServiceFn` (`packages/api/src/service-fn.server.ts`) parses every call with that schema. So give a field a default only where filling it is right (a read, a create or an action), never on an update input, where it overwrites a stored value the caller left out. Before adding one, read what the service does when the field is absent, and compare with the column's own database default.

**Applies to:** `packages/api/src/service-fn.server.ts`, `scripts/lib/input-docs.ts`, any validator default that reaches an API schema.

## A realtime subscription to a table that is not published fails silently

```scope
id: a-realtime-subscription-to-a-table-that-is-not-published-fai
paths: ["packages/query/src/useRealtime.tsx"]
triggers: ["postgres_changes","supabase_realtime","useRealtime","useChangedRows"]
```

**Rule:** Verify a "live" page by changing the row while the page is open, not by reading the subscription code. The rest is in `.claude/rules/realtime-system.md` and the `no-postgres-changes` check (`@carbon/checks`).

**Applies to:** `apps/*/app/routes/**` `handle.realtime`, `useRealtime`, `useChangedRows`.

## A service function's result is not the building block's result

```scope
id: a-service-function-s-result-is-not-the-building-block-s-resul
paths: ["apps/erp/app/routes/**"]
triggers: ["dataOrThrow", "unwrap(", "paged("]
```

**Context:** 1,145 loader reads moved from `.service` building blocks to `api.<module>.<fn>(input)` (2026-10-18).

**Problem:** The two results differ in four ways that a codemod changes silently. `paged` answers `data: { rows, count }`, not `data` and `count`. `unwrap` drops `count`. A refusal is `{ category, message, status }`, so a `PGRST116` check never matches. A service function that returns its building block's value as is (no `unwrap`/`paged`) answers `{ data: value }`, and a throw comes back as `{ error }`, not a throw. The `unwrap` data type also took the failure branch's `null` until `DataOf` was fixed, so 570 loader reads of `.data` after an `.error` check broke at once.

**Rule:** Classify each service function by what its `run` returns before a caller swaps to it (`unwrap`, `paged`, or a plain value) and skip one the classifier does not know. Read a plain value with `dataOrThrow`. When a type error repeats hundreds of times, fix the shared type, not the call sites.

**Applies to:** every move from a building block to its service function, in loaders, actions, jobs and tests.

## A page that is off for this company redirects home, not to its module

```scope
id: a-page-that-is-off-for-this-company-redirects-home-not-to-its
paths: ["apps/erp/app/routes/x+/settings+/**"]
triggers: ["moduleIndexLoader", "authenticatedRoot"]
```

**Context:** A Settings page gated by a flag, a plan or the environment (ITAR
Certifications, Companies, Backups, Webhooks) redirected to `/x/settings` when
that gate was off.

**Problem:** A module root opens on the first page of the module the person can
view (`moduleIndexLoader`, `landingOf`), and that choice knows nothing about
flags or plans. For a person whose first Settings page is the gated one, the root
sends them straight back to it: a redirect loop. The one-page-role pass found it.

**Rule:** When a page is unavailable for this company, redirect to
`path.to.authenticatedRoot`, never to its own module root.

**Applies to:** Every flag-, plan- or environment-gated route under a module whose
root is `moduleIndexLoader`.

## A component reads its data through an `api+` route, not from an effect

```scope
id: a-component-reads-its-data-through-an-api-route-not-from-an
paths: ["apps/erp/app/routes/api+/production.planned-orders.ts", "apps/erp/app/modules/production/ui/Planning/DrawerPlannedOrders.tsx"]
triggers: ["useCarbon()"]
```

**Context:** The MRP planning drawer read its planned orders, open jobs and open PO lines with the browser's Supabase client, from an async function started inside `useEffect`.

**Problem:** A rejected read was never caught, so the drawer could spin for ever. The code also needed a read counter so an old answer could not land last, a version number bumped after each change, and a flag to skip the second read the revalidation caused. Every new way to change the data needed another trigger. The query ran in the browser, so it could not log a failure or answer with a status.

**Rule:** Put a component's read in an `api+` route and read it with `useLoaderQuery`. Follow `.claude/rules/clientAction-patterns.md` → "A component that loads its own data"; copy `api+/production.planned-orders.ts` and `DrawerPlannedOrders`. An async call in an effect stays acceptable only for a third-party API or a load started by an event (a search box, a click).

**Applies to:** Every drawer, panel or card in `apps/erp` and `apps/mes` that loads its own data. Before you write `useEffect(() => { (async () => …)() })` or `.then(` on a client read, write the route.
