# @carbon/react

Shared UI component library — primitives, layout, data display, and overlays built on Radix, React Aria, and Tailwind.

## Always

- **Use existing components first.** Grep `packages/react/src/` before writing custom UI. Prefer built-in `variant` props over ad-hoc `bg-*`/`text-*` classes.
- **Use `cn()` for class merging** (`import { cn } from "@carbon/react"` — it's `twMerge(clsx(...))`). Never raw string concatenation for conditional classes.
- **Components live flat in `src/`** (e.g. `src/Button.tsx`), not under a `components/` subdirectory. Follow this convention for new components.
- **Concentric border radius**: outer radius = inner radius + padding. Card shell is `rounded-2xl`; don't re-add borders/radius on CardContent.
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

- **Button** variants: `primary | secondary | solid | active | destructive | ghost | outline | link`; sizes: `sm | md | lg`
- **Layout**: `VStack` / `HStack` with numeric `spacing` prop (maps to `space-y-*`/`space-x-*`)
- **Overlays**: `Drawer`, `Modal`, `ModalDrawer` (unified drawer/modal), `BottomSheet`, `Popover`
- **Data**: `Table` (TanStack), chart components via sub-exports (`@carbon/react/Chart`)
- **Rich text**: `@carbon/react/Editor` and `@carbon/react/RichText` (wraps `@carbon/tiptap`)
- **Error boundary**: `@carbon/react/ErrorBoundary` — `RootErrorBoundary` (drop-in root `ErrorBoundary` for RR v7 that maps 404 / other HTTP / thrown `Error` to a styled screen) plus its parts (`ErrorScreen`, `GlitchHeading`, `StatusReadout`, `MagneticLink`, `NoiseOverlay`). Wrap it in the app's `Document` and pass `env` so `window.env` is set (the client crashes hydration otherwise). Copy is intentionally hardcoded English, not i18n.
- **Polish**: shadows over borders, `tabular-nums` for dynamic numbers, `active:scale-[0.96]` on pressables, `text-balance`/`text-pretty` for text wrapping

## Cross-References

- `.ai/rules/conventions-ui.md` — full UI conventions, polish principles, review checklist
- `@carbon/tiptap` — editor extensions used by `Editor/` and `RichText/`
- `@carbon/glossary` — term definitions used by `LabelWithHelp`
- `@carbon/form` — form field components (import from `~/components/Form` in apps, not directly)
