# Thermo-nuclear review — app-wide keyboard shortcuts PLAN

Target: `.ai/plans/2026-09-07-keyboard-shortcuts-app-wide.md` + `.ai/specs/2026-09-07-keyboard-shortcuts.md` (docs only; no code yet). Findings reference plan tasks and real code lines.

## Must fix

1. **Submit guard's sole-submit fallback fires while typing in non-form editables** (Task 4 step 3). `AgentInput` is a raw `<textarea>` with no form (apps/erp/app/modules/agent/ui/AgentInput.tsx:39). Focus there → `active.closest("form")` is null → fallback fires the page's sole `<Submit>` on ⌘Enter. Users hitting ⌘Enter in the agent chat would submit an unrelated page form. Fix the rule: if `document.activeElement` is an editable element (input/textarea/select/contenteditable/.ProseMirror) **not inside this Submit's form → no-op**; the sole-submit fallback applies only when focus is on a non-editable element or body. Spec AC #2 must gain this case.
2. **`useShortcutKeyMap` plans two implementations** (Task 1 step 3: hotkeysEvent reconstruction *or* fallback plain listener). Don't ship a maybe. Pick the plain `document` keydown listener built on `parseShortcut` + shared guards — deterministic, testable, and the combo-matching logic stays in one file. Delete the react-hotkeys-hook attempt from the plan.
3. **`Record<combo, fn>` re-creates the legacy silent-overwrite bug structurally** (Tasks 1/7/8/9). The ⌘⇧P data bug is fixed, but a `Record` still silently drops a duplicate key at any future call site — the exact failure class we're deleting. Change the API to `useShortcutKeyMap(entries: Array<{ shortcut: ShortcutInput; action: (e) => void }>)` and make the hook `console.warn` in dev on duplicate *resolved* combos. Call sites build arrays, not records.
4. **Editable-target detection would exist in 3+ places** (`useShortcutKeyMap` listener, `useShortcutSequence`, Submit guard — and it already exists in `useKeyboardWedge` and the legacy hook). Centralization is this plan's own hard rule. Add one `isEditableTarget(target: EventTarget | null): boolean` util in `packages/react/src/utils/` (Task 1) and require every new hook/guard to use it.

## Risks / questions

5. **287 Submit buttons grow a ⌘↵ badge at once** (Task 4). Layout churn in 234 files nobody re-reviews; footers with tight `HStack`s may wrap. Mitigation: after Task 4, render-audit a few dense screens (quote line drawer, settings forms); keep `hideShortcutKey` as the escape valve. Accepted per spec (badge = discoverability), but eyes open.
6. **Topmost-dialog tie-break is load-bearing for ⌘Enter** — Drawer and Modal are both `z-50` (Drawer.tsx:23,52; Modal.tsx:35), so ConfirmDelete-over-drawer resolves by "later-mounted wins" (dialog.ts tie rule). Correct today; add a comment in Task 5 that this pairing depends on the tie-break, so a future z-index change doesn't silently flip the winner.
7. **Cross-component combo collisions still possible**: two *different* components on one page each binding the same combo (e.g. an Explorer's ⌘⇧L and a sidebar's ⌘⇧L) both fire — independent listeners, no Record to catch it. Low likelihood today (no known co-mounted pair), but the ShortcutRegistry could dev-warn on duplicate active combos for free — see improvement 10.
8. **Hidden-but-mounted Submits count in the registry** (Task 4): a mounted-but-invisible form (collapsed section) makes `count > 1` → fallback no-ops (fails safe), or a *sole* hidden Submit could be ⌘Enter-fired. Radix drawers unmount closed content so this should be rare; note it in the task and check one collapsed-card screen during verification.
9. **Multiple `StartStopForm`s on one MES screen** would all receive Space (Task 13). Verify the operation screen mounts exactly one; if a list view ever mounts several, scope the binding to the "active" one or drop it there. Escape hatch already exists for AssemblyView coexistence — extend it to same-screen multiplicity.
10. **⌥1–7 on mac is genuinely uncertain** (`event.key` = "¡" etc.). The plan's escape hatch (match `event.code`) is right — but with must-fix 2, build code-matching into the plain listener from the start instead of as a patch: `parseShortcut` output for digits can carry `code: "Digit1"` matching. Small now, ugly later.

## Suggested improvements

11. **Task 4 verify block has no behavioral test.** Add a jsdom test in `@carbon/form` for the guard truth table (focus-in-own-form fires; focus-in-other-form no-ops; focus-in-formless-editable no-ops; body+sole fires; body+two no-ops). This is the single riskiest logic in the plan and currently ships untested.
12. **Registry `description`/`group` on `useShortcutKeys` (Task 1) is speculative** — nothing in the plan passes `description` except overlay static entries, which don't go through the hook. YAGNI: ship the registry + static entries only; add per-hook registration when a real consumer needs it. Deletes an API nobody calls.
13. **Two app `ShortcutHelp.tsx` wrappers hand-build near-identical static lists** (Tasks 12–13). Acceptable duplication (data differs per app), but keep the row-building helper (`comboRow(shortcut, label)`) in the shared overlay file so the apps only declare data.
14. **`MODULE_GO_TO` letters `e`/`y`/`o`/`t`/`u`** are mnemonic-free. Fine to ship; surface the full table in the PR description for bikeshedding once, and the help overlay makes them discoverable.

## Docs freshness

15. `packages/react/AGENTS.md` — "Ask First: changing the public API of Button" is satisfied by this plan-approval flow; after execution the Key Patterns section should mention `shortcut`/`shortcutGuard`, and the hooks list loses `useKeyboardShortcuts`/`usePrettifyShortcut`. Task 14 step 4 greps rules for the deleted hook — extend the grep to `usePrettifyShortcut` and to `conventions-ui.md`'s Button props list (currently omits `shortcut`).
16. `.ai/specs/2026-09-07-keyboard-shortcuts.md` → move to `.ai/specs/implemented/` when done (per `.ai/specs` convention); plan already tracks divergences.
17. New lesson candidate after execution: "topmost-dialog tie-break + focus-aware submit guard" belongs in `.ai/lessons.md` if either bites during verification.

## Verdict

The architecture is sound and matches the centralization requirement; nothing here changes the shortcut map the user approved. Four must-fixes are all plan-text edits (guard rule, single implementation, collision-proof API, shared editable-target util) — cheap now, expensive after 234 files ship on top of them.
