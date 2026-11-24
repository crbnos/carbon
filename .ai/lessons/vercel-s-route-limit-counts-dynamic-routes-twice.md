---
paths: []
triggers: []
promoted: null
---
# Vercel's route limit counts dynamic routes twice

**Context:** The ERP deploy failed with "Maximum number of routes (rewrites, redirects, etc)
exceeded. Max is 2048, received 2074" after a merge added 151 route files. The local build
passes, because the count happens in `@vercel/remix-builder` on Vercel's side.

**Problem:** The builder adds two routes for each addressable dynamic route (the page and its
`.data`) and none for a static one. 1029 dynamic routes cost 2058, and 16 more are fixed
overhead, so the ceiling was about 1016 dynamic routes. Merging route files would only have
delayed the failure.

**Rule:** All of those routes point at one function that matches on the request URL, so the
ERP's preset removes them from `routeIdToServerBundleId` and they reach the function through the
builder's `/(.*)` fallback. Do not remove that step to "tidy" `react-router.config.ts`. A route
that exports `config` gets its own bundle and keeps its routes, and each one still counts.

**Applies to:** `apps/erp/react-router.config.ts`, and MES or another app if it nears 1016
dynamic routes.
