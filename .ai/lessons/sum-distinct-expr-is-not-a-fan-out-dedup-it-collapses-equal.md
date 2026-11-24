---
paths: []
triggers: ["sum(DISTINCT", "SUM(DISTINCT"]
promoted: null
---
# `sum(DISTINCT expr)` is not a fan-out dedup — it collapses equal values from different rows

**Context:** The `salesOrders` view aggregated line totals in a lateral that also LEFT JOINs `job` (one line → many jobs), and used `sum(DISTINCT <line total>)` to cancel the join fan-out. An order with two different lines that compute to the same amount (e.g. two items at 10 × $50 each) counted that amount once, understating the total on the list page, the dashboard KPI chart, and the sales funnel — while the detail page and PDF (app-side plain sums) were correct. Dozens of real orders were affected.

**Problem:** `DISTINCT` inside an aggregate dedupes by VALUE, not by source row. It cancels duplication from a join fan-out only as long as no two *distinct* rows produce the same value — for money amounts (repeated items, same qty × price) that collision is routine. The failure is silent and data-dependent: the view verifies "byte-identical" against its predecessor because the predecessor had the same bug.

**Rule:** Never use `sum(DISTINCT ...)`/`count(DISTINCT ...)`-style aggregates to undo join fan-out. Compute the aggregate in its own lateral/subquery over just the table being summed (no fan-out ⇒ plain `sum()`), and keep the fanned join in a separate lateral for the aggregates that need it. When reviewing a view, treat any `agg(DISTINCT ...)` over a joined row set as a probable value-collapse bug. Fixed in `20260812211507_fix-sales-order-total-duplicate-line-amounts.sql`.

**Applies to:** `packages/database/supabase/migrations/` views aggregating over joins (`salesOrders`, `purchaseOrders`, quotes/invoices list views); any SQL review touching `sum(DISTINCT`.
