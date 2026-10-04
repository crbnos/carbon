# Contract Exchange Rates Research: Best Practices Survey

Date: 2026-10-04. Context: the contracts spec (`.ai/specs/2026-10-02-contracts.md`) and the Phase A run log (`.ai/runs/2026-10-03-contracts-phase-a.md`, BUG-2 and the "FX" row of the self-review fixes).

## Summary

This file answers one question: if a customer contract is priced in a foreign currency, which exchange rate does each invoice, credit memo and revenue posting use? Today Carbon stores one rate on the contract (`customerContract.exchangeRate`) and uses it for every invoice and every cancellation credit for the life of the contract.

We surveyed 11 products and the accounting standards. They agree on 5 points:

1. The price stays fixed in the contract currency. Only the base amount moves with the rate.
2. Each invoice translates at the rate on its own date (invoice date or posting date), not at a contract rate.
3. A credit memo that credits an invoice takes that invoice's rate.
4. Deferred revenue releases at the rate of the invoice that funded it (the historical rate).
5. Realized FX posts when cash or a credit settles a receivable.

IAS 21, ASC 830 and IFRIC 22 require points 2 and 4. The IFRS Interpretations Committee considered one rate fixed at contract signing and rejected it. Only hedge accounting can lock a rate.

The recommendation for Carbon: draft each contract invoice at the rate on its invoice date. Draft each cancellation credit at the rate of the invoice it credits. Do not offer a per-contract locked rate in v1.

## Competitors Surveyed

- **SAP S/4HANA** (SD billing plans, Revenue Accounting and Reporting) — the enterprise reference. It has the most explicit rate controls.
- **Oracle NetSuite** (sales orders, SuiteBilling, Advanced Revenue Management) — the mid-market accounting reference. It documents the deferred revenue FX adjustment in detail.
- **Microsoft Dynamics 365 Business Central** (Subscription Billing app) — the source code is public, so its behaviour is verifiable.
- **Microsoft Dynamics 365 Finance & Operations** (Subscription billing) — it has a per-order "Fixed exchange rate" field.
- **Acumatica** (Contracts) — mid-market ERP with contract billing.
- **Odoo** (Subscriptions, Accounting) — open-source. Its credit-note rate changed between versions 17 and 18.
- **Sage Intacct** (Contracts) — it has the most explicit contract FX documentation.
- **Zuora** (Billing, Revenue) — the subscription billing reference. It has a rule for proration credits.
- **Chargebee** (Billing, RevRec) — subscription billing with a revenue module.
- **Stripe Billing** (Revenue Recognition) — the billing platform Carbon sends invoices to.
- **Maxio** (Advanced Billing) — it can float the foreign price itself.
- **Rillet** — an ERP for SaaS. It accepts an optional rate on each contract.
- **IAS 21, IFRIC 22, ASC 830, IFRS 15 / ASC 606** — the rules every product above must follow.

## Research Questions

1. Which rate does each recurring invoice use: the contract rate, the invoice-date rate, or a rate type?
2. Is the price fixed in the contract currency, with only the base translation floating?
3. Which rate does a credit memo for unused time use? Where does the FX difference go?
4. At which rate does deferred revenue release? At which rate does accrued (unbilled) revenue post?
5. Does any product offer a locked rate per contract? What is it for?
6. What do IAS 21, ASC 830 and IFRIC 22 require?

## Comparison Table

| Product | (a) Invoice rate | (b) Price fixed in foreign currency | (c) Credit memo for unused time | (d) Deferred revenue release | (e) Locked rate per contract |
|---|---|---|---|---|---|
| SAP S/4HANA | Billing date (rate type M), unless the order holds `VBKD-KURRF` | Yes (inferred) | Copies the referenced invoice's rate through copy control | RAR: actual method uses the historical rate of the liability. Fixed method uses the first event's rate | Yes: `VBKD-KURRF` on the order, or a rate on each billing plan date |
| NetSuite | Transaction date (Oracle ARM examples). A 2013 partner blog says the order rate; treat that as outdated | Yes (inferred) | A credit memo from an invoice inherits its rate. No gain or loss | ARM posts an FX reclass so billed revenue ends at the invoice rate | No. Manual rate on each transaction only |
| BC Subscription Billing | Posting date (source code) | Yes (documented) | Corrective credit memo copies the invoice's rate (source code) | Invoice rate. Deferrals store base amounts | No |
| D365 F&O Subscription billing | Invoice date of the generated order (inferred) | Yes (inferred) | Not documented | Invoice rate (consultant source) | Per sales order "Fixed exchange rate". None on the billing schedule |
| Acumatica | Rate on the document date = billing date (inferred) | Yes (inferred) | Its own date's rate. Realized FX on application (inferred) | Invoice rate. Schedules hold base amounts (inferred) | No. Override on each document |
| Odoo | `invoice_date` (source code) | Yes (inferred) | v17: credit note date. v18: copies the invoice rate | Not documented. Probably the invoice rate | No. v18 allows a manual rate on each invoice |
| Sage Intacct | Invoice posting date (documented) | Yes | Not documented | Before the invoice: contract-line rate. After the invoice: the invoice rate | Partly: the contract-line rate applies to Unbilled accounts only |
| Zuora | Earlier of invoice date and posted date | Yes (inferred) | From an invoice: the invoice's rate. Rule "Use Original Exchange Rate For Credits" sets each proration credit item to its own invoice's rate | The funding invoice's rate | No |
| Chargebee | Not documented (billing). RevRec: contract date or invoice date | Yes. A price point for each currency | RevRec reverses at the contract-date rate | Contract-date rate. One KB article says the invoice date. The two sources disagree | No. Uploaded rates take precedence |
| Stripe | Estimated rate at finalization. Payment uses the real settlement rate | Yes. A subscription's currency cannot change | Not documented | The billing rate. "No translation during amortization" | No. FX Quotes lock a rate for 24 h, for payments only |
| Maxio | Not documented | Definitive pricing: yes. Exchange-rate pricing: the foreign price floats | Not documented | Not documented | A custom rate for each currency, not for each subscription |
| Rillet | Transaction date (blog) | Not documented (inferred: yes) | API takes an optional `exchange_rate` and `invoice_id`. Default not documented | Not documented | Yes. Optional `exchange_rate` on each contract. Its effect on invoices is not documented |

## Key Consensus Patterns

### 1. The price is fixed in the contract currency; the base amount floats

- **SAP**: the condition values on the contract are in document currency. `KURRF` only translates them to local currency.
- **Business Central**: "In the contract, the Amount and not the Amount (MW) is used for invoicing." The "Update exchange rates" action changes only the base-currency fields.
- **Stripe**: a subscription's currency cannot change. The amount is in the presentment currency.
- **Maxio**: "definitive pricing … does not move with the market". Term subscriptions must use it.
- **Rationale**: the customer signed for an amount in its currency. The seller carries the FX risk, and its base revenue moves with the rate.

### 2. Each invoice translates at the rate on its own date

- **SAP**: the default `KURRF` is the billing date's rate (rate type M). A fixed rate applies only if someone enters one.
- **NetSuite**: "The default exchange rate for a transaction is based on the currency … and the transaction date." Oracle's ARM example bills a sales order at 1.10 with an invoice at 1.2.
- **Business Central**: the billing run validates the currency, and `UpdateCurrencyFactor` uses the posting date.
- **Sage Intacct**: "Invoices generated from the contract line use the exchange rate associated with the invoice posting date."
- **Zuora**: the rate date is the earlier of the invoice date and the posted date.
- **Odoo, Acumatica**: the invoice date (source code and docs).
- **Rationale**: IAS 21.21 and ASC 830-20-30-1 record each transaction at the spot rate on its own date (see the accounting rules below).

### 3. A credit memo for an invoice takes that invoice's rate

- **NetSuite**: "When you create a credit memo from an invoice, the credit memo inherits the exchange rate from the invoice. No gain or loss is generated." A standalone credit memo applied to an invoice at another rate generates realized FX.
- **SAP**: copy control copies `KURRF` from the reference invoice into the credit memo request (community answers citing SAP notes 36070 and 1481238).
- **Zuora**: "Credit memos require a reference to the invoice exchange rates … as the credit memos draw down from the invoice balance." For a cancellation, the proration credit gives each item its own invoice's rate.
- **Business Central, Odoo 18**: the corrective credit memo and the reversal copy the invoice's rate.
- **Exceptions**: Acumatica and Odoo 17 use the credit memo's own date. They then post realized FX when the memo is applied.
- **Rationale**: the credit reverses part of one invoice. At the same rate, the receivable and the deferred revenue come off at the amounts they went on. No FX is created by the credit itself.

### 4. Deferred revenue releases at the funding invoice's rate

- **SAP RAR (actual method)**: "If a revenue accounting contract has deferred revenue or a contract liability balance, revenue will be recognized at the average rate of historical liability." With no liability, revenue uses the spot rate on the run date.
- **NetSuite ARM**: a monthly reclass posts Overlap × (effective billing rate − effective revenue rate). After it, the billed part of revenue sits at the invoice rate.
- **Business Central**: the deferral stores the invoice line's base amount. The release posts that stored amount.
- **Zuora**: a revenue schedule from an invoice uses the invoice's rate date.
- **Stripe**: "Revenue Recognition doesn't translate during a transaction's amortization schedule."
- **Sage Intacct**: before the invoice, revenue uses the contract-line rate. After the invoice, it uses the invoice rate.
- **Exception**: Chargebee RevRec uses the contract-date rate, and posts the difference from the invoice rate as a revenue adjustment.
- **Rationale**: IFRIC 22.8. The contract liability is non-monetary. Revenue from it keeps the rate of the date the liability was first recorded.

### 5. Realized FX posts at settlement

- **SAP**: FI posts exchange differences to the OB09 accounts when a payment clears the invoice.
- **NetSuite**: "The variance occurs when the exchange rate on the source transaction differs from the exchange rate on the payment."
- **Zuora**: realized FX posts on payment, on credit memo application and on refund. Unrealized FX posts on open AR at period end and reverses in the next period.
- **Business Central**: posts realized gain or loss at payment and reverses any unrealized adjustment.
- **Rationale**: IAS 21.28 and ASC 830-20-40-1.

### 6. A locked rate is an exception, not a contract feature

- **SAP**: `VBKD-KURRF` on the order or a rate on a billing plan date fixes the rate for every invoice. The sources do not state a purpose. A customer-agreed or hedged rate is the likely reason (inferred).
- **D365 F&O**: "Fixed exchange rate" on a sales order or sales agreement, for each order.
- **Rillet**: an optional `exchange_rate` on each contract. The docs do not say if invoices use it.
- **Maxio**: a custom rate for each currency, so prices stay the same "as subscriptions renew each month".
- **No lock**: NetSuite, Business Central, Acumatica, Odoo, Zuora, Chargebee and Stripe.
- **Rationale**: a locked rate keeps base revenue stable. But it books the GL at a non-spot rate, which IAS 21 does not allow without hedge accounting (see below).

## Accounting Rules

| Rule | What it says | Effect on contracts |
|---|---|---|
| IAS 21.21–22, ASC 830-20-30-1 | Record a transaction at the spot rate on its date. The date is when it first qualifies for recognition | Each invoice uses the rate on its own date |
| IAS 21.22, ASC 830-10-55-10/11 | An average rate for a week or a month is allowed, unless rates move significantly. ASC weights the average by volume | Accrued revenue may use a monthly average rate |
| IAS 21.23, 28; ASC 830-20-35-1/2 | Remeasure monetary items at the closing rate. Differences go to profit or loss. Non-monetary items stay at the historical rate | AR is monetary. Deferred revenue is not |
| IFRIC 22.2, IE6; KPMG 3.050; Deloitte 4.8 | A contract liability (deferred revenue) is non-monetary | Do not remeasure deferred revenue |
| KPMG 3.050; Deloitte 4.8 (US GAAP) | A contract asset is "generally monetary". IFRS leaves it to judgement (IFRIC 22 BC16–17) | Under US GAAP, remeasure a contract asset like a receivable |
| IFRIC 22.8–9 | Revenue from advance consideration uses the date the non-monetary liability was first recorded. Each advance payment has its own date | Release each invoice's deferral at that invoice's rate |
| IFRS 15.106; IFRIC 22 fn 1; staff paper AP7B §44–47 | An advance invoice with an unconditional receivable records the contract liability when payment is due. IFRIC 22 applies | The advance invoice's rate fixes its deferral. The receivable is remeasured until paid |
| IFRS 15 IE198–200, ASC 606-10-55-284 to 286 | An invoice the customer can still cancel creates no receivable. The IFRIC 22 date is when cash arrives | Edge case. Carbon posts AR at invoice posting, so this does not apply |
| IFRIC 22 IE14 | Services over time: "the dates of the transaction are each day in the period" | Accrued revenue uses the run-period rate |
| Staff paper AP14 §28, §58(a) | A rate fixed at contract signing ("View A") "is not appropriate". No respondent supported it | A per-contract locked rate is not IAS 21 compliant |
| IFRS 9.6.5.4; ASC 815 (KPMG 5.027) | A firm commitment's FX risk may be hedged (fair value or cash flow hedge) | Hedge accounting is the only compliant way to "lock" a rate |
| KPMG 3.043, 3.050a; Deloitte 4.7, 4.15 | A refund liability is monetary. If the entity will refund instead of perform, the deferred revenue becomes monetary | A cancellation moves the cancelled part from historical rate to current rate |
| ASC 830-20-40-1; IAS 21.28–29 | Settlement gains and losses go to net income | Realized FX on payment |

**Cancellation credit (inference, no Big 4 example found).** On the credit date, the cancelled part of the deferred revenue comes off at its historical rate. The receivable comes off at its carrying amount. The difference goes to FX gain or loss, never to revenue. If the receivable was never remeasured, its carrying amount is still the invoice rate. Then a credit at the invoice's rate produces no difference.

**Translation is a different step.** When a subsidiary's statements are translated into a presentation currency, all liabilities use the closing rate (IAS 21.39, ASC 830-30-45-3). That step is `translateTrialBalance`, not document posting.

## Carbon Code Facts

### The rate store

- `get_exchange_rate(p_company_id, p_currency_code, p_as_of DATE DEFAULT NULL)` (migration `20260903015941_exchange-rate-global-store.sql`) resolves a rate in this order:
  1. The base currency returns 1.
  2. An `exchangeRateOverride` row for the company and currency wins. The override has no date, so it is a standing pin for every date.
  3. Otherwise, the function divides the latest global `exchangeRate` row on or before `p_as_of` by the base currency's row. Both rows are units per 1 USD.
  4. If no row exists, it raises an error. It never falls back to 1.
- `p_as_of` defaults to `CURRENT_DATE`, which is the UTC day.
- ERP `getExchangeRate(client, companyId, currencyCode)` (`accounting.service.ts`) passes no date. So every caller in the app gets today's rate.

### Sales documents store the base price

- `salesInvoiceLine.unitPrice` is the base price. `convertedUnitPrice` is `GENERATED ALWAYS AS ("unitPrice" * "exchangeRate")`, the price the customer sees. Sales orders and quotes use the same model.
- Trigger `update_sales_invoice_line_exchange_rate` (migration `20260903020352`) copies a header rate change to every line.
- Route `x+/sales-invoice+/$invoiceId.exchange-rate.tsx` refreshes a draft invoice to today's rate. The base `unitPrice` stays. So the refresh changes the amount the customer is billed in the foreign currency. This is the opposite of pattern 1.
- `convert` (`salesOrderToSalesInvoice`, `shipmentToSalesInvoice`) copies `order.exchangeRate` onto the invoice. A sales order invoice therefore uses the order's rate, not the invoice-date rate. `quoteToSalesOrder` copies the quote's rate. `salesRfqToQuote` reads today's rate.
- `post-sales-invoice` posts at `invoiceHeader.exchangeRate`. It never re-reads the rate at posting. Its `postingDate` is today.

### Contracts today

- `customerContract.exchangeRate NUMERIC NOT NULL DEFAULT 1` (migration `20261004014555_contracts.sql`). `x+/contract+/new.tsx` sets it to today's rate at creation (the BUG-2 fix). `x+/contract+/update.tsx` reads today's rate again when the currency changes.
- `create-contract-invoices` drafts each invoice with:
  - `unitPrice = toBaseAmount(contract price, contract.exchangeRate)`;
  - header and line `exchangeRate = contract.exchangeRate`;
  - `dateIssued = asOf`.
  So every invoice of a multi-year contract uses the rate of the day the contract was created.
- The cancellation in `post-customer-contract` drafts one credit memo with `exchangeRate = contract.exchangeRate`, `memoDate = asOf` and `amount` in the contract currency.
- `post-memo` books the memo at `toBaseAmount(amount, memo.exchangeRate)`. `releaseContractDeferral` converts each adjustment row at the memo's rate. It then releases that base amount from the funding invoice line's `revenueRecognitionSchedule` Deferral rows, which hold base amounts. The part it cannot release (`fromRevenue = magnitude − released`) debits revenue. Today the two rates are equal, so the amounts match.

### FX settlement and remeasurement

- Payment application realizes FX for each application. `calculateSettlementFx` (`@carbon/database/accounting-currency`) compares the source's carrying base with the applied base. `build-payment-journal` posts to `realizedExchangeGainAccount` / `realizedExchangeLossAccount`.
- A posted credit memo reaches its invoice through a zero-cash payment's credit settlement. So the same settlement path realizes any FX between the memo and the invoice.
- `build-memo-journal`: "A memo is a single-currency document booked at its own exchange rate, so there is no realized FX at post time."
- No code in `packages/server-functions`, `packages/jobs` or `packages/database/src` posts period-end unrealized FX. The journal source type `Revaluation` exists as an enum value only. So open AR stays at its invoice rate until it settles.

### The spec's "rental model" reference has no implementation

The spec says contract revenue uses "the same translation rule the rental model uses". `post-rental-agreement` refuses to activate a foreign-currency agreement ("Rental agreements in a foreign currency are not supported yet"). `synthesizeRentalAccruals` says its amounts are base because of that guard. So no rental translation rule exists to copy.

## Answers to Research Questions

1. **Invoice rate.** The rate on the invoice's own date is the default in SAP, NetSuite, Business Central, Sage Intacct, Zuora, Odoo and Acumatica. A contract or order rate applies only when someone fixes it (SAP `KURRF`, F&O "Fixed exchange rate"). IAS 21.21 requires the transaction-date rate.
2. **Price fixed in foreign currency.** Yes, in every product. Maxio's exchange-rate pricing is the only mode where the foreign price floats. In Carbon, the drafter holds the contract-currency price fixed. But a draft invoice's rate refresh holds the base fixed instead.
3. **Credit memo rate.** The credited invoice's rate in NetSuite, SAP, Zuora, Business Central and Odoo 18. The credit date's rate in Acumatica and Odoo 17, with realized FX on application. Chargebee RevRec reverses at the contract-date rate. The FX difference goes to FX gain or loss, never to revenue.
4. **Deferred and accrued revenue.** Deferred revenue releases at the funding invoice's rate (IFRIC 22.8; SAP RAR, NetSuite ARM, Business Central, Zuora, Stripe, Sage Intacct). Accrued revenue posts at the spot or average rate of the revenue period (SAP RAR, Sage Intacct uses the contract-line rate). Under US GAAP, the contract asset is monetary and is remeasured.
5. **Locked rate.** SAP and D365 F&O offer it on the order. Rillet offers an optional contract rate. Maxio offers a rate for each currency. Seven of the 11 products offer none. Hedge accounting is the only IAS 21 / ASC 830 compliant way to lock a rate.
6. **Standards.** See the accounting rules table. Two points have no free Big 4 text: contract assets under IFRS, and the FX entry for a cancellation credit. Both are marked as inference.

## Competitor-Specific Details

### SAP S/4HANA

- A billing document has 3 rates: `VBRK-KURRF` (FI posting), `VBRP-KURSK` (pricing) and `KOMV-KKURS` (condition currency). `KURRF` defaults to the billing date's rate type M rate if `VBKD-KURRF` on the order is empty.
- A billing plan date can hold its own rate. It wins over the item's fixed rate.
- RAR offers 2 methods for each accounting principle. The fixed method takes the first event's rate for every later event and posts the difference to an exchange difference account. The actual method releases deferred revenue at the weighted average historical rate of the liability. A contract migrated on the fixed method cannot switch.
- S/4HANA Cloud event-based revenue recognition uses the first day of the reporting period as the conversion date.
- SAP Subscription Billing and Convergent Invoicing: no specific source. FI-CA uses the posting date (inferred).

### NetSuite

- ARM's deferred revenue reclass formula: Overlap × (effective billing FX rate − effective revenue FX rate) − prior adjustments. The overlap is the lesser of cumulative billing and cumulative recognition. The revenue side posts to the item's "Foreign Currency Adjustment Account".
- Preference "Exclude Contract Assets From FX Reclassification": if clear, ARM revalues the contract asset at the period-end rate.
- On the purchasing side, "Default Receiving Exchange Rate" offers "Use Purchase Order Exchange Rate" or "Use Exchange Rate at the Time of the Receipt". No matching preference exists for sales invoices.

### Business Central Subscription Billing

- Subscription lines store `Currency Factor` and `Currency Factor Date`. They feed only the base-currency fields.
- Changing the posting date asks "Do you want to update the exchange rate?".
- "Create Corrective Credit Memo" credits only the last contract invoice. Ending a contract line stops future billing. No automatic credit for unused time exists.
- The credit memo copies the invoice's deferrals with a minus sign.

### D365 F&O Subscription billing

- Terminate offers "Credit adjustment" (nets against future bills) or "Issue credit" (credit note). A credit note can "Adjust existing schedule".
- Deferral recognition runs only in accounting currency. A consultant reports residual balances in transaction currency, and a top-voted product idea asks Microsoft to fix it.

### Sage Intacct Contracts

- The contract has an exchange rate type. Each contract line has an "Exchange rate date" (default: the GL posting date, never in the future).
- The contract-line rate governs Unbilled accounts and forecast reports. The invoice rate governs Billed and Paid accounts. A revenue month with several invoices splits into several postings.
- Intacct suggests a custom rate type for a "negotiated contract exchange rate" (inferred workaround).

### Zuora

- Rule "Use Original Exchange Rate For Credits?": a cancellation's proration credit finds each invoice of the subscription and gives each credit item its own invoice's rate. The header rate stays blank if the items differ.
- Unrealized FX runs at period end on open AR, unapplied payments and unapplied credit memos, and reverses next period.
- `RatePlanCharge.BookingExchangeRate` uses the original order date, for MRR and TCV metrics only.

### Chargebee

- Billing stores `exchange_rate` on each invoice. The capture date is not documented.
- RevRec documents two answers for multi-invoice contracts: contract-date rate with revenue adjustments, and (KB example) invoice-date rate.

### Stripe

- With a functional currency set, Stripe uses a mid-market rate "at billing" for revenue. Payment uses the real settlement rate. The difference posts to FxLoss.

### Maxio

- Exchange-rate pricing floats the foreign price with hourly rates, or holds it with a custom rate for each currency.

### Rillet

- The `ExchangeRate` object `{base, target, rate, date}` appears on Contract, Invoice, CreditMemo and JournalEntry.
- ARR metrics hold a "constant rate" from the customer's first contract and show the rest in an "FX Impact" column.

## Recommended Approach for Carbon

### 1. Default: each contract invoice uses the rate on its invoice date

`create-contract-invoices` reads `get_exchange_rate(companyId, currencyCode, asOf)` once for each drafted invoice. It then:

1. sets the header and line `exchangeRate` to that rate;
2. sets `unitPrice = toBaseAmount(contract price, that rate)`;
3. keeps the contract-currency price exactly as the contract states it.

This follows SAP, NetSuite, Business Central, Sage Intacct and Zuora, and IAS 21.21. Use `asOf` (the company-timezone day the drafter receives), not the RPC's UTC default. One read for each invoice is not N+1 if the drafter reads the rate once for each (currency, `asOf`) pair. The daily job drafts all invoices for one `asOf`.

`customerContract.exchangeRate` stays. It becomes the contract's **reference rate**: it converts contract totals to base on the contract page and in the revenue forecast, as Sage Intacct uses its contract-line rate for forecasts. It no longer drives invoices.

Note: a company with an `exchangeRateOverride` row gets the override on every date. For that currency, every contract invoice already uses one fixed rate. This is the company-wide, per-currency lock that Maxio offers.

### 2. A draft contract invoice must keep its contract-currency price when its rate changes

The draft invoice rate refresh keeps `unitPrice` (base) and changes `convertedUnitPrice`. On a contract invoice, that changes what the customer is billed. Choose one of two fixes (open question 4):

- Refuse the rate refresh on an invoice with `customerContractId`.
- Or, on a contract invoice, recompute `unitPrice` from the contract-currency price at the new rate.

### 3. Do not offer a per-contract locked rate in v1

Reasons:

1. Seven of the 11 products offer no lock. The 4 that do (SAP, D365 F&O, Rillet, Maxio) put it on an order, an optional API field, or a currency.
2. The IFRS Interpretations Committee rejected a rate fixed at contract signing (AP14 §58(a)). A lock books the GL at a non-spot rate. Only hedge accounting (IFRS 9.6.5.4, ASC 815) supports a locked economic rate, and Carbon has no hedge accounting.
3. A company that needs one rate can set an `exchangeRateOverride` for the currency. A user can also change the rate on one draft invoice.

If a customer later needs a lock, add an explicit opt-in flag on the contract. The drafter then uses `customerContract.exchangeRate` instead of the invoice-date rate. Show the flag with a warning that the GL uses a non-spot rate.

### 4. Cancellation credits use the rate of the invoice they credit

Draft the credit memo at the `exchangeRate` of the sales invoice that billed the cancelled period. This follows NetSuite ("inherits the exchange rate from the invoice. No gain or loss is generated"), SAP copy control, Zuora's per-item rule, Business Central and Odoo 18. Effects:

1. `releaseContractDeferral` converts the adjustment at the same rate that built the Deferral rows. So the release equals the deferred base exactly, and nothing leaks into revenue through `fromRevenue`.
2. The memo relieves AR at the invoice's carrying amount. Carbon does not remeasure AR, so this matches the IAS 21 entry (inference above) with zero FX difference.
3. If the memo is applied to another invoice or refunded, the existing settlement path realizes the FX.

A cancellation can credit periods from more than one invoice. A `memo` has one header rate and no lines. So draft **one credit memo for each credited invoice**, each at that invoice's rate. Zuora does the same at item level. In the common case (cancel inside the current advance period) this is one memo. The alternative is one memo at the credit date's rate plus an FX leg in `post-memo` (Acumatica, Odoo 17); see open question 5.

🛑 Do not keep `exchangeRate = contract.exchangeRate` on the memo after invoices change to invoice-date rates. The memo's base would then differ from the Deferral rows' base. `releaseContractDeferral` would put the difference into revenue (`fromRevenue`) or leave a deferred residual.

### 5. Amendment adjustments on a later invoice need an FX leg

An amendment can put a negative adjustment line for an already-billed period on a later invoice. That later invoice has a newer rate. The line must release the deferral at the funding invoice's base, as IFRIC 22.8 requires. The line's own base is at the new rate. Post the difference to the realized FX gain or loss account, never to revenue or deferred revenue. A positive adjustment for a billed period has no deferral to release. It funds a new deferral at its own invoice's rate, so it needs no FX leg.

### 6. Phase B revenue posting

1. **Deferred release.** Release each funding invoice's deferral at that invoice's base amounts (IFRIC 22.8). Carbon already stores the Deferral rows in base for each `salesInvoiceLineId`. So release them in the order of the invoices that funded them (oldest first), not at a blended rate. SAP RAR's weighted average is the alternative (open question 7).
2. **Accrual (contract asset).** Post accrued revenue at the run date's rate, or the period's average rate (IAS 21.22, IFRIC 22 IE14). This matches the spec.
3. **Clearing the accrual at invoice posting.** The invoice credits Contract Assets at the accrual's carried base for the foreign amount it covers. The invoice debits AR at its own rate. Post the difference to the FX gain or loss account, never to revenue. Sage Intacct and NetSuite ARM produce the same result.
4. **Track both currencies.** The contract position for each line keeps deferred and accrued balances in the contract currency and in base. Without both, item 3 cannot find the carried base.
5. **Remeasurement.** Keep FX remeasurement of contract balances out of v1, as the spec says. This matches Carbon's AR, which is also not remeasured. Under US GAAP a contract asset is monetary (KPMG 3.050, Deloitte 4.8), so a later AR revaluation feature must include it. Deferred revenue is non-monetary and is never remeasured.

### 7. Fix the spec text

Replace "the same translation rule the rental model uses" in the contracts spec. Rentals refuse foreign currency, so no such rule exists. State the rules of sections 1, 4, 5 and 6 directly.

### 8. Leave sales order invoicing as it is, for now

`convert` copies the order's rate onto the invoice. That differs from NetSuite and Business Central, which re-rate at the invoice date. Changing it touches every sales order flow. It is out of scope for contracts (open question 8).

## Open Questions

1. **Default rate.** Do contract invoices change to the invoice-date rate (recommended), or keep the contract rate?
2. **Locked rate.** Is "no per-contract lock in v1; `exchangeRateOverride` covers a company-wide lock" acceptable? Or is an opt-in flag on the contract needed now?
3. **Rate date.** Use the invoice's `dateIssued` (the drafting `asOf`, recommended)? Or re-read the rate when a draft posts on a later day? Carbon stamps the rate at creation today. Business Central and Sage Intacct use the posting date.
4. **Rate refresh on a contract invoice.** Refuse it, or recompute the base price from the contract-currency price?
5. **Cancellation across several invoices.** One credit memo for each credited invoice at its rate (recommended)? Or one memo at the credit date's rate with an FX leg in `post-memo`?
6. **FX account.** Post the FX difference from adjustments and accrual clearing to `realizedExchangeGainAccount` / `realizedExchangeLossAccount`? Or to a separate account, like NetSuite's "Foreign Currency Adjustment Account"?
7. **Deferred release order.** Release by funding invoice, oldest first (recommended)? Or at SAP RAR's weighted average historical rate?
8. **Sales order invoices.** Keep copying the order's rate, or open a separate change to use the invoice-date rate for every sales invoice?

## Sources

SAP S/4HANA
- https://www.stechies.com/determine-different-exchange-rates-billing-documents/
- https://community.sap.com/t5/enterprise-resource-planning-q-a/kurrf-field-in-sales-order-billing-sap-sd/qaq-p/12544967
- https://community.sap.com/t5/enterprise-resource-planning-q-a/fixed-exchange-rate-in-billing-vf01/qaq-p/12656304
- https://www.gotothings.com/sd/exchange-rate-controlled-in-billing-document.htm
- https://help.sap.com/doc/4a1db853dcfcb44ce10000000a174cb4/700_SFIN20%20006/en-US/b46fb6535fe6b74ce10000000a174cb4.html
- https://userapps.support.sap.com/sap/support/knowledge/en/3245479
- https://learning.sap.com/courses/implementing-sap-financial-contract-accounting/describing-foreign-currency-valuation
- https://blogs.sap.com/2015/06/03/deriving-the-translation-date-from-document-date-step-by-step/
- https://community.sap.com/t5/enterprise-resource-planning-q-a/exchange-rate-in-credit-note/qaq-p/4585960
- https://community.sap.com/t5/enterprise-resource-planning-q-a/exchange-rate-in-the-billing-document/qaq-p/8755038
- https://help.sap.com/doc/03e837f44b9d45ab801051d0998a1a7b/1.3.3/en-us/loio2370015342d8a62fe10000000a4450e5_en.pdf
- https://community.sap.com/t5/financial-management-blog-posts-by-members/foreign-currency-contracts-in-rar/ba-p/14372928
- https://erpcommunity.com/groups/sap/articles/sap-rar-foreign-exchange-rate-processing
- https://community.sap.com/t5/financial-management-blog-posts-by-sap/ebrr-currency-conversion-with-spot-rate-in-s-4hana-cloud-public-edition/ba-p/14176088
- https://community.sap.com/t5/financial-management-q-a/exchange-rate-difference-postings-at-payment-time-additional-6680-7680/qaq-p/14290745

Oracle NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1404249.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_N1398658.html
- https://blog.prolecto.com/2013/04/17/netsuite-foreign-currency-transaction-application-considerations/
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_161369441792.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_1006020312.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2415572.html
- https://www.houseblend.io/articles/netsuite-suitebilling-setup-usage-based-billing
- https://www.houseblend.io/articles/netsuite-multi-currency-usd-cad
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_N1428017.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1498263039.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4370936348.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3811805482.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157238786981.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159467246461.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1385293.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1704597.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1425327.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1425486.html

Microsoft Dynamics 365 Business Central
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/sales/dealing-with-currencies
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/setup/import
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/sales/credit-memo-cancellation
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/working-with-contracts/contract-deferrals
- https://learn.microsoft.com/en-us/dynamics365/business-central/finance-currencies
- https://yzhums.com/58019/
- https://github.com/microsoft/BCApps/tree/main/src/Apps/W1/Subscription%20Billing/App
- https://github.com/StefanMaron/MSDyn365BC.Code.History

Microsoft Dynamics 365 Finance & Operations
- https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/sb-generate-invoice
- https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/sb-billing-schedules
- https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/terminate-billing-schedule
- https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/sb-deferral-transactions
- https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/revenue-recognition-recognize-deferred-revenue
- https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/dual-currency
- https://learn.microsoft.com/en-us/business-applications-release-notes/April19/dynamics365-finance-operations/new-fixed-exrate
- https://erconsult.eu/blog/deferred-revenue-in-foreign-currency-closing-the-gap-in-d365/
- https://community.dynamics.com/forums/thread/details/?threadid=eac25d84-2878-4fa8-bc24-6fad9139229a
- https://www.dynamicsuser.net/t/sales-order-header-fixed-exchange-rate-field/36151

Acumatica
- https://help.acumatica.com/Wiki/ShowWiki.aspx?wikiname=HelpRoot_ContractManagement&PageID=6903de70-0d3b-4e9c-a88d-b2a24d65aa7f
- https://help.acumatica.com/Wiki/ShowWiki.aspx?wikiname=HelpRoot_FormReference&PageID=1d443263-e802-4d25-a166-d08fb31fea9b
- https://help.acumatica.com/Wiki/ShowWiki.aspx?wikiname=HelpRoot_CurrencyManagement&PageID=ab812c9e-e0df-4c7b-a81b-7b8e5f5c5553
- https://help.acumatica.com/Wiki/ShowWiki.aspx?pageid=b3794b18-1ee7-4526-9d72-1c338f228b5d
- https://help.acumatica.com/(W(24))/Wiki/ShowWiki.aspx?pageid=fce5bf02-bdfc-46d6-96cc-3d7ad15f9820
- https://help.acumatica.com/Wiki/ShowWiki.aspx?wikiname=HelpRoot_FormReference&PageID=c8f8d907-8dd6-47a7-a13d-be9251d361e9

Odoo
- https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py
- https://github.com/odoo/odoo/blob/18.0/addons/account/wizard/account_move_reversal.py
- https://github.com/odoo/odoo/blob/17.0/addons/account/wizard/account_move_reversal.py
- https://github.com/odoo/odoo/blob/17.0/addons/account/models/account_move_line.py
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/deferred_revenues.html
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started/multi_currency.html

Sage Intacct
- https://www.intacct.com/ia/docs/en_US/help_action/Contracts/Using_Contracts/Learn_about/exchange-rate-dates.htm
- https://www.intacct.com/ia/docs/en_US/help_action/Contracts/Using_Contracts/Contracts/Contract_lines/contract-line-fbf.htm
- https://www.intacct.com/ia/docs/en_US/help_action/Contracts/Using_Contracts/Revenue/Revenue_schedules/revenue-schedule.htm
- https://www.intacct.com/ia/docs/en_US/help_action/Contracts/Using_Contracts/Contracts/Cancel_a_contract/cancel-a-contract-or-line.htm
- https://www.intacct.com/ia/docs/en_US/help_action/Contracts/Using_Contracts/Contracts/Cancel_a_contract/cancel-fbf.htm
- https://developer.intacct.com/api/contracts-rev-mgmt/contracts/
- https://www.intacct.com/ia/docs/en_US/help_action/Company/Currencies_and_exchange_rates/Exchange_rate_types/exchange-rates-and-exchange-rate-types-overview.htm
- https://www.intacct.com/ia/docs/en_US/help_action/Company/Currencies_and_exchange_rates/Currencies/foreign-currency-revaluation-overview.htm

Zuora
- https://docs.zuora.com/en/accounts-receivable/finance/zuora-finance-settings/foreign-currency-conversion
- https://docs.zuora.com/en/accounts-receivable/finance/zuora-finance-settings/foreign-currency-conversion-for-data-source-exports/values-for-the-foreign-currency-conversion-fields
- https://docs.zuora.com/en/accounts-receivable/finance/zuora-finance-settings/foreign-currency-conversion/exchange-rates-for-proration-credits
- https://docs.zuora.com/en/accounts-receivable/finance/zuora-finance-settings/foreign-currency-conversion-for-data-source-exports
- https://docs.zuora.com/en/accounts-receivable/finance/zuora-finance-settings/foreign-currency-conversion-for-data-source-exports/currency-conversion-fields-added-to-the-export
- https://docs.zuora.com/en/accounts-receivable/finance/zuora-finance-settings/foreign-currency-conversion/configure-foreign-currency-conversion/manage-currency-conversion-fields
- https://docs.zuora.com/en/accounts-receivable/finance/accounting-periods/view-accounting-period-balances/foreign-currency-gains-and-losses-journal-entries
- https://docs.zuora.com/en/accounts-receivable/finance/accounting-periods/view-accounting-period-balances/the-fx-gainloss-journal-entry-behavior
- https://docs.zuora.com/en/zuora-revenue/advanced-revenue-operations/mapping-between-zuora-billing-and-zuora-revenue/currency-mapping
- https://docs.zuora.com/en/zuora-revenue/advanced-revenue-operations/sync-currency-exchange-rate-for-billing-documents
- https://docs.zuora.com/en/zuora-revenue/advanced-revenue-operations/sync-currency-exchange-rate-for-billing-documents/sync-currency-exchange-rate-examples
- https://docs.zuora.com/en/zuora-revenue/month-end-process/multi-currency-contracts
- https://docs.zuora.com/en/zuora-revenue/month-end-process/multi-currency-contracts/impact-of-linking-and-delinking

Chargebee
- https://www.chargebee.com/docs/revrec/multi-currency/multi-currency
- https://www.chargebee.com/docs/revrec/kb/revrec/how-is-foreign-currency-contract-transactions-work-in-revrec
- https://www.chargebee.com/docs/billing/2.0/site-configuration/multi-currency-pricing
- https://apidocs.chargebee.com/docs/api/invoices
- https://apidocs.chargebee.com/docs/api/currencies
- https://www.chargebee.com/docs/billing/2.0/kb/reports-and-analytics/how-exchange-rates-affect-revenuestory-metrics-over-time

Stripe
- https://docs.stripe.com/revenue-recognition/methodology/multi-currency
- https://docs.stripe.com/revenue-recognition/revenue-settings
- https://docs.stripe.com/revenue-recognition/revenue-settings/examples
- https://docs.stripe.com/revenue-recognition/methodology
- https://docs.stripe.com/invoicing/multi-currency-customers
- https://support.stripe.com/questions/setting-a-customers-default-currency

Maxio
- https://docs.maxio.com/hc/en-us/articles/24286716475661-Multi-Currency-in-Advanced-Billing
- https://docs.maxio.com/hc/en-us/articles/24181321612557-Configure-Currencies
- https://docs.maxio.com/billing/subscriptions/configuration/term-renewal/term-subscriptions
- https://docs.maxio.com/accounting/general-ledger-integrations/quickbooks/overview/quickbooks-integration-overview
- https://www.maxio.com/resources/product-release-enterprise-ready-2

Rillet
- https://info.rillet.com/how-rillet-works-saas-metrics
- https://info.rillet.com/arr-nrr-mrr-from-the-general-ledger
- https://www.rillet.com/blog/multi-currency-accounting-guide
- https://www.rillet.com/blog/automate-currency-conversion-close-process
- https://www.rillet.com/blog/multi-entity-multi-currency-erp-global-expansion
- https://docs.api.rillet.com/v2.0/reference/create-a-credit-memo.md
- https://docs.api.rillet.com/v2.0/reference/create-a-contract-1.md

Accounting standards
- https://www.efrag.org/system/files/sites/webpublishing/Project%20Documents/334/IASB%20IFRIC%2022.pdf
- https://www.icab.org.bd/icabadmin/uploads/ckeditor/5954IAS_21_2017.pdf
- https://www.ifrs.org/content/dam/ifrs/project/foreign-currency-transactions/draft-interpretation/published-documents/di-foreign-currency-transactions.pdf
- https://www.ifrs.org/content/dam/ifrs/meetings/2014/november/ifrs-ic/ias-21-the-effects-of-changes-in-foreign-exchange/ap14-foreign-currency-translation-of-revenue.pdf
- https://www.ifrs.org/content/dam/ifrs/meetings/2015/january/ifrs-ic/ias-21-the-effects-of-changes-in-foreign-exchange-rates/ap5-revenue-transaction-denominated-in-foreign-currency.pdf
- https://www.ifrs.org/content/dam/ifrs/meetings/2016/may/ifrs-ic/ias-21-foreign-exchange-rates/ap7a-foreign-currency-transactions.pdf
- https://www.ifrs.org/content/dam/ifrs/meetings/2016/may/ifrs-ic/ias-21-foreign-exchange-rates/ap7b-foreign-currency-transactions-analysis.pdf
- https://kpmg.com/kpmg-us/content/dam/kpmg/frv/pdf/2024/handbook-foreign-currency.pdf
- https://assets.kpmg.com/content/dam/kpmgsites/xx/pdf/ifrg/2025/isg-handbook-2025-ifrs-compared-to-us-gaap.pdf
- https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc830-10/roadmap-foreign-currency-transactions-translations/chapter-4-foreign-currency-transactions/4-8-contract-assets-contract-liabilities
- https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc830-10/roadmap-foreign-currency-transactions-translations/chapter-4-foreign-currency-transactions/4-7-refundable-deposits-advances
- https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc830-10/roadmap-foreign-currency-transactions-translations/chapter-4-foreign-currency-transactions/4-15-sales-with-a-right
- https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc830-10/roadmap-foreign-currency-transactions-translations/chapter-4-foreign-currency-transactions/4-2-initial-measurement-foreign-currency
- https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc830-10/roadmap-foreign-currency-transactions-translations/chapter-4-foreign-currency-transactions/4-3-subsequent-measurement-foreign-currency
- https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc830-10/roadmap-foreign-currency-transactions-translations/chapter-3-exchange-rates/3-2-selecting-exchange-rates
- https://dart.deloitte.com/USDART/home/codification/revenue/asc606-10/roadmap-revenue-recognition/chapter-14-presentation/14-2-contract-liabilities
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/foreign_currency/foreign_currency__2_US/chapter_4_foreign_cu_US/49_deferred_revenue_US.html
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/foreign_currency/foreign_currency__2_US/chapter_5_translatin_US/55_exchange_rates_US.html
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/financial_statement_/financial_statement___18_US/chapter_21_foreign_c_US/213_transaction_gain_US.html
