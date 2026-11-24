---
paths: ["packages/jobs/src/inngest/functions/**"]
triggers: ["step.sendEvent", "step.run", "NonRetriableError"]
promoted: null
---
# Code outside an Inngest step runs again after every step

**Context:** Printing a Make kanban to a printer printed the Create card only, never Start or Complete (2026-10-28).

**Problem:** `print-job` wrote its `printJob` rows in the function body and called `step.sendEvent` per job. Each step makes Inngest invoke the function again from the top with the finished steps memoized, so the body ran again: its 30 s duplicate guard found the job the first pass had just written and threw `NonRetriableError`. Every document with more than one label (kanban cards, a receipt's serials) printed its first label only, and the run read as a "duplicate" rather than a failure.

**Rule:** In an Inngest function, every database read that decides something and every write goes inside a `step.run`; the body between steps must be safe to run again. Collect the events in the step and send them with one `step.sendEvent` after it.

**Applies to:** `packages/jobs/src/inngest/functions/**` — any function that writes outside `step.run` and then calls a `step.*` method.
