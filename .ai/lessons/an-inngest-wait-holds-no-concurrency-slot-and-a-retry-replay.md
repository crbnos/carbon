---
paths: ["packages/jobs/src/inngest/functions/tasks/assembler-client.ts"]
triggers: ["step.waitForEvent", "step.sleep", "step.invoke", "runAssemblerJob"]
promoted: null
---
# An Inngest wait holds no concurrency slot, and a retry replays memoized steps

**Context:** `runAssemblerJob` (`packages/jobs/src/inngest/functions/tasks/assembler-client.ts`) used to poll the assembler inside one `step.run` and throw when its budget ran out.

**Problem:** Two assumptions were wrong. A comment said a waiting run holds a slot of the function's `concurrency`; `step.waitForEvent`, `step.sleep` and `step.invoke` hold none. And a throw outside a step does not redo the work: the retry replays every memoized step from its stored output, so the same check throws again with the same input.

**Rule:** Wait with `step.waitForEvent` in slices, and poll once per slice in its own step. To retry the external work, do it in a new step (a resubmit with a new step id), never by throwing. Charge an action's time budget from when the service starts it, not from the submit.

**Applies to:** any Inngest function that waits on an external service.
