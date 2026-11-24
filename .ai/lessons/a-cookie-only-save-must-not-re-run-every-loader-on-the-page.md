---
paths: ["packages/utils/src/revalidate.ts", "apps/*/app/root.tsx", "apps/*/app/routes/x+/_layout.tsx", "apps/erp/app/routes/x+/workflow+/$id.tsx"]
triggers: ["ROOT_ACTION_SAVE", "rootShouldRevalidate", "deferRootActionPost", "defaultShouldRevalidate", "skipPaths"]
promoted: null
---
# A cookie-only save must not re-run every loader on the page

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
