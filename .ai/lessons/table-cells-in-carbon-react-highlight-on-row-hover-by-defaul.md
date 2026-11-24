---
paths: ["packages/react/src/Table.tsx", "apps/erp/app/modules/production/ui/Schedule/People/PeopleCapacity.tsx"]
triggers: ["rowSpan", "group-hover:bg-muted"]
promoted: null
---
# Table cells in @carbon/react highlight on row hover by default

**Context:** The people Capacity view needed a hover-free (then row-scoped-hover) table; removing every hover class in the feature file changed nothing — cells still tinted on row hover, and a rowSpan name cell lit up whenever its first row was hovered.

**Problem:** `packages/react/src/Table.tsx` bakes the hover in at the primitive level: `Tr` carries the Tailwind `group` class and `Td`/`Th` ship `group-hover:bg-muted`. No amount of feature-level class removal turns it off, and a `rowSpan` cell belongs to its first row, so that row's hover tints it.

**Rule:** To opt a table out of (or customize) hover, override per cell with `group-hover:bg-transparent` (tailwind-merge lets the passed className win) — a local `<Td>` wrapper keeps it tidy. For a rowSpan cell that must stay static, also give it an opaque `bg-card` so sibling-row tints can't bleed through. If more tables need this, promote a `static` prop into `packages/react` instead of copying wrappers.

**Applies to:** any table built on `@carbon/react` `Tr`/`Td`/`Th`, especially with `rowSpan` cells or custom hover semantics (`PeopleCapacity.tsx` is the reference).
