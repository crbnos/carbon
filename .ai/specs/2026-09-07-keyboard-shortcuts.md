# App-wide Keyboard Shortcuts

**Status:** In review
**Date:** 2026-09-07
**Branch:** `feat/keyboard-shortcuts`
**Research:** `.ai/research/2026-09-07-keyboard-shortcuts.md`
**Proposal reviewed by user:** `.ai/scratch/keyboard-shortcuts-proposal.md`

## Summary

Carbon's Button now supports a `shortcut` prop (PR #1569: `useShortcutKeys` on react-hotkeys-hook, keycap badge, topmost-dialog guard), but only ~13 call sites use it. This spec rolls keyboard shortcuts out app-wide (ERP + MES): submit/confirm actions, list-page actions, detail-section navigation, module go-to, and a discoverability overlay — while consolidating the two competing shortcut systems into one.

`mod` = ⌘ on mac, Ctrl on Windows/Linux. All new user-facing copy is Lingui-translatable from day one.

## Goals

- Every shared submit/confirm surface has a keyboard shortcut with a visible badge.
- One shortcut system (`useShortcutKeys`); the legacy `useKeyboardShortcuts` hook is migrated and deleted.
- Navigation: module go-to (ERP), sidebar go-to (MES), existing detail-tab shortcuts preserved on the new system.
- A `?` help overlay lists the shortcuts active on the current page.
- No regressions to existing shortcuts (⌘K, ⌘B, ⌘L, `n`, ⌘⇧ tabs, Explorer add-line, MES clicker/wedge behavior).

## Non-goals

- Bare-letter global shortcuts beyond the existing `n` (collide with typing, scanners, Gantt's e/c/d).
- Arrow-key table row navigation (collides with pagination ←/→ and Gantt; revisit later with hotkey scopes).
- Changes to Escape behavior (already handled by dialogs/ActionBar/Table).
- Shortcuts for academy/docs/starter apps.
- User-customizable bindings.

## The shortcut map

### Submit & common actions

| Shortcut | Action | Surface | Mechanism |
|---|---|---|---|
| **⌘Enter** | Submit the form you're editing | All `<Submit>` buttons (287 ERP / 234 files, 10 MES), incl. all 62 ModalDrawer drawers | `packages/form` `Submit.tsx` passes `shortcut` to `Button` by default; focus-aware guard (below) |
| **⌘Enter** | Confirm | `ConfirmDelete` (181 sites) + `Confirm` modals | shortcut on the confirm `Button`; topmost-dialog guard makes it win over any page form |
| **n** | New record | 57 list pages (`New.tsx`) | migrate from legacy hook to `Button shortcut="n"` |

### Navigation

| Shortcut | Action | Surface | Mechanism |
|---|---|---|---|
| **⌘K** | Global search / go-to | ERP (existing) | unchanged |
| **⌘B** | Toggle sidebar | all apps (existing) | unchanged; add the missing input-field guard in `Sidebar.tsx` |
| **⌘L** | AI agent panel | ERP (existing) | unchanged |
| **⌘⇧<letter>** | Detail-page section tabs | DetailsTopbar/DetailSidebar (existing) | migrate to `useShortcutKeys`; fix the ⌘⇧P double-binding (Planning moves to **⌘⇧N**, Purchasing keeps ⌘⇧P) |
| **⌘⇧L/A/P** | Add line / attribute / parameter | 9 document Explorers (existing) | migrate as-is |
| **← / →** | Prev/next table page | list pages (existing) | migrate as-is |
| **g then <letter>** | Go to ERP module | app-wide (ERP) | new sequence helper (below) |
| **⌥1–⌥7** | Go to MES sidebar page | MES app-wide | `useShortcutKeys` on AppSidebar links |
| **?** (Shift+/) | Shortcut help overlay | ERP + MES app-wide | new registry + overlay (below) |

**g-prefix module letters** (bound to the stable module `key`, never position — order is per-user):
`g a` accounting · `g d` documents · `g i` inventory · `g v` invoicing · `g t` items (parts) · `g o` people · `g r` production · `g p` purchasing · `g q` quality · `g u` resources · `g s` sales · `g e` settings · `g y` users · `g w` workflows. (`shopFloor` is an external MES link — excluded.) Letters are tuneable at review; only reachable modules (permission-filtered via `useModules()`) are bound.

**MES ⌥ digits:** ⌥1 Operations · ⌥2 Assigned · ⌥3 Active · ⌥4 Recent · ⌥5 Jobs · ⌥6 Maintenance · ⌥7 Picking. (⌘digits are browser-reserved tab switching — not interceptable.)

### MES actions

| Shortcut | Action | Surface |
|---|---|---|
| **Space** | Start/Pause the operation | `JobOperation` `Controls.tsx` Play/Pause button via `Button shortcut="space"` |
| Enter / Space / ← → | Step actions (existing) | AssemblyView — unchanged |

Space guards: inert in inputs (hook default), inert under open dialogs (Button guard), and must not double-bind on any screen that renders AssemblyView's own Space handler (separate routes today — `operation.$operationId` vs `assembly.$operationId` — verified during implementation).

## Design

### 1. Submit shortcut in `@carbon/form` (`packages/form/src/components/Submit.tsx`)

- `Submit` gains `shortcut?: ShortcutInput | ShortcutInput[] | false` — **default `mod+enter`**, `false` opts out. Forwarded to `Button` with a structured first binding `{ key: "enter", modifiers: ["mod"], enabledOnInputElements: true }` so it fires while typing in a field (react-hotkeys-hook disables form-tag events by default; Button doesn't pass this through today).
- **Focus-aware guard** (composed with Button's dialog guard): detail pages render multiple `ValidatedForm` cards, each with its own `Submit`; a naive default registers N handlers and clicks all N. Rule:
  1. If `document.activeElement` is inside a `<form>`: only the `Submit` belonging to that form fires.
  2. If focus is in any other editable surface (a formless textarea like the agent chat input, `.ProseMirror`, cmdk listbox, an open menu — the shared `isEditableTarget` util): no-op — those own their keys (lesson `.ai/lessons.md:373`).
  3. If focus is on a non-editable element or body: fire only if this is the **sole** enabled Submit currently registered; ambiguity means no-op, never "all".
  - Implemented via a module-level count of mounted active Submits in `@carbon/form`, so rule 3 is O(1); each Submit's guard closure checks it.
- `DefaultDisabledSubmit` inherits (it renders `Submit`).
- Badge: shown by default (⌘↵ keycap); `isLoading`/`isDisabled` already suppress/deactivate it. Sites whose Submit has a `rightIcon` keep working — badge wins over rightIcon per Button's existing contract.
- MES `Submit`s get this for free (same package).

### 2. Confirm modals

- `apps/erp/app/components/Modals/ConfirmDelete/ConfirmDelete.tsx` and `Modals/Confirm/Confirm.tsx`: add `shortcut="mod+enter"` to the confirm/destructive `Button`. The topmost-dialog guard ensures only the modal's button fires while it is open — page Submits go inert automatically. Bare Enter deliberately not used (destructive; scanner wedge flushes on Enter).

### 3. `?` help overlay (no runtime registry)

- `ShortcutHelpOverlay` component in `packages/react` (a Modal listing shortcut rows grouped by section), bound to `shift+/` via `useShortcutKeys`, mounted in `apps/erp/app/routes/x+/_layout.tsx` and `apps/mes/app/routes/x+/_layout.tsx`. Each app declares its entries, built exclusively from the central definition files — single-source by construction. Sequence entries (`["g","s"]`) render as chained keycaps. All copy via Lingui.
- A dynamic runtime registry (hooks self-registering descriptions) was reviewed out as speculative — nothing would consume it; revisit only if per-page dynamic listing becomes a real need.

### 4. `g` sequence helper

- New `useShortcutSequence(prefix: "g", map: Record<string, () => void>)` hook in `packages/react` (react-hotkeys-hook has no sequence support): keydown listener; on bare `g` (no modifiers, not in input/contenteditable, no open dialog, not while wedge buffer active) arms for 1.5s; next matching letter navigates; any other key or timeout disarms. Escape disarms. Unit-tested like `useShortcutKeys`.
- ERP: bound in `PrimaryNavigation.tsx` (which already has `useModules()` and mounts SearchModal) using module `key` → `navigate(to)`.

### 5. Legacy migration (delete `useKeyboardShortcuts`)

Migrate all 14 call sites to `useShortcutKeys` / `Button shortcut`:

- `New.tsx` → `Button shortcut="n"` (drops manual ref-click + `<Kbd>` tooltip; standard badge).
- `Pagination.tsx` → `useShortcutKeys` for ←/→ (IconButtons keep their Kbd hints or move to ShortcutKey).
- `DetailsTopbar.tsx` / `DetailSidebar.tsx` → per-link `useShortcutKeys`; link `shortcut` fields converted from legacy `"Command+Shift+d"` strings to `ShortcutInput` (`"mod+shift+d"`); tooltips render via `ShortcutKey`. Fix ⌘⇧P duplication across `usePartNavigation`, `useMaterialNavigation`, `useConsumableNavigation`, `useToolNavigation` (Planning → ⌘⇧N).
- 9 `*Explorer.tsx` files → `useShortcutKeys` with same combos; `<Kbd>{prettifyShortcut(...)}` hints → `ShortcutKey`.
- `onboarding+/theme.tsx` → `useShortcutKeys` (or `Button shortcut="enter"`).
- Then delete `packages/react/src/hooks/useKeyboardShortcuts.ts` (+ `usePrettifyShortcut` if no longer referenced) from the barrel.

Behavior notes: legacy fired single keys on key **up**; new fires on keydown — acceptable change. Legacy skipped inputs; new hook's defaults match.

### 6. Small fixes riding along

- `packages/react/src/Sidebar.tsx` ⌘B: route through `useShortcutKeys` (gains input guard + consistency) keeping the same combo.
- MES `Controls.tsx`: `PlayButton`/`PauseButton` get `shortcut="space"` (`ButtonWithTooltip` must forward the prop).
- MES `AppSidebar.tsx`: ⌥1–7 via `useShortcutKeys` per link, `ShortcutKey` hints in tooltips.

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Single source of truth | All combos live in central definition files — `packages/react/src/shortcuts.ts` (shared: save, confirm, new, help, sidebar), `apps/erp/app/shortcuts.ts` (detail tabs, explorers, pagination, module go-to, search), `apps/mes/app/shortcuts.ts` (nav, start/stop). Components import named constants; no inline combo strings. All logic (hooks, registry, guards, badge, overlay) lives in `packages/react` only. | **User requirement** — centralized, not scattered |
| Many-bindings-to-many-actions | New `useShortcutKeyMap(map)` helper in `packages/react` (one `useHotkeys` registration, dispatch by matched combo) replaces the legacy hook's `Record<combo, fn>` API for DetailsTopbar/DetailSidebar/Explorers/Pagination | dynamic link arrays can't call a hook per item |
| Button API addition | optional `shortcutGuard?: (e: KeyboardEvent) => boolean`, AND-composed with the dialog guard | lets Submit inject the focus-aware guard without duplicating Button's wiring |
| Plan approval gate | Execution starts only after the user approves the plan | **User requirement** (overrides ship-it auto-execute) |
| Submit combo | ⌘Enter only | **User decision** — leaves ⌘S to the browser; consistent "affirmative action" key |
| Confirm modal combo | ⌘Enter | **User decision** — deliberate two-key press for destructive actions; dialog guard resolves stacking with page forms |
| MES start/pause | Space | **User decision** — universal play/pause; guarded (inputs/dialogs) |
| Module go-to | `g` then letter | **User decision** — Linear/GitHub pattern; scales to 15 modules; small sequence helper built once |
| MES nav | ⌥1–7 | **User decision** — ⌘digits are browser-reserved |
| Legacy hook | migrate all 14 sites, delete | **User decision** — one listener system; fixes ⌘⇧P dup, per-render re-registration |
| Help overlay | `?` (shift+/), registry-based | **User decision** — standard discoverability pattern |
| ⌘⇧P duplication fix | Planning → ⌘⇧N | free letter, "plaNning"; Purchasing keeps P (matches Suppliers/Customers pages) |
| Multiple Submits per page | focus-aware guard + sole-submit fallback | prevents N forms submitting at once; the actual bug a naive default would ship |
| Shortcut display | Button's built-in `ShortcutKey` badge | already shipped; consistent; replaces ad-hoc `<Kbd>` hints as sites migrate |
| Enter (bare) for submit | rejected | wedge flushes scans on Enter; MES clicker owns Enter; react-aria fields swallow it |
| Scopes/priority system (HotkeysProvider) | not now | YAGNI — dialog guard + focus guard + no-arrow-rowNav avoids the need; revisit if collisions appear |

## Acceptance criteria

1. In any ERP create/edit drawer (e.g. New Customer), typing in a field and pressing ⌘Enter submits the form; the Submit button shows a ⌘↵ badge.
2. On a detail page with multiple form cards (e.g. Part → Details), ⌘Enter submits only the card containing focus; with focus on the page body and multiple forms present, nothing happens; with focus in a formless editable (the agent chat textarea), nothing happens.
3. With a ConfirmDelete modal open above an edit form, ⌘Enter triggers only the delete; Escape still closes.
4. `n` on a list page opens the New form exactly as before, badge rendered by Button, and no legacy listener remains (`useKeyboardShortcuts` file deleted, grep returns nothing).
5. On a Part detail page, ⌘⇧P goes to Purchasing and ⌘⇧N goes to Planning (both reachable — the old silent overwrite is gone).
6. `g` then `s` from any ERP page navigates to Sales; `g` while typing in an input does nothing; `g` with a modal open does nothing.
7. `?` opens the help overlay listing (at minimum) the global shortcuts and any page-registered ones, fully translated; Escape closes it.
8. MES: Space toggles Start/Pause on the operation screen; Space inside a quantity input does not; ⌥3 navigates to Active.
9. Existing behavior unchanged: ⌘K search, ⌘B sidebar, ⌘L agent, table pagination ←/→, Gantt e/c/d/arrows, AssemblyView Enter/Space/←/→, barcode wedge navigation.
10. `pnpm exec turbo run typecheck --filter=@carbon/react --filter=@carbon/form --filter=erp --filter=mes` passes; `useShortcutKeys` unit tests extended for sequence helper + registry.

## Phases (≤5, detailed in the plan)

1. **Infrastructure** (`packages/react`, `packages/form`): registry + `description`, sequence hook, Submit `shortcut` prop + focus-aware guard, Sidebar ⌘B guard, tests.
2. **Submit & confirm rollout**: Submit default ⌘Enter (ERP+MES), ConfirmDelete/Confirm ⌘Enter, audit odd Submits (rightIcon, portal cases).
3. **Legacy migration**: New, Pagination, DetailsTopbar/DetailSidebar (+⌘⇧P fix), 9 Explorers, onboarding theme; delete legacy hook.
4. **ERP navigation & discoverability**: g-prefix module go-to, `?` help overlay + static entries, i18n.
5. **MES**: Space start/pause, ⌥1–7 sidebar nav, MES help overlay; final sweep (translations, self-review, browser smoke test).

## Autonomous decisions (execution, 2026-09-07)

User enabled autonomous execution. Calls made without asking, worth review first:

1. **Test approach changed (review-worthy):** the repo has no DOM test environment (vitest env `node`, no jsdom) — instead of adding a jsdom dev dependency, the risky logic was extracted into pure, node-testable cores: `shouldSubmitOnShortcut` (Submit guard truth table, `packages/form/src/internal/submitShortcutRegistry.ts`), `sequenceStep` (g-prefix state machine), `matchesShortcut` (combo matcher). 76 tests green.
2. **Detail-tab constants corrected to real semantics (review-worthy):** the spec's guessed names (quoting/manufacturing/terms/documents) didn't match the code — actual tabs are Quality=⌘⇧Q, Sales(items)=⌘⇧X, Payment=⌘⇧P, Tax=⌘⇧T, Shipping=⌘⇧S, Processes=⌘⇧R, Activity=⌘⇧A. All combos unchanged from what users had (except the Planning fix ⌘⇧P→⌘⇧N as spec'd).
3. Duplicate-combo warning fires in all environments (packages/react has no `process.env` typing; a duplicate is a bug worth surfacing in prod consoles too).
4. `matchesShortcut` gained an `event.code` fallback for named punctuation (slash/period/comma/minus/equal) so `?` (shift+/) matches for the help overlay.
5. `ONBOARDING_SHORTCUTS.continue` and `MODULE_GO_TO_PREFIX` constants added (centralization consistency); the Settings module is included in g-go-to via `useSettingsModule()`.
6. `New.tsx` tooltip removed — the inline keycap badge replaces it (Gantt precedent).
7. Pagination's condensed IconButtons now receive the shortcut refs — the legacy binding only clicked the non-condensed buttons (small behavior improvement).
8. MES `ButtonWithTooltip`/`PlayButton`/`PauseButton` converted to `forwardRef` (needed for the Space ref-click).
9. `usePrettifyShortcut` deleted along with the legacy hook (unreferenced after migration — the plan made this conditional).
10. MES help overlay lists AssemblyView's Enter/Space/←/→ as display-only rows; the bindings stay owned by AssemblyView.

## Open questions (resolved)

- [x] Submit shortcut — **Answer:** ⌘Enter only (user; ⌘S rejected).
- [x] Confirm/delete modals — **Answer:** ⌘Enter (user).
- [x] MES start/pause — **Answer:** Space (user).
- [x] Optional scope — **Answer:** all four in: legacy migration, `?` overlay, MES nav keys, ERP module go-to (user).
- [x] ERP module go-to mechanism — **Answer:** `g` then letter sequences (user; ⌘digits browser-reserved).
- [x] MES nav keys — **Answer:** ⌥1–7 (user; replaces reserved ⌘1–7).

## Changelog

- 2026-09-07: Spec written after research (3 codebase surveys) and user interview; all questions resolved.
- 2026-09-07: Thermo-nuclear plan review (`.ai/reviews/2026-09-07-keyboard-shortcuts-plan-review.md`) folded in: refined Submit guard (formless editables), entries-array `useShortcutKeyMap` with dev duplicate warning, shared `isEditableTarget`, runtime registry cut as speculative, alt+digit `event.code` matching built in.

## Design revision (2026-09-07, user review round 1)

User review found the first pass mechanically applied ⌘Enter + visible badges everywhere with no interaction design. Reworked under these principles (now codified in `.claude/rules/conventions-ui.md` § Keyboard shortcuts):

- **Enter vs ⌘Enter is a per-screen design decision**: Enter for one-obvious-action screens (single input → native form submit; choice screens → select-and-continue); ⌘Enter only for real multi-field forms where Enter has other meanings.
- **Badge visibility ≠ binding**: login (erp+mes), OTP screens (mfa/unlock/SessionLockOverlay ×2, auto-submit at 6 digits) and the 10 single-text-input dialogs (`*TypeForm`/`*StatusForm`/`ScrapReason`/`NoQuoteReason`/`StorageType`/`ChangeNoticeType`/`ReviewersList`) keep the silent binding but drop the ⌘↵ badge (`hideShortcutKey`). Textarea/editor forms (Suggestion, RichText notes, UnscrapModal) keep the badge — Enter means newline there, so ⌘Enter is the legitimate advertised submit.
- **Choice screens got real semantics + focus management**: onboarding theme mode + swatches converted from N plain Buttons to Radix radio groups via new `RadioGroupButton` (packages/react/src/Radio.tsx — barrel export extended, "ask first" waived under autonomous refactor mandate); `ChoiceCardGroup` gained an `autoFocus` prop (focus selected card on mount); industry sub-screens A/B use it; both Next buttons + theme Next + import "Create company" carry `ONBOARDING_SHORTCUTS.continue` (Enter, ↵ badge) — replacing theme.tsx's hand-wired invisible `useShortcutKeyMap` Enter. Radix radios don't activate on Enter, which is what leaves Enter free to mean "continue". Initial focus added: login email, OTP inputs (InputOTP gained `autoFocus` prop), magic-link CTA, invite Join CTA; import-upload dropzone got a visible focus ring.
- **react-hotkeys-hook is the only matcher**: `useShortcutKeyMap` no longer hand-rolls a document listener + `matchesShortcut` — it delegates to `useHotkeys` (v4.5.1 matches `event.key` AND mapped `event.code`, so ⌥1→"¡", ⌥letter, shift+/ all work natively), dispatching entries by `canonicalCombo` (mirrors the library's internal `mapKey`; pinned by tests). `matchesShortcut` deleted (autonomous decision #1/#4 partially superseded). `useShortcutSequence` stays hand-rolled — the library has no sequence support (documented exception).
- Left as-is deliberately: plan.tsx (multiple independent CTAs, no single obvious action), Gantt's pre-existing inline shortcut literals + raw `useHotkeys` (pre-dates this work), MES AssemblyView/Step "enter" literals (pre-existing bindings), verify.tsx's no-submit-button form quirk.
