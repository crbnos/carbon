# Inspection entry ergonomics: less scrolling, instant out-of-tolerance red

Date: 2026-11-05. Status: research (no code changed).

## The requests

1. Simplify the inspection screen (where the inspector records results) so a
   large batch of parts needs less scrolling.
2. When a feature on the inspection plan has a reading with a tolerance, a value
   outside the tolerance must show red as a fail.

## Screens in scope

| App | Route | Grid component |
|---|---|---|
| ERP (receipt lots, read-only view of job-op lots) | `apps/erp/app/routes/x+/inspection+/$id.tsx` → `InspectionView` | `apps/erp/app/modules/quality/ui/Inspections/InspectionMeasurementGrid.tsx` (shared `Table` + `EditableNumber`) |
| MES (job-operation lots) | `apps/mes/app/routes/x+/inspection.$operationId.tsx` → `InspectionView` | `apps/mes/app/components/Inspection/InspectionMeasurementMatrix.tsx` (hand-written `<table>`) |

The verdict rule is `valuateMeasurement` in
`packages/database/src/inspection-verdict.ts`: a value passes when it is inside
`[nominal − |tol−|, nominal + |tol+|]`. It has no I/O, but the package does not
export it as a subpath (`packages/database/package.json` exports `./quality`,
which pulls in Kysely). MES keeps its own copy of `parseSpecNumber`.

## Findings

### Request 2: the red highlight exists, but it is late and weak

The original spec (`.ai/specs/implemented/2026-07-21-inbound-inspection-execution.md`,
"values color the cell red at entry") asked for this. What ships today:

| | ERP grid | MES matrix |
|---|---|---|
| When red appears | Only after the server answers the save (`statusByCell` is set from the `$id.measurement` response) | Same: after the save response |
| What red looks like | Red **text** only (`font-semibold text-red-500` on the display span). No cell background | Red-tinted cell background (`bg-red-500/10 text-red-600`) |
| While typing | Nothing. `EditableNumber` has no status styling | Nothing. The draft `<input>` keeps the last saved status |
| If the save fails or is slow | No colour; the inspector may move on without noticing | Same |
| Limits shown | Spec column shows `10 +0.1/−0.1 mm`. The inspector has to work out 9.9–10.1 | Same |

So the request is fair: on the ERP, the "fail" is a thin red font that arrives
after a round trip. It is easy to miss, mainly in a wide grid.

### Request 1: why a large batch scrolls so much

The grid is **features × samples**: one row per characteristic, one column per
sample.

1. **The column count grows with the batch.** With no sampling rule on the plan
   the plan resolves to **All**, so `sampleSize = lotSize`
   (`packages/database/src/sampling.ts`). A 200-part receipt shows 200 sample
   columns. Even with AQL, ANSI Z1.4 level II gives n = 125 for lots of
   1,201–3,200 (code K). Each column is at least 48 px (ERP) or 96 px (MES):
   125 columns is 6,000–12,000 px wide.
2. **All columns are created at once.** Non-serial lots get
   `min(lotSize, max(maxSampleSize, samples + 1))` columns up front.
3. **The ERP row header scrolls away.** The fixed columns (`#`, Characteristic
   180–320 px, Spec, Gauge, n/Ac, Result) take about 600 px and are not pinned.
   The shared `Table` supports `defaultColumnPinning`, but the grid does not use
   it. Once you scroll right to sample 40 you cannot see which feature or which
   limits you are entering against. (MES does pin its first column.)
4. **The drawing takes about half the height.** With a PDF or a model, the grid
   gets the lower half and only a few feature rows show.
5. **Keyboard flow is across, not down.** In the ERP, Enter/Tab moves to the next
   sample in the same row. Inspectors usually measure one part fully, then the
   next part. That is down a column in this layout, so each part means scrolling
   back left. In MES, Enter only blurs; it does not move to the next cell.
6. **No bulk actions.** Every attribute cell needs its own Pass click, and you
   cannot paste readings from a CMM export or a spreadsheet.

How other tools handle it (from general knowledge of the category, not
verified against current product versions): SPC/CMM data-entry tools (e.g.
InfinityQS, 1factory, Net-Inspect) and FAI forms (AS9102 form 3) usually put
**parts down the page** and **characteristics across**. A frozen header row
holds each characteristic and its USL/LSL. Many also offer a one-part-at-a-time
"checklist" entry mode for touch screens.

## Options

### A. Instant, strong fail colour (request 2) — small, both apps

- Export the pure verdict module: add `"./inspection-verdict"` to
  `packages/database/package.json` exports, and import `valuateMeasurement` /
  `parseSpecNumber` in both grids (this also removes the MES copy).
- Carry the feature spec (`type`, `nominalValue`, `tolerancePlus`,
  `toleranceMinus`) on each grid row (the rows are already built from
  `inspectionFeature`).
- Work out the status on the client from the value. Use that status for the colour:
  - while typing (an `onChange` in `EditableNumber` through an optional
    `inputClassName(row, draft)` callback, and on the MES draft `<input>`);
  - right after commit, before the server answers.
  The server's `measurementStatus` is still the record. When it answers, it
  replaces the client value (normally the same, because both use the same
  function).
- Use one cell style in both apps: red background and red text. Add a
  "↑" or "↓" mark for above or below the limit, so the fail does not rely
  on colour alone (accessibility). Green tint for pass is optional; keep it
  subtle.
- Show the limits, not only the tolerance: the Spec cell reads
  `9.90 – 10.10 mm` (nominal on hover), or show both.
- Edge cases: a feature with no tolerance passes only on the exact nominal value
  (same as today's engine). An attribute or a GD&T string that does not parse
  stays a Pass/Fail toggle. Values recorded before a tolerance edit keep their
  stored status (`inspectionMeasurement.status` is the valuation at entry).
  So a saved cell shows its stored status. Only the draft value uses the client
  verdict. Do not change that rule.

Effort: about 1 day. No schema change. Low risk, because the server verdict is
unchanged.

### B. "Parts down" layout (request 1) — main fix for big batches

Add a layout toggle to the grid header: **By characteristic** (today) and
**By part**. "By part" is the transposed grid: one row per sample (one part),
one column per characteristic.

- Frozen top header per characteristic: label, short description, limits,
  gauge picker, and the `passed/n · F` progress badge (n/Ac and Result move
  here from the row).
- Frozen first column: sample number or serial `readableId`, plus the sample's
  derived status.
- Rows are virtualised (the shared `Table` already has `useVirtualRows`), so
  200 or 500 parts scroll smoothly.
- Enter moves **right** across the part's characteristics, then wraps to the
  next part's first one. That matches how a part is measured.
- Default: **By part** when `columnCount > rows` (more samples than features),
  otherwise **By characteristic**. Remember the user's choice per browser
  (`localStorage`, wrapped in try/catch).
- Show the samples that exist and the next empty row, with a "Show next 10"
  control. Do not create up to `lotSize` empty rows.
- The balloon ↔ feature link still works: clicking a balloon highlights the
  column and scrolls it into view.

Effort: about 3–5 days for ERP (the grid's column/row builders and the
keyboard handler are the main work), similar for MES. Can share the row/column
model if it moves into a package (the two files are near-copies today).

### C. Cheap wins in the current layout — can ship before B

- ERP: pin `label`, `description` and `specLabel` on the left
  (`defaultColumnPinning={{ left: [...] }}`). Merge them into one compact
  row-header cell: label chip, description on one line, limits under it.
  Move n/Ac into the Result badge tooltip. That saves about 300 px.
- Show only the next empty sample columns: completed columns collapse to a
  thin "1–40 ✓" group that expands on click.
- If the grid has more than 12 sample columns, collapse the drawing pane by
  default. On wide screens, put the drawing beside the grid instead.
- MES: make Enter move to the next cell (it only blurs today).

Effort: about 1–2 days.

### D. Bulk entry — later

- "Pass all remaining" per attribute characteristic (fills empty cells in the
  row/column). Needs a batch endpoint or a loop of the existing per-cell POSTs;
  a batch call is better (one transaction, one lot-status recompute).
- Paste a block of numbers (tab/newline separated, from Excel or a CMM CSV)
  starting at the focused cell.
- Import a CMM report file mapped by characteristic label.

Effort: 3+ days; needs a new service function in `quality.server.ts` and the
shared engine in `@carbon/database/quality`.

### E. One-part-at-a-time mode (touch / MES)

A card view shows one part. Its characteristics form a vertical checklist with
big inputs and live red/green. Then the inspector taps **Next part**. No horizontal scroll at all.
Fits the MES better than a wide table. Could be the MES default and an ERP
option. Effort about 2–3 days. Overlaps with B; build B first, then decide.

## Recommendation

1. **Now:** A (instant red, limits shown) + C (pinning, compact header, MES
   Enter). Small, low risk, both apps, fixes the visible complaints.
2. **Next:** B (By-part layout with auto default and virtualised rows). This is
   what actually removes the scrolling for large batches.
3. **Later:** D (pass-all, paste, CMM import), then consider E for MES.

## Open questions for the product owner

- Should "By part" be the default for every lot, or only when there are more
  samples than features?
- Should a fail also show a toast or a counter ("3 out of tolerance") in the
  header, or is the cell colour enough?
- Is a "Pass all" button acceptable for attribute features, given the audit
  trail (each measurement stores `inspectedBy` / `inspectedAt`)?
- Do customers import CMM data today? If so, which formats (PC-DMIS, Calypso
  CSV)?

## Files a change would touch

- `apps/erp/app/modules/quality/ui/Inspections/InspectionMeasurementGrid.tsx`
- `apps/erp/app/modules/quality/ui/Inspections/InspectionView.tsx` (drawing default)
- `apps/erp/app/components/Editable/EditableNumber.tsx` (optional dynamic input class)
- `apps/mes/app/components/Inspection/InspectionMeasurementMatrix.tsx`
- `apps/mes/app/components/Inspection/InspectionView.tsx`
- `packages/database/package.json` (export `./inspection-verdict`)
- `.claude/rules/inspection-system.md` (document the new layout and client verdict)
