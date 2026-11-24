---
paths: ["apps/mes/app/services/inventory.service.ts"]
triggers: ["excludeLineside", "p_exclude_lineside", "get_issue_tracked_entity_stock"]
promoted: null
---
# Issue-bin displays preserve stock stripes and picked ownership

**Context:** A batched MES query reports the bins a job can issue from, including stock picked to a work center.

**Problem:** Summing project and common ledger rows before testing for positive stock hid a positive project bin behind a negative common balance. Excluding every lineside bin hid stock already picked for the job.

**Rule:** Test positive on-hand per eligible `(item, bin, projectId)` stripe, then combine display quantities. Show lineside stock only when the job has an outstanding picked claim at that bin, net of its consumption.

**Applies to:** Issue-location reads, stock availability badges, and any query that merges warehouse and picked lineside stock.
