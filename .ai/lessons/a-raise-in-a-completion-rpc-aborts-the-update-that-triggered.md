---
paths: []
triggers: ["complete_job_to_inventory", "sync_finish_job_operation", "attach_event_trigger"]
promoted: null
---
# A RAISE in a completion RPC aborts the UPDATE that triggered it

**Context:** `complete_job_to_inventory` gained guards refusing a completion it could not satisfy (zero quantity, a fractional serial quantity, fewer receivable units than completed).

**Problem:** That function is not only called from the ERP complete route — `sync_finish_job_operation` calls it from a BEFORE trigger interceptor, and `dispatch_event_interceptors` has no `EXCEPTION` block. So a serial item with no serial sequence (whose job keeps one whole-quantity seed entity, because `assign-serial-numbers` returns early with no sequence) made the raise propagate out and abort the `jobOperation` UPDATE itself: the operator could not mark the operation Done at all.

**Rule:** Before adding a `RAISE` to a SQL function, grep for trigger interceptors that call it. A refusal that is a useful error on a request path is a hard block on a trigger path. Either handle the case rather than refusing it, or make the trigger caller skip the call.

**Applies to:** `complete_job_to_inventory`, `sync_finish_job_operation`, and any function registered through `attach_event_trigger`.
