# Multi-Jurisdiction Tax Compliance Research: Best Practices Survey

## Summary

Surveyed how SAP S/4HANA, NetSuite, Dynamics 365 Business Central, Odoo, Xero, and the external tax engines (Avalara AvaTax, Vertex, Stripe Tax) model tax determination, calculation, GL posting, exemptions, registrations/nexus, and returns across US sales tax and VAT/GST regimes. The industry converges on a small set of structural patterns: a **two-sided classification matrix** (party-side group × item-side group) resolving to a **tax code**; tax codes composed of **components** (one per jurisdiction/authority, each with its own rate and GL account); an immutable **tax subledger** written at posting time that all reporting reads from; **registrations/nexus** gating where tax is calculated at all; and a **pluggable external-engine seam** (estimate on orders, commit at invoice posting). Every surveyed system posts output tax to a liability account separate from revenue and input tax to a recoverable account separate from cost — the two things Carbon's current posting does not do.

## Competitors Surveyed

- **SAP S/4HANA** — enterprise reference; condition-technique determination, BSET tax subledger, external engine interface (TAXUSX)
- **NetSuite** — mid-market reference; nexus-rooted model, SuiteTax plug-in engine framework, tax control accounts
- **Dynamics 365 Business Central** — closest SMB architecture to Carbon's existing posting-group matrix; runs *two* parallel tax systems (VAT posting groups + US tax areas/jurisdictions)
- **Odoo** — SMB reference for a *unified* single-model approach (`account.tax` + fiscal positions + tax grids)
- **Xero** — Carbon already syncs to Xero; tax rates with summed components, ReportTaxType → return-box mapping
- **Avalara AvaTax / Vertex / Stripe Tax** — external determination engines; define the integration contract an ERP must expose

## Key Consensus Patterns

### 1. Two-sided classification resolves the tax treatment

- **BC**: `VAT Bus. Posting Group` (customer/vendor) × `VAT Prod. Posting Group` (item/GL account) → `VAT Posting Setup` row (rate, calculation type, accounts). US side: `Tax Area` (party/ship-to) × `Tax Group` (item) → `Tax Detail` rates.
- **SAP**: customer tax classification × material tax classification (+ departure/destination country) → condition record → tax code.
- **NetSuite**: nexus (from ship-to + registrations) + item tax schedule → tax code/group.
- **Odoo**: product default taxes rewritten by the partner's fiscal position (auto-applied by country/VAT-number).
- **Rationale**: *who/where* you sell to and *what* you sell are independent axes; a matrix keeps N×M treatments maintainable as N+M classifications.

### 2. The tax code is the atomic unit; components carry jurisdictions

- **Xero**: `TaxRate` = list of `TaxComponents` (name, rate, `IsCompound`, `IsNonRecoverable`) that sum to the effective rate — the state+county+city pattern.
- **BC**: `Tax Area` = set of `Tax Jurisdictions`, each jurisdiction with its own rate (via Tax Detail), its own GL accounts, and a `Report-to Jurisdiction` for rollup.
- **NetSuite legacy**: `Tax Group` bundles per-authority tax codes; SuiteTax writes one tax-detail line per jurisdiction subnexus.
- **SAP**: one tax code expands to one condition line per jurisdiction level (`JR1–JR4`/`XR1–XR6`), each with its own account key.
- **Avalara**: response `details[]` = one entry per jurisdiction per line (jurisCode, type State/County/City/Special, rate, tax).
- **Rationale**: multi-level US stacking, Canada GST/PST, and single-rate VAT all collapse into "a code with 1..n components."

### 3. An immutable tax subledger is written at posting time

- **BC**: every VAT-relevant posting writes a **VAT Entry** (base, amount, posting groups, VAT date, open/closed) — all reporting and settlement reads VAT entries, not GL.
- **SAP**: **BSET** segment per document (base, tax, account key, jurisdiction, level).
- **NetSuite SuiteTax**: per-line Tax Details (type, code, basis, rate, amount).
- **Avalara**: committed transactions are the return-feeding record; adjust/void create new versions.
- **Rationale**: rates and config change; posted documents must not. Returns need taxable/exempt *bases*, not just tax amounts — GL alone can't answer "exempt sales to TX in Q2."

### 4. Output and input tax post to dedicated accounts — never into revenue or cost

- **BC**: VAT Posting Setup carries `Sales VAT Account` / `Purchase VAT Account`; US jurisdictions carry `Tax Account (Sales)` / `Tax Account (Purchases)`; non-recoverable purchase tax is explicitly flagged `Expense/Capitalize`.
- **SAP**: account keys `MWS` (output) / `VST` (input) / `NAV`/`NVV` (non-deductible, posted separately or distributed to cost).
- **NetSuite**: per-nexus Payables (sales) and Receivables (purchases) tax control accounts.
- **Xero/Odoo**: account per rate / per repartition line.
- **Rationale**: collected tax is a liability owed to an authority; recoverable input tax is an asset. Booking either into revenue/cost misstates the P&L and makes remittance untrackable.

### 5. Registrations/nexus gate where tax applies

- **Avalara**: `NexusModel` declarations per jurisdiction — **engine returns zero tax where no nexus is declared**; economic-nexus thresholds (Wayfair $100k/200-txn baseline) are monitored but never self-registered.
- **Stripe Tax**: registration-based — only calculates where registered.
- **NetSuite**: nexuses per subsidiary with registration numbers (SuiteTax: multiple, with validity dates); determination fails to a nexus only if a registration exists.
- **SAP**: plants abroad / RITA for foreign VAT registrations; VAT reg no. (`STCEG`) on master data drives intra-EU treatment.
- **Rationale**: collecting where unregistered is as bad as not collecting where registered.

### 6. Exemptions are certificates + item taxability + reason codes

- **NetSuite SuiteTax / Avalara**: customer exemption certificates with expiry, scope, reason (entity-use) codes; auto-applied by customer at calc time.
- **BC**: `Tax Exemption No.` on header; item-side non-taxable Tax Group.
- **Rationale**: exempt sales still must be *recorded* (returns report exempt bases); an exemption zeroes the rate, it doesn't skip the tax record.

### 7. Reverse charge posts paired entries that net to zero

- **BC**: `VAT Calculation Type = Reverse Charge VAT` → input VAT to Purchase VAT Account + offsetting output to `Reverse Chrg. VAT Acct`.
- **SAP**: paired condition lines (`MWS`+`VST`, or `ESA`/`ESE` acquisition tax) net zero but both appear in reporting.
- **Odoo**: intra-EU fiscal position maps to reverse-charge tax whose repartition lines split base/tax into the right grids.
- **Rationale**: EU B2B purchases (and domestic reverse-charge regimes) require self-assessed output+input VAT reported on both sides of the return.

### 8. Returns are built by mapping codes/components to boxes; settlement is a posted entry

- **BC**: VAT Statement rows (filters by posting groups) map to official return boxes; `Calc. and Post VAT Settlement` nets input vs output into a settlement account and closes VAT entries.
- **Xero**: `ReportTaxType` enum per rate (~100 values: INPUT, OUTPUT, ECACQUISITIONS, USSALESTAX, REVERSECHARGES…) drives return placement (UK MTD boxes auto-populate).
- **Odoo**: repartition-line `tag_ids` (tax grids) aggregate into the country return; a closing entry + tax lock date close the period.
- **NetSuite**: liability reports per agency/nexus; *Pay Sales Tax* / *Pay Tax Liabilities* settle to the agency vendor.
- **Rationale**: box mapping is per-country configuration layered on top of a category attribute on the tax code — the code itself stays jurisdiction-neutral.

### 9. External engines plug in at one seam; internal tables are the default path

- **NetSuite**: SuiteTax is a plug-in framework — NetSuite's own engine, Avalara, Vertex, Sovos are all engines selectable per nexus.
- **Odoo**: AvaTax replaces native computation only when the AvaTax fiscal position applies (US/CA/BR).
- **Xero**: US orgs get Avalara-powered "auto sales tax"; other regions use native rates.
- **Avalara ERP guide**: estimate with `SalesOrder` (temporary) on quotes/orders; `SalesInvoice` with commit at invoice posting; document `code` = invoice number for idempotency; validate addresses at master-data entry; on outage, flag and reconcile — never commit guessed tax.
- **Rationale**: rooftop-accurate US determination (13,000+ jurisdictions) is a data-service problem, not an ERP problem. The ERP owns the seam, the records, and the GL.

### 10. Mechanics everyone specifies

- **Rounding**: line-level vs document-level is an explicit setting (Avalara default: line-level for new companies; BC rounds per `VAT Identifier` sum). The two can differ by a penny; authorities tolerate both.
- **Tax-inclusive pricing**: a document-level mode (Xero `LineAmountTypes` Exclusive/Inclusive/NoTax; BC `Prices Including VAT`; Odoo `price_include`).
- **Effective-dated rates**: BC Tax Detail and Avalara nexus/rates carry effective dates; NetSuite SuiteTax nexuses have validity dates.
- **Tax date vs posting date**: BC `VAT Date`, SuiteTax line-level Tax Point Date.

## Answers to Research Questions

1. **Core determination entities** — party-side group × item-side group → tax code (BC posting setup; SAP condition technique; Odoo fiscal positions). Party side is resolved from the **ship-to** (destination) for US sales tax and from country/registration relationships for VAT (SAP/NetSuite/BC all key US determination off ship-to address; SuiteTax additionally weighs ship-from, billing, and registrations).
2. **US + VAT in one model** — BC keeps two subsystems (VAT posting groups vs tax areas/jurisdictions) bridged by `VAT Calculation Type = Sales Tax`; Odoo/Xero/Avalara prove the unified model: a tax code with 1..n components covers single-rate VAT and stacked US jurisdictions alike; reverse charge is a calculation-type attribute, not a separate system. **A new implementation should unify** (the BC split is NAV legacy).
3. **GL posting & line storage** — dedicated output-tax liability and input-tax accounts, per component/jurisdiction where needed (consensus #4); per-line tax detail snapshot at posting into a tax subledger (consensus #3). Non-recoverable input tax capitalizes into cost via an explicit flag (BC Expense/Capitalize, Xero IsNonRecoverable, SAP NVV).
4. **Exemptions & registrations** — certificates on the customer (number, reason, expiry) zero the rate but still write records; item taxability via the item-side group; company registrations with numbers/dates gate calculation and print on documents (consensus #5, #6).
5. **Returns & rounding** — reporting reads the tax subledger grouped by authority/component (taxable base, exempt base, tax); box mapping is config layered on a reporting-category attribute; settlement is a posted journal entry (consensus #8). Rounding: line-level default (consensus #10).
6. **External engine contract** — one determination seam; temporary calls for quotes/orders, committed calls at invoice posting keyed by document code; address validation at master entry; nexus declared engine-side mirrors registrations (consensus #9).

## Competitor-Specific Details

### SAP S/4HANA
Tax codes (`MWSKZ`) within per-country calculation procedures; US jurisdiction code `TXJCD` decomposes into up to 4–6 levels, one condition line per level; account keys (OB40) map to GL per chart of accounts; zero-rated vs exempt are separate 0% codes distinguished only by reporting attributes; deferred (cash-basis) tax via target tax codes; RFUMSV00 builds the VAT return from BSET and posts the net payable.

### NetSuite
Tax agencies are **vendor records** — remittance is ordinary AP; legacy tax periods are independent of accounting periods (SuiteTax reverts to accounting periods + tax point date); Tax Types carry special behaviors (withholding "does not add to total", "post to item cost" for non-deductible VAT, reverse charge); nexus override is user-visible but permission-gated.

### Dynamics 365 Business Central
`VAT Identifier` groups posting-setup combinations sharing a rate so document-level VAT rounds per identifier; `Max. VAT Difference Allowed` bounds manual per-line tax overrides; VAT Clauses print per-language legal text justifying zero/reduced rates on invoices; Tax Details support min/max taxable thresholds and effective dates; Canada Provincial Tax Area self-assesses PST when the vendor charged only GST/HST.

### Odoo
`account.tax.repartition.line` splits each tax's base and amount into GL accounts + report grids separately for invoices vs refunds (factor_percent enables 50/50 GST splits); fiscal localization packages install per-country charts + taxes + return layouts; Tax Lock Date reclassifies late changes into the next open period.

### Xero
Per-account and per-contact default tax types with line-level override; `LineAmountTypes` is document-level; US system rates are read-only Avalara-managed with system GUIDs — user-defined codes and engine-managed codes coexist in one table.

### Avalara AvaTax
Document lifecycle Temporary → Saved → Committed → Locked; committed docs feed returns; locked docs (reported on a filed return) are immutable — corrections require offsetting documents with `taxOverride.taxDate` pinned to the original period; `entityUseCode` letter codes standardize exemption reasons; line vs document rounding is a company setting; Managed Returns runs off filing calendars with a monthly reconcile-approve-file cycle.

## Recommended Approach for Carbon

1. **Unify VAT and US sales tax in one model** (Odoo/Xero/Avalara pattern, not BC's dual system): `taxCode` (treatment + reporting category + calculation type) composed of `taxCodeComponent` rows (authority, rate, GL accounts, recoverable/compound flags). Single-rate VAT = one component; Texas 8.25% = two to four components.
2. **Determination matrix, Carbon-shaped** (BC pattern — Carbon already has the posting-group matrix precedent): party-side `taxArea` (assigned to customers/ship-to locations/suppliers, auto-matchable by country+state) × item-side `taxCategory` (on items) → `taxRule` → `taxCode`. Destination-based: resolve the area from the ship-to address.
3. **Tax subledger** (BC VAT Entry / SAP BSET pattern): write immutable `taxLedger` rows (base, exempt base, rate, amount, component, authority, journal link) when invoices post; drafts compute live; all reporting reads the ledger.
4. **Fix posting** (consensus #4): credit revenue net + credit output-tax liability per component on sales; debit recoverable input tax separately from cost on purchases, with a non-recoverable flag preserving capitalize-into-cost (today's behavior) for US purchase tax. Reverse charge = paired entries (activates Carbon's existing dead `reverseChargeSalesTaxPayableAccount` config).
5. **Registrations** (`taxRegistration`: jurisdiction, number, dates) print on documents and group liability reporting; rule coverage ⇒ collection, mirroring nexus (warn on rule-without-registration).
6. **Wire the existing exemption metadata** (`customerTax.taxExempt` + certificates, currently display-only) into determination — exempt resolves to a 0% code with reason, still writing ledger rows.
7. **One determination seam** (`resolveTaxes(...)` service + shared edge-function helper) so an Avalara engine can replace the internal matrix per company later (NetSuite SuiteTax pattern); v1 ships the internal engine only.
8. **Defer**: return-box statements, settlement posting, tax-inclusive pricing, use-tax accrual, external engine connector, foreign-currency registrations — each has a clean landing zone in this model.

## Sources

### SAP
- https://community.sap.com/t5/enterprise-resource-planning-q-a/basis-of-tax-procedure-selection-for-us-client/qaq-p/10565870
- https://sapcodes.com/2016/12/17/tax-determination-in-sap-sd/
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/understand-the-new-account-determination-for-tax-codes-in-s-4-hana-finance/ba-p/13359507
- https://sap96.com/2024/11/08/assign-gl-accounts-to-tax-account-key-ob40/
- https://leanx.eu/en/sap/table/bset.html
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/reverse-charge-in-taxation/ba-p/13344984
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/a624a4a6d1d8473eb95fb42660127cfe/8278b228bc4f4c2ca5b3cb84739f42b0.html (plants abroad / RITA)
- https://userapps.support.sap.com/sap/support/knowledge/en/2557594 (exemption certificates with external engines)
- https://saplearners.com/sap-tcode/f-rfumsv25/ (deferred tax transfer)
- https://knowledge.avalara.com/bundle/wuc0965226643863_wuc0965226643863/page/gws9480803604709.html (SAP↔AvaTax)

### NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0315035511.html (SuiteTax vs legacy)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4283869397.html (Tax types & codes)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4283851663.html (Nexuses)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4283866360.html (Nexus lookup logic)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4283867856.html (Tax details on transactions)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2043102.html (Sales tax liability by agency)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_160639676040.html (Exemption certificates)
- https://timdietrich.me/blog/netsuite-sales-tax-options/
- https://www.avalara.com/us/en/products/integrations/netsuite/suite-tax-integrations.html

### Dynamics 365 Business Central
- https://learn.microsoft.com/en-us/dynamics365/business-central/finance-setup-vat
- https://learn.microsoft.com/en-us/dynamics365/business-central/finance-setup-unrealized-vat
- https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-report-vat
- https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-setup-vat-statement
- https://learn.microsoft.com/en-us/dynamics365/business-central/localfunctionality/unitedstates/us-sales-tax
- https://learn.microsoft.com/en-us/dynamics365/business-central/localfunctionality/unitedstates/how-to-set-up-use-tax-and-purchase-tax
- https://learn.microsoft.com/en-ca/dynamics365/business-central/localfunctionality/canada/ca-sales-tax

### Odoo
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/taxes.html
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/taxes/fiscal_positions.html
- https://www.odoo.com/documentation/18.0/applications/finance/fiscal_localizations.html
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/tax_returns.html
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/taxes/avatax.html
- https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_tax.py

### Xero
- https://developer.xero.com/documentation/api/accounting/taxrates
- https://developer.xero.com/documentation/api/accounting/types (ReportTaxType enum)
- https://developer.xero.com/documentation/api/accounting/contacts (per-contact AR/AP tax types)
- https://github.com/XeroAPI/Xero-NetStandard/blob/master/Xero.NetStandard.OAuth2/Model/Accounting/TaxRate.cs
- https://www.xero.com/us/media-releases/xero-avalara-launch-auto-sales-tax/
- https://central.xero.com/s/article/The-VAT-Return

### Tax engines
- https://developer.avalara.com/api-reference/avatax/rest/v2/methods/Transactions/CreateTransaction/
- https://developer.avalara.com/api-reference/avatax/rest/v2/methods/Nexus/
- https://developer.avalara.com/erp-integration-guide/ (when to calculate, address validation, outage fallback)
- https://developer.avalara.com/avatax/dev-guide/reconciliation/modifying-a-transaction/
- https://developer.avalara.com/avatax/errors/DocumentCodeConflict/
- https://help.avalara.com/Frequently_Asked_Questions/Tax_Calculation_FAQ/What_is_the_difference_between_Document_and_Line_level_rounding
- https://www.avalara.com/blog/en/north-america/2025/06/states-eliminating-economic-nexus-transaction-thresholds.html
- https://developer.avalara.com/products/returns/
- https://docs.stripe.com/tax/registrations-api and https://docs.stripe.com/tax/custom
- https://developer.vertexinc.com/oseries/reference/salepost
