---
paths: ["packages/database/supabase/tests/intercompany-elimination.test.sql"]
triggers: ["generateEliminationEntries", "targetJournalLineId"]
promoted: null
---
# Consolidation eliminations must allocate per transaction, not per company pair

**Context:** `generateEliminationEntries` looped over company PAIRS (LEAST/GREATEST of the two companies), summed all intragroup revenue/COGS across the pair into one margin, and split the unrealized-profit writedown across the buyer capitalization lines proportional to captured value. A deterministic SQL test harness seeded two trades between the same pair with different margins capitalizing to different accounts (Machinery margin 40, another asset margin 10) and asserted each asset landed at its own group cost — it did not (both drifted to a proportional 75).

**Problem:** Pair-level aggregation preserves the TOTAL (net income and total assets stay correct) but mis-allocates the writedown ACROSS accounts when trades in the pair have different margins. Two companies trade repeatedly in a real ERP, so this is a normal case, not a corner. It was invisible in single-trade tests and only surfaced when regenerate re-matched a second trade into the same pair.

**Rule:** Eliminate/allocate at the grain of the TRANSACTION (the matched seller↔buyer document), not the company pair. Matching links the two sides via `targetJournalLineId` = the other side's `sourceJournalLineId`; use that to pull each trade's own revenue/COGS (seller side) and capitalization (buyer side) and write each asset down by ITS margin. Any consolidation adjustment that aggregates then re-splits proportionally is suspect — prove per-item allocation with a multi-trade, mixed-margin, mixed-account test. The harness (`packages/database/supabase/tests/intercompany-elimination.test.sql`) pins this.

**Applies to:** `generateEliminationEntries`; any margin/cost allocation that groups by counterparty rather than by document.
