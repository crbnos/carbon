# Research: MES step-advance keyboard shortcuts

Date: 2026-09-04. Grounded against the codebase by an Explore agent; paths/line numbers verified at research time.

## 1. Shared Kbd / shortcut-hint components — already exist

| Component | Path | Notes |
|---|---|---|
| `Kbd` | `packages/react/src/Kbd.tsx:5-21` | Plain styled `<kbd>` (`bg-muted`, `border-b-[3px]`, mono bold). Exported from `@carbon/react` barrel (`index.tsx:176/:483`). |
| `ShortcutKey` | `packages/react/src/ShortcutKey.tsx:24-50` | Richer: `ShortcutDefinition`, mac/windows glyphs via `useOperatingSystem()`. Exported (`index.tsx:284/:570`). No app call sites. |
| `usePrettifyShortcut` | `packages/react/src/hooks/usePrettifyShortcut.ts` | Wraps `prettifyKeyboardShortcut` (`packages/utils/src/keyboard.ts:1`). |
| `CommandShortcut` | `packages/react/src/Command.tsx:249-263` | cmdk slot; unused by the ERP command palette. |

**Canonical hint pattern: `Tooltip` + `Kbd`** — cleanest reference is `apps/erp/app/components/New.tsx` (53 lines): `useKeyboardShortcuts({ n })` ref-clicks the button; tooltip shows `<Kbd>N</Kbd>`. Also `Pagination.tsx:95,113-141` (prettifyShortcut in tooltip) and ~10 explorer files with inline `<Kbd>{prettifyShortcut("Command+Shift+l")}</Kbd>`.

MES (`apps/mes/app/components`) has **zero** Kbd/shortcut usage today.

## 2. Keyboard-handling patterns

- `useKeyboardShortcuts` (`packages/react/src/hooks/useKeyboardShortcuts.ts`) — **the de-facto standard**, ~15 ERP call sites. Flat `{ key: handler }` map; combined keys fire on keydown, single keys on keyup; window listeners; built-in focus guard (`:14-21`) ignoring INPUT/TEXTAREA/SELECT/ProseMirror.
- `useShortcutKeys` (`useShortcutKeys.ts`) — react-hotkeys-hook wrapper, mac/win aware, `enableOnFormTags` opts; **no app call sites**. `react-hotkeys-hook@4.5.1` is in the pnpm catalog and declared by apps/mes but never imported there.
- Only `Gantt.tsx:32,1327` uses `useHotkeys` directly.

## 3. AssemblyView (`apps/mes/app/components/AssemblyView.tsx`, 3418 lines)

- Step cursor is the `?step=` search param: `currentStep` `:774-780`, `goToStep(n)` `:1118-1127`, `isLastStep` `:1011`. Unit axis separate (`activeIndex` `:872`).
- Action bar `:2239-2273`: Record → `StepCompleteAction` (`:2910-3060`); Skip → inline `goToStep(currentStep + 1)` button `:2262-2271` (no named handler).
- `StepCompleteAction`: `markTaskDone()` `:2948-2954` (fetcher POST to `path.to.record`); `handleUndo()` `:2939`. Branches: done → undo pill; `type === "Task"` → "Mark done" button (only one-keystroke path); all other types → "Record" button opening `RecordModal`.
- Record disable = `hasPendingScans` (`:991`, from `pendingScanMaterials` `:988-990`) — a **soft gate; Skip deliberately bypasses it** (comment `:983-987`); warning renders `:2243-2250`.
- Step types (`procedureStepType`, `packages/database/src/types.ts:80473-80482`): `Value | Measurement | Checkbox | Timestamp | Person | List | File | Task | Inspection`. Null defaults to `"Task"` (`:2936`).
- **Auto-advance already exists** `:1140-1175`: when current step flips done, `goToStep(currentStep + 1)` and labor clock kicks.
- No keydown listener; **zero Lingui usage** — every string is a hardcoded English literal (pre-existing i18n debt).
- Gotcha: `markTaskDone` lives in child `StepCompleteAction`; `goToStep`/`hasPendingScans` live in parent → shortcut needs ref-click (New.tsx approach) or a lifted handler.

## 4. JobOperation standard view

- `Step.tsx` (`JobOperation/components/Step.tsx:94-270`): per-row flow — Task with no record → inline fetcher.Form "Complete" submit; other types → `onRecord(step)` opens `RecordModal` (in `JobOperation.tsx:2674-2690`, state `:448-459`).
- **No step cursor** — flat list; a step-advance shortcut has nothing to advance.
- `Controls.tsx` `StartStopButton:216-316` is a `ValidatedForm` submit (not onClick) — shortcut would need ref-click/form submit; existing `ButtonWithTooltip` is a natural Kbd hint host.

## 5. Focus guards & lessons

- `useKeyboardShortcuts.ts:14-21` is the repo's only generic guard (INPUT/TEXTAREA/SELECT + `.ProseMirror`; not generic contenteditable).
- `.ai/lessons.md:373-377` — react-aria NumberField swallows Enter/arrows; use `onKeyDownCapture`.
- `.ai/lessons.md:812-814` — bind nav keys at `document` in capture phase inside the owning component; `preventDefault`+`stopPropagation` only for claimed keys; never claim `Escape`.

## 6. Specs

- `.ai/specs/implemented/2026-07-14-mes-execution-views.md:399` lists "hands-free advance" as acknowledged future work. No spec defines a step-advancement contract; nothing gets violated.

## 7. i18n

MES fully wired for Lingui (`apps/mes/app/root.tsx:9,43,262-270`; catalog `packages/locale/locales/{locale}/mes`). New visible strings must use `useLingui()` `t` / `<Trans>`; run `pnpm lingui:extract` after.

## Practical summary

Reuse `Kbd` (+ optional Tooltip) and `useKeyboardShortcuts`; AssemblyView is the natural home (real cursor, `goToStep`, `markTaskDone`, auto-advance, soft scan gate). Only `Task` steps can complete in one keystroke — the other 8 types open `RecordModal`. The standard operation view has no cursor, so step-advance doesn't map there.
