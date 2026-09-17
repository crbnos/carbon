# App-wide keyboard shortcuts — implementation plan

**Spec / source:** `.ai/specs/2026-09-07-keyboard-shortcuts.md`
**Research:** `.ai/research/2026-09-07-keyboard-shortcuts.md`
**Branch:** `feat/keyboard-shortcuts`
**Prior art:** `.ai/plans/2026-09-04-keyboard-shortcuts.md` (the executed Button-infra plan this builds on)
**Gate:** user approves this plan before execution; user commits (or explicitly asks for commits) — never auto-commit.

## Architecture rule (applies to every task)

**Single source of truth.** Every key combo is defined exactly once, in one of three
definition files, and imported everywhere else. All shortcut *logic* (hooks, registry,
guards, badge, overlay, sequence) lives in `packages/react` only. A task that writes a
combo string literal anywhere else is wrong.

- `packages/react/src/shortcuts.ts` — shared combos used by shared components (save, confirm, newRecord, help, sidebarToggle)
- `apps/erp/app/shortcuts.ts` — ERP combos (search, detail tabs, explorer add-line, pagination, module go-to)
- `apps/mes/app/shortcuts.ts` — MES combos (sidebar nav ⌥1–7, start/stop Space)

## Progress

- [x] Task 1: Shared shortcut definitions, `isEditableTarget`, and `useShortcutKeyMap` in @carbon/react
- [x] Task 2: `useShortcutSequence` hook (g-prefix) + tests
- [x] Task 3: Sidebar ⌘B via central constant with input guard
- [x] Task 4: Submit ⌘Enter default with focus-aware guard (@carbon/form + Button `shortcutGuard`) — jsdom tests replaced by pure-core node tests (no DOM test env in repo; see spec Autonomous decisions #1)
- [x] Task 5: ConfirmDelete / Confirm modals ⌘Enter (no MES equivalent exists)
- [x] Task 6: ERP central bindings file `apps/erp/app/shortcuts.ts` (tab constants corrected to real semantics)
- [x] Task 7: Migrate New.tsx and Pagination.tsx off the legacy hook
- [x] Task 8: Migrate DetailsTopbar/DetailSidebar + 8 nav hooks; ⌘⇧P duplicate fixed (Planning → ⌘⇧N)
- [x] Task 9: Migrate 10 Explorers + onboarding theme off the legacy hook
- [x] Task 10: Deleted `useKeyboardShortcuts` AND `usePrettifyShortcut` (both unreferenced)
- [x] Task 11: g-then-letter module go-to in PrimaryNavigation (settings included)
- [x] Task 12: `ShortcutHelpOverlay` (?) + ERP ShortcutHelp mounted in x+/_layout
- [x] Task 13: MES — ⌥1–7 sidebar nav, Space start/stop (single mount verified), MES help overlay
- [x] Task 14: i18n (288 translations filled across 12 locales, linguito + glossary checks green) + gates (react 41 tests, form 35 tests, erp+mes typecheck, lint 33/33) + docs sync (conventions-ui.md, react AGENTS.md). **Pending: browser walkthrough of spec AC 1–9 — dev stack not running; do with `/test` once `crbn up` is up.** Spec moves to `implemented/` after user acceptance. No commits made (user rule).

## Dependencies

Task 1 → all others. Task 2 → 11. Task 6 → 7, 8, 9, 11. Tasks 7, 8, 9 → 10.
Task 12 → 13 (overlay reuse). Task 14 last. Tasks 3, 5, 7 are independent of each
other once their deps are done.

Phases (spec): P1 = 1–4 · P2 = 5 · P3 = 6–10 · P4 = 11–12 · P5 = 13–14.

---

## Task 1: Shared shortcut definitions, `isEditableTarget`, and `useShortcutKeyMap` in @carbon/react

**Depends on:** none
**Files:**
- Create: `packages/react/src/shortcuts.ts`
- Create: `packages/react/src/utils/keyboard.ts` — `isEditableTarget`
- Modify: `packages/react/src/hooks/useShortcutKeys.ts` — add `useShortcutKeyMap`
- Modify: `packages/react/src/index.tsx` — barrel exports
- Modify: `packages/react/src/__tests__/useShortcutKeys.test.ts` — extend
- Copy from (precedent): `packages/react/src/hooks/useShortcutKeys.ts` (existing style), `packages/react/src/utils/dialog.ts`

**Steps:**
1. Create `packages/react/src/shortcuts.ts`:
```typescript
import type { Shortcut, ShortcutInput } from "./hooks/useShortcutKeys";

/**
 * Single source of truth for combos used by SHARED components.
 * App-specific combos live in apps/{erp,mes}/app/shortcuts.ts.
 * Never write a combo string literal at a call site.
 */
export const SHORTCUTS = {
  /** Submit the focused form — fires while typing in a field. */
  save: {
    key: "enter",
    modifiers: ["mod"],
    enabledOnInputElements: true
  } as Shortcut,
  /** Confirm a (destructive) modal action. */
  confirm: "mod+enter" as ShortcutInput,
  /** Open the "New record" page on list views. */
  newRecord: "n" as ShortcutInput,
  /** Open the shortcut help overlay. */
  help: "shift+slash" as ShortcutInput,
  /** Toggle the app sidebar. */
  sidebarToggle: "mod+b" as ShortcutInput
} as const;
```
2. Create `packages/react/src/utils/keyboard.ts` — THE single editable-target check (review must-fix 4; the same logic currently lives ad hoc in the legacy hook, the wedge, and Table):
```typescript
/** True when the event target (or given element) is a text-entry surface that
 *  owns its own keys: INPUT, TEXTAREA, SELECT, contenteditable, ProseMirror,
 *  cmdk list, or an open listbox/menu. Every shortcut hook/guard uses this —
 *  never re-implement the check at a call site. */
export function isEditableTarget(target: EventTarget | Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest(".ProseMirror, [cmdk-root], [role='listbox'], [role='menu']")
  );
}
```
3. In `useShortcutKeys.ts`, add and export `useShortcutKeyMap` — the modern, collision-proof replacement for the legacy record API (review must-fixes 2 + 3: ONE implementation, a plain listener; entries array, not a Record):
```typescript
export type ShortcutKeyMapEntry = {
  shortcut: ShortcutInput;
  action: (event: KeyboardEvent) => void;
};
export function useShortcutKeyMap(
  entries: ReadonlyArray<ShortcutKeyMapEntry>,
  options?: { disabled?: boolean }
): void;
```
Implementation: a single `document` keydown listener (attached once via `useEffect`, entries/options in refs). Per event: skip when `options.disabled`, when `hasOpenDialog()` (map shortcuts are page-level, never dialog-level), or when `isEditableTarget(event.target)`. Match by resolving each entry through `parseShortcut(entry.shortcut, isMac)`: exact modifier match (mod → metaKey on mac / ctrlKey elsewhere; alt/shift exact) + key match on `event.key.toLowerCase()`, **with a `event.code` fallback for digits and letters when `altKey` is held** (mac Option+1 emits `key: "¡"` but `code: "Digit1"` — review risk 10, built in from the start, not patched later). On match: `event.preventDefault()`, run the action, stop.
   Duplicate protection: in dev (`process.env.NODE_ENV !== "production"`), when two entries resolve to the same combo string, `console.warn` naming both — the legacy `Record` silently dropped duplicates, which is how the ⌘⇧P bug lived for years.
4. Barrel-export from `packages/react/src/index.tsx`: `SHORTCUTS`, `useShortcutKeyMap`, `isEditableTarget` (alongside existing `useShortcutKeys` exports).
5. Extend `packages/react/src/__tests__/useShortcutKeys.test.ts` (or a sibling test file): jsdom dispatch tests for `useShortcutKeyMap` — match fires + preventDefault; editable target skipped; open dialog skipped; alt+digit matches via `event.code`; duplicate entries warn in dev. Pure tests for `isEditableTarget`.

**Verify:**
```bash
pnpm --filter @carbon/react typecheck && pnpm --filter @carbon/react test
# Expected: both pass; test output includes the new useShortcutKeyMap cases
```

**Out of scope:** any app code; the sequence hook (Task 2); overlay UI (Task 12).

---

## Task 2: `useShortcutSequence` hook (g-prefix) + tests

**Depends on:** Task 1
**Files:**
- Create: `packages/react/src/hooks/useShortcutSequence.ts`
- Create: `packages/react/src/__tests__/useShortcutSequence.test.ts`
- Modify: `packages/react/src/hooks/index.ts` and `packages/react/src/index.tsx` — export
- Copy from (precedent): `packages/react/src/hooks/useShortcutKeys.ts` (style), `packages/react/src/utils/dialog.ts` (guards)

**Steps:**
1. Implement (react-hotkeys-hook has no sequence support — this is a plain `document` keydown listener):
```typescript
const SEQUENCE_TIMEOUT_MS = 1500;
/** Two printable keys closer than this are a scanner burst, not a human sequence. */
const SCANNER_BURST_MS = 50;

export function useShortcutSequence({
  prefix,               // e.g. "g"
  map,                  // Record<letter, () => void>
  disabled = false
}: {
  prefix: string;
  map: Record<string, () => void>;
  disabled?: boolean;
}): void;
```
Behavior (document these rules in the JSDoc):
   - Ignore entirely when: `disabled`; `isEditableTarget(event.target)` (the Task 1 util — never re-implement); any of meta/ctrl/alt is pressed; `hasOpenDialog()`.
   - Bare `prefix` keydown arms the sequence for `SEQUENCE_TIMEOUT_MS` (store `armedAt` + last-printable-key timestamp in refs).
   - If the `prefix` keydown arrived within `SCANNER_BURST_MS` of the previous printable keydown, do NOT arm (barcode-wedge burst — see `useKeyboardWedge`); track the previous-printable timestamp on every printable keydown.
   - While armed: a keydown matching a `map` key → `preventDefault()`, run it, disarm. Escape or any non-matching key → disarm. Timeout → disarm.
   - Listener attaches once per mount (`useEffect` with refs for map/disabled so re-renders don't re-attach).
2. Tests (jsdom): arm+match navigates; typing `g` inside an input does nothing; second key after timeout does nothing; burst-speed prefix ignored; Escape disarms.

**Verify:**
```bash
pnpm --filter @carbon/react test
# Expected: useShortcutSequence tests pass
```

**Out of scope:** binding any actual module map (Task 11).

---

## Task 3: Sidebar ⌘B via central constant with input guard

**Depends on:** Task 1
**Files:**
- Modify: `packages/react/src/Sidebar.tsx` — lines 29 and 106–120

**Steps:**
1. Delete `SIDEBAR_KEYBOARD_SHORTCUT` (line 29) and the manual `useEffect` keydown listener (lines 106–120).
2. In `SidebarProvider`, replace with:
```typescript
useShortcutKeys({
  shortcut: SHORTCUTS.sidebarToggle,
  action: (event) => {
    event.preventDefault();
    toggleSidebar();
  }
});
```
imports from `./hooks/useShortcutKeys` and `./shortcuts`. This intentionally adds the input-field guard the old listener lacked (hook default: inert in inputs) — spec'd behavior fix.

**Verify:**
```bash
pnpm --filter @carbon/react typecheck && grep -rn "SIDEBAR_KEYBOARD_SHORTCUT" packages/react/src/
# Expected: typecheck passes; grep returns nothing
```

**Out of scope:** changing the combo; MES/ERP layout files.

---

## Task 4: Submit ⌘Enter default with focus-aware guard

**Depends on:** Task 1
**Files:**
- Modify: `packages/react/src/Button.tsx` — add optional `shortcutGuard` prop
- Create: `packages/form/src/internal/submitShortcutRegistry.ts`
- Modify: `packages/form/src/components/Submit.tsx`
- Copy from (precedent): `packages/form/src/components/Submit.tsx` (current shape read 2026-09-07; Button wiring at `packages/react/src/Button.tsx:172-192`)

**Steps:**
1. `Button.tsx`: add to `ButtonProps`:
```typescript
/** Extra guard AND-composed with the built-in topmost-dialog guard. */
shortcutGuard?: (event: KeyboardEvent) => boolean;
```
Compose in the existing `useShortcutKeys` call: `guard: (e) => dialogGuard() && (shortcutGuard?.(e) ?? true)` (keep `dialogGuard` as-is; destructure `shortcutGuard` out of props so it doesn't hit the DOM).
2. Create `packages/form/src/internal/submitShortcutRegistry.ts` — module-level singleton:
```typescript
/** Buttons currently mounted with an active save shortcut; the focus-aware
 *  guard uses size===1 to decide the no-focus fallback. */
const registry = new Set<symbol>();
export function registerSubmitShortcut(id: symbol) { registry.add(id); }
export function unregisterSubmitShortcut(id: symbol) { registry.delete(id); }
export function submitShortcutCount() { return registry.size; }
```
3. `Submit.tsx`:
   - Props: `shortcut?: ButtonProps["shortcut"] | false;` — default: `SHORTCUTS.save` (import from `@carbon/react`). `false` disables entirely.
   - Keep an internal `buttonRef` merged with the forwarded ref (copy the `mergeRefs` pattern from `Button.tsx:211`).
   - Register in the module registry via `useEffect` whenever the shortcut is active (i.e. not `false` and not disabled/submitting); unregister on cleanup/deps change.
   - Focus-aware guard passed as `shortcutGuard` (review must-fix 1 — the truth table below is the contract):
```typescript
const shortcutGuard = useCallback((event: KeyboardEvent) => {
  const el = buttonRef.current;
  if (!el) return false;
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const activeForm = active.closest("form");
    // Typing in THIS form → submit it. Typing anywhere else that accepts
    // text (another form, the agent chat's formless textarea, a search box,
    // ProseMirror…) → never steal the keystroke (lesson .ai/lessons.md:373).
    if (activeForm) return activeForm === el.form;
    if (isEditableTarget(active)) return false;
  }
  // Focus on a non-editable element or body: fire only when this is the
  // sole active Submit on screen — ambiguity means no-op, never "all".
  return submitShortcutCount() === 1;
}, []);
```
   Truth table (each row becomes a test in step 6): focus in own form → fires; focus in another form → no-op; focus in a formless editable (e.g. `AgentInput`'s bare `<textarea>`, apps/erp/app/modules/agent/ui/AgentInput.tsx:39) → no-op; focus on body with one active Submit → fires; focus on body with two active Submits → no-op. `isEditableTarget` comes from `@carbon/react` (Task 1). Note `el.form` resolves both the `form={formId}` attribute case and ancestor-form case natively.
   - Pass to Button: `shortcut={shortcut === false ? undefined : shortcut}`, `shortcutGuard`, and `hideShortcutKey` only if a caller sets it (default badge VISIBLE — the ⌘↵ keycap is the discoverability mechanism).
4. Do NOT change `DefaultDisabledSubmit` — it renders `Submit` and inherits.
5. Escape hatch: if any existing `Submit` call site breaks visually because the badge collides with a custom `rightIcon` (grep `rightIcon` within `<Submit`), leave the badge winning (Button's documented contract) and note the sites in the run log. If typecheck reveals a `Submit` call site already passing `shortcut`, STOP and report — do not improvise.
6. **jsdom truth-table test** (review improvement 11 — this is the riskiest logic in the whole plan and must not ship untested): new `packages/form/src/components/__tests__/Submit.shortcut.test.tsx` (follow whatever test setup `packages/form` already uses — check for an existing `__tests__`/`*.test.tsx` and mirror it) covering all five truth-table rows from step 3, plus: registry count drops when a Submit unmounts or becomes disabled.
7. Known limitation to note inline: a mounted-but-invisible Submit (collapsed section) still counts — `count > 1` then fails safe to no-op (review risk 8). During Task 14 verification, check one collapsed-card screen.

**Verify:**
```bash
pnpm --filter @carbon/form typecheck && pnpm --filter @carbon/form test && pnpm --filter @carbon/react typecheck
# Expected: all pass; test output lists the Submit shortcut truth-table cases
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: passes — no Submit call site conflicts
```
After this task, render-audit a few dense screens for badge layout churn (quote line drawer footer, a settings form, a ModalDrawerFooter with 3 buttons) — `hideShortcutKey` is the escape valve per site if a footer wraps (review risk 5).

**Out of scope:** the 150 raw `type="submit"` buttons (only ConfirmDelete/Confirm get shortcuts, Task 5); changing blocker logic.

---

## Task 5: ConfirmDelete / Confirm modals ⌘Enter

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/components/Modals/ConfirmDelete/ConfirmDelete.tsx` — destructive Button (line ~69)
- Modify: `apps/erp/app/components/Modals/Confirm/Confirm.tsx` — its confirm Button (read the file first; same pattern)

**Steps:**
1. In both: `import { SHORTCUTS } from "@carbon/react"` (via the existing `@carbon/react` import) and add `shortcut={SHORTCUTS.confirm}` to the confirm/destructive `Button`. No guard needed — Button's topmost-dialog guard already scopes it to the open modal, and `isDisabled`/`isLoading` already deactivate it while the fetcher is busy.
   Add this comment beside the prop (review risk 6 — the pairing is tie-break-dependent): `Drawer and Modal are both z-50 (Drawer.tsx:23, Modal.tsx:35), so when this modal stacks over a drawer form the topmost-dialog guard resolves by "later-mounted wins" (utils/dialog.ts). If either z-index ever changes, re-verify ⌘Enter targets this modal, not the drawer's Submit.`
2. Grep for a MES equivalent (`grep -rn "ConfirmDelete" apps/mes/app/components/`) — if MES has its own copy, apply the same one-line change; if not, skip.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes
```

**Out of scope:** other modal footers; bare-Enter bindings.

---

## Task 6: ERP central bindings file

**Depends on:** Task 1
**Files:**
- Create: `apps/erp/app/shortcuts.ts`
- Modify: `apps/erp/app/components/Layout/Topbar/Search.tsx` — move `searchShortcut` definition out (keep a re-export for back-compat or update its importers)
- Copy from (precedent): `apps/erp/app/utils/path.ts` (the "typed central helper" idiom)

**Steps:**
1. Create `apps/erp/app/shortcuts.ts` — every ERP combo, one place:
```typescript
import { SHORTCUTS, type ShortcutDefinition, type ShortcutInput } from "@carbon/react";

export { SHORTCUTS };

export const searchShortcut: ShortcutDefinition = { key: "K", modifiers: ["mod"] }; // moved from Search.tsx

/** Detail-page section tabs (⌘⇧<letter>). Planning is N — P was double-bound to Purchasing for years. */
export const DETAIL_TAB_SHORTCUTS = {
  details: "mod+shift+d",
  attributes: "mod+shift+a",
  accounting: "mod+shift+a",
  purchasing: "mod+shift+p",
  planning: "mod+shift+n",
  inventory: "mod+shift+i",
  quoting: "mod+shift+q",
  manufacturing: "mod+shift+x",
  suppliers: "mod+shift+x",
  contacts: "mod+shift+c",
  locations: "mod+shift+l",
  terms: "mod+shift+t",
  shipping: "mod+shift+s",
  sales: "mod+shift+s",
  documents: "mod+shift+r"
} as const satisfies Record<string, ShortcutInput>;

/** Explorer (document line tree) actions. */
export const EXPLORER_SHORTCUTS = {
  addLine: "mod+shift+l",
  addAttribute: "mod+shift+a",
  addParameter: "mod+shift+p"
} as const satisfies Record<string, ShortcutInput>;

export const PAGINATION_SHORTCUTS = {
  previous: "arrowleft",
  next: "arrowright"
} as const satisfies Record<string, ShortcutInput>;

/** g-then-letter module go-to, keyed by the stable module `key` from useModules(). */
export const MODULE_GO_TO: Record<string, string> = {
  accounting: "a",
  documents: "d",
  inventory: "i",
  invoicing: "v",
  parts: "t",
  people: "o",
  production: "r",
  purchasing: "p",
  quality: "q",
  resources: "u",
  sales: "s",
  settings: "e",
  users: "y",
  workflows: "w"
};
```
   (Exact per-page tab keys: while migrating in Task 8, map each nav hook's existing legacy string to the matching constant; the table above covers every combo found in the survey — if a nav hook has a combo not listed here, add it to this file, never inline.)
2. `Search.tsx`: replace the local `export const searchShortcut ...` with `export { searchShortcut } from "~/shortcuts";` — or update the two importers (`PrimaryNavigation.tsx`, and grep for others) to import from `~/shortcuts` and delete the old export. Prefer updating importers + deleting.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && grep -rn "searchShortcut" apps/erp/app --include="*.tsx" --include="*.ts" -l
# Expected: typecheck passes; searchShortcut only defined in app/shortcuts.ts, imported elsewhere
```

**Out of scope:** binding anything new (Tasks 8, 9, 11).

---

## Task 7: Migrate New.tsx and Pagination.tsx off the legacy hook

**Depends on:** Tasks 1, 6
**Files:**
- Modify: `apps/erp/app/components/New.tsx`
- Modify: `apps/erp/app/components/Table/components/Pagination/Pagination.tsx`
- Copy from (precedent): `apps/erp/app/components/Gantt/Gantt.tsx:1249-1287` (Button `shortcut=` usage)

**Steps:**
1. `New.tsx`: delete `useKeyboardShortcuts`/`buttonRef`/`Kbd` tooltip; pass `shortcut={SHORTCUTS.newRecord}` on the existing `Button asChild` (keycap badge replaces the tooltip — keep the `Tooltip` only if the label alone is ambiguous; otherwise remove the Tooltip wrapper entirely, matching Gantt's plain-Button style). Import `SHORTCUTS` from `~/shortcuts`.
2. `Pagination.tsx`: replace the `useKeyboardShortcuts({ ArrowRight: ..., ArrowLeft: ... })` call (lines ~113–122) with `useShortcutKeyMap([{ shortcut: PAGINATION_SHORTCUTS.next, action: ... }, { shortcut: PAGINATION_SHORTCUTS.previous, action: ... }])`. Replace the four `prettifyShortcut("ArrowLeft"/"ArrowRight")` tooltip hints with `<ShortcutKey shortcut={PAGINATION_SHORTCUTS.previous|next} variant="small" />`.
3. Behavior check: legacy fired single keys on keyUp; the new map fires on keydown — accepted change (spec).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && grep -n "useKeyboardShortcuts" apps/erp/app/components/New.tsx apps/erp/app/components/Table/components/Pagination/Pagination.tsx
# Expected: typecheck passes; grep returns nothing
```

**Out of scope:** table row navigation (spec non-goal).

---

## Task 8: Migrate DetailsTopbar/DetailSidebar + nav-hook combos; fix ⌘⇧P duplicate

**Depends on:** Tasks 1, 6
**Files:**
- Modify: `apps/erp/app/components/Layout/Navigation/DetailsTopbar.tsx`
- Modify: `apps/erp/app/components/Layout/Navigation/DetailSidebar.tsx`
- Modify (combo strings only — find with `grep -rln 'shortcut: "Command' apps/erp/app`): `useInventoryNavigation.tsx`, `usePartNavigation.tsx`, `useMaterialNavigation.tsx`, `useConsumableNavigation.tsx`, `useToolNavigation.tsx`, `useServiceNavigation.tsx`, `useSupplierSidebar.tsx`, `useCustomerSidebar.tsx` (paths under `apps/erp/app/modules/*/ui/**` — grep locates them)

**Steps:**
1. Both nav components: change the `links` type's `shortcut?: string` to `shortcut?: ShortcutInput` (import type from `@carbon/react`); replace the `useKeyboardShortcuts(reduce...)` with `useShortcutKeyMap(links.filter(l => l.shortcut).map(l => ({ shortcut: l.shortcut!, action: () => navigate(...) })))` — the hook's dev duplicate-combo warning replaces the legacy silent overwrite; replace `usePrettifyShortcut` tooltip content with `<ShortcutKey shortcut={route.shortcut} variant="small" />`.
2. In each nav hook file: replace every legacy `"Command+Shift+<x>"` string with the matching `DETAIL_TAB_SHORTCUTS.<name>` import from `~/shortcuts`. **The fix:** in `usePartNavigation`, `useMaterialNavigation`, `useConsumableNavigation`, `useToolNavigation`, the SECOND `Command+Shift+p` entry (the Planning link) becomes `DETAIL_TAB_SHORTCUTS.planning` (⌘⇧N); the Purchasing link keeps `DETAIL_TAB_SHORTCUTS.purchasing`.
3. If a nav hook contains a combo with no matching constant, add a named constant to `apps/erp/app/shortcuts.ts` first — never inline.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
grep -rn '"Command+' apps/erp/app | grep -v Explorer
# Expected: typecheck passes; grep finds no remaining legacy combo strings outside Explorers (Task 9)
grep -rn "mod+shift+p" apps/erp/app/modules/items
# Expected: exactly one match per item nav hook (Purchasing only)
```

**Out of scope:** adding new tab shortcuts; Explorers (Task 9).

---

## Task 9: Migrate 9 Explorers + onboarding theme off the legacy hook

**Depends on:** Tasks 1, 6
**Files:**
- Modify (find with `grep -rln "useKeyboardShortcuts" apps/erp/app`): `QuoteExplorer.tsx`, `SalesOrderExplorer.tsx`, `SalesRFQExplorer.tsx`, `PurchaseOrderExplorer.tsx`, `SupplierQuoteExplorer.tsx`, `PurchasingRFQExplorer.tsx`, `PurchaseInvoiceExplorer.tsx`, `SalesInvoiceExplorer.tsx`, `ProcedureExplorer.tsx`, `TrainingExplorer.tsx`, `apps/erp/app/routes/onboarding+/theme.tsx`

**Steps:**
1. Each Explorer: replace `useKeyboardShortcuts({ "Command+Shift+l": fn, ... })` with `useShortcutKeyMap([{ shortcut: EXPLORER_SHORTCUTS.addLine, action: fn }, ...])` (constants from `~/shortcuts`); replace `<Kbd>{prettifyShortcut("Command+Shift+l")}</Kbd>` hints with `<ShortcutKey shortcut={EXPLORER_SHORTCUTS.addLine} variant="small" />`.
2. `theme.tsx`: replace its Enter binding with `useShortcutKeys({ shortcut: "enter", action: ... })` — this is a single-purpose onboarding page; "enter" here is page-scoped and pre-existing (not a new bare-key global). If the Enter handler is on a Button, prefer `Button shortcut="enter"`.
3. After this task the ONLY remaining importer of `useKeyboardShortcuts` should be none — confirm with grep before Task 10.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && grep -rn "useKeyboardShortcuts\|prettifyShortcut" apps/erp/app | grep -v node_modules
# Expected: typecheck passes; grep returns nothing
```

**Out of scope:** changing which actions Explorers expose.

---

## Task 10: Delete the legacy hooks

**Depends on:** Tasks 7, 8, 9
**Files:**
- Delete: `packages/react/src/hooks/useKeyboardShortcuts.ts`
- Maybe delete: `packages/react/src/hooks/usePrettifyShortcut.ts` (only if `grep -rn "usePrettifyShortcut" apps packages` finds no remaining users)
- Modify: `packages/react/src/hooks/index.ts` (and `packages/react/src/index.tsx` if re-exported) — remove exports

**Steps:**
1. `grep -rn "useKeyboardShortcuts" apps packages --include="*.ts*"` — must return only the hook file itself. If any consumer remains, STOP and report (a migration task missed it).
2. Delete the file(s), remove barrel exports.

**Verify:**
```bash
pnpm --filter @carbon/react typecheck && pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: all pass — nothing references the deleted hooks
```

**Out of scope:** `useEscape`, `useKeyboardWedge` (still legitimate).

---

## Task 11: g-then-letter module go-to in PrimaryNavigation

**Depends on:** Tasks 2, 6
**Files:**
- Modify: `apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx` (existing `useShortcutKeys` for search at line ~235 is the precedent)

**Steps:**
1. In `PrimaryNavigation`, after the existing modules load (`useModules()`), build the sequence map from `MODULE_GO_TO` (import `~/shortcuts`), including only modules the user can see (the hook already permission-filters), and `navigate(module.to)`:
```typescript
const modules = useModules();
const navigate = useNavigate();
const goToMap = useMemo(() => {
  const map: Record<string, () => void> = {};
  for (const m of modules) {
    const letter = MODULE_GO_TO[m.key];
    if (letter) map[letter] = () => navigate(m.to);
  }
  return map;
}, [modules, navigate]);
useShortcutSequence({ prefix: "g", map: goToMap });
```
2. Escape hatch: if `useModules()` in this component doesn't expose `key`/`to` in that shape, read `apps/erp/app/hooks/useModules.tsx` and adapt the property names — do not change the central `MODULE_GO_TO` shape. The `settings` module comes from `useSettingsModule()` — include it iff trivially available; otherwise drop `g e` and note it in the run log.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes
```

**Out of scope:** badges/hints for sequences (help overlay covers discoverability, Task 12); MES.

---

## Task 12: `ShortcutHelpOverlay` + mount in ERP layout

**Depends on:** Task 1
**Files:**
- Create: `packages/react/src/ShortcutHelpOverlay.tsx`
- Modify: `packages/react/src/index.tsx` — export
- Create: `apps/erp/app/components/ShortcutHelp.tsx` (app wrapper providing translated entries)
- Modify: `apps/erp/app/routes/x+/_layout.tsx` — mount `<ShortcutHelp />` next to `<AgentRoot />` (~line 473–487)
- Copy from (precedent): `apps/erp/app/components/Layout/Topbar/Search.tsx` (SearchModal — a `Modal` opened by a `useShortcutKeys` binding); `packages/react/src/ShortcutKey.tsx` (keycap rendering)

**Steps:**
1. `ShortcutHelpOverlay.tsx` (packages/react — dumb component; there is deliberately NO runtime registry — review improvement 12 cut it as speculative; the overlay renders exactly what the app declares, built from the central constants, which stays single-source by construction):
```typescript
export type ShortcutHelpEntry = {
  /** Rendered as keycaps. A string[] means a sequence ("g" then "s"). */
  shortcut: ShortcutInput | string[];
  description: string;   // translated by the app
  group: string;         // translated section heading
};
type ShortcutHelpOverlayProps = {
  title: string;
  entries: ShortcutHelpEntry[];
  emptyLabel: string;
};
```
Binds `SHORTCUTS.help` via `useShortcutKeys` (guard: skip when `hasOpenDialog()` so `?` typed in a modal's field never opens it — the hook's input-guard already covers fields). Renders a `Modal` grouping entries by `group`, each row `description` + keycaps. Export a row-building helper from this file so both apps only declare data (review improvement 13): sequence entries (`string[]`) render one `<ShortcutKey>` per element with a small "then" separator.
2. `apps/erp/app/components/ShortcutHelp.tsx`: `useLingui()` and pass translated `title`/`emptyLabel`/`entries` — built from central constants ONLY (`~/shortcuts` + `SHORTCUTS`): search ⌘K, sidebar ⌘B, save ⌘↵, confirm ⌘↵, new N, pagination ←/→, detail tabs (one row: "⌘⇧<letter> — jump to section"), explorer add-line, and one row per `MODULE_GO_TO` entry as `["g", letter]`.
3. Layout: mount `<ShortcutHelp />` inside the authenticated shell.
4. All strings via `useLingui`/`<Trans>` (i18n rule: NO `t` from `@lingui/core/macro`).

**Verify:**
```bash
pnpm --filter @carbon/react typecheck && pnpm exec turbo run typecheck --filter=erp
# Expected: passes
```

**Out of scope:** MES mount (Task 13); persisting overlay state.

---

## Task 13: MES — ⌥1–7 sidebar nav, Space start/stop, help overlay

**Depends on:** Tasks 1, 12
**Files:**
- Create: `apps/mes/app/shortcuts.ts`
- Modify: `apps/mes/app/components/AppSidebar.tsx` (nav links array ~line 195–232)
- Modify: `apps/mes/app/components/JobOperation/components/Controls.tsx` (the `StartStopForm` rendering Play/Pause at ~line 300–315)
- Create: `apps/mes/app/components/ShortcutHelp.tsx`; Modify: `apps/mes/app/routes/x+/_layout.tsx` (provider + mount, next to the existing `useKeyboardWedge` wiring ~line 339–351)

**Steps:**
1. `apps/mes/app/shortcuts.ts`:
```typescript
import { SHORTCUTS, type ShortcutInput } from "@carbon/react";
export { SHORTCUTS };
/** ⌥+digit — ⌘+digit is browser-reserved tab switching. Order matches AppSidebar. */
export const MES_NAV_SHORTCUTS: Record<string, ShortcutInput> = {
  operations: "alt+1", assigned: "alt+2", active: "alt+3", recent: "alt+4",
  jobs: "alt+5", maintenance: "alt+6", picking: "alt+7"
};
export const START_STOP_SHORTCUT: ShortcutInput = "space";
```
2. `AppSidebar.tsx`: add a `key` to each link matching `MES_NAV_SHORTCUTS` keys; one `useShortcutKeyMap` with entries mapping each `MES_NAV_SHORTCUTS` combo → `navigate(link.to)`. mac ⌥+digit matching is already handled by the hook's `event.code` fallback (Task 1) — verify it manually on mac during Task 14; if it still fails, STOP and report rather than dropping the feature.
3. `Controls.tsx`: in `StartStopForm` (the component wrapping `<PlayButton|PauseButton type="submit">` in the `ValidatedForm`), add a ref on the rendered button and:
```typescript
useShortcutKeys({
  shortcut: START_STOP_SHORTCUT,
  action: (event) => { event.preventDefault(); buttonRef.current?.click(); },
  guard: () => !hasOpenDialog(),
  disabled: fetcher.state !== "idle"
});
```
(`hasOpenDialog` is already barrel-exported from `@carbon/react` — index.tsx:577; `ButtonWithTooltip` wraps a plain `<button>`, so forward a ref via `ComponentProps<"button">`'s existing pass-through or wrap with a local ref callback.) Space stays inert in inputs (hook default). Two multiplicity checks (review risk 9), both STOP-and-report if violated: (a) AssemblyView (`assembly.$operationId`) and this operation screen are separate routes, so the two Space handlers never coexist; (b) exactly ONE `StartStopForm` mounts per screen — if any route renders several (e.g. a future list of operations), Space would click all of them.
4. Mount a MES `ShortcutHelp.tsx` (entries from `MES_NAV_SHORTCUTS`, `START_STOP_SHORTCUT`, `SHORTCUTS.save`, `SHORTCUTS.sidebarToggle`, and the existing AssemblyView Enter/Space/←/→ as rows) in `apps/mes/app/routes/x+/_layout.tsx`, reusing the Task 12 overlay + row helper.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: passes
```

**Out of scope:** changing AssemblyView's existing key handling; scanner wedge behavior.

---

## Task 14: i18n + full verification sweep

**Depends on:** all
**Steps:**
1. `pnpm lingui:extract` — new `.po` entries appear for overlay/help strings. Then fill translations via the `/translate` skill (per repo convention; do NOT leave empty msgstr).
2. Full gates:
```bash
pnpm --filter @carbon/react typecheck && pnpm --filter @carbon/react test
pnpm --filter @carbon/form typecheck && pnpm --filter @carbon/form test
pnpm exec turbo run typecheck --filter=erp --filter=mes
pnpm run lint
# Expected: all green
```
3. Manual/browser verification (requires the local dev stack; if not running, list this as pending for the user rather than starting Docker): walk spec acceptance criteria 1–9 with agent-browser via the `/auth` + `/test` skills — closed-loop per the lesson at `.ai/lessons.md:1292` (fresh reload per check).
4. Update docs-sync dependents per `.claude/rules/keep-sources-in-sync.md`: grep `.claude/rules` and `packages/react/AGENTS.md` for `useKeyboardShortcuts` AND `usePrettifyShortcut`; update `conventions-ui.md`'s Button props list (currently omits `shortcut`/`hideShortcutKey`; add `shortcutGuard`) and `packages/react/AGENTS.md` Key Patterns; record any new lesson (candidates: topmost-dialog tie-break dependency, focus-aware submit guard) in `.ai/lessons.md`.
5. Move `.ai/specs/2026-09-07-keyboard-shortcuts.md` to `.ai/specs/implemented/` after the user accepts the work (update it first if implementation diverged).
6. Present the diff summary to the user for commit approval (never auto-commit).
