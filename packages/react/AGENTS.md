# @carbon/react

Shared UI component library — primitives, layout, data display, and overlays built on Radix, React Aria, and Tailwind.

## Always

- **Use existing components first.** Grep `packages/react/src/` before writing custom UI. Prefer built-in `variant` props over ad-hoc `bg-*`/`text-*` classes.
- **Use `cn()` for class merging** (`import { cn } from "@carbon/react"` — it's `twMerge(clsx(...))`). Never raw string concatenation for conditional classes.
- **Components live flat in `src/`** (e.g. `src/Button.tsx`), not under a `components/` subdirectory. Follow this convention for new components.
- **Concentric border radius**: outer radius = inner radius + padding. Card shell is `rounded-lg`; don't re-add borders/radius on CardContent.
- **Popover inside Drawer/Dialog**: `stopPropagation` on `onWheel`/`onTouchMove` of `PopoverContent` to prevent scroll-lock from swallowing events.

## Ask First

- Adding a new Radix/React Aria primitive dependency
- Changing the public API of `Button`, `Card`, `ModalDrawer`, or other widely-used components
- Modifying the barrel export in `src/index.tsx`

## Never

- Use `transition-all` when a scoped transition (`transition-transform`, `transition-colors`) works
- Create icon-only buttons without `aria-label` — use `IconButton` component instead
- Import from deep paths (`@carbon/react/src/Button`) — always use the package barrel or named sub-exports (`@carbon/react/Editor`, `@carbon/react/Chart`)

## Validation Commands

```bash
pnpm --filter @carbon/react typecheck
pnpm --filter @carbon/react test
pnpm --filter @carbon/react lint
```

## Key Patterns

```typescript
import { Button, Card, HStack, VStack, IconButton, cn } from "@carbon/react";
```

- **Button** variants: `primary | secondary | solid | active | destructive | ghost | outline | link`; sizes: `sm | md | lg`; `shortcut` / `hideShortcutKey` / `shortcutGuard` bind a hotkey with a keycap badge (topmost-dialog guarded)
- **Shortcuts**: combos are named constants — shared `SHORTCUTS` in `src/shortcuts.ts`, never string literals at call sites. `useShortcutKeys` (one binding) and `useShortcutKeyMap` (entries array, dev-warns on duplicates) both delegate to react-hotkeys-hook — never add a hand-rolled keydown listener; `useShortcutSequence` (`g`-then-letter) is the lone exception (no library sequence support). `isEditableTarget` (the one editable-target check; `isTextEntryTarget` is its fields-only half, for menu keys); menu items take `shortcut={MENU_ITEM_SHORTCUTS.x}`, live only while their menu is open, `ShortcutHelpOverlay` (the `?` overlay; apps declare entries). Enter vs ⌘Enter and badge visibility are design decisions — see `.claude/rules/conventions-ui.md` § Keyboard shortcuts
- **Choice screens**: `ChoiceCardGroup` (card radios, `autoFocus` focuses the selected card) and `RadioGroupButton` (radio styled as a secondary Button) give one tab stop + arrow-key select; Enter stays free for the screen's continue action
- **Layout**: `VStack` / `HStack` with numeric `spacing` prop (maps to `space-y-*`/`space-x-*`)
- **Overlays**: `Drawer`, `Modal`, `ModalDrawer` (unified drawer/modal), `BottomSheet`, `Popover`
- **App nav**: `NavRail` is the primary left nav of both the ERP and MES shells (56px icon rail, expands after a 150ms mouse hover or when pinned via `SidebarProvider` (⌘B unless `keyboardShortcut={false}`, as in the ERP), left drawer below md that closes itself on navigation). Optional `header` (use `NavRailBrand` for a logo + name) and `footer` slots; `NavRailGroup` adds a titled section that shows as a divider while collapsed. Entries are `NavRailItem` (a button, or `asChild` for a trigger/link) and `NavRailLink`; `label` is a string and doubles as the accessible name. A Radix menu/popover opened from a `NavRailItem` keeps the rail as it was (open or collapsed) until it closes. Render inside `SidebarProvider`; the shadcn-style `Sidebar*` primitives remain for other layouts
- **Links that prefetch**: `PrefetchLink` is a React Router `Link` that prefetches its destination when the pointer goes down on it. Use it instead of `<Link prefetch="intent">`, which prefetches on a 100 ms hover and so runs a page's loaders for every row the mouse passes over. `NavRailLink` and both apps' `Hyperlink` already use it
- **Data**: `Table` (TanStack), chart components via sub-exports (`@carbon/react/Chart`)
- **Rich text**: `@carbon/react/Editor` and `@carbon/react/RichText` (wraps `@carbon/tiptap`)
- **Error boundary**: `@carbon/react/ErrorBoundary` — `RootErrorBoundary` (drop-in root `ErrorBoundary` for RR v7 that maps 404 / other HTTP / thrown `Error` to a styled screen) plus its parts (`ErrorScreen`, `GlitchHeading`, `StatusReadout`, `MagneticLink`, `NoiseOverlay`). Wrap it in the app's `Document` and pass `env` so `window.env` is set (the client crashes hydration otherwise). Copy is intentionally hardcoded English, not i18n.
- **Polish**: shadows over borders, `tabular-nums` for dynamic numbers, `active:scale-[0.96]` on pressables, `text-balance`/`text-pretty` for text wrapping

## Cross-References

- `.claude/rules/conventions-ui.md` — full UI conventions, polish principles, review checklist
- `@carbon/tiptap` — editor extensions used by `Editor/` and `RichText/`
- `@carbon/content/glossary` — term definitions used by `LabelWithHelp`
- `@carbon/form` — form field components (import from `~/components/Form` in apps, not directly)
