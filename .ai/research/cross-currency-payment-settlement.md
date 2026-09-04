# Cross-Currency Payment Settlement & Realized FX Gain/Loss

Research into how best-in-class ERP/accounting systems settle a payment whose currency
differs from the invoice's currency, and how realized foreign-exchange gain/loss is
recognized. Context: Carbon needs a domain-correct model for payments synced back from
external accounting systems (Rillet / Xero / QuickBooks) that may be denominated in a
currency different from the invoice they settle.

Date: 2026-08-24

---

## TL;DR — the canonical model

Name the three currencies precisely:

- **A = invoice (transaction/document) currency** — what the invoice's open balance is denominated in.
- **B = base (accounting/functional/home/reporting) currency** — what the ledger and AR/AP control account are valued in.
- **C = payment (cash/tender) currency** — what actually hit the bank.

The correct behavior, on which every mature system agrees:

1. **The open balance lives in currency A.** An invoice's remaining balance is tracked and
   reduced in the *invoice's own currency*. A payment reduces that balance by an amount
   **expressed in A**, never by the payment's face amount in C. This is the single most
   important invariant, and the exact place the Carbon bug lives (see §5).

2. **Realized FX gain/loss = the change in the *base-currency* value of the settled A-amount
   between invoice date and payment date.** It is `(applied_A × rate_A→B@payment) −
   (applied_A × rate_A→B@invoice)`. It has nothing to do with currency C directly; C only
   determines *how much A* the cash bought.

3. **AR/AP is relieved at the invoice-date base value**; the cash lands at the payment-date
   base value; the difference is the realized gain/loss, so debits = credits and the
   subledger stays tied to the GL.

4. **Third-currency (C ≠ A and C ≠ B) is the hard case.** Only heavyweight ERPs (SAP,
   Dynamics 365 F&O) support it directly, via an explicit **cross-rate** (A↔C) so the system
   never has to guess a double conversion. NetSuite, QuickBooks Online, and Xero **disallow**
   payment-currency ≠ invoice-currency and force a workaround.

---

## 1. The standard model for settling a foreign-currency invoice

### Determining the amount applied (in which currency)

The applied amount is resolved **in the invoice currency A**. The receivable is a monetary
item denominated in A; the payment application reduces the A-denominated open balance.

- If the payment is received in **A** (C = A), the applied A-amount is just the cash amount.
- If the payment is received in **B or a third currency C**, the cash must be **converted into
  A** (using the A↔C rate at settlement) to know how much of the A-denominated balance it
  clears. Systems that support this (Dynamics, SAP) call the A↔C rate the **cross rate** and
  require the user (or the sync) to supply it. Microsoft is explicit: "the settlement of
  remaining invoice amounts will be done using the currency and exchange rates of the original
  invoice to ensure that no gain or loss is incurred" on the *A-side* of the split
  (Microsoft Learn, currency revaluation for AP/AR).

Only after the cash is expressed in A do you know whether the invoice is fully or partially
settled. The FX movement is a *separate* line, not part of the applied amount.

### Computing realized FX gain/loss

Realized FX is the difference between the invoice's booked base value and the cash's base
value, **for the portion settled**:

```
booked_base    = applied_A × rate(A→B)@invoiceDate      // what AR was carried at
settled_base   = applied_A × rate(A→B)@paymentDate      // what that A is worth now
realizedFX     = settled_base − booked_base             // >0 gain (AR), sign flips for AP
```

- CorporateFinanceInstitute / SoftLedger: the gain/loss is "the difference between the
  exchange rate on the invoice date (transaction date) and the payment date (settlement
  date)." SoftLedger's worked example: a 100 EUR invoice booked at 1.142173 → 114.22 USD;
  paid when the rate is 1.15494 → the extra USD needed produces a **$1.28 realized loss**
  (AP direction) purely from the rate move.
- Xero: "calculate[s] the realized foreign currency gain and loss by comparing the rate when
  the invoice was issued with the one when it was paid," shown at the bottom of the paid
  invoice.
- Dynamics 365 F&O: "Realized gains or losses … are calculated by converting to the
  accounting currency … using the exchange rates … as of the payment date."

### Relieving the AR/AP control account (staying tied out)

The subledger and GL stay tied because the settlement journal always relieves AR/AP at its
**carried (invoice-date) base value**, routes the FX delta to a P&L account, and lands cash
at its own base value. Canonical AR settlement (customer receipt), values in base B:

```
Dr  Cash/Bank                          settled_base (cash's B value at payment date)
Cr  Accounts Receivable                booked_base  (relieves AR at invoice-date value)
Dr/Cr  Realized FX Gain/Loss (P&L)     realizedFX   (balancing plug)
```

For a gain, `Cr Realized FX Gain`; for a loss, `Dr Realized FX Loss`. SoftLedger describes
exactly this: "an additional journal entry between the … Realized Gain/Loss Account and the
AR Account … to adjust the balance to the settlement amount given the exchange rate at the
time of settlement." SAP S/4HANA posts the realized difference **only when the open item is
cleared**, automatically to the configured realized-gain / realized-loss GL accounts
(assignable per Sales/Purchasing/General).

Key consequence: AR is relieved by exactly the amount it was booked at, so the AR subledger's
open-item detail and the GL control-account balance never drift — the FX movement is
absorbed by the P&L account, not smeared into AR.

---

## 2. Same-currency-as-invoice vs third-currency payments

**Do systems even allow C ≠ A?** Mostly no.

- **NetSuite:** Does **not** support applying a payment in one currency to an invoice in
  another currency — "the system's inability to perform double currency conversion on a
  single transaction. Each transaction supports only one exchange rate field." The documented
  workaround is a two-step *cash receipt → bank deposit* through **Undeposited Funds**, where
  the currency boundary is crossed at the deposit step, not the application step (Prolecto,
  jCurve, Concentrus).
- **QuickBooks Online:** A customer payment must be in the **invoice's currency**. When cash
  arrives in a different currency (e.g., home currency against a foreign invoice), the
  documented pattern is a "dummy"/clearing bank account and a manual home-currency adjustment
  — QBO applies in A and you reconcile the C-side separately (Intuit community threads).
- **Xero:** Payment is recorded against the invoice **in the invoice's currency**; if the
  actual bank account is a different currency, you route through a clearing/transfer and the
  realized FX crystallizes on the conversion leg. Xero does not let you type a foreign face
  amount directly onto a differently-denominated invoice.
- **SAP S/4HANA and Dynamics 365 F&O:** **Do** support true third-currency settlement.
  Dynamics exposes a **Cross rate** field used precisely "when the payment line and the
  invoice line use different currencies **and neither currency is the accounting currency**."
  Their example: accounting = USD, invoice = CAD, payment = EUR; the cross rate translates
  **directly between CAD and EUR** rather than triangulating through USD. This is the
  reference design for third-currency settlement.

**How common is third-currency settlement?** Rare in practice and generally discouraged. The
standard advice (echoed across NetSuite/Xero/QBO guidance) is to **have the customer pay in
the invoice currency**, or treat an off-currency remittance as a prepayment/credit and
re-apply. Real third-currency settlement is a heavy-ERP feature, not a small-business one.

**How disallowing systems behave:** they don't silently auto-convert onto the invoice.
They either (a) **reject** the mismatch, (b) require the payment to be **re-denominated into
A first** (record in A, reconcile the bank in C separately via a clearing account), or (c)
force a **manual FX/clearing entry**. None of them apply the C face amount to the A balance.

---

## 3. Realized vs unrealized FX at settlement

- **At settlement, it is always REALIZED.** IAS 21 (¶28): "exchange differences arising on
  the **settlement** of monetary items … shall be recognised in profit or loss in the period
  in which they arise." ASC 830 is materially identical for transaction gains/losses on
  monetary items. Settling an invoice is the textbook realization event.
- **Unrealized** FX only applies to *open* (unsettled) monetary balances re-translated at a
  period-end/closing rate — a balance-sheet revaluation that reverses next period. It is the
  month-end revaluation job, **not** the payment path.
- **Where it posts:** a dedicated **Realized FX Gain/Loss** P&L account (income-statement).
  SAP lets you configure separate realized-gain and realized-loss accounts and split them by
  process; Dynamics posts to the legal entity's configured gain/loss account; SoftLedger/Xero
  post to a "Realized Currency Gain/Loss" account. Keep realized (P&L, on settlement) and
  unrealized (revaluation, reverses) as **distinct accounts**.

Note on already-revalued items (SAP behavior, worth mirroring conceptually): if the open item
was revalued at a prior period end, clearing first **reverses the unrealized revaluation**
correction, then books the **realized** difference against the original invoice-date rate — so
you never double-count. For a v1 without period-end revaluation, this reduces to the simple
invoice-date-vs-payment-date computation.

---

## 4. Rounding / residual handling

Two distinct rounding concerns:

1. **Round realized FX to the base currency's precision.** The gain/loss amount is a
   base-currency (B) money value → round to B's decimal places at the point it's booked
   (SoftLedger: "rounds to the reporting currency's precision"). Carbon already has the right
   primitives for this (settlement values rounded at `currency.decimalPlaces`, internal GL
   lines at scale 5 — see `numeric-precision.md`). The realized-FX line is a settlement
   value.

2. **Don't strand an invoice as "partially paid" over FX dust.** The failure mode: convert
   C→A, get an A-amount a cent or two short of the open balance, and leave the invoice open by
   $0.01–0.02 that is *purely* a conversion-rounding artifact. Mature systems avoid this by:
   - **Tracking the open balance in A and settling the A-side exactly**, letting the entire
     rate movement fall into the FX gain/loss line rather than into a residual A balance
     (Microsoft: remaining amounts settled "using the currency and exchange rates of the
     original invoice … [so] no gain or loss is incurred" on the A remainder).
   - A **residual write-off threshold** / "auto-write-off small differences" so a sub-threshold
     remainder is cleared to a small-difference (or the FX) account and the invoice flips to
     fully paid (Oracle "Residual Balance Threshold"; SAP tolerance groups; QBO minor-charge
     write-off). Carbon already ships this idea as `INVOICE_DUST_THRESHOLD = 0.01` and
     post-payment's `0.0001` unapplied-dust band (`invoicing.models.ts`, per
     `numeric-precision.md`).
   - **Snap-to-zero:** if the intended settlement is "pay in full," clear the *entire*
     remaining A balance and let FX absorb the delta, rather than deriving the A-amount from
     the C cash and discovering a residual.

The rule of thumb: **rounding lives on the FX/write-off line, never on the AR open balance.**

---

## 5. Common pitfalls / what NOT to do

1. **Applying the payment's face amount (in C) directly against an A-denominated balance.**
   THE bug being fixed. Paying "500 USD" against a "500 EUR" invoice and calling it settled
   treats 1 USD = 1 EUR, corrupting the open balance and *silently swallowing the entire FX
   movement* into a wrong applied amount. The C amount must be converted to A (via the A↔C
   settlement rate / cross rate) **before** it touches the open balance.

2. **Skipping the realized FX line entirely.** If you relieve AR at the payment-date value
   instead of the invoice-date value (or land cash at the invoice-date value), the journal
   still "balances" but the FX gain/loss is buried in AR or cash and the subledger drifts from
   the GL. AR must be relieved at its **carried** value; the plug is realized FX.

3. **Triangulating through base without a cross-rate when C ≠ A ≠ B.** Converting C→B→A using
   two independently-sourced rates introduces a phantom gain/loss from rate inconsistency.
   Dynamics' cross-rate exists precisely to translate A↔C **directly**. If Carbon must support
   third-currency, carry an explicit A↔C rate from the source system rather than deriving it.

4. **Treating settlement FX as unrealized (or revaluing instead of realizing).** Settlement is
   a realization event → P&L now, not a reversing balance-sheet entry.

5. **Deriving the applied A-amount from the cash and then discovering a residual** — instead of
   settling the intended A balance and letting FX/dust absorb the remainder — leaves invoices
   perpetually "almost paid" (see §4).

6. **Reusing the unrealized-FX (revaluation) account for realized settlement gains/losses.**
   They must be separable for reporting; mixing them makes the revaluation reversal double-count.

---

## Practical recommendation for Carbon v1 vs defer

Given the sync context (payments arriving from Rillet/Xero/QuickBooks), and that those three
sources **already restrict** payment currency to the invoice currency:

**v1 (support):**
- **C = A (payment in invoice currency), base = B.** The overwhelmingly common case and the
  only one QBO/Xero even emit. Convert nothing on the A-side; compute realized FX from
  `rate(A→B)@invoice` vs `rate(A→B)@payment`; relieve AR at invoice-date base; post the delta
  to a dedicated **Realized FX Gain/Loss** P&L account; round FX to B's decimals; clear
  sub-threshold A residual via the existing dust threshold.
- **C = B (payment in base currency against a foreign invoice).** Also common. Requires the
  A↔B settlement rate to convert the base cash into an A-applied amount; same FX computation.
  This is what QBO's "invoice foreign, pay home" flow produces.
- **The invariant:** always reduce the open balance in **A**, always book realized FX as a
  separate P&L line, never apply a C face amount to an A balance.

**Defer (or reject with a clear error) unless a source actually emits it:**
- **True third-currency settlement (C ≠ A and C ≠ B).** Needs an explicit cross-rate (A↔C)
  carried on the synced payment, à la Dynamics/SAP. NetSuite/QBO/Xero don't produce this, so
  the sync is unlikely to see it. If a source ever sends C ∉ {A, B} without an A↔C rate,
  **reject/flag rather than guess a double conversion** — that's the pitfall in §5.3. Add it
  later behind an explicit cross-rate field if a source (e.g. a bank feed) demands it.

This keeps v1 correct for 100% of what the current integrations emit while structurally
refusing the corrupting shortcut.

---

## Sources

- [IAS 21 — The Effects of Changes in Foreign Exchange Rates (IFRS Community)](https://ifrscommunity.com/knowledge-base/ias-21-effects-of-changes-in-foreign-exchange-rates/) — settlement of monetary items → exchange differences in P&L.
- [How foreign currency translation is applied under IAS 21 and ASC 830 (Data Studios)](https://www.datastudios.org/post/how-foreign-currency-translation-is-applied-under-ias-21-and-asc-830)
- [Foreign Currency Transactions: Accounting Guide (Vintti)](https://www.vintti.com/blog/foreign-currency-transactions-accounting-and-reporting-practices) — realized vs unrealized at settlement date.
- [Foreign Exchange Gain/Loss — Overview, Recording, Example (Corporate Finance Institute)](https://corporatefinanceinstitute.com/resources/accounting/foreign-exchange-gain-loss/)
- [Realized Foreign Currency Gain/Loss from AP Bills and AR Invoices (SoftLedger)](https://softledger.com/support/en/articles/11940078-realized-foreign-currency-gain-loss-from-foreign-currency-ap-bills-and-ar-invoices) — exact journal entry + worked example (100 EUR, $1.28 loss).
- [Specify the cross rate — Dynamics 365 Finance (Microsoft Learn)](https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/specify-cross-rate) — third-currency settlement via explicit A↔C cross rate; USD/CAD/EUR example.
- [Currency revaluation for AP and AR — Dynamics 365 Finance (Microsoft Learn)](https://learn.microsoft.com/en-us/dynamics365/finance/cash-bank-management/foreign-currency-revaluation-accounts-payable-accounts-receivable) — remaining amounts settled in original invoice currency/rate; realized posts on clearing.
- [Managing Exchange Rate Differences — SAP S/4HANA (SAP Learning)](https://learning.sap.com/courses/customizing-core-settings-in-financial-accounting-in-sap-s4hana/managing-exchange-rate-differences) — realized posted only when open item cleared; configured GL accounts per process.
- [How does SAP Business One handle Exchange Rate Differences (SAP Community)](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/how-does-sap-business-one-handle-exchange-rate-differences/ba-p/13461871)
- [Learn How To Accept Different Foreign Currency in NetSuite Cash Receipt Operations (Prolecto)](https://blog.prolecto.com/2017/12/09/learn-how-to-accept-different-foreign-currency-in-netsuite-cash-receipt-operations/) — NetSuite one-rate-per-transaction limitation + Undeposited Funds workaround.
- [Accept Customer Payment for Invoice in Different Currency (Concentrus)](https://blog.concentrus.com/accept-customer-payment-for-invoice-in-different-currency)
- [Record payments for foreign invoices/bills in different currencies (QuickBooks)](https://quickbooks.intuit.com/learn-support/en-za/help-article/multicurrency/receiving-making-payment-foreign-invoice-bill/L1weZLBmC_ZA_en_ZA)
- [Invoice foreign / pay home currency — how to receive payment (QuickBooks community)](https://quickbooks.intuit.com/learn-support/en-us/banking/invoice-in-foreign-currency-and-receive-payment-in-home-currency/00/599684)
- [Foreign currency gains and losses in Xero explained (Hedgeflows)](https://blog.hedgeflows.com/foreign-currency-gains-and-losses-in-xero-explained) — Xero realized FX = issue rate vs pay rate; partial-payment handling.
- [Residual Balance Write-Off Process — Oracle Fusion Financials](https://docs.oracle.com/en/cloud/saas/financials/25b/fafrm/residual-account-balance-write-off-process.html) — residual threshold auto-write-off.
