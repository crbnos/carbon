---
paths: []
triggers: []
promoted: null
---
# A JSONB column returns object keys in another order than you wrote them

**Context:** The issue sync stores a hash of a record's rich text (Tiptap JSON) to tell its own writes from real changes (2026-10-19).

**Problem:** `projectElement.description` is JSONB, which re-sorts object keys; action-task `notes` is JSON, which keeps them. A hash of `JSON.stringify` of the written object did not match the hash of the row read back, so every inbound description change looked like a new Carbon change and echoed back to the tracker.

**Rule:** Fingerprint JSON with sorted keys (`hashText` in `packages/ee/src/issue-sync/maps.ts`), never with plain `JSON.stringify`, when one side of the comparison may be a JSONB read.

**Applies to:** snapshot, dedupe or change-detection hashes over JSON/JSONB columns.
