---
paths: []
triggers: []
promoted: null
---
# Aging summary tables keep document headers inside the expansion

**Context:** Showing AR/AP aging totals by customer or supplier with document details beneath each party.

**Problem:** Putting transaction date, type, and original amount in the shared table header leaves blank cells across every party row and makes the report look unfinished.

**Rule:** On aging report pages, show only party-level fields in the outer table. Render open documents and unapplied payments in an expanded table with its own column headers. Keep the receivables/payables workbench layout unchanged unless that page is explicitly in scope.

**Applies to:** `ARAPWorkbench` on the AR/AP aging report routes.
