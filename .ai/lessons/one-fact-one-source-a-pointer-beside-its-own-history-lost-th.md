---
paths: ["packages/database/src/event-system/handlers/sync_load_work_center_operation.sql", "packages/database/src/event-system/handlers/sync_unload_work_center_operation.sql"]
triggers: ["workCenterLoad", "loadedJobOperationId"]
promoted: null
---
# One fact, one source: a pointer beside its own history lost the order of loads

**Context:** The OEE work (2026-10-13) kept the loaded operation twice: the pointer `workCenter."loadedJobOperationId"` + `"loadedAt"`, and the history table `workCenterLoad` that the same interceptors wrote.

**Problem:** The unload cleared `loadedAt` with the pointer. That timestamp was the only watermark that ordered loads: the rule "an older start never replaces a newer load" compared against it. After an unload there was nothing to compare, so a late event (a start older than the unload) loaded the operation that had been replaced, and opened a history row that overlapped its neighbours. The pointer and the history then disagreed, and the sync gave run time to the wrong operation.

**Rule:** Keep one source for a fact. When a history exists, the current value is a row of it (here the open `workCenterLoad` row), not a second column to keep in step. Order writes against the history itself: refuse a write that is older than the newest boundary (any `loadedAt` or `unloadedAt`), and back it with constraints (a CHECK that an interval does not end before it starts, a partial unique index for one open row).

**Applies to:** `workCenterLoad` and its interceptors (`sync_load_work_center_operation`, `sync_unload_work_center_operation`), and any "current pointer + history" pair (statuses with a status log, assignments with an assignment history).
