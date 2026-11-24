---
paths: ["apps/erp/app/components/Table/Table.tsx", "apps/erp/app/components/Grid/Grid.tsx", "apps/erp/app/components/Editable/**"]
triggers: ["useMovingCellRef", "onKeyDownCapture", "setSelectedCell"]
promoted: null
---
# Inline-editable table cells commit on blur — the container must own navigation keys in the capture phase

**Context:** Inventory count table (PR #1135 follow-up): typed Counted Qty values were lost on Tab/Enter (only click-away saved), Enter never navigated, arrows stepped the number instead of moving the selection, and keyboard nav went dead after a commit.

**Problem:** Editable cells (`~/components/Editable/*`) persist via the input's native `onBlur`, but three things prevent that blur from ever firing on keyboard navigation: (1) the Table's key handler `preventDefault()`s Tab/Enter, so the browser never moves focus; (2) React unmounts the still-focused input when the selection moves, and browsers fire no blur on a removed element; (3) react-aria's NumberField swallows Enter entirely (`onKeyDownEnter` commits internally without `continuePropagation()`) and consumes ArrowUp/Down as spinbutton steps, so a bubble-phase table handler never sees those keys. Blurring at the input level without navigating drops `document.activeElement` to `body`, after which the table wrapper hears no further keys.

**Rule:** The table container owns the Excel keyboard model: attach the handler with `onKeyDownCapture` (so it beats react-aria to Enter/arrows), `stopPropagation()` for handled keys while editing, blur `document.activeElement` to commit *before* `setSelectedCell`, and let the roving-tabindex cell ref (`useMovingCellRef`) refocus the newly selected cell. Skip events targeting portaled overlays (`[data-radix-popper-content-wrapper]`, `[role=menu|listbox|dialog]`) — those own their keys. Editors must keep blur as their *single* commit path (no keydown commits — they double-fire the mutation, as `EditableText` did in Grid).

**Applies to:** `apps/erp/app/components/Table/Table.tsx`, `apps/erp/app/components/Grid/Grid.tsx`, `apps/erp/app/components/Editable/*`, any future inline-editable cell editor.
