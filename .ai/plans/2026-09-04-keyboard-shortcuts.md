# Keyboard Shortcuts — implementation plan (merged, executed)

**Spec / source:** `.ai/specs/2026-09-04-keyboard-shortcuts.md`
**Branch:** `fix/mes-ui-imp` (worktree `/Users/aashu/work/carbon/carbon-fix-mes-ui-imp`)
**Supersedes:** `2026-09-04-mes-assembly-step-shortcuts.md` + `2026-09-04-button-shortcut-prop.md`
(merged on user request; both fully executed — this file is the consolidated record).

## Progress — Part A: MES assembly step shortcuts
- [x] A1: Lift the current step's primary action into a parent-readable ref (`primaryStepActionRef`)
- [x] A2: Capture-phase document keydown listener (Space/Enter/←/→) with guards: modified-key,
      editable-target, dialog, barcode-wedge yield, armed-swallow window (750ms, added post-plan)
- [x] A3: Key badges on Mark done / Record / Skip (later migrated from `Kbd` glyphs to `ShortcutKey`)
- [x] A4: Typecheck + browser verification (records, navigation, gates; test data cleaned)

## Progress — Part B: Button `shortcut` prop
- [x] B1: Extend `useShortcutKeys` — `KeyboardKeys` enum, `ShortcutInput` (string | definition,
      single or array), `resolveShortcutKeys`, `parseShortcut`, `guard` option
- [x] B2: `ShortcutKey` — reference keycap styling + `SHORTCUT_KEY_ICON_MAP` (SVG glyphs, text fallback)
- [x] B3: `Button` — `shortcut` / `hideShortcutKey` props, merged ref, ref-click action, dialog
      guard, badge replaces `rightIcon` while visible; barrel exports (`KeyboardKeys`, `ShortcutInput`)
- [x] B4: Unit tests (`__tests__/useShortcutKeys.test.ts` — resolver + parser, 27 total green)
- [x] B5: Typecheck (react/mes/erp), tests, browser verification via temporary probe (reverted)

## Progress — Part C: post-build revisions (user-directed)
- [x] C1: String prop form (`"mod+s"`) passing straight through to react-hotkeys-hook
- [x] C2: MES badges migrated to `ShortcutKey`; Skip's `LuSkipForward` rightIcon removed
- [x] C3: `RecordModal` Record button (`Step.tsx`) given `shortcut="enter"`
- [x] C4: Armed clicker guard time-boxed to `ARMED_SWALLOW_MS = 750` so select-all + deliberate
      Enter submits (trade-off accepted: slow clicker re-press can submit the default)

## Files changed (all uncommitted; user commits manually)
- `apps/mes/app/components/AssemblyView.tsx` — listener, action ref, badges
- `apps/mes/app/components/JobOperation/components/Step.tsx` — RecordModal submit shortcut
- `packages/react/src/hooks/useShortcutKeys.ts` — enum, types, resolver, parser, guard
- `packages/react/src/ShortcutKey.tsx` — keycap restyle, icon map
- `packages/react/src/Button.tsx` — shortcut wiring
- `packages/react/src/index.tsx` — barrel exports
- `packages/react/src/__tests__/useShortcutKeys.test.ts` — new tests

## Verification record
```bash
pnpm --filter @carbon/react typecheck   # green
pnpm --filter @carbon/react test        # 27 passed (needed one-time: pnpm --filter @carbon/config build)
pnpm exec turbo run typecheck --filter=mes --filter=erp   # green
```
Browser (dev stack, agent-browser): step record/navigate/gates on `/x/assembly/…`; modal
select-all + delayed-Enter submit; `mod+d`, `mod+enter` and array-of-bindings probes on a temp
Button usage (reverted); disabled/dialog-guard/hideShortcutKey checks. All test records and
auto-started labor events deleted from the dev DB afterwards.

## Known follow-ups (not planned here)
- Migrate ERP `useKeyboardShortcuts` call sites (e.g. `New.tsx`, Pagination) to the Button prop.
- Consider scopes/conflict detection if two mounted buttons ever claim one combo.

## Progress — Part D: thermo-nuclear review fixes
- [x] D1: Focused-button double-fire — `clickSelf` now `preventDefault()`s before ref-click
      (bare Enter/Space on a focused shortcut button fired native click + hotkey click);
      verified in browser: focused Record + Enter = exactly one record
- [x] D2: Dialog-open detection extracted to `packages/react/src/utils/dialog.ts`
      (`hasOpenDialog` / `isInsideOpenDialog`, barrel-exported) — used by Button and AssemblyView
- [x] D3: `parseShortcut` trims tokens ("mod + s" now valid); string bindings normalize through
      the same parse path as structured ones (suite green, 27 tests)
- [x] D4: `enabledOnInputElements` first-binding-only rule documented; badge render derived from
      a narrowed `badgeShortcut` local
- Deferred (discretionary): extracting AssemblyView's listener into a named hook; converging
  ERP's `useKeyboardShortcuts` onto `useShortcutKeys`
