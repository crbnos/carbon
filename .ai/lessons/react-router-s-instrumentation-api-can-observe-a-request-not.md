---
paths: []
triggers: []
promoted: null
---
# React Router's instrumentation API can observe a request, not change it

**Context:** The request-id, access-log and request-context middlewares looked like candidates to move into `instrumentations`, to shorten the middleware chain.

**Problem:** In React Router 7.18 an instrumentation wrapper receives a read-only view: the request is `{ method, url, headers.get }` with no `signal` and no `clone()`, the context exposes only `get`, and the result carries only `statusCode` and `meta`. It cannot set a response header, open an AsyncLocalStorage scope around the handler, or read the body, which is everything those middlewares do.

**Rule:** Instrumentation is for spans and measurements. Anything that sets a header, provides context to downstream code or reads the request stays a middleware; merge middlewares into one (`requestMiddleware`) instead of moving them. A middleware's own cost is recorded by `timedMiddleware` as `carbon.middleware.<name>.ms`, not by a span, because a middleware span contains everything it calls.

**Applies to:** `packages/logger/src/middleware.server.ts`, `packages/logger/src/tracing.server.ts`, both apps' `root.tsx`.
