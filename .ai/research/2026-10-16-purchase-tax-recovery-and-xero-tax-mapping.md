# Purchase Tax Recovery and Xero Tax-Rate Mapping Research: Best Practices Survey

## Summary

This survey asks two questions. First, how do ERPs decide which purchase tax a company can recover, and how do they post each part? Second, how do apps that push documents to Xero map their tax rates to Xero tax rates, so that the Xero VAT return is correct?

All five ERPs surveyed put recoverability on the tax code (or on the setup row that a tax code resolves to). None puts it on the item, the GL account, the supplier or the whole company. Recoverable tax posts to its own input-tax account. Non-recoverable tax goes into the line's cost, or to a separate expense account.

Every Xero integration surveyed sends a real Xero `TaxType` read from the organisation. The Xero VAT return places each line by the `ReportTaxType` of its rate. So a line sent with `NONE` never reaches box 4 or box 7.

Carbon has no tax code entity today. A line holds only `taxPercent`. Carbon adds all purchase tax to cost. Carbon sends Xero bills with `TaxType: "NONE"` and sales invoices with the hard-coded `TaxType: "OUTPUT"`, which is not a valid code in a UK organisation. The July draft spec (now `.ai/specs/archived/2026-07-03-multi-jurisdiction-tax.md`) already designs a `taxCode` with an `isRecoverable` flag and a Xero mapping (its Phase 3). None of that spec has shipped except the sales-side tax liability posting.

## Competitors Surveyed

- **SAP S/4HANA** — the enterprise reference for tax codes, account keys and pro rata recovery.
- **Oracle NetSuite** — SuiteTax tax types and tax codes, use tax and reverse charge.
- **Microsoft Dynamics 365 Business Central** — non-deductible VAT (2023 wave 1) and US sales tax "Expense/Capitalize".
- **Odoo 17/18** — tax distribution lines that split one tax across accounts.
- **Acumatica** — partially deductible VAT on the tax code.
- **Katana MRP, MRPeasy, Unleashed, Cin7 Core, Dext, A2X** — manufacturing and inventory apps that push documents to Xero. They show how a Carbon-sized app maps tax rates.
- **Xero and QuickBooks Online APIs** — the targets of the mapping.

## Key Consensus Patterns

### 1. Recoverability lives on the tax code

- **SAP**: The tax code holds condition types. Each condition type has an account key. `VST` is deductible input tax. `NAV` and `NVV` are non-deductible input tax.
- **NetSuite**: The tax type holds the fixed flag "Post to Item Cost". Each tax code points to one tax type.
- **Business Central**: The VAT Posting Setup row (one business group × one product group) holds "Non-Deductible VAT %". US sales tax uses the "Expense/Capitalize" flag on the Tax Detail.
- **Odoo**: The tax holds distribution lines. A line with no account sends that share to the bill line's expense account.
- **Acumatica**: The tax code holds "Partially Deductible VAT" and a "Deductible Tax Rate" per schedule row.
- **Rationale**: Recoverability depends on the kind of tax and the kind of purchase, not on one document. A code makes the decision repeatable and auditable. When products differ (a car against raw material), each system picks a different code. It never adds a flag on the item.

### 2. Recoverable tax posts to its own account

- **SAP**: `VST` posts to the input-tax account. Output tax uses its own account.
- **NetSuite**: The tax type names a Receivables Account and a Payables Account per nexus.
- **Business Central**: "Purchase VAT Account" on the VAT Posting Setup row, plus an optional "Non-Deductible Purchase VAT Account".
- **Odoo**: The deductible distribution line posts to the VAT receivable account (Belgium: 411000).
- **Acumatica**: "Tax Claimable Account" for the recoverable part, "Tax Payable Account" for output tax.
- **Xero**: A UK organisation posts input VAT and output VAT to one "VAT" control account. The balance is the net amount that the company owes HMRC.
- **Rationale**: Recoverable tax is a receivable from the tax authority. It is not part of the cost of the goods. If it goes into cost, inventory and expense are too high by the tax. SAP, NetSuite, Business Central, Odoo and Acumatica keep input tax and output tax apart. Xero nets them in one account.

### 3. Non-recoverable tax goes into cost, or to a separate expense account

| System | Into the line's cost | To a separate expense account |
|---|---|---|
| SAP | `NVV` (adds to stock value at goods receipt) | `NAV` |
| NetSuite | "Post to Item Cost" | Legacy: Nondeductible Expense Account |
| Business Central | "Use For Item Cost" / "Use For Fixed Asset Cost" / "Use For Job Cost" | "Non-Deductible Purchase VAT Account" |
| Odoo | No (needs landed cost) | The bill line's expense account |
| Acumatica | No (needs landed cost) | "Tax Expense Account" |

- **Rationale**: US sales tax on purchases is a cost of the goods. SAP, NetSuite and Business Central add it to inventory value. Carbon does this today for all purchase tax.

### 4. Partial recovery is a percentage on the code, or two codes

- **SAP**: One tax code holds a deductible rate and a non-deductible rate. S/4HANA also has a pro rata coefficient per company and date, with a year-end adjustment.
- **Business Central**: "Non-Deductible VAT %" on the setup row.
- **Acumatica**: "Deductible Tax Rate" on the tax schedule.
- **Odoo**: Any split across distribution lines (Belgium ships a 21% car tax that is 50% non-deductible).
- **NetSuite**: No percentage field. The user makes two codes (for 20% VAT at 60% deductible: 12% deductible plus 8% non-deductible) and combines them in a tax group.
- **Rationale**: A UK company can reclaim only 50% of the VAT on a car lease, and none on business entertainment. A partly exempt business reclaims a share of all input VAT. Only SAP models that share as a coefficient.

### 5. Use tax and reverse charge are two entries that net to zero

- **SAP**: Reverse charge uses `ESA` (output) and `ESE` (input) on one code. US use tax (U1) accrues a liability and puts the tax into cost.
- **NetSuite**: A "Reverse Charge" tax type writes offsetting lines. With "Post to Item Cost" as well, it is use tax.
- **Business Central**: "VAT Calculation Type = Reverse Charge VAT" on the setup row. US use tax is a Tax Type on the Tax Detail.
- **Rationale**: The supplier charges no tax. The buyer accounts for it. Recoverable reverse charge nets to zero. Non-recoverable reverse charge (US use tax) becomes a cost and a liability.

### 6. Xero integrations map each rate to a Xero `TaxType` read from the organisation

- **Katana**: Keeps its own tax rates. A setup step maps every Katana rate to a Xero rate. Setup does not continue until the user maps every rate.
- **Unleashed**: Imports Xero's rates. Each rate is either Sales or Purchase. A document with an unmapped rate fails to export.
- **Cin7 Core**: Imports Xero's rates. An unmapped rate is not synced; Cin7 adds an adjustment so that the total is right.
- **MRPeasy**: Matches by percentage. If several Xero rates have the same percentage, the user picks the rate in Xero.
- **Dext**: Takes all rates from Xero and sends its own tax amount by default.
- **Xero**: For app certification, an app that posts tax "is required to use the tax rates present in Xero".
- **Rationale**: The `TaxType` codes differ by region (UK `OUTPUT2`, AU `OUTPUT`, US a GUID) and by organisation (custom rates are `TAX001`, `TAX002`). Only a GET `/TaxRates` on the organisation gives the valid set.

## Answers to Research Questions

1. **Where does recoverability live?** — On the tax code in all five ERPs (SAP, NetSuite, Business Central, Odoo, Acumatica). Xero's `IsNonRecoverable`, which applies only in Canada, is also on the rate. Never on the line, item, account or supplier. A product difference selects a different code.
2. **How do they post each part?** — Recoverable tax goes to an input-tax account. Non-recoverable tax goes into the line's cost (SAP `NVV`, NetSuite, Business Central) or to an expense account (SAP `NAV`, Odoo, Acumatica). Xero UK nets input and output VAT in one control account.
3. **Is partial recovery supported?** — Yes, as a percentage on the code (Business Central, Acumatica, Odoo, SAP) or as two codes (NetSuite). Only SAP has a pro rata coefficient with a year-end adjustment.
4. **How do Xero integrations map tax?** — Katana keeps its own rates and maps each one. Unleashed, Cin7 Core and Dext import Xero's rates. MRPeasy matches by percentage. Katana and Unleashed block the sync when a rate has no mapping.
5. **What does Xero need for a correct VAT return?** — Each line needs a valid `TaxType` of the organisation. The rate's `ReportTaxType` puts the line in the return boxes. `NONE` ("No VAT") puts the line in no box. Plain `OUTPUT` and `INPUT` are not valid UK `TaxType` codes. In the UK they exist only as `ReportTaxType` values.
6. **What about QuickBooks Online?** — A non-US line carries a `TaxCodeRef`. A UK `TaxRate` carries `TaxReturnLineRef` for the VAT return. A US company with automated sales tax uses only `TAX` and `NON`. QBO has no partial recovery; users make a second code. Carbon's QBO invoice sync already matches each `taxPercent` to one QBO code at run time (`invoice-tax.ts`). Carbon's QBO bill sync sends no tax.
7. **What is the standard term?** — SAP, Business Central, Acumatica and Odoo say "deductible" and "non-deductible". Business Central US sales tax and Xero say "recoverable" and "non-recoverable". The two pairs mean the same thing. "Claimable" is Acumatica's word for the account.

## Competitor-Specific Details

### SAP S/4HANA

- A country tax calculation procedure (`TAXD`, `TAXUSJ`, `TAXUSX`) holds condition types. Each condition type maps to an account key.
- Purchasing chooses the tax code through condition records (`FV11`). The material's tax indicator and the plant are inputs.
- Pro rata VAT applies a dated coefficient per company code. A year-end step adjusts the postings to the final coefficient.

### Oracle NetSuite

- "Post to Item Cost" and "Reverse Charge" are flags on the tax type. You cannot change them after you save the tax type.
- SuiteTax creates US use tax types automatically, as self-assessed and not claimable.
- NetSuite does not create non-deductible codes for you.

### Microsoft Dynamics 365 Business Central

- You turn on "Enable Non-Deductible VAT" once. You cannot turn it off.
- The company-level flags "Use For Item Cost", "Use For Fixed Asset Cost" and "Use For Job Cost" decide where the non-deductible part goes.
- The VAT Entry row stores "Non-Deductible VAT Base" and "Non-Deductible VAT Amount" apart from the deductible amounts.
- US sales tax uses Tax Area → Tax Jurisdiction → Tax Detail. "Expense/Capitalize" is yes or no, with no percentage.

### Odoo 17/18

- Each tax has a "Distribution for Invoices" and a "Distribution for Refunds" table. The tax shares add to 100%. Reverse charge adds lines that add to −100%.
- A fiscal position swaps the domestic tax for a reverse-charge tax per partner.
- Purchase taxes do not reach product cost. Users add them through landed cost.

### Acumatica

- Tax Type is Sales, Use, VAT or Withholding.
- "Partially Deductible VAT" forces the tax to be inclusive at line level.
- The tax holds three accounts: Tax Payable, Tax Claimable and Tax Expense.
- Acumatica's help texts do not agree on the meaning of the "Use Tax Expense Account" check box. This survey did not resolve it.

### Xero API

- GET `/TaxRates` returns `Name`, `TaxType`, `ReportTaxType`, `Status`, `EffectiveRate`, `TaxComponents` and the `CanApplyToRevenue` / `CanApplyToExpenses` / `CanApplyToAssets` / `CanApplyToLiabilities` / `CanApplyToEquity` flags. Carbon's Xero connection already has the `accounting.settings` scope.
- UK codes include `OUTPUT2` / `INPUT2` (20%), `RROUTPUT` / `RRINPUT` (5%), `ZERORATEDOUTPUT` / `ZERORATEDINPUT`, `EXEMPTOUTPUT` / `EXEMPTINPUT`, `ECACQUISITIONS`, `REVERSECHARGES`, `DRCHARGE20`, `CAPEXINPUT2` and `NONE`.
- If a line omits `TaxType`, Xero uses the default rate of the line's account. Xero ignores the contact's default tax type on API documents.
- A line can override `TaxAmount`. The only documented limit is that the tax cannot be greater than the unit amount. Xero asks apps not to send tax amounts without talking to Xero first.
- Xero rounds tax per line to 2 decimal places.
- A sales rate on an expense account fails with "The TaxType code 'xxx' cannot be used with account code 'xxx'."
- `IsNonRecoverable` on a tax component applies only to Canadian organisations. UK, AU and NZ have no partial recovery in the API. An app splits the line instead.
- Xero US organisations default to `OUTPUT`, `INPUT` and `NONE` at 0%. Xero tells US apps to create a rate per jurisdiction. A created rate gets a `TaxType` such as `TAX001`.

### Xero integrations

- **Katana** keeps its own rates. Its advice is to make one rate for purchases and one for sales and map both to the Xero rate. Katana sends no tax amount and lets Xero compute it. Katana says that tax never affects inventory value.
- **Unleashed** copies Xero's per-line rounding. It refuses one code for both sales and purchases.
- **Dext** offers three settings: send its own tax amount, send it with exceptions, or let Xero compute.
- **Common errors**: an invalid `TaxType`, a rate that does not suit the account, and one-cent drift between per-line and per-invoice rounding.

### QuickBooks Online

- A non-US `TaxCode` holds a `SalesTaxRateList` and a `PurchaseTaxRateList`.
- QBO computes tax on the total of the taxable lines, not per line.
- A `ReadOnly` rate rejects a tax override with error -37100.

## Recommended Approach for Carbon

1. **Put recoverability on a tax code, not on a line, an item or the company.** This follows all five ERPs. It matches the `taxCode` / `taxCodeComponent` design in the July spec (now `.ai/specs/archived/2026-07-03-multi-jurisdiction-tax.md`). The default is non-recoverable, so today's postings do not change until a company sets up a recoverable code.
2. **Store a non-recoverable percentage on the code, from 0 to 100.** This follows Business Central and Acumatica. It is simpler than NetSuite's two codes, and it covers the 50% car-lease case. Leave SAP's pro rata coefficient out of scope.
3. **Post each part of purchase tax as SAP, NetSuite and Business Central do.** (Update 2026-10-16: the grill chose Odoo's account names. The input-tax account below is "Tax Paid", `taxPaidAccount`. See `.ai/specs/2026-10-16-multi-jurisdiction-tax.md`.)

   | Amount on the purchase line | Debit | Credit |
   |---|---|---|
   | Net cost | Line cost (inventory or expense) | AP |
   | Recoverable part of the tax | Input-tax account | AP |
   | Non-recoverable part of the tax | Line cost (inventory or expense) — today's behaviour | AP |

   AP gets the gross amount, as it does today.

   The input-tax account comes from the code, then falls back to `accountDefault.purchaseTaxPayableAccount`. Today the seed data names that account 2220 "Purchase Tax Payable" and makes it a Liability. Rename it to an input-tax receivable and make it a current asset. A company that wants one VAT control account points both tax defaults at the same account, as Xero does.
4. **Map each Carbon tax code to a Xero `TaxType`, once for sales and once for purchases.** This follows Katana. Read the choices from GET `/TaxRates`. Show only `ACTIVE` rates, and filter them by `CanApplyToRevenue` for sales and `CanApplyToExpenses` for purchases. Store the mapping in `externalIntegrationMapping` with a new entity type. Add a "Tax Rates" tab to the integration drawer that copies `DimensionMapping.tsx`.
5. **Block a document with an unmapped code with a structured warning.** This follows Katana and Unleashed. Use the same Warning shape as `UNMAPPED_ACCOUNTS`, with a new code such as `UNMAPPED_TAX_RATES`. Cin7's "sync anyway with an adjustment" keeps the total right, but it puts the VAT in the wrong box.
6. **Send bills with tax.** Each bill line sends the net amount, the recoverable tax and the mapped purchase `TaxType`. If a line has a non-recoverable part, send that part on a second line at `NONE` and code it to the account the journal charged. Xero allows one `TaxType` per line, so a partly recoverable line becomes two Xero lines.
7. **Keep sending Carbon's own tax amount on each line.** Check that the amount equals `round(net × rate)` within one minor unit, as `quickbooks-online/entities/invoice-tax.ts` does. Carbon rounds per line, as Xero does, so the totals match the posted journal. Xero's "do not send tax amounts" request is an open question.
8. **Fix the hard-coded `TaxType: "OUTPUT"` on sales invoices first, as a smaller step.** Until a tax code exists, match each line's `taxPercent` to one active Xero revenue rate with that `EffectiveRate`. This is the MRPeasy approach, and it is what Carbon's QBO invoice sync already does. If no rate matches, or more than one does, raise the warning. This step fixes UK and AU invoices without the tax code work. It cannot fix bills, because recoverability needs the code.

## Open Questions

1. Xero asks apps not to send tax amounts without talking to Xero first. Does Carbon keep sending them, or let Xero compute and accept one-cent drift against the journal?
2. Does a non-recoverable UK purchase belong in box 7 (net purchases)? Practitioner sources say a "No VAT" line reaches no box. Confirm with a UK accountant before Carbon chooses `NONE` against a zero-rated or exempt rate.
3. How does a Carbon tax code reach a purchase line? The July spec sets a default code on the supplier. The supplier's invoice decides the amount.
4. Should this work deliver only the slice of the July spec that recovery and Xero need (codes, the recoverable split, the mapping)? Or should it deliver all of that spec's Phase 1 (tax ledger, liability report, customer location codes)?
5. Do credit notes and debit memos carry tax in the same change? Today a Carbon memo has no tax, and Xero gets `NONE`.

## Sources

- https://help.sap.com/docs/s4hana-best-practices/ycoa-1f2ae10b96f740759d66e695f953aa8f/nav-non-deduct-input-tax
- https://community.sap.com/t5/enterprise-resource-planning-q-a/difference-between-account-key-nav-and-nvv-in-t-code-obcn/qaq-p/9506986
- https://community.sap.com/t5/enterprise-resource-planning-q-a/create-tax-code-non-deductable/qaq-p/6090654
- https://community.sap.com/t5/enterprise-resource-planning-q-a/tax-calculation-in-sap/qaq-p/10750221
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/4603118feda9495892abadbe8f8c3d14/af04086ea7884cb6b180089e90f76afc.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/3ea5a1e277894aaebae7baee564040ba/c185d837dc5a4eb4b042d3054ef48555.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/47201366da8a460faad26dfe2c0b36a2/951b1e7c31e840699232ebdc68b5b02e.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/a624a4a6d1d8473eb95fb42660127cfe/8278b228bc4f4c2ca5b3cb84739f42b0.html
- https://community.sap.com/t5/enterprise-resource-planning-q-a/non-deductible-tax-amount-is-not-getting-posted-to-a-specific-g-l-during/qaq-p/11444602
- https://www.thomsonreuters.com/content/dam/helpandsupp/en-us/Topics/os-determination/files/integrations/US_CA_configuration_guide_ONESOURCE_IDT_Integration_SAP_5231B.pdf
- https://blogs.sap.com/2022/03/15/usa-sales-and-use-tax-basics-for-mm-consultant/
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4283869397.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1805973.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1822730.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0610121020.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_160639645021.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_164250053764.html
- https://learn.microsoft.com/en-us/dynamics365/business-central/finance-setup-nondeductible-vat
- https://learn.microsoft.com/en-gb/dynamics365/business-central/design-details-nondeductible-vat
- https://learn.microsoft.com/en-us/dynamics365/business-central/finance-how-use-non-deductible-vat
- https://learn.microsoft.com/en-gb/dynamics365/release-plan/2023wave1/smb/dynamics365-business-central/non-deductible-partly-deductible-vat-expands-functionality
- https://learn.microsoft.com/en-us/dynamics365/business-central/finance-setup-vat
- https://learn.microsoft.com/en-us/dynamics365/business-central/localfunctionality/unitedstates/how-to-set-up-use-tax-and-purchase-tax
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/taxes.html
- https://www.odoo.com/documentation/18.0/developer/reference/standard_modules/account/account_tax.html
- https://www.odoo.com/documentation/18.0/developer/reference/standard_modules/account/account_tax_repartition.html
- https://www.odoo.com/documentation/18.0/applications/finance/fiscal_localizations/belgium.html
- https://www.odoo.com/forum/help-1/taxes-are-not-including-in-the-product-cost-279444
- https://help.acumatica.com/(W(31))/Wiki/ShowWiki.aspx?pageid=692e30c9-e0af-4aa3-b0f6-f3ba190d257a
- https://martinandassoc.com/wp-content/uploads/2023/01/AcumaticaERP_5.3_Release_Notes.pdf
- https://community.acumatica.com/financials-7/taxes-on-po-invoice-not-posting-to-inventory-8909
- https://developer.xero.com/documentation/api/accounting/taxrates
- https://developer.xero.com/documentation/api/accounting/types
- https://developer.xero.com/documentation/api/accounting/invoices
- https://developer.xero.com/documentation/best-practices/data-integrity/taxes
- https://developer.xero.com/documentation/guides/how-to-guides/rounding-in-xero/
- https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml
- https://www.plusaccounting.co.uk/knowledge/blog/vat-entries-in-xero-no-vat-posting/
- https://co-accounting.co.uk/qanda/what-is-the-difference-between-zero-rated-expenses-and-no-vat-on-xero-vat-settings
- https://help.fergus.com/en/articles/6750465
- https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/taxcode
- https://developer.intuit.com/app/developer/qbo/docs/workflows/calculate-sales-tax/automated-sales-tax-for-non-us-locales
- https://developer.intuit.com/app/developer/qbo/docs/workflows/calculate-sales-tax/automated-sales-tax-for-us-locales
- https://quickbooks.intuit.com/community/vat-30/vat-partial-exemption-123041
- https://support.katanamrp.com/en/articles/5968152-mapping-xero-tax-rates
- https://support.katanamrp.com/en/articles/5968147-syncing-katana-sales-orders-to-xero-as-invoices
- https://support.katanamrp.com/en/articles/5967641-managing-tax-rates
- https://www.mrpeasy.com/resources/user-manual/settings/system/integration/xero/
- https://help-unleashed.theaccessgroup.com/en/articles/11582528-taxes
- https://help-unleashed.theaccessgroup.com/en/articles/11582217-troubleshoot-the-xero-integration
- https://help.core.cin7.com/hc/en-us/articles/9034574221071-Tax-rules
- https://help.core.cin7.com/hc/en-us/articles/13000995557263-Sync-sales-with-Xero
- https://help.dext.com/en/articles/339546-publishing-tax-data-to-xero
- https://help.dext.com/en/articles/525943-managing-tax-settings-for-canadian-xero-users-in-dext
- https://support.a2xaccounting.com/en/articles/6150217-vat-mapping-for-uk-vat-registered-users-amazon-and-shopify
- https://helpdesk.datamolino.com/en/articles/1519157-xero-export-error-the-taxtype-code-cannot-be-used-with-account-code
