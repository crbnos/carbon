# Design System Rules

Rules for UI code in Carbon. These are laws, not suggestions. Follow them when writing or reviewing any UI component.

## Components — Use What Exists

### Decision Tree

| Need | Use | Import From |
|------|-----|-------------|
| Button | `Button` (with variant) | `@carbon/react` |
| Icon-only button | `IconButton` (with aria-label) | `@carbon/react` |
| Form submit | `Submit` | `@carbon/form` |
| Text input | `Input` | `@carbon/form` |
| Number input | `Number` | `@carbon/form` |
| Select/dropdown | `Select` | `@carbon/form` |
| Boolean/checkbox | `Boolean` | `@carbon/form` |
| Date picker | `DatePicker` | `@carbon/form` |
| Domain selector (Customer, Item, etc.) | Named selector | `@carbon/form` |
| Vertical stack | `VStack` (spacing prop) | `@carbon/react` |
| Horizontal stack | `HStack` (spacing prop) | `@carbon/react` |
| Card/container | `Card` / `CardContent` / `CardHeader` | `@carbon/react` |
| Modal/dialog | `Dialog` / `DialogContent` | `@carbon/react` |
| Data table | `Table` (from Tanstack) | `~/components` |
| Tabs | `Tabs` / `TabsList` / `TabsTrigger` | `@carbon/react` |
| Toast/notification | `flash()` from session | `@carbon/auth/session.server` |
| Class merging | `cn()` | `@carbon/react` |
| Icons | Lucide React (`Lu*`) | `react-icons/lu` |

## Button Rules

- ALWAYS use a built-in `variant` — never style a bare `<button>` or `<div>` as a button
- Variants: `primary` · `secondary` · `solid` · `active` · `destructive` · `ghost` · `outline` · `link`
- Sizes: `sm` · `md` (default) · `lg`
- NEVER use raw `onClick` handlers for form submissions — use `Submit` component
- Same-row buttons MUST share the same `size`
- Use `IconButton` (with `aria-label`) for icon-only buttons, not `Button` with `isIcon`

## Layout Rules

- ALWAYS use `VStack` / `HStack` for vertical/horizontal layouts — not raw `flex` divs
- `VStack` spacing: `0, 1, 2, 3, 4, 8` (maps to Tailwind `space-y-*`)
- `HStack` spacing: `0, 1, 2, 3, 4, 6, 8` (maps to Tailwind `space-x-*`)
- NEVER use arbitrary spacing values — use the scale

## Color Rules

- NEVER hardcode Tailwind colors for status indicators (`text-red-500`, `bg-green-100`)
- ALWAYS use semantic status classes or component variants
- Prefer component props (`variant="destructive"`) over color classes
- Background colors: use card/surface components, not raw `bg-*` classes
- NEVER use green/emerald **text** (`text-emerald-*`, `text-green-*`) OR
  yellow/amber **text** (`text-yellow-*`, `text-amber-*`) as an inline status
  indicator (e.g. a "Planned automatically" success note or a "low confidence"
  caution note). Keep inline status understated (Vercel aesthetic): neutral
  `text-muted-foreground`, with a `Lu*` icon (e.g. `LuCircleCheck`,
  `LuTriangleAlert`) if affirmation/emphasis is needed, and let the wording
  carry the meaning. This is about colored *prose*, not chips or icon glyphs —
  `Status`/`Badge` status components (including `color="green"`/`"yellow"`),
  status dots (`bg-green-500`), and severity **icon** colors are fine and
  encouraged for status affordances.

## Typography Rules

- NEVER use arbitrary text sizes (`text-[13px]`)
- Use the Tailwind scale: `text-xs` · `text-sm` · `text-base` · `text-lg` · `text-xl` · `text-2xl`
- Muted text: `text-muted-foreground` (not `text-gray-500`)

## Form Rules

- ALWAYS use `ValidatedForm` from `@carbon/form` for forms
- ALWAYS wrap validation with `validator(schema)` — never raw `schema.parse()`
- Every input MUST have a visible label (via component `label` prop or explicit `<label>`)
- Use domain selectors from `@carbon/form` for foreign key references (Customer, Item, Employee, etc.)

## Icon Rules

- ALWAYS use `react-icons/lu` icons (prefixed `Lu*`)
- NEVER use inline `<svg>` elements
- NEVER use other icon libraries (heroicons, fontawesome, etc.)

## Table / Data Display Rules

- Use existing table components from `~/components` — don't build custom tables from scratch
- Sort and filter controls should use existing patterns from similar pages

## Accessibility Rules

- ALWAYS use `focus-visible:` for focus states, not `focus:`
- Dialogs MUST trap focus and support Escape to close
- `IconButton` MUST always have an `aria-label`
- Interactive elements MUST be keyboard accessible

## Boy Scout Rule

When modifying a file, fix any DS violations you encounter on the lines you touch. Don't go out of scope, but don't leave broken patterns on lines you're already editing.

## Cross-References

- Full UI conventions: `.claude/rules/conventions-ui.md`
- Form conventions: `.claude/rules/conventions-forms.md`
- Component source: `packages/react/src/`
- Form components: `apps/erp/app/components/Form/`
