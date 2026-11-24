# Routes and loaders lessons

React Router routes, loaders and actions, outlets, revalidation, the client query cache, realtime, service workers.

## A browser-safe env flag isn't live until the root loader's hand-built `env` also carries it

```scope
id: a-browser-safe-env-flag-isn-t-live-until-the-root-loader-s-h
paths: ["apps/erp/app/root.tsx","apps/mes/app/root.tsx","packages/env/src/index.ts"]
triggers: ["getBrowserEnv","window.env"]
```

**Context:** The Stripe Connect integration card stayed "Coming soon" even with `STRIPE_SECRET_KEY` set server-side. `getBrowserEnv()` (`packages/env/src/index.ts`) already exposed `STRIPE_CONNECT_ENABLED` and the `Window.env` interface declared it, so it looked fully wired — but the browser gate `window.env?.STRIPE_CONNECT_ENABLED === "true"` still read `undefined`.

**Problem:** `apps/erp/app/root.tsx`'s loader does NOT pass `getBrowserEnv()` through — it destructures specific keys and rebuilds an `env: { ... }` object by hand, and `window.env` is populated from THAT loader object on the normal render path (`const env = loaderData?.env ?? {}` → `<Document env={env}>`). The new flag was added to `getBrowserEnv()` but never added to the loader's manual list, so it was silently dropped client-side. (The ErrorBoundary path uses `getBrowserEnv()` directly, which masks the gap during casual reading.)

**Rule:** Adding a browser-safe var is THREE edits, not one: the `getEnv` export, `getBrowserEnv()` + the `Window.env` interface, AND the consuming app's root-loader `env` object (destructure + literal) for every app that needs it client-side. The loader's hand-curated `env` is the real source of `window.env` on the happy path — a key present in `getBrowserEnv()` but absent there is `undefined` in the browser. When an env-driven feature is dark despite the server value being set, diff `getBrowserEnv()`'s keys against the loader's `env` object before touching anything else.

**Applies to:** `apps/erp/app/root.tsx` (and `apps/mes/app/root.tsx`) loader `env` objects, `packages/env/src/index.ts` `getBrowserEnv()`, any `window.env`-gated integration/feature flag.

## A `.client.ts` module is empty on the server, even for a value a route only calls at load

```scope
id: a-client-ts-module-is-empty-on-the-server-even-for-a-value-a
paths: ["apps/*/app/root.tsx","packages/query/src/invalidation.ts"]
triggers: ["createInvalidationMiddleware"]
```

**Context:** The invalidation middleware factory lived in `invalidate.client.ts`, next to `flash.client.ts`. `root.tsx` calls `createInvalidationMiddleware(...)` while the module is evaluated.

**Problem:** React Router replaces a `.client` module's exports with `undefined` on the server. `flash.client.ts` survives because `root.tsx` only REFERENCES its export; a factory is CALLED, so SSR died with "is not a function". Typecheck, lint and unit tests passed.

**Rule:** A module whose export is called at module load of a route must not be named `.client` or `.server`. After adding anything to `root.tsx` or a shell layout, load the page from a running dev server before calling it done.

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

**Context:** 186 layouts exported `shouldRevalidate` and skipped a GET navigation that left their params unchanged (`isUnaffectedByNavigation`, 2026-10-01), to save a layout loader run on each click. The skip came from a slow click: a click on a BOM node under a part (`/x/part/:itemId/make/:makeMethodId.data`) took 2.8 s in production. The Vercel log showed about 68 PostgREST calls for that one click, and about 10 belonged to the page being opened.

**Problem:** React Router 7 single fetch passes `defaultShouldRevalidate = true` for every GET navigation, so every reused ancestor loader re-runs unless its route exports `shouldRevalidate`. Before the skip, the app shell (`x+/_layout.tsx`, about 20 queries plus an auth round-trip) only opted out for same-pathname navigations, and the part layouts did not opt out at all. The burst is what makes each call slow: the first concurrent wave ran about 200 ms per call, later ones 30 to 60 ms.

The skip rule inferred "nothing changed" from `formMethod`. React Router passes a fetcher's submission to the first navigation after it only, so a delete that redirected to a record's bare URL, whose index route redirects again, arrived as a plain navigation and every layout kept its data (2026-10-06). An earlier patch had fixed the same blind spot for a revalidation restarting a navigation. 154 of the 186 layouts also declared no realtime tables, so another user's change did not show until the record changed. A module-level "a save happened" flag closed the redirect case and was rejected: one package set it, another cleared it, a third read it.

**Rule:** Layouts do not skip their loaders. Do not export `shouldRevalidate` from a layout to save a loader run; make the loader cheaper instead (one query, the direct connection, shared work through middleware context). The root and the app shell are the only exceptions. To see which loaders a navigation asked for, read the `_routes` query of its `.data` request. Estimated cost of removing the skip, from production traces: 100 to 300 ms on a click that used to skip, until the dozen slow record loaders are optimised. Data in a shell loader that does not gate rendering is returned as a promise and read with `useResolved` (`~/hooks/useResolved`), never awaited.

**Applies to:** every layout route, and every route with children under `apps/{erp,mes}/app/routes/x+` (the app shell `x+/_layout.tsx`, `$id.tsx` with tabs, and list pages that parent a drawer, `foo.tsx` + `foo.new.tsx`); `packages/utils/src/revalidate.ts`; the record loaders (`purchase-order+/$orderId`, `supplier+/$supplierId`, `sales-invoice+/$invoiceId`, `part+/$itemId`, `sales-order+/$orderId`, `quote+/$quoteId`).

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

## A service worker's install-time cache can come out empty and stay empty

```scope
id: a-service-worker-s-install-time-cache-can-come-out-empty-and
paths: ["apps/erp/public/service-worker.js","apps/mes/public/service-worker.js"]
triggers: ["caches.open","ensureOfflinePage","fallbackOfflinePage"]
```

**Context:** The ERP worker saves `offline.html` when it installs, and installs anyway when the save fails, so push never depends on it (2026-10-22).

**Problem:** A user toggled offline while an updated worker was installing. The save failed, the new worker activated and deleted the previous cache, and every later offline page load got the browser's "This site can't be reached": the worker had nothing to answer with, and it only reinstalls when its own file changes.

**Rule:** Never trust that install filled a cache. Re-check it from the fetch handler after a page load that reached the network (`ensureOfflinePage`), and give the worker a built-in last-resort response (`fallbackOfflinePage`) so a cache miss never surfaces as the browser's error.

**Applies to:** `apps/{erp,mes}/public/service-worker.js`; any worker that precaches on install.

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

**Context:** The client cache scoped its keys with `getCompanyId()`, which parsed `document.cookie` for `companyId`.

**Problem:** That cookie is httpOnly, so JavaScript never sees it. Every key was scoped to the string `"null"`, and an invalidation that matched on the real company id matched nothing. It went unnoticed because a company switch reloads the page and empties the in-memory cache.

**Rule:** Never read a session cookie from `document.cookie`. A value the browser needs comes from loader data: the shell layout calls `setClientCompanyId(company.id)` during render (`@carbon/query/cache`).

**Applies to:** `packages/query/src/cache.ts`, both `apps/*/app/routes/x+/_layout.tsx`, any new client-side tenant scoping.

## macOS silently replaces a web notification that reuses a tag

```scope
id: macos-silently-replaces-a-web-notification-that-reuses-a-tag
paths: ["apps/erp/public/service-worker.js"]
triggers: ["showNotification","getNotifications"]
```

**Context:** Browser push notifications (`apps/erp/public/push-worker.js`) passed each notification's `tag` (`job-assignment:<id>`, `carbon-test`) to `showNotification`, so a second push about the same thing would replace the first instead of stacking.

**Problem:** On macOS the browser hands the tag to the OS as the notification's identifier, and the OS replaces a notification with the same identifier silently: no banner, only an updated entry in Notification Center. The first test arrived while banners were still off, and every later test replaced it without a sound, so push looked broken although every send returned `201` (2026-10-08). `renotify: true` did not change it. The cause was only visible in the macOS log (`log show --predicate 'process == "usernoted"'`): `updatedExisting: true`.

**Rule:** Never pass a reused `tag` to `showNotification` when the user must see the repeat. Close the older notifications yourself (`registration.getNotifications()`, match on `notification.data.tag`), then show the new one with no `tag`, so it gets a fresh identifier. To debug a push that "does not arrive", read the send's status code first, then the OS notification log, before changing code.

**Applies to:** `apps/erp/public/service-worker.js` (was `push-worker.js`); any future service worker or Notification API caller.

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

## State seeded from loaded data is a copy that nothing updates

```scope
id: state-seeded-from-loaded-data-is-a-copy-that-nothing-updates
paths: []
triggers: ["useLoaderData","useRouteData"]
```

**Context:** A route's components stay mounted when only its params change, and loaded data changes under a mounted component constantly: a save's revalidation, a realtime reload, a layout that reloads after its page has mounted.

**Problem:** `useState(valueFromLoaderData)` reads the value once. Two bugs came from it (2026-10-06). The quote summary summed its totals from lines copied into state at mount, so a deleted line stayed in the subtotal until a reload. And a notes editor seeded from record A stayed mounted on record B: B showed A's notes, and the first keystroke saved A's text into B. An audit of 467 seeded `useState` calls found 17 confirmed cases. Reloading every layout on every navigation had hidden most of the first kind, not fixed it.

**Rule:** Do not copy loaded data into state. A value computed from the data is computed during render (`useMemo`). The user's choices over the data are the only state, combined with the current data during render (`selectQuoteLines`). A draft the user edits is fine as state because the page it lives in remounts for another record: every route under `/x` renders `RecordOutlet` (`@carbon/react`), never a plain `<Outlet>`. Do not write an effect that copies the data into state again. Checks: `no-bare-outlet` and `no-state-copy-of-loader-data` (`@carbon/checks`; the second sees only a hook result used by name in the same file, not a copy seeded from a prop).

**Applies to:** every component that reads `useLoaderData`, `useRouteData` or props that come from them; every route with a param in its path.

## A component's outlet beside the route's outlet mounts the child route twice

```scope
id: a-component-s-outlet-beside-the-route-s-outlet-mounts-the-ch
paths: []
triggers: ["<Outlet","RecordOutlet"]
```

- **Context:** List tables and record cards (`ApiKeysTable`, `WebhooksTable`, `SupplierProcesses`) rendered their own `<Outlet />` for their New/Edit drawers. #1855 then gave every route under `/x` a `<RecordOutlet />`, and these routes kept both.
- **Problem:** Both outlets render the same child route, so New API Key opened two modals with the same `id="name"` input. Each Radix modal set `aria-hidden` on everything outside itself, so each hid the other: screen readers and `getByRole` found no Name field, checkbox or Save button, while a sighted user saw one dialog. The per-file `no-bare-outlet` scan reads routes only, so it did not see the component's outlet.
- **Rule:** One outlet per route. A component rendered by a route that has `RecordOutlet` has no outlet of its own; adding `RecordOutlet` to a route whose table still renders `Outlet` means removing the table's. `findNestedOutlets` (`no-bare-outlet`) flags the pair across files.
- **Applies to:** every component in `modules/*/ui/` or `components/` that renders `Outlet`, and every route that renders one.

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

**Context:** MES "Complete Batch" posts through a `useFetcher` to an action that runs for several seconds and ends in `redirect(path.to.operations)`. The operation page also subscribes to realtime changes on `jobOperation`/`job` and calls `revalidate()` on each. In the ERP, realtime calls `revalidate()` 300 ms after a broadcast. At that time 186 layouts exported `shouldRevalidate` and skipped a GET navigation that left their params unchanged.

**Problem:** The completion's own writes fired the realtime `revalidate()` mid-action. React Router (`handleFetcherAction`) ignores a fetcher's redirect when `pendingNavigationLoadId > originatingLoadId` — any navigation or revalidation started after the submit wins. The redirect was silently discarded, the fetcher went idle, and the page sat on stale loader data from the mid-run revalidation (the batch still "Completing", button reading "Retry Completion") even though the work had landed.

A revalidation during the navigation after a save loses the save too. A save's own broadcast arrives while its redirect is still loading. `revalidate()` during a loading navigation restarts it with `overrideNavigation: state.navigation`, and for a fetcher submission that carries no `formMethod`. The restarted navigation looks like a plain one, so each layout returned `false` and kept its data from before the save: a new quote line was missing from the quote's explorer until a reload (2026-10-05). In single fetch `defaultShouldRevalidate` is `true` for every route on every navigation, so a predicate cannot tell a forced reload from a plain one. A first fix assumed React Router's default was `false` after a redirect with no cookie. Logging the predicate's arguments in the browser showed the default was `true`, and the first pass did include the layout.

**Rule:** Realtime listeners must not revalidate while a fetcher on the page is submitting — use `useRealtimeRevalidator()` (`apps/mes/app/hooks/useRealtime.tsx`), never a bare `useRevalidator().revalidate()` in a realtime callback. Skipping loses nothing: the router revalidates after every action, which is why `revalidate()` already no-ops during a navigation submission. The same race also reached single-operation completion: finishing a job's last operation completes the job, the job UPDATE revalidated the operation loader mid-action, its floor gate redirected with "This operation's job has not been released to the floor", and the operator saw that error instead of "Operation finished successfully" (reproduced 2 of 10 runs before the guard, 0 of 8 after). Batch completion additionally returns `data({ completed: true })` and navigates client-side. Never call React Router's `revalidate()` directly. Import `useRevalidator` from `@carbon/query`: it holds a call made while a navigation is in flight or a fetcher is submitting, and runs it when the router is idle. The `no-raw-revalidator` check (`@carbon/checks`) fails an import of React Router's. Before you explain a skipped loader, log what `shouldRevalidate` received: wrap the route's `shouldRevalidate` on `window.__reactRouterDataRouter.routes` and read `formMethod`, `defaultShouldRevalidate` and both URLs for each call.

**Applies to:** every realtime- or interval-driven `revalidate()` on a page that submits fetchers — MES `useOperation`, `AssemblyView`, `useRealtime`; `packages/react/src/hooks/useRevalidator.ts`; every `revalidate()` call (realtime, polling timers, upload callbacks); every route that exports `shouldRevalidate`.

## A flash returned with `data()` from a page loader never shows

```scope
id: a-flash-returned-with-data-from-a-page-loader-never-shows
paths: []
triggers: ["await flash(","flashData(","flashMiddleware"]
```

**Context:** The kanban scan (2026-10-19) returned `data(result, await flash(request, error(…)))` from its loader, and its page then navigated to the job with `window.location`.

**Problem:** The message never appeared. The root's `flashMiddleware` reads and clears the flash on every request. It ran on the scan's own document request and cleared the cookie the loader had just set. Typecheck and unit tests cannot see this; only the browser did.

**Rule:** To carry a message to another page, throw `redirect(path, await flash(request, …))` from the loader or action, as every other route does. Do not return a flash with `data()` from a page loader and expect a later page to show it.

**Applies to:** any loader or action that sets a flash for the page it sends the user to.

## A notification click on an uncontrolled tab opens nothing

```scope
id: a-notification-click-on-an-uncontrolled-tab-opens-nothing
paths: ["apps/erp/public/service-worker.js","apps/mes/public/service-worker.js"]
triggers: ["notificationclick","clients.matchAll","openWindow"]
```

**Context:** `push-worker.js` handled `notificationclick` with `clients.matchAll({ type: "window", includeUncontrolled: true })`, then `focus()` and `navigate()` on the first Carbon tab (2026-10-09).

**Problem:** `WindowClient.navigate()` rejects for a tab the worker does not control: a tab opened before the worker was installed, or a hard-reloaded one. The rejection ended the click handler, so the click opened nothing. No error reached the page.

**Rule:** Call `matchAll({ type: "window" })` without `includeUncontrolled` when you will call `navigate()`. Focus first, because the click allows focus for a short time only. Wrap the focus and the navigation in `try`, and call `clients.openWindow()` when either fails or no tab exists.

**Applies to:** `apps/erp/public/service-worker.js` (was `push-worker.js`); any service worker that navigates a client.

## A server-only value in a route component, or a dropped side-effect import, fails only the production build

```scope
id: a-server-only-value-in-a-route-component-or-a-dropped-side-e
paths: []
triggers: [".service\"","\"sideEffects\"","LOCK_PERIOD_TASK_NAME"]
```

**Context:** The service-function migration (2026-10-16) made every `<module>.service.ts` server-only: it may import server-only packages (`@carbon/auth/auth.server`, `@carbon/ee/*.server`, `@carbon/jobs`).

**Problem:** Two mistakes passed typecheck, the tests and the dev server, and broke only `react-router build`:

1. A route component used a value from a `.service.ts` (`LOCK_PERIOD_TASK_NAME` in a close-period component). React Router strips a route's loader and action from the client build, not its component, so the service file and its server-only imports entered the browser graph and the build failed.
2. A bare side-effect import (`import "./modules/carbon.server"`, `import "./zod.client"`) in a package whose `package.json` sets `"sideEffects": false`, or does not list the file. The production bundler dropped the import, so every `carbon()` call threw in production and `z.config({ jitless: true })` never ran. The dev server does not tree-shake, so nothing showed it locally.

**Rule:** A value the browser uses goes in `<module>.utils.ts` (or `models.ts` / `types.ts`), never in `.service.ts` or `.server.ts`. A file imported only for its side effects is listed in its package's `sideEffects` array. The `no-server-code-in-client` check (ERP components, hooks, `ui/`, client-safe module files and the browser half of routes) and the `side-effect-import-declared` check enforce both. Run `pnpm --filter erp build` before you call a change to imports or module files done.

**Applies to:** ERP and MES modules and routes; every `package.json` that sets `sideEffects`.

## Changing a precached file without bumping the cache name changes nothing

```scope
id: changing-a-precached-file-without-bumping-the-cache-name-cha
paths: ["apps/*/public/offline.html","apps/*/public/service-worker.js"]
triggers: ["OFFLINE_CACHE","SHELL_CACHE"]
```

**Context:** `offline.html` was edited several times (the game, the text wrapping), and each time existing browsers kept showing the old page (2026-10-22).

**Problem:** A worker saves the file only when it installs, and it reinstalls only when `service-worker.js` itself changes. Editing `offline.html` alone leaves every browser that already has the worker on the old copy, and the self-heal only fills a missing entry, it never replaces one.

**Rule:** Every change to `offline.html` bumps the offline cache in both workers (ERP `OFFLINE_CACHE`, MES `SHELL_CACHE`). `offline-page.test.ts` in each app pins the page's hash to the cache name, so a change that skips the bump fails.

**Applies to:** `apps/{erp,mes}/public/offline.html` and `service-worker.js`.

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

**Context:** The ERP and MES service workers were registered from `entry.client.tsx` with `window.addEventListener("load", register)`, the pattern most guides show (2026-10-22).

**Problem:** On the dev server React Router imports `entry.client` late: by the time the module runs, the page has already fired `load` (`document.readyState === "complete"`), so the listener never ran and no worker was registered. The offline page never appeared and nothing logged an error.

**Rule:** Register immediately when `document.readyState === "complete"`, and on `load` otherwise. Check `navigator.serviceWorker.getRegistrations()` in the browser after any change to how a worker is registered.

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

**Context:** API and MCP input schemas are generated from the form validators, whose `.default(0)` was written for a form that submits every field. The dispatcher applied none of them.

**Problem:** A caller reading `taxPercent: default 0` leaves the field out and expects 0. On a read typed from a validator's output that crashed (`state: {}` on a pivot); on an update, filling it would overwrite a stored value the caller never mentioned. And a default that looked safe to fill was not: list reads published `limit: default 100`, but the service pages only when it is handed a limit, so filling it would have cut every unpaged list read to 100 rows.

**Rule:** A default is filled or it is not published (`defaultsPolicy` / `publishDefaults`): always for a read, a create or an action, on create only for an upsert, never for an update. Before publishing or filling one, read what the service does when the field is absent, and compare with the column's own database default.

**Applies to:** `scripts/lib/service-metadata.ts`, `apps/erp/app/routes/api+/v1+/lib/dispatch.server.ts`, any validator default that reaches an API schema.

## A realtime subscription to a table that is not published fails silently

```scope
id: a-realtime-subscription-to-a-table-that-is-not-published-fai
paths: ["packages/query/src/useRealtime.tsx"]
triggers: ["postgres_changes","supabase_realtime","useRealtime","useChangedRows"]
```

**Context:** The ERP job page did not show an operation completed in the MES until a reload. It subscribed with `postgres_changes` to `jobOperationStep` and `jobOperationStepRecord`, which were never in the `supabase_realtime` publication, and it had no subscription to `jobOperation` or `job` at all.

**Problem:** Realtime accepts a `postgres_changes` subscription for any table name. For an unpublished table it joins, delivers nothing and reports nothing. The code looked wired and typecheck, lint and tests were all green.

**Rule:** Realtime goes through broadcast topics (`@carbon/query`). Declare a route's tables in `handle.realtime`; the table type is derived from `event-system/attachments.ts`, so a table with no broadcast handler does not compile, and `no-postgres-changes` fails the old API. Verify a "live" page by changing the row while the page is open, not by reading the subscription code.

**Applies to:** `apps/*/app/routes/**` `handle.realtime`, `useRealtime`, `useChangedRows`, `.claude/rules/realtime-system.md`.

## Two hooks that open the same Realtime topic close each other's channel

```scope
id: two-hooks-that-open-the-same-realtime-topic-close-each-other
paths: ["packages/query/src/useRealtime.tsx"]
triggers: ["carbon.channel(","useRealtimeChannel","removeChannel"]
```

**Context:** The shell, the live lists and individual components each called `carbon.channel(topic)` for `company:<id>:<table>`.

**Problem:** `RealtimeClient.channel()` returns the EXISTING channel when the topic is already open. Two hooks then hold one channel object, and the first to unmount calls `removeChannel` and silences the other. A customers page that declared `customer` while the customer list also followed it would have lost one of them at random.

**Rule:** One owner per topic. Listeners register in the registry in `packages/query/src/useRealtime.tsx` (`useTopic`, `useTableChanges`) and `RouteRealtime` owns the channels. Do not call `carbon.channel` or `useRealtimeChannel` for a broadcast topic directly.

**Applies to:** `packages/query/src/useRealtime.tsx`, any new realtime listener.

## Work a request does not await is frozen with the instance on Vercel

```scope
id: work-a-request-does-not-await-is-frozen-with-the-instance-on
paths: ["apps/erp/app/entry.server.tsx","apps/mes/app/entry.server.tsx","packages/lib/src/telemetry/capture.ts","packages/stripe/src/stripe.server.ts"]
triggers: ["async.background","onBackground","waitUntil"]
```

**Context:** Work-event capture (PostHog) and the GTM forward were started and not awaited, so the response would not wait for them.

**Problem:** A Vercel function instance is frozen once its response is sent. The unawaited call stopped mid-flight and finished only when the next request woke the instance, so traces showed analytics calls of 10 s and more, and on an instance that was never reused the event was lost. `request.signal` does not help either: without `supportsCancellation` it never aborts on Vercel.

**Rule:** Anything a request leaves running goes through `async.background(task, onError)` from `@carbon/utils`. Each app registers the host's `waitUntil` once with `async.onBackground` in `entry.server.tsx`, which keeps the instance up until that work settles. Never a bare unawaited promise, a `void` IIFE, or a `.then` chain.

**Applies to:** `apps/{erp,mes}/app/entry.server.tsx`, `packages/lib/src/telemetry/capture.ts`, `packages/stripe/src/stripe.server.ts`, any new fire-and-forget call.
