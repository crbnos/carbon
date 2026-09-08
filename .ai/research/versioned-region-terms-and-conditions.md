# Versioned, Region-Specific Terms & Conditions Research: Best Practices Survey

## Summary

Surveyed how SAP (ECC + S/4HANA), NetSuite, Coupa, Oracle Fusion Procurement, Dynamics 365 (F&O + Business Central), and Odoo attach terms & conditions text to outgoing purchasing and sales documents, how they vary that text by country/region, and whether they version or effective-date it. Consensus: every tool models T&C as **standing text scoped to an organizational entity** (purchasing org, subsidiary, legal entity, procurement business unit), joined to the document **at render time**, never stored per document. Language variants are first-class in SAP and Oracle Fusion; **jurisdiction-specific content selection is never a delivered feature** — it is done via per-country form templates, form logic, or regional addenda inside one legal document. **No surveyed tool has native versioning or effective dating of terms text**, and none records "terms version applied" on the transaction; the audit burden is met by archiving rendered output (SAP NAST/ArchiveLink) or by buyer-hosted, dated web terms incorporated by reference. A product that versions terms with effective dates therefore exceeds all surveyed competitors on exactly the evidentiary gap legal practice identifies.

## Competitors Surveyed

- **SAP S/4HANA / ECC** — the enterprise reference; richest text-determination machinery (SO10 standard texts, VOTXN, BRF+ output determination).
- **NetSuite** — closest architectural cousin to Carbon's document-template approach (Advanced PDF/HTML Templates).
- **Coupa** — procurement point solution; shows how pure-procurement tools and their customers actually deliver PO terms.
- **Oracle Fusion Procurement** — the most explicit delivered data model ("Purchasing Terms and Conditions" per procurement BU × language).
- **Dynamics 365 F&O / Business Central, Odoo** — breadth checks.

## Key Consensus Patterns

### 1. T&C is standing text, separate from the document, joined at print time
- **SAP**: SO10 "standard texts" (tables STXH/STXL) INCLUDEd into the print form; the PO row (EKKO) never contains the T&C. The classic SO10 use case named in SAP community guidance is literally "terms & conditions of Purchase Orders … printed at the end of the Purchase order". Footer terms text name is stored per purchasing org (T024E-TXFUS).
- **NetSuite**: T&C is static content in the Advanced PDF/HTML template, "commonly a multi-page PDF form, such as an additional page displaying terms and conditions", or a custom body field referenced via FreeMarker.
- **Oracle Fusion**: a dedicated "Define Purchasing Terms and Conditions" object per procurement business unit; "standard terms and conditions are included with each purchasing document sent to the supplier".
- **Odoo**: "Default Terms & Conditions" setting — text at the bottom of the document, or a link to an editable web page.
- **Rationale**: legal boilerplate changes on its own cadence; coupling it to document data would force re-entry per document and make company-wide updates impossible.

### 2. Region variation = scoping entity or per-country form variant, never per-document choice
- **SAP**: language variants are automatic (vendor master language → EKKO-SPRAS → output language resolves the same named text per language). Legally different content per country is consultant convention: per-country SO10 includes selected by form logic on vendor country (LFA1-LAND1), or BRF+ decision tables selecting a different form template entirely by company code / purchasing org / supplier.
- **NetSuite**: subsidiary-specific transaction form + template pairs; Advanced Localization Features SuiteApp adds subsidiary-scoped standing text ("Tax Compliance Text", "Labels and Notes") and country-specific template SuiteApps.
- **Coupa customers** (WEX, PwC, Reddit): one buyer-hosted terms document with **regional addenda that "prevail over general terms in case of conflict"**, or separate per-country terms pages — region handled inside the legal document, not by the tool.
- **Rationale**: the tools lack a country dimension on the terms object, so users bend whatever scoping entity exists. A tool with a real country/country-group dimension on the terms record removes the workaround.

### 3. No versioning or effective dating anywhere; audit = archive the rendered output
- **SAP**: SO10 texts have no version history (STXH carries only last-changed user/date; table logging captures who/when, never content). The audit answer is the archived rendered print stream (NAST message records + ArchiveLink storage mode 3 "print and archive"; S/4HANA output items in KPro).
- **NetSuite**: templates are single mutable artifacts edited in place; a template edit retroactively changes how historical transactions re-print. ALF docs warn to "Save as" to avoid overwrites — duplication is the only mitigation.
- **Coupa / Odoo / D365 / Fusion**: none surfaced any effective dating; universal workaround is dated versions of the hosted legal document with a manual cutover.
- **Rationale (legal)**: "Problems of proof may arise … as to which set of terms and conditions was in effect at the time the contract was made" — recommended practice is archived, clearly dated versions (Brooks Pierce enforceability analysis). Tools don't do this, so compliance teams do it by hand.

### 4. Delivery: final page / reverse side / incorporation by reference
- **SAP**: duplex print-mode page alternation (FRONT/BACK pages, T&C in a secondary window on BACK) for "on the back"; `NEW-PAGE LAST` for a trailing T&C page; modern channels attach a T&C PDF alongside the output email.
- **Dominant modern pattern** (Coupa ecosystem): short, conspicuous incorporation-by-reference clause on the PO face with a full URL to buyer-hosted terms — enforceable when the reference is clear, specific, and the counterparty has notice and access.
- **Trailing full-text page** remains standard where the document must be self-contained (NetSuite multi-page templates, SAP trailing page) — which is Carbon's current model.

## Answers to Research Questions

1. **How is T&C text attached to POs/sales docs?** — Standing named text joined at render time by the form/output layer (SAP SO10 + text determination; NetSuite template content; Fusion per-BU terms object). Never a column on the order.
2. **How is per-country selection done?** — Not natively. Per-country form variants (SAP BRF+ / NetSuite subsidiary forms), form logic on vendor country, or regional addenda inside one document (Coupa customers). Language (not jurisdiction) selection is the only automatic dimension (SAP, Fusion).
3. **Is terms text versioned/effective-dated?** — No, in every surveyed tool. SAP explicitly has no SO10 version history; NetSuite templates mutate in place.
4. **How is "which terms went with PO X" audited?** — SAP: archived rendered output per issuance (NAST + ArchiveLink / S/4HANA output items). Everyone else: dated archived copies of the hosted terms document, maintained manually by the buyer's legal team.
5. **Standard terminology?** — "Standard text" (SAP), "Terms and Conditions" / "standard terms and conditions" (Oracle Fusion, Odoo, Coupa), "footer text" (D365 F&O). "Terms" alone is ambiguous — in NetSuite and Coupa, "Terms"/"Payment Term" on the PO means **payment terms**, a different object. Use "Terms & Conditions" and keep it distinct from `paymentTerm`.

## Competitor-Specific Details

### SAP
- Text addressing: text object (EKKO, VBBK, KNA1, TEXT…) + 4-char text ID + language. MM config "Define Texts for Purchase Order" maps text ID → **print sequence** (position in output). SD uses VOTXN text determination procedures with access sequences (customer sales text KNVV falls back to general KNA1) and ABAP requirement routines.
- SAP's own supplier portal maintains one T&C legal document per country — even SAP-the-company does per-country terms as separate documents.
- Copy-into-document-text (copying rules from vendor master / info record) is the one mechanism that freezes terms content per document — the frozen copy lives in the PO's own long text, independent of later SO10 edits.

### NetSuite
- Standard Purchase template's free-form per-transaction text = "Vendor Message" + "Memo" only; legal T&C is template content. Printing is on-demand — historical POs re-render with the current template.

### Coupa
- POs reach suppliers as structured records (CSP / cXML / email-HTML); the annotated sample cXML PO contains **no terms element at all**. Buyer-side terms settings are login-gated admin config; the well-evidenced customer pattern is hosted web terms incorporated by reference with regional addenda.

### Oracle Fusion
- Cleanest delivered model: terms per procurement BU, maintainable in all installed languages, with a per-language disable flag; contract terms layout (BI Publisher) selected per document type per BU. Splits "terms" (pricing/payment) from "conditions" (delivery/acceptance/cancellation).

## Recommended Approach for Carbon

1. **Keep the trailing-page render model** (existing `terms` block, forced page break, final page) — it matches SAP/NetSuite practice and the requirement's "back or final page"; duplex-reverse printing is a printer concern no modern PDF pipeline owns.
2. **Add the dimension no competitor has as data**: a company-scoped, effective-dated terms version record with an optional country / country-group scope, resolved at render time by counterparty country + document date. This follows Oracle Fusion's "terms object per scope" shape while adding the effective dating every tool lacks and legal practice demands.
3. **Resolution ladder, most-specific wins**: country > country group > global — the `customerItemPriceOverride` specificity pattern already in Carbon, not SAP's priority integers.
4. **Resolve by document issue date, not print date** — reprints stay stable, which is the closest cheap equivalent to SAP's archive-the-output audit answer; stamping the applied version id on the document is the natural future increment.
5. **Never block printing on a terms gap** — quiet fallback down the ladder (matches every competitor: a missing text renders as absent, never as an error).
6. Keep "Terms & Conditions" naming; never conflate with `paymentTerm`.

## Sources

- https://community.sap.com/t5/technology-q-a/standard-text/qaq-p/3969345
- https://portsapblogging.com/2015/06/02/sap-standard-text-functionality-transaction-so10/
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/how-to-enable-texts-to-be-displayed-on-the-purchase-order-outputs/ba-p/13689397
- https://www.guru99.com/text-determination-for-sales-document-header-item.html
- https://blogs.sap.com/2021/06/28/purchase-order-output-management-via-brf-in-s4/
- https://community.sap.com/t5/enterprise-resource-planning-q-a/standard-text-so10-purchase-order/qaq-p/4378346
- https://community.sap.com/t5/technology-q-a/change-log-for-standard-text-so10/qaq-p/5317277
- https://userapps.support.sap.com/sap/support/knowledge/en/2117069
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/output-management-in-sap-s-4hana/ba-p/13492419
- https://community.sap.com/t5/technology-q-a/print-terms-and-conditions-on-back-side-in-smart-forms/qaq-p/3966467
- https://www.sap.com/about/agreements/sap-supplier-portal/terms-and-conditions.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2407704.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/SBADVTemplates_2821420917.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_160691067358.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_160699699623.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159341790758.html
- https://compass.coupa.com/en-us/products/product-documentation/supplier-resources/for-suppliers/coupa-supplier-portal/set-up-the-csp/purchase-orders/about-purchase-orders
- https://compass.coupa.com/en-us/products/product-documentation/supplier-resources/for-suppliers/coupa-supplier-portal/set-up-the-csp/purchase-orders/sample-cxml-purchase-order-with-annotations
- https://www.wexinc.com/vendors/purchase-order-terms-and-conditions/
- https://www.pwc.co.uk/who-we-are/supplier-policies/coupa/general-terms-conditions.html
- https://docs.oracle.com/cd/E28271_01/fusionapps.1111/e20383/F274737AN3575E.htm
- https://learn.microsoft.com/es-es/previous-versions/dynamicsax-2012/appuser-itpro/about-footer-text-for-purchase-orders-and-purchasing-documents
- https://learn.microsoft.com/en-us/dynamics365/business-central/ui-manage-report-layouts
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/terms_conditions.html
- https://www.brookspierce.com/publication-Enforceability-of-Online-Terms-and-Conditions-Incorporated-into-a-Written-Contract
- https://www.acc.com/resource-library/battle-forms-sellers-terms-vs-buyers-purchase-order-united-states
