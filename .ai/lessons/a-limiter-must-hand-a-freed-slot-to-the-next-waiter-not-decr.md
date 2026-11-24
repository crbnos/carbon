---
paths: ["packages/utils/src/async.ts"]
triggers: ["async.limit", "semaphore", "Semaphore"]
promoted: null
---
# A limiter must hand a freed slot to the next waiter, not decrement and let it race

**Context:** `async.limit` first released a slot by decrementing the active count and waking the first queued call.

**Problem:** The woken call resumes a microtask later. A call made in between saw a free slot, took it, and the woken call then incremented too: more than `concurrency` ran at once, and under steady load a queued call could be overtaken indefinitely.

**Rule:** When a slot frees and a call is queued, pass the slot to it directly and leave the count unchanged; decrement only when the queue is empty. A queued call never increments. Test it by starting a new call in the same tick a running one finishes and asserting the queued one runs first.

**Applies to:** `packages/utils/src/async.ts` (`limit`), any hand-written semaphore.
