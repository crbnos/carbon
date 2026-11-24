---
paths: ["apps/*/app/**/ColumnCard.tsx", "apps/erp/app/utils/drag-sensors.ts"]
triggers: ["sticky left-0", "BoardContainer", "MeasuringStrategy"]
promoted: null
---
# position:sticky inside a horizontal board needs a content-width row and a clamped scroll root

**Context:** Making the people board's Unassigned column sticky worked for one viewport-width of scrolling, then scrolled away; fixing that caused page-level overflow on small screens.

**Problem:** Sticky elements only stick within their parent's bounds. The flex row inside the Radix ScrollArea was viewport-width (columns overflowed it), so the sticky column ran out of parent after one screenful. Adding `min-w-max` fixed that but let the ScrollArea (a flex item, which sizes to content) exceed ITS parent, pushing overflow to the page.

**Rule:** The sizing contract for a sticky column in a scrollable flex board is three layers: scroll root clamped (`w-full min-w-0 max-w-full`) > row content-width (`min-w-max`) > column `sticky left-0 z-10` with an opaque background. With dnd-kit on top, add `measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}` — cached droppable rects assume elements move with the scroll, and sticky ones don't.

**Applies to:** `BoardContainer` (`ColumnCard.tsx`) and any kanban wanting a pinned column; any dnd-kit board with sticky droppables.
