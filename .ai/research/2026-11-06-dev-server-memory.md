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
- With the changes, edits cost nothing: the heap after 37 edits is the heap
  after the first 8 pages (1,262 vs 1,274 MB), against 3,347 MB at 30 edits on
  `main`. Footprint after 30 edits: 4,223 → 1,987 MB.
- The changes: two app fixes (HMR store, query timers), a Vite patch (watch
  each file once, map SSR stacks on demand), a `carbon()` plugin that drops
  browser pages that stopped reading HMR messages, rolldown thread and purge
  settings in `crbn`'s app spawn, and two smaller fixed costs (icon sources,
  Vercel preset import).
- The fixed cost (about 1.3 GB of heap after a few pages) comes from React
  Router's dev build, which evaluates all 1,700 routes (about 6,000 modules) on
  the first request. The in-flight `lazyRoutes` plugin (uncommitted, in the
  `carbon-lean-dev` worktree) removes another 330 MB on top of these changes.

## Before and after

A local bench (its own ERP dev server against the same stack and demo company each run, driven by a headless browser). Heap is `heapUsed` after
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
| + Vite patch, stalled-client plugin, rolldown env (final) | 70 / 165 | 1,274 / 2,151 | **1,261** / 1,972 | **1,262** / 1,987 (29) | **1,262** / 2,031 (37) |
| all of the first five + `lazyRoutes` (not committed) | 76 / — ² | 952 / 2,603 ² | 971 / 2,410 | 1,019 / 2,387 (29) | 1,062 / 2,398 (37) |

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

Fix: `patches/vite@8.3.3.patch` makes the runner default to Vite's
`"prepareStackTrace"` interceptor, which decodes a module's map only when a
stack is formatted. (First done as a `carbon()` plugin that set the private
`ssr._runnerOptions`; the patch replaced it.) Measured: heap after warming `/login` 1,188 → 701 MB. After
pages the gain is small (−22 MB), because React 19's dev build formats owner
stacks and Vite then caches decoded maps itself (`mod.map`). After reloads it
is large: 1,630 → 1,374 MB at 15 edits. Stack traces from the app and
`packages/*` still point at the source line (a module that throws from a known line reports
`__stack_probe__.ts:8:9`). Two things are no longer mapped: frames inside an
externalized package (Node used its `.map` file; now its `dist` line shows),
and code from a module graph a reload just dropped (Vite maps only modules
still in the runner). Vite's interceptor also replaces `Error.prepareStackTrace`
for the whole process.

A plugin has no public way in: `environments.ssr.dev.createEnvironment` would
have to build the environment with the Vite copy React Router runs, and pnpm
installs several copies of vite 8.3.3 (peer variants) that the app,
`@carbon/dev` and React Router resolve differently. The patch covers every copy
(they have the same `dist`), and a Vite upgrade fails `pnpm install` until the
patch is redone or dropped.

### Leak 3: Vite's watcher adds a listener for each transform (vitejs/vite#23940)

`ensureWatchedFile` (`packages/vite/src/node/utils.ts:785` in 8.3.3, read with
`opensrc`) calls `watcher.add()` for every transform of a file outside the root:
all of `packages/*` for an app. On macOS the bundled chokidar 3.6 registers one
more FSEvents listener for each add of a watched file. That was about 4,500
listeners per edit (36,559 `filteredListener`/`watchCallback` closures over 8
edits), and every file event is delivered to all of them.

Reported as [vitejs/vite#23940](https://github.com/vitejs/vite/issues/23940)
(open). Its two PRs (#23949, #23963) were closed by Vite's AI-contribution bot
without review. Fix: the same patch adds each file once per watcher (and again
after chokidar reports it deleted), as the issue proposes. Transforming one
out-of-root file three times makes 1 `watcher.add` call with the patch and 3
without it; `src/vite-patch.test.ts` in `@carbon/dev` checks this, and the
source-map default. (chokidar's `_closers` map is no evidence either way: it
holds one entry per path however often the path is added; the leaked closures
are FSEvents listeners in a private map.)

### Leak 4: pages that stopped reading HMR messages

After the fixes above, the last growth (about 2 MB per edit) was HMR update
messages held in a TCP socket's write buffer (`Socket._writableState` →
`kBufferedValue`). Both ends were in the browser: pages the browser keeps
connected but does not run any more (earlier pages in the back/forward cache,
or a tab frozen in the background). Vite writes every update to each such
socket; after 5 edits three of them held 18 MB, 9.6 MB and 9.6 MB unsent
(open sockets listed by unsent bytes). This was reproduced with agent-browser's headless Chrome
(earlier pages of the same tab). Whether desktop Chrome keeps such sockets open
for back/forward-cached or frozen tabs was not checked, so part of the "zero
growth per edit" result may come from the test browser.

Fix: `dropStalledHmrClients()` in `carbon()` terminates a client whose unsent
backlog is over 4 MB and has not shrunk since the previous check (every 5 s,
through the public `server.ws.clients`); a slow page that is still reading
drains between checks and is kept.
A page that wakes up finds the connection gone; Vite's client then pings the
server and reloads, which a page that missed updates needs anyway. With it,
6 `Button.tsx` edits left the heap at 1,263–1,264 MB.

### Smaller fixed costs

- `@vercel/react-router/vite` is imported at the top of each app's
  `react-router.config.ts`, but used only when `VERCEL` is set. It loads
  ts-morph and a TypeScript compiler: +30 MB of heap (boot 97 → 70 MB). Fix:
  import it inside the `VERCEL` branch (ERP, MES, Academy).
- `iconImports` kept the full source of each `react-icons` set it loaded
  (22.3 MB in 15 strings). Fix: read it on each load (a set loads again only
  when a new icon changes its version).

### What the 1.3 GB base is (after the fixes)

From the heap snapshots and a live count of Vite's module graphs:

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
  re-optimisation it holds about 1 GB; 717 MB of it was swapped out in the
  5.5 h `crbn up` ERP. Upstream: [rolldown/rolldown#11143](https://github.com/rolldown/rolldown/issues/11143)
  (mimalloc memory not released, with a Vite 8 dev server data point),
  [#10985](https://github.com/rolldown/rolldown/issues/10985) (retention since
  rolldown 1.2, `MIMALLOC_ARENA_PURGE_MULT=0` workaround) and
  [#11233](https://github.com/rolldown/rolldown/issues/11233) (optimizer memory
  scales with worker threads), all open. Measured after a forced re-bundle
  (forced re-bundle, 14-core Mac):

  | Env | rolldown region | idle after |
  |---|---|---|
  | default | 985 MB | 43 s |
  | `MIMALLOC_PURGE_DELAY=0` | 944 MB | — |
  | `MIMALLOC_ARENA_PURGE_MULT=0` | 827 MB | — |
  | purge + `ROLLDOWN_WORKER_THREADS=4` + `ROLLDOWN_MAX_BLOCKING_THREADS=4` | 586 MB | 51 s |
  | the same + `RAYON_NUM_THREADS=4` | **319 MB** | 37 s |

  `crbn` now sets the last row for the react-router dev servers it spawns
  (`packages/dev/src/services/apps.ts`), not for the assembler (its planner
  uses rayon) and not for an app's own `dev` script. They must be set before
  Node starts; the shell or a `.env` file overrides them.
- `MALLOC_SMALL` about 275 MB (libuv, lightningcss, Tailwind oxide, Lingui
  native tools).

### Not changed

- **`sourcesContent` in the SSR inline maps.** It is 46 MB of the 156 MB of code
  and is copied into each script source. Stripping it would need a wrapper
  around `DevEnvironment.fetchModule` and would remove original source from
  server debugging with `--inspect`. Not done.
- **`--max-old-space-size`.** It only moves the crash point, the leak was the
  problem. Not changed.
- **`lazyRoutes`.** Measured above; it is someone else's uncommitted work in
  `../carbon-lean-dev` (branch `perf/lean-dev-server`).

## Method

- Memory: `heapUsed` after two forced GCs over the inspector, macOS
  `footprint`, and `vmmap --summary` for native regions.
- What Vite holds: `Runtime.queryObjects` on Vite's `DevEnvironment` and
  `ModuleRunner` classes (module counts, transform code and map sizes, and
  `EvaluatedModuleNode` objects still alive).
- What keeps memory alive: heap snapshots (580 to 750 MB, too big for DevTools
  or `JSON.parse`) read with a small streaming reader that prints the shortest
  retainer path, a dominator tree with retained sizes (Cooper–Harvey–Kennedy),
  the bytes only one edge name keeps alive, and constructor diffs between two
  snapshots. Old module nodes were tagged first so the reader could find them.
- Sampling heap profiles (by package and frame), live timers by duration, and
  open sockets by unsent bytes.

The scripts are not in the repo.

Lesson from this work: a CDP client that holds `queryObjects` results keeps
those objects alive. An early probe that kept its arrays across edits showed a
full graph leaked on each edit. Every probe now uses an object group and
releases it, and the reader skips "DevTools console" handles.

## Follow-ups

- Land `lazyRoutes` (or React Router upstream lazy route discovery in dev): it
  takes the first request from ~25 s to ~9.5 s and the base heap down 330 MB.
- Drop `patches/vite@8.3.3.patch` once vitejs/vite#23940 is fixed and Vite's
  SSR runner stops defaulting to Node's source maps; drop the rolldown env once
  rolldown releases its memory.
- The other process-level singletons that pin the first graph (`initFlags` keeps
  the first provider and its callbacks; the process error handlers in
  `entry.server.tsx` keep the first closures). Small on their own now.
