---
paths: ["packages/jobs/src/inngest/functions/tasks/assembler-client.ts"]
triggers: ["runAssemblerJob", "step.waitForEvent", "?wait="]
promoted: null
---
# A long poll inside an Inngest step holds a concurrency slot for its whole wait

**Context:** `runAssemblerJob` polled the assembler with `GET /v1/jobs/{id}?wait=25` inside a `step.run`.

**Problem:** Inngest counts an executing step against its function's concurrency key. Each poll held a slot of the shared assembler key for up to 35 seconds, so a burst of uploads filled the key with waits, not work.

**Rule:** Inside a step, make the request short. Wait between requests with `step.waitForEvent` or `step.sleep`, which hold no slot. Treat a 5xx answer as "unreachable", not as a lost job.

**Applies to:** every Inngest function that polls an external service.
