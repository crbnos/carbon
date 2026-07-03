# Invoice & Payment Posting Audit — 2026-07-02

Follow-up to the tax fix (migration `20260702114500`): audit of whether the
amounts posted to AR/AP match the invoice views' totals (which cap payment
application) for every component — tax, line shipping, header shipping,
add-ons, discounts — plus an end-to-end audit of the payment/memo chain.

Invariant checked: **posted AR/AP amount == view totalAmount/balance basis**.
Any component on one side but not the other strands a control-account balance
or blocks/over-relieves payments — the same family as the purchase-tax bug.

## Sales invoices (`post-sales-invoice` vs `salesInvoices` view)

| # | Severity | Finding |
|---|---|---|
| S1 | **Bug (high)** | `nonTaxableAddOnCost` is in the view subtotal but never posted to AR (`post-sales-invoice/index.ts:108-117, 302-306` omit it). Pay the full view balance → AR goes permanently negative by the add-on; revenue understated. |
| S2 | **Bug (high)** | Header shipping is allocated across lines with tax-inclusive weights over a pre-tax denominator (`index.ts:302-314` vs `108-117`), so AR is debited `headerShipping × (1 + effective tax)` while the view adds header shipping untaxed. The tax portion of shipping is stranded in AR forever. |
| S3 | Bug (edge) | If every line has a zero pre-tax basis, header shipping is allocated 0 and never posted, while the view still includes it. |
| S4 | Design flag | Line tax is credited to the **sales account**, not a tax-payable account. Doesn't break the AR↔view invariant, but revenue is overstated by collected tax and no tax liability exists on the balance sheet. Product decision needed. |
| S5 | Bug (edge) | Fixed Asset lines with null `assetId` silently post nothing (`index.ts:538` guard) and Comment lines can carry amounts; the view sums all lines regardless → view > AR. |
| S6 | Inconsistency | `intercompanyTransaction.amount` uses pre-tax `totalLinesCost` (`index.ts:1168`), not the actually-posted AR amount. IC matching never ties to the 1130 balance. |
| S7 | **Bug (high)** | Intercompany invoices are booked to AR account 1130 (`index.ts:277-291`) but `post-payment` always relieves the default receivables account (`post-payment/index.ts:392-395`). Paying an IC invoice strands 1130 and drives regular AR negative. |
| S8 | Display | `SalesInvoiceSummary.tsx:416-425` multiplies header shipping by `exchangeRate` in both the document-currency and converted totals (identical duplicated expression). |

Component matrix (sales): line price/tax/line shipping/addOnCost — consistent;
`nonTaxableAddOnCost` — view only (S1); header shipping — over-posted ×(1+tax)
(S2), dropped at zero basis (S3); discounts — consistently baked into
unitPrice (ok); FX round-trip — consistent given S1/S2 fixed.

## Purchase invoices (`post-purchase-invoice` vs `purchaseInvoices` view)

| # | Severity | Finding |
|---|---|---|
| P1 | **Bug (high)** | Header `supplierShippingCost` is FX-converted in **opposite directions**: posting multiplies by exchangeRate (`post-purchase-invoice/index.ts:445-447`), the view divides (per the platform convention: rate = foreign-per-base). On every foreign-currency invoice with header freight, AP is left with a residual of `shipping × (R − 1)`; invisible at rate 1. |
| P2 | **Systemic (FX)** | Posting multiplies already-base generated line columns by exchangeRate on a false premise (comment at `index.ts:666-670`; `purchaseInvoiceLine.unitPrice` etc. are generated as `supplierX / exchangeRate` = base). Consequences: phantom PPV of `lineBase × (R−1)` on every PO-matched FX invoice (receipt side posts base, invoice side posts ×R), and costLedger/fixed-asset amounts at ×R magnitude. Same inverted convention runs through the whole payment stack (see Pay1) — needs a coordinated, spec'd fix, not a patch. |
| P3 | Bug (edge) | Shipping-only invoices (all lines zero-value): header shipping is allocated 0 and never credited to AP (`index.ts:681-682`), while the view includes it. Freight bills are a real-world case. |
| P4 | **Bug** | PO→invoice conversion copies the **full** header `supplierShippingCost` and full flat line `supplierShippingCost`/`supplierTaxAmount` onto **every** partial invoice (`convert/index.ts:345-350, 370-376`). Two partial invoices → shipping and flat tax charged twice (AP and view agree, so it's overstated payable, not stranding). |
| P5 | Bug (edge) | Same as S5 on the purchase side (`index.ts:1098`, `1313-1314`): asset-less Fixed Asset lines and valued Comment lines are in the view but never posted; Comment lines also absorb a share of header shipping that is then never journaled. |
| P6 | Nit | `index.ts:1665` sets `datePaid: today` at posting ("TODO: remove once payments working") — with the new views, unpaid invoices can display a datePaid. |

## Payments & memos (`post-payment`, `build-payment-journal`, `post-memo`)

| # | Severity | Finding |
|---|---|---|
| Pay1 | **Systemic (FX)** | The entire payment/posting chain assumes base = doc × rate, but the platform convention (generated columns, migration `20260702061504`, `.ai/rules/purchasing-conversion-factors.md`) is base = doc ÷ rate. The chain is self-consistent (tie-outs pass; rate=1 hides it), but for FX documents: GL base magnitudes are wrong by the rate factor, payment seeding labels base sums with the foreign currency code (wrong remittance amount), and realized FX gain/loss signs are inverted. Fix together with P2 under a spec. |
| Pay2 | **Bug** | Voiding a payment that applied a memo strands the memo credit forever: the memo-remaining calculators (`invoicing.service.ts:1910-1926, 2098-2110, 1970-1986`) count all memo-sourced settlement rows without checking the via-payment's status, while the views correctly stop counting them. |
| Pay3 | **Bug** | `post-payment` commits staged memo credits without locking/validating the memos (no `status = 'Posted'` check at commit; `index.ts:234-261, 551-570`). A memo voided between staging and posting goes live silently; the invoice stays open while the user believes it settled. |
| Pay4 | Bug (latent) | The in-transaction on-account credit pool (`post-payment/index.ts:576-616`) ignores `paymentType`, unlike the UI mirror. A posted refund disbursement counts as **positive** credit → later payments can over-apply. Latent until refund flows are used. |
| Pay5 | Inconsistency | Voiding a payment whose unapplied cash was already drawn by a later payment isn't blocked; the party credit pool can go negative. |
| Pay6 | Low | Stored `invoiceSettlement.fxGainLossAmount` isn't sign-normalized for AP; panel displays AP losses as positive. No GL effect. |
| Pay7 | Latent | Cash refunds against a memo (`targetMemoId`) would double-dip memo credit — currently unreachable (service rejects such rows). |
| Pay8 | Inconsistency | Multi-invoice payment seeding assumes one currency (`new.tsx:79-87`): mixed-currency selections produce spurious FX plugs and misformatted balances. |
| Pay9 | Low | `salesInvoices` view INNER JOINs `salesInvoiceShipment` (purchase side is LEFT JOIN). An invoice missing its shipment row disappears from the view and becomes unpayable (balance defaults to 0). LEFT JOIN is strictly safer. |
| Pay8+ | Verified good | Over-settlement guard (reads views, row locks, cumulative cash+memo cap), partial/multiple payments, dust forgiveness (matches `INVOICE_DUST_THRESHOLD`), settlement deletion cascades, void journal reversal, memo journal shape, exchange-rate edit locking. |

## Remediation status

Tier 1 was implemented on this branch immediately after the audit (see the
follow-up commit). Tier 2 is captured in
`.ai/specs/2026-07-02-exchange-rate-convention-normalization.md` (FX) and
remains open for S4/S6/S8/Pay5/Pay6/Pay8/P6.

**Tier 1 — same family as the fixed bugs, safe and minimal (IMPLEMENTED):**
- S1 + S2 + S3: fix `post-sales-invoice` totals (add nonTaxableAddOnCost
  outside the tax multiplier; weight header shipping by the pre-tax basis;
  zero-basis fallback). One patch, makes AR == view total exactly.
- P1 + P3: header shipping conversion (divide, zero-guarded) and zero-basis
  fallback in `post-purchase-invoice`.
- P4: prorate shipping/flat tax at PO→invoice conversion.
- S7: `post-payment` resolves the control account per invoice (IC → 1130).
- Pay2 + Pay3: gate memo-remaining calculators on via-payment status; lock and
  validate memos as Posted at payment commit.
- Pay9: LEFT JOIN salesInvoiceShipment (fold into the branch's migration).
- Pay4 (minimal form): filter the credit pool by matching `paymentType`.

**Tier 2 — needs product/architecture decision (spec first):**
- P2 + Pay1: unify the exchange-rate convention (divide-to-base) across
  post-sales-invoice, post-purchase-invoice, post-receipt header shipping,
  post-payment/build-payment-journal, memo journal, tie-out RPCs, seeded
  payment amounts, and the golden-master tests.
- S4: split tax to a tax-payable account (needs an account default).
- S6, S8, Pay5, Pay6, Pay8, P6: smaller consistency fixes.
