# Research: App-wide keyboard shortcuts (2026-09-07)

Branch: `feat/keyboard-shortcuts`. Base infra merged via PR #1569.

## 1. Button shortcut API (packages/react)

`packages/react/src/Button.tsx` — `ButtonProps`:

- `shortcut?: ShortcutInput | ShortcutInput[]` — react-hotkeys-hook string (`"mod+s"`, `"enter"`) or structured `ShortcutDefinition` (`{ mac, windows }` arms or `{ key, modifiers, enabledOnInputElements }`); array = alternatives, badge shows the first.
- `hideShortcutKey?: boolean` — hotkey active, keycap badge hidden.
- Fires via ref `.click()` (`Button.tsx:182-185`) with `preventDefault()` — so `type="submit"` still submits the form; disabled native no-op.
- Inert while disabled/loading, and while a dialog the button isn't inside is open (dialog guard `packages/react/src/utils/dialog.ts`: `hasOpenDialog` / `topmostOpenDialog` by computed z-index / `isInsideTopmostDialog`).
- Badge: `ShortcutKey` rendered inside the button (`Button.tsx:226-231`); suppressed when `hideShortcutKey`, `isIcon`, or `isLoading`; badge wins over `rightIcon` (`Button.tsx:234`).
- `IconButton` inherits shortcut props; badge never renders (isIcon) but hotkey works.
- NOT wired: `MenuItem`, `DropdownMenuItem`, `SplitButton`, form `Submit`. Visual-only spans exist: `DropdownMenuShortcut`, `ContextMenuShortcut`, `CommandShortcut`, `MenuShortcut`.

### Hook: `packages/react/src/hooks/useShortcutKeys.ts`

- Wraps react-hotkeys-hook `useHotkeys`. `Modifier = alt|ctrl|meta|shift|mod` (`mod` = ⌘ on mac / Ctrl elsewhere). `KeyboardKeys` enum.
- `useShortcutKeys({ shortcut, action, disabled?, enabledOnInputElements?, guard? })`.
- Shortcuts are inert inside inputs/contenteditable by default (`enableOnFormTags` off). Button does NOT expose `enabledOnInputElements` — button shortcuts don't fire while typing in a field unless the structured first binding sets it.
- With multiple bindings only the FIRST binding's `enabledOnInputElements` is honored.
- Badge renderer: `packages/react/src/ShortcutKey.tsx` (small/medium variants, mac glyphs vs Ctrl+ text, sr-only a11y combo). Usable standalone (e.g. PrimaryNavigation.tsx:273).
- Tests: `packages/react/src/__tests__/useShortcutKeys.test.ts`.
- Older unrelated primitives: `Kbd.tsx`, `hooks/useKeyboardShortcuts.ts`.

### Commits (PR #1569)

`12f97afac0` (Button shortcut prop), `15e79a1675` (MES assembly consumer), `d858f80bca` (topmost-dialog scope + sr), `fed1d150af` (z-index topmost), `2581f34ce3` (MES refactor).

### Usage examples

```tsx
<Button shortcut="enter" onClick={record}>Record</Button>
<Button shortcut="mod+s" hideShortcutKey type="submit">Save</Button>
<Button shortcut={["enter", "space"]} />
<ShortcutKey shortcut="mod+k" variant="small" />
```

## Lessons (.ai/lessons.md)

- lessons.md:373-379 — Table owns an Excel keyboard model: `onKeyDownCapture` on the container beats react-aria; react-aria NumberField swallows Enter and consumes arrows; portaled overlays (`[data-radix-popper-content-wrapper]`, `[role=menu|listbox|dialog]`) own their keys. Don't fight it.
- lessons.md:1292-1295 — browser-verifying keyboard flows: closed loop (wipe rows, fresh reload, check DB per keypress).

## 2. Existing shortcut usage survey

### Libraries

react-hotkeys-hook (catalog:) in packages/react + all apps; cmdk 0.2.0 (combobox UI only, no global palette); no mousetrap/tinykeys/kbar.

### Three parallel shortcut systems (must reconcile)

| System | File | Notes |
|---|---|---|
| `useShortcutKeys` (modern, preferred) | packages/react/src/hooks/useShortcutKeys.ts | wraps react-hotkeys-hook; mac/windows arms, mod, guard, alt bindings |
| `useKeyboardShortcuts` (legacy) | packages/react/src/hooks/useKeyboardShortcuts.ts | hand-rolled window listener; literal strings `"n"`, `"Command+Shift+l"`; skips INPUT/TEXTAREA/SELECT/ProseMirror; single-key fires on keyUp, combos on keyDown; `Record<string,fn>` shape silently drops duplicate combos |
| `useEscape` | packages/react/src/hooks/useEscape.tsx | global Escape, no guards |
| `useKeyboardWedge` (scanner) | packages/react/src/hooks/useKeyboardWedge.ts | barcode buffer; flushes on Enter, clears on Escape/3s; skips inputs |
| `usePrettifyShortcut` | packages/react/src/hooks/usePrettifyShortcut.ts | formats legacy strings for display |

### Global shortcuts already taken

| Combo | Action | Location |
|---|---|---|
| ⌘K | Global search modal | Search.tsx:70 (searchShortcut); bound PrimaryNavigation.tsx:235-238 |
| ⌘B | Toggle sidebar (all apps, hard-coded, NO input guard) | packages/react/src/Sidebar.tsx:29,106-118 |
| ⌘L | Toggle AI agent panel (fires inside inputs too) | apps/erp/app/modules/agent/ui/AgentRoot.tsx:23-28 |
| n (bare) | Click "New" button on list pages | apps/erp/app/components/New.tsx:26-31, Kbd hint :49 |
| ← / → (bare) | Prev/next table page | Table/components/Pagination/Pagination.tsx:113-122 |
| Enter | Onboarding theme advance | onboarding+/theme.tsx:117-121 |

### ⌘⇧<letter> family — detail-page tab nav (legacy hook)

DetailSidebar.tsx:31-38 + DetailsTopbar.tsx:38-50 auto-bind nav-link `shortcut` fields; tooltips via prettifyShortcut. Used combos: ⌘⇧D (details), ⌘⇧A, ⌘⇧P (DUPLICATED twice per item nav — existing bug, second silently wins: usePartNavigation.tsx:48 vs :64 + siblings), ⌘⇧I, ⌘⇧Q, ⌘⇧X, ⌘⇧C, ⌘⇧L, ⌘⇧T, ⌘⇧S, ⌘⇧R.

Explorer add-line shortcuts (page-scoped, same namespace): ⌘⇧L = add line in Quote/SalesOrder/SalesRFQ/PurchaseOrder/SupplierQuote/PurchasingRFQ/PurchaseInvoice/SalesInvoice Explorers; ⌘⇧A add attribute/question (ProcedureExplorer:220, TrainingExplorer:174); ⌘⇧P add parameter (ProcedureExplorer:230). Hints via `<Kbd>{prettifyShortcut(...)}`.

**Free letters in ⌘⇧ namespace: B, E, F, G, H, J, K, M, N, O, U, V, W, Y, Z.**

### Scoped/view-local (ERP)

- Gantt.tsx:1248-1332 — e/c/d expand/collapse/durations, 0-9 depth, arrows.
- TraceabilityGraph.tsx:183-200 — `/` or ⌘K page-local node search (shadows global ⌘K).
- viewer AssemblyPlayer: ⌘A select-all, Alt drill; MotionPathEditor: Delete/Backspace.
- Escape: ActionBar.tsx:322, useLineOrderEditMode.ts:105, Table.tsx:578, Grid.tsx:133.
- Table.tsx:662-800 (onKeyDownCapture :1101) + Grid.tsx:194-270 — Excel model: Tab/Enter/Shift+Enter/arrows/printable-starts-edit/Escape.
- TreeView.tsx:458-540 — Home/End/arrows/Escape roving tabindex.
- Tiptap slash/mention menus, workflows Builder (React Flow consumes arrows/Enter/Space/Delete; stopCanvasKeys guards), VariableTreeMenu capture-phase arrows.

### MES

- Wedge app-wide: mes x+/_layout.tsx:339-351 and erp x+/_layout.tsx:351-361 — scanned URL navigates.
- AssemblyView.tsx:1188-1268 — Enter/Space fire step primary action; ←/→ prev/next step. Guards to copy: `!hasOpenDialog()`, `!(Enter && wedgeBuffer !== "")`, ARMED_SWALLOW_MS=750 capture swallow for double-press clickers.
- Many modal-local Enter handlers (ReworkModal, SerialSelectorModal, IssueMaterialModal, InspectionMeasurementMatrix).
- MES has NO ⌘K/global search.

### Display components

`ShortcutKey` (modern keycap; Button auto-renders), `Kbd` (legacy hints in New.tsx, Explorers, academy SearchCommand ⌘K literal), `DropdownMenuShortcut`/`ContextMenuShortcut`/`MenuShortcut`/`CommandShortcut` exported but unused — menus currently show no hints.

### Collision hazards

1. ⌘K taken (global search + traceability local). 2. ⌘B hard-coded UI-kit sidebar, no input guard. 3. ⌘L AI agent, fires in inputs. 4. ⌘⇧ letter space heavily used. 5. Bare n/e/c/d/0-9 taken. 6. Bare Enter/Space/arrows load-bearing in MES + Table/Grid/TreeView. 7. Two hook systems disagree (syntax, keyup/keydown, dup-dropping). 8. Wedge owns Enter while a scan burst is buffered — global Enter bindings must replicate the wedgeBuffer guard.

## 3. App structure / attach points

### Form/submit infrastructure

- Vendored fork of remix-validated-form at `packages/form` (`@carbon/form`), zod + zod-form-data. NOT conform/rvf.
- `packages/form/src/components/Submit.tsx` — THE shared submit button, wraps Button; reads form state ctx, isSubmitting, owns useBlocker unsaved-changes modal. Also `DefaultDisabledSubmit`.
- ERP counts: 511 `<ValidatedForm` (281 files), 287 `<Submit` (234 files), 150 raw `type="submit"` (tail: fetcher.Form one-shots, status changes, ConfirmDelete), 1057 `<Button`. MES: 18 ValidatedForm, 10 Submit, 116 Button.

### Shared components ranked by leverage

| Rank | Component | Reach |
|---|---|---|
| 1 | Button `shortcut` prop (packages/react/src/Button.tsx) | ~1057 ERP + 116 MES, only 13 call sites use it |
| 2 | Submit (packages/form/src/components/Submit.tsx) | 287 save buttons / 234 files |
| 3 | ConfirmDelete (apps/erp/app/components/Modals/ConfirmDelete/ConfirmDelete.tsx) | 181 files; raw destructive `type="submit"` in fetcher.Form. Sibling: Modals/Confirm/Confirm.tsx |
| 4 | Table (apps/erp/app/components/Table/Table.tsx, 1567 lines) | 127 list pages; `primaryAction` slot; edit-mode-only key grid at :662/:1101; read-mode row nav is the gap |
| 5 | New (apps/erp/app/components/New.tsx) | 57 usages; already binds `n` via legacy hook; Button asChild wrapping Link |
| 6 | ModalDrawer* (@carbon/react) | 62 create/edit drawers; Submit lives in ModalDrawerFooter |
| 7 | DetailsTopbar/DetailSidebar | every detail page; per-link `shortcut` contract exists (legacy hook) |

### Navigation (ERP)

- Mount point for global provider/help overlay: `apps/erp/app/routes/x+/_layout.tsx` ~:473-487 (PrimaryNavigation + Topbar + Outlet + AgentRoot etc.).
- PrimaryNavigation.tsx — module rail; mounts SearchModal; useShortcutKeys for ⌘K at :236.
- 15 modules in `apps/erp/app/hooks/useModules.tsx` (accounting, documents, inventory, invoicing, parts, people, production, purchasing, quality, resources, sales, settings, shopFloor→MES, users, workflows). Order/visibility per-user (modulePreferences) — bind to stable `key`, never position.
- Topbar.tsx — Breadcrumbs, CompanySwitcher, AskDocs, CreateMenu (global "create anything" dropdown, permission-filtered), Notifications, AvatarMenu — no shortcuts today.
- Search.tsx (593 lines) exports `searchShortcut = { key: "K", modifiers: ["mod"] }`; aggregates use*Submodules hooks — already a de-facto "go to" navigator; extending palette beats a parallel g-prefix system.
- Gantt.tsx is the reference implementation for Button shortcut= usage (:1249-1287) + manual ShortcutKey legend :1314.

### MES

- AppSidebar.tsx — only nav: Operations, Assigned, Active, Recent, Jobs, Maintenance, Picking (+ dropdowns). No shortcuts.
- Controls.tsx :318-341 — PlayButton/PauseButton (giant round, type=submit in ValidatedForm) — most-pressed button in MES, no binding.
- QuantityModal (Finish), InspectionView Finish :1004, various modals.
- Touch-first, tablets, barcode scanners — bare single letters risky (wedge emits keystrokes); prefer modifier combos or enter/arrows.
- Only 4 existing MES shortcuts, all new-system (AssemblyView arrowright/enter, Step.tsx enter).

### Conflicts / design constraints

- Pagination binds bare ←/→ globally on table pages; Gantt binds all arrows — read-mode row nav via arrows collides. useShortcutKeys has no scope/priority concept (react-hotkeys-hook HotkeysProvider scopes = natural extension).
- Legacy useKeyboardShortcuts used in 14 ERP files (New, DetailsTopbar, DetailSidebar, Pagination, onboarding theme, 9 Explorers) — migration target; re-registers listeners every render; keyup/keydown quirk.
- Multiple ValidatedForm+Submit per page on detail pages (cards) — a blanket mod+s on Submit would register N handlers and click ALL of them; needs a focus-aware guard (submit the form containing focus; fall back to sole form; else no-op).
- Submit shortcut must set `enabledOnInputElements: true` (structured binding) or ⌘S won't fire while typing in a field — Button doesn't pass it by default.
