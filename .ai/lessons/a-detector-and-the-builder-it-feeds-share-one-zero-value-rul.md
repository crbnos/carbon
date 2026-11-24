---
paths: ["packages/database/src/legacy-documents.ts", "apps/erp/app/modules/accounting/accounting.service.ts", "apps/erp/test/database/activate-accounting/**"]
triggers: ["valueMovement", "LEGACY_DOCUMENT_FAMILIES", "legacySalesInvoices"]
promoted: null
---
# A detector and the builder it feeds share one zero-value rule

**Context:** The accounting enable, and the "Write missing journals" repair, find legacy documents: posted on or after the cutover with no journal (`packages/database/src/legacy-documents.ts`). A builder then writes each document's journal (`apps/erp/app/modules/accounting/accounting.service.ts`). After that, the enable's re-cost (`activate-accounting/recost.ts`) adjusts the inventory journal pair of each outbound movement whose cost changed.

**Problem:** The detection and the builders used different zero rules, in both directions:

1. The detection found documents that the builders write no line for: a comment-only invoice, a receipt with no received line, a return received at no cost. Such a document got no journal, so every later run found it again.
2. The posting core wrote no journal for a zero-cost movement (`valueMovement` skipped the journal when `cost === 0`). When the re-cost gave that movement a cost, it found no pair to adjust and refused with a 409.

Commit b9f897608c removed zero-value documents from the detection. Commits b9f897608c and 188a710e24 made every outbound cost row write its pair, at zero too.

**Rule:** Write the zero rule once and apply it on both sides. If the builder writes no line for a document, the detection leaves the document out. If a later step adjusts a line, the builder writes that line even at zero. Pin the pair with a test that runs the detection, the builder, and the detection again: the second detection must find nothing (`apps/erp/test/database/activate-accounting/legacy/detection.test.ts`).

**Applies to:** `packages/database/src/legacy-documents.ts`; `apps/erp/app/modules/accounting/accounting.service.ts`; `apps/erp/app/modules/accounting/accounting.service.ts`; `valueMovement` in `apps/erp/app/modules/shared/shared.service.ts`; any detect-then-repair pair.
