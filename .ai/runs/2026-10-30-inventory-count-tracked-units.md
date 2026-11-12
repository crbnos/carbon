# Inventory count for tracked units — run log

Spec: `.ai/specs/2026-10-30-inventory-count-tracked-units.md`
Plan: `.ai/plans/2026-10-30-inventory-count-tracked-units.md`
Branch: `feat/inventory-count-tracked-units`

## Browser test (2026-10-30)

The test used the satellite demo dataset on the branch's own stack. RW-010 got
9 serial units: RW-SN-1 to RW-SN-6 and 2 with no serial number in A2-L2, and
RW-SN-7 in A1-L2. A2-L2 also held 4 RW-010 booked with no unit record (demo
data). Count IC000003, Manufacturing Plant, driven with agent-browser.
Screenshot: `2026-10-30-count-posted.png`.

| Step | Result |
|---|---|
| Create a count of the location | PASS — one row per item and storage unit |
| Search RW-010 | PASS — both RW-010 groups open |
| Scan RW-SN-1 to RW-SN-5 into A2-L2 | PASS — Found; the bin stays picked between scans (fixed in this run) |
| Scan RW-SN-7 into A2-L2 | PASS — Unexpected in A2-L2 |
| Mark RW-SN-6 and RW-SN-7 (in A1-L2) Missing | PASS |
| Count the 4 units with no unit record | PASS — saves (fixed in this run) |
| Count 1 of 2 units with no serial number, give it RW-SN-8 | PASS |
| Scan an unknown number RW-SN-NEW, pick RW-010 | PASS — Add Unit form, then Unexpected |
| Confirm, then Post | PASS after a fix: the post refused the no-unit-record stock as "a serial counted above 1" |
| Ledger after post | PASS — RW-SN-6 written off; RW-SN-7 2 Transfer rows A1-L2 → A2-L2, no write-off; RW-SN-NEW created Available; the found unnumbered unit is RW-SN-8, the other Consumed; no-unit-record stock unchanged |
| Posted sheet | PASS — RW-SN-7 reads "Moved to A2-L2" / "Moved from A1-L2" |
| Export Units | PASS — one row per unit in the import's columns |

## Fixed during the browser test

- Empty state badges (Lingui `t` passed into a helper).
- The page opened a tracked group on load (auto-focus clicked a read-only cell).
- A batch line with no number read "No serial number".
- The scan bar lost its storage unit after the first scan.
- Quantity fields never saved (react-aria commits on blur, after `onBlur`).
- Group variance counted lines not yet counted.
- The post refused a serial item's stock with no unit record.

## Not tested in the browser

Covered by database and unit tests instead: Import (`inventory-count-scan.test.ts`,
`inventory.plan-import.test.ts`), the Scrapped and other-location refusals and
batch moves (`inventory-count-post-tracked.test.ts`). Not covered: a blind count
in the browser, and an untracked item counted on its group row.

## Known limit

A bin that holds both serial units with no serial number and stock booked with
no unit record exports both as rows with an empty Serial / Batch. Importing that
file back is refused (more units with no serial number than expected). Only bad
source data produces this mix.
