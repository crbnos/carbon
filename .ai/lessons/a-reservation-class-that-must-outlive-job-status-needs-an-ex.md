---
paths: []
triggers: []
promoted: null
---
# A reservation class that must outlive job status needs an explicit escape in EVERY snapshot filter

**Context:** Batch release schedules a Released operation batch as one coalesced `capacityReservation` anchored (for the NOT NULL `jobId`/`operationId`) on an arbitrary member — whose job may legitimately still be `Draft` (membership handoff pulls members ahead of their jobs).

**Problem:** `getLiveReservations` quietly filters `j."status" IN capacityHoldingJobStatuses` at the END of the query builder — separate from the `excludeJobIds` filter that had already been made batch-aware. The batch row vanished from every snapshot whenever its anchor job was unreleased: the machine looked free and every other job over-booked straight through the batch window.

**Rule:** When a reservation (or any capacity-holding row) must survive independently of its anchor row's status, grep EVERY filter in the read path — not just the one you were pointed at — and give each an explicit escape (`OR "jobOperationBatchId" IS NOT NULL`). A snapshot read with two filters a hundred lines apart is two bugs, not one.

**Applies to:** `packages/ee/src/planning/scheduling/master-data-provider.ts` `getLiveReservations`, any future scenario/what-if reservation reads, and generally any row whose lifecycle is owned by a different entity than its FK anchor.
