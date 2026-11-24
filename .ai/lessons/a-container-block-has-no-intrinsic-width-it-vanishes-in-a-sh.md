---
paths: []
triggers: []
promoted: null
---
# A `@container` block has no intrinsic width — it vanishes in a shrink-to-fit parent

**Context:** The planning grid's expanded row (`PlanningActionLines`) was reused inside the
order drawer, under a `VStack`, to list an item's suggested changes. The heading rendered and
the rows did not.

**Problem:** The block's root is `@container` (`container-type: inline-size`), which is
inline-size containment: the element contributes NO intrinsic width to its parent. In the
grid the Table hands it a width. `VStack` is `flex flex-col items-start`, so its children
shrink-to-fit — and a contained element's fit width is zero plus padding. The table inside
was `w-full` of nothing. Typecheck, lint and unit tests all pass on this; only a render
shows it.

**Rule:** Anything marked `@container` must be stretched by its parent (`w-full`, a block
parent, or a flex column with default `items-stretch`) — never placed in `VStack`/`HStack`
or any `items-start`/`inline-*`/`w-fit` parent without an explicit width. When moving a
component to a new host, check what the OLD host was giving it for free: width, padding
offsets (`pl-[52px]` lined the block up under a grid row and means nothing in a drawer) and
column widths sized for a different pane. A layout built for one host usually wants its own
variant in the next (the drawer now has its own `OpenOrdersGrid`), sharing only the
behaviour.

**Applies to:** `apps/erp/app/modules/production/ui/Planning/PlanningActionLines.tsx`
(`PlanningActionLines` vs `PlanningOrderGrids.tsx`), and any `@container` component rendered
through `VStack`/`HStack` (`packages/react/src/VStack.tsx` is `items-start`).
