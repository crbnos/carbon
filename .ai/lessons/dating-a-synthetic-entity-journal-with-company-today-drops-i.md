---
paths: []
triggers: []
promoted: null
---
# Dating a synthetic-entity journal with company_today() drops it out of the "as of" report window

**Context:** Intercompany elimination journals post to a synthetic "elimination entity" company (no user membership, no location). `generateEliminationEntries` dated them `company_today(elimination_entity)`. Because the elimination entity has no location, `company_today` fell back to UTC — and on an evening-Pacific boundary UTC had already rolled to the next day. The eliminations posted on Aug 18 while the invoices they eliminate posted Aug 17. The consolidated balance sheet ("Aug 2026 to date", cutoff = today = Aug 17) then showed Inter-Company Payables/Receivables = 100 (un-eliminated), while the account drill-down ("all time") correctly netted to 0 — a confusing split where the row and its own drill-down disagree.

**Problem:** A consolidation adjustment must fall in the SAME reporting period/date window as the transactions it adjusts. Deriving its date from a synthetic entity's own timezone (UTC fallback) is unmoored from the operating companies' business calendar and drifts a day — or a MONTH at a month-end boundary, which would misfile the whole adjustment.

**Rule:** Date a derived/adjusting journal (elimination, allocation, reversal) to the business date of the source transactions it references — e.g. `MAX(sourceJournal.postingDate)` — not to `company_today()` of a synthetic or parent entity that may resolve to a different day. Date a reversal to its original journal's `postingDate` so the two net in one window. When a balance-sheet ROW and its drill-down "Closing" disagree, suspect an out-of-window posting date, not a summing/RLS bug. Fixed in `20260817122328_intercompany-revenue-cogs-elimination.sql`.

**Applies to:** `generateEliminationEntries` and any DB function posting to `isEliminationEntity` companies; any consolidation/allocation/reversal journal; `company_today()` callers where the company may lack a location.
