# Period-End FX Revaluation and CTA Posting Research: Best Practices Survey

## Summary

This survey covers two period-end currency postings. The first is the revaluation of open foreign-currency monetary items in a company's own ledger. The second is the translation of a foreign company into the group's presentation currency, with its cumulative translation adjustment (CTA). It reads IAS 21, ASC 830 and the Big 4 guides. Then it compares seven products: SAP S/4HANA, Oracle NetSuite, Business Central, Dynamics 365 Finance, Odoo, Sage Intacct and Acumatica.

The standards put the two differences in different places. A revaluation difference goes to profit or loss. A translation difference goes to other comprehensive income (OCI) and accumulates in equity.

Every surveyed product posts revaluation to the company's own ledger. No surveyed product posts translation to the company's own ledger. SAP, Business Central, Dynamics 365 Finance, Intacct and Acumatica post the CTA in a group-level ledger. NetSuite and Odoo calculate the CTA when the report runs.

## Competitors Surveyed

- **SAP S/4HANA** — the enterprise reference. `FAGL_FCV` (classic) and Advanced Foreign Currency Valuation; translation in Group Reporting.
- **Oracle NetSuite** — the mid-market reference for multi-company close. "Revalue Open Foreign Currency Balances" and Consolidated Exchange Rates.
- **Microsoft Dynamics 365 Business Central** — "Exch. Rates Adjustment" and business-unit consolidation.
- **Microsoft Dynamics 365 Finance** — AR/AP and GL foreign currency revaluation and consolidation.
- **Odoo** — the Unrealized Currency Gains/Losses report with an adjustment entry.
- **Sage Intacct** — revaluation reports that make a draft journal, and Global Consolidation books.
- **Acumatica** — AR/AP and GL revaluation, and translation to a reporting ledger.

## Key Consensus Patterns

### 1. Two postings, two destinations

- **IAS 21**: 21.23(a) and 21.28 put the difference on a monetary item in profit or loss. 21.39 and 21.41 put the translation difference in OCI. 21.48 moves it to profit or loss only on disposal.
- **ASC 830**: 830-20-35-1 puts the transaction gain or loss in net income. 830-30-45-12 puts the translation adjustment in OCI as the CTA.
- **KPMG 1.005**: "measurement or remeasurement affects earnings and translation affects equity".
- **Rationale**: a revaluation changes the cash a company will receive or pay in its own currency. A translation only changes how the group presents a foreign company. That is not an economic gain of the period.

### 2. Revaluation posts to the company's own ledger, at the closing rate

- **SAP**: `FAGL_FCV` values open items and foreign-currency balances on a key date. It posts to the company code.
- **NetSuite**: the close task creates an "Unrealized Gain/Loss" transaction per subsidiary, at the rate on the last day of the period.
- **Business Central, Dynamics 365 Finance, Odoo, Intacct, Acumatica**: all post revaluation to the company's own ledger.
- **Rationale**: IAS 21.23 and ASC 830-20-35-2 require the closing-rate carrying amount "at each balance sheet date". IAS 34.B29–B31 applies the same rule to interim periods.

### 3. Revaluation covers monetary items only

- **IAS 21.8 and 21.16**: a monetary item is a right to receive, or a duty to pay, a fixed or determinable number of currency units.
- **In scope**: cash, trade receivables and payables, loans, accrued liabilities, lease liabilities and refundable deposits.
- **Out of scope**: prepaid expenses, inventory, fixed assets, equity and non-refundable advances. IFRIC 22 and KPMG 3.050 treat a non-refundable advance received (a contract liability) as non-monetary.
- **NetSuite**: always revalues AR, AP and Unbilled Receivable. By default it revalues Bank, Credit Card, Long Term Liability and Other Current Liability. By default it does not revalue Fixed Asset, Deferred Revenue, Deferred Expense or equity.
- **Rationale**: a non-monetary item has no future currency flow to remeasure.

### 4. AR and AP revaluation does not touch the control account (in most products)

- **SAP (classic)**: posts the difference to a balance sheet adjustment account in the same statement line. Only customer and vendor postings may update a reconciliation account.
- **Business Central**: writes a detailed ledger entry of type Unrealized Gain or Unrealized Loss on each open entry. The subledger and the control account move together.
- **NetSuite, Intacct, Acumatica**: post directly to the AR/AP account.
- **SAP (Advanced)**: posts directly to the reconciliation account on purpose.
- **Rationale**: a direct posting breaks the tie-out between the control account and the subledger, unless the subledger also stores the adjustment.

### 5. Two posting techniques: auto-reverse or delta

| Technique | How it works | Who uses it |
|---|---|---|
| Auto-reverse | Post the difference from the original rate at period end. Reverse it on day 1 of the next period. Realized gain at settlement uses the original rate. | SAP classic (default), NetSuite, Dynamics 365 Finance AR/AP, Odoo, Acumatica AR/AP, Intacct (reversal date on the journal) |
| Delta | Post only the change since the last revaluation. No reversal. Each open item stores its last revalued amount. Settlement backs out the stored amount. | SAP delta logic and Advanced FCV, Business Central, Dynamics 365 Finance GL and bank, Acumatica GL |

- **IAS 21.29 and ASC 830-20-35-2**: both specify the result at each reporting date. Neither prescribes the technique.
- **Rationale**: the total profit or loss of each period is the same under both techniques. Only the split between the realized and the unrealized accounts changes.

### 6. Realized and unrealized gains post to separate accounts

- **SAP**: separate keys (`LSBEW`/`LHBEW` valuation, `LSREA`/`LHREA` realized).
- **NetSuite**: Unrealized Gain/Loss and Realized Gain/Loss.
- **Business Central**: Unrealized Gains/Losses Acc. and Realized Gains/Losses Acc. on the Currency card.
- **Dynamics 365 Finance**: unrealized and realized accounts on the Ledger page.
- **Rationale**: the standards disclose only the total (IAS 21.52(a), ASC 830-20-45-1). The split matters for tax, because many tax systems tax an FX gain only at settlement.

### 7. Translation lives above the company ledger

- **SAP**: Group Reporting writes translation to the group journal `ACDOCU`, never to the company's `ACDOCA`.
- **Business Central**: the consolidation posts translation differences in the consolidated company, to exchange-rate and residual accounts.
- **Dynamics 365 Finance**: the consolidation company posts the difference to "Balance account for consolidation differences" (the CTA).
- **Intacct**: posts the CTA in the consolidation book's elimination entity.
- **Acumatica**: posts Translation Gain/Loss in a separate reporting ledger.
- **NetSuite**: calculates the CTA when the report runs. Its system CTA account has no posted transactions. Intercompany elimination differences post to CTA-E in the elimination subsidiary.
- **Odoo**: calculates when the report runs. A user adds the CTA line by hand.
- **Rationale**: the CTA exists only in the consolidated statements (IAS 21.39, ASC 830-30-45-12). A subsidiary's own statements have no CTA.

### 8. Revaluation comes before translation and elimination in the close

- **NetSuite**: Revalue Open Foreign Currency Balances, then Calculate Consolidated Exchange Rates, then Eliminate Intercompany Transactions. Oracle says elimination needs "foreign currency adjustment amounts" first.
- **SAP**: FX valuation, then regrouping, then data release, then translation, then IC elimination.
- **Rationale**: elimination and translation read the revalued balances.

## Answers to Research Questions

1. **Where does each difference go?** Revaluation goes to profit or loss. Translation goes to OCI and equity (pattern 1).
2. **Which balances does a company revalue?** Monetary items only. It excludes prepaid expenses and customer advances that are contract liabilities (pattern 3).
3. **Auto-reverse or delta?** Both comply. Most surveyed products use auto-reverse for AR and AP. It keeps the realized-gain calculation at settlement unchanged (pattern 5).
4. **Control account or adjustment account?** It depends on the product. SAP classic uses an adjustment account. Business Central updates the subledger. NetSuite posts directly (pattern 4).
5. **Does the product post the CTA?** In a group-level ledger in 5 of 7 products. Never in the company's own ledger (pattern 7).
6. **Is revaluation required every month?** At every date the company reports. IAS 34 applies it to interim periods. A balance sheet without a revaluation is not compliant (pattern 2).
7. **Intercompany balances?** A company revalues a short-term balance like an external balance. The difference stays in consolidated profit or loss (IAS 21.45). A long-term loan of investment nature goes to OCI in consolidation (IAS 21.32, ASC 830-20-35-3(b)).
8. **Functional currency vs base currency?** NetSuite has one base currency per subsidiary and no separate functional currency. SAP Advanced FCV values in the functional currency. Some companies keep books outside their functional currency. US GAAP remeasures those books with the temporal method, and the difference goes to net income, not the CTA (ASC 830-10-45-17).

## Competitor-Specific Details

### SAP S/4HANA

- Two engines. `FAGL_FCV` supports reversal (the default) or delta per valuation area. Advanced FCV (`FINS_FXV`) supports delta only and posts straight to reconciliation accounts.
- The OB59 valuation method sets which differences post: always, lowest value (losses only), strict lowest value, or gains only. Only "always" complies with IAS 21.28.
- Account determination key KDF serves open items. It holds a balance sheet adjustment account (`LKORR`) and gain and loss accounts per reconciliation account. Key KDB serves G/L balances, such as bank accounts.
- A history table (`FAGL_BSBW_HISTRY`) stores one row per valued item, valuation area, currency type and run. One run per key date and valuation area. To repeat a run, the user runs a reset, which posts an inverse, and then runs again.
- A test run posts nothing and saves a log.
- An item open on the key date is in scope, even if it cleared after the key date but before the run.
- Group Reporting translates per consolidation unit. Equity uses the historical rate, and the difference goes to an equity item (the CTA). A rerun posts deltas.

### Oracle NetSuite

- NetSuite always revalues AR, AP and Unbilled Receivable. A per-account flag ("Revalue Open Balance for Foreign Currency Transactions") adds other non-equity balance sheet accounts.
- Gain or loss = (foreign balance × ending rate) − base balance.
- The reversal posts on day 1 of the next period. The user cannot edit or delete it. If the source changes, NetSuite updates it.
- A rerun in the same period adds transactions for the change. If a user reopens a period and reruns its revaluation, all later periods must be rerun too.
- The Consolidated Exchange Rates table holds current, average and historical rates per period and subsidiary pair. Each account has a General Rate Type and a Cash Flow Rate Type.
- NetSuite calculates the CTA and never posts it. The CTA Balance Audit report explains it per account.
- No functional-currency setting. To get a functional currency that differs from the local currency, a company sets its base currency to the functional currency. Revaluation then remeasures local documents through profit or loss.
- Reports: "Unrealized Exchange Rate Gains and Losses" lists each open transaction with its source rate, ending rate, foreign balance and gain or loss.

### Microsoft Dynamics 365 Business Central

- It adjusts open customer and vendor entries, and bank accounts with a currency code. It never revalues plain G/L accounts for foreign currency, because a G/L entry stores no source currency.
- It uses a separate adjustment rate (Adjustment Exch. Rate Amount), not the document rate.
- It uses the delta technique. Each open entry gets a detailed entry of type Unrealized Gain or Unrealized Loss. At payment, BC reverses the unrealized amount, then posts the realized amount against the original rate.
- An Exchange Rate Adjustment Register links each run to its entries.
- Consolidation posts translation differences in the consolidated company. Each account has a Consol. Translation Method: Average, Closing, Historical, Composite or Equity.

### Microsoft Dynamics 365 Finance

- AR/AP revaluation works per open transaction. Each run reverses the previous unrealized amount and posts a new full amount. Methods: Standard, Minimum (losses only, a local GAAP option), Invoice date.
- GL revaluation works per main account balance, as a delta. It excludes AR, AP and bank accounts, because their subledgers revalue them.
- A Simulation report cannot post. A GL Preview can post.
- Posting profiles set unrealized accounts per module (GL, AP, AR, Bank) and per currency.
- Consolidation posts the translation difference to the CTA account in a dedicated consolidation company. No daily journals are allowed there.

### Odoo

- The Unrealized Currency Gains/Losses report lists open foreign-currency entries. The user can override a rate for the report only.
- An Adjustment Entry wizard asks for a journal, an income account, an expense account and a reversal date. Odoo reverses the entry on that date.
- The adjustment never touches the open item's residual. So the realized difference always uses the original rate.
- Consolidation translates at report time. Odoo posts nothing.

### Sage Intacct

- Revaluation reports for AP, AR, GL and Cash Management. Each report creates a draft journal. A controller reviews and posts it, with a reversal date.
- Global Consolidation translates each company into a consolidation book. The CTA posts in the book's elimination entity.

### Acumatica

- AR/AP revaluation posts to the AR/AP account and auto-reverses. A user cannot reverse a batch by hand and reruns instead.
- GL account revaluation is cumulative (delta).
- Translation posts Translation Gain/Loss in a separate Reporting ledger. It never touches the actual ledger.

## Recommended Approach for Carbon

1. **Add a Currency Revaluation run to the period close.** It revalues the open foreign-currency monetary items of one company at the period-end closing rate. It posts Unrealized Exchange Gain and Unrealized Exchange Loss to profit or loss. This follows every surveyed product.
2. **Use the auto-reverse technique.** Carbon already measures realized FX at settlement against the original document rate (`calculateSettlementFx`). Auto-reverse keeps that calculation unchanged, as SAP classic, NetSuite and Odoo do. Delta would need a stored per-item revalued amount and a change to the payment journal (the Business Central model).
3. **Post AR and AP revaluation to adjustment accounts, not to the control accounts.** Carbon's `get_ar_tie_out` and `get_ap_tie_out` sum every posted line on the control accounts. A direct posting breaks the tie-out. This follows SAP classic.
4. **Keep unrealized and realized accounts separate.** Add two `accountDefault` columns next to the existing realized pair. This follows all surveyed products.
5. **Store one run line per revalued document.** It holds the foreign open amount, booked base amount, closing rate and difference. This is the audit trail (SAP history table, NetSuite report).
6. **Never post the CTA to profit or loss.** If Carbon posts the CTA, it posts it to equity in a group-level ledger. In Carbon that ledger is the elimination entity (Intacct, Dynamics 365 Finance, Business Central). Otherwise Carbon keeps the report-time CTA (NetSuite, Odoo).
7. **Exclude non-monetary balances.** These are customer deposits on sales orders, prepaid expenses and fixed assets (IFRIC 22).
8. **Place revaluation before intercompany elimination in the close checklist.** This follows the NetSuite order.

## Sources

- IAS 21 text (NZ IAS 21, identical to IAS 21 to February 2024): https://standards.xrb.govt.nz/assets/dms-assets/NZ-IAS-21-Jan25.pdf
- IFRIC 22: https://www.iasplus.com/en-gb/standards/ifric/ifric-22
- IAS 34 B29–B31 (BDO): https://www.bdo.global/getmedia/ad827e66-13ae-4c57-885c-e4e7d69dd6fc/Interim-Financial-Statements-(June-2024)_FINAL.pdf
- KPMG Handbook, Foreign currency (US GAAP): https://kpmg.com/kpmg-us/content/dam/kpmg/frv/pdf/2026/foreign-currency.pdf
- PwC Viewpoint, Foreign currency guide: https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/foreign_currency/assets/pwcforeigncurrency0826.pdf
- Deloitte Roadmap 4.3, subsequent measurement: https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc830-10/roadmap-foreign-currency-transactions-translations/chapter-4-foreign-currency-transactions/4-3-subsequent-measurement-foreign-currency
- Deloitte Roadmap 3.2, selecting exchange rates: https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc830-10/roadmap-foreign-currency-transactions-translations/chapter-3-exchange-rates/3-2-selecting-exchange-rates
- SAP Foreign Currency Valuation: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/651d8af3ea974ad1a4d74449122c620e/8450d7531a4d424de10000000a174cb4.html
- SAP Valuation of Open Items: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/651d8af3ea974ad1a4d74449122c620e/6c4ed7531a4d424de10000000a174cb4.html
- SAP Advanced Valuation: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/651d8af3ea974ad1a4d74449122c620e/c0a967eee7d843f8aceb44219b6f40b3.html
- SAP Delta Logic: https://help.sap.com/docs/SUPPORT_CONTENT/fiaccounting/3361878651.html
- SAP account determination: https://help.sap.com/docs/SUPPORT_CONTENT/fiaccounting/3361880543.html
- SAP reset on valuation history: https://help.sap.com/docs/SUPPORT_CONTENT/fiaccounting/3361878673.html
- SAP Group Reporting currency translation: https://help.sap.com/docs/SAP_S4HANA_CLOUD/90c07e91c7a64f328be3fd6b48955b13/71f7814e0cfc4ebbaaded46b6237a58d.html
- SAP closing operations: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/651d8af3ea974ad1a4d74449122c620e/4b187752a9d07154e10000000a44176d.html
- NetSuite revaluation of open currency balances: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1428662.html
- NetSuite types of accounts that can be revalued: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1428933.html
- NetSuite currency revaluation transactions: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1550016096.html
- NetSuite unrealized gains and losses report: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1437432.html
- NetSuite consolidated exchange rate types: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1405625.html
- NetSuite CTA overview: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2124272.html
- NetSuite closing tasks and dependencies: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4317009345.html
- NetSuite intercompany elimination and CTA-E: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_N1498539.html
- Business Central, update exchange rates: https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-update-currencies
- Business Central, consolidation: https://learn.microsoft.com/en-us/dynamics365/business-central/finance-consolidated-company-reporting
- Business Central, Detailed CV Ledger Entry Type: https://learn.microsoft.com/en-us/dynamics365/business-central/application/base-application/enum/microsoft.finance.receivablespayables.detailed-cv-ledger-entry-type
- Dynamics 365 Finance, AR/AP revaluation: https://learn.microsoft.com/en-us/dynamics365/finance/cash-bank-management/foreign-currency-revaluation-accounts-payable-accounts-receivable
- Dynamics 365 Finance, GL revaluation: https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/foreign-currency-revaluation-general-ledger
- Dynamics 365 Finance, consolidation currency translation: https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/financial-consolidations-currency-translation
- Odoo, foreign currency and unrealized gains: https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/foreign_currency.html
- Odoo, consolidation: https://www.odoo.com/documentation/19.0/applications/finance/accounting/get_started/consolidation.html
- Sage Intacct, foreign currency revaluation: https://www.intacct.com/ia/docs/en_US/help_action/Company/Currencies_and_exchange_rates/Currencies/foreign-currency-revaluation-overview.htm
- Sage Intacct, Global Consolidation: https://www.intacct.com/ia/docs/en_US/help_action/Consolidations/Global_Consolidations/GC-Overview.htm
- Acumatica, revaluation of GL accounts: https://help-2025r1.acumatica.com/Wiki/ShowWiki.aspx?pageid=6ba09554-2ff6-48bc-b19a-19427c1e09a4
- Acumatica, translation of financial statements: https://help.acumatica.com/Wiki/ShowWiki.aspx?wikiname=HelpRoot_CurrencyManagement&PageID=35846545-2364-42a0-9e44-3d27267a88cd
