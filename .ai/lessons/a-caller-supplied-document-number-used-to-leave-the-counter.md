---
paths: []
triggers: []
promoted: null
---
# A caller-supplied document number used to leave the counter behind

**Context:** Documents take their number from `get_next_sequence` unless the caller supplies one: a custom ID typed into `SequenceOrCustomId`, or an MCP / API upsert (`upsertSalesOrder`, `upsertQuote`, `upsertPurchaseOrder`, `upsertJob`, …) whose create path requires the number.

**Problem:** A supplied number never moved the `sequence` row. Once the counter reached a number an agent or a user had already used, every new document failed on the unique constraint ("Failed to insert sales order") until someone moved the counter by hand.

**Rule:** The counter is kept ahead in the database, not in app code: the `sync_advance_document_sequence` after-interceptor moves `sequence.next` past any number saved in the sequence's format, on insert and on a number change. A new numbered table must be added to that interceptor's `CASE` and given the interceptor in `attachments.ts`; the `document-sequence-synced` conformance check fails CI for a new counter that is neither covered nor in its `EXEMPT_COUNTERS`. Never "fix" a collision by retrying `get_next_sequence`.

**Applies to:** `packages/database/src/event-system/handlers/sync_advance_document_sequence.sql`, `util.document_sequence_pattern`, any table with a readable document number.
