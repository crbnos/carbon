# Pick / Unpick a Picking List Line

Last tested: 2026-06-14
Route: `/x/picking-list/<pickingListId>/details`

## Prerequisites
- A picking list with at least one **non-tracked** (Inventory) line that has a
  `toStorageUnitId` (lineside destination) set — generated from the schedule.
- The local Supabase **functions server** must be serving the latest
  `post-picking` function (it hot-reloads, but allow ~5–10s after edits).

## Steps

### 1. Navigate
- URL: `/x/picking-list/<id>/details`
- Expected: stock-transfer-style header (id + status badge + Unassigned
  assignee + Start Picking/Complete/Cancel) and a "Picking Lines" card with a
  location badge.

### 2. Pick
- Each line shows `source → destination` (e.g. `13-A-5 → A2`), a `picked/total`
  badge, and a **Pick** button (tracked items show a disabled **Scan**).
- Click **Pick** on a line.

### 3. Verify Pick
- Button flips to **Unpick**; badge turns green `N / N`.
- Header auto-advances (In Progress → Completed when all lines resolved) via the
  `update_picking_list_status` trigger.
- DB: `pickingListLine.quantityPicked` = quantityToPick; `jobMaterial.storageUnitId`
  = the lineside dest; two `itemLedger` rows `entryType='Transfer'` (−qty @source,
  +qty @dest).

### 4. Unpick
- Click **Unpick** → button back to **Pick**, badge red `0 / N`, header reverts to
  In Progress, `jobMaterial.storageUnitId` restored to the warehouse source, and
  the Transfer ledger entries net to 0.

## Selector Notes
- Pick/Unpick are per-line buttons on the right of each line row.
- The button is quantity-driven: `isPicked = quantityPicked >= quantityToPick`.

## Common Failures
- **"Button does nothing" / badge stays 0/N** — historically a NUMERIC string-concat
  bug in `post-picking` (`"0.0000" + 4` → rounds to 0). Fixed via `Number(...)`.
  If it recurs, the functions server is serving stale code — wait for reload.
- **"No lineside destination is set for this line"** — the line's `toStorageUnitId`
  is null (work center had no lineside and auto-create didn't run); regenerate.
- Tracked (Serial/Batch) lines: Pick is disabled (Scan flow not yet built).
