# Rental agreements: end-to-end accounting check

Date: 2026-10-07. Branch `revenue-recognition-rentals-spec`.

The run drove the real ERP routes over HTTP with an authenticated session: the same
actions the UI buttons post to. It used a new scratch company, **Rentals Accounting E2E**
(`db376o4je0ggi916cd20`), which has the seeded chart of accounts, account defaults and
asset classes. Every journal was then read from Postgres. Expected values were worked
out by hand before each step and were not taken from the code.

## Deviations from a live run

- **Delivery was backdated.** `deliveredAt` was set to 2026-08-01 directly in the
  database after the Deliver route ran. The route always uses today's date, and the
  scenario needed several months of history.
- **One sales-order line price was set in the database.** On the sales order created
  by Sell for FA000002, `unitPrice` was changed to 22,000.
- **Every posting is dated 2026-10-07.** Invoices, payments, lease commencement and
  lease returns post on the server's "today", which is Carbon-wide behaviour that is
  also on main. Recognition and depreciation runs post in their own months. Because
  of this, balances at interim month-ends are distorted. The final balances are not.

## Scenario

Three serialized generators were stocked at 24,000 each and capitalized into Rental
Fleet on 2026-07-01. Depreciation ran for July to September at 320 per month per unit.

| Agreement | Terms | Lifecycle exercised |
|---|---|---|
| RA000001 (Rental) | Open-ended, Calendar Month, Advance, 1,500/month, 3,000 deposit | August accrual before invoicing; invoice for Aug–Oct; September deferral; early return on 10-05 with a −1,258.06 credit; 250 damage charge; October recognition; close; asset sold for 22,000 (720 loss) |
| RA000002 (Sale) | 2026-08-01 to 09-30, Arrears, 11,000/month, fair value 24,000, unguaranteed residual 2,000 | Commencement; Aug and Sep interest; rent to Net Investment (NI); return to Fleet on 10-05 (new asset at 2,000); residual asset scrapped |
| RA000003 (Sale) | 2026-08-01 to 09-30, Advance, 11,800/month, purchase option 1,000 (not reasonably certain) | Commencement; Aug interest; Sell to Customer; settlement Dr NI / Cr Lease Revenue 1,000; line set to Sold |

## Result

The final trial balance matches the hand-worked expectation to the cent. No journal is
unbalanced.

Every clearing account is exactly 0: 1145 Contract Assets, 1160 Net Investment in
Leases, 1210 Raw Materials, 1370 Rental Fleet, 1380 Accumulated Depreciation, 2110
Customer Prepayments and 2160 Deferred Revenue.

| Account | Balance |
|---|---|
| 1010 Bank | 50,091.94 |
| 1110 AR | 21,999.99548 (the open invoices total 22,000.00, so 0.00452 is dust; see finding 2) |
| 4060 Rental Income | 3,491.94 |
| 4070 Lease Revenue | 46,377.39 |
| 4150 Lease Interest Income | 242.46 |
| 5010 COGS | 44,099.85 |
| 6310 Depreciation | 3,226.67 |
| 6320 Loss on Disposal | 2,693.33 |
| 5310 Inventory Adjustment | −72,000 (opening stock from the setup) |

The lease schedules match an independent effective-interest calculation:

- RA000002: NI 23,816.24, interest 119.08 + 64.68, closing balance 2,000.00.
- RA000003: NI 23,541.29, interest 58.71, closing balance 0.

All 7 recognition rows posted. All lease interest posted and its schedule lines are
stamped. The NI report shows RA000002 at 2,000 on 09-30 and no live lines on 10-31.

## Findings

1. **An early-return credit invoice cannot be settled (high).** The credit invoice has
   a negative total. `invoiceSettlementBase.appliedAmount` is `nonnegative()`, and a
   refund can only target memos. So no payment can apply the credit, and no refund
   can pay it out. After full payment the subledger keeps AR000001 open at +1,008.06
   and AR000004 at −1,008.06, and nothing can match them. Under invoice automation
   the rent credit is always on its own invoice, so every early return on Advance
   billing hits this.
2. **Rental amounts carry sub-cent values (medium).** `calendarMonthCharge`
   (`rental-periods.ts:190`) and the early-return credit (`:361`) round to the
   5-decimal internal scale, not to the currency's decimals. Every prorated period
   and every credit therefore bills fractions of a cent, and AR in the GL drifts from
   the invoice balances by an amount nobody can collect.
3. **A backdated start dates commencement at activation (medium).** A Sale line whose
   start date is before activation books commencement and lease revenue on the
   activation day. Its interest posts in earlier months, so 1160 shows 177.79 at
   08-31 and 242.46 at 09-30 with no principal. Depreciation also keeps running until
   activation. Suggested fixes: refuse activation when the start date is in an earlier
   period, or date commencement at the start date.
4. **The entered discount rate is used, not the rate implicit in the lease (design).**
   Nothing stops NI from exceeding fair value. The first draft of RA000002 at
   12,000/month valued NI at 107.5% of fair value, which would book lease revenue
   above the asset's fair value. ASC 842 discounts at the rate implicit in the lease.
   At minimum, warn when NI is greater than fair value.
5. **A deposit is not tied to its agreement when it is applied (low).** RA000001's
   deposit funded RA000003's invoice through the prior-credit allocator. The GL is
   correct, because 2110 clears, but the agreement's Deposits card is misleading.

Side findings outside rentals:

- A Serial item's positive adjustment with no `trackedEntityId` creates untracked
  serial stock. The server does not refuse it, which matters for API and MCP callers.
- A GET to `/x/sales-invoice/new?sourceDocument=Sales Order…` creates the invoice even
  when the `/x` layout redirects, because loaders run in parallel. This left the stray
  Draft AR000006.
- Capitalization accepts a `transferDate` earlier than the date the unit entered stock.

## Not covered

- An Arrears operating rental
- The 28 Days billing cycle
- Holdover past the end date
- Residual return to Inventory
- A reasonably certain purchase option (zero settlement)
- Void paths: an invoice VOID taking a line from Sold back to On Rent, and a deposit refund
- Tax on rent
- Cancel
- Run reversal
- Foreign currency (refused by design)

## Fixes and re-run (same day)

The fixes are planned in `.ai/plans/2026-10-07-rentals-accounting-fixes.md`. All five are implemented. The re-run used a second scratch company, **Rentals Accounting E2E 2** (`db383okje0ghvu16cjv0`), and went through the same HTTP routes.

| Fix | Verified |
|---|---|
| 1. Early-return credit becomes a credit memo | A return on 10-05 drafted CR-…-000001 for 1,258.06, and the Invoice action redirected to it. Deleting the draft returned the period to Pending. Re-invoicing drafted a new memo, and posting it booked Dr 2160 / Cr 1110 with a −1,258.06 Deferral row carrying `memoId`. Voiding it before any run returned the period to Pending and removed the row. Re-invoicing drafted a third memo, which posted and was then applied through the payment's credits together with the deposit, so AR000001 is Paid. After the October run, a void is refused with the reason shown. |
| 2. Billing at cents | The first partial period, Aug 15–31, bills 822.58. AR in the GL is exactly 0.00000 once paid. |
| 3. Sales-type start date | Activate refuses a sales-type unit starting 2026-08-01: "… start it in 2026-10 or later". |
| 4. Fair-value warning | The Review / Activate preview warns that NI of $25,801.34 exceeds the fair value of $24,000.00. Screenshot: `.context/fair-value-warning.png`. |
| 5. Deposit scope | A 1,000 receipt against RA-B's 4,000 invoice is refused, because RA-A's deposit is not eligible. The same receipt against RA-A's invoice draws the deposit. In the final payment the deposit funds RA-A's invoice and cash pays RA-B's. The remaining deposit of 435.48 was refunded. |

**Final trial balance.**

| Account | Balance |
|---|---|
| Bank | 6,564.52 |
| Rental Income | 6,564.52 (822.58 + 1,500 + 241.94 + 4,000) |
| AR | 0 |
| Customer Prepayments | 0 |
| Deferred Revenue | 0 |

No journal is unbalanced.

**Also fixed.** `credits+/$memoId.post.tsx` and `$memoId.void.tsx` caught their own redirect and replaced every refusal with "Failed to post/void memo".

**Gates.**

- Scoped typecheck passes, 6/6.
- Tests:
  - utils: 606/606
  - ERP invoicing, sales and payments routes: 271/271
  - server-functions with the live DB: 386/387. `src/lib/rows.test.ts` flakes under the parallel run and passes on its own.
- Checks: `@carbon/checks` test 278/278, plus clobbers and license-headers.
- `db:check:datasets` and `db:check:backups` both pass.

**Not done.**

- `pnpm lingui:extract` and translation for the new UI strings.
- The recurring-billing digest does not yet list Draft rental credit memos (they are only logged).
- The "Insufficient payment funding for target: si_…" message still shows a raw invoice id.
