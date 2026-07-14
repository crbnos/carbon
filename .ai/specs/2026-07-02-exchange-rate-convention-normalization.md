# Exchange-Rate Convention Normalization (GL & Payments)

> Status: draft
> Author: Claude (audit follow-up), for brad@carbonos.dev
> Date: 2026-07-02

## TLDR

The platform's documented currency convention is `currency.exchangeRate` =
**foreign units per base unit**, so document→base conversion is **divide**
(this is how the `purchaseInvoiceLine` generated columns, the invoice views,
and `.ai/rules/purchasing-conversion-factors.md` all work). The GL posting and
payment chain (`post-sales-invoice`, `post-purchase-invoice`, `post-payment` /
`build-payment-journal`, tie-out RPCs, seeded payment amounts) instead assumes
base = document × rate. The chain is internally self-consistent — control
accounts net to zero and tie-outs pass — but for every non-base-currency
document the GL base amounts are wrong by the rate factor squared relative to
true base, seeded payment `totalAmount`s label base sums with the foreign
currency code (wrong remittance instruction), PO-matched FX invoices book a
phantom PPV, and realized FX gain/loss signs are inverted. This spec proposes
normalizing the whole chain to the documented divide-to-base convention in one
coordinated change.

## Problem Statement

Facts established by the 2026-07-02 audit (`.ai/runs/2026-07-02-invoice-payment-audit.md`):

1. `purchaseInvoiceLine.unitPrice/shippingCost/taxAmount` are GENERATED as
   `supplierX / exchangeRate` (migration `20250807094441`) — i.e. **base**
   currency. The `purchaseInvoices`/`salesInvoices` views therefore expose
   base-denominated `totalAmount`/`balance`.
2. `post-purchase-invoice/index.ts` multiplies those already-base line
   amounts by `exchangeRate` before journaling (comment claims they are in
   invoice currency — false). `post-sales-invoice` does the same on the sales
   side (where `salesInvoiceLine.unitPrice` is also base).
3. `post-receipt` books GR/IR at base (no multiplier), so the invoice-side
   multiplier produces a **phantom PPV** of `lineBase × (R − 1)` on every
   PO-matched foreign-currency invoice even at identical prices.
4. `post-payment`/`build-payment-journal` mirror the multiply convention
   (`applied × targetExchangeRate` control relief, `totalAmount ×
   exchangeRate` cash), which is why the loop closes and nothing crashes.
5. Payment seeding (`payments new.tsx`) sums view balances (base) into
   `payment.totalAmount` but labels it with the invoice's foreign
   `currencyCode` → the remittance instruction is wrong by the rate factor.
6. FX gain/loss sign: with foreign-per-base rates, a falling rate means the
   foreign currency strengthened (an AP loss), but the builder books a gain.
7. Tie-out RPCs (`20260630104012`) treat the base-denominated view totals as
   document-currency and multiply by rate.
8. `$paymentId.tsx` converts base→"payment currency" by divide — the same
   inverted convention.
9. costLedger / fixedAsset acquisition costs from FX purchase invoices are
   stored at the ×R magnitude, inconsistent with receipt-side costing.

Interim state (already merged on this branch): header `supplierShippingCost`
is divided to base at posting and folded in before the chain's ×R multiplier,
so AP credit == view balance × R for every component and payments settle
exactly. That keeps the loop closed but leaves the loop itself on the wrong
convention.

## Proposed Solution

Adopt **divide-to-base everywhere; journal lines are true base amounts; rates
appear only in FX gain/loss computation and display conversions.**

Concretely (one coordinated change):

1. `post-sales-invoice` / `post-purchase-invoice`: remove the
   `× invoiceExchangeRate` multiplier — line amounts (and the header shipping,
   already divided) are base already. Delete the false-premise comments.
2. `post-receipt`: convert header shipping with divide (it currently
   multiplies at `index.ts:562-564`); line amounts are already base.
3. `build-payment-journal`: define `appliedAmount`/`discountAmount`/
   `writeOffAmount` as base currency (they already are in practice — users
   enter them against base-denominated view balances). Control/discount/
   write-off lines post the raw amounts (no `× targetExchangeRate`). Cash line
   = `totalAmount` where `payment.totalAmount` becomes a base amount, with the
   document-currency amount derived for display (`× exchangeRate`), or vice
   versa — decide in Open Questions. FX gain/loss = document-currency
   principal × (1/payRate − 1/invRate), with the sign convention re-derived
   and the `(isAR ? 1 : -1)` normalization + the stored
   `invoiceSettlement.fxGainLossAmount` generated column updated together.
4. Payment seeding (`new.tsx`): seed the document-currency amount
   (`balance × exchangeRate`) when labeling with the foreign currency code, or
   seed base and label with the base currency code (Open Question).
5. Tie-out RPCs (`get_ar_tie_out` / `get_ap_tie_out` / aging): drop the ×rate
   on view totals.
6. `$paymentId.tsx` availableCredit conversion: flip to match.
7. Update golden-master tests in `post-payment.test.ts` (they currently pin
   the multiply convention) and the costLedger/fixedAsset magnitudes noted in
   the audit.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rate semantics | foreign-per-base, divide to base | Matches generated columns, views, update-exchange-rates job, and `.ai/rules` docs |
| Journal denominates | true base currency | GL must be base; display converts |
| Settlement amounts | base currency | Users enter them against base view balances today; no data migration needed |
| Migration of history | none (forward-only) | Historic journals were self-consistent; restating them is a separate decision |

## Data Model Changes

- `invoiceSettlement.fxGainLossAmount` generated column: re-derive formula
  and sign normalization (migration).
- No table shape changes expected.

## API / Service Changes

Edge functions: `post-sales-invoice`, `post-purchase-invoice`, `post-receipt`
(header shipping), `post-payment`, `build-payment-journal`, `post-memo`
(verify), tie-out RPC migrations. App: payment seeding route, PaymentApplyTable
formatting, `$paymentId.tsx` credit conversion.

## Acceptance Criteria

- [ ] For a foreign-currency invoice, journal base amounts equal
      document amount ÷ rate for every component.
- [ ] PO-matched FX invoice at identical prices books zero PPV.
- [ ] Payment seeded from an FX invoice shows the correct document-currency
      remittance amount.
- [ ] Realized FX gain/loss sign matches economic direction on both AR and AP.
- [ ] Tie-out RPCs reconcile subledger to control accounts for FX documents.
- [ ] post-payment golden-master tests updated and passing.
- [ ] Rate = 1 behavior byte-identical to today (regression guard).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Historic FX journals inconsistent with new ones | Med | Forward-only cutover; document the cutover date; optional restatement tooling later |
| Partial deployment (one function updated, another not) breaks the closed loop | High | Ship as one PR; the invariant "AP/AR credit == what payment debits" must hold at every commit |
| Hidden consumers assuming ×R magnitudes (reports, Xero sync) | Med | Grep for exchangeRate usages across packages/ee and jobs before implementation |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [ ] Should `payment.totalAmount` store base or document currency? (Base
      avoids migration of the seeding flow; document matches the remittance
      mental model.)
- [ ] Restate or leave historic FX journals? (Proposal: leave.)
- [ ] Does Xero sync (BillSyncer/SalesInvoiceSyncer) push amounts derived
      from the affected fields, and in which currency does Xero expect them?

## Changelog

- 2026-07-02: Created from the invoice/payment audit findings (P2 + Pay1).
