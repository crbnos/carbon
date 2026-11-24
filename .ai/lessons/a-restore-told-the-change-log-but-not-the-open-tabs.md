---
paths: []
triggers: []
promoted: null
---
# A restore told the change log but not the open tabs

**Context:** Backup restore and template revert reload a company through `wipeAndLoad` with triggers off (`session_replication_role = replica`). The live lists (items, customers, suppliers, people) are kept in the browser and updated from broadcasts; the change log (`tableChange`) is what a tab reads when it loads or reconnects.

**Problem:** With triggers off nothing was broadcast. `wipeAndLoad` wrote a reset row to the change log, but an open tab only reads the log when a broadcast tells it to, or once an hour. After a demo template was reverted and applied again, a tab's part picker held the reverted parts next to the new ones, and creating a job with a reverted part returned 404 (2026-10-06, production). The first reproductions missed it because they applied a template (triggers on), which broadcasts correctly.

**Rule:** A writer that turns triggers off does both halves itself: a null-`rowId` row per `CHANGE_LOGGED_TABLES` entry, and a null-`ids` broadcast on every `REALTIME_TABLES` topic of the company, inside the same transaction. When a stale client list is suspected, compare the ids in `window.clientCache.getQueryData(["live", companyId, name])` with the database before reading code.

**Applies to:** `packages/jobs/src/inngest/functions/tasks/company-restore.ts` (`wipeAndLoad`); any new job that sets `session_replication_role`.
