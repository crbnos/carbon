# @carbon/react

Shared UI component library — primitives, layout, data display, and overlays built on Radix, React Aria, and Tailwind.

## Always

- **Use existing components first.** Grep `packages/react/src/` before writing custom UI. Prefer built-in `variant` props over ad-hoc `bg-*`/`text-*` classes.
- **Use `cn()` for class merging** (`import { cn } from "@carbon/react"` — it's `twMerge(clsx(...))`). Never raw string concatenation for conditional classes.
- **Components live flat in `src/`** (e.g. `src/Button.tsx`), not under a `components/` subdirectory. Follow this convention for new components.
- **Concentric border radius**: outer radius = inner radius + padding. Card shell is `rounded-lg`; don't re-add borders/radius on CardContent.
- **Popover inside Drawer/Dialog**: `stopPropagation` on `onWheel`/`onTouchMove` of `PopoverContent` to prevent scroll-lock from swallowing events.
- **Drawer closing animation**: the panel slides out only when the `Drawer` stays mounted and its `open` prop goes false. `{item && <Drawer open />}` removes it in the same render, so nothing animates — keep the record while it closes (`useDrawerItem` in the ERP, `~/hooks`). The positioning div in `DrawerPortal` runs a no-op exit animation matched to the panel's closing duration; Radix unmounts the portal as soon as that div stops animating, so change the two durations together.

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
- **Overlays**: `Drawer`, `Modal`, `ModalDrawer` (unified drawer/modal), `BottomSheet`, `Popover`. A controlled `Modal`/`Drawer` with no `onOpenChange` cannot be dismissed and shows no close button; never pass a handler that does nothing (`no-noop-open-change` check). A route rendered as a modal or drawer closes with `useCloseRoute()` (back when this tab has history, else the parent route), not `navigate(-1)`
- **Status**: `iconOnly` renders just the coloured icon, with the label in an always-on tooltip and as the `aria-label` (string children only) — for dense rows and narrow drawers. `TooltipContent` takes `anchor` to position against a different element than the trigger, when one tooltip serves many small hover targets (a strip of bars)
- **App nav**: `NavRail` is the primary left nav of both the ERP and MES shells (56px icon rail, expands after a 150ms mouse hover or when pinned via `SidebarProvider` (⌘B unless `keyboardShortcut={false}`, as in the ERP), left drawer below md that closes itself on navigation). Optional `header` (use `NavRailBrand` for a logo + name) and `footer` slots; `NavRailGroup` adds a titled section that shows as a divider while collapsed. Entries are `NavRailItem` (a button, or `asChild` for a trigger/link) and `NavRailLink`; `label` is a string and doubles as the accessible name. A Radix menu/popover opened from a `NavRailItem` keeps the rail as it was (open or collapsed) until it closes. Render inside `SidebarProvider`; the shadcn-style `Sidebar*` primitives remain for other layouts
- **Links that prefetch**: `PrefetchLink` is a React Router `Link` that prefetches its destination when the pointer goes down on it. Use it instead of `<Link prefetch="intent">`, which prefetches on a 100 ms hover and so runs a page's loaders for every row the mouse passes over. The click reuses the prefetch only because `prefetchCacheMiddleware` (`@carbon/utils`, in each app's root `middleware`) gives a prefetch response a few seconds of private cache; without it both requests reach the server and the click waits behind the prefetch. `NavRailLink` and both apps' `Hyperlink` already use it
- **Record outlet**: `RecordOutlet` is the `<Outlet>` of every route under `/x`. It remounts the page inside it when that page is shown for a different record (the params of the route in the outlet, not of a drawer below it), so nothing seeded from the previous record survives. A plain `<Outlet>` there fails the `no-bare-outlet` check
- **Data**: `Table` (TanStack), chart components via sub-exports (`@carbon/react/Chart`)
- **Rich text**: `@carbon/react/Editor` and `@carbon/react/RichText` (wraps `@carbon/tiptap`)
- **Error boundary**: `@carbon/react/ErrorBoundary` — `RouteErrorBoundary` (exported as `ErrorBoundary` from a module layout so a failed loader shows inside the app shell; it shows the status code and, for a 4xx, the message the server threw — `routeErrorCopy` — so throw a `Response` whose body says what was wrong. A 5xx or thrown `Error` gets generic copy) and `RootErrorBoundary` (drop-in root `ErrorBoundary` for RR v7 that maps 404 / other HTTP / thrown `Error` to a styled screen) plus its parts (`ErrorScreen`, `GlitchHeading`, `StatusReadout`, `MagneticLink`, `NoiseOverlay`). Wrap it in the app's `Document` and pass `env` so `window.env` is set (the client crashes hydration otherwise). Copy is intentionally hardcoded English, not i18n.
- **Avatar**: `src` may be a URL or a generated-avatar value from `user.avatarUrl` (`dicebear:<style>:<seed>[:<rrggbb>]`; the styles and value helpers are in `@carbon/utils` `avatar.ts`). It renders that in the browser with DiceBear 10 (`utils/generatedAvatar.ts`). Nothing from DiceBear is imported statically — the core (about 25 KB gzipped) and each style's JSON definition load with `import()` the first time an avatar needs them (`STYLE_LOADERS`, typed `Record<GeneratedAvatarStyle, …>` so a new style without a loader fails typecheck); keep it that way, `Avatar` is in every app shell. `useGeneratedAvatar` reads the state through `useSyncExternalStore`: `loading` on the server and until the chunks arrive (a plain `bg-muted` circle, no initials flash), `failed` falls back to initials. `generatedAvatarClassName(style)` picks the image classes: line-art styles on white (`bg-white`) in both themes, color styles on `bg-muted`. A value's optional background goes to DiceBear as `backgroundColor`; on a dark one (`isDarkBackground`, WCAG contrast) the styles that draw lines straight onto the background (`INK_OPTIONS`: Croodles Neutral, Notionists Neutral, Lorelei Neutral) get white ink. Rendered avatars sit in one LRU cache capped at `MAX_CACHED_AVATARS`, since a picker drag produces a new value per step. The app `Avatar` wrappers turn a stored value into `src` with `avatarSrc` (`@carbon/utils`); new users get a Croodles Neutral avatar from the column default
- **Polish**: shadows over borders, `tabular-nums` for dynamic numbers, `active:scale-[0.98]` on pressables, `text-balance`/`text-pretty` for text wrapping

## Cross-References

- `.claude/rules/conventions-ui.md` — full UI conventions, polish principles, review checklist
- `@carbon/tiptap` — editor extensions used by `Editor/` and `RichText/`
- `@carbon/content/glossary` — term definitions used by `LabelWithHelp`
- `@carbon/form` — form field components (import from `~/components/Form` in apps, not directly)
