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
  `rightIcon`, `asChild`, `shortcut`, `hideShortcutKey`, `shortcutGuard`

### Keyboard shortcuts

`shortcut` binds a hotkey that ref-clicks the button and renders a keycap badge
(`ShortcutKey`); it is inert while disabled/loading and while a dialog the
button isn't inside is open. A bare Enter or Space binding also stands down
while focus is on another control that acts on that key itself (a button, a
link, a switch, a `role="button"` element: `isBareKeyForAnotherControl`,
`@carbon/react`), so Enter on a dialog's Cancel never also presses the page's
Enter-bound button. A shortcut bound with `useShortcutKeys` directly (MES
Start/Pause on Space) needs the same check in its `guard`. The button exposes
its combo as `aria-keyshortcuts` (`ariaKeyShortcuts`). `shortcutGuard`
AND-composes an extra guard.
**Every combo is a named constant** — shared ones in
`packages/react/src/shortcuts.ts` (`SHORTCUTS`), app ones in
`apps/erp/app/shortcuts.ts` / `apps/mes/app/shortcuts.ts`. Never write a combo
string literal at a call site. Many-bindings-to-many-actions use
`useShortcutKeyMap(entries)` (dev-warns on duplicate combos); two-key sequences
(`g` then a letter) use `useShortcutSequence`. The `?` overlay
(`ShortcutHelpOverlay`) lists shortcuts; each app's `ShortcutHelp.tsx` declares
its entries from the central files. `Submit` (`@carbon/form`) defaults to the
`SHORTCUTS.save` binding (⌘/Ctrl+Enter) with a focus-aware guard; pass
`shortcut={false}` to opt out of the binding or `hideShortcutKey` to keep it
silent. The legacy `useKeyboardShortcuts` / `usePrettifyShortcut` hooks are
deleted.

All matching goes through **react-hotkeys-hook** (`useShortcutKeys` and
`useShortcutKeyMap` both delegate to `useHotkeys`) — never hand-roll a
document keydown listener; the library already handles typing-in-input
suppression and physical-key (`event.code`) matching. `useShortcutSequence`
is the one hand-rolled exception (the library has no sequence support).

**Menu item keys.** `DropdownMenuItem` / `ContextMenuItem` / `MenuItem` take
`shortcut={MENU_ITEM_SHORTCUTS.<verb>}` (`packages/react/src/shortcuts.ts`:
Edit E, Rename R, Pin P, Duplicate/Copy C, Download D, View/Open O,
Delete Backspace — the Backspace or Delete key).
The item shows a keycap and runs when its key is pressed — only while its menu
is open, because the handler (`utils/menuShortcut.ts`) sits on the menu
content's `onKeyDown`, not on the document. Unowned letters fall through to
Radix typeahead; keys typed into a field inside the menu are ignored. Give a
Delete item the key only when choosing it opens a confirmation first; an item
that deletes immediately gets none. An item with a keycap never wraps
(`whitespace-nowrap`), so give its menu a `min-w-*`, not a fixed `w-*`. Never
give two items in one menu the same key.

**Interaction design rules** (apply per screen, don't bind mechanically):

- **Enter** is the shortcut when there is one obvious action: a single input
  (native form submit already handles it), a choice screen, "select and
  continue". **⌘/Ctrl+Enter** is for real forms — multiple fields, selects,
  editors — where Enter has other meanings and submission should be deliberate.
- **Badge visibility is a design decision.** Don't advertise a shortcut on a
  trivial screen (login email, OTP screens, single-input dialogs): the binding
  can stay, the badge goes (`hideShortcutKey`). Multi-field forms keep the
  ⌘↵ badge.
- **Choice screens are radio groups**: one tab stop, arrow keys move AND
  select, Enter confirms and continues (Radix radios don't activate on Enter,
  which leaves it free for the continue button's `shortcut`). Use
  `ChoiceCardGroup` (cards, `autoFocus` prop) or `RadioGroupButton`
  (button-styled options); give the screen initial focus on the selected
  option.

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

## Accessibility tree

Biome enforces `useKeyWithClickEvents`, `noStaticElementInteractions`,
`useButtonType` and `noSvgWithoutTitle` (`biome.jsonc`). The patterns the
codebase settled on:

- **One control per action.** A clickable row is a link stretched over the
  row (`after:absolute after:inset-0` on the name's `Link`), with its buttons
  and menus beside it at `relative z-10`, never inside it. Anything else in the
  row that needs the pointer (a tooltip trigger) needs `relative z-10` too, or
  the link covers it.
- **A `role="button"` element never contains a link, a button or a field.**
  Its children are presentational to assistive tech, so they cannot be reached.
  When a row toggles and also holds controls (the document line summaries),
  the row is a pointer-only target (a `biome-ignore` with the reason, and a
  click handler that ignores clicks on `a, button`) and the chevron is the
  `<button aria-expanded>` (see §7 below). A `role="button"` element that handles
  Enter/Space checks `e.target === e.currentTarget` first.
- **Name every control.** Icon-only buttons use `IconButton` (its
  `aria-label` is required); decorative SVGs get `aria-hidden`. A name says
  what the control acts on ("Actions for SO000001", `getRowLabel`), not just
  the verb, when many share a page.
- **Popover focus.** A custom `onCloseAutoFocus` that refocuses the trigger
  must skip a close caused by an outside interaction: the user's click or
  focus has already gone where they wanted it.
- **Page identity.** Record routes export `meta` built with `recordMeta`,
  new-record routes `newRecordMeta`, module layouts `moduleMeta`
  (`apps/erp/app/utils/meta.ts`; MES `apps/mes/app/utils/meta.ts`), and every
  page has one `<h1>` (`RecordHeader`'s title is it on record pages).

## Modals and Drawers

A dialog stays mounted and closes through its `open` prop; Radix then plays the
closing animation and unmounts the content. Follow these, in this order. They
use what Radix and React Router already provide; do not add timers, DOM lookups
or counters to get the same effect.

1. **Pass the condition as `open` / `isOpen`.** Never `{x.isOpen && <Dialog />}`
   or `if (!isOpen) return null`: both remove the dialog before it can animate.
2. **Per-open state goes inside the content.** Radix unmounts
   `ModalContent` / `DrawerContent` on close, so anything in it starts fresh on
   each open. Keep hooks, fetchers and effects in a body component rendered
   there; the exported component is a thin shell (`ConfirmDelete.tsx`,
   `ContractLineBuildModal.tsx`). No `key`, no guard, no `if (open)` effect.
3. **A dialog that shows a record** keeps it until the next open:
   `{item && <D open={isOpen} item={item} />}`, and do not clear `item` on close
   (`useDrawerItem`).
4. **A route rendered as a dialog** uses `useRouteDialog()` and passes
   `open={dialog.open}` / `onClose={dialog.close}`.
5. **`key` means record identity** (`key={record.id}`, when the record can change
   while the dialog stays open). A `key` that counts opens
   (`{d.openCount > 0 && <D key={d.openCount} open={d.isOpen} />}`) is the
   fallback for state that cannot move into the content: a `ModalCard` form,
   whose state is shared with its card mode, and a dialog whose `Modal` or
   `ModalContent` props read that state (`size`, `onOpenChange`,
   `onCloseAutoFocus`).
6. **A dialog that closes as it submits keeps its fetcher in the shell when the
   action redirects.** React Router does not follow a redirect for a fetcher
   that has unmounted (`DocumentSwitchModal`). Close from the fetcher's result
   instead when you can (`ConfigurationEditor`).
7. **On phones every modal and drawer is a bottom sheet.** `ModalContent` and
   `DrawerContent` render a `BottomSheetContent` there (drag down to close),
   keeping the modal's or drawer's own header, body and footer, so a call site
   writes a plain `Modal` / `Drawer` (account settings and search are plain
   modals). Use `BottomSheet` directly only for UI that exists on phones alone
   (the profile sheet, menus). A sheet drags down from its grabber or its
   header; a control in the header does not start a drag. A dialog that keeps
   itself open on a press outside (`onInteractOutside` calls `preventDefault`)
   also stays open on a drag: the sheet springs back.

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

Tactile button feedback. `Button` itself applies `active:scale-[0.98]
active:duration-75`; reuse `Button`/`IconButton` rather than reimplementing. When
hand-rolling a pressable element, match `0.98` (a deeper press reads as the layout moving; never below `0.95`).

```typescript
<button className="active:scale-[0.98] transition-transform">
```

### 5. Minimum Hit Area

Interactive elements need a comfortable hit area (~40×40px). Extend with a
pseudo-element if the visual is smaller.

### 6. Animations

- Use CSS transitions for interactive states (interruptible); keyframes for staged
  sequences.
- Prefer scoping transitions to specific properties (e.g. `transition-transform`,
  or `transition-[background-color,color,transform]` as `Button` does) over
  `transition-all`. <!-- UNVERIFIED: this is a guideline, not absolute — `transition-all` still appears in `InputOTP`, so it is tolerated, not banned -->
- Stagger enter animations (~100ms); keep exit animations subtle.
- Easing comes from the theme tokens in `packages/config/tailwind/theme.css`:
  `ease-out` is the strong UI curve `cubic-bezier(0.23, 1, 0.32, 1)`,
  `ease-in-out` is `cubic-bezier(0.77, 0, 0.175, 1)` and `ease-drawer` is the
  drawer curve `cubic-bezier(0.32, 0.72, 0, 1)` (`Drawer`, `BottomSheet`). Each
  class sets both `transition-timing-function` and, through
  `tailwindcss-animate`, `animation-timing-function`. Don't hand-type
  `ease-[cubic-bezier(...)]`. Motion props take the array form,
  `ease: [0.23, 1, 0.32, 1]`.

- **Motion scale — use these, not new values.** Pick the row for the element;
  the shared components already follow it, so copy them rather than
  re-deriving numbers.

  | Element | Enter | Exit | Easing |
  |---|---|---|---|
  | Button press, small state toggle | 100–150ms | same | `ease-out` (`active:scale-[0.98]`) |
  | Tooltip, small popover | 150ms | same | `ease-out` |
  | Dropdown, select, popover, context menu, hover card | 150ms (the `animate-in` default) | same | `ease-out`, scaling from the trigger (`origin-(--radix-…-transform-origin)`) |
  | Modal (`Modal`, `ModalDrawer` as modal) | 200ms | 150ms | `ease-out`, `zoom-in-95` + fade; stays centred |
  | Drawer / bottom sheet (`Drawer`, `BottomSheet`), and every modal and drawer on a phone | 300ms | 200ms | `ease-drawer`, slide in and out from the same edge; on a phone `ModalContent` / `DrawerContent` render `BottomSheetContent`, so they move as one sheet |
  | Moving something already on screen | 200–300ms | — | `ease-in-out` |

  Rules behind it: exit is faster than enter; never `ease-in` on UI; never
  `scale(0)` (start at 0.95 with opacity); keep UI motion under 300ms except
  drawers; don't animate what a keyboard shortcut opens (`data-instant`);
  reduced motion keeps fades and drops movement (handled in `theme.css`).
  A Radix dialog's parts must close in the same time: Radix removes the
  portal when the outer element (the modal backdrop, the drawer's portal div)
  ends its animation.
  Put a duration on the state it is for (`data-[state=open]:duration-300
  data-[state=closed]:duration-200`): `animate-in` / `animate-out` set their
  own 150ms duration, and a plain `duration-*` loses to them — the drawer's
  "300ms" open ran at 150ms until it moved onto the state variant.

```typescript
// Preferred
className="transition-transform"
// Avoid (broad, can animate unintended properties)
className="transition-all"
```

### 7. AnimatePresence

Motion uses `motion` (imported as `from "motion/react"`; `framer-motion` is no longer a dependency), e.g.
`apps/erp/app/components/SortableList.tsx`. Skip animation on page load with
`initial={false}`:

```typescript
<AnimatePresence initial={false}>
  {isOpen ? (
    <motion.div
      key="panel"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
    >
      ...
    </motion.div>
  ) : null}
</AnimatePresence>
```

A collapsed panel must leave the tab order. Render it only while open, as
above (the document summaries do). When the panel holds state that must survive
a collapse (the supplier's typed prices on `share+/supplier-quote.$id.tsx`),
keep it mounted and end the collapsed variant with
`transitionEnd: { display: "none" }`. Either way the toggle must be a real
`<button aria-expanded>`, or a keyboard user cannot reopen the panel (the
summaries' chevron is a `motion.button` inside the clickable row).

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
