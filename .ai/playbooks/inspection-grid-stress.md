# Inspection grid stress (ERP + MES)

Last tested: 2026-11-05
Route: /x/inspection/{inspectionId} (ERP), /x/inspection/{jobOperationId} (MES)

## Prerequisites
- A local stack (`crbn up --all`) and a session from `/auth`.
- Lots seeded straight into the worktree's database (no receipt or job flow needed):
  - an `inspectionDocument` (partId = any Part) with `inspectionFeature` rows —
    numeric (`type` Measurement, numeric `nominalValue`, tol±) mixed with go / no-go
    (`type` Checkbox, or a Measurement whose nominal is not a number);
  - an `inspection` (`sourceDocument` 'Receipt', any `sourceDocumentId`,
    `samplingPlanType` 'All', `inspectionDocumentId` set) and one
    `inspectionSamplingPlan` row per feature.
  - Wide lot (12 characteristics × 20 samples) opens By part; tall lot
    (40 × 5) opens By characteristic. The layout choice is remembered per browser
    (localStorage), so set it explicitly before each run.
- MES: set an existing `jobOperation` to `operationType = 'Inspection'` with
  `inspectionDocumentId`; the MES makes the lot on first open.

## Steps
### 1. Hold every save
`agent-browser eval` a `fetch` wrapper that delays POSTs to `/measurement` and `/sample`
by `window.__saveDelay` ms (1500 for the remount checks) and records
`{ body, status }` in `window.__saves`.

### 2. Type across a landing save (the remount check)
Click an entry cell (`[data-row=r][data-column=c]`), type a value, Enter, type HALF of the
next value, wait past the delay, check `document.activeElement.value` still holds the
half, type the rest, Enter. Do it on a part with no sample yet (By part) and right when
a spare sample column appears (By characteristic, after the 5th sample of a 5-sample lot).

### 3. Long chains
`keyboard type` + `press Enter` (and `press p` / `press f` on go / no-go cells) for
36–80 cells. Wait until no save has `status == null`. Check in SQL: every saved
value is one that was typed, no duplicate (sample, feature) readings, no extra samples.

### 4. Other attacks
- Paste: dispatch a `ClipboardEvent('paste')` with a tab-separated block (include a bad
  token) on the focused cell.
- Layout switch while saves are queued, then type in the new layout at once.
- A refused first save of a new part (wrapper answers 500 for one value): the cell turns
  red and reverts, a toast shows, later saves create the part once.
- Digits + Enter on a go / no-go cell: toast "This is a pass / fail check. Press P or F.",
  nothing recorded, selection stays.
- Reject Lot is disabled while a save is held.

## Selector Notes
- ERP entry cells carry `[data-entry-cell]` (`[data-attribute]` on go / no-go) with
  `data-feature-id` / `data-sample-index`; the td carries `data-row` / `data-column`.
- MES: the matrix has plain `tbody tr` rows; numeric cells are `input`, go / no-go cells
  are Pass / Fail buttons.

## Common Failures
- `agent-browser keyboard type` refocuses the element it last typed into. After Enter
  moved focus to an MES Pass button it typed into the previous input. Use `press` per
  key to test what a keyboard does there.
- Readings table: `inspectionMeasurement.inspectionSampleId` (not `sampleId`).
