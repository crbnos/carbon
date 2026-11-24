---
paths: []
triggers: []
promoted: null
---
# The local Inngest dev server (v1.19.4) can't handle `debounce` — it errors on every debounce item

**Context:** The push-based event-queue drainer (`packages/jobs/src/inngest/functions/events/queue.ts`) was configured with `debounce: { period: "2s", timeout: "10s" }` to coalesce bursts of `carbon/event-queue.process` wake events into one run.

**Problem:** The Dockerized dev server (`inngest/inngest:v1.19.4`, run by `crbn up`) logs `error unmarshalling debounce item: json: cannot unmarshal array into Go struct field DebounceItem.e.data of type map[string]interface {}` on every debounced event, fails to coalesce (a 20-write burst produced 21 runs, not ~1), and spams the error each time the function is triggered (including every pg_cron sweeper tick). Fails open — events still process, queue still drains, nothing is lost — but the optimization is absent in dev and the logs are noisy. Inngest Cloud honors debounce; the dev server does not.

**Rule:** Don't rely on `debounce` for Carbon Inngest functions validated against the local dev server — it's broken there. For the event queue the coalescing was moved upstream: `dispatch_event_batch()` wakes at most once per transaction (txn-local GUC `carbon.event_wake_sent`), so the important bulk case (a CSV import = one transaction) is already one wake; `concurrency: 1` + loop-until-empty drain absorbs the rest (extra runs from many separate transactions are cheap no-ops that read an empty queue). If you must coalesce many *separate* transactions in a burst, do it at the DB/application layer, not with `debounce`. Verify any flow-control choice by watching `docker logs <inngest container>` for `error handling queue item` during a burst, not just by trusting the config.

**Applies to:** `packages/jobs/src/inngest/functions/events/queue.ts`; any new Inngest function reaching for `debounce`/flow-control that will be exercised in local dev.
