---
paths: []
triggers: []
promoted: null
---
# A write that changes nothing still costs a queue message, an Inngest event and a function run

**Context:** `/api/inngest` was the largest consumer on the ERP deployment (2026-10-01
traces). The audit handler's log was mostly "Skipping: no meaningful diff for UPDATE on
jobOperation".

**Problem:** The scheduler's `persistChanges` issued one `UPDATE jobOperation` per operation on
every regen, always setting `updatedAt`, and re-stamped `status = 'Ready'` on operations that
were already Ready. `dispatch_event_batch()` queued every one of those updates, the drainer
sent them to Inngest ten at a time, and the audit, search and embedding handlers then threw
them away. Nothing was wrong in any single place; the waste was the sum.

**Rule:** A bulk writer guards its UPDATE on the values it writes (`isDistinctFromAny` in
`scheduling-engine.ts` compares in Postgres, so DATE and timestamptz are matched in their own
type) rather than writing every row and bumping `updatedAt`. The trigger is the backstop: an
UPDATE that changes only `updatedAt` / `updatedBy` / `embedding` is not queued for AUDIT,
SEARCH or EMBEDDING (`20261001195204`). When forking `dispatch_event_batch()` into a new
migration, fork the NEWEST definition; the `event-ignored-columns` check (`@carbon/checks`)
fails if the filter is lost.

**Applies to:** `packages/planning/src/scheduling/`, any job or route that rewrites many rows
of a table with event subscriptions, and every migration that redefines
`dispatch_event_batch()`.
