---
paths: ["apps/erp/app/routes/x+/job+/$jobId.complete.tsx"]
triggers: ["complete_job_to_inventory", "sync_finish_job_operation", "sync_update_job_operation_quantities"]
promoted: null
---
# Job-completion side effects must live in complete_job_to_inventory, not in route actions

**Context:** Service-job fulfillment (advance the linked salesOrderLine on completion) was first implemented in the ERP `$jobId.complete.tsx` action after the RPC call. In e2e it never ran: the operator finished the last operation, and `sync_update_job_operation_quantities` → `sync_finish_job_operation` (DB interceptors) called `complete_job_to_inventory` directly — the ERP route was never involved.

**Problem:** Job completion has multiple entry points — the ERP Complete button AND the interceptor cascade that auto-completes when the last operation flips to Done (fired from MES quantity recording or ERP production quantities). Any completion side effect hooked at the app layer silently misses the interceptor path.

**Rule:** Side effects that must accompany job completion (fulfillment, status propagation, posting) go INSIDE `complete_job_to_inventory` — the single choke point every path crosses. Place them before the `accountingEnabled` / zero-WIP early returns if they must run unconditionally. App-layer completion hooks are only valid for effects the SQL function cannot perform (edge-function invocation — cf. `returnAllocatedRemaindersAtJobComplete`, orchestrated in TS for exactly that reason).

**Applies to:** `complete_job_to_inventory`; `apps/erp/app/routes/x+/job+/$jobId.complete.tsx`; `sync_finish_job_operation`; any future completion-triggered behavior (rev-rec POC recognition events).
