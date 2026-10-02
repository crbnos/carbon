# Subscription / Recurring Invoicing Research: Best Practices Survey

## Summary

How ERPs and billing point solutions model recurring customer invoicing for SaaS
subscriptions and recurring service contracts, to ground a minimal v1 Carbon
subscription document that reuses the rental agreement billing machinery
(persisted billing periods, a daily job that drafts invoices, advance / arrears,
deferred revenue released by the recognition run). The field splits in two:
**template copiers** (Xero repeating invoices, QuickBooks recurring transactions,
Business Central's Recurring Sales Lines, NetSuite memorized transactions) that
clone an invoice on a schedule with no periods, proration or lifecycle; and
**subscription models** (NetSuite SuiteBilling, SAP Subscription Billing and SD
billing plans, BC Subscription Billing, D365 F&O billing schedules, Acumatica
contracts, Odoo Subscriptions, Stripe, Chargebee, Maxio) built from a header +
lines, a frequency, persisted periods/charges, day-based proration, advance vs
arrears, scheduled invoice runs, change/renewal/termination events, and revenue
recognition kept separate from billing. Carbon's rental machinery is already the
second kind; a subscription document is the same engine without the fleet unit.

## Competitors Surveyed

- **SAP S/4HANA** (SD periodic billing plans on service contracts; SAP Subscription Billing; RAR) — enterprise reference.
- **Oracle NetSuite** (SuiteBilling subscriptions; billing schedules; memorized transactions; ARM) — the mid-market accounting reference.
- **Microsoft Dynamics 365 Business Central** (Recurring Sales Lines; Subscription Billing app) and **D365 Finance & Operations** (Subscription billing module) — closest ERP peers for a manufacturer.
- **Acumatica** (Contract Management) — mid-market manufacturing ERP.
- **Odoo** (Subscriptions app) — the open-source ERP with a subscription-as-sales-order model.
- **Xero** (repeating invoices), **QuickBooks Online** (recurring transactions) — what customers migrating from small-business accounting are used to.
- **Stripe Billing**, **Chargebee**, **Maxio** — subscription point solutions; set the vocabulary.

## Key Consensus Patterns

### 1. A header + lines, not an invoice template
- **SAP**: SSB subscription → items (product + rate plan, recurring/usage/one-time charges); SD contract item → billing plan.
- **NetSuite**: Subscription (customer, billing account, plan, term, start/end) → Subscription Lines (item, quantity, billing mode, price intervals).
- **BC / F&O / Acumatica / Odoo**: Customer Subscription Contract → contract lines; Billing schedule → lines; Customer Contract → contract items; recurring sales order → order lines.
- **Stripe / Chargebee / Maxio**: Subscription → subscription items / add-ons / components.
- **Rationale**: one contract bills several services for one customer on one rhythm; changes, renewals and termination act on the contract.

### 2. Persisted periods (charges) drive invoicing
- **SAP**: SD billing plan date rows (FPLT); SSB rating builds "bills".
- **NetSuite**: rating persists **charges** per line and period; the bill run invoices due charges.
- **F&O**: billing detail lines, one per period. **BC**: Next Billing Date advances per billing proposal.
- **Rationale**: idempotent re-runs, an auditable schedule, and a place to put proration and credits. Carbon's `rentalBillingPeriod` is the same idea.

### 3. Anniversary by default, calendar alignment optional, day-based proration
- **SAP SSB**: calendar- or anniversary-based alignment per subscription; "Prorate First Cycle" by active days. SD: anniversary rules plus "by calendar" rules.
- **NetSuite**: anniversary or fixed bill date; Prorate By Day default.
- **BC**: anniversary, Harmonized Billing to a base date; daily proration. **F&O**: Align to month; daily or monthly proration.
- **Odoo**: anniversary; "Align to Period Start" prorates the first invoice. **Stripe/Chargebee/Maxio**: anniversary default, calendar anchor optional, proration by second/day.
- **Rationale**: anniversary needs no first-period proration; calendar alignment is a common request (all customers invoiced on the 1st) and costs one prorated stub period.

### 4. Advance for recurring, arrears for usage
- **NetSuite**: billing mode In Advance / In Arrears per line; usage always arrears.
- **SAP SSB**: "Billing in Advance" per rate plan; usage in arrears.
- **Stripe / Chargebee / Maxio**: licensed/recurring prepaid, metered postpaid.
- **Odoo**: advance only. **Xero/QBO**: no concept (date placeholders).
- **Rationale**: SaaS seats and service retainers are billed ahead; consumption is billed after measurement.

### 5. A scheduled run creates invoices; posting and sending are configurable
- **NetSuite**: scheduled rating → credit memo → bill runs; invoices are posted; delivery by email/print.
- **SAP**: billing due list / background job; SSB bills feed downstream invoicing.
- **BC**: billing proposal → create documents (drafts, optional post). **F&O**: generate invoice batch, create order only / show posting / post automatically.
- **Odoo**: scheduled action posts and emails (or charges a saved card). **Xero**: per template Save as Draft / Approve / Approve for sending. **QBO**: scheduled vs reminder vs unscheduled; Intuit now saves recurring invoices as drafts for review.
- **Stripe**: draft ~1 hour then finalize and send/charge; `auto_advance=false` holds for review.
- **Rationale**: every product offers "create draft for review"; the auto-send option exists where trust in the amounts is high (fixed-fee recurring).

### 6. Grouping: per contract by default, consolidation per customer optional
- **NetSuite**: one invoice per billing account per period (several subscriptions share it).
- **BC**: documents per contract, per contract partner, or per invoice recipient. **F&O**: consolidate by customer/item. **Chargebee**: consolidated invoicing per customer per day; **Maxio**: subscription groups.
- **Stripe / Odoo / Acumatica / Xero / QBO**: one invoice per subscription/template.

### 7. Changes, renewals and termination are events on the contract
- **NetSuite**: change orders (activate, suspend, modify pricing, renew, terminate); mid-period changes prorated; renewal extend or new; uplift % on renewal.
- **BC**: planned subscription lines for future changes; price update templates (%, recent item price) applied at period boundaries only; notice period / cancellation possible until.
- **F&O**: escalation lines (%, amount, CPI); termination with credit options (issue credit, credit adjustment, none).
- **Stripe / Chargebee**: proration credits and charges, immediate or at end of term; cancel at period end; contract terms (renew / evergreen / cancel).
- **Odoo**: upsell quotations prorated to the rest of the period; renewal quotations; close reasons.
- **Rationale**: price/quantity changes are dated and never rewrite a billed period; a billed-in-advance period that is cut short yields a credit.

### 8. Revenue recognition is separate from billing, ratable by day
- **SAP RAR**: time-based POBs, linear day-specific deferral; contract asset / liability by comparing recognized vs invoiced.
- **NetSuite ARM**: revenue elements from subscription lines, straight-line by period / exact days; deferred revenue waterfall.
- **BC**: contract deferrals released monthly with daily proration. **F&O**: deferral schedules tied to billing schedules.
- **Stripe / Chargebee / Maxio**: daily ratable recognition over the line's service period.
- **Odoo / QBO Advanced**: deferral from invoice line start/end dates. **Xero**: none native.
- **Rationale**: an invoice line carrying its service period is the input every recognizer needs — Carbon's Service-line deferral already does exactly this.

## Answers to Research Questions

1. **Entities, lifecycle, terminology** — Header + lines everywhere serious. Statuses converge on Draft → Active → (Suspended/Paused) → Cancelled/Terminated / Expired (NetSuite: Draft, Pending Activation, Active, Suspended, Terminated; Acumatica: Draft, Pending Activation, Active, Expired, Canceled; Chargebee adds Non-Renewing). "Subscription" + "subscription line" is the most widely shared vocabulary (NetSuite, BC, Stripe, Chargebee, Maxio, Odoo); "contract" is used by BC/Acumatica/SAP SD for the commercial agreement.
2. **Period alignment, proration, advance/arrears** — Anniversary default, calendar alignment optional (all except Xero/QBO); daily proration of partial periods (NetSuite default Prorate By Day; BC; Stripe/Chargebee seconds/days; SAP SSB active days); advance for recurring, arrears for usage (NetSuite, SAP SSB, Stripe, Chargebee, Maxio).
3. **Automation and delivery** — A scheduled run everywhere. Draft-for-review is universally available (BC, F&O, Xero, QBO, Stripe `auto_advance=false`); auto-post and auto-send are options (Xero "Approve for sending", Odoo, F&O post automatically, NetSuite posted invoices). Delivery is email with a hosted payment link where a payment provider is connected (Stripe, Chargebee Pay Now, Xero with Stripe, Odoo portal). Grouping: per subscription by default; per customer consolidation in NetSuite (billing account), BC, F&O, Chargebee, Maxio.
4. **Changes, renewals, escalation** — Dated change events, prorated mid-period (NetSuite change orders, Stripe proration, Odoo upsell, BC planned lines); price escalation as a % uplift at renewal or on a schedule (NetSuite Uplift, F&O escalation, BC price update templates); renewal = extend the same subscription (NetSuite Extend, BC subsequent term, Chargebee evergreen) or create a new one.
5. **Cancellation** — End of term (Stripe `cancel_at_period_end`, Chargebee non_renewing, SAP SSB "Canceled" = expires at next possible date) or immediate with an optional prorated credit for unused prepaid time (NetSuite credit memo run, F&O issue credit / credit adjustment, Chargebee credit options). Notice periods in BC and SAP SD.
6. **Revenue recognition and usage** — Ratable daily recognition over each invoice line's service period, separate from billing (all ERPs + Stripe/Chargebee/Maxio RevRec). Usage is billed in arrears from imported meter data (BC usage-based billing, F&O usage items, NetSuite usage lines, Stripe meters, Chargebee pending invoices) — always a separate, later layer.

## Competitor-Specific Details

### SAP
SD periodic billing plans on service contracts: settlement period rules (monthly … yearly), billing date rules ("on settlement start date"), "by calendar" alignment rules, horizon rule rolls dates forward for open-ended contracts; billing due list mass-creates invoices. SAP Subscription Billing: subscription statuses include Canceled (= scheduled to expire, reversible) and Withdrawn; bills are a preview, invoicing happens downstream; billing profile can split bills by subscription. RAR: linear day-specific deferral, contract liability / asset by comparing recognized vs invoiced.

### NetSuite
SuiteBilling: Billing Account sets cadence and groups subscriptions onto one invoice; Subscription Plan + Price Book templates; Subscription Lines with billing mode In Advance / In Arrears, prorate start/end flags; charges rated per line and period; change orders for every lifecycle event (Terminate effective end of day); credit memo run turns negative charges into credit memos; renewal extend vs new, uplift pricing. Without SuiteBilling: billing schedules on sales orders, memorized transactions (Template Only / Reminder / Automatic).

### Microsoft Dynamics 365 Business Central / F&O
BC Subscription Billing: Subscription (created on shipment), Subscription Lines with Billing Base Period (price period) vs Billing Rhythm (invoice frequency), Initial / Subsequent Term, Notice Period, Price Binding Period; Harmonized Billing aligns to a contract base date; billing proposal → documents per contract / partner / recipient; contract deferrals released monthly. F&O: billing schedule statuses Active / On hold / Last billing / Terminated / Archived; frequencies daily → annually × interval; escalation lines (%, amount, CPI); termination types Adjust schedule / Bill remaining / No adjustment with credit options.

### Acumatica
Contract templates (Renewable / Expiring / Unlimited), setup vs activation dates, billing period Week → Year / Statement-Based / On Demand, Run Contract Billing creates one invoice per contract, upgrades via Pending Upgrade with prorated invoice on activation, grace-period renewals.

### Odoo
Subscription = sales order with a Recurring Plan (billing period weeks/months/years, automatic closing, align to period start); statuses Quotation, In Progress, Paused, Renewed, Churned; scheduled action posts and emails (or charges a saved card) — no draft-only switch, advance only; upsell quotations prorated for Service products; renewal quotations; close reasons.

### Xero / QuickBooks Online
Template copiers. Xero: weekly or monthly × n, Save as Draft / Approve / Approve for sending, period placeholders in descriptions, Pay Now link via Stripe/GoCardless/PayPal; no proration, renewal or deferral. QBO: Scheduled / Reminder / Unscheduled templates, auto-send checkbox (Intuit's current help says recurring invoices are saved as drafts for review), autopay; revenue recognition only in QBO Advanced.

### Stripe Billing / Chargebee / Maxio
Stripe: anniversary `billing_cycle_anchor`, calendar via anchor config, proration to the second, `proration_behavior`, draft invoice ~1 hour then finalize, `collection_method` charge automatically vs send invoice (hosted invoice + payment link), `cancel_at_period_end`, subscription schedules for future price phases, one invoice per subscription. Chargebee: statuses future / in_trial / active / non_renewing / paused / cancelled, calendar billing with immediate or delayed alignment, consolidated invoicing, contract terms (renew / evergreen / cancel / renew_once), grandfathered prices, cancel credit options none / prorate / full. Maxio: snap-day calendar billing, first period prorated / immediate / delayed, subscription groups for consolidation, delayed product changes.

## Recommended Approach for Carbon

1. **A `subscription` header + `subscriptionLine` lines in the sales module** (NetSuite / BC / Stripe vocabulary), each line a Service item with its own quantity, rate frequency and rate — reusing the rental line's `rateUnit` + `rate` shape just landed for rentals.
2. **Persist billing periods per line and reuse `generateRentalBillingPeriods`** (NetSuite charges, SAP billing plan dates, F&O billing details). Its generic core already cuts Calendar Month periods, rolls open-ended agreements to a horizon, and is idempotent by `periodStart`.
3. **Billing alignment**: Calendar Month (prorated stub) as the v1 default, with anniversary as the question to settle — every competitor defaults to anniversary, but Carbon's engine today only has Calendar Month and 28 Days.
4. **Advance by default, arrears available** (NetSuite billing mode) — the existing `billingTiming`.
5. **The daily job drafts invoices** (BC proposals, Xero Save as Draft, Stripe `auto_advance=false`), one per subscription per run (Stripe, Odoo, Acumatica), with per-customer consolidation deferred. Auto-post + auto-send (Xero "Approve for sending", Odoo) is an opt-in per subscription — the open question is whether v1 needs it, since Carbon posting today is human-only and Stripe needs a confirmed customer link.
6. **Invoice lines are Service lines carrying service dates**, so the existing Service-line deferral + revenue recognition run recognizes them ratably (all ERPs separate billing from recognition) — no new posting code.
7. **Changes and termination as dated events** (NetSuite change orders): v1 = end date / cancel at period end and price or quantity changes from a date forward (never rewriting a billed period); prorated mid-period changes, renewal uplift and usage billing are later layers (every competitor ships them, none is needed to replace Xero/QBO repeating invoices).

## Sources

- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_161460541562.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_1520456234.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4779334000.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156027198593.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1546981374.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158336795731.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1252880.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1251398.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4063198073.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4074439569.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1547760916.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_1547761140.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1547760511.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1533081222.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4356113783.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_4744857571.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N564637.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_158922715446.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/7b24a64d9d0941bda1afa753263d9e39/ba6fb6535fe6b74ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/7b24a64d9d0941bda1afa753263d9e39/0f22bf53d25ab64ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/7b24a64d9d0941bda1afa753263d9e39/1722bf53d25ab64ce10000000a174cb4.html
- https://help.sap.com/docs/subscription-billing/feature-overview/rating
- https://help.sap.com/docs/subscription-billing/feature-overview/billing-profiles
- https://help.sap.com/docs/subscription-billing/feature-overview/billing
- https://help.sap.com/doc/fe166d6e77b547b5af0b9e2eb063dfab/1.1.8/en-US/loio2370015342d8a62fe10000000a4450e5.pdf
- https://learning.sap.com/courses/applying-sap-subscription-billing/managing-the-subscription-lifecycle_aec1b08e-457e-436e-aab7-eeef89232118
- https://sapinsider.org/manage-rental-contracts-with-help-from-sales-and-distribution-functionality/
- https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-work-standard-lines
- https://learn.microsoft.com/en-ca/dynamics365/business-central/finance-recurring-invoicing
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/masterdata/service-commitments
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/recurring-billing
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/working-with-contracts/customer-contracts
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/working-with-contracts/period-calculation
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/working-with-contracts/service-commitment-cancellation
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/working-with-contracts/contract-renewal
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/working-with-contracts/price-update
- https://learn.microsoft.com/en-us/dynamics365/business-central/srb/working-with-contracts/contract-deferrals
- https://learn.microsoft.com/en-us/dynamics365/business-central/ubb/welcome
- https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/sb-billing-schedules
- https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/sb-generate-invoice
- https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/terminate-billing-schedule
- https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/sb-deferrals
- https://help.acumatica.com/Wiki/ShowWiki.aspx?wikiname=HelpRoot_ContractManagement&PageID=6903de70-0d3b-4e9c-a88d-b2a24d65aa7f
- https://help.acumatica.com/Wiki/ShowWiki.aspx?wikiname=HelpRoot_ContractManagement&PageID=074dee15-6191-4760-98d1-f41a307b1d4b
- https://www.odoo.com/documentation/18.0/applications/sales/subscriptions.html
- https://www.odoo.com/documentation/18.0/applications/sales/subscriptions/upselling.html
- https://www.odoo.com/documentation/18.0/applications/sales/subscriptions/closing.html
- https://www.odoo.com/documentation/18.0/applications/sales/subscriptions/renewals.html
- https://www.odoo.com/documentation/18.0/applications/sales/subscriptions/scheduled_actions.html
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/deferred_revenues.html
- https://developer.xero.com/documentation/api/accounting/repeatinginvoices/
- https://jacrox.co/xero-repeating-invoices/
- https://quickbooks.intuit.com/learn-support/en-us/help-article/recurring-transactions/create-recurring-transactions-quickbooks-online/L3WoKX2R8_US_en_US
- https://quickbooks.intuit.com/learn-support/en-us/help-article/invoicing/set-autopay-recurring-invoices-quickbooks-online/L4R4t6gVS_US_en_US
- https://quickbooks.intuit.com/learn-support/en-us/help-article/custom-templates/turn-revenue-recognition-quickbooks-online/L1BM5CqYO_US_en_US
- https://docs.stripe.com/billing/subscriptions/overview
- https://docs.stripe.com/billing/subscriptions/billing-cycle
- https://docs.stripe.com/billing/subscriptions/prorations
- https://docs.stripe.com/billing/subscriptions/cancel
- https://docs.stripe.com/billing/invoices/subscription
- https://docs.stripe.com/billing/subscriptions/subscription-schedules
- https://docs.stripe.com/revenue-recognition/methodology/subscriptions-and-invoicing
- https://www.chargebee.com/docs/billing/2.0/subscriptions/subscriptions
- https://www.chargebee.com/docs/billing/2.0/subscriptions/proration
- https://www.chargebee.com/docs/billing/2.0/subscriptions/calendar-billing
- https://www.chargebee.com/docs/billing/2.0/subscriptions/contract-terms
- https://www.chargebee.com/docs/revrec/revenue-recognition/ratable-revenue-recognition
- https://docs.maxio.com/hc/en-us/articles/24251512792461-Calendar-Billing
- https://docs.maxio.com/hc/en-us/articles/24252069837581-Product-Changes-and-Migrations
- https://docs.maxio.com/hc/en-us/articles/24252287829645-How-Invoices-are-Generated
