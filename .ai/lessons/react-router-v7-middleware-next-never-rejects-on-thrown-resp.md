---
paths: ["packages/logger/src/middleware.server.ts", "packages/auth/src/middleware/*.ts"]
triggers: ["await next()", "clientMiddleware", "requestIdMiddleware"]
promoted: null
---
# React Router v7 middleware `next()` never rejects on thrown Responses/errors

**Context:** Writing `requestIdMiddleware` (`@carbon/logger`) that sets an `x-request-id` header on the response after `await next()`, and worrying that thrown redirects/`data()` from loaders/actions would skip the header.

**Problem:** It is easy to assume `next()` propagates the thrown redirect/error (route handlers DO `throw redirect(...)`), which would mean post-`next()` response mutation is skipped on those paths. That assumption is wrong and leads to defensive try/catch that isn't needed.

**Rule:** In RR v7 middleware (`callRouteMiddleware`, react-router dist), `next()` wraps the downstream chain in try/catch and **resolves** with `errorHandler(error)`'s Response — it only rejects if `request.signal.aborted`. So mutating headers on the resolved response after `await next()` correctly covers redirects and error (500) responses; only aborted requests skip it, which is fine (client is gone). Register the middleware first so downstream runs inside its `withContext`/ALS scope.

**Applies to:** any RR v7 `middleware`/`clientMiddleware` that reads or mutates the response after `next()`; `packages/logger/src/middleware.server.ts`, `packages/auth/src/middleware/*`.
