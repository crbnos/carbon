---
paths: []
triggers: []
promoted: null
---
# An inline editor built in a memo with changing dependencies drops keystrokes

**Context:** The inspection grid (`InspectionMeasurementGrid.tsx`) moves to the next
cell on Enter. Typing "0.139" straight after Enter saved "39".

**Problem:** `editableComponents` was a `useMemo` that called `EditableNumber(...)`
per column, with the grid's cell status among its dependencies. The previous cell's
save landed while the inspector typed: its status changed, the memo made new editor
component types, and React remounted the open input. The new input started from the
saved value, so the characters typed before the remount were lost. A slow, step-by-step
test passed because the save had landed before the first key.

A browser stress run found two more remounts of the same kind. The By part rows were
keyed by sample id, so the first save of a part (which creates the sample) re-keyed the
row; and the editors were rebuilt whenever a spare sample column was added. A first fix
also passed Lingui's `t` through the ref and crashed: `t` is a macro bound to
`useLingui()`, not a function value. Typecheck passed; only the browser showed it.

**Rule:** The components in a Table's `editableComponents` keep one identity while a
cell is open: make each column's editor once (cache it by column key) and read changing
state (statuses, callbacks) through a ref. Translate strings before they go into the
ref; never pass `t` itself. A row's `getRowId` never changes while the row is on
screen — key a row by something that exists before its first save. To test an inline
editor, hold the save (wrap `fetch` with a delay), type half a value, let the save land,
then type the rest.

**Applies to:** every `<Table editableComponents>` whose editors are made inside
`useMemo`/`useCallback` (`EditableNumber`, `EditableText`, `EditableList`, …).
