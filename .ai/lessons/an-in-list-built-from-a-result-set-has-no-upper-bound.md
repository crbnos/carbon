---
paths: ["apps/erp/app/modules/production/production.service.ts", "apps/erp/app/routes/x+/purchasing+/planning*.tsx", "apps/erp/app/routes/x+/production+/planning*.tsx"]
triggers: ["getPlanningActions", "fetchAllByIds", {"text": ".in(\"id\"", "minCount": 2}]
promoted: null
---
# An `.in()` list built from a result set has no upper bound

**Context:** The planning grids load the actions for the 100 parts on a page, then looked up
each action's purchase order line with `.in("id", lineIds)`.

**Problem:** `.in()` writes every id into the URL. The list was one id per ACTION, so it grew
with the data, not the page size: 2,357 ids was a 54 kB request line and the gateway rejected
it (HTTP 431). The loader did `planningActions.data ?? []`, so the page rendered every part
with no actions — indistinguishable from "nothing to do". Demo data and hand-made test parts
(a few actions each) never came near the limit; it took load data to see it.

**Rule:** An id list for `.in()` must be bounded by something you control (the page size), and
chunked when that bound is large — about 100 ids per request (`fetchAllByIds` in
`@carbon/database` does the chunking and the paging). When the related rows hang off
a foreign key, embed them in the first read instead of looking them up afterwards. And a
loader never swaps a failed read for an empty list: log it and throw.

A list the USER builds (the ids of a bulk selection: Apply, Dismiss, Assign) has no bound at
all, and chunking a WRITE breaks its atomicity — a claim that lands in chunk 1 and fails in
chunk 2 leaves rows claimed with nothing applied. Send such a list through Kysely instead:
`where("id", "in", ids)` binds the ids as parameters, one statement, no URL, no `max_rows`.
The same bulk Apply did this over PostgREST in five functions and would have failed whole on a
page of busy parts.

**Applies to:** `getPlanningActions` and the planning action worklist writes in
`apps/erp/app/modules/production/production.service.ts`, the planning loaders and
`planning.update` routes (`x+/purchasing+/planning*.tsx`, `x+/production+/planning*.tsx`), and
any "read rows, then `.in()` their ids" enrichment.
