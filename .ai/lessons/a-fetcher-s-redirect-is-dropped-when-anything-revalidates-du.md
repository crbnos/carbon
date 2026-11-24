---
paths: []
triggers: []
promoted: null
---
# A fetcher's redirect is dropped when anything revalidates during the action

**Context:** MES "Complete Batch" posts through a `useFetcher` to an action that runs for several seconds and ends in `redirect(path.to.operations)`. The operation page also subscribes to realtime changes on `jobOperation`/`job` and calls `revalidate()` on each.

**Problem:** The completion's own writes fired the realtime `revalidate()` mid-action. React Router (`handleFetcherAction`) ignores a fetcher's redirect when `pendingNavigationLoadId > originatingLoadId` — any navigation or revalidation started after the submit wins. The redirect was silently discarded, the fetcher went idle, and the page sat on stale loader data from the mid-run revalidation (the batch still "Completing", button reading "Retry Completion") even though the work had landed.

**Rule:** Realtime listeners must not revalidate while a fetcher on the page is submitting — use `useRealtimeRevalidator()` (`apps/mes/app/hooks/useRealtime.tsx`), never a bare `useRevalidator().revalidate()` in a realtime callback. Skipping loses nothing: the router revalidates after every action, which is why `revalidate()` already no-ops during a navigation submission. The same race also reached single-operation completion: finishing a job's last operation completes the job, the job UPDATE revalidated the operation loader mid-action, its floor gate redirected with "This operation's job has not been released to the floor", and the operator saw that error instead of "Operation finished successfully" (reproduced 2 of 10 runs before the guard, 0 of 8 after). Batch completion additionally returns `data({ completed: true })` and navigates client-side.

**Applies to:** every realtime- or interval-driven `revalidate()` on a page that submits fetchers — MES `useOperation`, `AssemblyView`, `useRealtime`.
