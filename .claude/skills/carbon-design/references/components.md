# Components — what exists, when to use it, how to extend

Primitives: `@carbon/react` (`packages/react/src/`, flat files, barrel `index.tsx`, subpath
exports `@carbon/react/{Chart,Editor,ErrorBoundary,…}`). Form fields: `~/components/Form`
(`apps/erp/app/components/Form/index.ts` — `@carbon/form` fields + ~60 domain selectors).
App-level: `~/components` (`apps/erp/app/components/index.ts`) and `apps/mes/app/components`.

Status legend: **canonical** = default choice · **niche** = right for one job · **don't** =
dead, legacy or buggy.

## Contents
1. The reuse / extend / create rule
2. Catalog by job
3. Choosing between overlapping components
4. Variant semantics (Button, IconButton, Badge, others)
5. Do-not-use list
6. Gaps — patterns that are hand-rolled today
7. Building a new component the Carbon way

---

## 1. Reuse → extend → create

1. **Reuse** an existing component when its *job* matches (not just its look). Grep
   `packages/react/src/` and `apps/erp/app/components/` first.
2. **Extend** it (a new variant, prop or slot) when the job matches but a real, recurring need
   is missing — and the extension would make sense for other call sites.
3. **Create** a new component only when the job is genuinely new. Build it from tokens and
   primitives (§7) so it still looks native.
4. **Never force** a component into a job it wasn't made for (a `Status` pill for a category,
   a `Table` for 3 config rows, a `Card` as a list row, `Badge` as a button, `Alert` for
   routine info). A forced fit reads as "almost Carbon", which is worse than a clean new piece.

## 2. Catalog by job

### Actions
| Component | Job | Status |
|---|---|---|
| `Button` | every text button. Variants `primary secondary solid active destructive ghost outline link`, sizes `sm md lg`, `leftIcon/rightIcon`, `isLoading`, `isDisabled`, `asChild` (Link as button), `shortcut` | canonical |
| `IconButton` | icon-only button; **requires** `aria-label`; always set `variant` explicitly | canonical |
| `New` (ERP) | list "Add X" primary link-button with `LuCirclePlus`, binds `n` when sole | canonical |
| `Submit` (form) | form submit: loading, disabled, ⌘↵, unsaved-changes blocker | canonical |
| `SplitButton` | one main action + alternates (Job Release ▾ Mark as Planned) | niche |
| `DropdownMenu` + `IconButton LuEllipsisVertical` | "More options" overflow | canonical |
| `Menu`/`MenuItem`/`MenuIcon` | row actions via `Table renderContextMenu` (renders both right-click and ⋮) | canonical |
| `Menubar`/`MenubarItem` | strip of tool actions above a section; stage flow bars | niche |
| `Copy` | copy-to-clipboard icon button (check for 1.5s) | canonical |
| `File` | "Upload" button opening a file picker | canonical |
| `ActionBar`, standalone `Toggle` | — | **don't** (dead) |

### Surfaces and overlays
| Component | Job | Status |
|---|---|---|
| `Card` + `CardHeader/Title/Description/Content/Footer/Action` | a section on a page; `isCollapsible` | canonical |
| `CardAttributes/CardAttribute*` | label/value strip in a header card | niche (under-used) |
| `ModalDrawer` (+ `ModalDrawerProvider type`) | config-row create/edit: drawer on its route, modal when opened from a picker | canonical |
| `ModalCard` (+ `ModalCardProvider type`) | record/line form: card on the page, modal when creating | canonical |
| `Modal` | confirm, lifecycle transition, short focused task, inline create | canonical |
| `Drawer` | read-only drill-down, large editor, wizard, comparison (`size lg/xl/full`) | canonical |
| `ConfirmDelete`, `Confirm` (`~/components/Modals`) | destructive / generic confirm | canonical — never hand-roll |
| `Popover` | click-to-open, non-committing pick or explanation | canonical |
| `HoverCard` | rich preview on hover (documents, glossary) | niche |
| `Tooltip` | one short line explaining an icon or truncated text | canonical |
| `TruncatedTooltipText` | text that shows a tooltip only when clipped | canonical |
| `BottomSheet` | MES touch action sheet | niche (MES) |
| `ScrollArea`, `Resizable*`, `Separator`, `Collapsible`, `Accordion` | plumbing | canonical / niche |

### Data display
| Component | Job | Status |
|---|---|---|
| `Table` (ERP `~/components`) | every record list | canonical |
| `Table/Thead/Tr/Td` (`@carbon/react`) | small static tables inside cards | canonical primitive |
| `Grid` (ERP) | small editable child lists on master data | niche |
| `TreeView` (ERP) | hierarchies (BoM, CoA, lines with methods) | canonical |
| `SortableList` / `LineReorder` | ordered, individually edited children | canonical |
| `Status` (via `*Status.tsx`) | workflow state | canonical |
| `Badge` | tags, identifiers, ad-hoc semantic facts | canonical |
| `Enumerable` / `EnumerableGroup` (ERP) | user-defined lookup values (hash color, `+N` overflow) | canonical |
| `Count` | number next to a label/tab ("99+") | canonical |
| `Avatar`, `EmployeeAvatar`, `CustomerAvatar`, `SupplierAvatar`, `*AvatarGroup` | people and partners | canonical |
| `ItemThumbnail` | item image/placeholder | canonical |
| `Hyperlink` (ERP) | link to a record in a cell, hover "Open" | canonical |
| `DateTime` (ERP wrapper) | every displayed date/time (company timezone popover) | canonical |
| `BarProgress` | progress / x-of-y meter | canonical |
| `MetricCard` | KPI tile | canonical |
| `Activity` | history/activity row | niche |
| `Heading`, `Subheading`, `SettingsSectionHeader` | titles, eyebrows | canonical |
| `Chart` (subpath: `ChartContainer`, `ChartTooltip`, `ChartLegend`) | charts, with theme vars `hsl(var(--chart-N))`; pair with `DateSelect`/`PeriodSelector` for the period and `CSVLink` for export — exemplar `apps/erp/app/modules/items/ui/Item/ItemCostHistoryChart.tsx` (Card + Tabs chart/table) | canonical |
| `Paragraph`, `Kbd`, `Progress`, `TextShimmer`, `TVColorBars`, `Brackets`, `AutodeskViewer` | — | **don't** |

### Feedback and state
`Alert` (in-page banner; destructive/warning/info/success), `toast` (client), `flash()`
(server), `Spinner` (inline, size via `size={n}` prop), `Loading` (region), `Skeleton`
(known shape), `CarbonPulse` (full-screen brand wait), `PulsingDot` ("live"), `Empty` (ERP
in-panel empty), `UpgradeOverlay` (plan gating). Details in `status-and-feedback.md`.

### Inputs (raw `@carbon/react` outside forms; `~/components/Form` inside `ValidatedForm`)
`Input`/`InputGroup`, `NumberField`, `Textarea`, `Checkbox`, `Switch`, `RadioGroup`,
`RadioGroupButton`, `ChoiceCardGroup`, `ChoiceSelect`, `Select`, `Combobox`,
`CreatableCombobox`, `MultiSelect`, `CreatableMultiSelect`, `DatePicker`/`DateRangePicker`/
`DateTimePicker`/`TimePicker`, `Slider`, `InputOTP`, `Label`, `LabelWithHelp`,
`TrackedEntityPicker`, `ToggleGroup`, `Tabs`, `Editor` (rich text).

## 3. Choosing between overlapping components

### Overlays
| Need | Use |
|---|---|
| Confirm a destructive action | `ConfirmDelete` (or `Confirm` with `confirmVariant`) |
| Lifecycle transition needing confirmation or a few inputs (Post, Void, Release, Finalize) | `Modal` (`medium`; `large`/`xxlarge` if it lists lines) |
| Create/edit a config row from its list | `ModalDrawer` (default drawer `md`; `lg` if complex) |
| Create any entity from inside a selector | that entity's form with `type="modal"` |
| Record or line form that lives on the page | `ModalCard` (`xxlarge` modal for lines) |
| Read-only detail / drill-down beside a list, wizard, comparison | `Drawer` `lg`/`xl`/`full` |
| Pick a value / explain a number without committing | `Popover` |
| MES action list | `BottomSheet` |

### Menus
| Need | Use |
|---|---|
| Row actions in a list | `Table renderContextMenu` → `MenuItem` + `MenuIcon` |
| Record overflow | `DropdownMenu` + `IconButton variant="secondary" size="sm"` ⋮ |
| Button that opens choices (Preview ▾, Ship ▾) | `DropdownMenu` + `Button rightIcon={<LuChevronDown/>}` |
| Main action with alternates | `SplitButton` |
| Tool strip | `Menubar` |

### Selects
| Situation | Use |
|---|---|
| Short fixed enum (≤ ~10), no search | `Select` |
| Long / DB-backed list | `Combobox` or a domain selector (`Customer`, `Item`, `Employee`, `Location`…) |
| User may add the value | `CreatableCombobox` (domain selectors already open the entity form as a modal) |
| Many values | `MultiSelect` / `CreatableMultiSelect` |
| 2–5 modes that each need a sentence of explanation, with room | `ChoiceCardGroup` |
| Same, compact (toolbar/filter row) | `ChoiceSelect` |
| Keyboard choice screen with button-looking options | `RadioGroup` + `RadioGroupButton` |
| Boolean in a form | `Boolean` (Switch; `bordered` = toggle card with description) |
| Boolean in a table cell / row selection | read-only `Checkbox` |
| Switch a *view/mode* of the same content (date range, list/kanban) | `ToggleGroup` |
| Switch between content panels inside a card/panel | `Tabs` |
| Toolbar on/off state | `Button`/`IconButton variant={on ? "active" : "ghost"}` |

### Chips
| Meaning | Use |
|---|---|
| Workflow state of a record | `Status` via `{Entity}Status.tsx` |
| User-defined lookup value (type, group, location, UoM) | `Enumerable` |
| Neutral tag / typed metadata (with domain icon) | `Badge variant="secondary"` |
| Identifier / version / code ("V3", "JSON") | `Badge variant="outline"` |
| Ad-hoc positive/negative fact ("Expired", "+12%", "Error") | `Badge variant="green"|"red"|"yellow"|"blue"` |
| Count | `Count` |

### Loading
`Button isLoading` (actions) · `Skeleton` blocks (known shape) · `Loading` (unknown shape
region) · `Spinner` (inline) · `CarbonPulse` (full-screen brand) · `PulsingDot` (live, not
loading).

### Titles
Page title → `Heading` (serif sizes) / `Table title`; record ID → `Heading size="h4"`;
card title → `CardTitle`; eyebrow → `Subheading`; settings group → `SettingsSectionHeader`.

## 4. Variant semantics

### Button (1,300 call sites)
| Variant | Meaning | Typical labels |
|---|---|---|
| `primary` (default) | the **single** forward action on this surface | Save, Confirm, Release, Post, Send, Add X |
| `secondary` | every other real button (46% of all) | Cancel in **Modals**, Close, Preview ▾, Add Line Item, Download |
| `solid` | Cancel/Close in **Drawer** footers; buttons on already-tinted surfaces | Cancel |
| `ghost` | low-emphasis inline/toolbar actions, icon-as-child buttons in panels | copy, link, panel actions |
| `destructive` | irreversible or data-removing commit | Delete, Void, Reject, Deactivate, Cancel Job |
| `active` | pressed state of a toolbar toggle | `{isActive ? "active" : "ghost"}` |
| `link` | text links styled as buttons | Edit Shipping |
| `outline` | rare; MES week nav, topbar utility buttons | — |

Status-driven primary: `variant={status === "Draft" ? "primary" : "secondary"}`.
Sizes: `md` default in ERP, `sm` in dense rows/panels, `lg` in MES.

### IconButton
Always set `variant`: `ghost` for icons sitting on a surface or row (panel toggles, chevrons,
close, drag handle, row ⋮); `secondary` for standalone controls that must look like buttons
(header ⋮, Copy, pagination, refresh); `solid` on tinted surfaces (⋮ in explorer trees).
Header ⋮ is `size="sm"`. aria-label for ⋮: "More options".

### Badge
`secondary` neutral tags · `outline` identifiers/versions · color names for ad-hoc semantic
facts. Prefer color names (`red`) over `destructive`; `default` (primary-filled) is almost
unused.

### Others
- `Alert`: `destructive` (blocking error), `warning` (needs attention), `info` (context).
  Use inside modals/forms for conditions, not for action results (those are toasts).
- `Heading` sizes: `h3` screens/sections, `h4` record header, `h2` via Table.
- `Subheading`: `heavy` reports, `light` Properties/sidebars.
- `ModalContent size`: default `medium`; `small` confirm-ish; `large/xlarge/xxlarge` when
  listing lines. `DrawerContent size`: default `md` (1/3), `lg` (1/2), `xl`, `full`.
- `Switch`: `small` in dense lists, default elsewhere.
- `DateTime variant`: `date` (default for business dates), `absolute`, `relative`, `time`.

## 5. Do-not-use list

| Don't | Use instead |
|---|---|
| `ActionBar`, `Toggle` (standalone), `TVColorBars`, `Brackets`, `TextShimmer`, `AutodeskViewer` | — (dead) |
| `Progress` | `BarProgress` |
| `Paragraph` | `text-sm text-muted-foreground` |
| `Kbd` for shortcuts | Button `shortcut` / `ShortcutKey` |
| `TabsTrigger variant` | (prop is ignored) |
| `useKeyboardShortcuts`, `usePrettifyShortcut`, `LoadingBars` | deleted — `shortcut`/`useShortcutKeyMap`; `CarbonPulse` |
| `Spinner className="size-8"` | `Spinner size={32}` (inline style wins over classes) |
| `IconButton` without `variant` | explicit variant |
| Raw `<button>` styled by hand | `Button`/`IconButton` (a bare `<button>` is OK only as an unstyled full-row hit target, e.g. a tree row, with focus-visible styles) |
| Hand-rolled delete confirm, `window.confirm` | `ConfirmDelete` |
| Hand-rolled `animate-spin` icons | `Spinner` / `isLoading` |
| `Badge` for lifecycle status | `Status` |
| `FormLabel`/`FormError` outside `FormControl` (throws → 500) | plain `<label>` / heading |

## 6. Gaps — patterns that are hand-rolled today

Carbon has no shared component yet for these; match the existing hand-rolled shape exactly
(copy from the named exemplar) rather than inventing a variant:
- **Record header strip** — ~38 copies of the same container (exemplar
  `modules/sales/ui/SalesReturnOrders/SalesReturnOrderHeader.tsx`). `DocumentHeader` exists
  but is a Card-header used by posting docs.
- **Properties panel** — 24 copies (`modules/quality/ui/Issue/IssueProperties.tsx`).
- **`*Status.tsx` wrappers** — one per entity (`modules/sales/ui/Quotes/QuoteStatus.tsx`).
- **Hover-revealed row action** and **dashed "add" row** — raw buttons in trees/lists.
- **Label/value lists** in panels (CardAttributes exists but is rarely used).

If your feature would create the *third* copy of a gap pattern, consider proposing the shared
component — but ask first (`packages/react/AGENTS.md` "Ask First" covers changing the barrel or
widely used APIs).

## 7. Building a new component the Carbon way

Checklist for anything new:
1. **Place it right.** Generic, domain-free → `packages/react/src/{Name}.tsx` (flat, exported
   from the barrel — ask first). Knows about Carbon data (items, people, storage, company TZ)
   → `apps/erp/app/components/` (or the module's `ui/`). MES-only → `apps/mes/app/components/`.
2. **Compose primitives** (Radix-based parts, `Button`, `Popover`, `Badge`, `Card`) — don't
   re-implement focus, portals, keyboard handling or loading.
3. **Variants via `cva`** with *semantic* names (`secondary`, `destructive`, `heavy`) — not
   `blue`, `big`. Merge classes with `cn()`. `forwardRef` + `displayName`; `asChild` where a
   Link may need to be the element. Compound parts (`XHeader/XBody`) over config objects,
   unless the content is data-driven.
4. **Tokens only.** Colors from §1 of `foundations.md`; radius `rounded-md` (controls) or
   `rounded-lg` (boxes); sizes on the control scale (h-6/8/10/11/12); spacing 1/2/4.
5. **States:** hover `bg-accent` or `bg-muted`; selected `bg-accent/60`; focus
   `focus-visible:` ring (reuse `focus-visible:border-ring focus-visible:ring-[3px]
   focus-visible:ring-ring/50` for fields/cards); disabled `opacity-50` +
   `cursor-not-allowed`/`pointer-events-none`; loading via `isLoading`; invalid
   `border-destructive`. Pair every hover-reveal with `focus-visible`/`group-focus-within`.
6. **Motion:** property-scoped transition 150–200ms ease-out; press `active:scale-[0.96]`;
   `motion-reduce:` fallback; `AnimatePresence initial={false}`.
7. **Copy:** all strings via Lingui; aria-labels translated.
8. **Dark mode + a non-zinc theme** checked.
9. **MES variant?** If operators will use it, give it a touch size (`lg`, ≥44px) rather than a
   separate component.
10. **One concept, one component:** if it replaces ad-hoc markup elsewhere, say so in your
    summary and offer to sweep the call sites (don't do it unasked).
