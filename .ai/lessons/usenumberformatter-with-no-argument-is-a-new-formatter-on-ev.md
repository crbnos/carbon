---
paths: ["apps/erp/app/modules/**/PurchasingPlanningTable.tsx", "apps/erp/app/modules/**/ProductionPlanningTable.tsx"]
triggers: ["useNumberFormatter()"]
promoted: null
---
# `useNumberFormatter()` with no argument is a new formatter on every render

**Context:** Opening or closing the order drawer on the planning pages stuttered. The drawer
itself was cheap; the table behind it was the cost.

**Problem:** react-aria memoizes the formatter on the options OBJECT
(`useMemo(() => new NumberFormatter(locale, options), [locale, options])`), and the default
`options = {}` is a new object on each call. So `useNumberFormatter()` returns a new formatter
every render. It was a dependency of the table's `columns` memo, so every render rebuilt the
columns; TanStack then sees new `cell` functions and React REMOUNTS every cell, and the
shared `Table` re-measures its column widths. Opening the drawer re-rendered the table six
times through fetcher state — 1,824 DOM nodes replaced, six main-thread blocks of 90–220 ms.
With a stable formatter: zero nodes replaced, and the drawer shows in ~100 ms instead of ~220.

**Rule:** A value that feeds a `useMemo`/`useCallback` dependency list must be stable. Pass
`useNumberFormatter` a module-level options constant (or use the `@carbon/utils` formatter
hooks), never the bare call. When a table feels slow, count DOM nodes replaced in its
`tbody` during the interaction before optimizing anything else — a non-zero count on an
interaction that changes no data means the columns are being rebuilt.

**Applies to:** `PurchasingPlanningTable.tsx`, `ProductionPlanningTable.tsx` (fixed), and the
other ERP files that still call `useNumberFormatter()` bare — it only costs where the
formatter reaches a memo dependency list (`InventoryTable`, `TrackedEntitiesTable`,
`JobMaterialsTable`, `DemandProjectionTable`, `JobOperationStepRecordsTable` are the
candidates to check).
