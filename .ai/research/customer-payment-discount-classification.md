# Customer Payment Discount Classification Research: Best Practices Survey

## Summary

Question: should Carbon's `customerPaymentDiscountAccount` (the GL account an early-payment cash discount given to a customer posts to, e.g. terms "2/10 net 30") be classified as an **expense** account (Carbon's current default) or as a **contra-revenue** account?

Findings: the authoritative accounting standards (ASC 606 / IFRS 15) treat a customer prompt-payment discount as a **reduction of the transaction price → contra-revenue, not an operating expense**. Modern SMB/mid-market ERPs (QuickBooks, NetSuite, Dynamics 365 Business Central) follow this and post the customer side to a revenue-reducing account. SAP is the notable outlier: its out-of-the-box automatic-posting default (OBXI / transaction key SKT, "Cash Discount Granted") books the granted discount to an **expense** account, configurable to a revenue GL. Carbon today matches the SAP default (seeds account `7030` as class `Expense`, `Other Expense`) — and, crucially, this **diverges from Carbon's own `salesDiscountAccount`** (`4020`, under revenue), which the customer credit-memo path already uses. The symmetric vendor discount is a reduction of cost/inventory (net method, preferred) or a purchase-discount contra-account under COGS (gross method) — never "other income," though QuickBooks and SAP's gross default both book it as income as a simplification.

## Competitors Surveyed

- **SAP S/4HANA (ECC + S/4HANA)** — enterprise reference for account-determination patterns; defaults customer cash discount to expense.
- **Oracle NetSuite** — mid-market ERP closest to Carbon's audience; contra-revenue on the customer side.
- **Microsoft Dynamics 365 Business Central** — SMB/mid-market ERP; posting-group-mapped, standard mapping is contra-revenue.
- **QuickBooks (Online + Desktop)** — SMB accounting baseline; explicitly an Income (contra-revenue) account.
- **Xero** — SMB accounting; no built-in feature, user-coded, common convention is contra-revenue.
- **ASC 606 / IFRS 15** — the authoritative standard both frameworks converge on.

## Key Consensus Patterns

### 1. Customer early-payment discount = reduction of revenue (contra-revenue)

- **ASC 606 / IFRS 15**: a prompt-payment/cash/settlement discount is **variable consideration** and reduces the transaction price (Step 3), estimated by expected value / most-likely amount subject to the revenue-reversal constraint. Also framed as "consideration payable to a customer" (ASC 606-10-32-25), a reduction of revenue unless it buys a distinct good/service. It is **not** an operating expense. Pre-606 US GAAP convention was the same *direction* — a contra-revenue "Sales Discounts" account offsetting gross sales.
- **QuickBooks**: auto-creates a "Discounts given" account and its guidance is explicit — "Sales discounts should be a reduction in income, not an expense." Discount items are assigned to an **Income** account.
- **NetSuite**: customer term-based discounts recognized at payment via an Accounting-Preferences discount account, designed as a **contra-revenue / reduction of income** account.
- **Dynamics 365 BC**: "Sales Pmt. Disc. Debit/Credit Acc." in General Posting Setup, standard mapping is a sales-discount / **contra-revenue** account.
- **SAP** *(outlier)*: OBXI / SKT "Cash Discount Granted" posts to an **expense** account by default (`Dr Bank` net + `Dr Cash Discount Granted (expense)` + `Cr Customer` gross). Can be re-pointed to a revenue GL, but the default and documentation frame it as expense.
- **Rationale**: giving a discount does not consume a resource (no expense is *incurred*); the customer simply pays less, so the revenue you recognize is lower. Booking it as expense overstates both gross revenue and operating expense and distorts gross margin.

### 2. Recognition timing: gross method, at payment time

- **SAP, NetSuite, BC** all default to the **gross method** — invoice booked at full value, discount recognized only when the early payment is applied inside the discount window. None default to the net method.
- **BC** additionally gates it on the "Adjust for Payment Disc." setting.
- ASC 606/IFRS 15's estimate-up-front model is conceptually closest to the *net* method, but in practice the gross method (recognize when taken) is near-universal in software and immaterial for most SMBs.
- **Carbon already matches this**: the discount is posted in `post-payment` at payment time, not at invoice time.

### 3. Vendor/purchase discount taken = reduction of cost, not income

- **ASC/GAAP preferred**: reduce cost of purchased goods / inventory (net method preferred; gross method accumulates a "Purchase Discounts" contra-account deducted from Purchases in COGS). Booking it as "other income" overstates both cost and income.
- **SAP**: OBXU / SKE "Cash Discount Received" — gross default posts to an **income** account; net procedure (doc type RN) credits the **cost/stock** account directly.
- **NetSuite**: a "Purchase Discount Account" that Oracle labels an **expense** account (functionally contra-expense).
- **QuickBooks**: recommends an **Income** account (a software simplification that diverges from the GAAP-preferred cost-reduction treatment).
- **Note for Carbon**: Carbon's `supplierPaymentDiscountAccount` is also seeded as `Expense`/`Other Expense` (`7020`) and `post-payment` **credits** it (reducing net expense). That is defensible as a contra-expense but is a separate question from the customer-side classification this research targets.

## Answers to Research Questions

1. **Contra-revenue or expense under ASC 606 / IFRS 15?** — Contra-revenue (reduction of the transaction price / variable consideration). Not an operating expense. (Deloitte, PwC, ACCA, IFRSbox.)
2. **SAP customer side** — Expense by default (OBXI / SKT, "Cash Discount Granted"), gross method. Configurable to a revenue GL.
3. **SAP vendor side** — Income by default (OBXU / SKE, gross); reduces cost/inventory under the net procedure (doc type RN).
4. **NetSuite** — Customer: contra-revenue (Accounting Preferences discount account). Vendor: "Purchase Discount Account" (expense/contra-expense). Gross method, payment-time.
5. **Dynamics BC** — User-mapped via General Posting Setup; standard = sales discount is contra-revenue, purchase discount is contra-cost/income. Gross method, gated on "Adjust for Payment Disc."
6. **QuickBooks** — Customer: Income (contra-revenue) account, explicitly. Vendor: recommends an Income account (simplification).
7. **Xero** — No built-in early-payment discount feature; user codes a discount line / credit note to a chart-of-accounts account. Common convention mirrors QB (contra-revenue on sales).

## Recommended Approach for Carbon

**Reclassify `customerPaymentDiscountAccount` to contra-revenue** (follow ASC 606 / IFRS 15, QuickBooks, NetSuite, and Dynamics BC — the SMB/mid-market consensus and Carbon's actual audience). The current `Expense`/`Other Expense` classification matches only the SAP default, which is the enterprise outlier.

Two implementation shapes to decide between during spec/design:

1. **Reclassify the seeded account** — move seeded account `7030` "Customer Payment Discounts" from `class: "Expense" / accountType: "Other Expense"` under `other-expenses` to a revenue-contra classification (mirroring `salesDiscountAccount` `4020` under sales/revenue), and flip the `post-payment` journal line from `accountType: "expense"` debit to the revenue-side treatment. Note the sign/side implications in `build-payment-journal.ts` and `lib/utils.ts`.
2. **Consolidate onto `salesDiscountAccount`** — Carbon *already* has a contra-revenue customer-discount account (`4020`) that the credit-memo path (`post-memo`) uses. The early-payment-discount path (`post-payment`) using a *different, expense-classified* account (`7030`) is an internal inconsistency: the same economic event (a customer discount) lands in two different P&L sections depending on whether it came through a memo or an early payment. Consolidating both onto `salesDiscountAccount` removes the divergence, but changes the account-defaults contract and the integration payload.

**Migration & compatibility notes** (for the spec — do not decide here):
- Existing companies have a live `accountDefault.customerPaymentDiscountAccount` FK, and historical journal lines are already posted against `7030`. A reclassification changes future postings and the account's P&L placement; it should not retroactively rewrite posted history.
- The account is pushed to accounting integrations (`integrations.$id.tsx`), so external-system mappings (Xero/QBO/Rillet sync) may need to move too.
- `db:check:datasets` / `db:check:backups` gates apply since this touches seed data and chart-of-accounts migrations.
- Whether to also revisit the symmetric `supplierPaymentDiscountAccount` (currently `Expense`, arguably should be contra-cost/COGS) is a related but separable scope decision.

## Sources

SAP:
- https://help.sap.com/doc/saphelp_ewm70/7.0/en-US/1e/70b6531de6b64ce10000000a174cb4/content.htm
- https://help.sap.com/docs/SUPPORT_CONTENT/fiaccounting/3361878894.html
- https://sap96.com/2024/09/04/configuration-for-cash-discount-granted-to-customer-obxi/
- https://sap96.com/2024/09/04/configuration-for-cash-discount-received-from-vendor-obxu/

NetSuite:
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2248474.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1387022.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4702988229.html

Dynamics 365 Business Central:
- https://learn.microsoft.com/en-us/previous-versions/dynamicsnav-2016/hh171792(v=nav.90)
- https://learn.microsoft.com/en-us/training/modules/customer-discounts-dynamics-365-business-central/7-summary

QuickBooks:
- https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/how-to-catagorize-a-customer-discount-income-or-expense/00/1352577
- https://quickbooks.intuit.com/learn-support/en-us/payments/vendor-early-payment-discounts/00/823701

Xero:
- https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/44960470-invoice-prompt-payment-settlement-discount
- https://www.paidnice.com/blog/apply-early-payment-discounts-xero

ASC 606 / IFRS 15:
- https://dart.deloitte.com/USDART/home/codification/revenue/asc606-10/roadmap-revenue-recognition/chapter-6-step-3-determine-transaction/6-6-consideration-payable-a-customer
- https://viewpoint.pwc.com/dt/us/en/fasb_financial_accou/trg_revenue/trg_revenue_US/consideration_payabl__3_US.html
- https://www.cpdbox.com/033-settlement-discounts-ifrs-15/
- https://www.accaglobal.com/africa/en/student/exam-support-resources/fundamentals-exams-study-resources/f3/technical-articles/discounts.html

Purchase discounts (net vs gross):
- https://www.accountinghub-online.com/accounting-for-purchase-discounts/
- https://legalclarity.org/purchase-discount-accounting-gross-vs-net-method/

## Carbon codebase grounding (current state)

- Column defined `accountDefault.customerPaymentDiscountAccount` — `migrations/20230820020844_posting-groups.sql:30`; FK re-pointed to `account(id)` in `20260315000000_reset-chart-of-accounts.sql:415-416`.
- Seeded as **class `Expense`, `Other Expense`, under `other-expenses`**: account `7030` "Customer Payment Discounts" — `functions/lib/seed.data.ts:763`; `reset-chart-of-accounts.sql:278`. Default mapping `customerPaymentDiscountAccount → "7030"` at `seed.data.ts:794`.
- Posted at **payment time** as `DR expense`: `post-payment/build-payment-journal.ts:235-248` (`pushLine(cashIn ? "debit" : "credit", "expense", ...)`); account selected at `post-payment/index.ts:421-431`. Entry: `DR Bank (net) + DR Customer Payment Discount (expense) + CR AR (gross)`.
- **Divergence**: the contra-revenue `salesDiscountAccount` (`4020`, under revenue) is what the customer **credit-memo** path uses — `post-memo/index.ts:241-250`. `customerPaymentDiscountAccount` is not referenced in `post-memo`.
- Symmetric `supplierPaymentDiscountAccount` (`7020`) also seeded `Expense`/`Other Expense`; `post-payment` credits it (reduces cost); also used as the supplier memo reason account in `post-memo`.
- Exposed to accounting integrations: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx:773,782,807-808`.
