---
paths: []
triggers: []
promoted: null
---
# Work a request does not await is frozen with the instance on Vercel

**Context:** Work-event capture (PostHog) and the GTM forward were started and not awaited, so the response would not wait for them.

**Problem:** A Vercel function instance is frozen once its response is sent. The unawaited call stopped mid-flight and finished only when the next request woke the instance, so traces showed analytics calls of 10 s and more, and on an instance that was never reused the event was lost. `request.signal` does not help either: without `supportsCancellation` it never aborts on Vercel.

**Rule:** Anything a request leaves running goes through `async.background(task, onError)` from `@carbon/utils`. Each app registers the host's `waitUntil` once with `async.onBackground` in `entry.server.tsx`, which keeps the instance up until that work settles. Never a bare unawaited promise, a `void` IIFE, or a `.then` chain.

**Applies to:** `apps/{erp,mes}/app/entry.server.tsx`, `packages/lib/src/telemetry/capture.ts`, `packages/stripe/src/stripe.server.ts`, any new fire-and-forget call.
