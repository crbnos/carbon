# UI components and forms lessons

@carbon/react components, ValidatedForm forms, modals and drawers, the design system, styling, keyboard, accessibility.

## A dropdown that lives inside an editor popup must own its keys on the document, not take them from its host

```scope
id: a-dropdown-that-lives-inside-an-editor-popup-must-own-its-ke
paths: ["apps/erp/app/modules/workflows/ui/Builder/fields/VariableTreeMenu.tsx"]
triggers: ["ReactRenderer","@tiptap/suggestion"]
```

**Context:** The workflow builder's variable menu (`apps/erp/app/modules/workflows/ui/Builder/fields/VariableTreeMenu.tsx`), hosted both inside a tiptap suggestion popup and inside a Radix popover. Arrow-key navigation stayed dead across two rounds of fixes.

**Problem:** The menu exposed a `ref` handle and relied on each host to call it — the tiptap suggestion plugin's `onKeyDown` delegation in one case, the popover search input's `onKeyDown` in the other. That chain is long (ProseMirror direct props → plugin order → `ReactRenderer` ref → imperative handle) and every link is invisible when it breaks: the menu still renders, so the failure looks like "keys do nothing" with no error anywhere. Debugging it by reading the chain repeatedly produced plausible-but-wrong root causes.

**Rule:** Bind the navigation keys in a `document` `keydown` listener in the **capture** phase, inside the menu component itself, and `preventDefault()` + `stopPropagation()` only for keys it claims. The host then cannot swallow or fail to forward anything, and both hosts get identical behaviour for free. Guard the listener on the menu's own root being connected and visible — a popup that is *hidden* rather than unmounted (tippy's `hide()`) leaves the component mounted and would keep eating keys. Never claim `Escape`; dismissal belongs to the wrapping popup. Keep DOM focus in the field being typed into (search-as-you-type depends on it) and mark the highlighted row `aria-selected` instead of focusing it.

**Applies to:** any menu rendered by tiptap's `ReactRenderer` or otherwise mounted outside the React tree that owns the focused input.

## A grid position must name a sample id, not `samples[index]` of a reloaded list

```scope
id: a-grid-position-must-name-a-sample-id-not-samples-index-of-a
paths: ["apps/erp/app/modules/quality/ui/Inspections/InspectionMeasurementGrid.tsx","apps/mes/app/components/Inspection/InspectionMeasurementMatrix.tsx"]
triggers: ["placeSamples","inspectionSample(","referencedTable"]
```

- **Context:** Inspection grids (ERP `InspectionMeasurementGrid`, MES `InspectionMeasurementMatrix`) map each column or row to an `inspectionSample`.
- **Problem:** The loader embedded `inspectionSample(*)` with no order, and an UPDATE moves a row. Each save broadcasts `inspectionSample`, so the page reloaded and `samples[index]` named another sample: the next reading was saved on the wrong part. A stubbed harness never showed it; only the running stack (realtime + Postgres) did.
- **Rule:** In any loader whose list a UI addresses by position, order embedded children explicitly (`.order(col, { referencedTable })`). Test write paths on `crbn up`, not only against a stub. The rest is in `.claude/rules/inspection-system.md`.
- **Applies to:** any grid or list that writes through positions over data a realtime reload can reorder.

## A new record type copies its sibling's UI, not the generic archetype

```scope
id: a-new-record-type-copies-its-sibling-s-ui-not-the-generic-ar
paths: [".ai/specs/*.md",".ai/plans/*.md",".claude/skills/carbon-design/SKILL.md","apps/erp/app/routes/x+/**/new.tsx"]
triggers: []
```

**Context:** The lessee lease (2026-10-11) shipped a Card form on `new.tsx` that redirected to a 3-pane workspace, with Draft terms edited in the properties panel. Its siblings — the rental agreement and the AR contract — are set up in a full-page wizard (`~/components/Setup`). The user called it a big mistake, and the UI was rewritten.

**Problem:** The plan named the sibling for the server side (post-lease mirrors the rental functions) but not for the UI, and the design skill's "where create opens" rule sent a record with a workspace to a Card form. The setup wizard was documented nowhere, so the subagent that built the UI followed the generic rule faithfully.

**Rule:** When the sibling's pattern is missing from `carbon-design`, add it there in the same change (Archetype J was added for this one). The rest is in the root `AGENTS.md` (Always) and `.claude/skills/plan/SKILL.md`.

**Applies to:** `/spec-writing`, `/plan`, `carbon-design`, and any subagent prompt that builds UI.

## A React handler on a dialog also hears the dialogs opened from inside it

```scope
id: a-react-handler-on-a-dialog-also-hears-the-dialogs-opened-fr
paths: ["packages/react/src/utils/dialog.ts"]
triggers: ["startsSheetDrag","BottomSheetContent"]
```

**Context:** On phones every `Modal` and `Drawer` is a bottom sheet, and a sheet drags
down from its header. The drag handlers sit on the sheet's panel (`BottomSheetContent`).
Account settings is a sheet, and the signature dialog opens from one of its panes.

**Problem:** React passes a synthetic event up through the React tree, not the DOM
tree, so it crosses portals. The signature sheet is portaled to `<body>`, but it is
rendered inside the account pane, so a press on its header also reached the account
sheet's `onPointerDown`. Both sheets started a drag, and closing the signature also
closed account settings.

**Rule:** A handler on a dialog panel that acts on `event.target` checks that the
target is in its own panel (`panel.contains(...)`), never only that it matches a
selector. A dialog opened from inside it is a different panel that still delivers its
events here.

**Applies to:** `startsSheetDrag` (`packages/react/src/utils/dialog.ts`), and any
`onPointer*`, `onKeyDown` or `onClick` placed on a `Modal`, `Drawer`, `BottomSheet` or
popover content.

## A state set in a mount effect is drawn once before the effect runs

```scope
id: a-state-set-in-a-mount-effect-is-drawn-once-before-the-effec
paths: ["apps/erp/app/components/BoMExplorer/**","apps/erp/app/components/TreeView/**"]
triggers: ["useTree(","collapsedIds","BoMExplorerProvider"]
```

**Context:** The quote explorer's method tree mounted with every node expanded
and collapsed it to one level in a `useEffect`.

**Problem:** React paints before it runs `useEffect`. The browser drew the whole
tree open for one frame, then the effect collapsed it, so every expand of a
line jittered. Nothing in the code looks wrong; it shows only frame by frame.

**Rule:** When a component's first state is known at render time, give it as
the initial state (`useTree`'s `collapsedIds`, a `useState` initializer), not as
a correction in an effect. If it can only be computed after layout, use
`useLayoutEffect`.

**Applies to:** `BoMExplorerProvider` / `useTree` callers, and any component
that sets expanded, selected or measured state on mount.

## A temporary override lives in the thing it overrides, not in its callers

```scope
id: a-temporary-override-lives-in-the-thing-it-overrides-not-in
paths: ["packages/utils/src/themes.ts","apps/*/app/services/theme.server.ts","apps/erp/app/components/MeshGradientBackground.tsx"]
triggers: ["SeasonalTheme","seasonalThemes","resolveTheme("]
```

**Context:** A seasonal theme had to be the theme for everyone while in season (2026-10). The first cut replaced the cookie read in all three apps' `getTheme` (`services/theme.server.ts`) with a `resolveTheme` call that named the seasonal theme.

**Problem:** Undoing it meant rewriting three deleted cookie reads from memory, and nothing pointed at them: deleting the theme's file would just break the imports. The mesh colors in `MeshGradientBackground.tsx` (a `Record<string, …>`, so no compile error) and a test that imported the theme directly had the same shape. The removal checklist went stale twice as pieces were added.

**Rule:** Any temporary behaviour (a feature flag, a promo, seasonal UI) lives on the removable unit itself, and its callers stay generic, so deleting the unit turns the behaviour off. Keep ONE removal checklist, next to the code, and make every other comment point to it. The rest, for seasonal themes, is in `.claude/rules/coding-conventions.md` (Theme System).

**Applies to:** `packages/utils/src/themes.ts` seasonal themes, any feature flag, promo or seasonal UI.

## An inline editor built in a memo with changing dependencies drops keystrokes

```scope
id: an-inline-editor-built-in-a-memo-with-changing-dependencies
paths: ["apps/erp/app/modules/quality/ui/Inspections/InspectionMeasurementGrid.tsx"]
triggers: ["editableComponents","EditableNumber","EditableText","EditableList"]
```

**Context:** The inspection grid (`InspectionMeasurementGrid.tsx`) moves to the next
cell on Enter. Typing "0.139" straight after Enter saved "39".

**Problem:** `editableComponents` was a `useMemo` that called `EditableNumber(...)`
per column, with the grid's cell status among its dependencies. The previous cell's
save landed while the inspector typed: its status changed, the memo made new editor
component types, and React remounted the open input. The new input started from the
saved value, so the characters typed before the remount were lost. A slow, step-by-step
test passed because the save had landed before the first key.

A browser stress run found two more remounts of the same kind. The By part rows were
keyed by sample id, so the first save of a part (which creates the sample) re-keyed the
row; and the editors were rebuilt whenever a spare sample column was added. A first fix
also passed Lingui's `t` through the ref and crashed: `t` is a macro bound to
`useLingui()`, not a function value. Typecheck passed; only the browser showed it.

**Rule:** The components in a Table's `editableComponents` keep one identity while a
cell is open: make each column's editor once (cache it by column key) and read changing
state (statuses, callbacks) through a ref. Translate strings before they go into the
ref; never pass `t` itself. A row's `getRowId` never changes while the row is on
screen — key a row by something that exists before its first save. To test an inline
editor, hold the save (wrap `fetch` with a delay), type half a value, let the save land,
then type the rest.

**Applies to:** every `<Table editableComponents>` whose editors are made inside
`useMemo`/`useCallback` (`EditableNumber`, `EditableText`, `EditableList`, …).

## Content sized from its own scroll box needs a fixed scrollbar

```scope
id: content-sized-from-its-own-scroll-box-needs-a-fixed-scrollba
paths: []
triggers: ["useResizeObserver"]
```

- **Context:** The document preview draws PDF pages at the width of the box that scrolls them.
- **Problem:** A page about as tall as the box looped forever: the scrollbar narrowed the box, the narrower page fit, the scrollbar left, the wider page no longer fit. It redrew about 60 times a second, at only some window heights, so it looked like a random flicker on open.
- **Rule:** When a box's content takes its size from the box, keep the scrollbar's space fixed (`overflow-y-scroll`) so the width cannot depend on the content's height.
- **Applies to:** Any `useResizeObserver` width that sizes content inside the observed scroll box.

## `form.submit()` bypasses React Router; `ValidatedForm` needs a real submitter

```scope
id: form-submit-bypasses-react-router-validatedform-needs-a-real
paths: ["packages/form/src/components/InputOTP.tsx","packages/form/src/ValidatedForm.tsx"]
triggers: [".submit()","requestSubmit("]
```

**Context:** `@carbon/form`'s `InputOTP` auto-submits when the last digit is typed, using `form.submit()`. On the `/mfa` and `/verify` screens the error `<Alert>` reading `fetcher.data` could therefore never render — wrong codes produced no feedback at all. Switching to a bare `form.requestSubmit()` then made the form do nothing whatsoever.

**Problem:** Two separate traps. `HTMLFormElement.submit()` does not fire the submit event, so React Router never intercepts it and `fetcher.data` stays permanently undefined — the request goes out as a raw document POST. But `requestSubmit()` with NO argument leaves `nativeEvent.submitter` null, and `ValidatedForm.handleSubmit` early-returns unless `submitter?.form === target` — so it silently does nothing.

**Rule:** Programmatic submits inside a `ValidatedForm` must pass a submitter: `form.requestSubmit(form.querySelector('button[type="submit"]'))`, which means the form needs a real submit button (good for accessibility anyway). Never use `form.submit()` in a React Router app. When a form renders errors from `fetcher.data`, verify the submit path actually reaches the fetcher — an unreachable error branch looks identical to "no errors happen".

**Applies to:** `packages/form/src/components/InputOTP.tsx`, `packages/form/src/ValidatedForm.tsx`, any auto-submitting form field.

## react-aria compares `formatOptions` by reference — an inline literal wipes half-typed numbers

```scope
id: react-aria-compares-formatoptions-by-reference-an-inline-lit
paths: ["packages/react/src/Number.tsx","packages/form/src/components/Number.tsx","packages/form/src/components/NumberControlled.tsx","packages/form/src/components/ArrayNumeric.tsx"]
triggers: ["formatOptions={{","useStableFormatOptions","react-aria-components"]
```

**Context:** Any `NumberField` / `Number` / `NumberControlled` field that passes `formatOptions={{ ... }}` at the call site (real case: the MES Log Completed quantity in `apps/mes/app/components/JobOperation/components/QuantityModal.tsx`, where operators could not enter `1.5`).

**Problem:** `useNumberFieldState` (`@react-stately/numberfield`) guards with `formatOptions !== prevFormatOptions` — a **reference** check — and on a change calls `setInputValue(format(numberValue))`, replacing whatever is in the input with the last *committed* number. `react-aria-components`' `NumberField` spreads caller props straight through, so an inline object literal is a new reference every render. Any parent re-render while the user is mid-edit destroys the in-progress text. Commit only happens on blur/Enter/stepper, so a single digit usually survives but a decimal (`1.` → `1.5`, two-plus keystrokes) reliably does not. It reads as "the field doesn't support decimals" even though the format options, the zod validator, and the numeric DB column all allow them.

**Rule:** If you build another react-aria wrapper that forwards `formatOptions`, stabilize it by value as `packages/react/src/Number.tsx` does (`useStableFormatOptions` / `areNumberFormatOptionsEqual`). Do not "fix" this class of bug by only adding/adjusting `formatOptions` at the call site — that is what introduced it here. The same trap holds for any react-aria prop compared by identity. The rest is in `.claude/rules/numeric-precision.md`.

**Applies to:** `packages/react/src/Number.tsx`; every `formatOptions={{ ... }}` call site in `apps/erp` / `apps/mes` (~144); `packages/form/src/components/{Number,NumberControlled,ArrayNumeric}.tsx`, whose `rest.formatOptions ?? ({ ... })` default also allocates a fresh object each render.

## Seed UI-only controlled fields through the form defaults

```scope
id: seed-ui-only-controlled-fields-through-the-form-defaults
paths: ["apps/erp/app/modules/invoicing/ui/Payment/PaymentForm.tsx","apps/erp/app/modules/invoicing/ui/Payment/PaymentApplyTable.tsx"]
triggers: ["SelectControlled","paymentKind"]
```

**Context:** Payment type choices combine counterparty and cash direction while the persisted paymentType remains Receipt or Disbursement.

**Problem:** Passing only SelectControlled.value left the initial registered paymentKind empty in the real browser; unit mocks did not model form initialization. A composer also retained old targets after a saved header identity changed.

**Rule:** Include a UI-only field's initial value in ValidatedForm defaults, and key stateful composers by the document/party/currency/direction identity whose data they hold. Verify the initial label and actual submitted fields in the browser.

**Applies to:** PaymentForm, PaymentApplyTable, and other forms using derived presentation choices.

## The desktop rail can be transparent, and a sortable row can be tall

```scope
id: the-desktop-rail-can-be-transparent-and-a-sortable-row-can-b
paths: ["packages/react/src/NavRail.tsx","apps/erp/app/components/Layout/Navigation/**"]
triggers: ["closestCenter","pointerWithin"]
```

**Context:** Customize added a tree under each module row in `NavRail`. The rail scrolled as a whole, so the footer with Save and Cancel needed to stay in view.

**Problem:** A sticky footer with `bg-background` passed in the default theme. A color theme makes the rail transparent, so the footer painted a solid patch on the frame. Separately, `closestCenter` compared the center of a tall row with an open tree, so the row did not reorder.

**Rule:** In the rail, never paint a background to hide content that scrolls under it. Scroll the list and keep the footer outside the scroll area. Check rail changes with a color theme (`theme=forge`). For a sortable item with variable height, follow the pointer with `pointerWithin`, and keep `closestCenter` as the fallback for the keyboard.

**Applies to:** `packages/react/src/NavRail.tsx`, `apps/erp/app/components/Layout/Navigation/`.

## A bare FormLabel outside FormControl 500s the whole route

```scope
id: a-bare-formlabel-outside-formcontrol-500s-the-whole-route
paths: ["packages/react/src/Form/FormLabel.tsx","packages/react/src/Form/FormError.tsx","apps/erp/app/modules/*/ui/**/*Form.tsx"]
triggers: ["<FormLabel","<FormError","useFormControlContext"]
```

**Context:** The returns-module line forms (`SalesReturnOrderLineForm`, `PurchaseReturnOrderLineForm`) used `<FormLabel>` as a standalone section heading for the tracked-entity picker area.

**Problem:** `FormLabel` (`packages/react/src/Form/FormLabel.tsx`) calls `useFormControlContext()`, which **throws** outside a `<FormControl>`. The throw happens at render, so the route's error boundary replaces the page — the user sees "Error 500. Something broke on our end." on an otherwise-valid URL. Subtler: when the crash is below a `ValidatedForm`, the form unmounts, so a page can LOOK fine in a stale snapshot while its Save button is dead. The error is only visible in the browser console (`useFormControlContext() must be used inside of a FormControl`); the server log shows nothing useful.

**Rule:** `FormLabel`/`FormError` are only valid inside a `<FormControl>`. For a standalone section heading in a form, use a plain `<label>`/heading element. When a page 500s with no server error, check the browser console for context-hook throws before suspecting the loader — and treat "form renders but Save does nothing" as a possible sibling-render crash, not a submit bug.

**Applies to:** any usage of `packages/react/src/Form/{FormLabel,FormError}.tsx`; form components under `apps/erp/app/modules/*/ui/`.

## A cookie that was only ever written is not a stored preference

```scope
id: a-cookie-that-was-only-ever-written-is-not-a-stored-preferen
paths: ["packages/react/src/Sidebar.tsx","packages/react/src/NavRail.tsx"]
triggers: ["document.cookie","localStorage","SidebarProvider"]
```

**Context:** The navigation rail's pin toggle (2026-10-13) first restored the pinned state from `SidebarProvider`'s `sidebar:state` cookie.

**Problem:** `SidebarProvider` (`packages/react/src/Sidebar.tsx`) had written that cookie on every open/close for a long time, but no loader read it. Old sessions already held `sidebar:state=true` from a `SidebarTrigger` or ⌘B, so reading it opened the rail for users who had never pinned it.

The write was then removed (nothing reads it), so the rail always starts collapsed.

**Rule:** Do not start reading a cookie, local-storage key or column that code has only ever written. Its values were never a user's deliberate choice. Give the new preference a new name, or start every user from the default.

**Applies to:** `SidebarProvider` and any other write-only client state (`document.cookie`, `localStorage`) that a loader or component begins to read.

## A drag re-rendered every card on the board

```scope
id: a-drag-re-rendered-every-card-on-the-board
paths: ["apps/erp/app/modules/production/ui/Schedule/Kanban/**"]
triggers: ["useSortable","useSensor("]
```

**Context:** The schedule boards (operations, dates, batches) render one sortable card per operation or job, each with a form, avatars, tooltips and a menu.

**Problem:** A drag stuttered: with 82 cards, six frames of a 90-frame sweep took over 100 ms. Two causes. dnd-kit re-renders every `useSortable` consumer when the drop target changes, and the hook sat inside the card, so every card's whole body rendered each time. And `useSensor(KeyboardSensor, { coordinateGetter })` passed a new options object on every render: dnd-kit memoizes the sensor on it, so every draggable got new `listeners`, which defeats `memo` on anything that takes them.

**Rule:** A sortable card is a thin shell that calls `useSortable` and a `memo`ized body that takes plain props (`sortableCardProps` in `Schedule/Kanban/cardShell.ts`). A context every card reads must have a stable value. To find what re-renders, count renders per component during a scripted drag; do not guess. The rest is in the `no-inline-sensor-options` check.

**Applies to:** `apps/erp/app/modules/production/ui/Schedule/Kanban/**`; any dnd-kit board or list with more than a few dozen items.

## A JSON import attribute fixes the server and breaks the browser

```scope
id: a-json-import-attribute-fixes-the-server-and-breaks-the-brow
paths: ["packages/react/src/utils/generatedAvatar.ts","apps/*/vite.config.ts"]
triggers: ["type: \"json\"","ssrNoExternal"]
```

**Context:** `@carbon/react` loads each DiceBear style's JSON with `import()` (`packages/react/src/utils/generatedAvatar.ts`). The same code runs in the browser (the avatar picker) and on the server (the `/file/avatar/:value` route).

**Problem:** On the server, Vite leaves a dependency's import external, and Node refuses JSON without `with: { type: "json" }` (`ERR_IMPORT_ATTRIBUTE_MISSING`). Adding the attribute fixed the route. But Vite passes the attribute through to the browser's `import()`, and serves the JSON as `text/javascript`, so the browser rejected every style and the picker previews stayed grey (2026-10-08). Typecheck, unit tests and the server route all passed; only the browser saw it.

**Rule:** Never put an import attribute on a JSON import in code that also runs in the browser. Make the server bundle the package instead: add it to `ssrNoExternal` in each app's `vite.config.ts` (the ERP and MES lists apply to both `ssr.noExternal` and `environments.ssr.resolve.noExternal`). To check the browser side, fetch the module from the dev server (`curl $ERP_URL/@fs<absolute path>`) and confirm the `import()` call has no second argument.

**Applies to:** `packages/react/src/utils/generatedAvatar.ts`; any isomorphic code that imports JSON from a dependency.

## A library that every page renders must not be imported statically

```scope
id: a-library-that-every-page-renders-must-not-be-imported-stati
paths: ["packages/react/src/Avatar.tsx","packages/react/src/GeneratedAvatar.tsx","packages/react/src/NavRail.tsx","packages/react/src/utils/generatedAvatar*.ts","packages/react/package.json"]
triggers: ["@dicebear/core"]
```

**Context:** `Avatar` (`@carbon/react`) is in the shell of every app. It renders generated avatars with `@dicebear/core`.

**Problem:** A static `import { Avatar, Style } from "@dicebear/core"` put about 156 KB minified (25 KB gzipped) into the main bundle of the ERP, MES and academy, on every page, whether or not a generated avatar was shown (found in self-review, 2026-10-08). Typecheck, tests and Biome all passed. Only a bundle measurement showed it.

**Rule:** In a component that every page renders, import a heavy library with `import()` at the point of first use, and keep only `import type` at the top of the file. Check with a split bundle: `npx esbuild <file> --bundle --splitting --format=esm --minify --outdir=/tmp/out '--external:@carbon/*' --external:react`. The entry file must stay small, and the library must be a separate chunk.

**Applies to:** `packages/react/src/**` components used in app shells (`Avatar`, `NavRail`, layout parts); any new dependency of `@carbon/react`.

## A plain `duration-*` does not time `animate-in` / `animate-out`

```scope
id: a-plain-duration-does-not-time-animate-in-animate-out
paths: ["packages/react/src/Modal.tsx","packages/react/src/Drawer.tsx","packages/react/src/BottomSheet.tsx"]
triggers: ["animate-in","animate-out"]
```

**Context:** The modal was meant to open in 200ms and the drawer in 300ms; both opened in 150ms.

**Problem:** `tailwindcss-animate`'s `animate-in` / `animate-out` set `animation-duration` themselves (the 150ms default). They are used as `data-[state=open]:animate-in`, and a state-variant rule comes after a plain `duration-300` in the CSS, so the plain duration never applied. Only the closing durations, already written as `data-[state=closed]:duration-200`, worked. Nothing looked wrong: the motion was simply shorter than the class said.

**Rule:** Verify an enter/exit duration with `getComputedStyle(el).animationDuration` in each state, not by reading the class list. The rest is in `.claude/rules/conventions-ui.md` (Animations).

**Applies to:** `Modal.tsx`, `Drawer.tsx`, `BottomSheet.tsx` (fixed), and any component that pairs `animate-in`/`animate-out` with a duration.

## A touch drag needs pointer events, `touch-action`, and speed from the moves

```scope
id: a-touch-drag-needs-pointer-events-touch-action-and-speed-fro
paths: ["packages/react/src/utils/drag.ts","apps/erp/app/utils/drag-sensors.ts","packages/config/tailwind/theme.css"]
triggers: ["onMouseDown","PointerSensor","TouchSensor","dragControls","usePaneResize","touch-none"]
```

**Context:** A gesture audit drove the code with Chrome's real touch input. The
inspection splitters, a dozen drag handles and the bottom sheet's flick all failed.

**Problem:** A finger fires no `mousemove`, so a `onMouseDown` drag is dead on touch,
and `touch-none` hides that. A `PointerSensor` or Motion `dragControls` handle without
`touch-action: none` gets one move, then `pointercancel`, and the page scrolls. A
`pointerup` carries the last move's position, so its distance from that move is 0 and
a flick reads as no speed. A `TouchSensor` activates with a `TouchEvent`, which has no
`clientY`.

**Rule:** Start a drag with pointer events and capture. Put `touch-none` on a handle;
a whole draggable row or card uses `MouseSensor` + `TouchSensor` with a delay instead,
plus `pointer-coarse:select-none`, because the hold that starts the drag also selects text.
ERP sensor options come from `~/utils/drag-sensors`, never a local constant, so every
drag starts the same way; only a custom keyboard `coordinateGetter` stays with its board.
Read a release's speed from the moves (`releaseVelocity`). Read a dnd-kit
`activatorEvent` with `getEventCoordinates`. The `width >= 48rem` clause of the `hover`
variant in `theme.css` is what lets a tap reveal `md:opacity-0 group-hover:opacity-100`
controls on a tablet: do not remove it without another way to reach them.

**Applies to:** anything the user drags; `packages/react/src/utils/drag.ts`,
`usePaneResize`, dnd-kit sensor choices, `packages/config/tailwind/theme.css`.

## Full-screen height calcs must subtract the app-shell inset

```scope
id: full-screen-height-calcs-must-subtract-the-app-shell-inset
paths: ["apps/erp/app/routes/x+/_layout.tsx","apps/erp/app/components/Layout/Panels.tsx","apps/erp/app/components/Layout/Navigation/CollapsibleSidebar.tsx"]
triggers: ["100dvh","--topbar-height","--content-inset"]
```

**Context:** The ERP app shell (`apps/erp/app/routes/x+/_layout.tsx`, PR #1551) moved
content into an inset floating panel with `md:mt-2 md:mb-2` (8px top + 8px bottom
gutters). ~81 full-screen pages/explorers sized themselves with
`calc(100dvh - var(--topbar-height) [- var(--header-height)])`, which assumes the
content spans the full viewport.

**Problem:** Those containers are 16px taller than the panel at md+, so bottom-pinned
content is pushed below the panel's clipped edge. The Procedures "Add Step" footer was
sheared in half; the overflow was invisible on pages whose content merely scrolls.

**Rule:** `vh`/`dvh` ignore the panel inset by nature, so any full-height calc inside the
content panel must subtract `var(--content-inset)` (defined in `styles/tailwind.css`: 0
below md, 1rem at md+), e.g. `h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]`.
Prefer `h-full`/flex height inheritance from `<main>` for new pages so the inset never
has to be tracked by hand. Do NOT add the inset to viewport-fixed/body-portaled elements
(dialogs, drawers) or to `PrimaryNavigation`, which live outside the panel.

**Applies to:** every `calc(100dvh-var(--topbar-height)...)` in `apps/erp/app`, the shared
`components/Layout/Panels.tsx` + `components/Layout/Navigation/CollapsibleSidebar.tsx`, and any new
full-screen ERP route.

## position:sticky inside a horizontal board needs a content-width row and a clamped scroll root

```scope
id: position-sticky-inside-a-horizontal-board-needs-a-content-wi
paths: ["apps/*/app/**/ColumnCard.tsx","apps/erp/app/utils/drag-sensors.ts"]
triggers: ["sticky left-0","BoardContainer","MeasuringStrategy"]
```

**Context:** Making the people board's Unassigned column sticky worked for one viewport-width of scrolling, then scrolled away; fixing that caused page-level overflow on small screens.

**Problem:** Sticky elements only stick within their parent's bounds. The flex row inside the Radix ScrollArea was viewport-width (columns overflowed it), so the sticky column ran out of parent after one screenful. Adding `min-w-max` fixed that but let the ScrollArea (a flex item, which sizes to content) exceed ITS parent, pushing overflow to the page.

**Rule:** Clamp the scroll root around the `min-w-max` row (`w-full min-w-0 max-w-full`), so the row cannot push overflow to the page, and make the column `sticky left-0 z-10` with an opaque background. The rest is in `.claude/rules/scheduling-data-structures.md`.

**Applies to:** `BoardContainer` (`ColumnCard.tsx`) and any kanban wanting a pinned column; any dnd-kit board with sticky droppables.

## react-aria's blur commit makes the input formatter part of arithmetic

```scope
id: react-aria-s-blur-commit-makes-the-input-formatter-part-of-a
paths: ["apps/erp/app/components/Form/TaxFields.tsx"]
triggers: ["formatOptions","NumberControlled","EditableNumberCell","INPUT_FORMAT"]
```

**Context:** The numeric-precision standard's motivating bug — a user typed 6.25% tax, saved, reopened, and read 6.22%.

**Problem:** react-aria NumberField commits on blur by running `parse(format(value))` — whatever `formatOptions` the input carries re-rounds the committed number. A currency-formatted amount input rounds to cents on blur; the old bidirectional tax pair (amount edit → percent = amount/subtotal, percent edit → amount = subtotal×percent) then overwrote the typed 6.25% with 0.56/9.00 = 6.22%. Nothing in zod, the column type, or the service was wrong — the INPUT FORMATTER did the rounding, and the coupling propagated it.

**Rule:** **Round a derived value to the scale of the field that will hold it BEFORE putting it there**, in any input, not only the tax pair. An unrounded 0.5625 in a cents-formatted input is re-committed as 0.56 on blur, which registers as a genuine change and feeds back through any coupling. The rest is in `.claude/rules/numeric-precision.md`.

**Applies to:** every `formatOptions` on an editable `NumberField`/`NumberControlled`/`EditableNumberCell`; `apps/erp/app/components/Form/TaxFields.tsx`; `.claude/rules/numeric-precision.md`; the `no-inline-fraction-digits` conformance check.

## `scroll-fade` on a Radix tab panel keeps every visited tab on screen

```scope
id: scroll-fade-on-a-radix-tab-panel-keeps-every-visited-tab-on
paths: ["apps/mes/app/components/WorkRecord.tsx"]
triggers: ["scroll-fade"]
```

**Context:** The MES work record (`WorkRecordPane`, `apps/mes/app/components/WorkRecord.tsx`) and the job operation view put each tab's `TabsContent` in one grid cell (`[grid-area:main]`) and made that panel the scroller, with `scroll-fade`.

**Problem:** `scroll-fade` is a scroll-driven CSS animation (`packages/config/tailwind/theme.css`). Radix `Presence` keeps a closing panel mounted until its own animation fires `animationend`, which a scroll-driven animation never does. Every tab once opened stayed mounted, and they drew on top of each other: a service job's Findings heading over the customer name, Photos over Details.

**Rule:** Never put `scroll-fade` (or any `animation`) on an element Radix mounts and unmounts — `TabsContent`, dialog, popover or dropdown content. Put the scroll and `scroll-fade` on a child div.

**Applies to:** `TabsContent` and every Radix `Presence`-driven content element, in the ERP, the MES and `@carbon/react`.

## Seeding useState from a prop goes stale when the document flips state in place

```scope
id: seeding-usestate-from-a-prop-goes-stale-when-the-document-fl
paths: ["apps/erp/app/components/Table/Table.tsx"]
triggers: ["forceEditMode"]
```

**Context:** After Rectify flipped a Posted inventory count back to Draft, the lines table stayed read-only until a full page reload.

**Problem:** `Table` read `forceEditMode` only as the `useState` initial value. Rectify/Post actions revalidate the route in place — the component never remounts, so the prop change never reached the state, and the Edit/Lock toggle is hidden while `forceEditMode` is set, leaving no way to recover. The same staleness applied in the opposite direction after posting a Draft (table looked editable on a read-only document).

**Rule:** When a prop derives from a document's mutable status (Draft/Posted etc.) and controls interaction mode, sync it with an effect (`useEffect(() => setEditMode(forceEditMode), [forceEditMode])`) or derive it instead of seeding state once. Test the transition without a reload — loader revalidation does not remount components.

**Applies to:** `apps/erp/app/components/Table/Table.tsx` (`forceEditMode`), any component seeding state from status-derived props on revalidating routes.

## A collapsed form section keeps its fields mounted

```scope
id: a-collapsed-form-section-keeps-its-fields-mounted
paths: ["apps/erp/app/components/Form/FormLayout.tsx","apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx"]
triggers: ["FormSection","CollapsibleContent"]
```

**Context:** The New Project drawer and the project Settings page fold advanced fields into sections (`FormSection`, `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx`). The form posts the whole record (`projectValidator`), and the action writes every column it receives.

**Problem:** A section that unmounts its fields when closed posts nothing for them. The action would then write null or the default for each of those columns, so saving the name on Settings would clear the cost account, the planning group or the plan lock, with no error. (Decision D14 of the rebuild plan; caught at design time, not in production.)

**Rule:** A collapsible section inside a form that saves the whole record renders its children with `forceMount` and hides them (`CollapsibleContent forceMount className={cn(!open && "hidden")}`). It also opens while one of its fields has a validation error (`fieldNames`), so an error is never hidden. The same holds for any field hidden by a condition (a DCAA-only card): hide it, keep it mounted.

**Applies to:** `FormSection` and every collapsible group or conditional card inside a `ValidatedForm` whose action saves all fields at once.

## A `@container` block has no intrinsic width — it vanishes in a shrink-to-fit parent

```scope
id: a-container-block-has-no-intrinsic-width-it-vanishes-in-a-sh
paths: ["apps/erp/app/modules/production/ui/Planning/PlanningActionLines.tsx","apps/erp/app/modules/production/ui/Planning/PlanningOrderGrids.tsx","packages/react/src/VStack.tsx"]
triggers: ["@container","PlanningActionLines"]
```

**Context:** The planning grid's expanded row (`PlanningActionLines`) was reused inside the
order drawer, under a `VStack`, to list an item's suggested changes. The heading rendered and
the rows did not.

**Problem:** The block's root is `@container` (`container-type: inline-size`), which is
inline-size containment: the element contributes NO intrinsic width to its parent. In the
grid the Table hands it a width. `VStack` is `flex flex-col items-start`, so its children
shrink-to-fit — and a contained element's fit width is zero plus padding. The table inside
was `w-full` of nothing. Typecheck, lint and unit tests all pass on this; only a render
shows it.

**Rule:** Anything marked `@container` must be stretched by its parent (`w-full`, a block
parent, or a flex column with default `items-stretch`) — never placed in `VStack`/`HStack`
or any `items-start`/`inline-*`/`w-fit` parent without an explicit width. When moving a
component to a new host, check what the OLD host was giving it for free: width, padding
offsets (`pl-[52px]` lined the block up under a grid row and means nothing in a drawer) and
column widths sized for a different pane. A layout built for one host usually wants its own
variant in the next (the drawer now has its own `OpenOrdersGrid`), sharing only the
behaviour.

**Applies to:** `apps/erp/app/modules/production/ui/Planning/PlanningActionLines.tsx`
(`PlanningActionLines` vs `PlanningOrderGrids.tsx`), and any `@container` component rendered
through `VStack`/`HStack` (`packages/react/src/VStack.tsx` is `items-start`).

## A drawer rendered as `{item && <Drawer />}` cannot animate closed

```scope
id: a-drawer-rendered-as-item-drawer-cannot-animate-closed
paths: ["packages/react/src/Drawer.tsx","apps/erp/app/hooks/useDrawerItem*"]
triggers: ["useDrawerItem","<Drawer","DrawerPortal"]
```

**Context:** The planning order drawer slid in but vanished on close.

**Problem:** Three things each removed it before a closing animation could run. The tables
rendered it as `{selectedItem && <Drawer />}` and closed it by clearing `selectedItem`, so
it left the DOM in the same render. The shared `Drawer` panel only had a slide-IN. And Radix
keeps a closing dialog mounted only while the element its portal wraps is animating — that
element is `DrawerPortal`'s positioning div, which had no animation, so even a mounted
drawer with an exit animation on its panel was removed at once. Adding the exit classes to
the panel alone changed nothing; the frame-by-frame trace still showed zero closing frames.

**Rule:** When a Radix exit animation does not play, check every element between
the portal and the animated node — each `Presence` looks only at its own child. Verify with
a trace of `data-state` and `getBoundingClientRect()` per frame, not by eye. The rest is in
`.claude/rules/conventions-ui.md` (Modals and Drawers).

**Applies to:** `packages/react/src/Drawer.tsx` (`portalVariants` + `sheetVariants` closing
durations must match), `useDrawerItem` (`apps/erp/app/hooks`), both planning tables, and every
other modal and drawer (see the next lesson).

## A field edited in a plain textarea must not read its text as Markdown

```scope
id: a-field-edited-in-a-plain-textarea-must-not-read-its-text-as
paths: ["apps/erp/app/modules/shared/shared.models.ts"]
triggers: ["optionalTiptapDoc","optionalPlainTextDoc","toTiptapDoc","TiptapText("]
```

**Context:** MCP rich-text inputs (notes, work instructions) are read as Markdown through `toTiptapDoc` / `TiptapText`. Contract notes share that input, but the app edits them in a plain `TextArea` (`ContractDetailsForm`, `ContractProperties`) and shows the saved document with `TiptapText(doc).toString()`.

**Problem:** `TiptapText(doc).toString()` drops what Markdown turned into structure. "1. Ship" became an ordered list and read back as "Ship"; "a*b*c" read back as "abc". The textarea showed the stripped text at once, and the next save stored it.

**Rule:** A rich-text field whose UI is a plain textarea read back with `TiptapText(doc).toString()` stores text as typed: `optionalPlainTextDoc` / `TiptapText(text, { format: "text" })`, not `optionalTiptapDoc` / the Markdown default. Markdown is for fields a rich editor shows, where the formatting survives.

**Applies to:** `apps/erp/app/modules/shared/shared.models.ts` (`toTiptapDoc`, `optionalTiptapDoc`, `optionalPlainTextDoc`), contract notes (`customerContractValidator`, `setContractTerm`), any new textarea over a `json` column.

## A generated avatar is a seed, so the library version decides the face

```scope
id: a-generated-avatar-is-a-seed-so-the-library-version-decides
paths: ["packages/utils/src/avatar.ts","packages/react/src/utils/generatedAvatar.ts","packages/react/package.json"]
triggers: ["@dicebear","GENERATED_AVATAR_STYLES","STYLE_LOADERS"]
```

**Context:** `user.avatarUrl` stores a generated avatar as `dicebear:<style>:<seed>[:<rrggbb>]` (`packages/utils/src/avatar.ts`). The browser draws it with DiceBear every time it renders (`packages/react/src/utils/generatedAvatar.ts`). Nothing about the picture is stored, only the seed.

**Problem:** A new DiceBear major version can draw a different face for the same seed. The move from version 9 to 10 (2026-10-08) changed every existing avatar, and nothing in the database showed it. A style removed from `GENERATED_AVATAR_STYLES` makes its stored values unparseable, so those avatars fall back to initials without an error.

**Rule:** Pin `@dicebear/core` and `@dicebear/styles` to exact versions, never a range. Treat a DiceBear upgrade as "every user's avatar may change", and compare renders of fixed seeds before and after. Only add to `GENERATED_AVATAR_STYLES`; the `Record` type of `STYLE_LOADERS` makes a style without a loader a type error.

**Applies to:** `packages/react/package.json` (DiceBear versions), `packages/utils/src/avatar.ts`, `packages/react/src/utils/generatedAvatar.ts`.

## A route dialog closed by navigating cannot animate closed either

```scope
id: a-route-dialog-closed-by-navigating-cannot-animate-closed-ei
paths: ["packages/react/src/Modal.tsx","packages/react/src/Drawer.tsx"]
triggers: ["useRouteDialog","useCloseRoute","ConfirmDelete","ModalOverlay"]
```

**Context:** Every modal and drawer in the ERP animated in and vanished on close (New Gauge was
the report). The drawer lesson above fixed only the planning drawers.

**Problem:** Two patterns removed the dialog in the same render. A route that renders a form as
a dialog held `open` at `true` and closed by `useCloseRoute()` / `navigate(...)`: the navigation
removed the route, so `open` never turned false. And about 300 call sites rendered
`{disclosure.isOpen && <ConfirmDelete />}`. The modal backdrop also closed in 150ms while the
box closed in 200ms, and Radix removes both when the backdrop ends.

**Rule:** `useRouteDialog()` (`@carbon/react`) `close` sets `open` false and navigates only when
Radix has removed the dialog. With unsaved changes it navigates at once, so the `Submit` blocker
asks over the open dialog — closing first would unmount the blocker and lose the edits silently.
Keep that order when you change the hook. The rest is in `.claude/rules/conventions-ui.md`
(Modals and Drawers) and the `no-unmounting-dialog` check.

**Applies to:** every `Modal`, `Drawer`, `ModalDrawer`, `Confirm`, `ConfirmDelete` and
`*Modal`/`*Drawer` component; `ModalOverlay` and `ModalContent` durations must match.

## A `SelectControlled` value that differs from the form default is cleared on mount

```scope
id: a-selectcontrolled-value-that-differs-from-the-form-default
paths: ["packages/form/src/components/SelectControlled.tsx"]
triggers: ["SelectControlled"]
```

**Context:** A `SelectControlled` whose `value` prop comes from component state (`useState(canEmail ? "Email" : "None")`) inside a `ValidatedForm` whose `defaultValues` hold another value (`"None"`), both mounting together (the quote-to-order confirm step, TCK-55).

**Problem:** `SelectControlled` copies `value` into the form field in an effect right after mount. Radix Select then sets its hidden native `<select>` to the new value before that `<select>` has its `<option>`s, reads back `""`, and fires `onValueChange("")`, which writes `""` into the field. The trigger shows blank, the form posts `""`, and a `z.enum([...]).optional()` validator refuses it ("Invalid option"), so Convert silently did nothing whenever the company had Email set up.

**Rule:** Give the form the value the select starts with: `defaultValues[name]` must equal the `SelectControlled` `value` on its first render. Derive both from the same source; never let the default and the state disagree.

**Applies to:** every `SelectControlled` driven by local state or a derived value (`packages/form/src/components/SelectControlled.tsx`).

## A submit button that stays live is a duplicate-write engine

```scope
id: a-submit-button-that-stays-live-is-a-duplicate-write-engine
paths: ["packages/react/src/Button.tsx","packages/form/src/ValidatedForm.tsx","packages/auth/src/lib/supabase/client.ts","packages/jobs/src/inngest/functions/notifications/send-*.ts"]
triggers: ["type=\"submit\"","fetcher.submit","storageReadFetch"]
```

**Context:** Finalizing quote Q000699 emailed the customer the same PDF three times within
one minute, same recipient list each time. The finalize action evaluates sales rules across
every line, renders a PDF, uploads it, writes a `document` row, flips the quote to `Sent`,
renders two email bodies and signs an attachment URL before it triggers the send — seconds
of wall time, during which `QuoteFinalizeModal`'s Finalize button was enabled and not even
spinning (`isDisabled={loading}`, where `loading` was the modal's own data-fetch flag).

**Problem:** Three layers of the same defect, and only the first is about a button.
(1) `fetcher.submit` aborts the previous BROWSER request; the server action it started runs
to completion regardless, because nothing in a route action reads `request.signal`. So N
clicks are N complete sets of side effects. The guard had existed as `onSubmit={onClose}`
(the modal unmounted before a second click was possible) and was dropped in `e59a9e26e2`
when closing moved to `useRuleViolations({ onSuccess: onClose })` — correct on its own, since
violations must be able to reopen the modal, but nothing replaced the guard.
(2) `@carbon/react`'s `Button` left `isLoading` out of the DOM `disabled` attribute while
`useShortcutKeys` already treated it as disabling — so a spinning button refused Enter but
still took a mouse click, and every call site guarding a submit with
`isLoading={fetcher.state !== "idle"}` was showing a spinner over a live button.
(3) The Supabase client's retry wrapper replayed every method on a 5xx or a 25 s timeout.
PostgREST commits before it answers, so a retried insert is a duplicate row and a retried
`.rpc()` re-runs a transaction. The `quoteToQuote` incidents had already produced the rule —
*"a retry wrapper must never blindly retry a write with real side effects and no idempotency
key"* — but the fix carved out only `/functions/v1/`, leaving every PostgREST write still
replaying.

**Rule:** A submit path needs a guard at each layer that can replay it, not only at the
button. A retry wrapper replays only idempotent methods, and a job retries only failures
that provably had no effect — for an SMTP send that means connect/greet/auth errors only,
never an ambiguous `ETIMEDOUT` that may have been delivered. When triaging "the operation
failed but extra copies appeared", check the button, the form, the retry wrapper and the job
before assuming a browser double-submit. The button and form guards are in
`.claude/rules/conventions-forms.md` and the `no-unguarded-submit` check.

**Applies to:** `packages/react/src/Button.tsx`, `packages/form/src/ValidatedForm.tsx`,
`packages/auth/src/lib/supabase/client.ts` (database reads now use supabase-js's own retry,
which never replays a write, and only storage reads go through `storageReadFetch`),
`packages/jobs/src/inngest/functions/notifications/send-{email,slack}.ts`, and any
`<Button type="submit">`.

## A zod `.refine` that returns an object instead of a boolean silently disables the check

```scope
id: a-zod-refine-that-returns-an-object-instead-of-a-boolean-sil
paths: ["apps/erp/app/modules/*/*.models.ts","apps/mes/app/services/models.ts"]
triggers: [".refine("]
```

**Context:** Cross-field validation in module `*.models.ts` zod schemas (real case: `processValidator` in `apps/erp/app/modules/resources/resources.models.ts`, the two `.refine` calls after the object, near line 372).

**Problem:** `.refine((data) => { if (bad) return { workCenters: ["..."] }; return true; })` looks like it reports a field error, but `.refine`'s callback is coerced to a boolean — any non-empty object is **truthy**, so the "failure" branch returns a value that passes validation. Both `processValidator` refinements (work-center-required and standard-factor-required) never fire: the object was meant to be an error map, but `.refine` has no such API. The schema typechecks and the form submits, so the missing validation is invisible until bad data lands.

**Rule:** A `.refine` predicate must return a **boolean** (`false` = invalid). To attach a path/message, either pass the second `{ message, path }` argument to `.refine` and return `false` on failure, or use `.superRefine((data, ctx) => ctx.addIssue({ path, message }))` when you need per-field errors. Never return an object/array from a `.refine` callback expecting it to be an error map.

**Applies to:** all `apps/erp/app/modules/**/*.models.ts` (and `apps/mes/app/services/models.ts`) zod schemas using `.refine`.

## Card lists never get their own scroll region — the page is the only scroll surface

```scope
id: card-lists-never-get-their-own-scroll-region-the-page-is-the
paths: ["apps/erp/app/modules/items/ui/**/BillOf*.tsx","apps/erp/app/modules/**/JobBillOf*.tsx","apps/erp/app/modules/**/QuoteBillOf*.tsx"]
triggers: ["ScrollArea","max-h-[60dvh]"]
```

**Context:** The Bill of Material / Bill of Process cards were capped at `max-h-[60dvh]` with an internal ScrollArea (PR #1230) so long lists wouldn't grow the page unbounded. Brad asked for the scrollbars to be removed; hiding the bar but keeping the capped region was the wrong reading.

**Problem:** A nested scroll region doesn't reduce scrolling — the same rows still have to be scrolled through — it just hijacks the wheel whenever the cursor crosses the card, so the user gets two scroll surfaces, scroll-trapping at the region's edges, and a janky feel. "Remove the scroll bars" meant remove the *scrolling*, not restyle the bar.

**Rule:** Card lists (BoM, BoP, and anything similar) render at natural height; the page-level container is the only scroll surface. Don't add `max-h` + `overflow-y-auto` to a card's content to tame its length — if a long list is a problem, solve it with collapse/pagination/virtualization, never a nested scroll region.

**Applies to:** `BillOfMaterial.tsx` / `BillOfProcess.tsx` (items), `JobBillOfMaterial.tsx` / `JobBillOfProcess.tsx`, `QuoteBillOfMaterial.tsx` / `QuoteBillOfProcess.tsx`, and any new card-embedded list in `apps/erp`.

## Check every rule a Tailwind class compiles to, not just the first

```scope
id: check-every-rule-a-tailwind-class-compiles-to-not-just-the-f
paths: ["packages/config/tailwind/theme.css"]
triggers: ["ease-drawer","tailwindcss-animate"]
```

**Context:** Verifying whether `ease-drawer` changes the Drawer's
`tailwindcss-animate` slide.

**Problem:** The compiled CSS has two `.ease-drawer` rules: Tailwind's
(`transition-timing-function`) and `tailwindcss-animate`'s
(`animation-timing-function`). Reading only the first match gave the wrong
answer that the class did not reach the animation.

**Rule:** When checking a utility's effect, print every rule for its selector.
`ease-*` classes set the animation curve as well as the transition curve.

**Applies to:** `packages/config/tailwind/theme.css` tokens and any check of
compiled Tailwind output.

## Pointer capture taken on press steals the tap's click

```scope
id: pointer-capture-taken-on-press-steals-the-tap-s-click
paths: ["packages/react/src/BottomSheet.tsx"]
triggers: ["setPointerCapture","DRAG_SLOP_PX"]
```

**Context:** A bottom sheet drags down from its whole header, so its handlers sit on the
panel and a press anywhere in the header that is not a control starts a drag.

**Problem:** The drag called `setPointerCapture` on `pointerdown`. With the pointer
captured, `pointerup` goes to the panel, and the browser sends the `click` to the
panel too. A header chip with an `onClick` (not a `button`, so not excluded as a
control) stopped responding to taps.

**Rule:** A drag that starts on content which can also be tapped takes the pointer
only once it has moved a few pixels (`DRAG_SLOP_PX`). Until then a tap is a tap.

**Applies to:** `BottomSheetContent` (`packages/react/src/BottomSheet.tsx`), and any
drag handle that wraps clickable content.

## `space-x-*` gives a phantom margin when a component injects sibling nodes

```scope
id: space-x-gives-a-phantom-margin-when-a-component-injects-sibl
paths: ["apps/erp/app/components/Hyperlink.tsx","packages/react/src/HStack.tsx","packages/react/src/VStack.tsx","packages/react/src/PrefetchLink.tsx"]
triggers: ["prefetch=\"intent\"","PrefetchLink"]
```

**Context:** A reported layout shift — hovering any row of an ERP list table shifted every column of the whole table ~8px sideways.

**Problem:** `Hyperlink` renders `<Link prefetch="intent">`. React Router implements that by rendering `<>{anchor}{prefetchLinks}</>`, so on hover four `<link rel="prefetch">` elements appear **as siblings of the anchor** inside whatever container the caller used — here `<HStack>`. Tailwind v4's `space-x-*` compiles to `& > :not(:last-child) { margin-inline-end }`, so the instant those links mount the anchor stops being `:last-child` and gains a real 8px margin. Under `table-layout: auto` that re-lays out the column and the whole table. The links are `display: none`, which is exactly why this reads as impossible: every computed style on the `<td>` except `background-color` is unchanged, the anchor and all its children keep identical widths, and only the `<td>` and its wrapper grow. Two false leads first — the load-time column settle (237.5 → 245.1 with no hover, ~4s after load) masquerades as the same shift, and `opacity-0 → opacity-100` on the "Open" button looks like the obvious culprit but cannot move layout.

**Rule:** `space-x-*` / `space-y-*` are structural (`:not(:last-child)`) — never use them on a container whose children a component may add to at runtime; use `gap-*`, which only applies between elements that generate boxes and so ignores `display:none`. When a component renders extra DOM next to its main element (React Router prefetch links, portals, measurement nodes), isolate it in a `display: contents` wrapper so it can't perturb the caller's layout. To diagnose "impossible" width changes, diff every computed property between states and count child nodes — a node-count delta with no style delta means injected DOM, not CSS.

**Applies to:** `apps/erp/app/components/Hyperlink.tsx`; `packages/react/src/{HStack,VStack}.tsx` (still `space-x-*`/`space-y-*`, ~2,500 call sites); any `PrefetchLink` (`@carbon/react`, which injects the same tags on press) or `<Link prefetch>` placed directly inside a `space-*` container.

## The design-system `Card` is a gray tray + shadow edge — the white surface is `CardContent`, and a tint on the shell needs a `dark:` variant

```scope
id: the-design-system-card-is-a-gray-tray-shadow-edge-the-white
paths: ["packages/react/src/Card.tsx","packages/onboarding/src/ui/primitives/Section.tsx"]
triggers: ["<CardContent","dark:bg-card"]
```

**Context:** Building card surfaces with `@carbon/react`'s `Card` family (`packages/react/src/Card.tsx`), e.g. the onboarding Implementation Hub (`packages/onboarding/src/ui/**`). Three separate traps hit in sequence while converting hand-rolled `rounded-lg border bg-card` blocks to the design system.

**Problem:**
1. `Card` is `bg-accent dark:bg-card` — a **muted gray tray** in light mode, not a white card. Putting content directly in `<Card>` reads gray. The white surface (`bg-card`) comes from `CardContent`; the canonical composition is `Card > CardHeader + CardContent` (see `MetricCard.tsx`, `ActionTaskList.tsx`).
2. `Card`'s `shadow-button-base` already draws the crisp outer edge (a `0 0 0 1px` ring + inset highlights). A `CardContent` `border` sitting on top of that shadow ring reads as a **blurry double line**.
3. Overriding the shell background with an **un-prefixed** color (`bg-emerald-500/5`) leaves `Card`'s base `dark:bg-card` in the class list; `.dark .dark:bg-card` out-specifies `.bg-emerald-500/5`, so the tint **silently disappears in dark mode** (border/icon still show, so it degrades quietly).

**Rule:**
- Single-surface white card: `Card > CardContent` (not content directly in `Card`).
- Titled card: heading in `CardHeader` over `CardContent`; the shell shadow is the outer edge, so use `CardContent className="border-0"` and put the header/body divider on the `CardHeader` (`border-b border-border`) — never a full `CardContent` border on top of the shadow.
- Colored callout on a `Card`: always pair the tint with its `dark:` variant (`bg-emerald-500/5 dark:bg-emerald-500/5`). `cn`/twMerge then drops the base `dark:bg-card`. Verify by checking the rendered class list no longer contains `dark:bg-card`.

**Applies to:** any UI composing `@carbon/react` `Card`/`CardContent`/`CardHeader`; the `Section`/`Panel` primitives in `packages/onboarding/src/ui/primitives/Section.tsx` centralize this composition for the hub.

## Twin `ValidatedForm`s at the same JSX slot share one RVF store — controlled-field defaults seed only for whichever branch mounts first

```scope
id: twin-validatedform-s-at-the-same-jsx-slot-share-one-rvf-stor
paths: ["apps/erp/app/modules/items/ui/ChangeNotice/AffectedItemForm.tsx"]
triggers: [{"text":"<ValidatedForm","minCount":2}]
```

**Context:** The Add Affected Item modal (`AffectedItemForm`) renders `isNewPart ? <ValidatedForm A/> : <ValidatedForm B/>`. Branch A (New Part) has `replenishmentSystem`/`itemTrackingType` Selects with `defaultValues` `"Make"`/`"Inventory"`; branch B (existing item) has an item picker. After switching to New Part the two Selects rendered blank and submit failed with `Invalid enum value … received ''`.

**Problem:** Both branches render a `<ValidatedForm>` (same element type) at the **same JSX position**, so React reconciles them as **one component instance** and just swaps props — no unmount/remount. `@carbon/form`'s RVF store seeds `controlledFields.values` from `defaultValues` **only on first hydration** (`syncFormProps`: `if (!state.isHydrated) { … }`). The instance hydrates on the initial branch (B, `changeType` default `Version`), so when the user switches to A, A's Select defaults are **never** seeded — `useControlledFieldValue` returns the store value (`undefined`) once `isHydrated`, not the `defaultValue`. Uncontrolled fields (`InputControlled`) were unaffected because they write their own value via effect. `defaultValues` object identity was a red herring: `ValidatedForm` already `useDeepEqualsMemo`s it, and `syncFormProps` ignores later `defaultValues` changes post-hydration.

**Rule:** When two `ValidatedForm`s occupy the same conditional slot (`cond ? <VF/> : <VF/>`), give each a distinct, stable `key` (`key="new-part"` / `key="existing-item"`) so switching forces a fresh mount + fresh store that hydrates with the correct branch's `defaultValues`. Consequence: the fresh mount also needs any Select value the branch relies on seeded in its own `defaultValues` (e.g. `changeType: "New Part"`, added to `changeNoticeNewPartValidator`) — a value the shared store previously carried over from the user's click is gone after remount. Symptom to watch for: a controlled Select rendering blank / submitting `""` right after a branch switch.

**Applies to:** `apps/erp/app/modules/items/ui/ChangeNotice/AffectedItemForm.tsx`; any conditional twin-`ValidatedForm` pattern; `@carbon/form` controlled fields (`Select`/`Combobox`/anything on `useControlField`) that rely on `defaultValues` seeding.

## `w-full` on a flex item ignores its siblings — use `flex-1 min-w-0`

```scope
id: w-full-on-a-flex-item-ignores-its-siblings-use-flex-1-min-w
paths: ["apps/erp/app/routes/share+/quote.$id.tsx","apps/erp/app/routes/share+/supplier-quote.$id.tsx","apps/erp/app/routes/share+/purchasing-rfq.$id.tsx","apps/erp/app/modules/*/ui/**/*Summary.tsx","packages/react/src/VStack.tsx","packages/react/src/Heading.tsx"]
triggers: ["<VStack className=\"w-full\"","flex-1 min-w-0"]
```

**Context:** Every document line-item view (digital quote, quote, sales order, purchase order, supplier quote, both invoice summaries — 12 files) lays a row out as a flex row: a fixed `w-24` thumbnail, then a `VStack` holding the heading, description and price. The `VStack` carried `className="w-full"`, and `VStack`'s own base class is `w-full` too, so a bare `<VStack>` has the same defect.

**Problem:** `width: 100%` on a flex item resolves against the flex container's content box — it takes no account of the sibling thumbnail. The content column was therefore as wide as the whole row, and the row rendered 112px (96px thumbnail + 16px gap) wider than its card, pushing the description and the line price outside the card's right edge on a customer-facing document. The `truncate` on the description masked the cause rather than revealing it: the text *did* ellipsise, just at the overflowed boundary, so it read as "text is being cut off" instead of "the box is the wrong width". Measure `el.getBoundingClientRect().right` against the parent's to see it.

**Rule:** A flex child that should fill the remaining space gets `flex-1 min-w-0`, never `w-full`; its fixed-size siblings get `shrink-0`. `min-w-0` is required twice over — it is what lets `flex-1` shrink at all (a flex item's default `min-width: auto` floors it at its content width) and what lets a descendant's `truncate` clip at the container edge. Note `@carbon/react`'s `VStack` ships `w-full` in its base variant, so dropping the className is not enough — pass `className="flex-1 min-w-0"` explicitly. Separately, `truncate` is inert on `Heading`: its base `text-balance` resets `text-wrap-mode`, so the `whitespace-nowrap` half of `truncate` never lands.

**Applies to:** `apps/erp/app/routes/share+/{quote,supplier-quote,purchasing-rfq}.$id.tsx`, `apps/erp/app/modules/{sales,purchasing,invoicing}/ui/**` line-item summaries and drawers, `packages/react/src/VStack.tsx`, `packages/react/src/Heading.tsx`; any flex row pairing a fixed-size element with a growing text column.
