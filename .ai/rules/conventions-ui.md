---
paths:
  - "apps/erp/app/components/**"
  - "apps/mes/app/components/**"
  - "packages/react/**"
---

# UI Conventions

## Use Existing Components First

Before writing any UI, grep `packages/react/src/` and `apps/erp/app/components/`.
Prefer a built-in component (and its variants) over hand-rolled markup, and prefer
built-in variants over ad-hoc `bg-*` / `text-*` classes.

- **Primitives** come from `@carbon/react` — the shared library barrel-exported at
  `packages/react/src/index.tsx`. Components live flat in `packages/react/src/`
  (e.g. `packages/react/src/Button.tsx`), NOT under a `components/` subdir.
- **Form fields** come from `~/components/Form` in the ERP app
  (`apps/erp/app/components/Form/index.ts`), which re-exports `@carbon/form`
  fields plus Carbon domain selectors (Customer, Employee, Item, Location, ...).
- **App-level shared components** live in `apps/erp/app/components/` (barrel
  `index.ts`) and `apps/mes/app/components/` — reach for these before writing new
  cross-feature UI.

```typescript
import { Button, Card, HStack, VStack, IconButton, cn } from "@carbon/react";
import { Input, Select, Submit, Number, Boolean } from "~/components/Form";
```

`cn` (from `@carbon/react`, defined in `packages/react/src/utils/cn.ts`) is the
standard class merge helper — `twMerge(clsx(...))`. Use it to compose classes.

## Button

`Button` (`packages/react/src/Button.tsx`) is the canonical button. Pick a built-in
variant rather than styling a bare element.

- **variant**: `primary` (default) · `secondary` · `solid` · `active` ·
  `destructive` · `ghost` · `outline` · `link`
- **size**: `sm` · `md` (default) · `lg`
- **props**: `isDisabled`, `isLoading`, `isIcon`, `isRound`, `leftIcon`,
  `rightIcon`, `asChild`

```typescript
<Button variant="primary" leftIcon={<LuPlus />}>Save</Button>
<Button variant="secondary" onClick={onClose}>Cancel</Button>
```

For icon-only buttons use `IconButton` (`packages/react/src/IconButton.tsx`) — it
requires an `aria-label` and takes an `icon` prop, sizing the icon to match the
button size.

```typescript
<IconButton aria-label="Collapse" variant="ghost" icon={<LuChevronUp />} />
```

## Form Buttons

`Submit` (from `~/components/Form`) is the submit action; pair it with a plain
`Button` for cancel.

```typescript
<HStack>
  <Submit isDisabled={isDisabled}>Save</Submit>
  <Button variant="solid" onClick={onClose}>Cancel</Button>
</HStack>
```

## Layout Patterns

### Stacks

`VStack` and `HStack` (`packages/react/src/{VStack,HStack}.tsx`) take a numeric
`spacing` prop (maps to Tailwind `space-y-*` / `space-x-*`), default `2`.
VStack supports spacing `0,1,2,3,4,8`; HStack `0,1,2,3,4,6,8`. VStack is
`w-full items-start`; HStack is `items-center`.

```typescript
<VStack spacing={4}>
  <Input name="name" label="Name" />
  <Input name="description" label="Description" />
</VStack>
```

### Grid Layout

```typescript
<div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4">
  <Input name="field1" />
  <Input name="field2" />
  <Input name="field3" />
</div>
```

### Card

`Card` and its subcomponents (`CardHeader`, `CardTitle`, `CardDescription`,
`CardContent`, `CardFooter`, plus `CardAttributes`/`CardAttribute*` for label/value
grids) come from `@carbon/react`. `Card` supports `isCollapsible`. It already
applies `rounded-2xl` + layered shadow on the outer shell and `rounded-2xl` on
`CardContent`, so don't re-add borders/radius — compose with the subcomponents.

## Popovers inside Drawers / Dialogs

`Combobox`, `CreatableCombobox`, `CreatableMultiSelect`, `MultiSelect`, and
`ChoiceSelect` (all `packages/react/src/`) render their options in a
`PopoverContent` portaled to `document.body`. `Drawer` (`Drawer.tsx`) is a Radix
Dialog using `react-remove-scroll` to lock background scroll. Because the popover
is portaled outside the dialog subtree, the scroll-lock's document-level wheel
listener swallows wheel/touch events over the dropdown, so its internal
`overflow-auto` list cannot scroll (symptom: only the first ~6 options show and it
won't scroll).

Required pattern — stop propagation on the `PopoverContent` so events never reach
the scroll-lock listener, and give the scroll container a visible scrollbar:

```typescript
<PopoverContent
  onWheel={(e) => e.stopPropagation()}
  onTouchMove={(e) => e.stopPropagation()}
>
  <div className="overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
    ...
  </div>
</PopoverContent>
```

Any new popover-based dropdown with an internal scroll area used inside a
drawer/dialog must follow this.

## Polish Principles

Apply these when building or reviewing UI. The verified examples below are live in
the codebase.

### 1. Concentric Border Radius

Outer radius = inner radius + padding. (E.g. `Card` shell is `rounded-2xl`.)

```typescript
// Bad: same radius on parent and child
<div className="rounded-xl p-2"><button className="rounded-xl">...</button></div>
// Good: outer is larger
<div className="rounded-2xl p-2"><button className="rounded-lg">...</button></div>
```

### 2. Shadows Over Borders

Prefer layered `box-shadow` for depth over solid borders. `Button` and `Card` use
`shadow-button-base` / inset highlight shadows rather than hard borders.

### 3. Tabular Numbers

For dynamic numbers, prevent layout shift with `tabular-nums` (used in
`packages/react/src/{Count,Progress,BarProgress}.tsx`).

```typescript
<span className="tabular-nums">{count}</span>
```

### 4. Scale on Press

Tactile button feedback. `Button` itself applies `active:scale-[0.96]
active:duration-75`; reuse `Button`/`IconButton` rather than reimplementing. When
hand-rolling a pressable element, match `0.96` (never below `0.95`).

```typescript
<button className="active:scale-[0.96] transition-transform">
```

### 5. Minimum Hit Area

Interactive elements need a comfortable hit area (~40×40px). Extend with a
pseudo-element if the visual is smaller.

### 6. Animations

- Use CSS transitions for interactive states (interruptible); keyframes for staged
  sequences.
- Prefer scoping transitions to specific properties (e.g. `transition-transform`,
  or `transition-[background-color,color,transform]` as `Button` does) over
  `transition-all`. <!-- UNVERIFIED: this is a guideline, not absolute — `transition-all` does appear in a few components (Accordion, Switch, InputOTP), so it is tolerated, not banned -->
- Stagger enter animations (~100ms); keep exit animations subtle.

```typescript
// Preferred
className="transition-transform"
// Avoid (broad, can animate unintended properties)
className="transition-all"
```

### 7. AnimatePresence

Motion uses `framer-motion` (imported as `from "framer-motion"`, e.g.
`apps/erp/app/components/DirectionAwareTabs.tsx`). Skip animation on page load with
`initial={false}`:

```typescript
<AnimatePresence initial={false}>
  ...
</AnimatePresence>
```

### 8. Font Smoothing

Use the Tailwind `antialiased` class for smoothing (applied on `apps/erp/app/root.tsx`
body and a few top-level pages). <!-- UNVERIFIED: no raw `-webkit-font-smoothing` CSS property found in app/package source; `antialiased` class is the mechanism in use -->

### 9. Text Wrapping

Tailwind v4 utilities (NOT `text-wrap-*`):

```typescript
// Headings — used in Heading.tsx, Modal.tsx, Drawer.tsx
<h1 className="text-balance">...</h1>
// Body text — used in Card.tsx (CardTitle)
<p className="text-pretty">...</p>
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Hand-rolling UI instead of grepping `@carbon/react` first | Use the existing component + its variants |
| Ad-hoc `bg-*` / `text-*` instead of a `variant` | Pick the built-in variant (e.g. `Button variant="secondary"`) |
| Same border radius on parent/child | `outerRadius = innerRadius + padding` |
| Numbers cause layout shift | `tabular-nums` |
| Broad `transition-all` | Scope to specific properties where practical |
| Animation on page load | `initial={false}` on AnimatePresence |
| `text-wrap-balance` / `text-wrap-pretty` | `text-balance` / `text-pretty` (Tailwind v4) |
| Tiny hit areas | Extend to ~40×40px |
| Hard borders | Use layered shadows |
| Dropdown inside a Drawer won't scroll (shows ~6 items) | `stopPropagation` on `PopoverContent` `onWheel`/`onTouchMove` |

## Review Checklist

- [ ] Used an existing `@carbon/react` / `~/components/Form` component over custom markup
- [ ] Used a `variant` instead of ad-hoc `bg-*` / `text-*` classes
- [ ] Concentric border radius on nested elements
- [ ] Icons optically centered (use `IconButton` for icon-only)
- [ ] Shadows instead of borders where appropriate
- [ ] Dynamic numbers use `tabular-nums`
- [ ] Pressable elements scale on press (reuse `Button` where possible)
- [ ] Transitions scoped to specific properties, not blanket `transition-all`
- [ ] Enter animations staggered; exit animations subtle (`initial={false}` on load)
- [ ] Interactive elements have a ~40×40px hit area
