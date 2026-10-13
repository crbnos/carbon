# Serial unit cost, Recost, zero-cost Capitalize, Adjust Cost

Last tested: 2026-10-08
Routes: /x/part/<itemId>/inventory (Storage Units card), /x/fixed-asset/capitalize?…, /x/fixed-asset/<id>/adjust-cost

## Prerequisites
- A Serial-tracked FIFO part (satellite dataset: `RW-010`, Buy). To get a zero-cost unit,
  set its `itemCost.unitCost = 0` (FIFO with no open layers values a positive adjustment at the unit cost).
- Accounting enabled; user with accounting view + update (the bypass user `test@carbon.ms` has both).
- Seeding: `pnpm db:seed:dev` reads `.env` (port 54322), not the worktree's `.env.local` —
  pass `SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:<db port>/postgres`. On 2026-10-08 the
  dataset wipe failed (`customerContractInvoiceLine_parent_check`), but `crbn up` had already seeded the company.

## Steps
### 1. Add zero-cost serials
- Part → Inventory → "Update Inventory" (click it via `eval` — a fixed toast region covers it).
- Positive Adjustment, Serial Number textbox (the one before "What is Expiration Date?") → `RW-TEST-1`; quantity defaults to 1.
- requestSubmit the dialog form with the "Save" button. Repeat for `RW-TEST-2`.
- Verify: each serial row shows "No cost" (amber). Row actions sit behind a vertical-ellipsis
  trigger (`button[aria-label=Actions]`, revealed on hover): Copy ID, Print Label, Update Quantity,
  Recost, Capitalize as Fixed Asset. Open it with a `pointerdown` event (Radix), not `.click()`.

### 2. Recost
- Open RW-TEST-1's Actions menu → menuitem "Recost". Modal "Recost RW-TEST-1": Unit Cost (react-aria),
  Offset Account prefilled "3100 Retained Earnings", Posting Date = today.
- fill Unit Cost "500", blur (click a date spinbutton), verify `input[name=unitCost]` = "500".
- requestSubmit the dialog form with the "Recost" button.
- Verify: row shows "$500.00". DB: journal "Recost RW-010 RW-TEST-1": 1210 Raw Materials +500, 3100 Retained Earnings +500;
  costLedger two 'Revaluation' rows (−1 @ 0, +1 @ 500 stamped).

### 3. Capitalize a zero-cost unit
- Actions menu → "Capitalize as Fixed Asset" (a link item; `a[href*="fixed-asset/capitalize"]` exists only while the menu is open).
- Alert "This unit has no cost in inventory", Acquisition Cost field, Offset Account (Retained Earnings).
- fill Acquisition Cost "4200", blur, verify `input[name=cost]`; requestSubmit with "Capitalize".
- Verify: redirect to /x/fixed-asset/<id>, Acquisition Cost $4,200.00. Journal: 1370 +4200 / 3100 +4200.

### 4. Adjust Cost
- Asset header "More options" → menuitem "Adjust Cost". fill Increase "800", blur, requestSubmit with "Adjust Cost".
- Verify: Acquisition Cost $5,000.00; Transfers table has a "Cost Adjustment" row. Journal: 1370 +800 / 3100 +800.

## Selector Notes
- Read committed values from `[role=dialog] input[name=…]`, never the visible formatted text.

## Common Failures
- A plain click on Save/Recost does nothing — requestSubmit the form.
