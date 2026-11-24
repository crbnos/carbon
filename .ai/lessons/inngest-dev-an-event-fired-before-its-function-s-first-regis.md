---
paths: []
triggers: []
promoted: null
---
# Inngest dev: an event fired before its function's first registration wedges the run

**Context:** Adding a new Inngest function and firing its event from a route during local development.

**Problem:** If the event fires before the dev server has registered the new function, the run sits "Running" forever — and per-key `concurrency` then queues every retry behind the wedged run, so nothing ever executes. The dev server's state is in-memory.

**Rule:** After adding or renaming an Inngest function, reload the Inngest dev server (`crbn reload inngest`) before firing its event; if a run is already wedged, cancel it and re-fire. Check `http://localhost:<PORT_INNGEST>/runs` when a background job seems to do nothing.

**Applies to:** `packages/jobs/src/inngest/`, local dev via `crbn up`.
