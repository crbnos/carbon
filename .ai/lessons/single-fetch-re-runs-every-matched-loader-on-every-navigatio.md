---
paths: []
triggers: []
promoted: null
---
# Single fetch re-runs every matched loader on every navigation

**Context:** A click on a BOM node under a part (`/x/part/:itemId/make/:makeMethodId.data`)
took 2.8 s in production. The Vercel log showed ~68 PostgREST calls for that one click; about
10 belonged to the page being opened.

**Problem:** React Router 7 single fetch passes `defaultShouldRevalidate = true` for every
GET navigation, so every reused ancestor loader re-runs unless its route exports
`shouldRevalidate`. The app shell (`x+/_layout.tsx`, ~20 queries plus an auth round-trip)
only opted out for same-pathname navigations, and the part layouts not at all. The burst is
what makes each call slow: the first concurrent wave ran ~200 ms per call, later ones 30–60 ms.

**Rule (superseded 2026-10-06, see "A layout that skips its loader is only as correct as its
skip rule"):** layouts no longer export `shouldRevalidate`; the skip was removed and slow layout
loaders are made faster instead. Data in a shell loader that does not gate
rendering is returned as a promise and read with `useResolved` (`~/hooks/useResolved`), never
awaited.

**Applies to:** every route with children under `apps/erp/app/routes/x+` and
`apps/mes/app/routes/x+` — `_layout.tsx`, `$id.tsx` with tabs, and list pages that parent a
drawer (`foo.tsx` + `foo.new.tsx`). A list loader reads the whole query string, so it passes
`search: "all"`. A loader that reads the pathname, a cookie or a header must not use the
helper.
