# Accounting Posting Corrections Research: Best Practices Survey

## Summary

Research refreshed on 2026-09-07 for the selected fixes: separate tax and customer shipping from product-sales postings, normalize transaction FX, and correct consolidation calculations. This is a focused update to [shipping/tax research](shipping-tax-accounting.md), [FX research](exchange-rate-competitor-practice.md), and [financial reporting research](financial-reporting.md). Their older Carbon inventories are not current implementation evidence. Current code was checked at `0a9aef2444`.

## Competitors Surveyed

- **SAP S/4HANA** — tax account assignment, currency quotation, consolidation and correction of posted documents.
- **Oracle NetSuite** — shipping income accounts, tax controls, transaction/consolidation rates, earnings presentation and reversals.
- **Xero and QuickBooks Online** — adapter-specific rate conventions affecting Carbon's existing integrations.

## Key Consensus Patterns

### 1. Separate tax collected from sales consideration

- **SAP:** input and output tax have separate accounting treatment; non-deductible tax may remain in asset/expense costs. [Input/output tax](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/8fbeed5f2046489696a50ac7fd76f9c6/2847d953189a424de10000000a174cb4.html).
- **NetSuite:** tax control accounts distinguish sales-tax liability from purchase-tax assets. [Tax control accounts](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3726875412.html).
- **Rationale:** splitting collected sales tax is necessary even without a new tax-determination subsystem. Recoverability must be known before changing purchase-tax capitalization.

### 2. Customer shipping charges and carrier expenses are different amounts

- **NetSuite:** shipping items allocate customer shipping charges to an income account; handling can have its own account. [Shipping items](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1258840.html), [Shipping account selection](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1259213.html).
- **SAP:** the researched tax/account-assignment documentation supports separating underlying consideration from tax; it does not settle a single mandatory shipping account presentation for Carbon.
- **Rationale:** a separate Shipping Income account cleans up product-sales reporting. A customer charge is not evidence of the actual carrier expense. Do not create a freight-expense accrual from a billed-charge field.

### 3. FX arithmetic follows the stored quotation

- **SAP:** direct and indirect quotation represent inverse contracts. [Quotation definitions](https://help.sap.com/docs/SAP_ERP/ae5c71ff3b1f490fb7f3b1f17bb2c7ee/b7c38d5377a0ec23e10000000a174cb4.html).
- **NetSuite:** its rate-list contract uses source amount multiplied by the rate to obtain base. [Rate-list formula](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_1527609411.html).
- **Carbon inference:** preserve Carbon's foreign-units-per-base-unit contract: document-to-base divides, base-to-document multiplies, and already-base fields receive no second conversion. A provider's different quotation requires inversion at that adapter boundary.

### 4. CTA captures translation differences, not source-accounting errors

- **NetSuite:** assets/liabilities generally use current rates, income/expenses average rates, and equity historical rates; CTA reconciles the resulting translated statements. [CTA overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2124272.html).
- **SAP:** translation methods and difference handling distinguish balances translated under different rules. [Translation differences](https://help.sap.com/docs/SAP_ERP_SPV/f1f80b03e15440c0b3cf5e655a6938d8/8a4cd353c6244308e10000000a174cb4.html).
- **Carbon inference:** natural-balance Expense must contribute to the debit side. A balanced Cash 80 / Revenue 100 / Expense 20 source at all rates 1 has CTA 0. The current function returns −40.

### 5. Earnings presentation has an explicit fiscal boundary

- **NetSuite:** prior-fiscal-year earnings appear in retained earnings; current-year earnings appear in net income. [Year-end closing](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1457773.html).
- **SAP:** standard translation can preserve opening group-currency values and apply period-specific translation methods. [Translation methods](https://help.sap.com/docs/PRODUCT_ID/90c07e91c7a64f328be3fd6b48955b13/1eac9a4436204081956213fb2d265094.html).
- **Rationale:** cumulative balances, period activity and fiscal-year income must not be substituted for one another. This informs regression boundaries; a full retained-earnings/history subsystem is broader than fixing the demonstrated CTA sign error.

### 6. Preserve posted facts and reverse their original values

- **SAP:** posted monetary/account fields are protected; correction flows can reverse original postings and repost under corrected mappings. [Protected posted fields](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/3cb1182b4a184bdd93f8d62e3f1f0741/6350d7531a4d424de10000000a174cb4.html), [Reversal/reposting](https://help.sap.com/docs/SAP_S4HANA_ONPREMISE/26c2d5e366bc44c1a98f2a9212a0c49d/5e6dfc7b93124d8fbcb745a7aaeb7701.html).
- **NetSuite:** reversal entries retain the original exchange rate and a relationship to the original journal. [Journal reversal](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_N1469193.html).
- **Rationale:** a new posting formula does not authorize rewriting posted history. Reversals invert actual booked lines. Open legacy documents require an explicit transition design so normalized settlements do not strand old control balances.

## Answers to Research Questions

1. **Where should invoice tax post?** Collected sales tax to the configured liability account. Purchase tax recovery depends on classification; current Carbon has no recoverability model.
2. **Where should customer shipping charges post?** A separate configured shipping-income account is the grounded default; carrier cost needs its own actual-cost source.
3. **Which FX direction is correct?** The direction defined by each stored rate. Carbon uses foreign/base, so divide only document-denominated values; leave base fields unchanged.
4. **What should CTA reconcile?** Differences introduced by translation rules after the source ledger balances under the correct account signs.
5. **How should earnings periods work?** Distinguish current activity, cumulative balance and fiscal-year earnings; retain the existing scope boundary while testing the correction.
6. **How should existing erroneous postings be corrected?** Preserve them and use linked corrections/reversals with original values and period controls. Exact rollout/remediation coverage is a product/accounting decision.

## Competitor-Specific Details

### SAP

Direct versus indirect quotation is a configurable convention. Carbon should borrow the explicitness, not copy an arithmetic operator from unrelated SAP configuration.

### NetSuite

Shipping-account assignment is an income-account setting. Its documented transaction-rate formula is opposite Carbon's quotation, so adapter conversions need tests.

### Existing Carbon providers

- Xero's [multicurrency documentation](https://developer.xero.com/documentation/best-practices/data-integrity/multicurrency/) is the source for its transaction-rate contract.
- QuickBooks' [ExchangeRate property documentation](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/0b5f8961-f32e-e396-3a39-7b3e241434e8.htm) specifies home currency per foreign unit, requiring the reciprocal of Carbon's rate.
- Unsupported provider FX paths must remain explicitly unsupported; do not assume another provider's rate convention.
- Rillet's current [Create a bill schema](https://docs.api.rillet.com/reference/create-a-bill-1) defines `exchange_rate` as an object with `base`, `target`, string `rate`, and `date`. Carbon currently sends a scalar from its bill adapter. The adapter needs a schema-valid, explicitly directed pair and a contract fixture; copying the scalar rate from the Xero adapter is insufficient. The schema establishes the object shape; currency-direction verification must accompany the adapter change.
- Rillet's [AR_ONLY invoice schema](https://docs.api.rillet.com/reference/create-an-invoice-1.md) uses product-backed lines, native header/item tax, and optional line revenue account metadata; its create request does not expose `exchange_rate`. Keep the current AR_ONLY scope and distinguish document-currency correctness from provider-owned base translation. Its [product schema](https://docs.api.rillet.com/reference/create-a-product-1.md) supports the ONE_TIME shipping helper and revenue account mapping.
- QuickBooks' existing item-based invoice path needs a Service item whose [IncomeAccountRef](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/e53f8d57-d526-2cee-9c6b-03359cfaae37.htm) resolves to Shipping Revenue. [Native tax detail](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/7328bab2-a9ed-621e-41fa-188e45aaac65.htm) and [rate membership/percentage rules](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/9a4b9306-4684-179c-4b74-3896047aa53b.htm) require genuine remote tax references. Mapping a uniquely compatible existing sales tax code is a Carbon implementation choice; ambiguous or unsupported tax configuration must produce a preflight warning rather than tax-as-revenue or a fabricated ID.

## Recommended Approach for Carbon

1. Use a named base-currency sales breakdown for goods/add-ons, billed freight and tax; route each separately.
2. Preserve current tax bases and purchase-tax capitalization during this correction; avoid introducing new tax-determination policy.
3. Normalize invoice, receipt, payment, memo, settlement, tie-out, UI and provider boundaries as one coordinated contract.
4. Correct CTA signs and account-id resolution through actual report call sites, with same-currency and mixed-rate tests.
5. Follow the user's explicit adoption assumption: accounting has no users yet. Correct the formulas directly without legacy-version or historical-remediation tooling. Preserve normal reversal correctness for future postings; do not interpret this assumption as requiring deletion of existing operational data.

## Carbon Scope Resolution

On 2026-09-07 the user confirmed a separate shipping-revenue default column, a Shipping Revenue account under Revenue, and backfilled company defaults. They subsequently resolved the history question with: “we can assume that no one is use accounting yet and just fix it.” General competitor practices for mature ledgers above remain useful context, but a legacy accounting transition is unnecessary for this scoped implementation. The finalized design is [Accounting Posting Corrections](../specs/2026-09-07-accounting-posting-corrections.md).

## Sources

Primary source URLs are attached directly to the claims above. Existing repository research is linked in Summary for historical context; current source code takes precedence over its older Carbon observations.
