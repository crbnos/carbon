---
paths: ["packages/react/src/PrefetchLink.tsx", "packages/utils/src/prefetch.ts"]
triggers: ["prefetch=", "PrefetchPageLinks", "prefetchCacheMiddleware", "Sec-Purpose"]
promoted: null
---
# A prefetch the browser cannot reuse makes the click slower

**Context:** Links prefetched their page's data on hover, then (2026-10-02) on press, to give the click a head start.

**Problem:** Single-fetch `.data` responses carry `cache-control: max-age=0, must-revalidate` and no validator, so the browser never serves the click from the prefetched response: both requests reach the server. Chrome also holds a second request for a URL until the first one's response arrives (its HTTP cache admits one writer per URL). The click's request therefore waited behind the prefetch: 781 ms against 518 ms median click-to-page in production, and two same-URL `fetch` calls took 572 / 923 ms where two `cache: "no-store"` ones took 615 / 585 ms.

**Rule:** A prefetch only helps if the browser may reuse its response. Give a prefetch response (`Sec-Purpose: prefetch`) a short `private` lifetime and leave every other response uncached; `prefetchCacheMiddleware` (`@carbon/utils`) does it in each app's root `middleware`, the fix React Router points to (remix-run/react-router#13255). Measure a prefetch by click-to-page time, not by whether the request was sent. A first fix removed the prefetch instead (`6e3bdf7bc6`); it worked but threw away the head start.

**Applies to:** `packages/react/src/PrefetchLink.tsx`; `packages/utils/src/prefetch.ts`; any `<Link prefetch>` or `PrefetchPageLinks`; a revalidation started while a navigation to the same URL is loading.
