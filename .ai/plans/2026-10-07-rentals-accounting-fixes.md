# Rentals accounting fixes (from the 2026-10-07 end-to-end check)

Source: `.ai/runs/2026-10-07-rentals-accounting-e2e.md`, findings 1–5.

## 1. Early-return credits become credit memos

**Problem.** An early-return credit is a negative `Rental` line. When an invoice nets
negative, it cannot be applied to another invoice or refunded, because
`invoiceSettlementBase.appliedAmount` is non-negative and refunds only target memos.

**Design.** Follow the contract-cancellation precedent (`post-customer-contract`
cancel → a Draft credit memo with `customerContractId`; `post-memo` posts contract
legs).

- **Schema (one migration).**
  - `memo.rentalAgreementId`: composite FK to `rentalAgreement`.
  - `rentalBillingPeriod.memoId`: the credit memo that bills an adjustment row. It
    is exclusive with `salesInvoiceLineId`.
  - `revenueRecognitionSchedule.memoId`: the negative Deferral rows a memo wrote.
  - Run `generate:types` afterwards. Add backup manifest entries if required.
- **`create-rental-invoices`.** An `isAdjustment` period never goes on an invoice.
  - All of an agreement's due adjustments go on one Draft credit memo, amount =
    Σ credits at currency decimals. The periods are stamped `memoId` and set to
    `Invoiced`.
  - The memo stays Draft for review. Early-return credits are already held today,
    so this keeps that behaviour.
  - `planRentalInvoices` loses the early-return hold.
- **`post-memo`.** Add a rental branch next to the contract branch.
  - For each adjustment period, reuse `planRentalLine` and `rentalScheduleRows`
    (move them to `src/lib/` so `post-sales-invoice` and `post-memo` share them).
  - Legs: Dr Deferred Revenue up to the period's Planned Deferral rows, the rest
    Dr Rental Income, Cr AR. These legs replace the generic reason leg.
  - Write the negative Deferral rows with `memoId`.
- **Void a posted rental memo.**
  - Allowed only while none of its Deferral rows is Posted or claimed by a Draft
    run, and nothing has applied or refunded the memo (the existing
    consumed-memo guard).
  - It reverses the journal, deletes its Planned rows and returns the periods to
    `Pending` with `memoId` cleared, so the next run re-credits them.
  - Otherwise it is refused, as a contract credit is.
- **Delete a Draft memo.** Release the stamps in the same transaction: periods go
  back to `Pending`. This is the counterpart of `deleteSalesInvoiceReleasingRentals`.
- **Kept.** The legacy path, posting a negative `Rent` line on an invoice, keeps
  working for existing drafts.
- **UI.**
  - The memo page names its rental agreement.
  - The agreement's Billing Periods card links an adjustment to its memo.
  - The Invoice action's flash counts memos.
- **Tests.**
  - Pure: invoice planning, and memo legs (via the shared planner).
  - Live DB: post a memo, apply it to an invoice through a payment, refund it, and
    void it.

## 2. Rental amounts at settlement precision (done)

- `rateCharge`, `calendarMonthCharge`, `periodCharge`,
  `generateRentalBillingPeriods` and `leasePaymentTerms` take `decimals`, the
  agreement currency's `decimalPlaces`.
- Every caller passes it: `post-rental-agreement` activate and return,
  `create-rental-invoices` roll-forward, and the ERP preview through
  `useCurrencyDecimals`.

## 3. A sales-type unit cannot start before the activation month

`salesTypeRequirementError` gains `today`. It refuses a Sale line whose agreement
`startDate` is before the first of the current month, in the company timezone.

- Activation runs the check.
- `RentalCommencementPreview` shows it in Review and in the Activate confirmation,
  via `useCompanyToday`.

Dating commencement at the start date instead was rejected. Depreciation for the
months in between would already have posted on an asset the lease had sold.

## 4. Warning when net investment exceeds fair value

- Pure helper `netInvestmentExceedsFairValue(pv, fairValue)` in `lessor-lease`.
- The warning is shown on the unit's Accounting treatment panel and in
  `RentalCommencementPreview`.
- It is a warning only; activation is not refused.
- Copy: "Discounted at X%, the payments and residual are worth more than the
  unit's fair value. A lease is valued at the rate implicit in it — raise the
  discount rate or check the fair value."

## 5. Deposits fund only their own document

- **Allocator.** `FundingSource` gains an optional scope: `rentalAgreementId`
  (and `salesOrderId`). `FundingRequest` gains the agreement ids (and sales order
  ids) its target invoice bills. `allocatePaymentFunding` skips a source outside a
  request's scope. This requires a per-source cursor instead of one shared one.
- **Current payment.** A deposit Receipt's own cash may only be applied to its
  document's invoices.
- **Callers.** The scope is threaded through `replaceInvoiceSettlements`,
  `post-payment` (re-derivation), `loadOnAccountSources`, and the
  `PaymentApplyTable` preview. The open-invoice list carries each invoice's
  agreement ids.
- **Tests.** Allocator unit tests, plus one live `post-payment` test.

## Order

1. Finish item 2's tests (lessor, sales.utils).
2. Item 3.
3. Item 4.
4. Item 5.
5. Item 1.

Re-run the end-to-end scenario at the end.

## Status

All five items implemented and verified 2026-10-07; see the run log.
