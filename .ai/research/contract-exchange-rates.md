# Contract Exchange Rates Research: Best Practices Survey

## Summary

The question: an AR contract is priced in a foreign currency. Today Carbon stores one exchange rate on the contract (`customerContract.exchangeRate`) and every drafted invoice and cancellation credit uses it for the whole life of the contract. This survey asks whether each invoice should translate at its own date's rate instead, and what credits, deferred revenue and accruals should use. The consensus is clear. The price stays fixed in the contract currency. Each invoice translates at the rate on its own date. A credit for an invoiced period uses that invoice's rate. Deferred revenue is released at the rate of the invoice that funded it. Revenue earned before it is billed uses the rate on the day it is earned. The accounting standards require the same (IAS 21, ASC 830, IFRIC 22). A rate locked for the whole contract is uncommon, and where it exists it is an opt-in.

## Competitors Surveyed

- **SAP S/4HANA (SD billing plans, RAR)** — the reference for contract billing and revenue accounting in large manufacturers.
- **Oracle NetSuite (SuiteBilling, ARM)** — the mid-market reference for subscriptions and revenue arrangements.
- **Microsoft Dynamics 365 Business Central (Subscription Billing) and F&O (Subscription billing)** — direct mid-market ERP competitors, with open source code for Business Central.
- **Acumatica (Contracts)** — mid-market ERP with contract billing.
- **Odoo (Subscriptions)** — open-source ERP, source code readable.
- **Sage Intacct (Contracts)** — the most explicit public documentation on contract FX.
- **Zuora, Chargebee, Stripe Billing, Maxio, Rillet** — billing and revenue platforms that Carbon customers move from or sync to.
- **IAS 21, IFRIC 22, ASC 830, ASC 606** — the accounting rules every product above must satisfy.

## Key Consensus Patterns

### 1. The price is fixed in the contract currency; the base amount moves

- **SAP**: Condition values on the contract are in document currency; the FI rate only translates them to local currency.
- **Business Central**: The docs state the contract "Amount" is invoiced, not the local-currency amount, and prices "don't automatically change" with rates.
- **Zuora, Chargebee, Stripe**: Prices are set per currency; a subscription's currency cannot change.
- **Maxio**: The only exception — its "exchange-rate pricing" mode lets the foreign price float. Its default "definitive pricing" fixes it.
- **Rationale**: The customer agrees a price in their currency. The seller carries the FX risk on the base amount.

### 2. Each recurring invoice translates at its own date's rate

- **SAP**: The FI rate (`VBRK-KURRF`) defaults to the billing date's rate (rate type M) unless the order or billing plan holds a fixed rate.
- **NetSuite**: Each transaction defaults to its own date's rate; Oracle's ARM examples show invoices at 1.2, 1.5 and 3 against a sales order at 1.10 or 2.
- **Business Central**: The billing run validates the currency on the invoice, so the rate comes from the invoice's posting date.
- **Acumatica, Odoo, Sage Intacct, Zuora, Stripe, Rillet**: The invoice date (or posting date) rate.
- **Chargebee RevRec**: The exception — it translates revenue at the contract date's rate and books the difference to the invoice date as a revenue adjustment.
- **Rationale**: IAS 21.21 and ASC 830-20-30-1 record a foreign-currency transaction at the spot rate on its date. The IFRS IC rejected a rate fixed at contract signing (staff paper AP14, "View A"): an unperformed contract is not yet recognised, so it has no transaction date.

### 3. A credit for an invoiced period uses the invoice's rate

- **NetSuite**: A credit memo created from an invoice inherits the invoice's rate, so no gain or loss arises. A standalone credit applied to the invoice creates realized FX.
- **Zuora**: The rule "Use Original Exchange Rate For Credits?" gives each proration credit item the rate of the invoice it credits.
- **SAP, Business Central, Odoo 18**: The credit copies the original invoice's rate.
- **Acumatica, Odoo 17**: The credit uses its own date's rate; the difference becomes realized FX when it is applied.
- **Rationale**: The credit reverses part of a non-monetary contract liability that sits at the invoice's historical rate (IFRIC 22). Crediting at the invoice rate removes that part exactly. Any difference on the receivable is FX gain or loss, never revenue.

### 4. Deferred revenue is released at the rate of the invoice that funded it

- **SAP RAR**: The "actual exchange rate" method recognizes revenue at the average historical rate of the contract liability while one exists.
- **NetSuite ARM**: A reclassification adjustment trues the billed part of revenue to the effective billing rate.
- **Business Central, Acumatica**: Deferrals are stored in base currency at the invoice's rate, so release uses it.
- **Zuora Billing, Stripe**: Recognition uses the funding invoice's rate; Stripe says it does not translate during amortization.
- **Rationale**: IFRIC 22.8 fixes the transaction date of revenue funded in advance at the date the contract liability is first recognised. A contract liability is non-monetary, so it is never remeasured (IAS 21.23(b); KPMG Handbook 3.050; Deloitte Roadmap 4.8).

### 5. Revenue earned before it is billed uses the rate on the day it is earned

- **SAP RAR**: With no liability balance, revenue uses the spot rate when the run transfers revenue.
- **Sage Intacct**: Revenue posted before its invoice uses the contract-line rate; after the invoice, the invoice rate.
- **NetSuite ARM**: The contract asset can be revalued at the period-end rate (a preference).
- **Rationale**: IFRIC 22 BC24 — consideration in arrears takes the date it is first recognised. Under US GAAP a contract asset is "generally monetary" (KPMG 3.050, Deloitte 4.8), so it is remeasured at each reporting date. IFRS leaves the classification to judgement.

### 6. A contract-level locked rate is rare and opt-in

- **SAP**: A fixed FI rate on the order or each billing-plan date.
- **Dynamics F&O**: A "Fixed exchange rate" field per sales order (not on the billing schedule).
- **Rillet**: An optional `exchange_rate` on the contract.
- **Sage Intacct**: A contract-line rate, but it governs unbilled amounts only; invoices still use their posting date.
- **NetSuite, Business Central, Acumatica, Odoo, Zuora, Chargebee, Stripe**: No contract-level lock. A user can override the rate on one document.
- **Rationale**: A locked rate is a commercial or hedging choice. The standards do not allow it to replace the spot rule; only hedge accounting (IFRS 9.6.5.4, ASC 815) changes the economic result.

## Answers to Research Questions

1. **Which rate does each invoice use?** — Its own date's spot rate (SAP, NetSuite, Business Central, Acumatica, Odoo, Intacct, Zuora, Stripe, Rillet). Not a rate fixed at the contract's start.
2. **Is the price fixed in the foreign currency?** — Yes, in every product except Maxio's opt-in floating mode.
3. **Which rate does a credit for unused time use?** — The rate of the invoice it credits (NetSuite, Zuora, SAP, Business Central, Odoo 18). Products that use the credit's own date post the difference as realized FX (Acumatica, Odoo 17).
4. **Which rate releases deferred revenue?** — The funding invoice's rate (IFRIC 22; SAP RAR actual method, NetSuite ARM, Business Central, Acumatica, Zuora, Stripe).
5. **Which rate does revenue earned before billing use?** — The rate on the day it is earned (SAP RAR, Intacct). Under US GAAP the contract asset is then remeasured at each period end.
6. **Is a locked contract rate common?** — No. SAP, F&O and Rillet offer an opt-in; most products do not.

## Competitor-Specific Details

### SAP S/4HANA

Three billing rates: `KURRF` (FI posting), `KURSK` (pricing) and `KKURS` (condition conversion). A fixed rate on the contract or on a billing-plan date overrides the billing date. RAR has two methods: "fixed" (the first event sets one rate for the contract) and "actual" (historical liability rate, else spot). A contract cannot move from fixed to actual after migration.

### Oracle NetSuite

A credit memo from an invoice inherits the invoice's rate. ARM posts a monthly foreign currency adjustment: overlap × (effective billing rate − effective recognition rate). The preference "Exclude Contract Assets From FX Reclassification" decides whether the contract asset is revalued.

### Dynamics 365 Business Central / F&O

Business Central sets the invoice rate from its posting date and stores deferrals in local currency at that rate (source code). A corrective credit memo copies the invoice's currency factor. F&O has a per-order "Fixed exchange rate" field; its subscription deferrals run in accounting currency only, which leaves residual transaction-currency balances (a known gap).

### Sage Intacct

The contract line has an exchange rate date. Unbilled activity uses it; billed and paid activity uses the invoice posting date. One revenue schedule can therefore post at several rates.

### Zuora

"Use Original Exchange Rate For Credits?" gives each proration credit item the rate of its own invoice. Realized FX posts on payment, credit application and refund. Unrealized FX on open AR posts at period end and reverses the next day.

### Stripe

Revenue Recognition does not translate during amortization. Payment and refund differences go to FxLoss.

### Rillet

A contract takes an optional `exchange_rate`; the docs do not say whether its invoices then use it. ARR uses a constant rate per customer and shows "FX Impact" separately.

## Carbon today (code facts)

- `get_exchange_rate(p_company_id, p_currency_code, p_as_of)` (migration `20260903015941`) returns the company's `exchangeRateOverride` when one exists. Otherwise it returns the latest global rate effective on or before `p_as_of` (today when null). An override has no date, so it wins for every date.
- Rates are foreign units per base unit. `unitPrice` on sales lines is base currency; `convertedUnitPrice` is `unitPrice × exchangeRate` (document currency).
- `convert` copies the sales order's `exchangeRate` onto the invoice (`convert/index.ts:917`). `create-rental-invoices` copies the agreement's rate. `create-contract-invoices` copies the contract's rate (all three: a locked rate from the source document).
- Payments realize FX against the invoice's rate (`.claude/rules/numeric-precision.md`, "Accounting currency boundaries").
- Phase A posts contract invoices through the Service deferral. The deferral rows are stored in base at the invoice's rate, so release already uses the funding invoice's rate.

## Recommended Approach for Carbon

1. **Default: each contract invoice translates at the rate on its invoice date.** `create-contract-invoices` calls `get_exchange_rate(companyId, currencyCode, asOf)` per invoice and stamps that rate on the invoice and its lines. This follows SAP, NetSuite, Business Central, Acumatica, Odoo, Intacct, Zuora and Stripe, and the IAS 21 / ASC 830 spot rule. The contract keeps its rate only as the rate for previews and contract value.
2. **Offer an opt-in "Lock exchange rate" on the contract**, off by default. When on, every invoice uses the contract's rate (today's behaviour). This follows SAP's fixed FI rate, F&O's fixed rate and Rillet's contract rate. It serves customers with a negotiated rate or an external hedge.
3. **A cancellation credit uses the rate of each invoice it credits** (NetSuite, Zuora, SAP). The credit memo carries one rate, so when the credited rows come from invoices at different rates, either draft one memo per source invoice, or use the latest invoice's rate and post the difference to realized FX. Prefer one memo per source invoice: it keeps the reversal exact and needs no FX entry.
4. **Phase B revenue posting** follows IFRIC 22 and needs no remeasurement of deferred revenue:
   - Invoice posting defers at the invoice's rate (already true).
   - The recognition run releases deferred revenue at the rate the funding invoice deferred it at (keep base amounts per source invoice; release them first-in, first-out).
   - Revenue earned before billing (Contract Assets) posts at the run date's rate. Relieving it at invoice posting uses the invoice's rate, and the difference goes to FX gain or loss, not revenue.
   - Remeasuring an open Contract Assets balance at period end stays out of scope (the spec already excludes FX remeasurement); the standards permit an average rate (IAS 21.22, ASC 830-10-55-10).
5. **Keep the decision consistent with `convert`.** Sales-order invoicing copies the order's rate today. Decide whether contracts alone move to the invoice-date rate, or whether `convert` follows later. Contracts are the stronger case: they run for years, while an order invoices within weeks.

## Open questions for Brad

1. Adopt the invoice-date rate as the contract default, with "Lock exchange rate" as an opt-in? (Recommended.)
2. A credit covering invoices at different rates: one memo per source invoice (recommended), or one memo plus a realized FX line?
3. Should `convert` (sales order → invoice) also move to the invoice-date rate, now or later?
4. A company-level `exchangeRateOverride` wins for every date today. Is that the intended behaviour for long contracts, or should overrides become dated?

## Sources

- SAP: https://help.sap.com/doc/03e837f44b9d45ab801051d0998a1a7b/1.3.3/en-us/loio2370015342d8a62fe10000000a4450e5_en.pdf ; https://www.stechies.com/determine-different-exchange-rates-billing-documents/ ; https://community.sap.com/t5/enterprise-resource-planning-q-a/kurrf-field-in-sales-order-billing-sap-sd/qaq-p/12544967 ; https://www.gotothings.com/sd/exchange-rate-controlled-in-billing-document.htm ; https://community.sap.com/t5/enterprise-resource-planning-q-a/exchange-rate-in-credit-note/qaq-p/4585960
- NetSuite: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1404249.html ; https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_161369441792.html ; https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_N1428017.html ; https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157238786981.html ; https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159467246461.html
- Business Central: https://learn.microsoft.com/en-us/dynamics365/business-central/srb/sales/dealing-with-currencies ; https://learn.microsoft.com/en-us/dynamics365/business-central/srb/sales/credit-memo-cancellation ; https://github.com/microsoft/BCApps/tree/main/src/Apps/W1/Subscription%20Billing/App
- F&O: https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/sb-generate-invoice ; https://learn.microsoft.com/en-us/business-applications-release-notes/April19/dynamics365-finance-operations/new-fixed-exrate ; https://erconsult.eu/blog/deferred-revenue-in-foreign-currency-closing-the-gap-in-d365/
- Acumatica: https://help.acumatica.com/Wiki/ShowWiki.aspx?wikiname=HelpRoot_CurrencyManagement&PageID=ab812c9e-e0df-4c7b-a81b-7b8e5f5c5553
- Odoo: https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py ; https://github.com/odoo/odoo/blob/18.0/addons/account/wizard/account_move_reversal.py
- Sage Intacct: https://www.intacct.com/ia/docs/en_US/help_action/Contracts/Using_Contracts/Learn_about/exchange-rate-dates.htm
- Zuora: https://docs.zuora.com/en/accounts-receivable/finance/zuora-finance-settings/foreign-currency-conversion/exchange-rates-for-proration-credits ; https://docs.zuora.com/en/accounts-receivable/finance/accounting-periods/view-accounting-period-balances/foreign-currency-gains-and-losses-journal-entries
- Chargebee: https://www.chargebee.com/docs/revrec/multi-currency/multi-currency
- Stripe: https://docs.stripe.com/revenue-recognition/methodology/multi-currency
- Maxio: https://docs.maxio.com/hc/en-us/articles/24286716475661-Multi-Currency-in-Advanced-Billing
- Rillet: https://docs.api.rillet.com/v2.0/reference/create-a-contract-1.md ; https://www.rillet.com/blog/multi-currency-accounting-guide
- IFRIC 22: https://www.efrag.org/system/files/sites/webpublishing/Project%20Documents/334/IASB%20IFRIC%2022.pdf
- IAS 21: https://www.icab.org.bd/icabadmin/uploads/ckeditor/5954IAS_21_2017.pdf
- IFRS IC staff paper AP14 (View A rejected): https://www.ifrs.org/content/dam/ifrs/meetings/2014/november/ifrs-ic/ias-21-the-effects-of-changes-in-foreign-exchange/ap14-foreign-currency-translation-of-revenue.pdf
- KPMG Foreign Currency Handbook (US GAAP): https://kpmg.com/kpmg-us/content/dam/kpmg/frv/pdf/2024/handbook-foreign-currency.pdf
- Deloitte Roadmap 4.8 (contract assets and liabilities): https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc830-10/roadmap-foreign-currency-transactions-translations/chapter-4-foreign-currency-transactions/4-8-contract-assets-contract-liabilities
