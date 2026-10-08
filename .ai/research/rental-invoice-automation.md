# Research: automatic posting and sending of recurring rental invoices

Date: 2026-10-02
Question: Carbon's `rental-billing` cron (05:00) drafts one Draft sales invoice per agreement for due periods and charges, and a person must post and email each one. How do best-in-class ERPs and billing systems automate the last two steps safely?

## Findings by system

- **NetSuite.** Billing Operations / bill-run schedules choose which invoices to create, for which customers, and when. The schedule's Communication section has To Be Emailed set to Yes / No / *Respect Customer Preference*, which reads the customer's "Send Transactions Via". Invoice approval is exception-based: the invoice approval workflow routes only questionable invoices to Pending Approval. The triggers are a customer's first invoice, a credit hold, mismatched terms, the tax amount, or a flagged customer. Everything else goes through without review. Charge-based billing gives each charge a stage of Ready, Hold or Non-Billable, and only Ready charges are invoiced. Run status is shown under Process Billing Operations > Status.
- **SAP S/4HANA.** Rental and service contracts use periodic billing plans. The billing due list (VF04/SDBILLDL) runs as a scheduled background job, posts each billing document to FI, and triggers output (email) through output determination. There are two holds. A *billing block* stops a billing-plan date from being billed. A *posting block* (set on the billing type or the payer master) creates the document but keeps it out of accounting until someone releases it in VFX3. Failures go to the billing log and the output monitor, and the rest of the run continues.
- **Business Central.** Base BC handles this in steps: the Create Recurring Sales Invoices job, then Batch Post Sales Invoices (Report 297) on the job queue, with email sent through the customer's Document Sending Profile. The Subscription Billing app sets automation on each *billing template*. Microsoft describes three tiers: fully automated (post), partially automated (create, then review), and manual (proposal only). If any line errors, the whole document is discarded and logged to a Contract Billing Error Log, and the batch carries on. A document that fails background posting gets Job Queue Status = Error. Microsoft warns that you need tight filters, or the batch posts documents that aren't ready. **D365 Finance** recurring contract billing has a Generate invoice batch with posting options: create a sales order, create a free-text invoice, or *post automatically*.
- **Odoo Subscriptions.** A scheduled action creates **and posts** the invoice on the next-invoice date. Odoo has no draft option. If a payment token exists it charges the card first and posts only on success. On failure it sends reminders and closes the subscription after the "Automatic Closing" days (default 14). An uncertain payment marks the contract "in exception", and exception contracts are skipped by every scheduled action so nobody is charged twice.
- **Xero repeating invoices.** Each template has one of three modes: *Save as Draft*, *Approve*, or *Approve for sending*. Xero's guidance is to use Draft when amounts vary or tracked inventory is involved. If the template's owner is deleted, the template silently drops back to Draft. Invoices are generated early on the scheduled day in the organisation's timezone, and sending needs a valid contact email.
- **QuickBooks Online.** Recurring templates are *Scheduled* (finalized when created, with optional auto-send), *Reminder* (saved as a draft for review), or *Unscheduled*. There is a per-template "Automatically send emails" option and a "create N days in advance" option.
- **Stripe Billing.** Subscription invoices start as drafts. With `auto_advance`, `charge_automatically` invoices finalize immediately and `send_invoice` invoices finalize after about **1 hour**, which is the window for adding or editing lines. If the `invoice.created` webhook doesn't respond successfully, finalization waits up to 72 hours. `invoice.finalization_failed` is raised for cases such as a tax location error, with `last_finalization_error`, and the subscription stays active. The `invoice.upcoming` event fires N days ahead so extra items can be added.
- **Chargebee.** With usage billing, renewal invoices are created as **Pending**. Usage and one-off charges can be added until the invoice is closed and posted. Auto-close is a site setting with a wait period, and it can be overridden per customer ("Do not auto-close") or per subscription (`auto_close_invoices=false`). **Recurly** creates and emails invoices fully automatically with no approval step, with automatic or manual collection (net terms) per account.
- **Rental-specific systems.**
  - Point of Rental puts contracts on hold ("Hold for Count", holding the meter when the unit is called off rent) "to prevent an invoice from being generated prematurely".
  - Wynne RentalMan cycle-bills on many schedules but shows a review-of-charges screen at return, where meter and damage charges are entered, before it writes the invoice.
  - Equipment-rental tools generally offer a pre-billing invoice preview, and they calculate meter overages from out and in readings.
  - Booqable still lists interval billing as a roadmap item.

## Synthesis

**Common pattern:**
1. Automation is configured as a company default, overridden per contract or customer: NetSuite customer preference, Chargebee customer and subscription, Xero and QBO per template.
2. Automation comes in three tiers: draft, post, and post-and-send.
3. A short window between draft and final (Stripe's 1 hour, Chargebee's wait period, QBO's days in advance) lets late charges land.
4. Anything not ready is held at the charge or document level rather than skipped silently.
5. Failures are handled per document: the invoice falls back to draft or an exception list, the batch continues, and the result is logged.
6. Approval works by exception, not on every invoice.

**Options for Carbon:**
- Add an `invoiceAutomation` setting with values **Draft only / Post / Post and send**. Put the default on `companySettings`, an override on the customer, and an override on the rental agreement, where the agreement wins. Default to Draft only so current behaviour is preserved.
- Add a **review window** (`autoPostAfterHours`, default about 24h). The cron drafts at 05:00, and a second pass posts drafts older than the window that are still untouched. Show "Will post at …" on the draft. Any human edit pins the invoice to manual.
- Set an **email destination**: the agreement's contact, else the customer's invoice contact. If neither has an email, post but don't send, and raise an exception. This mirrors NetSuite's customer-preference fallback.
- Add an **exceptions queue**, backed by an invoice flag plus a notification to the agreement owner. An invoice lands there instead of posting when:
  - it is the agreement's first invoice;
  - it contains manual `Charge` lines (damage or meter);
  - it has a negative `isAdjustment` early-return credit or a Purchase Option line;
  - the posting date falls in a closed or locked period;
  - its total moves more than X% from the prior invoice;
  - tax or currency validation fails;
  - the customer is on credit hold.
- Add a **hold** at two levels: an agreement-level "Billing hold" (SAP billing block, Point of Rental hold), and a charge-level Ready/Hold stage (NetSuite) so a meter reading still waiting for entry doesn't block rent.

**Safeguards:**
- Post each invoice in its own transaction: one failure must not abort the run (BC, SAP).
- Make the run idempotent: retries must not double-post or double-send (Odoo's exception flag).
- Log every automated post and send in the audit log as `system`, with the rule that fired.
- Show a daily digest of what was posted, sent and held.

**Pitfalls seen in the field:**
- Loose batch filters post documents that weren't ready (BC's own warning).
- Automation silently reverts to draft and nobody notices (Xero's deleted owner).
- Posting dates land in closed periods.
- Email fails after posting and the customer never receives the invoice. Track send status separately from posting status.
- Variable rental charges arrive after the cycle invoice has gone out, which leads to credit memos and disputes.

## Sources

- NetSuite: [bill run schedules](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4067346356.html), [invoice approval workflow](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4171524249.html), [charge stages](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1214120416.html)
- SAP: [billing plans](https://learning.sap.com/courses/configuring-billing-in-sap-s-4hana-sales/setting-up-billing-plans), [billing in background](https://learning.sap.com/learning-journeys/configuring-billing-in-sap-s-4hana-sales/creating-billing-documents-in-various-ways), [posting block / VFX3](https://community.sap.com/t5/enterprise-resource-planning-q-a/posting-block-in-billing-document/qaq-p/6146197)
- Business Central: [billing automation](https://learn.microsoft.com/en-us/dynamics365/business-central/srb/billing-automation), [batch posting](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-batch-posting), [recurring invoicing](https://learn.microsoft.com/en-us/dynamics365/business-central/finance-recurring-invoicing)
- D365 Finance: [generate invoice](https://learn.microsoft.com/en-us/dynamics365/finance/accounts-receivable/sb-generate-invoice)
- [Odoo scheduled actions](https://www.odoo.com/documentation/18.0/applications/sales/subscriptions/scheduled_actions.html)
- Xero: [three modes](https://gocardless.com/guides/posts/recurring-invoice-xero), [owner reverts to draft](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/45249241-repeating-invoices-don-t-revert-to-draft-when-th)
- [QuickBooks Online recurring transactions](https://quickbooks.intuit.com/learn-support/en-us/help-article/recurring-transactions/create-recurring-transactions-quickbooks-online/L3WoKX2R8_US_en_US)
- Stripe: [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [auto-advance](https://docs.stripe.com/invoicing/integration/automatic-advancement-collection)
- Chargebee: [invoice operations](https://www.chargebee.com/docs/2.0/invoice-operations.html), [subscriptions API](https://apidocs.chargebee.com/docs/api/subscriptions)
- [Recurly invoice settings](https://docs.recurly.com/recurly-subscriptions/docs/invoice-settings)
- Rental systems: [Point of Rental Hold for Count](https://help.point-of-rental.com/2020/Content/Hold%20for%20Count.htm), [Wynne return review](https://support.wynnesystems.com/help/rm/ENU/Content/RARINT80.htm), [Booqable interval billing](https://portal.productboard.com/booqable/1-booqable-roadmap/c/216-interval-billing)
