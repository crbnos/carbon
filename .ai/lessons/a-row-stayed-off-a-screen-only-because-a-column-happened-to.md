---
paths: []
triggers: ["get_active_job_operations_by_location", "get_batchable_operations", "normalizeOperationSourceIds", "assertEligible"]
promoted: null
---
# A row stayed off a screen only because a column happened to be null

**Context:** The MES Work Centers board, the ERP Priority board and the API read `get_active_job_operations_by_location`. Both boards group operations into work-center columns.

**Problem:** An Outside Processing operation showed up on the MES board for an operator to start (2026-10-05). The function never filtered on `operationType`; subcontracted operations stayed off the boards only because they usually have no work center, so they had no column. The work center came back two ways. The operation forms hide the Work Center field for Outside Processing, and a hidden field is omitted from the submit, not cleared, so an update left the work center from the operation's earlier in-house type. Batching was the second way: `get_batchable_operations` offered outside operations, and releasing a batch writes the batch's work center onto every member.

**Rule:** Filter on the fact that decides whether a row belongs, never on a column that only usually agrees with it. When a type makes a field meaningless, clear the field in the one function every writer goes through (`normalizeOperationSourceIds`), because hiding the input does not clear it. Hiding a row from a list is not a gate: refuse it in the routes that open and start it too.

**Applies to:** `get_active_job_operations_by_location`; `get_batchable_operations` and the `batch-operations` `assertEligible`; the MES operation, start and event routes; any form that hides a field by type; any list whose visibility rests on a NULL.
