# Actions and overlays — hierarchy, placement, modals, destructive flows

## Contents
1. Action hierarchy — how prominent an action should be
2. Where actions live, per surface
3. Overlay decision table
4. Overlay anatomy and button order
5. Destructive actions
6. Keyboard bindings for actions
7. Action microcopy

---

## 1. Action hierarchy

Carbon's budget: **one primary per surface**. Secondary is the default look (46% of buttons).

| Level | Treatment | When |
|---|---|---|
| Primary | `Button` default/primary, or `Submit`, or `New` | the next step on this surface: Save, the next lifecycle transition, "Add X" on a list |
| Secondary | `Button variant="secondary"` | every other visible action, dropdown triggers (`rightIcon={<LuChevronDown/>}`), Cancel in modals |
| Quiet | `ghost` / `IconButton ghost` / `link` | inline, toolbar, panel actions, panel toggles |
| Hidden-in-place | ⋯ `DropdownMenu`, `renderContextMenu`, hover-revealed row icons | rare, administrative and destructive actions |
| Destructive | `destructive` variant / `MenuItem destructive` | irreversible or data-removing; always confirmed |

Rules:
- **Status-driven primary** in record headers: the button for the next valid step is primary,
  the rest secondary (`variant={status === "Draft" ? "primary" : "secondary"}`). Never two
  primaries.
- A header shows roughly **3–6 visible actions** besides panel toggles. More → move rare ones
  into ⋯, group related documents into one "Shipments ▾" dropdown, or use `SplitButton`.
- Text + icon (`leftIcon`) for actions that need a word; `IconButton` + tooltip only for
  universal icons (⋮, copy, link, close, toggles, chevrons, drag).
- Transitions not valid in the current status: the newest headers (Sales Return Order) render
  only valid ones; older headers render all and disable the invalid. Pick one approach per
  header; the next valid step must always be visible.
- Permission-gated actions are **disabled**, not hidden.

## 2. Where actions live

| Surface | Primary | Secondary / others | Rare & destructive |
|---|---|---|---|
| List page | `New` "Add X" in the Table title bar (`primaryAction`) | toolbar (search, filter, sort, columns, views, export); ⋮ "Bulk Import" next to Add; bulk menu `renderActions` when rows selected | row menu `renderContextMenu`: Edit first → domain verbs → Delete last |
| Document header | next lifecycle step (right side) | Preview/PDF ▾, related-doc ▾, other transitions | ⋯ next to the ID: audit log, copy/revision, Reopen, separator, Delete |
| Explorer | — | footer "Add Line Item" (secondary, full width, ⌘⇧L) | row ⋮ (hover-revealed): Delete Line |
| Card on a detail page | `CardAction` top-right (often `New`) or `CardFooter` Save bottom-left | — | — |
| Drawer form | Save (footer, left) | Cancel `solid` (right of Save) | — |
| Modal | primary action (footer, right) | Cancel `secondary` (left of primary) | — |
| Properties panel | none (autosave) | tiny ghost copy-link / copy-id icon buttons at top | — |
| Settings card | Save in `CardFooter` (or instant Switch) | — | — |
| MES operation | giant Start/Pause in the dock | full-width `lg` buttons in the dock, "More actions" sheet | confirm modal |

A card's section title is left, its action right:
`<HStack className="justify-between items-start"><CardHeader>…</CardHeader><CardAction><New to="new" /></CardAction></HStack>`
(exemplar `modules/sales/ui/Customer/CustomerContacts.tsx`).

## 3. Overlay decision table

| Situation | Component | Size |
|---|---|---|
| Create/edit a config row from its list | `ModalDrawer` (drawer) via nested route | `md` (1/3); `lg` (1/2) for rule builders / many sections |
| Create an entity from inside a selector | the entity's form with `type="modal"` | Modal `medium` |
| Record / line form: page card vs inline create | `ModalCard` | `xlarge`; lines `xxlarge` |
| Read-only drill-down beside a list (ledger, audit log, run detail) | `Drawer` | `lg`/`xl`/`full` |
| Multi-step wizard, side-by-side comparison | `Drawer` | `xl`/`full` |
| Lifecycle transition needing confirmation or a few inputs (Post, Void, Finalize, Release, Approve, Send, Cancel order) | `Modal` | `medium`; `large`/`xxlarge` when listing lines |
| Destructive confirmation | `ConfirmDelete` / `Confirm` | medium |
| Non-committing pick or explanation (assignee, color, "why this price", filter, sort) | `Popover` | content |
| Rich hover preview | `HoverCard` | — |
| Explain an icon / truncated text | `Tooltip` | — |
| Overflow actions | `DropdownMenu` | — |
| MES action list | `BottomSheet` | `max-w-md` |
| A decision the user must make before continuing | `Modal` with two explicit choices — **not** a warning banner (`8ee90a4252`) | medium |

Don't: open a drawer from a drawer; put a top-level document create in a drawer; use a
full page for a 3-field lookup row; use a Modal for read-only reading material longer than a
screen (use a Drawer or route); use `window.confirm`.

Mount header-launched modals only when open (`{modal.isOpen && <XModal />}`); keep a drawer
mounted (`isOpen` prop) only when it must keep state between openings.

Any popover-based dropdown with an internal scroll list inside a Drawer/Modal must stop
`onWheel`/`onTouchMove` propagation on `PopoverContent` (`.claude/rules/conventions-ui.md`).

## 4. Overlay anatomy and button order

- Header → Title (+ optional Description). Titles `text-base font-medium`; Modal descriptions
  are common, Drawer descriptions rare.
- Body: Modal `px-6`; Drawer body is an inner white rounded card that scrolls.
- Footer: Modal footer is a tinted bar (`border-t bg-muted/40`), right-aligned; Drawer footer
  right-aligned; `CardFooter` left-aligned.
- Close ✕ is built into Modal/Drawer content — don't add another.

**Button order depends on the container:**

| Container | Order | Cancel variant |
|---|---|---|
| `ModalFooter` (confirm / action modal) | `[Cancel] [Primary]` — primary rightmost | `secondary` |
| `ModalDrawerFooter` / `DrawerFooter` (form drawer) | `<HStack>[Save] [Cancel]</HStack>` — Save leftmost | `solid` |
| `CardFooter` / `ModalCardFooter` (page form) | `[Save]` only | — |

When the primary action itself means "cancel", rename the dismiss button: "Back",
"Don't Cancel" + destructive "Cancel Job", "Keep editing" + destructive "Discard import".

**Submitting from an overlay:**
- One user action = **one** submission. Don't loop several `fetcher.submit` calls on one fetcher
  (each aborts the previous); send `ids[]` + parameters to one route and do the batching on the
  server (bulk routes switch on `field`/`intent`, e.g. `routes/x+/job+/update.tsx`).
- Keep the overlay open while submitting (`isLoading` on the primary, `isDisabled` on Cancel);
  close it when the fetcher returns success (a `useEffect` on `fetcher.state`/`fetcher.data`, as
  `CustomerTypeForm` does in modal mode) and show the toast then. On error keep it open with the
  message.
- Simple yes/no confirms: use `Confirm` (`confirmVariant`, `confirmText`) — it binds ⌘↵ via
  `SHORTCUTS.confirm` like `ConfirmDelete`.

Exemplars: `apps/erp/app/components/Modals/ConfirmDelete/ConfirmDelete.tsx`,
`modules/inventory/ui/Receipts/ReceiptPostModal.tsx`,
`modules/sales/ui/SalesOrder/CancelSalesOrderModal.tsx`.

## 5. Destructive actions

1. **Entry:** never a visible one-click button on a list or header. A `MenuItem destructive`
   (red) with `LuTrash`, **last** in the row menu; in header ⋯ menus after a
   `DropdownMenuSeparator`. Disabled when locked or without permission.
2. **Label:** "Delete" on document lists, "Delete <Entity>" on settings lists and headers
   ("Delete Line", "Delete Rule").
3. **Confirm:** `ConfirmDelete` — title "Delete {name}", body
   `t\`Are you sure you want to delete ${name}? This cannot be undone.\``, footer
   `[Cancel secondary] [Delete destructive ⌘↵]`. State consequences when they exist ("Any
   assignments referencing this printer will be cleared."). Override the verb with `deleteText`
   (Void, Remove, Reverse Entry).
4. **Wiring:** route-driven (`{collection}.delete.$id.tsx` renders ConfirmDelete; action deletes
   and redirects with `success("…")`) — exemplar
   `apps/erp/app/routes/x+/resources+/abilities.delete.$id.tsx`; or disclosure-driven in
   headers/tables (`{deleteModal.isOpen && <ConfirmDelete … />}`).
5. **No undo.** Reversibility is modelled as soft delete ("Deactivate", "Move to Trash").
6. Other destructive commits (Void, Reject, Cancel Job, Revoke) use `variant="destructive"`
   inside a confirm `Modal` that shows what will be affected.

## 6. Keyboard bindings for actions

- Combos are **named constants**: shared `SHORTCUTS` (`packages/react/src/shortcuts.ts`), ERP
  (`apps/erp/app/shortcuts.ts`), MES (`apps/mes/app/shortcuts.ts`). Never a string literal at
  the call site. Add new ones to the registry and to the app's `ShortcutHelp.tsx`.
- Bind via `Button shortcut={…}` (renders a keycap badge, inert when disabled, scoped to the
  topmost dialog), `useShortcutKeys`, `useShortcutKeyMap`; two-key sequences
  `useShortcutSequence`. Never a hand-rolled `keydown` listener.
- `Submit` binds ⌘/Ctrl+Enter automatically; confirms bind `SHORTCUTS.confirm`.
- **Enter** only on one-obvious-action screens (choice screens, single input); **⌘Enter** for
  real forms. Hide the keycap (`hideShortcutKey`) on trivial screens.
- MES: no bare letters (barcode scanners type); use `alt+digit`, space, enter, arrows.

## 7. Action microcopy

| Context | Pattern |
|---|---|
| Form submit | "Save" (create and edit) |
| Form dismiss | "Cancel" |
| List create | "Add <Entity>" (via `New label={t\`Entity\`}`) |
| Create from selector | "Create <typed text>" |
| New related doc in a menu | "New Shipment", "New Invoice" |
| Overlay title | "New <Entity>" / "Edit <Entity>" |
| Lifecycle modal title | "<Verb> <Entity>" ("Post Receipt", "Cancel Sales Order") |
| Lifecycle modal body | "Are you sure you want to post this receipt?" + consequences |
| Menu items | Title Case verb (+ noun): "Edit", "Delete Line", "Export Lines to CSV", "Reopen" |
| ⋮ aria-label | "More options" |

Buttons and menu items are **Title Case**. Some features added Aug–Sep 2026 use sentence-case
buttons ("Create new rule") — that's drift; use Title Case unless the neighbouring screens in
the same module are consistently sentence case.
