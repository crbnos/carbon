# Date Range Filter (table `dateRange` + batch builder Custom due)

Last tested: 2026-10-06
Routes: `/x/production/jobs`, `/x/sales/orders`, `/x/invoicing/sales`,
`/x/inventory/stock-movements`, `/x/production/batches/new`

## Prerequisites
- A seeded company (dev seed / demo dataset) with jobs that have due dates,
  sales orders, sales invoices with `dateDue`, and item ledger rows.
- Batch builder: a `process` with `batchable = true` and unbatched, unstarted
  operations on it at one location (demo data: Manufacturing Plant / PCB Assembly).
- A "Forgot to Clock Out?" modal may cover the app after login. Click
  **"I'm Still Working"** (sessionStorage-only, writes nothing). Escape does not close it.

## Steps

### 1. Table filter via UI (Jobs)
- `/x/production/jobs` → click **Filter** → option **Due Date** → a popover
  with **From** / **To** date fields (DD/MM/YYYY segments in an en-GB locale).
- Click the `spinbutton "day, From"` segment and type the digits (`01102026`).
  The URL updates after ~400 ms to `?filter=dueDate:between:2026-10-01,`.
- Then the `spinbutton "day, To"` segment → `15102026` → URL
  `…between:2026-10-01,2026-10-15`.

### 2. Verify
- Compare the rows with the DB:
  `select "jobId" from job where "dueDate" between '…' and '…'`.
- Chip reads `Due Date · is between · 1 Oct 2026 – 15 Oct 2026`; open-ended
  ranges read `is on or after` / `is on or before`.
- A From after To leaves the URL unchanged and flags both fields.
- Chip **Remove filter** clears it.
- Faster for other lists: load the URL directly
  (`?filter=<col>:between:<from>,<to>`, either side empty) and read the
  pagination total (the text after `100 rows` → "1", "N").

### 3. Batch builder Custom due
- `/x/production/batches/new` → process combobox → **PCB Assembly**.
- Due toggle: `radio "All" / "7d" / "14d" / "30d"`, plus an unnamed radio = Custom.
- Custom shows inline From / To fields, and the From calendar opens on its own.
  Days with candidates due show a dot (navigate months with the `Previous` button).
- Type in the segments as above. The list filters client-side immediately.

## Selector Notes
- Date segments: `spinbutton "day, From"`, `"month, From"`, `"year, From"` (same for To).
- Clearing a field: click each segment and press Backspace until it reads 0.
- Count job rows: `[...document.querySelectorAll('tbody tr')]`, then take the
  `J0…` text. Lists have one extra non-data `tbody tr`, so use the pagination
  total for counts.
- Candidates API (for expected values):
  `/api/production/batchable-operations?location=<id>&process=<id>`. Effective due =
  `dueDate ?? jobDueDate`. Operations already in a batch render as a `BAT…` row,
  not as candidates.

## Common Failures
- **Escape in the batch builder closes the whole New Batch modal**, not just the
  calendar popover.
- **Typing a two-digit day passes through a one-digit intermediate** ("2" then
  "20"). Fixed 2026-10-06: `DateRangeFields` emits `null` for an invalid range,
  so the debounce restarts and the intermediate value is never applied.
- Stock movements and other lists show one more `tbody tr` than there are rows.
  Use the pagination total.
