---
paths: []
triggers: []
promoted: null
---
# A fetcher's error goes to the boundary above the component that owns it

**Context:** `CarbonProvider` (`@carbon/auth`, rendered by each app's `x+/_layout`) refreshes the session from a one-minute timer with `useFetcher().submit` to `/refresh-session`. In a background tab the POST failed with `TypeError: Failed to fetch` (the laptop asleep, the connection dropped), and the whole app was replaced by the root "Something broke on our end" screen.

**Problem:** React Router sends a fetcher's error to `findNearestBoundary(state.matches, routeId)`, where `routeId` is the route that RENDERED the fetcher, not the route the request was sent to. `refresh-session.tsx` exports an `ErrorBoundary` that never runs for this; the shell layout has none, so the root took it. A fetch that gets no response is not a `Response`, so the boundary showed it as a 500.

**Rule:** A request a timer or event sends on its own (not one the user started) must not be able to fail into a boundary: skip it while `navigator.onLine` is false and retry on `online`. Both error boundaries treat `isNetworkError` as a lost connection and revalidate when the connection or the tab comes back; a successful revalidation clears `state.errors`.

**Applies to:** every `useFetcher` used from a layout or provider, every background timer that submits or loads, `packages/react/src/ErrorBoundary/`.
