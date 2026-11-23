# 001 — Scale context menus from the cursor, not from their centre

- **Status**: DONE
- **Commit**: 2089c5b
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 1 file, 2 class strings

## Problem

Every Radix popper surface in `@carbon/react` zooms from its trigger by setting
`origin-(--radix-…-content-transform-origin)` — except the context menu. Its
content and sub-content zoom 95 → 100 from their own centre, so a right-click menu
appears to grow out of the middle of the menu, not from the cursor.

```tsx
// packages/react/src/Context.tsx:71 — ContextMenuSubContent, current
"z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",

// packages/react/src/Context.tsx:93 — ContextMenuContent, current
"z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out …same as above…",
```

## Target

Prefix both class strings with the Radix origin variable for the context menu:

```tsx
"origin-(--radix-context-menu-content-transform-origin) z-50 min-w-[8rem] …unchanged…"
```

No other change: same 150ms default duration, same zoom-95, same slide-2.

## Repo conventions to follow

- Exemplar: `packages/react/src/Dropdown.tsx:71` already starts its class string with
  `origin-(--radix-dropdown-menu-content-transform-origin)` (Tailwind v4 CSS-variable
  shorthand). Popover (`Popover.tsx:108`), Select (`Select.tsx:165`) and HoverCard
  (`HoverCard.tsx:104`) do the same.

## Steps

1. In `packages/react/src/Context.tsx`, in the `cn(...)` call of `ContextMenuSubContent`
   (≈ line 71), insert `origin-(--radix-context-menu-content-transform-origin) ` at the
   start of the first string.
2. In the same file, in `ContextMenuContent` (≈ line 93), do the same.

## Boundaries

- Do NOT touch Dropdown, Popover, Select, HoverCard or Tooltip.
- Do NOT change durations, easing or the zoom/slide values.
- If either class string does not match the excerpt (drift since 2089c5b), STOP and report.

## Verification

- **Mechanical**: `pnpm exec turbo run typecheck --filter=@carbon/react` → 0 errors;
  `pnpm exec biome check packages/react/src/Context.tsx` → clean.
- **Feel check**: right-click any row with a context menu (e.g. a document in
  Documents, or a node in the Traceability graph).
  - In DevTools → Animations, set playback to 10%: the menu grows out of the corner
    nearest the cursor, not its centre.
  - Right-click near the bottom-right of the window so Radix flips the menu: the
    origin flips with it.
- **Done when**: both class strings contain `origin-(--radix-context-menu-content-transform-origin)`.
