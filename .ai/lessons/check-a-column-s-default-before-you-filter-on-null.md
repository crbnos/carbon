---
paths: []
triggers: []
promoted: null
---
# Check a column's default before you filter on NULL

**Context:** The `queue_model_pipeline` handler first selected new models `WHERE "optimizeStatus" IS NULL`.

**Problem:** `modelUpload.optimizeStatus` is `NOT NULL DEFAULT 'Idle'`, so the filter matched no row and the handler queued nothing. The insert succeeded and nothing failed.

**Rule:** Read the column definition in the newest migration (or `\d` on the local database) before you write `IS NULL` against it. Test a new handler in a rolled-back transaction and assert the queued `net.http_request_queue` body.

**Applies to:** SQL handlers, sweepers and views that pick rows by a status column.
