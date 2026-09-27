# Card-Transaction Merchant Modeling Research: Best Practices Survey

> Research date: 2026-09-17. Question: how should Carbon model the **merchant** of a
> Ramp card transaction relative to the AP `supplier` master? Carbon currently
> auto-creates **one `supplier` per distinct merchant**, tagged with a `"Card Merchant"`
> `supplierType` (`resolveMerchantSupplier` in `packages/ee/src/ramp/lib/suppliers.ts`).

## Summary

Surveyed the GL systems Carbon competes with / integrates as (SAP S/4HANA + Concur,
NetSuite, Sage Intacct, QuickBooks Online, Xero) and the spend platforms that feed
them (Ramp, Brex, Bill.com/Divvy, Airbase/Airwallex). **The consensus is decisive and
runs against Carbon's current design: nobody creates one AP vendor per card merchant by
default.** The merchant is treated as *transaction metadata* — an enriched, normalized
descriptor that drives **GL-account coding**, not a per-merchant master record. Where a
vendor field is structurally required (Xero, and the QBO/NetSuite payee slot Ramp fills),
the standard mitigations are (a) **match** to an existing supplier, or (b) collapse the
long tail to a **single catch-all/default vendor** — never mint one per merchant. Ramp's
own accounting-provider contract makes **vendor optional** and only requires GL accounts +
entities. The one system that *forces* merchant→contact (Xero's mandatory Contact on a
SPEND) is widely cited as a pain point with an open feature request to relax it — i.e.
Carbon has independently reproduced Xero's worst-reviewed behavior.

## Competitors Surveyed

- **SAP S/4HANA + Concur** — enterprise reference; splits "merchant bought from" from
  "card paid with" via a credit-card **clearing GL account**; Concur carries merchant as
  **free-text**, never a BP/vendor master row.
- **NetSuite** — Credit Card Charge posts to the card **GL account**; payee/vendor is
  **optional**; customers use a handful of generic category vendors, not per-merchant.
- **Sage Intacct** — one **card-issuer vendor** per card for payoff; individual charges
  post to GL with an **optional payee/description**; merchant arrives as description.
- **QuickBooks Online** — payee is **optional everywhere** (API `Purchase.EntityRef`
  `minOccurs=0`, Expense UI, bank rules); card spend codes to an account with no vendor.
- **Xero** — the outlier: **Contact is mandatory** on a SPEND `BankTransaction` (API + UI),
  so unmatched merchants spawn contacts; mitigated only by Cash Coding / bank rules.
- **Ramp / Brex / Bill.com / Airbase** — the source layer; keep **merchant** as a distinct
  enriched entity separate from **vendor**, code by merchant→GL-account, and default the
  one-off tail to a catch-all vendor (or make vendor auto-creation opt-in).

## Key Consensus Patterns

### 1. Merchant is transaction metadata, not an AP master record
- **SAP/Concur**: expense "Merchant Name" is descriptive free text imported from the card
  feed, not a business-partner lookup. Card settlement runs through a credit-card clearing
  GL account; the only vendor/BP is the issuing bank.
- **NetSuite**: merchant is the optional Vendor entity or a memo on the Credit Card Charge
  line; there is no separate merchant table.
- **Intacct**: merchant comes across as the charge **description**; the mapped vendor is the
  card issuer, used only at payoff.
- **QBO / Xero**: no distinct merchant object — a "payee"/"contact" is just a Name-List
  entry. QBO leaves it blank; Xero forces one.
- **Ramp / Brex**: explicitly two namespaces — **Merchant** (enriched from the network
  descriptor + MCC, attached to every card txn) vs **Vendor** (the AP/Bill-Pay + ERP
  record). Both expose them as separate API resources; Brex even ships a Merchant→Vendor
  mapping table.
- **Rationale**: a card merchant is a *thing you incidentally bought from once*, not a
  *counterparty you owe money to and pay through AP*. Conflating them pollutes the entity
  the AP workflow (bills, terms, 1099, remittance) depends on.

### 2. The primary coding axis is merchant → GL account, not merchant → vendor
- Ramp accounting rules create a **1-to-1 link from a Ramp field (Merchant or Category) to a
  GL account**, with merchant-mapping precedence over category. The merchant determines the
  **expense account**; the vendor field is filled separately (matched or defaulted).
- BILL/Divvy auto-categorizes card spend to a **QuickBooks expense category** by AI;
  categorization is category-driven, not vendor-per-merchant. AP bills (separate product)
  use real vendors.
- QBO/Xero bank rules map a merchant description string → **account code**, with contact
  optional (QBO) or a fixed/statement contact (Xero).
- **Rationale**: what accounting actually needs from a card charge is *which expense account*
  and *which dimensions* — the merchant name is enough to decide that; a vendor master row
  adds nothing to the posting.

### 3. When a vendor field is required, match-or-default — never one-per-merchant
- **Airbase/Airwallex**: existing merchants map to the matching vendor; **new/unknown
  merchants map to a single default vendor** (e.g. "Airwallex Expenses") *explicitly "to
  prevent the creation of duplicate or unnecessary vendors."*
- **Brex**: **"Vendor auto-creation" is a toggle**; off by default it uses mappings/matches,
  so merchants don't auto-pollute the vendor master.
- **Ramp**: tries to match the merchant to an existing GL vendor; the recommended way to
  keep the tail out of the vendor list is a **default vendor** (e.g. "Misc. Ramp Vendor")
  that fills the required field once, with `merchant_name` still riding on the transaction.
- **Rationale**: the vendor field is a downstream-format requirement of some GLs, not a
  reason to model each merchant. A single catch-all satisfies the schema without the tail.

### 4. Normalization/promotion lives in the spend layer, not the GL
- Merchant-name normalization (descriptor cleanup) and MCC categorization happen in
  Ramp/Brex/BILL **before** anything reaches the GL. MCC is unreliable (self-classified,
  one merchant spans codes), so best-in-class tools normalize the **name** first, then
  categorize — the ERP receives a clean result.
- "Promotion" of a one-off merchant into a real recurring vendor is done **manually / by
  convention** (SAP's P-card-against-a-PO case is the only place the merchant is genuinely a
  vendor master record) — no surveyed system has an automatic threshold/promotion feature.
- **Rationale**: Carbon already *receives* Ramp's normalized merchant, so it should not try
  to re-derive identity or fuzzy-merge — that risk (wrong permanent merges) is exactly why
  the current resolver only does exact-name matching.

## Answers to Research Questions

1. **Does the card feed create a vendor per merchant?** No, in every system except where a
   vendor field is structurally required, and even then it's match-or-default: QBO/NetSuite/
   Intacct/SAP make the payee optional and post to a card **GL account**; only Xero forces a
   Contact. Spend platforms keep merchant separate and default the tail. **Carbon's
   one-supplier-per-merchant is the minority behavior.**
2. **Is there a distinct "merchant" concept separate from the vendor master?** In the GLs,
   no (merchant = optional vendor/contact/memo). In the **spend platforms, yes** — Ramp and
   Brex model merchant and vendor as separate first-class entities.
3. **How is vendor-master pollution avoided?** Optional payee (QBO/NetSuite/Intacct), single
   default/catch-all vendor (Airbase, Ramp default-vendor pattern), opt-in auto-creation
   (Brex), or bank-rule fixed contact (Xero). None create per-merchant vendors.
4. **Auto-categorization without a vendor?** Yes — merchant→GL-account rules (Ramp), AI
   category coding (BILL), bank rules (QBO/Xero) all code the account independent of any
   vendor.
5. **Do spend platforms push merchants as vendors to the GL?** Only as a fallback to satisfy
   a required field, and increasingly behind a toggle or a single default vendor; the
   merchant primarily rides as `merchant_name` metadata and drives account coding.
6. **What does Ramp's accounting-provider contract require of the provider re: merchant?**
   **GL accounts and entities are "always required"; Accounting Vendors are "not required"**
   (an optional single-choice field). The merchant is a transaction attribute
   (`merchant_name`); Ramp does **not** require the provider (Carbon) to mint a vendor per
   merchant.

## Competitor-Specific Details

### Ramp (most load-bearing — Carbon IS a Ramp accounting provider)
- Merchant and Vendor are separate API resources; accounting rules explicitly "do not change
  how Ramp identifies or groups merchants."
- Provider integration registers coding-object types: **GL Accounts (required)**, **Entities
  (required)**, **Accounting Vendors (NOT required)**, Custom Fields (optional).
- Default-vendor pattern ("Misc. Ramp Vendor") is the documented way to keep one-off
  merchants out of the GL vendor list while filling a required vendor field.

### Xero (the cautionary tale)
- `BankTransaction` SPEND requires `Contact` (API + reconcile UI "Who"). Unmatched merchant
  names create new contacts. Open, popular product-idea request to allow a bank rule that
  sets contact-only / not force a contact — i.e. the exact friction Carbon's current design
  imposes on itself.

### NetSuite / Intacct / SAP
- Required per charge is a **card/clearing GL account**, not a vendor. The one required
  vendor is the **issuer/bank** on the card/clearing account. Merchant is memo/description/
  optional payee. Generic category vendors are the manual convention for the tail.

### Brex / Airbase / BILL
- Brex: Merchant→Vendor mapping table + vendor-auto-creation toggle; card spend can export as
  JE, bill, or credit-card txn against a "Brex Clearing" liability account.
- Airbase/Airwallex: single default vendor for unknown merchants, by explicit design.
- BILL/Divvy: card spend is category-coded (not vendor-per-merchant); AP bills are a separate
  product with real vendors.

## Recommended Approach for Carbon

The survey does **not** support one-supplier-per-merchant. In priority order:

1. **Stop forcing merchant → supplier for coding.** The merchant should be *metadata on the
   card transaction* (already stored as `cardTransaction.merchantName`), and the coding axis
   should be the account (which Ramp already delivers per line). This mirrors QBO/NetSuite/
   Intacct/SAP and Ramp's own model. Carbon already has the merchant name on the row; the GL
   posting does not need a supplier.

2. **Keep a supplier only where a downstream vendor is genuinely required** — i.e. the
   accounting-provider **charge object** (Rillet charge / QBO Purchase / Xero SPEND) that
   *does* want a vendor. For that, follow the **Airbase/Ramp default-vendor pattern**: match
   to an existing supplier when the name matches, else fall back to a **single catch-all
   "Card Merchant" supplier**, not a new row per merchant. This is the industry-standard
   pollution fix and directly bounds the tail to one row.

3. **If per-merchant spend rollups are wanted**, carry the merchant as a **dimension /
   free-text label** on the charge (Ramp treats merchant as a coding field/dimension), not as
   a supplier — you get the analytics without the AP-master pollution.

4. **Make it a setting, defaulting to the clean behavior.** A toggle mirroring Brex's
   "vendor auto-creation" — default **off** (catch-all/default supplier), opt **on** for
   customers who truly want a supplier per merchant. This preserves today's behavior for
   anyone who wants it while making the surveyed-standard behavior the default.

5. **Do NOT build fuzzy/normalized merge or MCC grouping in Carbon.** Ramp already delivers a
   normalized merchant; re-deriving identity risks permanent wrong merges (the current
   resolver deliberately avoids this). Normalization is the spend layer's job, and Carbon is
   downstream of it.

**Net**: the cheapest correct move is #2 (match-or-default single catch-all supplier) +
#1 (merchant as metadata), gated by #4 (setting, default to catch-all). This aligns Carbon
with SAP/NetSuite/Intacct/QBO and Ramp's own provider contract, and specifically avoids
reproducing Xero's most-complained-about behavior — which is what the current one-per-merchant
design does.

## Sources

**NetSuite / Intacct / SAP**
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1548500.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0422040220.html
- https://ebizcharge.com/blog/how-to-import-credit-card-transactions-into-netsuite/
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158847528506.html
- https://www.claconnect.com/en/resources/blogs/sage/credit-card-processing-in-sage-intacct-configuration-transaction-options
- https://www.swktech.com/sage-intacct-credit-card-guide/
- https://vendorpayhelp.bill.com/hc/en-us/articles/360007057812-Sage-Intacct-sync-Charge-Card-Setup-and-Workflow
- https://vendorpayhelp.bill.com/hc/en-us/articles/360007312071-Sage-Intacct-Sync-User-Guide
- https://community.sap.com/t5/enterprise-resource-planning-q-a/purchasing-a-p-credit-card-processing/qaq-p/3881616
- https://www.veonconsulting.com/credit-card-orders-into-sap/
- https://help.sap.com/docs/SAP_ERP/3cdfa583374d45c4be333f3286ddc211/4d70f0d1ffb92b8ae10000000a42189b.html
- https://github.com/concur/developer.concur.com/blob/preview/src/api-reference/expense/expense-report/expense-report-get.markdown
- https://community.concur.com/t5/Concur-Expense-Forum/Clearing-Account-details-for-Credit-card-payment-type/m-p/97708

**QuickBooks Online / Xero**
- https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/should-every-expense-have-a-payee/00/181976
- https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/purchase
- https://quickbooks.intuit.com/learn-support/en-us/help-article/banking/set-bank-rules-categorize-online-banking-online/L0mjJl0nD_US_en_US
- https://developer.xero.com/documentation/api/accounting/banktransactions
- https://central.xero.com/s/article/Add-a-spend-or-receive-money-transaction-while-reconciling
- https://productideas.xero.com/forums/967136-banking-chart-of-accounts/suggestions/47530337-bank-rule-set-contact-only
- https://central.xero.com/0/article/About-bank-rules

**Ramp / Brex / Bill.com / Airbase**
- https://support.ramp.com/hc/en-us/articles/7317831293203-Managing-Accounting-Rules
- https://support.ramp.com/quickbooks-online-overview
- https://support.ramp.com/vendor-management-on-ramp
- https://docs.ramp.com/developer-api/v1/overview/scopes
- https://raw.githubusercontent.com/riker-t/ramp-dev-mcp/a61feaa82046e644941bc6d69ae66e00c0be239c/data/developer-api/guides/accounting.mdx
- https://builders.ramp.com/post/fixing-merchant-classifications-with-ai
- https://www.brex.com/product-announcements/automatically-create-new-vendors-in-your-erp
- https://www.brex.com/support/netsuite-integration
- https://help.airwallex.com/hc/en-gb/articles/11274607178895-Admin-Guide-How-card-expenses-sync-to-Netsuite
- https://www.bill.com/product/spend-and-expense
- https://www.cpa.com/spend-management/faqs
- https://ramp.com/blog/merchant-category-code-list
- https://www.tapix.io/resources/post/why-mcc-codes-do-not-help-much-with-payment-categorization
