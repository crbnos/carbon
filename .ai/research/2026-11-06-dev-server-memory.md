# ERP dev server memory (2026-11-06)

Why the ERP dev server (`react-router dev`, Vite 8.3.3, React Router 7.18.4,
Node 24.22.1) grows to 4 GB, what holds the memory, and what changed.

## Summary

- The heavy process is the ERP dev server. A `crbn up` session measured 4.0 GB
  physical footprint after 5.5 h; MES was 1.6 GB.
- Most of the growth was a leak during HMR: every server edit makes Vite drop
  and re-run the whole SSR module graph (a "program reload"), and two pieces of
  app code kept the old graph alive. Heap grew about 66 MB for each edit, and
  the server died after about 30 edits.
- Five changes, all dev-only or SSR-only, take the heap after 30 edits from
  3,347 MB to 1,385 MB and the footprint from 4,223 MB to 2,148 MB. The growth
  for each edit goes from about 66 MB to about 1.5 MB.
- The fixed cost (about 1.3 GB of heap after a few pages) comes from React
  Router's dev build, which evaluates all 1,700 routes (about 6,000 modules) on
  the first request. The in-flight `lazyRoutes` plugin (uncommitted, in the
  `carbon-lean-dev` worktree) removes another 330 MB on top of these changes.

## Before and after

`bench.mjs`, same stack and same demo company each run. Heap is `heapUsed` after
two forced full GCs. fp is the macOS physical footprint (`footprint`). The HMR
phase edits 4 files in rotation (a service, two components and
`packages/react/src/Button.tsx`), 1 edit about every 8 s, and reloads one of the
8 pages after every 4 edits. All numbers are MB.

| Run (cumulative) | boot heap / fp | 8 pages heap / fp | ~15 edits heap / fp | ~30 edits heap / fp | end |
|---|---|---|---|---|---|
| `main` | 97 / 249 | 1,355 / 2,421 | 2,357 / 3,191 | 3,347 / 4,223 | server died |
| + HMR store fix | 97 / 238 | 1,356 / 2,206 | 1,620 / 2,466 | 1,706 / 2,592 (29) | 1,906 / 2,800 (36 edits) |
| + `gcTime` fix | 97 / 229 | 1,352 / 2,390 | 1,630 / 2,406 | 1,666 / 2,457 (31) | 1,696 / 2,509 (38) |
| + lazy source maps | 97 / 212 | 1,330 / 2,392 | 1,374 / 2,162 | 1,388 / 2,139 (25) | — ¹ |
| + icon cache, preset import (all) | **70** / 228 | **1,284** / 2,301 | **1,344** / 2,196 | **1,385** / 2,148 | 1,413 / 2,221 (37) |
| all + `lazyRoutes` (not committed) | 76 / — ² | 952 / 2,603 ² | 971 / 2,410 | 1,019 / 2,387 (29) | 1,062 / 2,398 (37) |

¹ The last page load of that run timed out in the headless browser (the server
answered it in under 1 s), so nothing rendered after the final reload. Not
comparable. The full "all" run had 0 failed loads.
² That run re-bundled the dependencies at boot (the config hash changed), which
leaves about 1 GB in rolldown's native heap. See "Native memory".

First request (React Router imports every route): 24–29 s on every run, 9.5 s
with `lazyRoutes`.

## What holds the memory

### Leak 1: `__hmrStore` holds a build's route tree (317 MB per held graph)

`CarbonProvider` (`packages/auth/src/lib/supabase/provider.tsx`) called
`setCarbonHmrStore(store.current)` during render, also on the server. The
module-level `__hmrStore` in `packages/react/src/CarbonContext.tsx` then held
the last SSR request's store. The store's closures (`setAuthToken`, then the
render's `refresh`/`submit`/`deleteFetcher` fetchers, then React Router's
`manifest` and `routeModules`) reach every route module of that build.

Heap snapshot after 1 reload, dominator tree: 317.5 MB retained by one context,
on this path:

```
global.__carbonFlags > onWarning (entry.server.tsx, first graph) > its imports
  > @carbon/react CarbonContext (old) > __hmrStore > setState > state
  > setAuthToken > ... > deleteFetcher > manifest > routeModules > every route
```

Cutting the `__hmrStore` edges frees 317.5 MB (1.15 M objects). Cutting
`onWarning` frees almost nothing: old module scopes are pinned by several
process-level singletons (`initFlags`'s provider, the process error handlers in
`entry.server.tsx`), and on their own those hold little.

This is also a production problem: on the server, `useCarbon()` falls back to
`__hmrStore` when it has no context, so a component rendered outside the
provider would get the previous request's Supabase client and access token.

Fix: record the HMR store only in the browser (`isBrowser`).

### Leak 2: 30-minute query timers hold each server render

`root.tsx` makes a new `QueryClient` per render on the server. `loaderQuery()`
(`packages/query/src/cache.ts`, used by `useLoaderQuery`) set
`gcTime: 30 min`. A query used during SSR is inactive, so TanStack Query starts
a 30-minute GC timer for it, which keeps the render's `QueryClient`, closures
and module scope alive. The snapshot showed a `TimersList` at
`timerListMap[1800000]` retaining 152.7 MB, and the snapshot diff 2,660 more old
module scripts (+75 MB) over 8 edits.

In production this holds every SSR render that uses `useLoaderQuery` for 30 min.

Fix: `gcTime: Infinity` on the server (TanStack's own server default, which
schedules no timer). Test in `cache.test.ts` (fails with `expected 1800000 to
be Infinity` without the fix).

### Node's source-map cache (~490 MB at first request, ~250 MB after reloads)

Vite 8's SSR module runner defaults to `sourcemapInterceptor: "node"` on any
Node with `process.setSourceMapsEnabled`. Node then parses and keeps the inline
source map of every evaluated module (`maybeCacheGeneratedSourceMap`, 264 MB in
the sampling profile), and reads the `.map` of every externalized package.
Its cache keeps `sourceMapURL` as sliced strings that pin whole old script
sources after each reload.

Fix: `lazySourceMaps()` in `@carbon/dev/vite` sets the runner to Vite's
`"prepareStackTrace"` interceptor, which decodes a module's map only when a
stack is formatted. Measured: heap after warming `/login` 1,188 → 701 MB. After
pages the gain is small (−22 MB), because React 19's dev build formats owner
stacks and Vite then caches decoded maps itself (`mod.map`). After reloads it
is large: 1,630 → 1,374 MB at 15 edits. Stack traces still point at the source
line (`stack-probe.mjs`: `__stack_probe__.ts:8:9`).

There is no public way in: `environments.ssr.dev.createEnvironment` would have
to build the environment with the Vite copy React Router runs. pnpm installs
three copies of vite 8.3.3 (peer variants), and the app, `@carbon/dev` and
React Router each resolve a different one. The plugin sets
`ssr._runnerOptions` before the runner is created (on the first request), and
does nothing if that field is missing.

### Smaller fixed costs

- `@vercel/react-router/vite` is imported at the top of each app's
  `react-router.config.ts`, but used only when `VERCEL` is set. It loads
  ts-morph and a TypeScript compiler: +30 MB of heap (boot 97 → 70 MB). Fix:
  import it inside the `VERCEL` branch (ERP, MES, Academy).
- `iconImports` kept the full source of each `react-icons` set it loaded
  (22.3 MB in 15 strings). Fix: read it on each load (a set loads again only
  when a new icon changes its version).

### What the 1.3 GB base is (after the fixes)

From the heap snapshots and the Vite census (`census.mjs`):

| Holder | Size |
|---|---|
| Evaluated module code (V8 script source, one copy per module) | ~240 MB per graph |
| SSR module graph transform results: 5,960 modules, 156 MB of code (with the inline base64 map), plus map objects (21 MB mappings, 46 MB `sourcesContent`) | ~220 MB |
| The app's own module objects, closures and data (zod schemas ~45 MB, Tailwind compiler ~50 MB, ...) | rest |
| A second SSR environment (React Router's child compiler) | 2,588 module nodes, no transforms |

All of this scales with the number of modules React Router evaluates up front,
which is why `lazyRoutes` is the next big step.

### Native memory (outside the V8 heap)

`vmmap --summary` of the bench server:

- `Memory Tag 255` is the V8 heap.
- `IOAccelerator` is rolldown's Rust heap (mimalloc), not GPU memory: a script
  that only runs `rolldown` transforms shows the same region. After a dependency
  re-optimisation it holds about 1 GB (1.0 GB default, 944 MB with
  `MIMALLOC_PURGE_DELAY=0`, so allocator purging does not release it). 717 MB of
  it was swapped out in the 5.5 h `crbn up` ERP. Not fixable from the app;
  restart the dev server after a re-optimisation if the footprint matters.
- `MALLOC_SMALL` about 275 MB (libuv, lightningcss, Tailwind oxide, Lingui
  native tools).

### Not changed

- **chokidar listeners.** Vite's bundled chokidar adds an fsevents listener each
  time `ensureWatchedFile` re-adds a file outside the root after a program
  reload (36,559 closures over 8 edits, about 0.5 MB per edit). Upstream Vite.
- **`sourcesContent` in the SSR inline maps.** It is 46 MB of the 156 MB of code
  and is copied into each script source. Stripping it would need a wrapper
  around `DevEnvironment.fetchModule` and would remove original source from
  server debugging with `--inspect`. Not done.
- **`--max-old-space-size`.** It only moves the crash point, the leak was the
  problem. Not changed.
- **`lazyRoutes`.** Measured above; it is someone else's uncommitted work in
  `../carbon-lean-dev` (branch `perf/lean-dev-server`).

## Method

Scripts in `.ai/runs/2026-11-06-dev-server-memory/`:

- `bench.mjs <label> [--hmr-minutes N] [--sampling] [--census]`: starts its own
  ERP dev server on port 54690 with `--inspect` against the stack in
  `.env.local` (`DOMAIN=localhost` so the session cookie works on
  `127.0.0.1`), logs in through agent-browser with `DEV_BYPASS_EMAIL`, loads 8
  pages, then edits files for N minutes. It restores the edited files on any exit.
- `census.mjs <port>`: every Vite `DevEnvironment` (modules, transform code,
  map sizes) and SSR `ModuleRunner` (evaluated modules), plus the number of
  `EvaluatedModuleNode` objects alive, through `Runtime.queryObjects`.
- `mark-old-modules.mjs`, `heap-retainers.mjs`, `heap-diff.mjs`: tag orphaned
  module nodes, then read snapshots too big for DevTools or `JSON.parse` (580 to
  750 MB, 6–7 M nodes). The reader prints shortest retainer paths, a dominator
  tree with retained sizes (Cooper–Harvey–Kennedy), what an edge name retains
  (`CUT=`), and constructor diffs between two snapshots.
- `timers.mjs`, `stack-probe.mjs`, `hmr-probe.mjs`, `mimalloc-ab.sh`,
  `summarize.mjs` (sampling heap profile by package and frame).
- `out/*.json`: the rows of each run in the table.

Lesson from this work: a CDP client that holds `queryObjects` results keeps
those objects alive. An early probe that kept its arrays across edits showed a
full graph leaked on each edit. Every probe now uses an object group and
releases it, and the reader skips "DevTools console" handles.

## Follow-ups

- Land `lazyRoutes` (or React Router upstream lazy route discovery in dev): it
  takes the first request from ~25 s to ~9.5 s and the base heap down 330 MB.
- Report the chokidar listener growth and the rolldown native memory after
  re-optimisation upstream.
- The other process-level singletons that pin the first graph (`initFlags` keeps
  the first provider and its callbacks; the process error handlers in
  `entry.server.tsx` keep the first closures). Small on their own now.
