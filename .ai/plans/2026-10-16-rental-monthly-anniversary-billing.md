# Rental agreements: monthly billing from the start date

**Request:** a customer wants each rental agreement invoiced on the same day every
month, counted from its start date (start on the 7th, invoice on the 7th), for the
same amount every month. Service contracts already do this with Monthly frequency
and "Align to calendar periods" unticked. Rental agreements offer only:

- **Calendar Month**: moves every customer onto the 1st, with a part month first.
- **28 Days**: the invoice date moves every month, and a year has 13 periods at
  the monthly rate, so the customer pays more than they were quoted.

Spec context: the rentals spec listed this as follow-on work ("anniversary cycles
later", `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md`
decision 10).

**Sibling:** contract `billingAlignment = Anniversary` with `billingFrequency = Month`
(`packages/database/src/contract-schedule.ts` → `gridAnchor` / `gridPeriodStart` /
`periodUnits`). Rentals copy its period grid and its pricing rule. Rentals do not
share its code: contracts price per contract-line unit and plan invoices, and
rentals persist `rentalBillingPeriod` rows per unit.

## Decisions (recommended, to confirm)

1. **Storage: add a third value to the `rentalBillingCycle` enum, `'Monthly'`.** Do not
   add a separate alignment column. Alignment means nothing to `28 Days`, and every
   billing function already switches on `cycle`. `Calendar Month` stays as it is, and
   so do existing agreements.
2. **UI copies the contract Billing card:** Billing Cycle cards **Monthly** and
   **28 Days**, with the **Align to calendar periods** checkbox under them. The
   checkbox is enabled only for Monthly. Ticked stores `Calendar Month`, and unticked
   stores `Monthly`. An existing Calendar Month agreement shows Monthly, ticked. The
   Properties panel select labels the three values "Monthly", "Monthly (calendar)"
   and "28 Days".
3. **The default for a new agreement stays `Calendar Month`.** This preserves current
   behavior. (Contracts default to Anniversary. We can change the default if you
   want.)

## Behavior of `Monthly`

- **Periods:** period k is `[start + k months, start + (k+1) months − 1 day]`. Each
  period is computed from the start date and is never chained from the previous
  period, so a 31 Jan start bills 31 Jan–27 Feb, then 28 Feb–30 Mar, then 31 Mar–…
  (the contract clamp rule). The end date and the return date still cut the last
  period. A holdover period that starts the day after the end date ends on the next
  anniversary boundary.
- **Price:** a whole period for a Monthly unit is exactly its month rate, every month.
  A part period (cut by the end date, the return date or holdover) is the month rate ×
  days used ÷ days in the whole period it belongs to. Daily and Weekly units bill the
  whole days or weeks the period covers, as they do on the other cycles.
- **Horizon:** today + 1 month. Rolling agreements still get one more period beyond
  the horizon.
- **Due date / timing:** unchanged. Advance is due on the period start, and Arrears is
  due on the period end.
- **Sales-type lease (ASC 842):** valued like Calendar Month. The payment is the month
  rate, there is one period per whole month of the term (`wholeMonthsInTerm` already
  counts anniversary months), and the rate is the annual rate. A `Sale` line needs a
  Monthly unit and a term of whole months from the start (end date = start + n months
  − 1 day). It does not need to start on the 1st, which removes a Calendar Month
  limit.
- **Invoice line text:** the same as Calendar Month (" · Month rate").

## Tasks

- [x] **1. Migration.** `pnpm db:migrate:new rental-monthly-billing-cycle` →
  `ALTER TYPE "rentalBillingCycle" ADD VALUE IF NOT EXISTS 'Monthly';`. Then run
  `pnpm db:migrate` and `pnpm run generate:types`.
- [x] **2. Billing math (TDD).** In `packages/utils/src/rental-periods.ts`:
  `RentalBillingCycle` gets `"Monthly"`. Add `anniversaryPeriodEnd(startDate, from)`,
  which computes from the start date. `naturalEnd`, `billingHorizon` and
  `periodCharge` get the new branch: a Monthly unit's charge is the rate × days ÷
  days in the anniversary period. Write the tests first in `rental-periods.test.ts`:
  the 7th → 6th grid; the same amount every month; the 31 Jan clamp; return and end
  cuts; holdover; Arrears due dates; horizon.
- [x] **3. Lease valuation (TDD).** In `packages/utils/src/lessor-lease.ts`:
  `leasePaymentTerms` treats Monthly like Calendar Month, and
  `salesTypeRequirementError` gets the Monthly whole-months rule. Add tests in the
  lessor-lease tests and `post-rental-agreement/lessor.test.ts`: a mid-month 12-month
  term schedules 12 periods.
- [x] **4. Server functions.** `create-rental-invoices/index.ts` `rentLineDescription`:
  Monthly + Month gives " · Month rate". Add a test to
  `rent-line-description.test.ts`. `post-rental-agreement` and `return-unit` already
  pass `cycle` through; only their types need checking.
- [x] **5. ERP.** In `sales.models.ts`, add `"Monthly"` to `rentalBillingCycles`.
  Replace the literal `"Calendar Month" | "28 Days"` unions in `sales.utils.ts` and
  `RentalLeaseClassification.tsx` with `RentalBillingCycle`. Update
  `RentalAgreementBilling.tsx` (cards + checkbox, copied from `ContractBillTo.tsx`)
  and the `RentalAgreementProperties.tsx` select labels. Then run `lingui:extract`
  and `/translate`.
- [x] **6. Docs.** Update `docs/content/docs/reference/rental-agreements.mdx` (cycles,
  example, sales-type requirements, the error text), the glossary `billing-cycle`
  term, and the Rentals section of `apps/erp/app/modules/sales/AGENTS.md`. Then
  regenerate swagger (`packages/database/src/swagger-docs-schema.ts`, via
  generate:types).
- [x] **7. Verify.** Run `pnpm --filter @carbon/utils test`,
  `pnpm --filter @carbon/server-functions test` (rental files), the scoped typecheck
  for `@carbon/utils`, `@carbon/server-functions` and `erp`, Biome,
  `pnpm db:check:datasets` and `pnpm db:check:backups`. Then browser-test with /test:
  create an agreement starting on the 7th, untick the box, activate, generate
  invoices, and check that the periods run 7th–6th at the full month rate.

## Deviations from the plan

- The helper is named `monthlyPeriodEnd`, not `anniversaryPeriodEnd`. It reuses
  `leaseMonthsAt` / `leaseMonthEnd` from `@carbon/database/lease-months`, which
  already clamp from the start date.
- A Monthly term counts its months with `leaseMonthsThrough`, not
  `wholeMonthsInTerm`. `wholeMonthsInTerm` counts 31 Jan → 27 Feb as 0 months,
  but billing cuts it as one whole period.
- The two sales-type troubleshooting headings in the rental agreements page are
  shorter. The longer headings pushed the page past the agent's read budget
  (`agent.kb.test.ts`).
