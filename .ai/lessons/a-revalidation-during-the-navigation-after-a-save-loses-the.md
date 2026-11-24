---
paths: ["packages/react/src/hooks/useRevalidator.ts"]
triggers: ["revalidate()", "shouldRevalidate", "useRevalidator"]
promoted: null
---
# A revalidation during the navigation after a save loses the save

**Context:** 186 layouts export `shouldRevalidate` and skip a GET navigation that leaves their params unchanged. Realtime calls `revalidate()` 300 ms after a broadcast.

**Problem:** A save's own broadcast arrives while its redirect is still loading. `revalidate()` during a loading navigation restarts it with `overrideNavigation: state.navigation`, and for a fetcher submission that carries no `formMethod`. The restarted navigation looks like a plain one, so each layout returned `false` and kept its data from before the save: a new quote line was missing from the quote's explorer until a reload (2026-10-05). In single fetch `defaultShouldRevalidate` is `true` for every route on every navigation, so a predicate cannot tell a forced reload from a plain one. A first fix assumed React Router's default was `false` after a redirect with no cookie; logging the predicate's arguments in the browser showed the default was `true` and the first pass did include the layout.

**Rule:** Never call React Router's `revalidate()` directly. Import `useRevalidator` from `@carbon/query`: it holds a call made while a navigation is in flight or a fetcher is submitting and runs it when the router is idle. The `no-raw-revalidator` check (`@carbon/checks`) fails an import of React Router's. Before explaining a skipped loader, log what `shouldRevalidate` received: wrap the route's `shouldRevalidate` on `window.__reactRouterDataRouter.routes` and read `formMethod`, `defaultShouldRevalidate` and both URLs for each call.

**Applies to:** `packages/react/src/hooks/useRevalidator.ts`; every `revalidate()` call (realtime, polling timers, upload callbacks); every route that exports `shouldRevalidate`.
