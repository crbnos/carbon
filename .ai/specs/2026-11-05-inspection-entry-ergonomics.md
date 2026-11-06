# Inspection entry ergonomics

Date: 2026-11-05. Status: implemented on branch `naveen/keen-hamilton-ge0w4k`.
Verified on a running stack (`crbn up`, see Verification).
Research: `.ai/research/2026-11-05-inspection-entry-ergonomics.md`.

## Problem

1. A large batch needs too much scrolling. The grid has one column per sample.
   A lot of 200 parts with no sampling rule shows 200 columns. The ERP row
   labels scroll out of view.
2. An out-of-tolerance reading must show red as a fail. Today the ERP shows red
   text only after the server answers. The MES shows a red tint, also only after
   the server answers. Neither app shows the tolerance limits.

## Scope

| In | Out |
|---|---|
| ERP grid (`InspectionMeasurementGrid`) and MES matrix (`InspectionMeasurementMatrix`) | Any schema change |
| Instant fail colour, limits, fail counter | A new server endpoint |
| "By part" layout and a layout toggle | Import of CMM report files |
| Enter / Tab navigation in both layouts, both apps | Changes to the sampling or verdict rules |
| "Pass all" for an attribute characteristic, paste a block of values | |
| A "Hide drawing" toggle in both apps | |

No record type is new, so no sibling applies. The change is UI only. The
server verdict (`valuateMeasurement`) stays the record of truth.

## Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | The browser runs the same `valuateMeasurement` as the server. `@carbon/database` exports it as the subpath `./inspection-verdict`. | One rule, one copy. The module has no I/O, so it loads in the browser. The MES copy of `parseSpecNumber` goes. |
| D2 | A cell shows the client verdict for a draft value: while the inspector types (MES, and ERP when the text parses), and from commit until the server answers. When the server answers, its `measurementStatus` replaces the client verdict. A saved cell with no draft shows its stored status. | Instant feedback. A tolerance edit never rewrites a recorded status (existing rule). |
| D3 | A failed cell fills with red and shows ↑ (above the upper limit) or ↓ (below the lower limit). A passed reading has no fill: only a fail has colour. A selected go / no-go Pass keeps a light green tint on its button. The ERP cell fill covers the whole cell, so the Table's yellow "edited" tint does not hide it. | The fail must not rely on colour alone. When every passed cell is green too, a red cell is harder to find in a large grid. |
| D4 | The characteristic shows its limits: `9.90 – 10.10 mm`. The nominal and tolerance show in the tooltip. | The inspector compares against limits, not against a tolerance. |
| D5 | The grid has 2 layouts: **By characteristic** (one row per characteristic, today's layout) and **By part** (one row per sample, one column per characteristic). | Parts down the page removes the horizontal scroll for large batches. |
| D6 | Default layout: **By part** when the grid has more samples than characteristics, else **By characteristic**. A choice the inspector makes stays in the browser (`localStorage`, key `INSPECTION_GRID_LAYOUT_STORAGE_KEY`). | Large batches get the better layout with no click. |
| D7 | ERP: the row-header column is pinned in both layouts. The `#`, Characteristic and Spec columns merge into one Characteristic column. `n / Ac` moves into the Result badge tooltip. The Table's header sort menus, Search box, Sort picker, column reordering, pagination and CSV export are off, so the Table draws no toolbar row. | About 300 px less chrome, and the inspector always sees what they measure. The removed controls only wrote URL parameters that this grid does not read. CSV export was the last toolbar control; one row of height is worth more than an export of a screen that is not a report. |
| D8 | Enter and Tab move to the next entry cell in the row, then wrap to the first entry cell of the next row. Shift+Tab moves back. On a go / no-go cell, P records a pass and F a fail, then the selection moves on. The same rule runs in both layouts and both apps. The target cell scrolls into view. | By part, Enter moves across one part's characteristics. That is the order in which an inspector measures a part. |
| D9 | **Pass all** on an attribute characteristic records Pass in each empty cell, for samples 1 to `max(n, existing samples)`. Serial lots use only scanned samples. The "Overall result" row has it too. | Removes one click per cell for go / no-go checks. Each reading still records `inspectedBy` and `inspectedAt`. |
| D10 | Paste a block of values (tab-separated columns, one line per row, as Excel and Google Sheets copy) into an entry cell. The block fills from that cell in the direction of the layout. Numbers go to numeric cells. `P`, `Pass`, `OK`, `1` and `F`, `Fail`, `NG`, `0` go to attribute cells. A blank token skips its cell. A token that does not parse skips its cell, and the toast counts it. | Readings exported from a CMM or a spreadsheet go in with one paste. A single value pastes into the input as before. |
| D11 | Pass all and paste send the existing per-cell POSTs one at a time, in sample order. The grid stops at the first refused save. | No new endpoint and no new server rule. The order keeps anonymous samples in column order. |
| D12 | Non-serial lots: the column count follows the samples the grid knows, from the loader and from save responses. So a paste can add samples up to the lot size. | Before, the count followed the loader only, and a long paste stopped at the spare column. |
| D13 | The grid title shows a red "N failed" badge when a reading has failed. Each characteristic shows "x of n" (green when complete) and a red "N failed" badge. The badge tooltip shows the sample size, Ac and Re. | A failed reading far off screen is still visible. |
| D14 | A **Hide drawing** button gives the whole body to the grid. The choice stays in the browser. | More rows on screen for a large batch. |
| D15 | A grid position (column or row) is bound to a sample id, not to the sample's place in the loader's list. On first load samples take positions in the order they were made. After that a sample keeps its position for the page (`placeSamples`), and a sample new to the page takes the lowest free one. Cell state (values, statuses, the Table's pending edits) is keyed by sample id. `getInspection` (ERP and MES) orders the embedded samples by `createdAt`, then `id`. | The embed had no order, and an UPDATE moves a row. After a reload, position N named another sample, so a save went to the wrong sample (found on the live stack). |
| D16 | One header block per characteristic in both layouts: a number chip (filled when the balloon is active), the name on one line, the limits under it, then the progress badges. ERP By part: the gauge is a compact chip on the badges' row (dashed "Add gauge" when empty; gauge id and truncated description when set; red with ⚠ when out of calibration), not a full-width field on its own row. Header cells align to the top. | The inspector reads the same block in the same order wherever the characteristic appears. |
| D17 | Cells are 44 px high, numbers are `text-sm` and `tabular-nums`, centred. A pending cell shows a light "—". ERP: the Sample column sizes to its content (`meta.shrinkToFit` on the shared Table, off by default) and the characteristic columns share the rest of the width. | Digits line up down a column. The width goes to the cells the inspector types in. |
| D18 | A closed lot shows no spare row and no empty gauge picker. A go / no-go result shows as text ("✓ Pass", "✗ Fail" in red, or "—"), not as disabled buttons. | Read-only controls that look clickable make the inspector try them. |
| D19 | MES: the layout toggle shows its text labels at every width; the toolbar wraps on a phone. | Two bare icons do not say what they switch. |

## Shared code

| File | Holds |
|---|---|
| `packages/database/src/inspection-verdict.ts` | `valuateMeasurement`, `parseSpecNumber` (existing), and new `toleranceLimits`, `measurementDeviation` |
| `packages/utils/src/inspection-entry.ts` | `InspectionGridLayout`, `defaultInspectionGridLayout`, `INSPECTION_GRID_LAYOUT_STORAGE_KEY`, `INSPECTION_DRAWING_HIDDEN_STORAGE_KEY`, `parseClipboardGrid`, `parseMeasurementToken`, `parseAttributeToken`, `planPaste`, `formatToleranceLimits` |

Both files are pure and have unit tests.

## Number tokens (D10)

1. Remove spaces.
2. If the token has a dot and a comma, remove the commas (`1,234.5` → `1234.5`).
3. If the token has one comma and no dot, read the comma as the decimal mark
   (`10,05` → `10.05`, `0,125` → `0.125`).
4. If that comma could also group thousands (`1,234`, `12,500`), skip the
   cell. A skipped cell is better than a reading saved 1000 times too small.
5. A leading `+` is allowed. Anything else that is not a number skips the cell.

## Acceptance criteria

- [x] A value outside `[nominal − |tol−|, nominal + |tol+|]` shows red with ↑ or ↓ at commit, before the server answers (ERP and MES).
- [x] The MES input shows red while the inspector types. The ERP input shows red while the inspector types when the text parses.
- [x] The characteristic shows its lower and upper limits.
- [x] The layout toggle switches the grid. The default follows D6. The choice survives a reload.
- [x] In both layouts the row header stays visible while the grid scrolls sideways.
- [x] Enter moves to the next entry cell and wraps to the next row, in both apps.
- [x] Pass all fills only empty cells of one attribute characteristic.
- [x] A pasted block fills cells from the focused cell and reports skipped tokens.
- [x] The grid title counts failed readings.
- [x] Hide drawing gives the grid the whole body. The choice survives a reload.
- [x] No server file changes. The unit tests for the shared helpers pass.

## Risks

| Risk | Handling |
|---|---|
| A client verdict differs from the server verdict | Both call the same function. The server answer replaces the client one. |
| A long paste is slow (one POST per cell) | The toast shows progress. The rows stay usable. A batch endpoint can come later if needed. |
| Locale decimal commas while typing in the ERP | The ERP `NumberField` formats on commit. While typing, a token that does not parse shows no colour. At commit the colour shows. |

## Verification

| Check | Result |
|---|---|
| `pnpm --filter @carbon/utils exec vitest run src/inspection-entry.test.ts` | 33 tests pass |
| `pnpm --filter @carbon/database exec vitest run src/inspection-verdict.test.ts` | 11 tests pass |
| `tsc --noEmit` in `apps/erp`, `apps/mes`, `packages/utils`, `packages/database` | No new errors. The only errors are files that a build generates (route types, MCP metadata, fonts). |
| Biome on the changed files | Clean |
| `@carbon/checks` vitest (conformance scans) | 425 tests pass |
| Lingui catalogs | 19 new strings, filled in all 12 locales, 0 missing |

A temporary Vite harness rendered the real ERP grid and the real MES matrix with
a stubbed save route (deleted after the run). Playwright confirmed, in both apps:

1. A typed value outside the limits turns red before Enter. After Enter it shows ↑ or ↓.
2. By part, Enter moves to the next characteristic of the same sample.
3. The second save of a new sample sends the sample id the first save returned.
4. A pasted 3 × 3 block makes 7 saves. It skips `abc` and a blank cell, and reads `25,41`.
5. Pass all records a pass in each empty cell only. It leaves an existing Fail.
6. The layout choice survives a reload. The pinned column stays in place during a horizontal scroll.

### Second round: agent-browser on the full ERP screen

A second harness rendered the whole ERP `InspectionView` (header, drawing pane,
grid) and the MES matrix, with five lots: a large lot, a serial lot, a lot with
no document, a closed lot and a lot with 12 characteristics. agent-browser drove
each one. The round found and fixed 7 issues:

| # | Issue | Fix |
|---|---|---|
| 1 | The pinned Sample column took a quarter of the width (340 px) | Column sizes: 96 px for the sample, 220 px per characteristic; 64 px on MES phones |
| 2 | A go / no-go cell could not be filled from the keyboard | P / F keys (D8) |
| 3 | P / F did nothing after a mouse click on the cell's button | The keys work from any element of the cell except an input |
| 4 | The no-document header showed "1" | It shows "Overall result" |
| 5 | `1,234` pasted as 1.234 | Ambiguous tokens skip the cell (rule 4 above) |
| 6 | The grid drew "By characteristic" for one frame, then switched | The first render computes the default |
| 7 | The toggle's `aria-label` hid its visible text from screen readers | The visible text is the name; `title` keeps the hint |

The round also confirmed: a refused save puts the cell back and shows the
server's message; a corrected reading turns green and the failed count drops; a
cleared cell sends an empty value for the same sample; Hide drawing persists
over a reload; the closed lot shows the stored fail in red and refuses entry;
the MES matrix fits a 390 px phone with no sideways page scroll.

### Third round: the running stack

`crbn up` ran the full stack (Postgres, GoTrue, Storage, Realtime, ERP, MES) in
this container. agent-browser logged in as the seeded test user and drove the
real inspection screens against the real routes and database. The round found
2 bugs that the harness could not show:

| # | Bug | Cause | Fix |
|---|---|---|---|
| 1 | A reading went to another sample, and an empty row opened with another sample's value | Each save broadcasts `inspectionSample`, so the page reloads. The loader's sample list has no order, and an UPDATE moves a row, so position N named another sample after the reload. The position map predates this work, but By part and realtime make it happen at once | D15 |
| 2 | MES: typing into a filled cell appended to the old value, and the result was dropped as not a number | Focus did not select the input's text | The input selects its text on focus, as a spreadsheet does |

Checked on the stack after the fixes:

1. INS000003 (2 characteristics): 4 readings by keyboard (Enter across each part) land on 2 samples, 2 readings each, with the right verdicts. A reload shows the same cells, and an empty row opens blank.
2. A 200-part lot with 20 samples per characteristic: a pasted 20 × 2 block saves 39 readings in about 5 s. Each sample holds the pair from its own pasted row, 4 fail, 1 bad token is skipped, and the toast says so.
3. An edit of part 1 followed by a reload leaves part 1 in row 1.
4. MES job-operation lot INS000004: 3.40 V turns red live (the limit is 3.350 V). Enter moves across the row, a filled cell takes a new value, and By part shows the real data.

Not covered on the stack: go / no-go characteristics (the seed data has none;
the harness rounds covered them) and the Hide drawing toggle on a lot with a PDF.

To run the stack in a cloud container like this one: start `dockerd`, use Node
24, run `pnpm rebuild supabase` after an install with `--ignore-scripts`,
generate `packages/documents/src/pdf/fonts.data.ts` and the MCP metadata, start
the dev servers with `NODE_USE_ENV_PROXY=1` (the Turnstile siteverify call goes
through the proxy), allow `challenges.cloudflare.com`, and pass `--no-portless
--no-regen` to `crbn up` (type generation pulls an image from a blocked host).
