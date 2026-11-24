---
paths: ["packages/jobs/src/inngest/functions/integrations/accounting-sync-operations.ts"]
triggers: ["loadChargePolicyInputs", "DOC_BACKED"]
promoted: null
---
# A document-backed journal is found through its LINES' document link, never through the document's own journalId

**Context:** Card charges as provider objects (2026-09-10). A `charge` books TWO journals over its life — the posting journal (`charge.journalId`) and, on void, a NEW Posted "VOID Charge" journal with no `reversalOfId`. Both carry `journalLine.documentType = 'Charge'` / `documentId = <card id>`.

**Problem:** The reconciler resolved the backing charge by `charge.journalId`, so only the posting journal was DOC_BACKED. The void journal looked like a plain journal, pushed to Rillet as a journal entry on top of the charge DELETE, and Rillet netted to minus one charge — invisible in unit tests, found only by voiding on the live sandbox and reading Rillet's GL.

**Rule:** When a journal's disposition depends on a backing document, resolve journal → document through the journal lines' `documentType`/`documentId` (one batch query), which every journal the document produces shares; treat the document's own `journalId` column as a fallback for unlinked rows. And any DOC_BACKED carve-out must be exercised across the document's full lifecycle (post → void) on a real provider before it is called done.

**Applies to:** `loadChargePolicyInputs`, every future DOC_BACKED source type, and the void/reversal audit still open in the always-on posting plan (Task 7).
