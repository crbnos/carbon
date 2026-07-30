# Journal Entries for Shipping & Tax on Purchases and Sales

**Research date:** 2026-07-17
**Scope:** US GAAP primary, IFRS deltas noted. Manufacturing ERP context, B2B + DTC/FBA.
**Repo state assessed:** `/home/openclaw/carbon` @ `master`
**Task:** `tasks/accounting-research-shipping-tax.md`

---

## Executive Summary

Brad's instinct is correct, and the situation is worse than "shipping and tax are lumped in with base cost and revenue." Three findings, in order of severity:

**1. Carbon books sales tax collected from customers as revenue.** This is not a presentation nit — it is a misstatement of both revenue and liabilities. In `post-sales-invoice/index.ts:330`, the line total is computed as `preTaxLineCost * (1 + taxPercent) + nonTaxableAddOnCost` and the *entire* result is credited to `accountDefault.salesAccount` (line 424). Sales tax collected is not the seller's money; it is a liability owed to a taxing authority. Under **ASC 606-10-32-2A** a company may elect to exclude such taxes from the transaction price, and under the base principle of **ASC 606-10-32-2** the transaction price excludes "amounts collected on behalf of third parties" regardless. Carbon currently recognizes it as revenue and never recognizes the liability. Every sales tax dollar collected overstates revenue by that dollar.

**2. The tax liability accounts already exist, are seeded, are required by form validation — and are never read by any posting code.** `accountDefault.salesTaxPayableAccount`, `purchaseTaxPayableAccount`, and `reverseChargeSalesTaxPayableAccount` map to seeded accounts `2210`/`2220`/`2230`. They are validated as required in `accounting.models.ts:266-272` and editable in `AccountDefaultsForm.tsx:221-235`. No `post-*` edge function references any of them. Similarly, account `6040 "Freight & Shipping Out"` is seeded (`reset-chart-of-accounts.sql:261`) and orphaned — no `accountDefault` column points at it, so nothing can ever post there. Someone designed this correctly and the wiring was never finished.

**3. Freight is capitalized on the purchase side (correct in outcome, fragile in mechanism) and inflates revenue on the sales side (wrong).** Inbound freight *is* allocated pro-rata into inventory cost, which matches **ASC 330-10-30-1**. But outbound freight billed to customers is credited to `salesAccount` mixed with product revenue, and `post-shipment` reads `salesOrderShipment.shippingCost` at line 129 and never uses it — a dead read.

Along the way the research surfaced **two live bugs unrelated to the design question** that should be fixed regardless of whether this proposal proceeds — see [§8 Pre-existing Bugs](#8-pre-existing-bugs-found-during-research). The most serious is an FX direction contradiction where the receipt poster multiplies by `exchangeRate` and the invoice poster divides by it, so the same freight is valued inversely at receipt vs. invoice and the difference silently lands in `purchaseVarianceAccount`.

**The central design recommendation:** build the tax model for **VAT**, and US sales tax falls out as the degenerate case where recoverability is always 0%. The reverse is not true — a schema built around a US `taxAmount` column that posts to one account can never express recoverable input VAT, partial exemption, or reverse charge. This is the single highest-leverage structural decision in the document, and it is developed in [§6.2](#62-the-recoverability-dimension-the-core-abstraction).

**A note on how to read the citations.** I flag confidence throughout. The FASB Codification is paywalled, so ASC quotes are corroborated across ≥2 independent secondary sources rather than read from primary text; IAS 2 and the IASB Basis for Conclusions *were* read from IFRS Foundation PDFs directly. Several premises in the original task brief did not survive contact with the sources and are corrected in [§9](#9-corrections-to-the-task-brief). Please do not lift ASC paragraph numbers from this document into anything external without a primary check.

---

## 1. Current State in Carbon

### 1.1 Where posting happens

All GL posting lives in Deno edge functions under `packages/database/supabase/functions/`. There is no posting logic in `apps/erp` — that layer is forms and models only.

| Function | Lines | Flow |
|---|---|---|
| `post-receipt/index.ts` | 2,197 | PO receipt → GRNI |
| `post-purchase-invoice/index.ts` | 2,055 | Supplier invoice → AP + variance |
| `post-shipment/index.ts` | 2,913 | Sales shipment |
| `post-sales-invoice/index.ts` | 1,586 | Customer invoice → Sales + AR + COGS |

The pattern is to build a `journalLineInserts` array of `Database["public"]["Tables"]["journalLine"]["Insert"]`, pair debit/credit legs via a shared `journalLineReference = nanoid()`, then bulk insert.

`journalLine` columns (`packages/database/src/types.ts:21361`): `id, journalId, journalLineReference, accountId, amount, quantity, description, accrual, companyId, documentId, documentType, documentLineReference, externalDocumentId, intercompanyPartnerId, customFields, tags` + audit. `amount` is signed and in base currency. There is **no `taxAmount`, no `shippingCost`, and no line-type discriminator** on `journalLine` — which is actually correct and worth preserving. A journal line should be an account and an amount; tax and freight belong in *separate lines*, not as columns on a line.

### 1.2 The account mapping model

**Posting groups are gone.** `postingGroupInventory`, `postingGroupPurchasing`, and `postingGroupSales` were dropped in `migrations/20260229000000_drop-posting-groups.sql:14-16`. `accountCategory`/`accountSubcategory` were dropped in `20260229000003_chart-of-accounts-tree.sql:83-84`, replaced by a self-referencing `parentId` tree.

The live model is **`accountDefault` — one flat row per company**, 51 TEXT columns FK'd to `account.id`, keyed only by `companyId`. Resolution goes through `functions/shared/get-posting-group.ts` — `getDefaultPostingGroup()` (line 4) just selects from `accountDefault` despite the legacy name, and `resolveInventoryAccount()` (line 17) branches only on `item.replenishmentSystem` to pick `finishedGoodsAccount` vs `rawMaterialsAccount`.

`itemPostingGroup` survives but carries **no account columns** — it is now purely a reporting dimension (`journalLineDimensionsMeta.itemPostingGroupId`) and a pricing filter (`quote-discount-system.md:47`).

> **Precedent worth noting:** `fixedAssetClass` is the only working GL-mapping table in the system — six NOT NULL account columns, resolved per-class rather than per-company. It is the right architectural model for what §6 proposes, and it proves the pattern is already accepted in this codebase.

### 1.3 How shipping is handled today

Shipping cost columns exist at both header and line level on every document:

| Table | Column |
|---|---|
| `purchaseOrderDelivery` | `supplierShippingCost` |
| `purchaseInvoiceDelivery` | `supplierShippingCost` |
| `purchaseOrderLine` / `purchaseInvoiceLine` | `shippingCost` |
| `salesOrderShipment` / `salesInvoiceShipment` | `shippingCost` |
| `salesOrderLine` / `salesInvoiceLine` | `shippingCost` |
| `quoteShipment` | `shippingCost` |

**Shipping has no GL account of its own and is never posted as a separate journal line.** It is allocated pro-rata across lines and absorbed into whatever account the line itself posts to:

- **Purchase invoice** (`post-purchase-invoice/index.ts:560-562, 804-822`): header `supplierShippingCost` weighted by `totalLineCost / totalLinesCost`, folded into `totalLineCostWithWeightedShipping`, then into `invoiceLineUnitCostInInventoryUnit` → capitalized into inventory/GRNI. There is a freight-only-invoice fallback using equal weights via `postableLineCount`.
- **Receipt** (`post-receipt/index.ts:567-568, 951-952`): same value-weighted allocation → cost layers. `costLedger.cost` includes allocated freight; `costLedger.nominalCost` excludes it.
- **Sales invoice** (`post-sales-invoice/index.ts:84, 346-350`): weighted by pre-tax basis, folded into `totalLineCostWithWeightedShipping` → **credited to `salesAccount`** (line 424), debited to AR (line 447).
- **`post-shipment` never posts shipping at all** — it reads `salesOrderShipment.shippingCost` at line 129 and the value is never referenced again.

`shippingMethod.carrierAccountId` is the only GL field on any shipping table, and it is dead: `reset-chart-of-accounts.sql:94` nulls it out and no posting function reads it. `shippingTerm` is a bare lookup label with no Incoterms/FOB-point semantics — which matters more than it looks, because FOB point turns out to be tax-determinative in Florida and control-transfer-determinative under ASC 606 ([§7.1](#71-tax-on-freight-the-per-state-boolean-is-wrong), [§3.3](#33-the-asc-606-10-25-18b-election)).

**Assessment:** capitalizing inbound freight into inventory is the *right answer* (§3.1), so the purchase side is accidentally correct in outcome. But it is achieved by silently inflating the line's unit cost rather than by an explicit, auditable freight cost element — which means you cannot report on freight, cannot use a non-value allocation basis, cannot handle a freight invoice that arrives separately from the goods, and cannot separate the freight vendor from the goods vendor.

### 1.4 How tax is handled today

Tax is a **bare per-line percentage** with no supporting model. Sales and purchase sides are modeled inversely:

**Sales side** — `taxPercent NUMERIC(10,5) NOT NULL DEFAULT 0 CHECK (taxPercent >= 0 AND taxPercent <= 1)` on `quoteLine`, `salesOrderLine`, `salesInvoiceLine` (`20241105002325_quote-taxes-and-shipping.sql:3,36,66`). A raw user-entered rate with no lookup and no provenance. **There is no `taxAmount` column on the sales side.**

**Purchase side** — inverted: `supplierTaxAmount` is entered, and `taxPercent`/`taxAmount` are `GENERATED ALWAYS AS ... STORED` (`20250204164256_numeric-increase-2.sql:1861-1931`).

**What does not exist at all** (verified by exhaustive grep of `packages/database/supabase/migrations` — `CREATE TABLE "[^"]*tax[^"]*"` returns **zero matches**, case-insensitive):

- No `taxCode`, `taxRate`, `taxGroup`, `taxJurisdiction`, `taxAuthority`, `vatCode` table
- No `taxable` column anywhere
- No exemption / resale-certificate / nexus concept
- No tax provider integration (no Avalara, TaxJar, Vertex)
- No recoverable-vs-non-recoverable concept

And as noted, the three tax-payable account mappings are configured, seeded, form-validated, and entirely unread.

**Net effect:** sales tax collected is booked as revenue. Purchase tax is capitalized into inventory cost — which is *coincidentally correct for US non-recoverable sales tax* (§4.2) and *categorically wrong for recoverable VAT* (§5.2), with no way to distinguish the two.

---

## 2. What the Standards Actually Say

A compact map before the detail. The distinction that matters most is that **freight-in and freight-out are governed by entirely different questions** — one is an inventory costing question (ASC 330), the other is a revenue and presentation question (ASC 606).

| Question | Authority | Answer |
|---|---|---|
| Capitalize freight-in? | ASC 330-10-30-1 / IAS 2.11 | **Yes** — cost of bringing to present location |
| Abnormal freight? | ASC 330-10-30-7 / IAS 2.16(a) | **Expense as incurred** |
| Freight-out in inventory? | ASC 330-10-30-8 / IAS 2.16(d) | **Never** — selling expense |
| Freight-out in COGS or SG&A? | *(no live paragraph)* — ASC 250 policy | **Either**, consistently, disclosed |
| Shipping billed to customer? | ASC 606-10-32-2 | **Revenue** — not a cost offset |
| Post-control shipping a separate PO? | ASC 606-10-25-18B | **US: policy election. IFRS: must assess** |
| Sales tax collected? | ASC 606-10-32-2A | **Excluded from transaction price** (election) |
| Recoverable input tax? | IAS 2.11 | **Receivable** — excluded from inventory cost |
| Non-recoverable input tax? | IAS 2.11 / ASC 330-10-30-1 | **Capitalized into cost** |

---

## 3. Shipping — Authoritative Guidance

### 3.1 Freight-in: capitalize into inventory

**ASC 330-10-30-1** ⚠️ *(secondary-corroborated: [PwC Viewpoint 1.3](https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/inventory/Inventory-Guide/Chapter-1-Inventory-costing/1_3_Cost.html), [HOCK](https://www.hockinternational.com/wp-content/uploads/2021/02/ASC-330-10-30-1-thru-30-7.pdf))*:

> "The primary basis of accounting for inventories is cost... As applied to inventories, cost means in principle the sum of the applicable expenditures and charges directly or indirectly incurred in bringing an article to its **existing condition and location**."

Note the mechanism carefully: **ASC 330 does not contain a list naming "freight-in."** Unlike IAS 2, it works by *principle* — inbound freight capitalizes because it is an expenditure incurred in bringing the article to its existing **location**. That single word carries the whole conclusion.

**ASC 330-10-30-7** — abnormal freight is excluded:

> "Unallocated overheads shall be recognized as an expense in the period in which they are incurred. Other items such as **abnormal freight**, handling costs, and amounts of wasted materials (spoilage) require treatment as current period charges rather than as a portion of the inventory cost."

> ⚠️ **Citation trap.** The phrase *"idle facility expense, excessive spoilage, double freight, and rehandling costs"* is widely quoted online as current ASC text. **It is not.** That is original ARB 43 Ch. 4 language that **FAS 151 replaced** ([FASB summary](https://www.fasb.org/page/PageContent?pageId=/reference-library/superseded-standards/summary-of-statement-no-151.html&bcpath=tff)). Do not cite "double freight" to ASC 330-10-30-7.

**On expensing freight-in instead:** there is **no freight-specific practical expedient**. The only authoritative hook is **ASC 105-10-05-6** — *"The provisions of the Codification need not be applied to immaterial items."* That is the entire basis. Capitalizing is the rule; expensing is tolerated only when immaterial and consistently applied. PwC notes practitioners often expense acquisition-side costs "even though this policy would not be consistent with the letter of the guidance" — a cost-benefit judgment, not a sanctioned election.

> ⚠️ **On the "Freight In" clearing account:** there is **no authoritative support** for it as an ASC concept. "Freight-In" as a temporary account is a **periodic-inventory textbook convention** ([Lumen](https://content.one.lumenlearning.com/financialaccounting/chapter/purchases-under-a-periodic-system/), [LibreTexts 3.5](https://biz.libretexts.org/Bookshelves/Accounting/Principles_of_Financial_Accounting_(Jonick)/03:_Accounting_Cycle_for_a_Merchandising_Business/3.05:_Basic_Merchandising_Transactions_(periodic_inventory_system))). Critically, even in the textbook model Freight-In closes to **Merchandise Inventory**, not to COGS. Carbon is perpetual, so it should debit Inventory directly or use a true **clearing account** — which is a different animal, justified by *timing*, not by ASC.

### 3.2 Freight-out: never inventory; COGS-vs-SG&A is a policy choice

Two questions get conflated here. Separate them.

**(a) Is freight-out inventoriable? No — settled.** **ASC 330-10-30-8**: *"Selling expenses constitute no part of inventory costs."* Outbound freight is incurred to *sell*, not to bring the article to its location. It never touches the balance sheet as inventory.

**(b) COGS or SG&A on the income statement? A policy choice — and the basis is weaker than commonly claimed.** The old explicit answer was **ASC 605-45-50-2** (from EITF 00-10), which made classification a policy decision requiring disclosure. **That subtopic was superseded by ASU 2014-09.** ASC 606 contains **no replacement paragraph** governing where shipping *costs* are presented.

What survives: [PwC 10.4](https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/revenue_from_contrac/revenue_from_contrac_US/chapter_10_principa_US/10_4_shipping_and_hand_US.html) notes entities that presented shipping costs outside cost of revenue under legacy GAAP "continued that practice under ASC 606," and that a change in presentation "would likely be considered a change in accounting policy under **ASC 250**." The SEC's OCA encouraged disclosure at the 2017 AICPA Conference. **Reg S-X Rule 5-03** ([17 CFR 210.5-03](https://www.law.cornell.edu/cfr/text/17/210.5-03)) constrains caption structure, not freight specifically.

**Bottom line:** freight-out in COGS or in SG&A are both acceptable. It is a policy election by *practice continuity and ASC 250*, not by a live ASC paragraph. Disclose it; don't change it casually. **Recommendation for Carbon: make the freight-out account configurable** rather than hard-coding either, since it is genuinely the customer's election.

### 3.3 Shipping billed to the customer is REVENUE

Legacy **ASC 605-45-45-20** said it explicitly: *"all amounts billed to a customer in a sale transaction related to shipping and handling represent revenues earned for the goods provided and shall be classified as revenue. Shipping and handling costs shall not be deducted from revenues."*

That paragraph is superseded, but **the outcome is preserved under ASC 606 via the transaction price**. **ASC 606-10-32-2**:

> "The transaction price is the amount of consideration to which an entity expects to be entitled in exchange for transferring promised goods or services to a customer, **excluding amounts collected on behalf of third parties**."

Shipping billed to a customer is consideration the entity is entitled to → in the transaction price → revenue. This holds on both branches. **Netting billed freight against freight cost is not acceptable** unless the entity is an agent (§3.4).

> ✅ **Carbon is right that billed shipping is revenue. Carbon is wrong that it belongs in the same account as product revenue.** These are separable concerns and the fix is a distinct revenue account, not a change in classification.

#### The ASC 606-10-25-18B election

**ASC 606-10-25-18A** *(corroborated: [Deloitte DART 5.2](https://dart.deloitte.com/USDART/home/codification/revenue/asc606-10/roadmap-revenue-recognition/chapter-5-step-2-identify-performance/5-2-promises-in-contracts-with), [HCVT](https://www.hcvt.com/article-ASC-606))*:

> "An entity that promises a good to a customer also might perform shipping and handling activities related to that good. If the shipping and handling activities are performed **before** the customer obtains control of the good, then the shipping and handling activities are **not a promised service** to the customer. Rather, shipping and handling are activities to fulfill the entity's promise to transfer the good."

**ASC 606-10-25-18B:**

> "If shipping and handling activities are performed **after** a customer obtains control of the good, then the entity **may elect** to account for shipping and handling as activities to fulfill the promise to transfer the good. The entity shall apply this accounting policy election consistently to similar types of transactions."

> ⚠️ **Direction matters and secondary sources get it backwards.** GAAP Dynamics states the election applies when *"the customer takes control of the good before shipment"* — this inverts 18A/18B. **Before** control transfer = fulfillment, mandatory, no election. **After** control transfer = election available. Verified against Deloitte DART.

Practically: **FOB shipping point** is where the election bites; **FOB destination** is 18A territory with no choice. If elected, related shipping **costs must be accrued when revenue is recognized** for the good, rather than deferred.

**This is why `shippingTerm` having no FOB-point semantics is a real gap, not a cosmetic one** — the field that determines which paragraph applies does not exist in Carbon's data model.

### 3.4 Principal vs. agent for freight

**ASC 606-10-55-36**: the principal has a performance obligation to provide the good or service; an **agent** merely *arranges* for it. The test is **control** before transfer; the **55-39** indicators (primary responsibility, inventory risk, pricing discretion) support but don't replace it.

Per [Deloitte DART 10.5](https://dart.deloitte.com/USDART/home/codification/revenue/asc606-10/roadmap-revenue-recognition/chapter-10-principal-versus-agent-considerations/10-5-other-considerations):

- **Principal** → all amounts billed for shipping are revenue → **gross**
- **Agent** → seller "is not responsible to the customer for shipping but is instead acting merely as the buyer's agent in arranging for a third party" → **net commission only**

**When is the seller an agent?** The classic pattern: the buyer **designates its own carrier and its own carrier account**, the seller hands the goods over and passes the charge through at cost. No pricing discretion, no responsibility, no in-transit risk. Contrast: a seller that marks up freight, chooses the carrier, and bears in-transit risk is a **principal**.

**ERP implication:** "collect / third-party-billing" freight terms are the agent flag. Model freight terms explicitly so the gross/net decision is data-driven rather than a manual JE.

### 3.5 IFRS deltas for shipping

IAS 2 quotes below are **primary-verified** — extracted directly from the [IFRS Foundation's issued standard](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ias-2-inventories.pdf).

**IAS 2.11:**
> "The costs of purchase of inventories comprise the purchase price, import duties and other taxes (other than those subsequently recoverable by the entity from the taxing authorities), and **transport, handling** and other costs directly attributable to the acquisition of finished goods, materials and services. Trade discounts, rebates and other similar items are deducted in determining the costs of purchase."

**IAS 2.16:** costs excluded and expensed include *"(a) abnormal amounts of wasted materials... (d) **selling costs**."*

**Freight-in: capitalized under both** — IFRS expressly ("transport, handling"), US GAAP by principle. **Freight-out: excluded under both.** Same answers, different routes. Confirmed by [KPMG](https://kpmg.com/us/en/articles/2026/inventory-accounting-ifrs-accounting-standards-vs-us-gaap.html).

#### ⭐ The one real delta: no 25-18B election under IFRS

Confirmed by the IASB **in its own words** — verbatim from *Clarifications to IFRS 15* (April 2016), [Basis for Conclusions BC116U](https://www.efrag.org/system/files/sites/webpublishing/Project%20Documents/330/Clarifications%20to%20IFRS%2015%20-%20IASB%20Amendments.pdf):

> "(a) An accounting policy choice for shipping and handling activities after control of goods has been transferred to the customer would create an **exception to the revenue recognition model** and potentially reduce comparability between entities... The introduction of a policy choice would override this requirement. (b) ...**The IASB acknowledged that, because the policy choice is not available in IFRS 15, this gives rise to a difference between IFRS 15 and Topic 606.**"

**Practical effect:** under IFRS an entity **must assess** whether post-control shipping is a separate PO (IFRS 15.22). If it is, revenue allocates to it and **defers until delivery** — a contract liability that exists under IFRS but not for a US filer taking the election. Same facts, different revenue timing. **For a dual-reporting ERP this is a real book difference, not a footnote.**

**Principal vs. agent is converged** (IFRS 15.B34–B38 ≡ ASC 606-10-55-36+, deliberately aligned) — no delta.

| Topic | IFRS | US GAAP | Delta? |
|---|---|---|---|
| Freight-in capitalization | IAS 2.11 (express) | ASC 330-10-30-1 (by principle) | No |
| Freight-out inventoriable | IAS 2.16(d) — no | ASC 330-10-30-8 — no | No |
| **Post-control S&H election** | **None — must assess** | **25-18B election** | **YES** |
| Principal vs. agent | IFRS 15.B34–B38 | ASC 606-10-55-36+ | No (converged) |
| Storage costs | IAS 2.16(b) explicit | No explicit US guidance | Yes — practice differences |

---

## 4. Tax on Purchases — Authoritative Guidance

### 4.1 The structural fact: US sales tax and VAT are opposites

**This is the most important table in the document for schema design.**

| Dimension | **US Sales/Use Tax** | **VAT/GST** |
|---|---|---|
| **Tax paid on purchase is…** | **Cost** — capitalized into inventory/asset | **Receivable** — an asset, reclaimed |
| **Inventory value** (10,000 + 8%/20%) | **10,800** | **10,000** |
| **Governing text** | ASC 330-10-30-1 — ⚠️ general principle, tax not mentioned | **IAS 2.11 — explicit** |
| **GL account hit** | Inventory / Expense / Fixed Asset | **Input VAT Receivable** |
| **Effect on COGS / margin** | **Yes** — flows through COGS | **None** |
| **Nets against output tax?** | **No** — no seller-side reclaim | **Yes** — the core mechanism |
| **Legal incidence** | **Buyer** (seller collects as agent) | Seller remits; borne by final consumer |
| **Cascading avoided via** | **Exemption certificates** (a document problem) | **Input credit** (an accounting mechanism) |
| **Relief timing** | **Ex ante** — certificate before/at sale | **Ex post** — reclaim on the return |
| **Self-assessment** | **Use tax** | **Reverse charge** |
| **Chain position matters?** | **Yes** — resale vs. consumption | **No** — every stage taxes and reclaims |
| **Partial rates** | Yes — CA 3.9375% partial mfg exemption | Yes — partial exemption recovery % |

**In one sentence: US sales tax is a *cost* you avoid with *paperwork*; VAT is a *receivable* you *reclaim*.**

### 4.2 US: non-recoverable → capitalizes (but the citation is weak)

**ASC 330-10-30-1** applies by *inference*. ⚠️ **ASC 330 does not mention sales tax anywhere.** KPMG's dedicated IAS 2 vs. ASC 330 comparison omits taxes entirely. Practitioner guidance on tariffs runs the same analogy — tariffs capitalize because they're *"costs necessary to bring inventory to its present location and condition."* ([Keiter](https://keitercpa.com/blog/accounting-manufactured-inventory-cost-classification-under-gaap/), [BeCPAs](https://blog.becpas.com/understanding-inventory-valuation-under-us-gaap))

**Flag this in any memo to Brad: US GAAP is silent-and-inferred here; IFRS is explicit.** That asymmetry is genuine and it is why US practice leans on the general cost principle.

**No tax receivable exists on the US purchase side.** This single fact is what Carbon's current code accidentally gets right.

### 4.3 Manufacturing exemptions — and why a boolean won't work

**Two distinct doctrines**, which Texas obscures by putting both on Form 01-339:

- **Resale exemption** (front page) — goods resold or **incorporated into a product for sale**
- **Manufacturing exemption** (back page) — machinery that *"makes a chemical or physical change in the product being manufactured"*

**Raw materials incorporated into product are typically exempt via the *resale* doctrine**, not the manufacturing-equipment doctrine. Does **not** qualify in TX: *"hand tools," "office equipment," "intraplant transportation equipment such as conveyors, pipes, forklifts, hoists, cranes,"* comfort HVAC, R&D equipment. ([Texas Pub. 94-124](https://comptroller.texas.gov/taxes/publications/94-124.php), [34 TAC § 3.300](https://www.law.cornell.edu/regulations/texas/34-Tex-Admin-Code-SS-3-300))

**⭐ California breaks the boolean.** CA's manufacturing exemption is **partial**: rate **3.9375%** (state portion only — district/local tax still applies), capped at **$200,000,000** of qualified purchases **per qualified person per calendar year**, through 2030-06-30. ([CCR § 1525.4](https://cdtfa.ca.gov/lawguides/vol1/sutr/1525-4.html), [CDTFA guide](https://cdtfa.ca.gov/industry/manufacturing-and-research-and-development-equipment-exemption/))

**Two schema requirements fall directly out of this:**
1. **Exemptions are not boolean.** CA needs exempt-at-3.9375% and taxable-at-district-rate **on the same line**. An `isExempt` flag cannot express it.
2. **Exemptions need running annual accumulators.** The ERP must track consumption against the $200M cap and stop applying the exemption when breached.

> ⚠️ **Certificate management — per customer, per jurisdiction, with expiry — is the largest real-world audit exposure for a manufacturing ERP, and it was not in the task brief at all.** CA Reg. 1668 requires the purchaser's seller's permit number and the literal phrase **"for resale"** — *"The use of phrases such as 'non-taxable,' 'exempt,' or similar terminology is **not acceptable**."* Taken timely and in good faith, the certificate *"relieves the seller from liability."* ([CCR § 1668](https://cdtfa.ca.gov/lawguides/vol1/sutr/1668.html))

### 4.4 Use tax accrual — an architectural requirement, not a report

> "**Consumer's use tax** is a tax on the purchaser and is **self-assessed by the purchaser** on taxable items purchased where the vendor did not collect either a sales or seller's use tax." ([Sales Tax Institute](https://www.salestaxinstitute.com/sales_tax_faqs/i-bought-a-taxable-item-and-the-seller-didnt-charge-sales-tax-do-i-have-to-pay-the-tax-anyway))

**The defining feature: AP ≠ the debit.** The vendor gets 10,000; the state gets 700; the cost is 10,700.

> ⚠️ **Any ERP where the AP credit must equal the expense debit cannot model use tax.** This is a structural constraint on the posting layer, and Carbon's `journalLine` model (signed amounts, N legs per reference) handles it fine — but only if the tax line is a *separate journal line*, which is exactly what §6 proposes.

**⚠️ The manufacturing sting:** a raw material bought under a resale certificate but **withdrawn from inventory for internal use** (R&D, plant maintenance, samples) triggers **use tax on withdrawal** — the exemption was conditional on a resale that never happened. **This makes use tax a costing-transaction trigger, not a purchasing one** — it must fire on inventory issues to non-COGS destinations. For Carbon that means `issue`, `post-production-event`, and `post-inventory-adjustment`, not just `post-purchase-invoice`.

### 4.5 VAT: recoverable → receivable

**IAS 2.11's parenthetical is the whole ballgame:** *"other taxes (**other than those subsequently recoverable by the entity from the taxing authorities**)."* Recoverable → excluded from cost → **receivable**. Non-recoverable → **included in cost**.

**There is no IFRS standard on VAT.** This is a citable fact, stated as a negative:
- **IAS 12 excludes it** — IAS 12 covers taxes "based on taxable profits"; *"sales or payroll taxes are not income taxes."* ⚠️ **Cite IAS 12 to prove VAT *isn't* covered — never to support VAT accounting.**
- **IAS 7 doesn't address it** — [IFRIC noted this in 2005](https://www.iasplus.com/en/meeting-notes/ifrs-ic/not-added/2005/ias-7-value-added-tax)
- **IFRS IC declined to standardize** non-refundable VAT (Sept 2021), finding *"limited evidence"* and *"diversity"* ([IFRIC Update](https://www.ifrs.org/news-and-events/updates/ifric/2021/ifric-update-september-2021/))

**So VAT accounting is governed by local law + entity policy, anchored only by the IAS 2.11 recoverability test.**

**Partial exemption is not an edge case.** UK: a business making both taxable and exempt supplies is *"partly exempt… unable to recover all the input tax."* De minimis: input tax ≤ **£625/month** average **AND** exempt supplies ≤ **50%** → provisionally recover in full. ([VAT Notice 706](https://www.gov.uk/guidance/partial-exemption-vat-notice-706))

> ⚠️ **Capital Goods Scheme:** for expensive capital assets the recovery rate is **adjusted over 5 or 10 years** as taxable-vs-exempt use varies. **The recovery percentage is a time series, not a constant.** Carbon's `fixedAsset` module would need multi-year VAT true-up. Out of scope for phase 1 but it constrains the schema — don't model recovery % as a scalar on the tax code alone.

**Canada/GST** uses the same dichotomy under different labels — **input tax credits (ITCs)**, not claimable on inputs to exempt supplies, 4-year window. ([CRA](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/input-tax-credit.html))

### 4.6 Reverse charge — EU B2B cross-border

**Article 196, Directive 2006/112/EC** — confirmed via the [European Commission](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/persons-liable-vat_en): the customer is liable when the customer is a business acting as such, the place of supply is where the customer is established, and the supplier is not established in the customer's country. Baseline is **Art. 193**; **194** and **199** are **Member-State options** — so **reverse charge applicability is per-Member-State configuration, not a constant.**

**Net VAT effect: zero. Net cash: zero. But both legs must exist and be reported.**

> ⭐ **The universal insight across BC, SAP, and NetSuite: net-zero ≠ unreported.** Every one of these systems deliberately creates ledger entries for both legs *specifically so the VAT return can see them*. HMRC requires *"a record of the tax you're required to pay on behalf of your supplier under a reverse charge procedure"* ([VAT Notice 735](https://www.gov.uk/guidance/the-vat-domestic-reverse-charge-procedure-notice-735)). **An implementation that "optimizes away" the zero-net posting breaks statutory reporting.**

And reverse charge is **only** net-zero when input VAT is **fully** recoverable — see the partially-exempt entry in §5.5.

---

## 5. Journal Entry Templates

Every entry below is a target-state template for Carbon. Account names map to §6.1.

### 5.1 Purchase — freight known at receipt, invoice with goods

| Event | Account | Debit | Credit |
|---|---|---:|---:|
| **PO receipt** | Inventory — Raw Materials | 10,000.00 | |
| | Inventory — Raw Materials *(freight allocated)* | 500.00 | |
| | GR/IR Clearing — Goods | | 10,000.00 |
| | Freight-In Clearing | | 500.00 |
| **Supplier invoice** | GR/IR Clearing — Goods | 10,000.00 | |
| | Freight-In Clearing | 500.00 | |
| | Accounts Payable | | 10,500.00 |
| **At sale** | COGS | 10,500.00 | |
| | Inventory — Raw Materials | | 10,500.00 |

### 5.2 ⭐ Purchase — freight invoice arrives AFTER the goods

This is the case that forces the architecture. It is not an edge case — all four major ERPs treat it as a designed-for flow (§6.5).

| Event | Account | Debit | Credit |
|---|---|---:|---:|
| **1. Goods receipt** | Inventory | 10,000.00 | |
| | GR/IR Clearing | | 10,000.00 |
| **2. Accrue estimated freight** | Inventory | 500.00 | |
| | Freight-In Clearing | | 500.00 |
| **3. Supplier invoice (goods)** | GR/IR Clearing | 10,000.00 | |
| | Accounts Payable | | 10,000.00 |
| **4. Carrier invoice @ 560** | Freight-In Clearing | 500.00 | |
| | Inventory *(variance, still on hand)* | 60.00 | |
| | Accounts Payable — Carrier | | 560.00 |

> **The subtlety in step 4:** the 60 variance capitalizes **only to the extent the goods are still in inventory.** If some units already sold, it splits pro-rata between Inventory and COGS. If all sold, the entire 60 hits COGS. **This is why every ERP ships a cost-adjustment engine behind its freight feature rather than just an allocation formula** — and Carbon already has one (`shared/purchase-cost-adjustment.ts`), which is a significant head start.

### 5.3 Purchase — US non-recoverable sales tax

$10,000 raw material, 8% tax, no exemption:

| Account | Debit | Credit |
|---|---:|---:|
| Raw Materials Inventory | 10,800.00 | |
| &nbsp;&nbsp;Accounts Payable | | 10,800.00 |

**No tax receivable exists.** The 800 is inventory cost and flows to COGS on sale.

### 5.4 Purchase — use tax accrual (vendor charged no tax)

$10,000 supplies, 7% use tax owed:

| Account | Debit | Credit |
|---|---:|---:|
| Inventory / Expense / Fixed Asset | 10,700.00 | |
| &nbsp;&nbsp;Accounts Payable *(pay vendor)* | | 10,000.00 |
| &nbsp;&nbsp;Use Tax Payable *(owe the state)* | | 700.00 |

**Remittance:** Dr Use Tax Payable 700 / Cr Cash 700.

### 5.5 Purchase — recoverable VAT

€10,000 + 20% recoverable:

| Account | Debit | Credit |
|---|---:|---:|
| Raw Materials Inventory | 10,000.00 | |
| Input VAT Receivable | 2,000.00 | |
| &nbsp;&nbsp;Accounts Payable | | 12,000.00 |

**Inventory is 10,000 — not 12,000.** Compare §5.3: identical economics, **10,800 vs 10,000**. That single delta drives COGS, margin, and inventory valuation.

**Partially exempt (25% recoverable):**

| Account | Debit | Credit |
|---|---:|---:|
| Inventory / Fixed Asset *(incl. €1,500 irrecoverable)* | 11,500.00 | |
| Input VAT Receivable | 500.00 | |
| &nbsp;&nbsp;Accounts Payable | | 12,000.00 |

**Reverse charge, fully recoverable** — €10,000 services, 20%:

| Account | Debit | Credit |
|---|---:|---:|
| Expense / Inventory | 10,000.00 | |
| Input VAT Receivable *(reverse charge)* | 2,000.00 | |
| &nbsp;&nbsp;Accounts Payable *(no VAT on invoice)* | | 10,000.00 |
| &nbsp;&nbsp;Output VAT Payable *(reverse charge)* | | 2,000.00 |

**Reverse charge, partially exempt (25% recoverable) — the leg that doesn't net:**

| Account | Debit | Credit |
|---|---:|---:|
| Expense / Inventory *(incl. €1,500 irrecoverable)* | 11,500.00 | |
| Input VAT Receivable | 500.00 | |
| &nbsp;&nbsp;Accounts Payable | | 10,000.00 |
| &nbsp;&nbsp;Output VAT Payable | | 2,000.00 |

**€1,500 is genuinely payable in cash.** Reverse charge is net-zero *only* when input VAT is fully recoverable.

### 5.6 Sale — with tax and billed shipping (the corrected Carbon entry)

$1,000 goods, $75 shipping billed, 7% tax on both, COGS $600, carrier cost $60:

| Account | Debit | Credit |
|---|---:|---:|
| Accounts Receivable | 1,150.25 | |
| &nbsp;&nbsp;Revenue — Product | | 1,000.00 |
| &nbsp;&nbsp;Revenue — Shipping | | 75.00 |
| &nbsp;&nbsp;Sales Tax Payable | | 75.25 |
| COGS | 600.00 | |
| &nbsp;&nbsp;Inventory | | 600.00 |
| Freight-Out Expense *(or COGS — policy)* | 60.00 | |
| &nbsp;&nbsp;Accrued Freight / AP — Carrier | | 60.00 |

**Contrast with what Carbon does today:** a single credit of **1,150.25 to `salesAccount`**, no tax liability, no shipping revenue separation, and no freight expense. Revenue is overstated by **150.25** on a **1,075.00** sale — **14%**.

### 5.7 Sale — shipping absorbed by seller / free-shipping promo

| Account | Debit | Credit |
|---|---:|---:|
| Accounts Receivable | 1,000.00 | |
| &nbsp;&nbsp;Revenue — Product | | 1,000.00 |
| COGS | 600.00 | |
| &nbsp;&nbsp;Inventory | | 600.00 |
| Freight-Out Expense | 60.00 | |
| &nbsp;&nbsp;AP — Carrier | | 60.00 |

> **The trap:** "free shipping" is **not** consideration payable to a customer (ASC 606-10-32-25) — no revenue reduction. The transaction price is simply 1,000. But if the entity does **not** take the 18B election and shipping is a distinct PO, a portion of the 1,000 must be allocated to it at **standalone selling price** and deferred until delivery. **Free shipping is only free to the customer, never to the allocation.**

### 5.8 Sale — shipping as a separate PO (IFRS-mandatory pattern)

FOB shipping point, delivery in a later period:

| Event | Account | Debit | Credit |
|---|---|---:|---:|
| **At shipment** | Accounts Receivable | 1,075.00 | |
| | &nbsp;&nbsp;Revenue — Product | | 1,000.00 |
| | &nbsp;&nbsp;Contract Liability — Shipping | | 75.00 |
| | COGS | 600.00 | |
| | &nbsp;&nbsp;Inventory | | 600.00 |
| **On delivery** | Contract Liability — Shipping | 75.00 | |
| | &nbsp;&nbsp;Revenue — Shipping | | 75.00 |
| | Freight-Out Expense | 60.00 | |
| | &nbsp;&nbsp;AP — Carrier | | 60.00 |

### 5.9 Sale — seller is an AGENT for freight (net)

Freight passed through at cost, 60:

| Account | Debit | Credit |
|---|---:|---:|
| Accounts Receivable | 1,060.00 | |
| &nbsp;&nbsp;Revenue — Product | | 1,000.00 |
| &nbsp;&nbsp;Payable to Carrier | | 60.00 |

Then: Dr Payable to Carrier 60 / Cr AP — Carrier 60. **No freight revenue, no freight expense** — the pass-through never touches the P&L.

### 5.10 Sale — seller absorbs the tax (tax-inclusive pricing)

Advertised $1,000 tax-included, 8.25%. Back-out per the Texas Comptroller's audit manual — *"Dividing total Taxable Sales (tax included) by one plus the appropriate tax rate"* → $1,000 ÷ 1.0825 = **923.79**:

| Account | Debit | Credit |
|---|---:|---:|
| Accounts Receivable / Cash | 1,000.00 | |
| &nbsp;&nbsp;Sales Revenue | | 923.79 |
| &nbsp;&nbsp;Sales Tax Payable | | 76.21 |

> **The absorbed tax reduces revenue — it is not an expense.** An ERP booking 1,000 revenue + 76.21 tax expense **overstates both revenue and opex**.
>
> ⚠️ **Legality caveat.** **Tex. Tax Code § 151.704(a)**: a retailer commits an offense by advertising that *"the tax is not part of the sales price."* **(b) permits** it only if the retailer clearly indicates it is paying the tax, doesn't suggest exemption, **and the receipt separately lists the tax**. **So tax-inclusive pricing still requires the ERP to print the tax separately.** ([§ 151.704](https://texas.public.law/statutes/tex._tax_code_section_151.704))

### 5.11 Tax remittance

| Account | Debit | Credit |
|---|---:|---:|
| Sales Tax Payable | 75.25 | |
| &nbsp;&nbsp;Cash | | 75.25 |

**VAT period-end settlement (the netting):**

| Account | Debit | Credit |
|---|---:|---:|
| Output VAT Payable | 3,000.00 | |
| &nbsp;&nbsp;Input VAT Receivable | | 2,000.00 |
| &nbsp;&nbsp;VAT Control / Settlement | | 1,000.00 |

Then Dr VAT Control 1,000 / Cr Cash 1,000. **The net position can be a payable or a receivable** — a refund period reverses the sign, and the ERP must handle both.

---

## 6. Recommendations for Carbon

### 6.1 Chart of accounts

Carbon's CoA is a `parentId` tree with `accountType`, `class`, `incomeBalance`. Existing group keys include `tax-liabilities` and `operating-expenses`, so the additions slot in cleanly.

**Already seeded — wire them up, don't create them:**

| Number | Name | Status |
|---|---|---|
| `2210` | Sales Tax Payable | ✅ seeded, ❌ never posted |
| `2220` | Purchase Tax Payable | ✅ seeded, ❌ never posted |
| `2230` | Reverse Charge Tax Payable | ✅ seeded, ❌ never posted |
| `6040` | Freight & Shipping Out | ✅ seeded, ❌ **orphaned — no `accountDefault` column points at it** |

**Proposed additions:**

| Number | Name | `accountType` | `class` | `incomeBalance` | Parent | Purpose |
|---|---|---|---|---|---|---|
| `1260` | Input VAT Receivable | Other Current Asset | Asset | Balance Sheet | `receivables` | Recoverable input tax (§5.5) |
| `1450` | Freight-In Clearing | Other Current Asset | Asset | Balance Sheet | `inventory` | Freight accrued at receipt, cleared at carrier invoice (§5.2) |
| `2240` | Use Tax Payable | Tax | Liability | Balance Sheet | `tax-liabilities` | Self-assessed use tax (§5.4) |
| `2250` | VAT Control / Settlement | Tax | Liability | Balance Sheet | `tax-liabilities` | Period-end netting (§5.11) |
| `2260` | Payable to Carrier | Other Current Liability | Liability | Balance Sheet | `current-liabilities` | Agent-basis freight pass-through (§5.9) |
| `2270` | Contract Liability — Shipping | Other Current Liability | Liability | Balance Sheet | `current-liabilities` | Deferred shipping revenue (§5.8) — **required for IFRS** |
| `4020` | Revenue — Shipping | Income | Revenue | Income Statement | `revenue` | Billed shipping (§5.6) |
| `5040` | Freight-In Variance | Cost of Goods Sold | Expense | Income Statement | `variances` | Late-freight variance on sold inventory (§5.2 step 4) |

**New `accountDefault` columns** (following the existing naming convention exactly — note the schema's existing `assetAquisitionCost*` misspelling should be preserved, not propagated):

```
-- Shipping
salesShippingRevenueAccount        -> 4020
freightInClearingAccount           -> 1450
freightInVarianceAccount           -> 5040
freightOutExpenseAccount           -> 6040   -- adopts the orphan
carrierPayableAccount              -> 2260
shippingContractLiabilityAccount   -> 2270

-- Tax
inputVatReceivableAccount          -> 1260
useTaxPayableAccount               -> 2240
vatControlAccount                  -> 2250
-- salesTaxPayableAccount          -> 2210   (exists — wire it)
-- purchaseTaxPayableAccount       -> 2220   (exists — wire it)
-- reverseChargeSalesTaxPayableAccount -> 2230 (exists — wire it)
```

> **Design note:** `accountDefault` is already a 51-column flat singleton. Adding 9 more makes it 60. That is a smell, but it is the *existing* pattern and consistency beats purity here — **splitting `accountDefault` is a separate refactor and should not be entangled with this work.** The one place to deviate is the tax posting setup (§6.3), which genuinely cannot be expressed as company-level defaults.

### 6.2 ⭐ The recoverability dimension — the core abstraction

**You cannot model both US sales tax and VAT with one `taxAmount` field posting to one account.**

The minimum viable abstraction is a **tax line with a `recoverability` dimension** that determines its posting target:

| `recoverability` | Posts to |
|---|---|
| `recoverable` | Input VAT Receivable (asset) |
| `nonRecoverable` | **the base line's own cost account** (inventory / expense / FA) |
| `partiallyRecoverable` | **split by percentage across both** |

**`partiallyRecoverable` is not an edge case** — it is UK partial exemption, CA's partial manufacturing exemption, and every non-deductible VAT regime. A naive `taxAmount` column can never express it.

> ⭐ **US sales tax is the degenerate case where recoverability is always 0%.** A VAT-capable schema subsumes sales tax; the reverse is not true. **Build for VAT; sales tax falls out free.** This is the single most important structural decision here.

**A striking cross-vendor convergence worth copying:** Odoo, BC, and SAP independently arrived at the *same fallback semantic* — **leave the account blank and non-recoverable tax lands on the original line's account.**

- **Odoo:** *"If the Account is not specified, it defaults to the account of the original invoice line on which the tax is applied."*
- **BC:** *"you can either leave the Non-Deductible Purchase VAT Account field blank."*
- **SAP** (NVV, posting indicator `3`): *"the original account on the document line is to be charged."*

Three independent teams, one answer. **Adopt this default.**

How each vendor stores it:

| System | Mechanism | Flag/field |
|---|---|---|
| **Odoo** | Row explosion — N repartition rows | *absence* of `account_id`; `total_void` |
| **BC** | Percentage fields on the matrix line | `Allow Non-Deductible VAT` + `Non-Deductible VAT %` |
| **SAP** | Two condition types, one shared tax code | account key + posting indicator (`2`=separate, `3`=distribute) |
| **NetSuite** | Tax type property | `Post To Item Cost` |
| **Avalara/TaxJar** | Not modelled — US has no reclaim concept | closest: `isNonPassThru` |

**Recommendation: typed columns (BC/NetSuite style), not row-explosion (Odoo).** Odoo's approach is more flexible but makes non-recoverability *an emergent property of a null FK* — elegant and completely unqueryable for reporting. BC's `VAT Entry.Non-Deductible VAT Amount` can be queried directly by the VAT return. Carbon needs the reporting.

### 6.3 ⭐ Tax posting setup — steal the BC matrix

Microsoft's pattern, stated in one line:

> "The **VAT Posting Setup** page is a **matrix** that combines VAT business and product posting groups… Each combination determines the accounts that are used to post sales and purchase VAT."

BC decomposes tax into **who × what**:

| Dimension | Assigned to | Represents | BC's examples |
|---|---|---|---|
| **VAT Bus. Posting Group** | Customer, Vendor, GL Account | **WHO** — the market | `DOMESTIC`, `EU`, `EXPORT` |
| **VAT Prod. Posting Group** | Item, Resource, GL Account | **WHAT** — the goods | `NO-VAT`, `VAT10`, `VAT25` |

The Cartesian product is the resolution key.

> **Why this is the pattern to steal:** the same item posts differently per market with **zero item-master change**. `EU × VAT25` → reverse charge; `DOMESTIC × VAT25` → 25% normal VAT. Same item, different customer, different GL, **no conditional logic in the posting function.**

This maps onto Carbon almost too neatly: **`itemPostingGroup` already exists and is already assigned to items** — it is currently only a reporting dimension and a pricing filter. It is the natural `VAT Prod. Posting Group`. What's missing is the business-side group and the matrix table.

**Proposed schema:**

```sql
-- WHO: assigned to customer + supplier
CREATE TABLE "taxBusinessPostingGroup" (
  "id" TEXT NOT NULL DEFAULT id(),
  "name" TEXT NOT NULL,              -- 'Domestic', 'EU', 'Export'
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "companyId" TEXT NOT NULL,
  ...
);

-- WHAT: reuse the existing itemPostingGroup, OR a dedicated group.
-- RECOMMENDATION: dedicated. itemPostingGroup is already overloaded with
-- pricing-discount semantics (quote-discount-system.md:47) and reporting
-- dimensions; conflating tax onto it couples two unrelated axes and will
-- force awkward group proliferation the first time a customer needs a
-- pricing split that isn't a tax split.
CREATE TABLE "taxProductPostingGroup" (
  "id" TEXT NOT NULL DEFAULT id(),
  "name" TEXT NOT NULL,              -- 'Standard', 'Reduced', 'Zero', 'Exempt'
  ...
);

-- THE MATRIX: the resolution key
CREATE TABLE "taxPostingSetup" (
  "id" TEXT NOT NULL DEFAULT id(),
  "taxBusinessPostingGroupId" TEXT NOT NULL,
  "taxProductPostingGroupId" TEXT NOT NULL,
  "taxCalculationType" "taxCalculationType" NOT NULL DEFAULT 'Normal',
  "taxPercent" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "taxIdentifier" TEXT,              -- the rounding-group key, see §7.5
  "salesTaxAccountId" TEXT,
  "purchaseTaxAccountId" TEXT,
  "reverseChargeTaxAccountId" TEXT,
  "nonDeductiblePercent" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "nonDeductibleTaxAccountId" TEXT,  -- NULL => fall back to the base line's
                                     --         account (the §6.2 convergence)
  "useForItemCost" BOOLEAN NOT NULL DEFAULT FALSE,
  "useForFixedAssetCost" BOOLEAN NOT NULL DEFAULT FALSE,
  "useForJobCost" BOOLEAN NOT NULL DEFAULT FALSE,
  "companyId" TEXT NOT NULL,
  UNIQUE ("taxBusinessPostingGroupId", "taxProductPostingGroupId", "companyId")
);

CREATE TYPE "taxCalculationType" AS ENUM (
  'Normal',          -- seller calculates and withholds
  'Reverse Charge',  -- buyer books both legs (§5.5)
  'Full Tax',        -- amount is entirely tax (import VAT)
  'Sales Tax'        -- US sales tax; recoverability always 0%
);
```

The `useForItemCost` / `useForFixedAssetCost` / `useForJobCost` switches are BC's cost-flow controls and they are exactly how **BC natively implements the IAS 2.11 capitalization rule**. The `useForJobCost` flag is the one that matters for Carbon's manufacturing context — it routes non-deductible tax onto job costs.

> ⚠️ **BC's hard-won constraints, learned the expensive way — inherit them as design constraints:**
> - *"After you enable non-deductible VAT, **you can't turn it off**."*
> - *"You **can't use unrealized VAT** together with non-deductible VAT."*
> - *"**Don't use the same VAT identifier** for both normal VAT where Non-Deductible VAT % is 0 and normal VAT where it's non-zero. Otherwise, the total non-deductible VAT amount will be **incorrectly calculated**."*

Source: [finance-setup-vat](https://learn.microsoft.com/en-us/dynamics365/business-central/finance-setup-vat) (fetched in full), [Table 325](https://learn.microsoft.com/en-us/dynamics365/business-central/application/base-application/table/microsoft.finance.vat.setup.vat-posting-setup), [non-deductible design details](https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-nondeductible-vat)

### 6.4 Jurisdictions and the tax detail grain

**A ship-to address resolves not to a state but to a *stack*:** state + county + city + N special districts (transit, stadium, hospital), each with its own rate, taxability rules, and effective dates ([34 TAC § 3.334](https://www.law.cornell.edu/regulations/texas/34-Tex-Admin-Code-SS-3-334)).

- **Rates are per-address-stack, not per-state.** Two customers across one street can differ.
- **ZIP codes are not jurisdictions** — they're USPS carrier routes that straddle boundaries. Rooftop geocoding is required.
- **One invoice can carry multiple stacks** — multi-ship-to, or partial shipments to different sites.
- **Date-effective rate versioning** across 12,000+ jurisdictions; each partial shipment taxes at **its own ship-date** rate.
- **Credit memos must reverse into the *original* stack** (§7.2).

**NetSuite's SuiteTax migration is the instructive precedent:** tax data moved **off the transaction lines onto a dedicated `taxdetails` sublist** — Tax Details Reference, Line Item, Tax Type, Tax Code, Tax Basis, Tax Rate, Tax Amount, **Jurisdiction**, Details. **One line → N tax detail rows.** Legacy NetSuite (`taxrate1` on the item sublist) structurally *could not represent* a state/county/city split. Carbon's current `salesInvoiceLine.taxPercent` has exactly the Legacy problem.

**Recommendation: a `salesInvoiceLineTax` / `purchaseInvoiceLineTax` detail table, one row per line × jurisdiction × tax type.** This is the auditable grain and it is what a provider returns.

```sql
CREATE TABLE "salesInvoiceLineTax" (
  "id" TEXT NOT NULL DEFAULT id(),
  "salesInvoiceLineId" TEXT NOT NULL,
  "jurisdictionId" TEXT,             -- FK to taxJurisdiction
  "jurisdictionType" TEXT,           -- State | County | City | Special
  "taxType" TEXT,
  "taxableAmount" NUMERIC NOT NULL DEFAULT 0,
  "nonTaxableAmount" NUMERIC NOT NULL DEFAULT 0,
  "exemptAmount" NUMERIC NOT NULL DEFAULT 0,
  "taxRate" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "taxAmount" NUMERIC NOT NULL DEFAULT 0,
  "recoverability" "taxRecoverability" NOT NULL DEFAULT 'nonRecoverable',
  "recoverablePercent" NUMERIC(10,5) NOT NULL DEFAULT 0,
  "sourcing" TEXT,                   -- Mixed | Destination | Origin
  "isNonPassThru" BOOLEAN NOT NULL DEFAULT FALSE,
  "providerReference" TEXT,          -- Avalara/TaxJar transaction line ref
  "companyId" TEXT NOT NULL
);
```

**If integrating Avalara later, four traps are already known:**
1. **`lines`/`details` are NOT returned by default** — requires `?$include=Details`. The per-jurisdiction breakdown is opt-in.
2. **`jurisType` is DEPRECATED** (18.1) → use `jurisdictionType`. `rateType` (18.3) → `rateTypeCode`. **Don't build schema on the deprecated names.**
3. **`isFee: true` → `rate` is a currency amount, not a percentage** (`"rate": 15` = $15.00, not 1500%).
4. **`isNonPassThru`** — a tax that *"must be paid directly by the company"*: must **not** hit the customer invoice but **must** hit your liability GL.

Also: `resolutionQuality` is the quality gate — **at or below `PostalCentroid*` you are taxing a ZIP centroid, not the building.** And `customerCode` is **case sensitive**, which combined with explicit ECMS exemption precedence means **a case mismatch silently loses the exemption rather than erroring.**

### 6.5 Freight as a first-class cost element — the item-charge pattern

All four major ERPs converge on the same four-part architecture. That convergence is strong evidence it's right.

**(a) Freight is a separate document line / cost element — never folded into item unit price.**
NetSuite: distinct landed cost item + category. SAP: separate condition type (category B), *supplementary* to gross price PB00. Odoo: a Service product flagged *Is a Landed Cost*. BC: `Type = Charge (Item)`.

> *Why:* freight has a **different vendor, arrival time, tax treatment, and allocation basis** than the goods. **Merging it destroys all four** — which is precisely what Carbon does today.

**(b) It sits in a clearing/holding account between receipt and invoice.** NetSuite's holding account *"cleared between the landed cost allocation and vendor bill entry"*; SAP's **per-origin** clearing accounts (freight and customs don't share a bucket); BC's posting-group-resolved GL.

**(c) Allocation via an explicit, user-chosen basis.** The vocabularies rhyme almost exactly:

| | NetSuite | SAP | Odoo | BC |
|---|---|---|---|---|
| equal | — | — | Equal | **Equally** |
| per unit | **Quantity** | qty-dependent | By Quantity | — |
| by value | **Value** | percentage | By Current Cost | **By Amount** |
| by weight | **Weight** | — | By Weight | **By Weight** |
| by volume | — | — | By Volume | **By Volume** |
| manual | Source=Manual | fixed amount | edit Valuation Adjustments | **Qty. to Assign** |

**Two design lessons:** every system provides a **manual override** — the suggestion engine is advisory, never mandatory. And NetSuite/SAP allocate **per category/origin** while Odoo/BC allocate **per charge line**.

> **Carbon today only does value-weighted, and only for header freight.** ASC 330 mandates no particular basis — the constraint is only that allocation be systematic, rational, and consistent. But **freight billed by weight should allocate by weight**; allocating it by value is defensible but weaker, and for a manufacturer shipping heavy raw material alongside light finished goods the difference is material.

**(d) The late freight invoice is a designed-for case, not an edge case.** NetSuite: `Source = Other Transaction` + Estimated Landed Cost. SAP: the entire planned/unplanned dichotomy *is* this problem. BC: **Get Receipt Lines** against posted receipts, with retroactive adjustment value entries via **Adjust Cost – Item Entries**. Odoo: a Landed Cost record targeting any validated transfer.

> ⭐ **The architectural consequence, and the thing to build around:** because (d) is guaranteed, **(b) is mandatory**. You cannot allocate freight at receipt if you don't know the amount, and you cannot leave inventory understated until the carrier bills. So something must hold the accrual, and something must **retroactively adjust already-posted — and possibly already-sold — inventory** (§5.2 step 4). That is why all four ship a **cost-adjustment engine** behind the freight feature rather than just an allocation formula, and why **Odoo forbids landed costs on Standard-costed products entirely** — there'd be no per-layer cost to adjust.
>
> **Carbon already has `shared/purchase-cost-adjustment.ts` and a `costLedger` with `appliesToCostLedgerId` and `adjustment`.** The hard part is already built. This is a much smaller lift than it looks.

**Proposed schema:**

```sql
CREATE TABLE "itemCharge" (
  "id" TEXT NOT NULL DEFAULT id(),
  "name" TEXT NOT NULL,              -- 'Freight In', 'Customs Duty', 'Insurance'
  "chargeType" "itemChargeType" NOT NULL,
  "clearingAccountId" TEXT,          -- per-origin clearing (the SAP lesson)
  "varianceAccountId" TEXT,
  "defaultAllocationMethod" "chargeAllocationMethod" NOT NULL DEFAULT 'Value',
  "taxProductPostingGroupId" TEXT,   -- freight has its OWN taxability (§7.1)
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "companyId" TEXT NOT NULL,
  ...
);

CREATE TYPE "chargeAllocationMethod" AS ENUM (
  'Equal', 'Quantity', 'Value', 'Weight', 'Volume', 'Manual'
);

CREATE TYPE "itemChargeType" AS ENUM (
  'Freight In', 'Freight Out', 'Duty', 'Insurance', 'Brokerage', 'Handling', 'Other'
);

-- Assignment: which charge lands on which receipt/invoice line, and how much
CREATE TABLE "itemChargeAssignment" (
  "id" TEXT NOT NULL DEFAULT id(),
  "itemChargeId" TEXT NOT NULL,
  "documentType" "journalLineDocumentType" NOT NULL,
  "documentId" TEXT NOT NULL,
  "documentLineReference" TEXT,      -- the target line
  "amount" NUMERIC NOT NULL DEFAULT 0,
  "allocationMethod" "chargeAllocationMethod" NOT NULL,
  "isManualOverride" BOOLEAN NOT NULL DEFAULT FALSE,
  "companyId" TEXT NOT NULL
);
```

> **Note `itemCharge.taxProductPostingGroupId`.** Freight has its own taxability that differs from the goods it ships (§7.1) — this field is what lets `EU × Freight` resolve differently from `EU × VAT25`. It is the join that makes the whole §7.1 mess tractable, and it's the kind of thing that is very hard to retrofit later.

### 6.6 Fields Carbon needs that most ERPs also lack

Beyond the schema above, these are the fields whose absence *causes* the §7 edge cases to be unhandleable:

| Field | On | Why |
|---|---|---|
| **FOB / Incoterms point** | `shippingTerm` | Determines control transfer (ASC 606-10-25-18A vs 18B) **and** taxability in FL. Currently `shippingTerm` is a bare label. |
| **Carrier type** (common carrier vs own vehicle) | `shippingMethod` | **CA taxes freight delivered in your own vehicles** (§7.1) |
| **Actual freight cost per shipment** | `salesOrderShipment` | CA taxes the **markup** over actual cost, and *"You do not keep records that show the actual cost of the delivery"* → **all taxable** |
| **Shipping/handling decomposition** | invoice lines | **VA: combining "S&H" on one line taxes the entire amount** |
| **Discount funding source** (customer vs third-party) | discount records | Manufacturer-funded discounts are taxed on **gross** (§7.3) |
| **Discount timing** (at-invoice vs contingent) | discount records | CA/NY conflict on cash discounts (§7.3) |
| **`channel` + `taxCollectedBy`** (`self` \| `facilitator`) | orders | FBA/marketplace (§7.6) |
| **Per-state freight proration *strategy*** | tax config | GA/NY/IL use three **different algorithms**, not three settings (§7.1) |

---

## 7. Edge Cases

### 7.1 ⭐ Tax on freight — the per-state boolean is wrong

There is no national rule, and every "no" carries conditions that defeat a naive flag.

| State | Taxable? | Test | Separate statement enough? | Own vehicle | Mixed-shipment proration |
|---|---|---|---|---|---|
| **TX** | **Yes** | Follows item | **No** | 3rd-party-carrier-only exempt | not specified |
| **GA** | **Yes** | Part of sales price | **No** — even if optional | — | ⭐ **elect: all / sales-price % / weight %** |
| **NY** | **Yes** (if item taxable) | Follows item | No | Customer-arranged 3rd party escapes | default all-taxable; fair allocation permitted |
| **PA** | **Yes** | Follows transaction | **No** — even postage | 3rd party must **deliver AND bill** | not specified |
| **CA** | **No**, conditionally | Common carrier + separate + ≤ actual cost + records | **Not alone — all 4** | ⚠️ **TAXABLE** | excess over actual cost taxable |
| **FL** | **No**, conditionally | Separate **AND purchaser-avoidable** | Not alone | FOB origin → exempt | silent |
| **IL** | **No**, conditionally | ⭐ **"inseparable link"** | Not alone — needs pickup option | — | ⭐ **majority test** |
| **MA** | **No**, conditionally | Separate + good faith + actual cost + post-sale | Nearly | — | not specified |
| **VA** | **No**, conditionally | Separately stated | **Yes**, freight only | — | ⚠️ **combining taints all** |

**The four that will bite a manufacturer:**

⭐ **California taxes freight delivered in your own vehicles.** A manufacturer with a delivery fleet that codes "CA = shipping exempt" **under-collects systematically.** CA also taxes the **markup**, and *"You do not keep records that show the actual cost of the delivery"* → all taxable. **This is a cost-capture requirement, not tax config.** ([CDTFA Pub. 100](https://cdtfa.ca.gov/formspubs/pub100/applying-sales-tax.htm))

⭐ **Virginia: combining "S&H" on one line taxes the entire amount** — *"When shipping and handling charges are billed together as one charge, **the entire charge is subject to sales and use tax**."* **A pure invoice-presentation bug with a direct tax cost.** ([23VAC10-210-6000](https://law.lis.virginia.gov/admincode/title23/agency10/chapter210/section6000/))

⭐ **Illinois' "inseparable link" is a different doctrine entirely** — not separate statement, but whether the buyer had a real alternative: it exists when *"the seller does not offer the purchaser the option to receive the tangible personal property in any manner except by the payment of transportation and delivery charges."* ([86 Ill. Adm. Code 130.415](https://ilga.gov/commission/jcar/admincode/086/086001300D04150R.html))

⭐ **Mixed-shipment proration is three different algorithms.** GA = elective ratio (sales price **or weight** — genuinely useful when shipping heavy exempt raw material with light taxable goods); NY = default-all-taxable with fair-allocation election; IL = ⚠️ **binary majority test** — the lump-sum charge is nontaxable if the nontaxable items' selling price is *greater than* the taxable ones'. **An ERP prorating IL freight by ratio is wrong in both directions.**

**FL adds a doctrine no one models:** the charge *"can be avoided by a decision or action solely on the part of the purchaser"* — plus FOB: *"Since the title to the property passes at the point of origin, transportation services… are not a part of the taxable selling price."* ⭐ **Incoterms/FOB on the sales order is a tax-relevant field, not just logistics.**

> **Carbon's current position: header shipping is untaxed everywhere** (sales view; deliberate per the comment at `post-sales-invoice/index.ts:337-338`). Given the table above, **this is wrong in TX, GA, NY, and PA at minimum** — the four "Yes" states.

### 7.2 Credit memos / returns

**⭐ Restocking fees — a concrete, testable bug.** CA: *"The retailer must refund the **full sales tax reimbursement**, **not merely the tax on the net amount** of the credit after the restocking charge."* On a $1,000 sale + $80 tax with a $100 restocking fee:

| Account | Debit | Credit |
|---|---:|---:|
| Sales Returns & Allowances | 1,000.00 | |
| Sales Tax Payable | **80.00** | |
| &nbsp;&nbsp;Accounts Receivable / Cash | | 1,080.00 |
| &nbsp;&nbsp;Restocking Fee Revenue | | 100.00 |

**Reverse $80, not $72.** Many ERPs compute tax on the net credit and understate the reversal. ([CDTFA Reg. 1700](https://cdtfa.ca.gov/lawguides/vol1/sutr/1700.html))

CA also makes the deduction **conditional on actually refunding the tax to the customer** — *"only available to the retailer if the retailer refunds the entire sale price and sales tax reimbursement to the purchaser."*

**⭐ NY: the reversal must go to the same local jurisdiction as the original sale.** Not an amended return — a negative in Column C on the current ST-100, and *"Credits identifiable by locality must be reported on the appropriate line in Step 3."*

> **This is why the credit memo must link to the source invoice and inherit its *persisted jurisdiction stack* rather than re-deriving from ship-to** — a customer who moved would reverse into the wrong locality. **It must also inherit the rate as of the original sale date, not the current rate.** Both are schema constraints on `salesInvoiceLineTax`.

SOL: NY = *"within three years from the date the sales tax return was due, or two years from the date the tax was paid, whichever is later."*

### 7.3 ⭐⭐ Discounts — the highest-value finding

**Manufacturer vs. store coupon.** The principle is **third-party consideration**: the retailer received full value (part from customer, part from the manufacturer), so the base stays gross.

- **CA:** *"amounts paid by manufacturers to reimburse you for the value of the manufacturer's coupons are **included in your total taxable sales**"* · *"Retailer coupons... are **excluded**."*
- **NY:** *"Store-issued coupons generally reduce the receipt subject to sales tax, while **manufacturers' coupons do not**."*

⭐ **CA Reg. 1671.1 extends this well past coupons — the sleeper risk for a manufacturing ERP.** Taxable third-party payments *"include, but are not limited to, purchase and cash discounts, coupon reimbursements, **ad or rack allowances, buy-downs, scanbacks, voluntary price reductions** and other incentives, promotions, and rebates."* **Buy-downs and scanbacks look like ordinary price reductions in a pricing engine but are taxable on gross.** CA also imposes a **disclosure duty** → **the ERP must print the grossed-up tax base on the invoice.**

#### ⚠️⚠️ CA and NY directly CONFLICT on cash discounts

Both verified independently from primary sources:

- **New York:** *"The early payment discount is **not subtracted** from the amount of the invoice that is subject to sales tax."*
- **California:** *"your total taxable sales are **reduced by the amount of cash discounts** you offer your customers for prompt payment."*

**Opposite answers to the same question.** Both are defensible — NY taxes the receipt *as invoiced* (the discount is contingent and may never be earned); CA looks through to the amount *actually received*.

⭐ **This creates a timing problem unique to cash discounts:** at invoice time you don't know whether the customer will pay within the window. In **CA**, an earned discount **retroactively reduces the taxable base of an already-issued invoice** — requiring a tax-bearing adjustment at payment application or a period-level "cash discounts taken" deduction. In **NY**, no adjustment at all. **An ERP applying one behavior globally is wrong in one of the two states on every 2/10-net-30 invoice.**

| Discount type | Reduces base? | Rationale |
|---|---|---|
| Trade / volume / cash-and-carry | **Yes** (CA, NY) | genuine price reduction |
| **Cash / early-payment** | ⚠️ **CA: YES / NY: NO** | CA → amount received; NY → receipt as invoiced |
| Store / retailer coupon | **Yes** | no third-party reimbursement |
| Manufacturer coupon / rebate | **No — GROSS** | taxable third-party consideration |
| **Buy-downs, scanbacks, ad/rack allowances** | **No — GROSS (CA)** | enumerated third-party payments |

> ⭐ **Schema consequence:** a discount needs a **funding-source dimension** (customer-funded vs. third-party-funded) **and** a **timing dimension** (at-invoice vs. contingent-on-payment). **Both are tax-determinative; neither exists in a plain `discountAmount` column.** Carbon has `salesDiscountAccount` and `customerPaymentDiscountAccount` on `accountDefault` — the *accounts* are separated, but the *tax dimension* is not.

### 7.4 Partial shipments

> ⚠️ **Weakest-sourced section — no state publishes guidance under this heading.** The *inputs* are cited; the *synthesis* is inference. Get a state-specific opinion before implementing.

**Doctrine 1 — accounting method determines *when*.** Tex. Rule 3.302: **accrual** → tax due *"in the reporting period in which the sale occurs"*; **cash** → *"in which the payment is received."*

**Doctrine 2 — title passage determines when the sale occurs.** CDTFA: *"A contract will be construed as a **shipment contract** unless it expressly requires delivery at destination point"* · ⚠️ *"Where shipment is made by **facilities of the retailer**, the contract is a **destination contract** despite use of the F.O.B. shipping point term."*

**Synthesis (inference — flagged):** for an accrual-basis seller, tax accrues **when title to that portion passes — per shipment, not per order**:
- Tax due on **each partial shipment as it ships**, on that shipment's value
- **Rate locks per shipment date** → a long order spanning a rate change carries **different rates on different releases of the same order**
- **Allocated freight** must be tested against **that shipment's own** taxable/exempt mix (GA weight proration, IL majority test operate per shipment)
- **Backorders:** the unshipped balance has no accrued tax. **A tax-inclusive total at order entry is an estimate, not a liability.**

⚠️ **Deposits/progress billings on manufacturing orders are genuinely unresolved** — TX cash-basis would accrue on payment; accrual would not.

### 7.5 ⭐ Rounding — the rule is permissive, which is the opposite of what teams assume

**SSUTA Section 324**, verified via four independent state codifications ([RCW 82.08.054 (WA)](https://app.leg.wa.gov/rcw/default.aspx?cite=82.08.054), [Ohio ST 2005-05](https://tax.ohio.gov/business/ohio-business-taxes/sales-and-use/information-releases/st200505), [MN Revenue Notice 05-08](https://www.revenue.state.mn.us/revenue-notice/05-08-sales-and-use-tax-rounding-item-or-invoice), Vermont):

1. **Algorithm:** *"carry the computation to the **third decimal place** and round **up** to the next cent whenever the third decimal place is **greater than four**"*
2. ⭐ **Seller election:** *"sellers may elect to compute the tax due on a transaction on an **item or an invoice basis**"*
3. ⭐ **Aggregation:** the rounding rule may be applied to the **aggregated state and local taxes**

**No state requires line-level, and none requires invoice-level. In SST member states the seller elects.**

**Three consequences:**
1. **Be consistent** — the election is a seller-level policy; flip-flopping invites audit questions even though both methods are individually compliant.
2. ⭐ **Aggregate state+local *before* rounding.** §324 permits it. Rounding state, county, city, and district **separately** and summing produces a larger error — **on a 4-jurisdiction invoice this drifts up to ~2¢ per line.**
3. ⚠️ **Non-SST states are the gap** — §324 binds members only. **CA, TX, NY, FL are not bound** and their rules were not verified. Though **Tex. Tax Code § 151.052(c)** — tax on *"the sum of the sales prices"* — points toward invoice-level in TX.

**Vendor corroboration:** BC rounds at the **VAT-Identifier-group within the document** level — *"The VAT calculation is based on the sum of all lines with the same VAT identifier in the document."* **Neither pure line nor pure invoice.** That's the `taxIdentifier` column in §6.3, and it's why it's there.

⚠️ **Emerging:** with the US penny discontinued, **cash rounding** now interacts with tax rounding — live legislative territory in 2026 (e.g. Indiana S.B. 243).

### 7.6 Marketplace facilitator (FBA/DTC)

**The seller reports GROSS, then deducts.** Consistent across all three states verified — the seller does **not** omit facilitated sales.

- **WA:** *"Report your gross (marketplace and direct) Washington retail sales under Retailing B&O"* → deduct via *"Gross Sales Collected by Facilitator."*
- **CA:** *"you are required to **continue to report your total sales**... **including those sales facilitated through a marketplace**"* → deduct as "other."
- **TX:** permit still required *"even if your only sales are through a marketplace provider"* — unless the provider **certifies** it collects. **The default is *seller collects*.**

| Item | Treatment |
|---|---|
| Gross sale | **Revenue in full** — identical to a direct sale |
| Tax collected by Amazon | **Never enters seller's cash or GL** — not revenue, not tax payable |
| Threshold | Marketplace sales **count** toward it in TX, CA, WA |
| ⚠️ Gross receipts tax | **WA B&O still owed by the seller on facilitated sales** |

**⚠️ Two traps:**
- **"Amazon handles Washington" is false for B&O.** Retail sales tax is deducted; B&O is not.
- ⭐ **Threshold contamination:** *"A remote seller shall include in total Texas revenue, the aggregate sum of all sales made on all mediums, **including all marketplaces and the remote seller's own website**."* **Amazon volume can push you over $500k and force collection on your own DTC site.** This is *the* FBA/DTC trap.

**Schema:** `channel` + `taxCollectedBy` (`self` | `facilitator`) on every order. **Revenue posts identically either way; only the liability leg differs.** The common bug is netting facilitator tax out of revenue — understates gross and breaks the WA/CA deduction reconciliation.

### 7.7 Nexus

*South Dakota v. Wayfair* (2018) killed physical presence. The Court **upheld** SD's $100k-or-200-transactions but **did not mandate it** — hence the fragmentation. ([CRS IF11832](https://www.congress.gov/crs-product/IF11832))

**2026 state of play:** 45–46 jurisdictions enforce economic nexus (50 + DC − **NOMAD**: NH, OR, MT, DE; Alaska local-only). ~41 at $100k; **CA, NY, TX at $500k**. **The transaction-count test is dying** — ~16 states removed it; **Illinois removed it 2026-01-01**; **Kentucky removes it 2026-08-01**; **Connecticut is an outlier requiring $100k AND 200** (conjunctive).

> ⚠️ **Do not hard-code per-state thresholds from this report.** The Sales Tax Institute chart extraction contained visible internal errors. **Trends reliable; values must be re-pulled at implementation time.** Threshold *measurement periods* (calendar vs. rolling 12-month vs. prior-year) also vary by state and were **not researched**.

**What the ERP needs:** a **registration state machine** per jurisdiction — threshold crossed → registration deadline → collection start. **The gap between those is where liability accrues.**

---

## 8. Pre-existing Bugs Found During Research

These surfaced while mapping the code and are **independent of whether this proposal proceeds**. Flagging them because two are live correctness issues.

### 8.1 ⚠️ FX direction contradiction on `supplierShippingCost`

Four sites disagree on whether `exchangeRate` multiplies or divides:

| Site | Formula |
|---|---|
| `purchaseInvoices` view (`20260630095023_invoice-derived-status.sql:201`) | `supplierShippingCost * exchangeRate` |
| `PurchaseInvoiceSummary.tsx:419` | `supplierShippingCost / exchangeRate` |
| `post-purchase-invoice/index.ts:560` | `supplierShippingCost / exchangeRate` |
| `post-receipt/index.ts:567` | `supplierShippingCost * exchangeRate` |

The comment at `post-purchase-invoice/index.ts:555-559` explicitly asserts *"supplier→base is DIVIDE (matching the `purchaseInvoices` view…)"* — **but the view multiplies.** For any non-1.0 rate, **receipt and invoice value the same freight in opposite directions**, and the difference silently lands in `purchaseVarianceAccount`. One of the two is wrong; the comment is wrong regardless.

### 8.2 ⚠️ `purchaseOrderLine.shippingCost` is silently dropped at receipt

`receiptLine` has no `shippingCost` column and `post-receipt`'s `totalLinesCost` (lines 571-580) excludes it — while `post-purchase-invoice` (line 805) **does** include the analogous `invoiceLine.shippingCost`. **Line-level freight is dropped from receipt valuation and reappears at invoice**, guaranteeing a variance.

### 8.3 Allocation bases differ between purchase and sales

Purchase weights by `qty*unitPrice + shippingCost + taxAmount` (tax-**inclusive**, `post-purchase-invoice:802-805`); sales weights by `qty*unitPrice + shippingCost + addOnCost` (**pre-tax**, `post-sales-invoice:322-324`, deliberately per the comment). Once tax leaves the line total (§6), the purchase basis must change anyway.

### 8.4 `balance` derives from stored `totalAmount`, not computed

Both `salesInvoices` and `purchaseInvoices` views compute `totalAmount` but derive `balance` from the *stored* `si."totalAmount"` / `pi."totalAmount"` column (`20260630095023:92, 203`). **The two can diverge.**

### 8.5 Dead reads and orphans

- `post-shipment/index.ts:129` reads `salesOrderShipment.shippingCost` and never uses it
- `shippingMethod.carrierAccountId` — nulled by `reset-chart-of-accounts.sql:94`, read by nothing
- Account `6040` — seeded, unreachable
- `salesTaxPayableAccount` / `purchaseTaxPayableAccount` / `reverseChargeSalesTaxPayableAccount` — seeded, form-validated as **required**, read by nothing
- `SalesInvoiceSummary.tsx:422-427` — `customerShippingCost` computed identically to `shippingCost` (both `* exchangeRate`); the presentation-currency figure is never un-converted

---

## 9. Corrections to the Task Brief

Several premises in `tasks/accounting-research-shipping-tax.md` did not survive the sources. Recording them so they don't propagate:

| Brief said | Reality |
|---|---|
| "Cite IAS 12 scope note for VAT" | ⚠️ **Wrong citation.** IAS 12 covers taxes "based on taxable profits"; *"sales or payroll taxes are not income taxes."* VAT is **outside IAS 12 entirely.** Cite it to prove VAT *isn't* covered — never to support VAT accounting. |
| "Cite ASC 330 that non-recoverable tax capitalizes" | ⚠️ **ASC 330 never mentions sales tax.** The treatment is an *application* of ASC 330-10-30-1's general principle. Contrast IAS 2.11, which **is** explicit. **That asymmetry is itself the finding.** |
| "Posting groups (`postingGroupInventory` etc.)" | **Dropped** in `20260229000000_drop-posting-groups.sql`. Zero matches in generated types. |
| "`accountCategory` / `accountSubcategory`" | **Dropped** in `20260229000003_chart-of-accounts-tree.sql:83-84`, replaced by a `parentId` tree. |
| "`normalBalance` column" | **Does not exist.** Sign is derived from `accountType` at runtime via `credit()`/`debit()` in `functions/lib/utils.ts:57,71`. |
| "`valueLedger` table" | **Does not exist.** Only `costLedger`. |
| "`taxable` column" | **Does not exist anywhere.** |
| "NetSuite 'Item Shipping Cost' field" | ❌ **No such field.** There *is* a **Shipping Cost** field on the Sales/Pricing subtab — a *sales-side* charge, unrelated to landed cost. The landed-cost flag is **Track Landed Cost** on Purchasing/Inventory. |
| "NetSuite 'manual' allocation method" | ❌ Only **Weight / Quantity / Value**. "Manual" is a value of the **Source** field (how the *amount* is derived), not an allocation basis. |
| "SAP condition types FRA1/FRB1" | ⚠️ **Not on help.sap.com at all.** Community/config lore. The *concepts* are documented; the *codes* are not doc-citable. |
| "Odoo requires real-time valuation for landed costs" | ❌ **Out of date.** Current 19.0 docs: AVCO-or-FIFO is the only hard prerequisite; valuation may be manual or automatic. |
| "13,000 tax jurisdictions" | **12,000+** is what's sourceable (Avalara). No official government count exists. |
| Avalara `jurisType` | ⚠️ **Deprecated** (18.1) → `jurisdictionType`. **Don't build schema on it.** |

---

## 10. Implementation Checklist for Carbon

Ordered by dependency and by value-per-unit-risk. **Phase 1 is independently shippable and fixes the actual misstatement.**

### Phase 0 — Fix the live bugs (no schema change)

- [ ] **Resolve the FX direction contradiction** (§8.1). Pick one, fix the other three sites, correct the misleading comment at `post-purchase-invoice/index.ts:555-559`. Add a test with a non-1.0 `exchangeRate` asserting receipt and invoice agree.
- [ ] Carry `purchaseOrderLine.shippingCost` onto `receiptLine` or exclude it from the invoice basis (§8.2) — either way, make them symmetric.
- [ ] Fix `balance` to derive from the computed `totalAmount` (§8.4).
- [ ] Remove the dead read at `post-shipment/index.ts:129` or wire it (it becomes live in Phase 2).

### Phase 1 — Separate tax from revenue (the actual misstatement)

**This is the fix Brad is asking for and it does not require the full tax subsystem.**

- [ ] Add `taxAmount` to `salesInvoiceLine` (purchase side already has it, generated).
- [ ] In `post-sales-invoice`, stop folding `(1 + taxPercent)` into `totalLineCost` (line 330). Credit the pre-tax amount to `salesAccount` and the tax to `accountDefault.salesTaxPayableAccount` as a **separate journal line**.
- [ ] In `post-purchase-invoice`, keep capitalizing tax into inventory **for now** (correct for US non-recoverable) but **isolate it as a named term** rather than an inline addition at line 805 — this is the seam Phase 4 opens.
- [ ] Reconcile the `salesInvoices` / `purchaseInvoices` views to the new posting.
- [ ] **Backfill/restatement question for Brad:** every posted sales invoice to date has tax in revenue. Decide whether to restate, and over what period. **This needs an accounting decision, not an engineering one.**

### Phase 2 — Separate shipping from revenue

- [ ] Add `accountDefault.salesShippingRevenueAccount` → adopt orphan account `4020`.
- [ ] Add `accountDefault.freightOutExpenseAccount` → adopt orphan account `6040`.
- [ ] In `post-sales-invoice`, credit billed shipping to `salesShippingRevenueAccount`, not `salesAccount` (§5.6).
- [ ] In `post-shipment`, post the carrier cost to `freightOutExpenseAccount` (currently the value is read and discarded).
- [ ] Make the freight-out account configurable (COGS vs SG&A is a genuine customer policy election — §3.2).

### Phase 3 — Freight as a first-class cost element

- [ ] `itemCharge` + `itemChargeAssignment` tables (§6.5).
- [ ] `freightInClearingAccount` (`1450`) + `freightInVarianceAccount` (`5040`).
- [ ] Allocation methods beyond value: **Equal, Quantity, Weight, Volume, Manual**.
- [ ] **Manual override on every allocation** — every vendor provides this; the suggestion engine is advisory.
- [ ] **Late-freight flow** (§5.2): accrue at receipt → clear at carrier invoice → route the variance through `purchase-cost-adjustment.ts`, splitting between Inventory and COGS by remaining quantity. **The engine already exists — this is wiring, not building.**
- [ ] Support a **freight vendor ≠ goods vendor**.

### Phase 4 — The tax subsystem

- [ ] `taxBusinessPostingGroup` (WHO) + `taxProductPostingGroup` (WHAT) + `taxPostingSetup` matrix (§6.3).
- [ ] `taxCalculationType` enum: Normal / Reverse Charge / Full Tax / Sales Tax.
- [ ] **`recoverability` + `recoverablePercent`** — the core abstraction (§6.2). Build for VAT; sales tax falls out free.
- [ ] **Null `nonDeductibleTaxAccountId` → fall back to the base line's account** (the three-vendor convergence).
- [ ] `useForItemCost` / `useForFixedAssetCost` / `useForJobCost` cost-flow switches.
- [ ] `inputVatReceivableAccount` (`1260`), `vatControlAccount` (`2250`), `useTaxPayableAccount` (`2240`).
- [ ] **Reverse charge posts BOTH legs** even though net is zero — statutory reporting depends on it (§4.6).
- [ ] **Use tax accrual on inventory issues to non-COGS destinations** — a *costing*-transaction trigger in `issue` / `post-production-event` / `post-inventory-adjustment`, not a purchasing one (§4.4).
- [ ] Inherit BC's constraints as design constraints (§6.3).

### Phase 5 — Jurisdictions, certificates, providers

- [ ] `salesInvoiceLineTax` / `purchaseInvoiceLineTax` detail tables — one row per **line × jurisdiction × tax type** (§6.4).
- [ ] `taxJurisdiction` with **date-effective rate versioning**.
- [ ] **Persist the jurisdiction stack on the source document**; credit memos inherit it **and the original sale date's rate** (§7.2).
- [ ] **Exemption certificate registry** — per customer, per jurisdiction, **with expiry**. ⚠️ *The largest real-world audit exposure, and it was not in the brief.*
- [ ] **Partial-rate exemptions** (CA 3.9375%) + **annual accumulators** (CA $200M cap) — `isExempt` booleans cannot express these (§4.3).
- [ ] Provider integration (Avalara/TaxJar) — heed the four traps and `resolutionQuality` gating (§6.4).
- [ ] Nexus **registration state machine** per jurisdiction. **Re-pull thresholds; do not use this document's values** (§7.7).
- [ ] `channel` + `taxCollectedBy` on orders for FBA/marketplace (§7.6).

### Phase 6 — The fields that make §7 tractable

- [ ] **FOB / Incoterms point** on `shippingTerm` — control transfer *and* FL taxability.
- [ ] **Carrier type** (common carrier vs own vehicle) on `shippingMethod` — **CA taxes own-vehicle delivery**.
- [ ] **Actual freight cost per shipment** — CA taxes markup, and no-records → all taxable.
- [ ] **Shipping/handling decomposition** — VA taxes the whole line if combined.
- [ ] **Discount funding source + timing dimensions** (§7.3) — CA/NY conflict on cash discounts.
- [ ] **Per-state freight proration *strategy*** — GA/NY/IL need three different **algorithms** (§7.1).
- [ ] `taxIdentifier` rounding groups; **aggregate state+local before rounding** (§7.5).
- [ ] **IFRS mode:** no 25-18B election → assess separate PO → `shippingContractLiabilityAccount` (`2270`) (§3.5).

---

## 11. Verification Status

**Primary-verified — fetched and quoted directly (highest confidence):**
- **IAS 2.10, 2.11, 2.16** — ifrs.org HTML standard / issued PDF ✅
- **IASB Basis for Conclusions BC116R–BC116U + Appendix A(d)** — the IFRS-vs-Topic-606 shipping delta, **in the IASB's own words** ✅
- **D365 BC `finance-setup-vat`** — Microsoft Learn, fetched in full ✅
- **Tex. Tax Code § 151.052, § 151.704** ✅ · **CCR § 1525.4, § 1668** · **CDTFA Pub. 100 / 113 / Reg. 1671.1 / Reg. 1700 / MPFAct** ✅
- **NY TB-ST-838 / 860 / 810** ✅ · **WA DOR marketplace + RCW 82.08.054** ✅ · **TX Comptroller marketplace + Pub. 94-124 + audit manual ch.5** ✅ · **IL 130.415** ✅ · **VA 23VAC10-210-6000** ✅
- **EC "Persons liable for VAT"** (Art. 193/194/196) ✅ · **HMRC VAT Notice 735 / 700-21 / 706** ✅ · **IFRIC Update Sept 2021** ✅
- **Avalara AvaTax** — from the live production OpenAPI spec (`rest.avatax.com/swagger/v2/swagger.json`), first-party and machine-readable ✅
- **All Carbon repo claims** — file:line verified against the working tree ✅

**⚠️ Secondary-corroborated only (≥2 independent sources, identical wording):**
- **ASC 330-10-30-1, -30-7, -30-8** · **ASC 606-10-25-18A/18B, -32-2, -32-2A, -55-36** · **ASC 105-10-05-6**
- *Reason:* the FASB Codification is paywalled and the ASU 2016-10 PDF is **encrypted and image-scanned** (CCITTFaxDecode), so it cannot be text-extracted. **Do not lift these paragraph numbers into anything external without a primary check.**

**❌ Claims actively disproven during research (do not repeat):**
- "Double freight" as current ASC 330 text — **superseded ARB 43 language**
- ASC 605-45-50-2 as live authority — **superseded by ASU 2014-09**
- GAAP Dynamics' 18A/18B description — **inverted**; corrected via Deloitte DART
- NetSuite "Item Shipping Cost" field and "manual" allocation method — **neither exists as described**
- Odoo "requires real-time valuation" — **out of date**
- A WebFetch of the IASB's ap7b staff paper returned a **fabricated quote** ("An entity shall present revenue net of any sales taxes") from a compressed PDF. **That sentence is not in IFRS 15.** Discarded.

**⚠️ Known gaps — flagged rather than guessed:**
- **SAP:** `help.sap.com/docs/*` is JS-rendered and returns empty to fetchers. Condition types **MWVS/MWAS/NAVS**, procedures **TAXD/TAXGB/TAXF**, and t-codes/tables **OB40/OBCN/T030K/T007B** are **community-sourced only** — the *concepts* are verified from legacy static pages, the *identifiers* are not. SAP's own TAXUSJ example is **9 chars / three levels (2-3-4)**, contradicting the 2-3-4-1 structure in the brief.
- **NetSuite:** all field **internal IDs unverified** — Records Browser is auth-gated (HTTP 403). Names are UI prose labels, not schema.
- **Odoo:** journal account mapping is **not documented** by Odoo — community knowledge; confirm against module source.
- **Non-SST rounding rules (CA, TX, NY, FL)** — **not verified**. SSUTA §324 binds members only.
- **Nexus threshold *values* and *measurement periods*** — trends reliable, **values must be re-pulled**.
- **Partial shipments (§7.4)** — synthesis is **inference** from two doctrines; no state publishes guidance under this heading. **Deposits/progress billings genuinely unresolved.**
- **Amazon-specific mechanics** (the `MarketplaceFacilitator` settlement flag) — Seller Central is JS-gated; **secondary-sourced only**.
- **TaxJar 2026 availability** — marketing-page evidence only; the *"consider Stripe Tax"* steer is suggestive but **not a sunset notice**.
