# Interaction, motion and accessibility

## Contents
1. Interaction patterns
2. Motion
3. Accessibility
4. Responsive (ERP) — summary

---

## 1. Interaction patterns

| Pattern | Carbon way | Exemplar |
|---|---|---|
| Keyboard shortcuts | named constants + `Button shortcut` / `useShortcutKeys` / `useShortcutKeyMap`; listed in `ShortcutHelp.tsx` (see `actions-and-overlays.md` §6) | `packages/react/src/shortcuts.ts`, `apps/erp/app/shortcuts.ts` |
| Global search / go-to | ⌘K palette; register sub-pages via `use{Module}Submodules`; `g` + letter module go-to | `apps/erp/app/components/Layout/Topbar/Search.tsx` |
| Drag & drop | dnd-kit with **`KeyboardSensor` always**, pointer `activationConstraint: { distance: 8 }`, `TouchSensor` on touch boards, translated screen-reader announcements, `dropAnimation={null}` | `apps/erp/app/components/LineReorder/ReorderableLineList.tsx`, `apps/mes/app/components/Kanban/Kanban.tsx` |
| Reorder document lines | explicit edit mode: draft order, Save/Cancel bar, Esc cancels, Save disabled until dirty | `apps/erp/app/components/LineReorder/` |
| Reorder BoM/BoP | live reorder + throttled (~1s) save | `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx` |
| Hover-revealed actions (ERP only) | `opacity-0 group-hover:opacity-100` **plus** `focus-visible:opacity-100` / `group-focus-within:opacity-100`; named groups (`group/row`) | `apps/erp/app/components/Hyperlink.tsx` |
| Context menus | same items as the ⋮ menu, via `Menu`/`MenuItem` (`Table renderContextMenu`) | `packages/react/src/Menu.tsx` |
| Optimistic UI | read pending `fetcher.formData` and render it as truth; no React `useOptimistic` | `apps/erp/app/components/Assignee.tsx` |
| Autosave | only on property/grid/toggle surfaces (`forms.md` §7) | `apps/erp/app/modules/quality/ui/Issue/IssueProperties.tsx` |
| Unsaved changes | `Submit` blocker (default on) | `packages/form/src/components/Submit.tsx` |
| Realtime | `RealtimeDataProvider` keeps picker caches fresh; screens revalidate on change but **not while a fetcher is submitting** | `apps/mes/app/hooks/useRealtime.tsx` |
| Bulk | `withSelectableRows` + `renderActions` (ERP tables only) | `apps/erp/app/modules/items/ui/Parts/PartsTable.tsx` |
| Barcode scanning | `useKeyboardWedge` buffers scans; a scanned Carbon URL navigates there; MES avoids bare-letter shortcuts | `packages/react/src/hooks/useKeyboardWedge.ts` |
| Copy identity | `Copy` next to IDs; "Copy link to X" / "Copy X number" icon buttons in Properties | `packages/react/src/Copy.tsx` |
| Audit | "audit log" item in the header ⋯ menu opens `AuditLogDrawer` (`useAuditLog`) | `apps/erp/app/components/AuditLog/` |
| Whole-row hit targets | a checkbox/choice row is a full-row `<label>` (`px-4 py-3 rounded-lg border hover:bg-accent`) | (`6e99e39b48`) |

No undo system exists — confirm destructive actions instead. No global "edit mode" for a record.

## 2. Motion

Motion is sparse and functional (framer-motion in ~43 files; no page transitions).

- **Durations:** 150–200ms default (`duration-150`, `duration-200`); 75ms for press; ≤300ms for
  panels. Nothing slow.
- **Easing:** `ease-out`; sidebar/panels ease-out-quint `cubic-bezier(0.23,1,0.32,1)`.
- **Transitions are property-scoped:** `transition-colors`, `transition-transform`,
  `transition-opacity`, `transition-[background-color,color,transform,box-shadow]`. Never
  `transition-all` in new code.
- **Press, not hover:** `active:scale-[0.96]` (Button has it). No `hover:scale-*`.
- **Enter/exit:** overlays animate via primitives (`animate-in fade-in zoom-in-95`) — don't add
  your own. `AnimatePresence initial={false}` so nothing animates on page load.
- **Icon swaps:** scale 0.25 → 1, opacity 0 → 1, blur 4px → 0, spring `bounce: 0`,
  `duration: 0.3`, `AnimatePresence mode="wait" initial={false}`
  (`apps/mes/app/components/JobOperation/components/Controls.tsx`).
- **Height changes:** animate height (shared panel) rather than a geometry jump (BoM/BoP expand).
- **Reduced motion:** every new motion gets a `motion-reduce:` fallback (`motion-reduce:transform-none`,
  `motion-reduce:transition-none`) or `useReducedMotion`.
- **Stagger** only for small groups revealed together (~60ms in, ~30ms out).
- Brand motion (CarbonPulse sweep, NProgress shine, VOID//SYS glitch) is for loading/error edges
  only.

## 3. Accessibility

- **Icon-only = `IconButton` with a translated `aria-label`** (type-required); wrap in `Tooltip`
  when not obvious. Never a bare `<button>` with only an icon.
- **Focus always visible** via `focus-visible:` (reuse primitive rings). Any hover-revealed
  control must also reveal on focus.
- **Status never color-only** — `Status` has icon + text; overdue gets text *and* an icon.
- **Semantics from primitives** (Radix, Base UI Tooltip, react-aria dates) — don't rebuild
  dialogs, menus, selects, or tooltips.
- **Headings:** `Subheading as="h3"` when it's a real section heading; `sr-only` labels for
  icon-only table columns ("Actions", "Expand").
- **Drag & drop:** keyboard sensor + translated announcements.
- **Field help:** `LabelWithHelp` (HoverCard + `sr-only` definition).
- **Hit areas:** ERP default buttons are 32px; for small custom targets extend the hit area with
  a pseudo-element (`before:-inset-2`) rather than growing the visual. MES targets ≥44px.
- **Clickable non-buttons:** avoid `onClick` on `div`/`tr`; use `Button`, `Link` or a `<label>`.
- **Known gaps to not copy:** untranslated aria-labels (esp. MES), hover-only reveals,
  `transition-all` + `hover:scale-105` on MES buttons without reduced-motion.

## 4. Responsive (ERP) — summary

Desktop-first, one JS breakpoint (768px). Panels collapse to drawers on mobile, Properties
collapses under 1024px, grids collapse to one column, headers scroll horizontally, content
widths are capped. `lg:` is the main layout breakpoint; `2xl:` is never used. Details in
`page-archetypes.md` §14; MES in `shop-floor-mes.md`.
