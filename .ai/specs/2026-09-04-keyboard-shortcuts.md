# Keyboard Shortcuts — MES step advancement + app-wide Button `shortcut` prop

**Status:** Implemented (uncommitted) · **Date:** 2026-09-04 · **Branch:** `fix/mes-ui-imp`
**Research:** `.ai/research/mes-step-shortcuts.md`
**Supersedes:** `2026-09-04-mes-assembly-step-shortcuts.md` + `2026-09-04-button-shortcut-prop.md` (merged on user request)

## Summary / Problem

Two connected features, built in sequence:

1. **MES assembly view hands-free advance** — operators work away from the tablet (vehicle
   trolley); a Bluetooth clicker/pedal (a keyboard emitting Space/Enter/arrows) should advance
   procedure steps without walking back. Customer request; also listed as future work in
   `.ai/specs/implemented/2026-07-14-mes-execution-views.md:399`.
2. **App-wide Button shortcuts** — any `@carbon/react` `Button` can declare a hotkey via a prop,
   with a visible key badge, built on the previously dormant `useShortcutKeys` (react-hotkeys-hook
   wrapper) + `ShortcutKey` renderer.

## Goals

- Assembly view: Space/Enter fires the current step's primary action (Task → record instantly;
  input steps → open `RecordModal`); ←/→ navigate steps (→ ≡ Skip); visible key badges; every
  existing gate respected (pending-scan soft gate, modal semantics, typing focus).
- Button: `shortcut?: ShortcutInput | ShortcutInput[]` — string form (`"mod+s"`) or structured
  `ShortcutDefinition` (per-platform combos), arrays as alternative bindings (badge shows the
  first); `hideShortcutKey` keeps the hotkey and hides the badge; hotkey strictly follows
  disabled/loading; dialog-aware guard.
- `KeyboardKeys` enum as optional typed autocomplete for key names.
- Badges render as the reference keycap style, with centered SVG glyphs where mapped
  (`SHORTCUT_KEY_ICON_MAP`) and text fallback.

## Non-goals

- No scope/priority system; no conflict detection between two mounted buttons claiming a combo
  (last registered wins). No migration of ERP `useKeyboardShortcuts` call sites. No shortcut on
  the step Undo action (deliberate — a clicker must not be able to un-record work; it's an
  IconButton, so a badge wouldn't render anyway). No tooltip layer.

## Design

### MES assembly view (`apps/mes/app/components/AssemblyView.tsx`)

- One `document` keydown listener in the **capture phase** (per `.ai/lessons.md:812-814`), claims
  only Space/Enter/←/→ with `preventDefault`+`stopPropagation` (prevents focused-button
  double-fire), never Escape, never modified combos.
- The current step's primary action is lifted from `StepCompleteAction` into a parent ref
  (`primaryStepActionRef`), null when done/gated/submitting — the key is inert exactly when the
  button is.
- Guards, in order: modified-key → ignore; dialog open → armed-swallow window (below) else native
  semantics; editable target (INPUT/TEXTAREA/SELECT/contenteditable/ProseMirror) → ignore;
  barcode-wedge buffer non-empty → yield Enter to `useKeyboardWedge` (kanban scan-to-complete
  terminates with Enter).
- **Armed-swallow window:** for `ARMED_SWALLOW_MS = 750` after the shortcut opens a modal,
  Space/Enter are swallowed — the RecordModal autofocuses (and selects) its input, so a clicker
  double-press would natively submit the default value (reproduced: a 0 measurement). After the
  window a deliberate Enter submits normally; any other key or pointer tap ends the window early.
  Known trade-off (user-accepted): a clicker pressed again slowly on an input step can submit the
  default.
- Badges on Mark done/Record (`enter`) and Skip (`arrowright`) use the shared `ShortcutKey`
  renderer, `hidden md:flex`; Skip's `LuSkipForward` rightIcon was removed (badge owns the
  trailing slot).
- `RecordModal`'s Record button (`Step.tsx`) carries `shortcut="enter"` — badge in the modal, and
  Enter clicks it when focus isn't in a field (in-field Enter submits natively).

### Button prop (`packages/react/src/Button.tsx` + `hooks/useShortcutKeys.ts` + `ShortcutKey.tsx`)

- `ShortcutInput = string | ShortcutDefinition`; `resolveShortcutKeys()` normalizes one-or-many
  inputs to react-hotkeys-hook key strings; `parseShortcut()` splits a string (leading modifier
  tokens + key) or picks the platform arm, feeding the badge renderer.
- `KeyboardKeys` enum values are react-hotkeys-hook-compatible names (`"enter"`, `"arrowup"`,
  `"space"`, letters, digits).
- Button: internal ref merged with the forwarded ref; hotkey **ref-clicks** the button (preserves
  `type="submit"` form semantics; disabled click is a native no-op) with
  `enabled: !(isDisabled || disabled || isLoading)`; dialog guard = only buttons inside an open
  `[role="dialog"][data-state="open"]` respond while one exists; badge renders after the label,
  replaces `rightIcon` while visible, suppressed for `isIcon`/`isLoading` (IconButton inherits).
- `ShortcutKey` restyled to the reference keycap (fixed-height chip, `bg-white/10`,
  `rounded-[3px]`, shadow, backdrop blur, currentColor); `SHORTCUT_KEY_ICON_MAP` renders
  enter/space/backspace/arrows and mac ⌘⇧⌥ modifiers as centered lucide SVGs, text fallback
  otherwise (windows modifiers stay `Ctrl+`-style text).
- Exports added to the `@carbon/react` barrel: `KeyboardKeys`, `ShortcutInput` (hook, renderer,
  other types were already exported).

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| MES keys | Space/Enter = record, ←/→ = navigate | What clickers/page-turner pedals emit; user-approved |
| MES scope | Assembly view only | Only view with a step cursor (`?step=`); user-approved |
| MES listener | Own capture-phase document listener | Needs keydown+preventDefault double-fire safety; `useKeyboardShortcuts` fires single keys on keyup |
| Wedge coexistence | Enter yields while scan buffer non-empty | Kanban scan-to-complete terminates with Enter |
| Clicker double-press | Time-boxed 750ms swallow (was: until disarm) | User wants select-all + deliberate Enter to submit; window still catches rapid double-press |
| Non-Task step on Space/Enter | Open RecordModal | Visible feedback beats a silent no-op |
| Undo shortcut | None, deliberately | Clicker must not un-record; badge wouldn't render on an IconButton |
| Button engine | Extend dormant `useShortcutKeys` (react-hotkeys-hook) | User's direction; typed, platform-aware, zero call sites to break |
| Button prop shape | `string \| ShortcutDefinition`, single or array | User loosened from enum-only; strings pass through, arrays = alternatives |
| Trigger mechanism | Ref-click | Form-submit semantics; native disabled no-op |
| Modal behavior | Dialog-aware guard | Background hotkeys under a modal are bug reports waiting |
| Badge vs rightIcon | Badge replaces rightIcon while visible; leftIcon kept | Both trailing elements read cluttered; user-requested |
| Badge glyphs | `SHORTCUT_KEY_ICON_MAP` SVGs + text fallback | User's reference renderer flexibility; icons center better |
| Branch | `fix/mes-ui-imp` | Running dev stack for browser verification |

## Acceptance criteria (all verified in browser on the dev stack)

1. Assembly view: Space/Enter records a Task step (auto-advance follows); opens the RecordModal on
   input steps; inert while typing, while gated by pending scans, and during the 750ms window.
2. ←/→ navigate without recording; clamped at both ends; inert while a modal is open.
3. RecordModal: select-all default stays; Enter past the window (or after typing) submits; Record
   button shows the ↵ badge and responds to Enter when focus is outside fields.
4. `<Button shortcut="mod+s">` and structured/array forms trigger via the combo, render the keycap
   badge (SVG glyphs where mapped), respect disabled/loading, respect the dialog guard, submit
   forms for `type="submit"`, and `hideShortcutKey` hides only the badge.
5. `pnpm --filter @carbon/react typecheck|test` green (27 tests incl. resolver/parser suites);
   `turbo run typecheck --filter=mes --filter=erp` green.

## Open Questions (audit trail — resolved across both original specs)

- [x] MES keys / scope / hint UI / worktree — user picked recommended options.
- [x] Button prop shape — ShortcutDefinition+enum, then user loosened to strings; arrays for
  multiple bindings per action.
- [x] `hideShortcutKey` name; dialog-aware guard; same worktree — user-approved.

## Changelog

- 2026-09-04 — Both features specced, interviewed, implemented and browser-verified.
- 2026-09-04 — Execution discoveries folded in: barcode-wedge Enter yield; armed clicker guard
  (later time-boxed to 750ms at user request); `@carbon/config` needed a one-time build for vitest.
- 2026-09-04 — Post-build revisions (user-directed): string prop form; reference keycap styling;
  badge replaces rightIcon; SVG glyph map; MES badges migrated from hand-rolled `Kbd` to
  `ShortcutKey`; RecordModal Record button given `shortcut="enter"`.
- 2026-09-04 — Merged the two specs into this file; originals removed. Phantom-record scare during
  testing traced to overlapping test sessions across HMR edits, not shipped code (controlled
  repro: load creates nothing; Enter opens modal only; second Enter records exactly one row).
