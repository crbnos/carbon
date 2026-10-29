# SAP-Grade AP/AR Document Model Research: Best-Practices Survey

> Findings only — no implementation proposals. Prepared for the strategic goal of making
> Carbon the single authoritative writer to the GL, owning every GL-affecting document as a
> first-class object, with spend tools (Ramp) feeding Carbon rather than writing the GL in parallel.

## Summary

Surveyed how SAP (S/4HANA FI/CO + MM), Oracle NetSuite, Oracle Fusion Cloud ERP, and Microsoft
Dynamics 365 Finance & Operations structure their AP/AR document model and adjacent postings, plus
the mature integration pattern for spend-management tools (Ramp/Brex/Concur) and what constitutes a
GL "system of record." The dominant, consistent finding across all four enterprise ERPs: **every
distinct economic event is its own first-class document type, with its own number range/sequence and
its own posting behavior — never a signed ("negative") variant of another document.** A vendor credit
is a separate document from a vendor invoice; a prepayment is a separate document from a payment; a
purchase return credit is a separate document from a bill. Employees are modeled as a distinct
payable population (an employee-vendor with a *separate reconciliation/control account*, or a
dedicated employee-liability account), never silently merged into trade AP. GR-IR/GRNI is a
first-class clearing account driven by a three-way match where the **goods receipt** posts one side
and the **invoice receipt** clears it, with price/quantity/FX variances booked to dedicated variance
accounts. Spend tools universally **feed source documents into the ERP and let the ERP own the GL
post** (Concur's Financial Integration Service makes this an explicit retrieve→acknowledge→ERP-posts→
status-back→lock handshake); writing the GL in parallel is the named anti-pattern (reconciliation
drift, no single source of truth). Carbon today has strong first-class coverage for invoices,
payments, and card charges, but **overloads** employee reimbursement onto `purchaseInvoice`, has
**no external-GL representation** for credit/debit memos and returns (`backingEntityType: null`), and
is **missing** down payments/prepayments entirely.

## Competitors Surveyed

- **SAP S/4HANA (FI/CO + MM)** — the enterprise reference for the document-type + number-range model,
  special G/L transactions, GR/IR, and Concur/Travel-Management posting.
- **Oracle NetSuite** — mid-market cloud ERP with a clean per-transaction-type record model and an
  explicit GL Impact / Accrued Purchases / period-lock surface.
- **Oracle Fusion Cloud ERP (Financials)** — enterprise cloud; notable for having *both* an AP credit
  memo and an AP debit memo, document-sequence categories, and Receipt Accounting (Cost Management)
  for GRNI.
- **Microsoft Dynamics 365 Finance & Operations** — enterprise cloud; notable for its posting-profile
  + posting-type + number-sequence model and its explicit prepayment-invoice vs prepayment-journal
  contrast.
- (Cross-cutting) **Ramp, Brex, SAP Concur** — spend-management feeders, for the integration pattern.

---

## The foundational concept: document TYPE + own number range (not a "negative invoice")

Every enterprise ERP models a reduction/adjustment as a **separate document object of a different
type**, drawing its own number range/sequence and posting with the opposite direction — not as a
sign-flipped line on the original.

- **SAP** — Every posting is an accounting document carrying a two-character **document type** (KR
  vendor invoice, RE PO invoice, KG vendor credit memo, DR customer invoice, DG customer credit memo,
  KZ/DZ payments, SA/AB journals). The document type controls which account types may post, the
  **number range** (per type, per company code/fiscal year), and reversal behavior (config OBA7;
  number ranges FBN1/OMR4). A credit memo (FB65/FB75) is the same *screen* as the invoice (FB60/FB70)
  with the Credit-Memo/Invoice indicator flipped, but the *result* is a distinct KG/DG document with
  its own number and opposite posting keys — not a negative KR/DR line.
- **NetSuite** — Each AP/AR document is a distinct *transaction record type* with its own record
  definition, numbering, and **GL Impact** subtab. Vendor Credit and Credit Memo are separate records,
  not negative bills/invoices.
- **Oracle Fusion** — Credits are distinct **invoice types** (AP) or transaction-type **Classes** (AR:
  Invoice, Chargeback, Credit Memo, Debit Memo, Deposit, Guarantee). Numbering is by **document
  sequence** assigned to predefined **document sequence categories** ("Standard Invoices," "Credit
  Memo Invoices"), which can be Automatic, Manual, or **Gapless**.
- **Dynamics 365** — Distinct document types are separate documents driven by separate **number
  sequences** (AP/AR parameters) and resolved to GL through **posting profiles** (subledger→main-account
  conversion) and **posting types** (debit/credit categories). A single voucher carries multiple
  posting types (e.g., vendor-balance line + offset line).

**Why this matters for the strategic goal:** "own every GL-affecting document as a first-class object"
is precisely the enterprise pattern — a distinct type per event, each with independent numbering,
posting logic, and an audit identity.

---

## Comparison table — AP/AR document types across the four ERPs

| Economic event | SAP (S/4HANA) | NetSuite | Oracle Fusion | Dynamics 365 F&O |
|---|---|---|---|---|
| **Vendor invoice (non-PO)** | FI vendor invoice **FB60**, type **KR** (Dr expense / Cr vendor) | **Vendor Bill** (Dr expense / Cr AP) | **Standard Invoice** (Dr expense / Cr liability) | **Vendor invoice journal**; **invoice register + approval** (accrual via Arrival/Offset) |
| **Vendor invoice (PO-based)** | **MIRO**, type **RE** (Dr GR/IR / Cr vendor) | **Vendor Bill** matched to receipt (Dr Accrued Purchases / Cr AP) | Standard Invoice matched to PO (Dr AP accrual + IPV / Cr liability) | **Pending vendor invoice** from PO (reverses receipt clearing → Cr AP trade) |
| **Vendor credit / AP credit memo** | **FB65**, type **KG** (Dr vendor / Cr expense) | **Vendor Credit / Bill Credit** (Dr AP / Cr expense), applied to bills | **Credit Memo** (supplier-issued) — distinct type | **Vendor credit note** (Credit invoicing) or purchase return order |
| **AP debit memo (buyer-issued)** | (Handled as KG credit memo) | (Vendor Credit) | **Debit Memo** — distinct type, buyer-issued when supplier won't issue a credit | (Credit note / return order) |
| **Customer invoice** | **FB70**, type **DR** (Dr AR / Cr revenue); or SD billing | **Invoice** (Dr AR / Cr income) | **Invoice** class (Dr AR / Cr revenue/tax/freight) | **Free text invoice**, **sales-order invoice**, **project invoice** |
| **Customer credit memo** | **FB75**, type **DG** (Dr revenue / Cr AR) | **Credit Memo** (Dr income / Cr AR) — distinct record | **Credit Memo** class; **On-Account Credit** for untied credit | **Customer credit note** (or sales return order) |
| **AR debit memo / chargeback** | (DR-type debit) | — | **Debit Memo** and **Chargeback** classes (distinct) | (Free text invoice / interest note) |
| **Down payment / prepayment (AP)** | **Special G/L**: request **F-47** (noted item, ind. F), payment **F-48** (ind. A), clear **F-54** | **Vendor Prepayment** (Other Current Asset) + Vendor Prepayment Application | **Prepayment** invoice type: **Temporary** (applicable) vs **Permanent**; negative Prepayment distribution on apply | **Prepayment invoice** (Prepayment asset acct) vs **prepayment journal voucher** (AP holds it) — two distinct methods |
| **Down payment / prepayment (AR)** | Special G/L: request **F-37**, receipt **F-29** (ind. A); Deposit-class commitment | **Customer Deposit** (Other Current Liability), applied to invoice | **Deposit** class / on-account receipt (Cr Unearned Revenue) | Prepayment journal voucher (AR); no AR prepayment *invoice* |
| **Purchase return** | Returns PO / mvt 122 or 161; credit realized via **MIRO credit memo** | **Vendor Return Authorization** (non-posting) → Item Fulfillment + **Bill Credit** | Return-to-Supplier in Receiving (reverses receipt accrual) | **Purchase return order** (Credit note action, Invert sign) |
| **Sales return / RMA** | SD returns order → returns delivery → **credit memo** linked to billing | **Return Authorization** (non-posting) → Item Receipt + **Credit Memo/Refund** | OM **RMA** → **Credit Memo from RMA**, applied to original invoice | **Return order** (sales order type **Returned order**) → credit note |
| **Recurring invoice** | **FBD1** recurring-entry template → **F.14** batch → SM35 | **Memorized/recurring transaction** template (auto-post or remind) | **Recurring Invoice** definition/template | **Free text invoice template** → post recurring free text invoices |
| **Accrual / deferral** | **FBS1** + reversal date → **F.81**; **Accrual Engine** (ACAC) in S/4 | **Journal Entry** (often memorized as recurring) | Subledger accruals; period-end uninvoiced-receipt accrual | **Accrual schemes** (Debit/Credit main accts) via Ledger accruals |
| **Payment** | **KZ** vendor / **DZ** customer | **Bill Payment** / **Customer Payment** (via Undeposited Funds) | AP payment / AR **Receipt** (Unapplied/Applied/On-Account/Unidentified) | Payment journals |

*Note:* debit/credit directions above are the standard/default postings each vendor documents;
sample account names and posting-key numbers are the vendor's illustrative defaults, not fixed values.

---

## Answers to the five research questions

### Q1 — Distinct AP/AR document types, each a separate document with its own number range and posting logic

Confirmed across all four ERPs (see comparison table). Salient specifics:

- **Vendor credit memo is NEVER a negative invoice.** SAP posts a separate **KG** document (Dr
  vendor PK 21 / Cr expense PK 50) with its own number range, the mirror of the KR invoice (Dr
  expense 40 / Cr vendor 31). NetSuite's **Vendor Credit** is a separate record (Dr AP / Cr expense)
  applied to open bills via a Credits-Applied sublist. D365 creates a **vendor credit note** via the
  Credit invoicing function (reason + original-invoice reference), not a keyed negative.
- **Oracle Fusion uniquely distinguishes AP Credit Memo vs AP Debit Memo** by *originator*: a Credit
  Memo is supplier-issued; a **Debit Memo is buyer-issued** — "a negative-amount invoice created by
  *you* and sent to a supplier" — used when the supplier will not send a credit document. Same posting
  effect (Dr liability / Cr expense), different document identity. Fusion AR likewise has separate
  **Credit Memo, Debit Memo, Chargeback, Adjustment, and On-Account Credit** classes.
- **Down payments/prepayments are first-class and asymmetric.** SAP uses **Special G/L indicators** to
  redirect the posting to an *alternative reconciliation account* so advances report separately from
  ordinary AP/AR, with down-payment *requests* posted as statistical **noted items** (F-47/F-37).
  NetSuite deliberately splits **Customer Deposit** (Other Current **Liability**) from **Vendor
  Prepayment** (Other Current **Asset**), both held *off* the AR/AP control accounts until applied.
  D365 contrasts **prepayment invoicing** (a dedicated Prepayment *asset* account holds it; vendor
  balance unaffected) with **prepayment journal vouchers** (AP account holds it; vendor balance
  reflects it) — two distinct methods with distinct posting profiles.
- **Purchase/sales returns are documents, and the credit is a separate document from the physical
  movement.** Universally, the goods movement (return delivery / item fulfillment / receipt) is
  separated from the *financial credit* (credit memo / bill credit). NetSuite's Return Authorizations
  are explicitly **non-posting** tracking records; GL impact lands on the receipt/fulfillment and the
  linked credit memo. SAP realizes the vendor credit through a **MIRO credit memo** linked to the
  returns PO.
- **Recurring invoices are templates, not postings.** SAP FBD1 stores a template that F.14 executes
  into real documents; NetSuite memorizes any transaction to recur; D365 uses free-text-invoice
  templates; amounts generally do not auto-recompute.
- **Accruals are dedicated mechanisms.** SAP's FBS1 (reversal-dated) + F.81, and the S/4 **Accrual
  Engine**; D365's **accrual schemes** with explicit Debit/Credit main accounts and period spreading.

### Q2 — Employee expense / reimbursement: distinct document, distinct payable population

All four treat the employee as a **distinct payable population**, kept separate from trade AP, and the
expense report as a distinct document — even when the employee is technically represented as a vendor.

- **SAP** — Not a distinct FI *document type*; the **employee is set up as a vendor/business partner**
  ("employee vendor," created en masse by **PRAA**), but given its **own vendor account group / number
  range and a *separate reconciliation (control) G/L account*** so employee payables report apart from
  trade payables. Travel Management (FI-TV) posts via **symbolic accounts** mapped to real GL accounts
  in FI: Dr travel-expense accounts by expense type / Cr the employee vendor, paid via F110.
- **NetSuite** — The **Expense Report** is a *distinct transaction type* using the **Employee entity**
  (employees are separate records from vendors). Reimbursable lines post Dr expense / **Cr AP (the
  subsidiary's AP account) with the employee as payee**; non-reimbursable lines net to zero; corporate
  card lines credit the **corporate credit card account** instead of AP.
- **Oracle Fusion** — **Employees are set up as suppliers** in Payables (optionally auto-created on
  import). Expense reports become AP **payment requests** via *Process Expense Reimbursements* →
  *Import Payables Invoices*. Out-of-pocket reimbursements post to a **dedicated Employee Liability
  Account** (a distinct system option), kept separate from trade AP. The **corporate-card issuer is a
  bank supplier**, with **Individual / Company / Both Pay** liability models routing card spend through
  an **expense clearing account**.
- **Dynamics 365** — Expense management's document is the **expense report**; the **worker (HR record)
  is mapped to a vendor account** ("Map worker to vendor"), and the vendor (employee) account "always
  nets to zero" once reimbursed. Cash lines post Dr expense (category default main account) / Cr the
  worker's linked vendor AP. Per-payment-method config decides "who owns the payment method expenses"
  — routing a card charge to a company liability vs the employee's vendor balance.
- **SAP Concur posting (the canonical spend→GL model)** — Payment-type routing is the crux: **out-of-
  pocket** → payable to the **employee vendor** (or a payroll clearing account); **Company-Paid/CBCP**
  card → a **GL clearing account**; **IBCP** card → the **credit-card vendor**. Journal shape: Dr
  expense (by cost center/project/GL) / Cr employee-vendor **or** card liability/clearing **or**
  payroll clearing — deliberately separate from AP trade.

**Consensus:** employee-as-vendor is acceptable *only when paired with a separate control/reconciliation
account* (SAP, Fusion, D365) — i.e., the population is segregated in the GL even if it reuses vendor
plumbing. The document (expense report) is first-class in NetSuite/Fusion/D365.

### Q3 — GR-IR / GRNI clearing: three-way match, which document posts which side, variances

All four implement a GR-IR/accrued-purchases clearing account driven by a three-way match. The
**goods receipt posts the accrual; the invoice receipt clears it**; variances go to dedicated accounts.

- **SAP** — Three-way match reconciles **PO ↔ GR ↔ IR** within tolerance keys (OMR6). **Goods Receipt
  (MIGO, mvt 101):** Dr inventory (OBYC **BSX**) / Cr **GR/IR clearing (WRX)** at PO price. **Invoice
  Receipt (MIRO):** Dr GR/IR (WRX) / Cr vendor — zeroing the GR/IR credit. **Price variance:** standard-
  price materials → **PRD**; moving-average → capitalized to stock if coverage exists, else PRD.
  **Quantity variance** leaves a residual GR/IR balance awaiting a matching GR or invoice. Reconciled
  by **F.13** (automatic clearing, criteria in OB74 = EBELN/EBELP) and **MR11** (manual GR/IR account
  maintenance / write-off).
- **NetSuite** — Full GR-IR equivalent on an **Accrued Purchases / "Inventory Received Not Billed"**
  account (PO is non-posting). **Item Receipt:** Dr Inventory Asset / Cr Accrued Purchases at PO cost.
  **Vendor Bill:** Dr Accrued Purchases / Cr AP at billed price, clearing the accrual. Residuals
  resolved by **Post Vendor Bill Variances** (Bill Quantity Variance, Bill Price Variance/PPV, Bill
  Exchange Rate Variance), with variance accounts configured **per item**. A 3-Way Match approval
  workflow blocks discrepant bills pre-payment.
- **Oracle Fusion** — GRNI lives in **Receipt Accounting** (Cost Management), not Payables. **Receipt
  → Receiving Inspection:** Dr Receiving Inspection / Cr **AP Accrual** (Inventory or Expense accrual by
  destination). **Delivery:** Dr subinventory (std cost) / Cr Receiving Inspection, with PPV in
  standard-cost orgs. **Invoice match:** Dr AP accrual + **IPV** / Cr AP liability. Variances: **IPV**
  (invoice vs PO price), **Quantity Variance**, **ERV** (exchange-rate). Inventory destination *always*
  accrues on receipt; expense destination accrues on receipt or at **period end** (Uninvoiced Receipt
  Accruals). Reconciled via **Manage Accrual Clearing Rules** + the Accrual Clearing / Accrual
  Reconciliation / Uninvoiced Receipt Accrual reports.
- **Dynamics 365** — Two activities: **Product receipt** (packing slip, physical) and **Invoice**
  (financial). With **Accrue liability on product receipt** enabled — **Receipt:** Dr *Purchase
  expenditure, uninvoiced* (clearing) + Dr *Cost of purchased materials received* (asset clearing) / Cr
  **Purchase, accrual** (the GRNI liability, clearing). **Invoice:** reverses those clearing accounts,
  Dr *Cost of purchased materials invoiced* (real inventory) / Cr **AP summary (trade)**. **PPV** via
  two vouchers under standard cost; **Purchase price variance** / **Stock variation** accounts.
  **Matching policy** (two-way = PO only; three-way = adds product receipt) defaults at legal entity,
  overridable at item / item+vendor / PO line, with price tolerances.

**Consensus:** the receipt side posts the accrual (Cr GR-IR), the invoice side clears it (Dr GR-IR);
the account nets to zero when GR=IR; residuals are quantity/price/FX variances booked to dedicated
accounts and reconciled by a periodic clearing process.

### Q4 — Integration pattern for spend/card tools feeding a GL system of record

**The mature pattern: spend tools FEED source documents into the ERP; the ERP owns the authoritative
GL post. Writing the GL in parallel is the named anti-pattern.**

- **Ramp** "syncs coded transactions directly to your ERP" and "sends coded details" the ERP then
  posts — it does not maintain a parallel ledger; the customer's chart of accounts/vendors/GL stay the
  source of truth in the ERP.
- **Brex** "doesn't write directly to NetSuite's GL. Instead, it feeds NetSuite objects" via an export
  workflow (deliberately no bank feed).
- **SAP Concur's Financial Integration Service (FIS)** does *not* write the ERP GL directly. It runs an
  explicit handshake: (1) ERP **retrieves** approved documents; (2) ERP **acknowledges** each document
  ID (or Concur recalls it); (3) ERP **posts to its GL** and **sends success/failure status back**; (4)
  optional payment confirmation. On failure the ERP integration **backs out** the partial transactions;
  Concur **locks** the document only after the ERP confirms the post. This yields "1-to-1 Concur↔ERP
  reconciliation" and structurally enforces single-writer discipline.

**What object gets created — by spend class (card-liability posting vs expense categorization are two
legs of one entry):**

| Spend class | Object created in the ERP |
|---|---|
| Card charge | **Credit card transaction** (also journal entry or vendor bill in some setups) |
| Reimbursement | **Bill + bill payment** (Ramp) / **journal entry or vendor bill** (Brex) |
| Statement payment to card program | **Check or journal entry** |
| Concur expense report | Posted as **journal entries**; invoices feed AP/payables |

**The card clearing / card-liability pattern (accepted controllership):** the card program (issuer) is
a payable. Each **charge** posts Dr expense / **Cr credit-card liability (clearing)** *when the expense
occurs*. The **statement payment** later Dr card liability / Cr cash, clearing it. NetSuite (Oracle)
states it "effectively treats the credit card as a clearing account, with expenses flowing through it
until the statement is reconciled and paid." Standard practice defines one accrued-liability account
per card in the card's currency; reconciliation matches exported charge JEs against the payment JE to
clear the balance.

**Why single-writer:** "when systems mirror the ERP rather than maintaining a second accounting
database, there's no parallel balance to drift — the ERP remains the source of truth." Two parallel
posters cause data drift and failed month-end reconciliation. Idempotency keys on invoice/payment/
journal events prevent duplicate postings on retry.

### Q5 — What makes a system the ledger "system of record" vs an operational feeder

The minimum authoritative-ledger surface, consistent across references:

1. **Double-entry enforcement** — debits must equal credits on every posting.
2. **Chart of accounts owned by the GL** — the GL owns the account structure; feeders map into it.
3. **Subledger → GL via control (reconciliation) accounts** — the *defining* mechanism. Subledgers
   (AP/AR) hold detail; a GL **control account** holds the summary; **you may only post the control
   account through its subledger.** In SAP "you cannot directly post to the AP GL… you only post to the
   vendor account which rolls up to the AP GL." The invariant: Σ(subsidiary-ledger balances) = control
   account; protected by posting restrictions (control accounts move only via subledger transactions).
4. **Document numbering / audit numbering** — each posting cross-referenced by a unique number; auditors
   expect "who posted what, when, and why." (NetSuite's **GL Audit Numbering** gives gapless sequential
   numbers; SAP number ranges per document type.)
5. **Immutability + reversal** — posted documents are not edited or deleted; corrections post a
   *reversing* entry. "Immutability is non-negotiable for regulated financial ledgers."
6. **Audit trail (SOX)** — a permanent, non-retroactively-alterable chain of custody from entry →
   approval → sign-off.
7. **Accounting periods with open/close/lock controls** — NetSuite locks periods per transaction type
   or fully; once closed, no GL-impacting change is allowed without an **Override Period Restrictions**
   permission. Subledger-to-GL reconciliation is itself a standard close procedure.

**Implication for Carbon:** to be the system of record, control accounts (AP, AR, GR-IR) must be
posted *only* through their subledger documents; every GL-affecting event needs a first-class document
with numbering, immutability/reversal, and period control — and external feeders must not post the GL
in parallel.

---

## Competitor-specific details worth carrying into design

- **SAP special G/L indicators** cleanly separate advances via an *alternative reconciliation account*
  and support statistical **noted items** for requests — a pattern for down-payment requests that
  never touch the real GL until fulfilled.
- **Oracle Fusion's AP Credit-Memo-vs-Debit-Memo-by-originator** distinction is the most precise model
  of the buyer-issued vs supplier-issued credit; and its **document sequence categories** (Automatic /
  Manual / **Gapless**) are the numbering contract.
- **NetSuite's non-posting tracking records** (PO, Return Authorization, Vendor Return Authorization)
  cleanly defer GL impact to the fulfillment/receipt and the settlement document — separating logistics
  from finance.
- **D365's posting-profile + posting-type + clearing-account** model (Arrival/Offset for the invoice-
  register accrual; Purchase-accrual for GRNI; Prepayment asset account) is the most explicit mapping
  of "which document reverses which clearing account."
- **Concur's FIS handshake** (retrieve → acknowledge → post → status → lock, with back-out on failure)
  is the reference contract for a feeder that must not become a parallel GL writer.

---

## Gap analysis — Carbon today vs the enterprise pattern

Status legend: **first-class** (own table + own posting) · **overloaded** (borrows another
document's table/type) · **journal-only** (posts GL but no standalone document/entity) · **missing**.
Carbon posts the GL via Deno edge functions (`post-*`) writing `journal`/`journalLine`; external-GL
sync is gated by `POSTING_POLICY` in `packages/ee/src/accounting/core/models.ts`, where
`backingEntityType` names the provider document that carries a journal's amounts, and **`null` means
"no external-GL representation" — the journal parks as a `DOC_SYNC_DISABLED` Warning and never reaches
Xero/QBO/Rillet.**

| Economic event | Carbon status | Table / sourceType | Provider-sync representation | Enterprise pattern (gap) |
|---|---|---|---|---|
| Purchase invoice | **first-class** | `purchaseInvoice` → `"Purchase Invoice"` | `bill` (default off) | Matches (vendor invoice) |
| Sales invoice | **first-class** | `salesInvoice` → `"Sales Invoice"` | `invoice` (default off) | Matches (customer invoice) |
| Customer/supplier payment | **first-class** (unified) | `payment` + `invoiceSettlement` → `"Payment"` | `payment` (two-way, accounting-owned) | Matches; two-way sync is ahead |
| Card charge (Ramp) | **first-class** | `charge`+`chargeLine` → `"Charge"` | native `charge` object per-row (else journal) | Matches the card-clearing pattern |
| **Employee reimbursement** | **overloaded** onto `purchaseInvoice` | `purchaseInvoice` + `supplierType="Employee"` → `"Purchase Invoice"` | Rillet → native `/reimbursements`; QBO/Xero → plain bill | All four use a **distinct expense-report document** and a **separate employee control/liability account**; Carbon has neither (employee-vendor merged into trade AP; `employee` sync entity declared but unimplemented) |
| **Supplier credit / AP debit memo** | **first-class table, NO external-GL sync** | `memo` (`direction=Debit`) → `"Debit Memo"` | **none** (`backingEntityType: null`) | Distinct document everywhere (SAP KG, NetSuite Vendor Credit, Fusion Credit/Debit Memo, D365 credit note); Carbon posts internally but **never reaches the external GL** |
| **Customer credit memo** | **first-class table, NO external-GL sync** | `memo` (`direction=Credit`) → `"Credit Memo"` | **none** (`backingEntityType: null`) | Distinct document everywhere (SAP DG, NetSuite Credit Memo, Fusion Credit Memo class); same external-GL gap |
| **Purchase return** | **first-class doc, journal-only GL** | `purchaseReturnOrder` (creditLine→`memo`) → `"Purchase Return Shipment"` (opt-in) + `memo` | journal opt-in (off); doc `backingEntityType: null` | Return doc + separate credit is the norm; Carbon has the doc but the credit's external-GL representation is null |
| **Sales return** | **first-class doc, journal-only GL** | `salesReturnOrder` (creditLine→`memo`) → `"Sales Return Receipt/Shipment"` + `memo` | journal opt-in; doc `backingEntityType: null` | Same as purchase return |
| **GR-IR / GRNI / accrued purchases** | **present, journal-only** (clearing account) | `accountDefault.goodsReceivedNotInvoicedAccount`; receipt credits / invoice debits | none (control-account lines never pushed) | Matches the *accounting* (three-way clearing) but there is **no standalone accrual document/entity**; enterprise ERPs treat it as a first-class clearing account too, so this is largely aligned |
| **Down payment / prepayment (AP & AR)** | **missing** | none (`accountDefault.prepaymentAccount`/`supplierPrepaymentAccount` slots only) | none | All four have first-class prepayment/deposit documents (SAP special G/L, NetSuite Customer Deposit/Vendor Prepayment, Fusion Prepayment type, D365 prepayment invoice/journal); Carbon has only chart-of-accounts slots |
| **Recurring invoice** | (not surveyed in Carbon inventory) | — | — | Template mechanism everywhere; verify whether Carbon has one |
| **Accrual / deferral** | journal-only (general) | `journal`/`journalLine` | journal | Enterprise ERPs have dedicated accrual engines/schemes; Carbon relies on manual journals |

### The three biggest gaps (for downstream design, not proposed here)

1. **Credit/debit memos and returns have `backingEntityType: null`** — they post to Carbon's *internal*
   GL but have **no accounting-provider document representation**, so their amounts silently never reach
   the external ledger (Xero/QBO/Rillet). Every surveyed ERP treats these as first-class documents that
   post to the authoritative GL.
2. **Employee reimbursements are overloaded onto `purchaseInvoice` + a `supplierType="Employee"`** with
   no first-class document and no separate employee control/liability account. The enterprise consensus
   is a distinct expense-report document and a segregated employee payable population (separate
   reconciliation account even when employee-as-vendor). Carbon's `employee` sync entity type is
   declared but unimplemented.
3. **Down payments / prepayments are entirely unmodeled** (only chart-of-accounts slots survive). All
   four ERPs make these first-class, asymmetric documents (customer deposit = liability; vendor
   prepayment = asset), held off the AP/AR control accounts until applied.

*(GR-IR is the one adjacent posting where Carbon already matches the enterprise pattern — a three-way
receipt→GR/IR→invoice clearing cycle on a dedicated clearing account, journal-only by design, as it is
in the reference ERPs.)*

---

## Sources

### SAP (FI/CO + MM)
- SAP standard document types & number ranges — https://sap-ficolearning.blogspot.com/2017/12/document-types-and-number-ranges-for-vendors.html
- SAP Help — Document Types (SAP ERP) — https://help.sap.com/docs/SAP_ERP/6a49d1604ffc4b908f9f78fba3824187/7b47d153da7e4308e10000000a174cb4.html
- FB65 same-as-FB60, credit-memo direction — https://community.sap.com/t5/enterprise-resource-planning-q-a/fb65/qaq-p/11372323
- FB60 & FB65 posting guide — https://erp-docs.com/911/sap-fb60-fb65-guide-posting-vendor-invoice-credit-memo/
- FB60 default KR / T003D / number ranges — https://community.sap.com/t5/enterprise-resource-planning-q-a/posting-invoice-in-fb60/qaq-p/2509991
- FB60 guide — https://sapficoblog.com/fb60-in-sap-create-a-vendor-invoice/
- KR vs RE (MIRO default) — https://community.sap.com/t5/enterprise-resource-planning-q-a/document-types/qaq-p/12402696
- 3-way match, AP credited / GR/IR zeroed — https://blog.erpsuites.com/blog/sap/ap/invoices-3-way-match-sap-mm-liv
- FB65 vendor credit memo — https://community.sap.com/t5/enterprise-resource-planning-q-a/fb65-vendor-credit-memo/qaq-p/3199892
- Vendor Credit Memo in S/4HANA — https://www.gauravconsulting.com/post/vendor-credit-memo
- FB65 issue vendor credit memo — https://sapsharks.com/fb65-issue-a-vendor-credit-memo-in-sap/
- FB70 customer invoice — https://sapficoblog.com/fb70-tcode-in-sap-create-a-customer-invoice/
- FB75 customer credit memo / sales returns — https://sap96.com/2024/09/10/how-to-post-customer-credit-memo-or-sales-returns-fb75/
- FB70 & FB75 guide — https://erp-docs.com/902/sap-fb70-fb75-guides-posting-customer-invoice-and-credit-memo/
- F-47 special G/L indicator F / FBKP — https://community.sap.com/t5/enterprise-resource-planning-q-a/f-47-special-gl-indicator/qaq-p/3546783
- SAP KBA 3340344 special G/L transactions — https://userapps.support.sap.com/sap/support/knowledge/en/3340344
- F-48 vendor down payment — https://community.sap.com/t5/enterprise-resource-planning-q-a/f-48-post-vendor-down-payment-setting/qaq-p/9786986
- Customer down payment F-37/F-29 / special G/L — https://community.sap.com/t5/enterprise-resource-planning-q-a/special-gl-indicator/qaq-p/3878601
- Returns 122 vs 161 — https://community.sap.com/t5/enterprise-resource-planning-q-a/122-vs-161-movement-type/qaq-p/7181345
- Return PO mvt 161 — https://community.sap.com/t5/enterprise-resource-planning-q-a/return-po-movement-type/qaq-p/7725472
- MIRO credit memo for returns — https://community.sap.com/t5/enterprise-resource-planning-q-a/mvt-type-161-122/qaq-p/7150962
- Sales return & credit memo — https://www.appseconnect.com/how-to-process-a-sales-return-credit-memo-in-sap-erp/
- FBD1 recurring entries — https://sap96.com/2024/10/04/how-to-post-recurring-entries-in-sap-fbd1/
- Recurring entry procedure FBD1 — https://www.technosap.com/sap-overview/recurring-entry-procedure-sap-fbd1/
- FBS1 accrual with reversal / F.81 — https://community.sap.com/t5/enterprise-resource-planning-q-a/accrual-deferral-fbs1/qaq-p/6617916
- Accrual/deferral tutorial — https://erproof.com/fi/free-training/sap-accrual-deferral-posting/
- Accrual Engine (ACAC) — https://community.sap.com/t5/financial-management-blog-posts-by-sap/exploring-accrual-engine-by-examples-part-1-manual-accrual/ba-p/13859800
- SAP Help — Accrual/Deferral (Accrual Engine) — https://help.sap.com/docs/SAP_ERP/daf0f4e552e248d0bf0db2bb5f322192/06b6d153e8b34208e10000000a174cb4.html
- PO Accruals and Deferrals — https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/accruals-management-purchase-order-accruals-and-deferrals/ba-p/13615824
- Employee Vendor / BP in S/4HANA — https://www.abusinesstech.com/post/employee-vendor-maintenance-business-partner-in-sap-s-4hana
- Employee as vendor — https://community.sap.com/t5/enterprise-resource-planning-q-a/employee-as-vendor/qaq-p/8643328
- Separate reconciliation acct / number range for employee reimbursement — https://community.sap.com/t5/enterprise-resource-planning-q-a/how-to-manage-travel-expenses-for-employees/qaq-p/12588763
- Reconciliation account purpose — https://community.sap.com/t5/enterprise-resource-planning-q-a/reconciliation-account-in-vendor-master/qaq-p/3429005
- FI-TV posting run RPRFIN00_40 / RPRPOSTD / PRRW — https://community.sap.com/t5/enterprise-resource-planning-q-a/travel-management-fi-tv-posting-run-customizing/qaq-p/4033584
- Travel Management symbolic accounts / PRAA — https://community.sap.com/t5/enterprise-resource-planning-q-a/how-to-post-from-travel-management-to-fi-directly/qaq-p/5237844
- Travel Management implementation — https://sapinsider.org/8-steps-to-take-and-9-tips-to-consider-before-you-implement-the-travel-management-module-for-trip-expenses/
- Concur Financial Posting Configuration — https://help.sap.com/docs/sap-concur/sap-integration-with-concur-solutions-for-sap-s-4hana-cloud-setup-guide/financial-posting-configuration
- Concur FIS explained — https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/sap-concur-s-financial-integration-service-explained/ba-p/13556515
- Concur Employee Reimbursements — https://help.sap.com/docs/CONCUR_EXPENSE/93e1d3bf561148a49e22d93315c4211d/c48839dd51c310159c29974e4049de21.html
- Concur journal (Dr expense / Cr pcard liability) — https://community.concur.com/t5/Concur-Expense-Forum/JOURNAL-ENTRIES-FOR-CONCUR-LIABIITY-BANK/m-p/24420
- Concur → S/4 payroll clearing account — https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/expense-report-posting-to-s-4-from-concur-and-error-handling/ba-p/13522252
- MIRO tolerances (OMR6) — https://www.yuvaplannextech.com/blog/sap-mm-invoice-verification-miro-tolerance
- OBYC transaction keys BSX/WRX/PRD/GBB — https://community.sap.com/t5/supply-chain-management-blog-posts-by-members/understanding-obyc-how-sap-determines-g-l-accounts-automatically/ba-p/14489633
- OBYC account determination walkthrough — https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/a-step-by-step-guide-to-automatic-account-determination-in-sap-mm-fi/ba-p/14146163
- Standard price → PRD — https://community.sap.com/t5/enterprise-resource-planning-q-a/miro-hitting-inventory-and-price-difference/qaq-p/8123463
- MAP: difference to stock else PRD — https://community.sap.com/t5/enterprise-resource-planning-q-a/at-the-time-of-miro-price-difference-is-going-to-price-difference-account/qaq-p/680336
- Quantity variance leaves GR/IR balance — https://community.sap.com/t5/enterprise-resource-planning-q-a/gr-ir-automatic-clearing/qaq-p/3390437
- GR/IR reconciliation should reach zero — https://www.stampli.com/resources/grir-reconciliation/
- Goods receipt checks & invoice matching — https://www.doxis.com/en/blog/goods-receipt-checks
- SAP KBA 2050268 MR11/F.13 — https://userapps.support.sap.com/sap/support/knowledge/en/2050268
- F.13 clearing criteria OB74 — https://community.sap.com/t5/enterprise-resource-planning-q-a/automatic-clearing-f-13/qaq-p/7247418
- MR11 GR/IR account maintenance — https://www.erplingo.com/sap-transaction-code/en/MR11
- MR11 manual GR/IR adjustment — https://community.sap.com/t5/enterprise-resource-planning-q-a/mr11-gr-ir-clearing-account-maintenance/qaq-p/1719596

### NetSuite (Oracle)
- Vendor Bill / Vendor Credit / Bill Payment GL impact — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1461991.html
- Applying vendor credits — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2392083.html
- Vendor credit application on bill payment — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2393276.html
- Invoice / Credit Memo / Customer Payment GL impact — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1460914.html
- Sales transaction GL impact (Kolleno) — https://www.kolleno.com/sales-transaction-gl-impact-in-netsuite/
- Credit memo from Return Authorization — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1311510.html
- Standalone credit memo & inventory — https://community.oracle.com/netsuite/english/discussion/4474570/
- Customer Deposit — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1296349.html
- Vendor Prepayment — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156378588624.html
- Vendor Prepayment application — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0821015349.html
- Return Authorization flow — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158893025068.html
- Vendor Return Authorization — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2386202.html
- VRA processing — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2388089.html
- VRA GL (community) — https://archive.netsuiteprofessionals.com/t/23418216/
- Memorized transactions — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N564245.html
- Recurring memorized setup — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N564637.html
- Journal entries — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1469880.html
- Intercompany transactions/eliminations — https://timdietrich.me/blog/netsuite-intercompany-transactions-eliminations/
- Expense Report — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N912353.html
- Corporate card expenses (clearing account) — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1531259544.html
- Expense report paid via third-party payroll — https://netsuiteprofessionals.com/blog/question/how-to-mark-expense-reports-paid-after-being-reimbursed-through-third-party-payroll/
- NetSuite expense management guide — https://netsuite.folio3.com/blog/a-comprehensive-guide-for-netsuite-expense-management/
- Accrued Purchases / three-way — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2408991.html
- Post Vendor Bill Variances — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2371184.html
- 3-Way Match approval workflow — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4096219721.html
- IRNB / Accrued Purchases analysis — https://meir.prolecto.com/2023/04/16/netsuite-inventory-received-not-billed-accrued-purchases-analysis/
- Accounting periods — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N1445226.html
- Period Close Checklist — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html
- Locking periods — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1451780.html
- Closing periods — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1452509.html
- GL Audit Numbering — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4805169254.html
- GL Impact Locking — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3735573963.html

### Oracle Fusion Cloud ERP
- Document sequencing in Payables — https://docs.oracle.com/en/cloud/saas/financials/25c/faipp/document-sequencing-in-payables.html
- Ledger/Legal-Entity document sequencing in Receivables — https://docs.oracle.com/en/cloud/saas/financials/25d/fairp/ledger-and-legal-entity-document-sequencing-in-receivables.html
- Document sequencing (MOS) — https://support.oracle.com/knowledge/Oracle%20Cloud/1678427_1.html
- AR transaction-type classes / reference accounts (EBS) — https://docs.oracle.com/cd/A60725_05/html/comnls/us/ar/pttrxt02.htm
- Fusion invoice types — https://docs.oracle.com/en/cloud/saas/financials/25a/fappp/invoice-types.html
- Invoice types (Cloudare) — https://blogs.cloudare.in/2025/07/understanding-invoices-and-their-types-in-oracle-fusion/
- AP invoice accounting (EBS) — https://docs.oracle.com/cd/E18727_01/doc.121/e12797/T295436T367735.htm
- Prepayments (EBS) — https://docs.oracle.com/cd/A60725_05/html/comnls/us/ap/prepmts.htm
- Prepayments (Fusion 25d) — https://docs.oracle.com/en/cloud/saas/financials/25d/fappp/prepayments.html
- Prepayments (Fusion 24c) — https://docs.oracle.com/en/cloud/saas/financials/24c/fappp/prepayments.html
- Payables invoice-to-pay (recurring) — https://docs.oracle.com/en/cloud/saas/financials/25d/fappp/using-payables-invoice-to-pay.pdf
- Withholding entry (EBS learning) — https://oracleebslearning.blogspot.com/2012/09/what-are-different-accounts-used-and.html
- AR journal-entry reference (EBS) — https://docs.oracle.com/cd/A60725_05/html/comnls/us/ar/cshbas02.htm
- AR accounting entries (club) — http://oraclefinancialsclub.blogspot.com/2013/09/accounting-entries-for-transactions-in.html
- Transaction-type reference accounts (Fusion) — https://docs.oracle.com/en/cloud/saas/financials/23b/fairp/guidelines-for-transaction-type-reference-accounts.html
- RMA credit memo (EBS) — https://docs.oracle.com/cd/A60725_05/html/comnls/us/oe/esayrmas.htm
- RMA (Fusion SCM) — https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/famlo/return-material-authorization.html
- Credit memo from RMA (MOS) — https://support.oracle.com/knowledge/Oracle%20Cloud/2449505_1.html
- Employee-as-supplier / expense-report import (EBS) — https://docs.oracle.com/cd/A60725_05/html/comnls/us/ap/payops04.htm
- Expense report payment requests (Fusion) — https://docs.oracle.com/en/cloud/saas/financials/25a/fawde/how-expense-report-payment-requests-are-processed.html
- Payables operations (EBS) — https://docs.oracle.com/cd/A60725_05/html/comnls/us/ap/apops.htm
- Employee Liability Account (community) — https://community.oracle.com/customerconnect/discussion/582377/fusion-expenses-employee-liability-account
- Payables reports (employee liability) — https://docs.oracle.com/en/cloud/saas/financials/21d/ocuar/oracle-fusion-payables-reports.html
- P-card reconciliation / card issuer as supplier — https://community.oracle.com/customerconnect/discussion/648879/oracle-fusion-expenses-p-card-transactions-reconciliation-process-with-payment-request
- Corporate card program (Fusion) — https://docs.oracle.com/en/cloud/saas/financials/25d/faiex/what-s-a-corporate-card-program.html
- Integrate Fusion Expenses corporate cards — https://www.jadeglobal.com/blog/guide-integrate-fusion-expense-corporate-credit-cards
- Receipt Accounting (Fusion SCM) — https://docs.oracle.com/en/cloud/saas/supply-chain-management/20b/fapma/receipt-accounting.html
- Receipt accrual reconciliation & clearing — https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/fapma/receipt-accrual-reconciliation-and-clearing.html
- Uninvoiced receipt accrual (MOS) — https://support.oracle.com/knowledge/Oracle%20Fusion%20Applications/1938291_1.html
- Receiving accounting entries (EBS) — https://docs.oracle.com/cd/A60725_05/html/comnls/us/po/rcvacc02.htm
- IPV/ERV/quantity variance (EBS) — https://docs.oracle.com/cd/A60725_05/html/comnls/us/ap/point07.htm
- Variance absorption (Fusion) — https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/fapma/variance-absorption.html
- Exclude invoice cost variances (Fusion) — https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/24d/faims/exclude-invoice-cost-variances-from-cost-management.html
- Receipt accounting tasks/events (Fusion) — https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25d/fapma/receipt-accounting-tasks-and-accounting-events.html
- Accrual reconciliation report (MOS) — https://support.oracle.com/knowledge/Oracle%20Fusion%20Applications/1451537_1.html
- Uninvoiced receipt accrual report (MOS) — https://support.oracle.com/knowledge/Oracle%20Fusion%20Applications/1607606_1.html
- GRNI clearing approval (community) — https://community.oracle.com/customerconnect/discussion/849338/does-fusion-allow-approval-for-grni-clearing-from-receipt-accounting

### Microsoft Dynamics 365 F&O
- Posting profiles overview — https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/pstg-prfles-ovrvw
- Accounts payable postings — https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/accts-payble-posting
- Vendor posting profiles — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/vendor-posting-profiles
- Vendor invoices overview — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/vendor-invoices-overview
- Key invoice data into the invoice pool — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/tasks/key-invoice-data-into-ap-system-invoice-pool
- Purchase order posting (PO GL, GRNI, variances) — https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/purchase-order-posting
- AP accounting distributions / subledger journal — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/accounting-distributions-subledger-journal-entries-vendor-invoices
- Purchase return order task — https://learn.microsoft.com/en-us/dynamics365/supply-chain/procurement/tasks/create-purchase-return-order
- Reference original invoices in credit notes — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/gbl-original-invoice-numbers-credit-notes-ap
- Customer posting profiles — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/customer-posting-profiles
- Free text invoice accounting distributions — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/accounting-distributions-subledger-journal-entries-free-text-invoices
- Prepayment invoices vs prepayments — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/prepayments-invoices-vs-prepayments
- Sales returns / RMA — https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/sales-returns
- Create free text invoice template — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/create-free-text-invoice-template-new
- Assign template to customer — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/tasks/assign-free-text-invoice-template-customer
- Post recurring free text invoices — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/tasks/post-recurring-free-text-invoices
- Accruals overview (accrual schemes) — https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/accruals-overview
- Expense management overview — https://learn.microsoft.com/en-us/dynamics365/project-operations/prod-exp/expense-management
- Plan expense management (worker→vendor, payment methods, accounts) — https://learn.microsoft.com/en-us/dynamics365/project-operations/prod-exp/plan-expense-management
- Posting expense reports — https://learn.microsoft.com/en-us/dynamics365/project-operations/expense/posting-expense-reports
- Set up credit card integration — https://learn.microsoft.com/en-us/dynamics365/project-operations/expense/set-up-credit-card-integration
- Personal expenses on corporate card — https://learn.microsoft.com/en-us/dynamics365/project-operations/expense/personal-expenses-expense-report
- Cash advance — https://learn.microsoft.com/en-us/dynamics365/project-operations/expense/cash-advance
- Three-way matching policies — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/three-way-matching-policies
- AP invoice matching — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/accounts-payable-invoice-matching
- Set up invoice matching validation — https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/tasks/set-up-accounts-payable-invoice-matching-validation

### Spend-management integration & system-of-record
- Ramp accounting overview (card liability / statement clearing) — https://support.ramp.com/overview-of-ramp-accounting
- Brex NetSuite overview (feeds objects, not GL) — https://www.brex.com/support/netsuite-overview
- Brex integration exporting — https://www.brex.com/support/integration-exporting
- Concur Posting via Financial Integration Service — https://developer.concur.com/api-guides/ERP-integration/posting-via-financial-integration-service.html
- Concur FIS explained (SAP community) — https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/sap-concur-s-financial-integration-service-explained/ba-p/13556515
- NetSuite corporate card as clearing account (Oracle) — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1531259544.html
- Corporate CC accrued liability account (MYOB) — https://help.myob.com.au/myobadvancedhelpdraft/Docs/Published/UserGuide/Finance_Expenses_with_CorporateCC_GeneralInfo_2.html
- Journal entries for credit card payments — https://accountingtitan.com/financial-reporting/journal-entries-for-credit-card-payments/
- Finance ERP integration best practices (single source of truth, idempotency) — https://sysgenpro.com/integration/finance-erp-integration-best-practices-for-reconciling-crm-billing-and-general-ledger-data
- The reconciliation nightmare (parallel-systems drift) — https://www.bectran.com/post/the-reconciliation-nightmare
- Double-entry bookkeeping — https://en.wikipedia.org/wiki/Double-entry_bookkeeping
- Debits and credits — https://en.wikipedia.org/wiki/Debits_and_credits
- What is a general ledger (COA) — https://www.dualentry.com/blog/what-is-a-general-ledger
- AP/AR subledger→GL reconciliation controls (SAP community) — https://community.sap.com/t5/enterprise-resource-planning-q-a/ap-ar-subledger-to-gl-reconciliation-controls-questions/qaq-p/6828111
- Reconciliation G/L account for A/P — https://www.linkedin.com/posts/behram-qureshi-b1470011b_sap-sapfi-sapfico-activity-7386576695052374016-kROO
- Reconciliation accounts in S/4HANA — https://blog.sap-press.com/reconciliation-accounts-in-sap-s4hana
- AP subledger to GL reconciliation (posting restrictions) — https://www.stampli.com/resources/ap-subledger-gl-reconciliation/
- Journal entry glossary (numbering) — https://www.blackline.com/resources/glossaries/journal-entry/
- General ledger posting (audit trail) — https://www.numeric.io/blog/general-ledger-posting
- Immutable ledger design — https://martinuke0.github.io/posts/2026-05-27-architecting-immutable-ledger-design-for-financial-systems-consistency-auditability-and-real-world-patterns/
- Immutable audit log basics — https://www.hubifi.com/blog/immutable-audit-log-basics
- SOX audit-trail immutability — https://chainscorelabs.com/use-cases/compliance-operations/audit-trail-immutability/automated-sox-narrative-generation
- IRS IRM 3.17.64 General Ledger policies — https://www.irs.gov/irm/part3/irm_03-017-064r

### Carbon current-state (internal — repo `carbon/dublin`, branch `rillet-ramp-accounting-provider`)
- `packages/ee/src/accounting/core/models.ts` — `POSTING_POLICY` (lines 316–482), `AccountingEntityType`
- `packages/ee/src/accounting/core/posting.ts` — `getJournalPostingPolicyDecision`, `isDocBackedCharge`
- `packages/database/supabase/migrations/20260630093809_ar-ap-payments.sql` — `payment`, `memo`, `invoiceSettlement`
- `packages/database/supabase/migrations/20260908142501_returns-module.sql` — returns
- `packages/database/supabase/migrations/20260315000000_reset-chart-of-accounts.sql` — posting-groups removal, GR-IR consolidation
- `packages/database/supabase/migrations/20260919152233_ramp-integration.sql` — `charge`
- `packages/database/supabase/functions/post-{purchase-invoice,sales-invoice,payment,memo,charge,receipt}/`
- `packages/ee/src/ramp/lib/suppliers.ts` — `resolveEmployeeSupplier` (line 235)
- `.claude/rules/accounting-sync-handlers.md`, `.claude/rules/ramp-integration.md`, `.claude/rules/customer-supplier-database-schema.md`
