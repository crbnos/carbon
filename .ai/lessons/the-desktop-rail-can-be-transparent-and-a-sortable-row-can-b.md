---
paths: ["packages/react/src/NavRail.tsx", "apps/erp/app/components/Layout/Navigation/**"]
triggers: ["closestCenter", "pointerWithin"]
promoted: null
---
# The desktop rail can be transparent, and a sortable row can be tall

**Context:** Customize added a tree under each module row in `NavRail`. The rail scrolled as a whole, so the footer with Save and Cancel needed to stay in view.

**Problem:** A sticky footer with `bg-background` passed in the default theme. A color theme makes the rail transparent, so the footer painted a solid patch on the frame. Separately, `closestCenter` compared the center of a tall row with an open tree, so the row did not reorder.

**Rule:** In the rail, never paint a background to hide content that scrolls under it. Scroll the list and keep the footer outside the scroll area. Check rail changes with a color theme (`theme=forge`). For a sortable item with variable height, follow the pointer with `pointerWithin`, and keep `closestCenter` as the fallback for the keyboard.

**Applies to:** `packages/react/src/NavRail.tsx`, `apps/erp/app/components/Layout/Navigation/`.
