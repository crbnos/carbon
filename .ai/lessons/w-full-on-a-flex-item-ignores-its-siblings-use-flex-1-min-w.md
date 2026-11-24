---
paths: []
triggers: []
promoted: null
---
# `w-full` on a flex item ignores its siblings — use `flex-1 min-w-0`

**Context:** Every document line-item view (digital quote, quote, sales order, purchase order, supplier quote, both invoice summaries — 12 files) lays a row out as a flex row: a fixed `w-24` thumbnail, then a `VStack` holding the heading, description and price. The `VStack` carried `className="w-full"`, and `VStack`'s own base class is `w-full` too, so a bare `<VStack>` has the same defect.

**Problem:** `width: 100%` on a flex item resolves against the flex container's content box — it takes no account of the sibling thumbnail. The content column was therefore as wide as the whole row, and the row rendered 112px (96px thumbnail + 16px gap) wider than its card, pushing the description and the line price outside the card's right edge on a customer-facing document. The `truncate` on the description masked the cause rather than revealing it: the text *did* ellipsise, just at the overflowed boundary, so it read as "text is being cut off" instead of "the box is the wrong width". Measure `el.getBoundingClientRect().right` against the parent's to see it.

**Rule:** A flex child that should fill the remaining space gets `flex-1 min-w-0`, never `w-full`; its fixed-size siblings get `shrink-0`. `min-w-0` is required twice over — it is what lets `flex-1` shrink at all (a flex item's default `min-width: auto` floors it at its content width) and what lets a descendant's `truncate` clip at the container edge. Note `@carbon/react`'s `VStack` ships `w-full` in its base variant, so dropping the className is not enough — pass `className="flex-1 min-w-0"` explicitly. Separately, `truncate` is inert on `Heading`: its base `text-balance` resets `text-wrap-mode`, so the `whitespace-nowrap` half of `truncate` never lands.

**Applies to:** `apps/erp/app/routes/share+/{quote,supplier-quote,purchasing-rfq}.$id.tsx`, `apps/erp/app/modules/{sales,purchasing,invoicing}/ui/**` line-item summaries and drawers, `packages/react/src/VStack.tsx`, `packages/react/src/Heading.tsx`; any flex row pairing a fixed-size element with a growing text column.
