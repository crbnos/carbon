---
paths: []
triggers: []
promoted: null
---
# Prerequisite lookup failures must hold outbound cursors

**Context:** Ramp outbound purchase-order and invoice families batch-load suppliers and supplier types before deciding whether and how to export each document.

**Problem:** Query errors were treated like empty results. The workflow could skip documents, misclassify an Employee reimbursement as a vendor bill, and still advance the family cursor beyond the unread data.

**Rule:** Distinguish an empty successful lookup from a failed lookup. If data required for eligibility or payload construction cannot be read, fail the family before remote effects and keep its cursor unchanged so the same page replays after recovery.

**Applies to:** Ramp outbound suppliers and classifications, and every cursor-based exporter with prerequisite database reads.
