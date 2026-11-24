---
paths: []
triggers: []
promoted: null
---
# State seeded from loaded data is a copy that nothing updates

**Context:** A route's components stay mounted when only its params change, and loaded data changes under a mounted component constantly: a save's revalidation, a realtime reload, a layout that reloads after its page has mounted.

**Problem:** `useState(valueFromLoaderData)` reads the value once. Two bugs came from it (2026-10-06). The quote summary summed its totals from lines copied into state at mount, so a deleted line stayed in the subtotal until a reload. And a notes editor seeded from record A stayed mounted on record B: B showed A's notes, and the first keystroke saved A's text into B. An audit of 467 seeded `useState` calls found 17 confirmed cases. Reloading every layout on every navigation had hidden most of the first kind, not fixed it.

**Rule:** Do not copy loaded data into state. A value computed from the data is computed during render (`useMemo`). The user's choices over the data are the only state, combined with the current data during render (`selectQuoteLines`). A draft the user edits is fine as state because the page it lives in remounts for another record: every route under `/x` renders `RecordOutlet` (`@carbon/react`), never a plain `<Outlet>`. Do not write an effect that copies the data into state again. Checks: `no-bare-outlet` and `no-state-copy-of-loader-data` (`@carbon/checks`; the second sees only a hook result used by name in the same file, not a copy seeded from a prop).

**Applies to:** every component that reads `useLoaderData`, `useRouteData` or props that come from them; every route with a param in its path.
