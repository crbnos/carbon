---
paths: []
triggers: []
promoted: null
---
# `space-x-*` gives a phantom margin when a component injects sibling nodes

**Context:** A reported layout shift — hovering any row of an ERP list table shifted every column of the whole table ~8px sideways.

**Problem:** `Hyperlink` renders `<Link prefetch="intent">`. React Router implements that by rendering `<>{anchor}{prefetchLinks}</>`, so on hover four `<link rel="prefetch">` elements appear **as siblings of the anchor** inside whatever container the caller used — here `<HStack>`. Tailwind v4's `space-x-*` compiles to `& > :not(:last-child) { margin-inline-end }`, so the instant those links mount the anchor stops being `:last-child` and gains a real 8px margin. Under `table-layout: auto` that re-lays out the column and the whole table. The links are `display: none`, which is exactly why this reads as impossible: every computed style on the `<td>` except `background-color` is unchanged, the anchor and all its children keep identical widths, and only the `<td>` and its wrapper grow. Two false leads first — the load-time column settle (237.5 → 245.1 with no hover, ~4s after load) masquerades as the same shift, and `opacity-0 → opacity-100` on the "Open" button looks like the obvious culprit but cannot move layout.

**Rule:** `space-x-*` / `space-y-*` are structural (`:not(:last-child)`) — never use them on a container whose children a component may add to at runtime; use `gap-*`, which only applies between elements that generate boxes and so ignores `display:none`. When a component renders extra DOM next to its main element (React Router prefetch links, portals, measurement nodes), isolate it in a `display: contents` wrapper so it can't perturb the caller's layout. To diagnose "impossible" width changes, diff every computed property between states and count child nodes — a node-count delta with no style delta means injected DOM, not CSS.

**Applies to:** `apps/erp/app/components/Hyperlink.tsx`; `packages/react/src/{HStack,VStack}.tsx` (still `space-x-*`/`space-y-*`, ~2,500 call sites); any `PrefetchLink` (`@carbon/react`, which injects the same tags on press) or `<Link prefetch>` placed directly inside a `space-*` container.
