# Publish a Training

Last tested: 2026-08-25
Route: /x/training/{trainingId}

## Prerequisites
- At least one training exists (e.g. train_… id). Status starts as "Draft".

## Steps
### 1. Navigate — /x/training/{id}. Header shows the name + a status badge (DRAFT/ACTIVE/ARCHIVED).
### 2. Open the Properties panel — if hidden, click the "Toggle Properties" icon button (LuPanelRight) in the header. The panel is on the right.
### 3. Change Status — the FIRST combobox in the Properties panel is "Status". Click it, then pick "ACTIVE" to publish (or "ARCHIVED" to retire). No Save needed — the change commits immediately via a fetcher to `path.to.bulkUpdateTraining` (routes/x+/training+/update.tsx, field=status).
### 4. Verify — the header badge updates to ACTIVE (e.g. "CNC Training ACTIVE").

## Selector Notes
- "Publish" is NOT a button. Publishing = setting Status from Draft → Active in the right-hand Properties panel.
- The Properties panel has three unlabeled comboboxes in order: Status, Type (Mandatory/Optional), Frequency. Confirm by opening — Status options are DRAFT/ACTIVE/ARCHIVED.
- Status write requires `update: "people"` permission (update.tsx uses the people module gate), NOT resources.

## Common Failures
- Panel collapsed → no visible status control. Toggle Properties in the header.
