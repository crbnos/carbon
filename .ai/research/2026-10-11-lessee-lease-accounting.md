# Lessee Lease Accounting (ASC 842) in Purchasing, AP and the GL — Research: Best Practices Survey

> Date: 2026-10-11
> Branch: `lessee-leases-purchasing`
> Prepared for: the lessee slice of crbnos/carbon#1056. The lessor slice shipped as rental agreements (`.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part I). This file replaces the research basis of the older lessee design `.ai/specs/2026-07-04-lease-accounting.md`.
> Method: three parallel web surveys and a read-only sweep of the Carbon code. The surveys covered NetSuite, SAP and Dynamics 365; Sage Intacct, Odoo and Acumatica; and the specialist tools with the standards. Claims that a survey could not confirm on a primary page carry the mark **unverified**.

## Summary

This file surveys **lessee** lease accounting under ASC 842 in 9 products, from SAP and Dynamics 365 to LeaseQuery. In the integrated products, a lease subledger holds the payment and effective-interest schedules, and a periodic **lease run** posts the cost. AP pays the lessor with an invoice that **debits the lease liability**; Dynamics 365 and Sage Intacct generate that invoice from the payment schedule. External subledgers cannot create AP invoices, so they use a **lease clearing account** that the monthly journal clears. Among the ERPs, only Dynamics 365 and Infor automate the five classification tests.

For Carbon, the recommended v1 is an ASC 842 lease document in purchasing. It builds on the lessor PV code, the period runs and the rental invoice proposal. The ROU asset stays in the lease subledger and becomes a fixed asset only at a purchase.

## Competitors Surveyed

- **SAP S/4HANA (RE-FX Contract and Lease Management)** — the enterprise reference. It splits vendor postings and valuation postings into two runs, and it puts the ROU asset in FI-AA.
- **Microsoft Dynamics 365 Finance (Asset leasing)** — the most complete native module found. It has automatic classification, AP invoices from the schedule, a batch journal run and full disclosure reports.
- **Oracle NetSuite (FAM Lease Accounting)** — the mid-market system companies IPO on. It is a thin feature inside the Fixed Assets SuiteApp, with a manual classification checkbox.
- **Sage Intacct Lease Accounting** — a native, lessee-only module. It has a strong AP integration and the best-documented disclosure report.
- **Odoo, Acumatica, Business Central** — no native lessee accounting. Partner apps fill the gap.
- **LeaseQuery (FinQuery), Visual Lease (CoStar), LeaseAccelerator (insightsoftware)** — specialist subledgers that push journals to an ERP. They define the clearing-account pattern and the IBR rate table.
- **Standards (ASC 842 through Deloitte DART, PwC Viewpoint, KPMG; IFRS 16)** — the entries the design must produce.

## Key Consensus Patterns

### 1. The lease is its own subledger document with a payment schedule
- **SAP**: a real estate contract (RECN) with "conditions" for the payments and a valuation rule per accounting principle. Rent adjustment covers CPI index changes.
- **Dynamics 365**: a lease with payment schedule lines (start date, periods, frequency, amount, variable payment). The system derives the term from the lines. "Create schedules" builds the payment, liability, depreciation and expense schedules, and "Confirm schedule" locks the lease.
- **NetSuite**: a lease record with a rental frequency, an annual interest rate and payment lines. "Generate Payments" makes up to 120 equal lines. NetSuite has no escalation feature, so step rents need manual lines or CSV.
- **Sage Intacct**: a lease with a lease class, start and end dates, payment frequency and discount rate. The user generates or imports the payment schedule.
- **Visual Lease**: "financial entries", each with a frequency and a list of planned increases, plus critical dates for options and escalations.
- **Rationale**: a lease is a contract with dated cash flows, not a purchase order. Every product stores the cash flows as rows, because escalations, step rents and modifications all change rows, not a header amount.

### 2. Classification: automatic tests in two products, a user choice in the rest
- **Dynamics 365**: lease type "Automatic" runs the five tests against thresholds on the lease book. Examples are term ≥ x% of useful life and PV ≥ y% of fair value. The user can override the result if the book allows it.
- **Infor**: an automated classification test (product name **unverified**).
- **SAP**: the user picks the valuation rule (finance or operating). An optional questionnaire helps decide whether a valuation is needed. It is not a classification test.
- **NetSuite**: a "Finance Lease" checkbox. **Sage Intacct**: the user picks a lease class (Finance or Operating).
- **Rationale**: the five tests need the fair value and economic life of the asset. Lessees often do not know these numbers, so most products let the user choose. PwC calls 75% and 90% "one reasonable approach".

### 3. A periodic batch run posts the schedule, never the invoice
- **SAP**: RERAPP posts the payments (vendor open items), RECEEP posts the valuation, and the FI-AA run posts depreciation.
- **Dynamics 365**: "Batch journal creation" per schedule type (payments, liability, depreciation, executory costs). The run creates journals, and the user posts them.
- **NetSuite**: "Record Lease Interest" by date and subsidiary. FAM depreciation runs the ROU amortization.
- **Sage Intacct**: a scheduled run per day of month or last day, one entry per lease class or per lease.
- **Specialist tools**: one monthly summary journal entry per lease or per portfolio.
- **Rationale**: the interest and the operating plug depend on the schedule, not on when the lessor bills. A run also gives the close a single "is it posted?" check.

### 4. AP pays the lessor; the payment debits the lease liability or a clearing account
- **Dynamics 365**: with "Pay to vendor" = Yes, a payment schedule line creates a **vendor invoice journal**. It debits the lease liability, debits a variable-payment account for any variable part, and credits the vendor. The user cannot edit its amounts or accounts.
- **Sage Intacct**: the schedule creates one transaction per payment: AP bill, manual payment, credit card, GL journal or purchasing transaction, Draft or Posted. The entry is Dr Lease liability / Cr AP.
- **SAP**: consultants describe a zero-balance clearing account between the RERAPP vendor posting and the RECEEP valuation posting (**unverified** on SAP Help).
- **Crunchafi, LeaseQuery and the specialist tools**: AP enters the rent invoice as Dr Lease clearing / Cr AP. The lease tool's monthly entry credits the clearing account, which then nets to zero. The reason they give is "the lease tool is not an AP system".
- **NetSuite**: not documented. A consultant says users debit the lease liability on the bill (**unverified**).
- **Rationale**: the integrated modules (Dynamics 365, Sage Intacct) own both the schedule and AP, so they debit the liability directly. The clearing account exists for tools that cannot create the AP invoice.

### 5. The ROU asset lives in the lease subledger, with an optional fixed asset link
- **SAP**: always an FI-AA asset (depreciation base method 29 gives the operating pattern).
- **NetSuite**: a FAM asset with "Asset is Leased" ticked.
- **Dynamics 365**: the lease subledger by default. If the user links a fixed asset, the initial recognition posts as an FA acquisition, and depreciation runs in Fixed assets.
- **Sage Intacct and the specialist tools**: the lease subledger only.
- **Rationale**: the ASC 842 operating ROU amortization is a plug (single lease cost − interest), not a depreciation method. So a product that puts the ROU asset in the register needs a special method. SAP uses base method 29; Dynamics 365 uses "straight-line expense minus interest".

### 6. Modifications create a new schedule version from an effective date
- **Dynamics 365**: the "Lease adjustment wizard" takes a modification start date. It previews the change, supports approval, and creates a new lease version. If the ROU asset would go below zero, the rest posts to gain on modification.
- **SAP**: a contract change adds a valuation time slot. "Val. Behavior" is New, Absolute Difference (remeasure) or Reduction (partial termination).
- **NetSuite**: "Lease Modifications" takes an effective date, a new term and a new rate. The user must reverse the lease journal first.
- **Sage Intacct**: an "Out of Service → Change Created" state with an effective date regenerates the schedules.
- **Rationale**: posted periods are closed. Every product keeps history and rebuilds only from the effective date forward.

### 7. Disclosures come from the schedule, not the GL
- **Dynamics 365**: ROU and liability rollforwards, a five-year undiscounted payment forecast, GAAP cash flows, weighted-average discount rate.
- **Sage Intacct**: a disclosure report with 6 parts. They are lease cost (ROU depreciation, interest, non-capitalized cost), cash flows by activity, ROU additions, a maturity table, the weighted averages and the current split.
- **NetSuite**: short-term and long-term liability, liability detail and ROU listing only.
- **Rationale**: the maturity analysis and the weighted averages need undiscounted future cash flows. Only the schedule has them.

## Journal Entries and the Worked Example

All amounts below come from one lease. A Python check of the schedule reproduced every number (Decimal arithmetic, half-up rounding to cents, the last period absorbs the residual).

**The lease.** 36 months. $10,000 per month, paid in arrears. Discount rate 6% a year, so 0.5% a month. No initial direct costs, no incentives, no prepaid rent.

**Commencement measurement.**

- Lease liability = 10,000 × (1 − 1.005⁻³⁶) ÷ 0.005 = **$328,710.16**.
- ROU asset = liability + initial direct costs + prepaid rent − incentives = **$328,710.16**.
- Undiscounted payments = $360,000.00. Imputed interest = $31,289.84.
- If the same lease is paid in advance, the payments are worth 328,710.16 × 1.005 = $330,353.71. The liability excludes the payment made at commencement, so it is $320,353.71. The ROU asset includes that payment, so it is $330,353.71 (Deloitte 8.4).

**Liability schedule (both classifications use it).**

| Month | Opening | Interest (0.5%) | Payment | Principal | Closing |
|---|---|---|---|---|---|
| 1 | 328,710.16 | 1,643.55 | 10,000.00 | 8,356.45 | 320,353.71 |
| 2 | 320,353.71 | 1,601.77 | 10,000.00 | 8,398.23 | 311,955.48 |
| 12 | 234,456.37 | 1,172.28 | 10,000.00 | 8,827.72 | 225,628.65 |
| 24 | 125,561.50 | 627.81 | 10,000.00 | 9,372.19 | 116,189.31 |
| 36 | 9,950.22 | 49.78 | 10,000.00 | 9,950.22 | 0.00 |

Interest by year: $16,918.49, $10,560.66, $3,810.69 (total $31,289.84).

### Entries common to both classifications

| Event | Debit | Credit | Amount |
|---|---|---|---|
| Commencement | ROU asset | Lease liability | 328,710.16 |
| Initial direct costs paid (if any) | ROU asset | AP / cash | the cost |
| Incentive received (if any) | AP / cash | ROU asset | the incentive |
| Monthly AP invoice from the lessor (fixed payment) | Lease liability | AP | 10,000.00 |
| Variable payment (usage, CPI change under ASC 842, CAM true-up) | Variable lease cost | AP | as billed |
| Short-term lease payment (expedient) | Short-term lease cost | AP | as billed |

The monthly AP invoice line debits the lease liability for the fixed payment. The invoice never carries the cost. The lease run posts the cost. A variant debits a **lease clearing account** and lets the run move it to the liability; see Pattern 4.

### Operating lease — monthly lease run entry

ASC 842 requires one straight-line **single lease cost**: total payments ÷ term = 360,000 ÷ 36 = **$10,000.00** a month. The ROU amortization is the plug: single lease cost − interest accretion.

| Month 1 | Debit | Credit |
|---|---|---|
| Operating lease cost | 10,000.00 | |
| Lease liability (interest accretion) | | 1,643.55 |
| Accumulated ROU amortization (plug) | | 8,356.45 |

After the AP invoice (Dr liability 10,000.00), the liability is 328,710.16 + 1,643.55 − 10,000.00 = 320,353.71. With level payments and no initial direct costs, the net ROU asset equals the liability every month. The income statement shows one line, never interest.

### Finance lease — monthly lease run entry

The cost is interest on the liability plus straight-line ROU amortization of 328,710.16 ÷ 36 = **$9,130.84** a month. Month 36 takes $9,130.76, so the total is exact.

| Month 1 | Debit | Credit |
|---|---|---|
| Interest expense | 1,643.55 | |
| Lease liability (interest accretion) | | 1,643.55 |
| ROU amortization expense | 9,130.84 | |
| Accumulated ROU amortization | | 9,130.84 |

Month 1 expense is $10,774.39. Expense by year: $126,488.57, $120,130.74, $113,380.69. The total over 36 months is $360,000.00 for both classifications. Only the timing and the income-statement line differ.

If ownership transfers or the purchase option is reasonably certain, the finance ROU asset amortizes over the asset's useful life, not the lease term.

### Termination — end of month 24, $5,000 penalty

After payment 24 the liability is $116,189.31.

| | Operating | Finance |
|---|---|---|
| Accumulated ROU amortization at month 24 | 212,520.85 (Σ plugs = Σ principal) | 219,140.16 (24 × 9,130.84) |
| Net ROU asset | 116,189.31 | 109,570.00 |
| Dr Lease liability | 116,189.31 | 116,189.31 |
| Dr Accumulated ROU amortization | 212,520.85 | 219,140.16 |
| Cr ROU asset (cost) | 328,710.16 | 328,710.16 |
| Gain before the penalty | 0.00 | 6,619.31 |
| Dr Loss on termination / Cr AP (penalty) | 5,000.00 | 5,000.00 |
| Net result | Loss 5,000.00 | Gain 1,619.31 |

A full termination removes the ROU asset and the liability, and the difference plus the penalty is the gain or loss (ASC 842-20-40-1). A partial termination applies only when the right of use gets smaller, for example less floor space. A shorter term is a remeasurement, not a partial termination (PwC 5.3).

### Purchase option exercise — finance lease that ends in ownership

Variant: the same lease plus a $20,000 purchase option at month 36, reasonably certain. Useful life 84 months.

- Liability = 328,710.16 + 20,000 × 1.005⁻³⁶ (16,712.90) = **$345,423.06** = ROU asset.
- ROU amortization = 345,423.06 ÷ 84 = $4,112.18 a month (useful life, because the option is reasonably certain).
- At month 36 the liability is $20,000.00, after the final period absorbs the $0.01 rounding residual. Accumulated ROU amortization is $148,038.48.

| Exercise entry | Debit | Credit |
|---|---|---|
| Pay the option (AP invoice) | Lease liability 20,000.00 | AP 20,000.00 |
| Move the ROU asset to the fixed asset register | Equipment (PP&E) 345,423.06 | ROU asset 345,423.06 |
| Move the accumulated amortization | Accumulated ROU amortization 148,038.48 | Accumulated depreciation 148,038.48 |

The new fixed asset depreciates its $197,384.58 net book value over the remaining 48 months. A purchase is not a termination. If the purchase price differs from the liability just before the purchase, the difference adjusts the asset's carrying amount (ASC 842-20-40-2, Deloitte DART 8.7).

### Modification — extend the term at month 12

A term extension is a remeasurement, not a new lease (unless it adds a new asset at a standalone price). Steps:

1. Recompute the remaining payments over the new term.
2. Reassess the classification.
3. Discount the payments at a **revised** discount rate as of the modification date.
4. Post Dr ROU asset / Cr Lease liability for the difference. For a decrease, post the reverse.
5. If a decrease is larger than the net ROU asset, post the rest to profit or loss.
6. Replace the unposted schedule rows from month 13. Never change posted rows.

For an operating lease, the new single lease cost = (remaining undiscounted payments + net ROU asset − liability after remeasurement) ÷ remaining months. For a finance lease, amortize the new net ROU asset over the remaining term (PwC 5.3).

### Disclosure figures for this lease at commencement

| Disclosure | Value |
|---|---|
| Maturity analysis (undiscounted) | Year 1 120,000; Year 2 120,000; Year 3 120,000; total 360,000 |
| Less imputed interest | (31,289.84) |
| Present value = lease liability | 328,710.16 |
| Weighted-average remaining lease term (weighted by liability balance) | 3.0 years |
| Weighted-average discount rate (weighted by remaining payments) | 6.0% |
| Operating lease cost, year 1 (if operating) | 120,000.00 |
| Finance lease cost, year 1 (if finance) | amortization 109,570.08 + interest 16,918.49 |
| Cash paid for amounts in the lease liability, year 1 | 120,000.00 (operating cash flow if operating; financing for principal and operating for interest if finance) |
| ROU assets obtained in exchange for new lease liabilities | 328,710.16 |


## Answers to Research Questions

1. **What header fields does a lessee lease need?** Lessor (supplier), asset description and class, location, commencement date, end date, payment frequency, timing (advance or arrears), discount rate, currency. Add initial direct costs, incentives, prepaid rent, and the options (renewal, termination, purchase) with a "reasonably certain" flag. For automatic classification also add fair value, economic life, ownership transfer and specialized asset (Dynamics 365, Sage Intacct, Deloitte 8.4).
2. **How are payments and escalations modeled?** As dated payment rows, generated from terms: amount, frequency, start, number of periods, and an escalation (fixed % or step). Dynamics 365 and Visual Lease support CPI. Under ASC 842, an index change is a variable payment, not a remeasurement. Under IFRS 16 it remeasures the liability at the unchanged rate.
3. **Are the classification tests automated?** Among the ERPs, only in Dynamics 365 and Infor. FinQuery also advertises classification tests. NetSuite, Sage Intacct and SAP make the user choose. A design can run the tests when the user enters fair value and economic life. If either is blank, the user chooses.
4. **How is the IBR handled?** As one rate on the lease in Dynamics 365, NetSuite and Sage Intacct. Visual Lease has a rate table keyed by asset type, credit rating, country, currency and remaining term. A private company can elect the risk-free rate by asset class (ASU 2021-09). A company can also use one rate for a portfolio of similar leases.
5. **Batch run or at invoice?** Batch run, in every product (Pattern 3).
6. **Do lease payments create AP invoices, and what do they debit?** In the integrated modules, yes. Dynamics 365 and Sage Intacct create the AP invoice from the schedule, and it debits the lease liability. External tools use a lease clearing account that the monthly journal clears (Pattern 4).
7. **Separate subledger or fixed asset register for the ROU asset?** Both exist. SAP and NetSuite use the register. Dynamics 365 makes the link optional. Sage Intacct and the specialists use the subledger (Pattern 5).
8. **Short-term expedient?** A term of 12 months or less with no purchase option that is reasonably certain. The company elects it by asset class. The payments go to short-term lease cost and nothing goes on the balance sheet. Dynamics 365 has a short-term threshold in months on the lease book.
9. **Variable payments?** Never in the liability. Dynamics 365 debits a variable-payment account on the same AP invoice. Sage Intacct uses "Non Capitalized Lease Expense". Visual Lease flags a payment stream as variable for the disclosure.
10. **Modifications and remeasurement?** The products create a new schedule version from an effective date. Term and payment changes use a revised discount rate. The ROU asset moves by the same amount as the liability (Pattern 6, PwC 5.3).
11. **Termination?** Remove the ROU asset, the accumulated amortization and the liability; post the difference plus any penalty as a gain or loss. Dynamics 365 uses a termination proposal and can reverse it. Sage Intacct posts one GL batch.
12. **Purchase option exercise?** ASC 842-20-40-2: move the ROU asset to PP&E. None of the ERPs documents this step (Dynamics 365 **unverified**). It is a manual journal in most products.
13. **Existing leases at go-live?** NetSuite has "Mid-life Lease" fields: the source journal or bill and the number of prior interest periods already recognized. Dynamics 365 has a lease import framework with Add, Update and Adjust. Sage Intacct creates the past transactions again ("retroactive transaction creation"). The specialist vendors do the migration as a paid service (FinQuery says 3.5 months). Today almost no company is adopting ASC 842. The real case is an ERP cutover in the middle of a lease.
14. **Which disclosures?** ASC 842-20-50-4 and 50-6 require these, with operating and finance shown apart:
    - finance lease cost (ROU amortization and interest), operating lease cost, short-term lease cost, variable lease cost, sublease income
    - cash paid for amounts in the lease liability, by cash-flow activity
    - ROU assets obtained in exchange for new lease liabilities
    - weighted-average remaining lease term (weighted by liability) and discount rate (weighted by remaining payments)
    - the maturity analysis for years 1 to 5 plus thereafter, reconciled to the liability through imputed interest

## Competitor-Specific Details

### SAP S/4HANA — RE-FX Contract and Lease Management
- Valuation types: Transfer Posting (expense), Linearization, Balance-Sheet Capitalization. Classification options: A = right-of-use approach (linear depreciation), B = straight-line lease (depreciation = linearized cost − interest, the ASC 842 operating pattern), C = finance lease without depreciation.
- Statistical conditions carry initial costs (they increase the ROU asset), incentives (they reduce it), retirement obligations, residual value guarantees and penalties.
- The system creates one FI-AA asset per contract object when the valuation rule is Complete.
- Runs: RECEPR (valuation cash flow), RERAPP (payments to vendor open items), RECEEP (valuation postings), plus the FI-AA depreciation run.
- "SAP Lease Administration by Nakisa" was a resold subledger. A consultant (Serio) says SAP ended the resale in December 2018. Nakisa now sells directly and posts to SAP through BAPIs.
- No SAP Help page documents exemptions, variable payments, transition or purchase option. A maturity report is **unverified**.

### Microsoft Dynamics 365 Finance — Asset leasing
- The **lease book** holds the framework (IFRS 16, ASC 842, ASC 840, IAS 17), the thresholds (classification %, short-term months, low-value amount), "Pay to vendor" and the posting layer. One lease can carry several books.
- "Annuity type" sets the timing: annuity due (advance) or ordinary annuity (arrears).
- Short-term and low-value leases get "deferred rent treatment": Dr Lease expense / Cr Vendor.
- A month-end entry moves the current portion to "Short-term lease liability" and reverses it on the first day of the next month.
- Index revaluation remeasures under IFRS 16 and changes only the variable payments under ASC 842.
- Impairment: Dr Impairment expense / Cr ROU asset. The rest depreciates straight-line.
- Reports: asset movement, lease movement, lease balances forecast, five-year undiscounted payment forecast, GAAP cash flows, weighted-average discount rate, commencements, modifications, transactions.

### Oracle NetSuite — FAM Lease Accounting
- A feature of the Fixed Assets Management SuiteApp. The 2026.2 notes show no newer native lease module.
- NPV uses payment ÷ (1 + rate/12)^period. If the first payment falls on day 1–15, it is period 0 with no interest.
- "Record Lease Interest" posts Dr Interest expense / Cr Lease liability for a finance lease. For an operating lease it posts Dr Accumulated Depreciation – ROU / Cr Lease liability, which keeps the operating cost on one line.
- No documentation for expedients, variable payments, termination, purchase option or weighted averages.

### Sage Intacct — Lease Accounting
- Lessee only. It covers ASC 842, IFRS 16, FRS 102 and GASB 87/96. Its setup uses web service users and sender IDs, which suggests an app on the Intacct API (inference).
- The lease class holds 10 accounts: Lease Liability, Lease Liability Adjustment, Interest Expense, RoU Asset, RoU Accumulated Depreciation, Depreciation or Lease Expense, Non Capitalized Lease Expense, Gain/Loss on Termination, AP/Cash Contra, Lease Liability Current Portion.
- Lifecycle: Created → Schedules Generated → In Service → Out of Service (change, revaluation) → Terminated, with "Put Back In Service".
- The disclosure report weights both averages by the closing liability. ASC 842 weights the rate by remaining payments, so this is a small difference.

### Odoo, Acumatica, Business Central, Epicor
- **Odoo**: native Assets has no lease support. Apps-store modules (`eh_account_assets_pro`, `ifrs_16_lease_accounting_oi`) add IFRS 16 schedules, a daily cron with a "Post Due" approval, and a modification wizard.
- **Acumatica**: Fixed Assets has only a "Leased" property type. LeaseQuery and iLeasePro push journals to the GL.
- **Business Central**: partner apps (SOFT4Lessee) post journals; details **unverified**.
- **Epicor Kinetic**: no native module and no named partner found.

### Specialist tools
- **Names (October 2026)**: LeaseQuery is a FinQuery product. CoStar bought Visual Lease in November 2024 and is merging it with CoStar Real Estate Manager. insightsoftware bought LeaseAccelerator in July 2024. A search summary claimed FloQast bought FinQuery; no source confirmed it.
- **Visual Lease CPI method**: the guaranteed minimum increase goes into the base rent. A second $0 stream, flagged variable, takes the excess above the minimum when the actual CPI is known.
- **Visual Lease IBR**: a "Borrowing Rate table" keyed on asset type, credit rating, country, currency and remaining term. The tool picks the rate when the user creates a schedule.
- **LeaseAccelerator**: a multi-book engine (ASC 842, IFRS 16 and local GAAP in parallel).
- **Customer complaints (G2, Capterra, about LeaseQuery)**: hard to change a lease after approval, rigid setup for complex leases, reports hard to adapt.

## Table Stakes vs. Nice-to-Have

The target is a mid-market manufacturer with 5 to 50 leases: a building, forklifts, a CNC machine on a finance lease, company vehicles, copiers. Most are fixed monthly payments with a fixed % escalation on the building.

| Feature | Verdict | Why |
|---|---|---|
| Lease record: supplier, class (Real Estate, Equipment, Vehicle), location, dates, frequency, timing, discount rate | **Table stakes** | Every product has it |
| Payment terms with a fixed % escalation or step rows | **Table stakes** | Building leases escalate; NetSuite's lack of it is a known gap |
| Effective-interest schedule, last period absorbs rounding | **Table stakes** | Every product |
| Operating and finance patterns (single lease cost vs interest + amortization) | **Table stakes** | ASC 842 requires both |
| Classification: tests when fair value and life are entered, else user choice, with override reason | **Table stakes** | Dynamics 365 tests; Sage Intacct and NetSuite choose; both are needed |
| Initial direct costs, incentives, prepaid rent in the ROU asset | **Table stakes** | Tenant improvement allowances are common on building leases |
| Commencement journal and a monthly lease run (Draft → Posted) | **Table stakes** | Pattern 3 |
| AP invoices from the payment schedule that debit the liability | **Table stakes** for an integrated ERP | Dynamics 365, Sage Intacct; otherwise AP keys every rent bill by hand |
| Variable payments as lines on the same AP invoice | **Table stakes** | CAM, mileage, overage; no subledger needed |
| Short-term expedient by class election | **Table stakes** | Vehicle and equipment rentals of 12 months or less |
| Opening balance for a lease that is already running at cutover | **Table stakes** | Every customer has leases on day one |
| Term or payment change (remeasurement) and full termination | **Table stakes** | Renewals happen every year in a portfolio |
| Purchase option exercise → fixed asset | **Table stakes** for manufacturers | Equipment finance leases end in ownership; no ERP automates it |
| Disclosure report: maturity analysis, weighted averages, cost breakdown, cash paid | **Table stakes** | An audit needs it every year |
| Current and non-current split of the liability | **Table stakes** (report); posted reclass is nice-to-have | Dynamics 365 posts a reversing reclass |
| CSV import of leases | **Should have** | Dynamics 365 and Sage Intacct; faster onboarding |
| Critical-date alerts (renewal notice, option windows) | Nice-to-have | Visual Lease sells on it |
| CPI or index payments | Nice-to-have under ASC 842 | A variable-payment line covers the excess |
| Partial termination, impairment | Nice-to-have | Rare for a manufacturer |
| IBR rate tables, portfolio approach, risk-free rate election | Nice-to-have | One default rate plus a per-lease override covers most cases |
| IFRS 16 book, low-value exemption, multiple books | Nice-to-have | Only for IFRS reporters |
| Lease and non-lease component separation | Nice-to-have | Most lessees elect not to separate |
| Embedded lease detection, sublease, sale-and-leaseback | Out of scope | Specialist territory |

## Recommendations for Carbon

Carbon already has most of the building blocks (read-only sweep, 2026-10-11):

| Building block | Where | Use for the lessee |
|---|---|---|
| `presentValue` (annuity in advance or arrears) and `classifyLessorLease` (the five tests) | `packages/utils/src/lessor-lease.ts` | The same math for the lessee. The tests are the same criteria. |
| `leaseMajorPartThresholdPercent` (75), `leaseSubstantiallyAllThresholdPercent` (90), `leaseDefaultDiscountRate` (6) | `companySettings`, migration `20261006220501` | Shared thresholds and the default rate |
| `journalEntrySourceType` `'Lease'` | migration `20261006220301` | The lease run and the commencement journal |
| `'Opening Balance'` source type and `companySettings.accountingCutoverDate` | migrations `20260901165008`, `20261009004448` | Opening balances for running leases |
| Period runs: Draft → Posted, Reverse Run, one journal per month, close checklist dry run | Part IV of the rev-rec spec; `depreciationRun`, `revenueRecognitionRun` | The lease run |
| Rental billing periods → Draft invoices, stamped so a re-run never bills twice | `rentalBillingPeriod`, `rental-billing` job | Lease payments → Draft purchase invoices |
| `G/L Account` purchase invoice line type | `purchaseInvoiceLineType` | Manual rent invoices that debit the liability |
| Fixed asset register and `fixedAssetTransfer` | accounting module | Purchase option exercise |

Carbon has no recurring purchase-invoice path today. The rental invoice automation is sales-side only.

### The v1 cut ("simple and complete")

1. **Put the lease in purchasing, as a supplier document.** Name it `lease` (readable id, sequence). It mirrors the rental agreement in sales. Status: Draft → Active → Terminated or Expired. The older spec put it in accounting with a `role` column. The lessor side now lives in `rentalAgreement`, so drop `role` and keep the table lessee-only.
2. **Store the payments as terms, and generate payment rows.** A `leasePaymentTerm` row has a start date, a period count, an amount and an escalation %. Activation expands the terms into dated payment rows. Step rents are more term rows. Leave CPI out; post the excess as a variable line.
3. **Classify with the tests when the inputs exist.** Reuse the `classifyLessorLease` criteria with lessee inputs. If fair value or economic life is blank, the user picks Operating or Finance. Store the test results, and require a reason for an override (the rental agreement already does this).
4. **Keep the ROU asset in the lease subledger.** Do not create a `fixedAsset` for it. The operating plug is not one of Carbon's depreciation methods, and the asset register also feeds MACRS. Allow an optional link to an existing `fixedAsset` for the equipment record only (Dynamics 365 pattern, without its posting switch).
5. **Map accounts by lease class.** Seed 3 classes: Real Estate, Equipment and Vehicle. Each class holds 8 accounts: ROU asset, accumulated ROU amortization, lease liability, operating lease cost, interest, ROU amortization, variable lease cost and short-term lease cost. Split operating and finance ROU and liability accounts, because ASC 842 presents them on separate lines.
6. **Post the commencement journal at activation.** Dr ROU asset / Cr Lease liability, plus the initial direct cost, incentive and prepaid legs.
7. **Add a monthly lease run on the period-run pattern.** It posts the interest accretion. It also posts the operating single lease cost or the finance ROU amortization. Reuse Draft → Posted, Reverse Run, the dry run and the close checklist task from Part IV. Do not build a new engine.
8. **Generate Draft purchase invoices from the payment rows.** Copy the rental billing pattern. A daily job creates one Draft purchase invoice per due payment and stamps the payment row. The fixed line debits the lease liability. Lock its amount and account, as Dynamics 365 does. The user adds variable lines (CAM, overage) to the same invoice at the variable lease cost account. Use the clearing account only as a fallback for a company that keys rent invoices by hand.
9. **Support the short-term expedient by class.** A short-term lease has payment rows and Draft invoices, but no ROU asset, no liability and no run lines. Its invoice line debits short-term lease cost.
10. **Support opening balances at the cutover.** Follow NetSuite's mid-life lease. Enter the original commencement date and the lease terms. Carbon computes the schedule from commencement and posts one `'Opening Balance'` journal at the cutover date for the liability and the net ROU asset. The lease run then starts at the first period after the cutover. Allow a typed liability and ROU override for a lease migrated from another system.
11. **Support three events: remeasure, terminate, exercise the purchase option.**
    - Remeasure covers term and payment changes. It creates a new schedule version from the effective date, posts one ROU and liability adjustment, and never changes posted rows.
    - Terminate posts the derecognition and the gain or loss (this file's termination entry).
    - Exercise the purchase option creates the `fixedAsset` and moves the ROU cost and accumulated amortization into it (this file's purchase entry).
12. **Build the disclosure report from the schedule.** Include every item in answer 14, plus the current and non-current split. Split operating and finance. Add a CSV export.
13. **Store both expense patterns on every schedule row.** It costs 3 columns, and an IFRS 16 book becomes a pure reader later. This keeps the older spec's decision.

### Defer from v1

- IFRS 16 book, low-value exemption, index remeasurement.
- Partial termination and impairment. Use a manual journal in v1, and refuse the event with that message.
- IBR rate tables and the portfolio approach. Use the company default rate plus a per-lease override.
- Posted current and non-current reclass. Show the split in the report.
- Lease and non-lease component separation. Assume the company elects not to separate.
- Critical-date alerts and CSV import. Both are cheap follow-ons.

### Decisions to resolve before the spec

1. Confirm the AP pattern: generated invoices that debit the liability, with a clearing-account fallback. The older spec chose clearing only.
2. Confirm the ROU asset stays in the subledger, with the fixed asset only at purchase.
3. Confirm the module: purchasing for the document, accounting for the run and the reports.
4. Confirm v1 is ASC 842 only. The older spec bundled an IFRS 16 adjustment book that depends on the unbuilt multi-book spec.

## Sources

Standards and guidance
- https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc842-10/roadmap-leasing/chapter-8-lessee-accounting/8-4-recognition-measurement
- https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc842-10/roadmap-leasing/chapter-8-lessee-accounting/8-2-policy-decisions-that-affect
- https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc842-10/roadmap-leasing/chapter-8-lessee-accounting/8-7-derecognizing-a-lease
- https://dart.deloitte.com/USDART/home/codification/broad-transactions/asc842-10/roadmap-leasing/chapter-15-disclosure/15-2-lessee-disclosure-requirements
- https://dart.deloitte.com/USDART/home/publications/archive/deloitte-publications/heads-up/2018/fasb-re-leases-targeted-improvements-asc
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/leases/leases__4_US/chapter_3_lease_clas_US/33_lease_classificat_US.html
- https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/leases/leases__4_US/chapter_5_modificati_US/53_accounting_for_le_US.html
- https://viewpoint.pwc.com/dt/us/en/fasb_financial_accou/asus_fulltext/2021/asu2021-09/ASU-2021-09/asu2021-09.html
- https://kpmg.com/kpmg-us/content/dam/kpmg/frv/pdf/2021/defining-issues-asc842-private-ent-rfr.pdf
- https://assets.kpmg.com/content/dam/kpmgsites/xx/pdf/ifrg/2024/leases-discount-rate.pdf
- https://kpmg.com/us/en/articles/2022/lease-accounting-ifrs-standards-us-gaap.html
- https://grantthornton.com/insights/articles/audit/2021/snapshot/december/asu-2021-09-amends-discount-rate-guidance-for-nonpublic-lessees
- https://www.gaapdynamics.com/insights/blog/2019/10/01/ifrs-16-vs-asc-842-how-to-account-for-low-value-leases/
- https://www.ifrs.org/content/dam/ifrs/project/leases/ifrs/published-documents/ifrs16-effects-analysis.pdf
- https://costarmanager.com/blog/difference-between-asc842-and-ifrs16

SAP
- help.sap.com (SAP_S4HANA_ON-PREMISE): "Contract and Lease Management", "Process Overview", "Setting Up Contract Master Data", "Performing and Posting the Balance Sheet Valuation", "FI-AA Integration with Lease Accounting", "Lease-In Accounting (1T6)", "Adjustment of Conditions", "Manage Contract Term", "S/4HANA for Accounting Integration – Key Features"
- https://blog.sap-press.com/how-to-assign-valuations-rules-to-lease-contracts-in-sap-flexible-real-estate-management
- https://serioconsulting.com/blog/sap-and-leasing-part-3-what-options-do-sap-customers-have/
- https://nakisa.com/blog/how-nakisa-lease-accounting-software-integrates-with-erp-systems/
- https://www.linkedin.com/pulse/ifrs-16-lease-accounting-sap-okechukwu-j-utazi-aca-ctp-ietuf

Microsoft Dynamics 365 Finance
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/asset-leasing-quick-start
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/set-up-lease-books
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/add-lease
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/create-payment-invoice
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/create-monthly-journals-batch
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/adjust-lease
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/lease-termination
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/associate-lease-with-fixed-asset
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/revalue-payments-tied-2-index-rate
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/lease-posting-types
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/manage-leases-thru-imprt-framewrk
- https://learn.microsoft.com/en-us/dynamics365/finance/asset-leasing/asset-leasing-rprts

Oracle NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1543968584.html (Lease Accounting chapter, with subsections subsect_1203074757, subsect_1203081126, subsect_1543971350, subsect_1543971320, section_1543971770, section_1543971788, section_1543977465, section_1550097769)
- https://www.houseblend.io/articles/asc-842-journal-entries-finance-operating-netsuite (secondary source)

Sage Intacct
- https://www.intacct.com/ia/docs/en_US/help_action/Lease_Accounting/about-lease-accounting.htm
- https://www.sageintacctmpp.com/add-on-products/leaseaccounting
- https://www.sageintacctmpp.com/lease-accounting-training-course/lease-accounting-configuration
- https://www.sageintacctmpp.com/lease-accounting-training-course/lease-classes-us-gaap-operating
- https://www.sageintacctmpp.com/lease-accounting-training-course/lease-classes-ifrs-and-finance
- https://www.sageintacctmpp.com/lease-accounting-training-course/subsequent-lease-payments
- https://www.sageintacctmpp.com/lease-accounting-training-course/out-of-service-change-created
- https://www.sageintacctmpp.com/lease-accounting-training-course/terminated
- https://www.sageintacctmpp.com/lease-accounting-training-course/in-service
- https://www.sageintacctmpp.com/lease-accounting-training-course/disclosure-report

Odoo, Acumatica, Business Central, Infor
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/vendor_bills/assets.html
- https://apps.odoo.com/apps/modules/19.0/eh_account_assets_pro
- https://apps.odoo.com/apps/modules/16.0/ifrs_16_lease_accounting_oi
- https://apps.odoo.com/apps/modules/17.0/lease_scheduling
- https://www.acumatica.com/acumatica-marketplace/leasequery-lease-accounting-for-acumatica/
- https://ileasepro.com/blog/ileasepro-partners-with-acumatica-to-deliver-an-integrated-asc-842-lease-accounting-solution/
- https://marketplace.microsoft.com/en-us/product/dynamics-365-business-central/pubid.soft4|aid.s4les100ext|pappid.e1b6b18a-7fed-4ee3-967c-f117dd321d58?tab=overview
- https://www.mercuriusit.com/understanding-ifrs-16-and-asset-leasing-with-business-central/
- https://docs.infor.com/csstlwsnhc/latest/en-us/csstlwsnhcolh/cshealthso/ced1678356468786.html

Specialist tools
- https://finquery.com/lease-accounting-software/
- https://finquery.com/switch-software/
- https://finquery.com/blog/operating-lease-accounting-asc-842-explained-example/
- https://finquery.com/blog/asc-842-disclosure-requirements-example-explanation/
- https://finquery.com/integrations/
- https://www.suiteapp.com/Lease-Query-Lease-Accounting-for-Net-Suite
- https://visuallease.com/visual-lease-reporting-features-asc-842-journal-entries/
- https://visuallease.com/incremental-borrowing-rate-what-you-need-to-know-for-lease-accounting/
- https://visuallease.com/vluniversity/course/index-based-payments/
- https://visuallease.com/integrations/
- https://investors.costargroup.com/news-releases/news-release-details/costar-group-closes-deal-acquire-visual-lease-leading-lease
- https://www.insightsoftware.com/leaseaccelerator/
- https://www.crunchafi.com/knowledge-base/article/how-do-i-use-the-cashap-clearing-account
- https://www.g2.com/products/leasequery-powered-by-finquery/reviews
- https://www.capterra.com/p/143396/LeaseQuery/reviews/

Carbon (read-only)
- `.ai/specs/2026-07-04-lease-accounting.md`, `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` (Parts I, II, IV), `.ai/research/2026-09-21-sell-vs-rent-rental-revenue-recognition.md`
- `packages/utils/src/lessor-lease.ts`; migrations `20261006220301_fleet-rental-lease-enums.sql`, `20261006220501_rental-agreements.sql`, `20260901165008_opening-balance-source-type.sql`, `20261009004448_accounting-cutover.sql`

## Addendum (2026-10-11): a lease found after go-live

The question: a lease started before the company enabled accounting in Carbon, and nobody booked it. Where does the opening difference go?

- **The standard.** ASC 250 corrects an error from a prior period. If the error predates the earliest period presented, the cumulative effect goes to the opening balance of retained earnings. An immaterial error can be corrected in the current period instead.
- **NetSuite.** A "mid-life lease" names a source journal or bill that the user posts (the debit must be a fixed asset account, the credit AP or a liability). The user also enters how many interest periods were already recognized. NetSuite does not pick the offset.
- **Dynamics 365.** The opening balance import computes the lease liability and the ROU asset so they match the legacy carrying values.
- **Conclusion.** The ERPs do not agree on one offset. None of them posts to a migration clearing account after go-live. Carbon posts the difference to retained earnings, as ASC 250 does for an error that predates the periods presented.

Sources: [PeaseBell — ASC 842 audit findings](https://www.peasebell.com/insights/asc-842-audit-findings/) · [CPA Exams Mastery — error corrections](https://cpaexamsmastery.com/far/4/18/3/) · [NetSuite — Creating a Lease Record Manually](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_1203074757.html) · [NetSuite — Posting Reference Subtab](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_1543971320.html) · [Dynamics community — Asset Leasing opening balance migration](https://community.dynamics.com/blogs/post/?postid=df76953f-bb2c-405a-ad21-cabcf82d742d)


## Addendum (2026-10-11): several assets on one lease

Sources: Deloitte DART 4.2, 8.3, 8.6, 13.4; PwC Viewpoint 2.5, 3.3, 5.5; ASU 2016-02 BC120–121; Nakisa Lease Administration user guide (lease components, activation groups, modifications, lease end); NetSuite lease record help; Oracle Fusion Assets leases; SAP RE-FX (thin: help pages render blank to a fetch).

| Question | Finding | Products |
|---|---|---|
| Unit of account | Each right to use a separately usable asset is a separate lease component (842-10-15-28). Each component is classified at its own commencement (25-1, 55-22). | Nakisa: classification, schedule, fair value and useful life per activation group. NetSuite: one lease record = one asset. Oracle: one schedule per asset as an option. |
| Payments | A lump sum is allocated to components by relative standalone price (15-33). | Nakisa: amount per unit per component. Oracle: split by asset count, or per asset. |
| Early end of one asset | Ending one component while others continue is a modification of the whole contract (Deloitte 8.6.3.7); the ROU decreases in proportion and the difference is a gain or loss (25-13). | Nakisa: split the activation group, then early termination or buyout on that group only; the contract closes when all groups close. |
| Purchase option | The option is to buy "the underlying asset", so it is tested per component. | Nakisa: purchase option per component, "likely to exercise" per activation group. |
| Asset identity | Every product creates one record per leased object (NetSuite fixed asset, Nakisa unit, SAP object). No source shows a serial number field. | — |
| Lessor invoices | Both layouts exist: one line per asset, or a lump sum the lessee allocates. | Oracle lessor grouping rules; master lease schedules state rent per item. |
