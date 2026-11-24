---
paths: []
triggers: []
promoted: null
---
# A reversing journal must carry the dimensions of the lines it negates

**Context:** Journal verification, 2026-11. Sales and purchase invoice VOIDs inserted negated lines, and memo, payment and shipment voids also copied each line's `journalLineDimension` rows.

**Problem:** The invoice voids did not copy them. The totals reversed, so every balance check passed, while every report by customer, location or project kept the voided amount.

**Rule:** A reversal copies dimensions with `copyJournalLineDimensions` (`shared.service.ts`). Allocate the reversing line ids first (`allocateJournalLineIds`) so each pair is known without relying on `RETURNING` order. When checking a void, assert the balance per dimension, not only per account.

**Applies to:** Any new void or reversal path that writes `journalLine` rows.
