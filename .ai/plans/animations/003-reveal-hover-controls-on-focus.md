# 003 — Show hover-revealed controls when they have keyboard focus

- **Status**: DONE
- **Commit**: 2089c5b
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 4 files, 1 class string each

## Problem

These controls are hidden at `md+` widths (`md:opacity-0`) and fade in on
`group-hover`. Nothing reveals them on focus, so a keyboard user tabs onto an
invisible button or link:

```tsx
// apps/erp/app/modules/items/ui/Parts/PartProperties.tsx:311 — current
<span className="group-hover:opacity-100 md:opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground">

// apps/erp/app/modules/items/ui/Item/FileBadge.tsx:52 — current
className="cursor-pointer group-hover:opacity-100 md:opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground"

// apps/erp/app/modules/production/ui/Jobs/JobProperties.tsx:359 — current (on a <Button>)
className="group-hover:opacity-100 md:opacity-0 transition-opacity duration-200"

// apps/erp/app/modules/documents/ui/Documents/DocumentsTable.tsx:255 — current
<span className="group-hover:opacity-100 md:opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground">
```

## Target

Add `group-focus-within:opacity-100` (the focusable element is the `group` ancestor —
a link — or the control itself) and `focus-visible:opacity-100`, and shorten the fade
to 150ms (hover feedback budget):

```tsx
"group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 md:opacity-0 transition-opacity duration-150"
```

## Repo conventions to follow

- Exemplar: `apps/erp/app/modules/inventory/ui/Inventory/InventoryStorageUnits.tsx:515` and
  `apps/erp/app/modules/projects/ui/Milestones/MilestoneSchedule.tsx:404` already reveal on
  `focus-within` as well as hover — match that.

## Steps

1. In each of the 4 locations above, replace
   `group-hover:opacity-100 md:opacity-0 transition-opacity duration-200` with
   `group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 md:opacity-0 transition-opacity duration-150`.
   Keep every other class in the string.

## Boundaries

- Do NOT change markup or what the control does.
- Do NOT touch other `opacity-0` uses (e.g. `DocumentsTable.tsx:652` is a selection check).
- If a string does not match (drift since 2089c5b), STOP and report.

## Verification

- **Mechanical**: `pnpm exec turbo run typecheck --filter=erp`; `pnpm exec biome check` on the 4 files.
- **Feel check**: on a Part's properties panel with a 3D model, and in Documents, Tab
  through the page with no mouse: each external-link / unlink icon becomes visible
  when its link or button is focused, and hides again when focus leaves. Hover still works.
- **Done when**: `rg "group-hover:opacity-100 md:opacity-0 transition-opacity duration-200" apps/erp/app` returns nothing.
