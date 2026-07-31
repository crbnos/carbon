# FX Convention Normalization (GL & Payments) — Issue #1030

Tracking spec: `.ai/specs/2026-07-02-exchange-rate-convention-normalization.md`

## Convention (the whole point)

`currency.exchangeRate` = **foreign units per base unit** ⇒ base = document ÷ rate.
Stored settlement amounts are **already base**: `salesInvoiceLine.unitPrice`
(= base; `convertedUnitPrice = unitPrice × rate` is the document/presentation
value), `purchaseInvoiceLine.unitPrice` (= `supplierUnitPrice ÷ rate` = base),
the `salesInvoices`/`purchaseInvoices` view totals (base — purchase view already
divides shipping in `20260702224219`), `invoiceSettlement.appliedAmount/
discountAmount/writeOffAmount` (= base view balance), `payment.totalAmount` and
`memo.amount` (base — both forms format as `baseCurrencyCode`).
`targetExchangeRate` = invoice rate (invRate), `sourceExchangeRate` = payment
rate (payRate).

Today the GL/payment chain multiplies these already-base amounts by the rate
(`base = doc × rate`), inflating FX-document journals by the rate factor, booking
phantom PPV, and inverting realized-FX signs. Fix: **journal lines are raw base;
rates appear only in realized FX and cash conversion.**

Realized FX on a cash-settled principal (base) =
`applied × (invRate/payRate − 1)`, normalized `× (isAR ? 1 : −1)` so +ve = gain
for AR & AP. Real base cash for that principal = `applied × invRate/payRate`.

Invariant (must hold at every commit): **control relief (base) == view-balance
reduction == Σ appliedAmount**, and the payment journal balances by construction.

## Changes (one coordinated PR)

### Edge functions (TS)
1. `post-sales-invoice/index.ts:347-348` — drop `× invoiceExchangeRate`
   (line amounts already base = sales view). Fix comment 311-314.
2. `post-purchase-invoice/index.ts:818-819` — drop `× invoiceExchangeRate`
   (lines base; header shipping already `/rate` at 558). Fix comment 786-791.
3. `post-receipt/index.ts:619-621` — header shipping `× exchangeRate` → `/ exchangeRate`
   (base; matches invoice-side costing).
4. `post-payment/build-payment-journal.ts` — rewrite divide-to-base:
   control/discount/write-off/unapplied post RAW base; cash =
   `Σ(applied×invRate/payRate) + (totalAmount − Σapplied)`; FX =
   `Σ (isAR?1:−1)×applied×(invRate/payRate − 1)`. `exchangeRate` input retained
   but unused in base math.
5. `post-payment/index.ts:281-286, 694-705` — drop `× sourceExchangeRate` /
   `× exchangeRate` (totalAppliedBase, paymentTotalBase, availableCreditBase now base).
6. `post-memo/index.ts:268` — `amountBase = memo.amount` (drop `× exchangeRate`).

### App (TS)
7. `routes/x+/payments+/$paymentId.tsx:209-210` — availableCredit = base (drop `/ exchangeRate`).
8. `modules/invoicing/invoicing.service.ts` `getAvailableOnAccountCredit` (~1566) —
   `p.totalAmount − appliedBase` (drop `× exchangeRate` / `× sourceExchangeRate`).

### Migration (no type/shape change ⇒ no regen)
9. `invoiceSettlement.fxGainLossAmount` generated column DROP+ADD:
   `appliedAmount × (targetExchangeRate − sourceExchangeRate) / sourceExchangeRate`.
10. Recreate the 6 RPCs from `20260702224219` (CREATE OR REPLACE), dropping every
    `× exchangeRate` / `× m.exchangeRate` / `× p.exchangeRate` on already-base
    open/unapplied/memo amounts. Views need NO change (already base).

### Tests
11. Rewrite `post-payment/post-payment.test.ts` golden masters for foreign-per-base
    (FX gain now when payRate < invRate). `build-memo-journal` unchanged ⇒ its
    test untouched.

## Open questions — resolved
- `payment.totalAmount` currency → **base** (Design Decisions table; matches seeding).
- Historic FX journals → **leave** (forward-only).
- Xero sync → **unaffected** (pushes document amounts + pass-through rate; verified).

## Verify
- `pnpm exec turbo run typecheck --filter=erp`
- `pnpm run lint`
- deno golden tests run in CI (no local deno).
</content>
</invoke>
