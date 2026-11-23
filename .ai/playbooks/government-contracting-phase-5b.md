# Government Contracting Phase 5b (indirect rates, burden, burden billing, ICE)

Last tested: 2026-10-12
Routes: /x/accounting/indirect-pools[/:poolId], /x/accounting/indirect-rates
(+ `/rates`, `/statement`, `/ice` drawers, `?fiscalYear=2026`),
/x/accounting/periods/:periodId/close, /x/journal-entry/:id/details,
/x/contract/:id/:lineId/billing (Rate Ceilings), `/api/indirect-rates/ice.csv?fiscalYear=&schedule=`

## Prerequisites
- Satellite dataset (seeds Fringe / Overhead / G&A pools, Provisional + Target rates
  32 % / 85 % / 12 % from period 1). CARBON_EDITION=enterprise grants
  GOVERNMENT_CONTRACTING; the Community-plan overlay cannot be checked without a
  Community/Cloud company.
- Direct-project labor posted in the months you will lock (see the 5a playbook:
  My Time → late entry → Submit week → posts with approvals off).
- An Active contract with Cost Plus lines (5a playbook) for burden billing.
- Seeded mapping: Fringe Cost 6100, Fringe Base 6060; G&A Cost 6060/6070/6080;
  Overhead Cost 5050/6010. Fringe on 6060 therefore carries into **G&A**, not
  Overhead (no Overhead cost cell is a Fringe base).

## Steps
### 1. GL for an exact rate — manual journal
Accounting → Journal Entries → "Add Journal Entry" (creates a Draft and opens it).
Set the Posting Date FIRST (month/day spinbuttons only), "Add Line" ×2, then per
line: click the account combobox (scroll it into view; it can be covered by the
sticky header), type the number, click the option, fill Debit/Credit + Tab. Check
`input[name=postingDate]` immediately before clicking "Post" (the form re-set the
date and description once mid-edit). Used: Dr 6100 30,000, Dr 6060 so that
6060 + YTD Direct labor = 100,000, Dr 6095 (an Expressly Unallowable account mapped
as G&A Cost) 1,000, Cr 1010.

### 2. Lock a period — /x/accounting/periods/:id/close → "Lock Period"
Locking sends `carbon/indirect-rates.compute`; the run appears on Indirect Rates
within seconds (rates, burden, billing timestamps; burden rows; billable items).
"Run Period" on Indirect Rates does the same for any Locked period.

### 3. Rates and statement
Indirect Rates → ⋯ → Rates (12-period grid; Actual row filled by runs) and
Statement (per pool: Account, Amount, Unallowable, Claimed; Pool Cost, Base, Rate;
"Burden from Fringe" carried line). Expected: Fringe 30 % = 30,000 / 100,000;
the unallowable account shows 1,000 in Unallowable and 0 claimed.

### 4. Burden catch-up
Rates drawer → "Set Rate" → Pool, Rate Type, From Period, Rate (percent) → Save
("Rate saved"). Raise Overhead Provisional from period 1, lock the next month: its
run posts YTD base × new rate − burden already posted (e.g. 2,040 × 90 % − 510 =
1,326).

### 5. Ceiling — contract line Billing tab → Rate Ceilings → "Add Ceiling"
Grid row: click "Choose a pool" → combobox → pool; click the % cell, fill, Tab.
The capped line's burden item carries `burdenRate` = ceiling.

### 6. True-up
Set Final rates (Rate Type = Final, from period 1) for every pool that applies to
projects → ⋯ → "Run True-Up" → Locked period → "Run True-Up". Negative burden
billable items appear for every pool billed above its Final rate.

### 7. ICE export — ⋯ → ICE Export → "Download CSV" per schedule
H: Contract, Customer, Labor…, Direct total, Fringe, Overhead, G&A, Total.
I: Claimed this year / prior / cumulative / Cumulative billed / Difference.

## Selector Notes
- Set Rate modal: re-snapshot after each combobox choice; the second combobox's
  ref changes after the first selection (a stale ref silently leaves Rate Type =
  Provisional). Verify `rateType=` in the dialog's inputs before Save.
- Comboboxes in drawers are found in the full `snapshot`, not `snapshot -i`.

## Common Failures
- Typing into a date segment by accident (keyboard input after a failed click) set
  a journal's year to 0100; posting then auto-created FY100 period 9. Always read
  the hidden `postingDate` before Post.
- The burden billing base is the line's Cost Plus billable items, not its ledger
  cost: labor with no Cost Plus item yet is burdened in the ledger but not billed.
