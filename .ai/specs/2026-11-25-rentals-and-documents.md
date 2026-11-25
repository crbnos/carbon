# Rentals and documents fixes

> Status: implemented
> Date: 2026-11-25
> Branch: `fix/rentals-and-documents`
> Research: `.ai/research/2026-11-25-rentals-and-documents-code-map.md`

## TL;DR

- A user can invoice a rental agreement early: the next N whole billing periods, as one Draft invoice.
- A new "Manual" invoicing choice on a rental agreement stops the daily run from creating invoices for it.
- The Rental Site stays editable on an Active agreement, like payment terms and tax.
- The Won step starts "Send Via" on the choice made at Finalize. The sales order Confirm dialog starts on None. Both warn before an email.
- The sales order PDF gets a Ship To block. Template samples print every section a template can print.
- The service contract Review step shows tax.

## Problem

1. A rental invoice exists only when its period is due. A user cannot check or edit it earlier. A user cannot bill the whole term, or 2 months at a time, in one invoice.
2. The daily run always creates invoices for due periods. A user who bills by hand gets extra one-month invoices.
3. Activation locks the Rental Site. A user who missed it at setup cannot fix the ship-to of later invoices.
4. The Won step starts "Send Via" on Email. A user who picked None at Finalize still emailed the sales order to the customer.
5. The sales order PDF has no Ship To block, and the drop-ship location never prints.
6. Template samples leave out data, so the template editor never shows the sections that need that data. Example: the invoice Ship To.
7. The service contract Review step shows amounts with no tax.

## Goals

1. Invoice the next N whole periods of an Active rental agreement from the Invoice button.
2. Add a "Manual" invoicing choice on the rental agreement that the daily run skips.
3. Let a user change the Rental Site on an Active agreement.
4. Start "Send Via" in the Won step on the choice made at Finalize, and in the sales order Confirm dialog on None. Show a warning line for Email.
5. Add a Ship To block to the sales order template.
6. Fill every template sample so each section a template can print shows in the editor.
7. Show tax on the service contract Review step.

## Non-goals

- An invoice for a free amount or a part of a period. Billing stays per whole period.
- A "PAID" mark on the invoice PDF. A prepaid customer uses a deposit that the user applies to each invoice.
- A quote that converts to a rental agreement.
- A Ship To on the quote PDF. The quote has no ship-to separate from its customer location.
- A snapshot of the Rental Site on each delivery shipment.

## Design

### 1. Invoice a rental agreement early

**UI.** The Invoice button on an Active agreement opens a dialog. Sibling: the Next Invoice card (`RentalNextInvoice.tsx`).

1. The dialog shows "Invoice the next [N] periods". N starts at 1. If no Pending period is left and a charge is due, N starts at 0, and the invoice bills the due charges alone.
2. A fixed-term agreement has an "All remaining" shortcut. It sets N to the count of Pending periods.
3. An open-ended agreement allows N up to 12. It has no "All remaining".
4. The dialog lists the periods and the total (subtotal, tax, total) before the user confirms.
5. Confirm creates one Draft invoice and opens it.

**Server.** A new service function in `sales.server.ts` bills the next N periods. It reuses the drafting path in `sales.service.ts`.

1. Lock the agreement `FOR UPDATE`.
2. For an open-ended line, cut periods until N Pending periods exist past the billed ones. Use `generateRentalBillingPeriods` with a later `through`.
3. Take the first N Pending non-adjustment periods of every line, in `periodStart` order. A Returned line that still owes a period adds what it has. N = 0 takes no period.
4. Take the unbilled charges with `chargeDate <= today`.
5. Plan the invoice with the Draft Only plan: one combined invoice. Hold it with `RENTAL_HOLD_EARLY_INVOICE`, so the daily automation never posts it, whoever drafted it.
6. Insert the invoice with `dateIssued = today`. Stamp each period `Invoiced` and its `salesInvoiceLineId`.
7. Do not fire `invoice-automate`. The invoice stays Draft.

**Rules.**

- The server takes N = 0 only when no Pending period is left and at least one charge is due (`chargeDate <= today`). Otherwise N >= 1.
- The server refuses N above the Pending count of a fixed term, and N > 12 on an open-ended agreement. The fixed-term limit is the periods left, not 12: a user can bill a long term in full.
- The early invoice also drafts the due early-return credits on their own credit memo, as the daily run does.
- Carbon bills a period once. The daily run reads only Pending periods (`selectDueRentalRows`).
- Posting defers revenue for a period billed early (`planRentalLine`). No posting change.
- Deleting the Draft invoice returns its periods to Pending (`releaseRecurringInvoiceStamps`).

### 2. "Manual" invoicing choice

1. Add the value `Manual` to the `invoiceAutomation` enum (new migration).
2. Only the rental agreement's own Invoicing select offers "Manual" (`rentalAgreement.invoiceAutomation`). The tooltip says: "The daily run only bills units treated as a sale. Use Invoice to bill the other periods yourself."
3. The company setting does not offer Manual, and its validator refuses it (`settings.models.ts:52` keeps 4 values). Contracts never offer it (a contract list without Manual). So no agreement and no contract inherits Manual.
4. In the daily run, `createRentalInvoicesForDuePeriods` drafts no invoice for an agreement whose choice is `Manual`. It still cuts the agreement's periods and drafts its early-return credit memo, which stays Draft in every mode.
5. A run for one agreement (Sell to Customer) still drafts its invoice.
6. The Invoice dialog works for a Manual agreement.
7. `planRentalInvoices` treats `Manual` like Draft Only. Invoice automation never posts or sends an invoice of a Manual agreement (`sellRentalUnit`, `invoice-automate`, `findInvoicesToAutomate`).
8. Add the value to the agreement list (`sales.models.ts:1544`), the agreement label maps and `useInvoiceAutomationHint`.

### 3. Rental Site on an Active agreement

1. Add `customerLocationId` to `rentalActiveTerms` (`sales.server.ts`).
2. Let `updateRentalAgreementInvoiceTerms` write `customerLocationId`.
3. Refuse a location that does not belong to the agreement's customer. Apply this check to Draft and Active.
4. Make the Rental Site select editable while Active (`RentalAgreementProperties.tsx`), with "Bills and ships invoices drafted from now on". The site is each later invoice's bill-to and ship-to.
5. A change reaches only invoices drafted later. A reprint of a Delivery Ticket shows the new site.

### 4. "Send Via" in the Won step and the Confirm dialog

1. Finalize saves the "Send Via" the user picked in `quote.sendViaEmail` (migration `20261125121101_quote-send-via-email.sql`): Email is true, None is false.
2. If the email integration is off, the Finalize dialog has no "Send Via" select. Then Finalize leaves `sendViaEmail` as it is.
3. `QuoteToOrderDrawer.tsx`: the default and the `NotificationOptionsForm` state start on Email when `sendViaEmail` is true and the email integration is on. Otherwise they start on None.
4. `SalesOrderHeader.tsx` Confirm dialog: the default starts on None.
5. When the user picks Email, both dialogs show: "This will email the sales order to {contact}."
6. The Finalize dialog keeps its own default.

### 5. Ship To on the sales order template

1. Add `shipTo` heading and address texts to `template/texts/salesOrder.ts` (`addressTexts("shipTo")`).
2. Add `shipTo.*` merge fields and `addressVars("shipTo", …)` in `pdf/blocks/salesOrder/vars.ts`.
3. The ship-to address is the drop-ship location when Drop Shipment is on. An order that does not drop-ship has no ship-to address: the Customer block already prints the order's location. A drop shipment with no location has none either, never the header's location.
4. The `salesOrderLocations` view gains the ship-to address columns (`shipTo*`). The sales order PDF loader (`sales.pdf.tsx`) reads the whole view, so every renderer gets them: the PDF route, the Edit document preview and the email.
5. `PartiesBlock` prints Ship To when the order has a ship-to address, so only for a drop shipment. The "Customer" block does not change.
6. A user hides either block in the template. The PDF has no logic that hides one because of the other.

### 6. Template samples

1. Fill each sample in `packages/documents/src/pdf/*.samples.ts` and `samples.ts` with the data that its sections need. Use the list in the "prints every text … it reaches" snapshot (`preview-documents.test.ts.snap`).
2. Add the new sales order Ship To to the sales order sample.
3. Update the snapshots. The sections that no sample printed before now print.
4. An alternate title, "None" for empty notes and a job type each print only instead of another text. The test renders each document with its sample and with extra props. Where three or more texts exclude each other, the test may need a third render variant.

### 7. Tax on the service contract Review step

1. `ContractSummary` shows the tax % of each line on the next invoice. A line that is not on the next invoice shows no tax %.
2. The summary shows "Tax" and "Next invoice total" ("Next billing event total" on a project contract) for the next invoice.
3. The tax comes from the line's tax code, at its charged rate on the day the run drafts the invoice (0 for Reverse Charge), else from `customerContractLine.taxPercent`. This is the drafting's own rule (`contractLineRate`).
4. `ContractSummary` also renders on the contract page, so the tax shows there too.
5. If the tax codes cannot be read, the page and the Confirm dialog show the amounts before tax, with "Amounts exclude tax." They do not fail.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| What an early invoice bills | The next N whole periods | Billing stays per period, so the daily run, the agreement figures and early-return credits stay correct |
| Automation of an early invoice | Always Draft | The user invoices early to check and edit the invoice |
| How the user picks periods | A count N, plus "All remaining" | No gaps between billed periods, so early-return credits stay simple |
| Open-ended limit | 12 periods | Covers a prepaid year and bounds early-return credits |
| Stop the daily run | New `Manual` enum value | Draft Only still creates drafts for due periods |
| Where Manual is offered | The rental agreement's own Invoicing select only | The company setting also drives contracts. Keeping Manual off it means no contract or agreement inherits it |
| Manual and the daily run's other work | It still cuts periods and drafts early-return credit memos | A credit memo stays Draft in every mode, and cut periods keep the Next Invoice card and the dialog correct |
| Due charges with no period left | The dialog allows N = 0 then, and bills the due charges alone | Otherwise nothing bills those charges on a Manual agreement |
| Which lines an early invoice bills | Every line, a Returned line included | A Returned line can still owe a period that was re-cut at the return |
| Fixed-term limit | The Pending periods left | A user can bill a long term in full; the limit of 12 is for open-ended agreements |
| Rental Site after activation | Editable, for invoices drafted later | Each invoice copies the site when it is drafted, like payment terms |
| Delivery Ticket reprint | Shows the new site | Changes are rare. A snapshot needs a schema change |
| Send Via default in the Won step | The choice made at Finalize, with a warning line for Email | The user already chose at Finalize. A quote finalized with None sends no order email unless the user picks Email |
| Send Via default in the Confirm dialog | None, with a warning line for Email | The safe default |
| Sales order Ship To | A separate block, printed only for a drop shipment | Without a drop shipment, Ship To repeats the Customer block's address |
| Source of the Ship To address | New columns on the `salesOrderLocations` view | Every sales order PDF already reads the view, and the invoice Ship To reads its view the same way |
| Template samples | Fill every section | Each option a template can print must show in the editor |
| Contract tax placement | The Review step and the contract page | Both render the same `ContractSummary` |

## Acceptance criteria

1. On an Active fixed-term agreement with 3 Pending monthly periods, Invoice with N = 2 creates one Draft invoice with 2 rent lines. The 2 periods show Invoiced. The next daily run creates no invoice for them.
2. On the same agreement, "All remaining" sets N to 3.
3. On an open-ended agreement, the server refuses N = 13. N = 6 cuts the missing periods and bills 6 periods.
4. An agreement set to "Post and Email" still gets a Draft invoice from the dialog. Carbon emails nothing.
5. An agreement set to "Manual" gets no invoice from the daily run when a period is due. The Invoice dialog still bills it.
6. Deleting the Draft invoice returns its periods to Pending.
7. On an Active agreement, a change of the Rental Site saves. The next drafted invoice takes the new site as its bill-to and ship-to. An already drafted invoice keeps the old one.
8. The server refuses a Rental Site of another customer, on Draft and Active.
9. A quote finalized with Email starts the Won step on Email. A quote finalized with None starts it on None. The sales order Confirm dialog starts on None. Picking Email shows the warning line with the contact's name.
10. A converted quote with Send Via left on None sends no email.
11. A sales order with Drop Shipment on prints the drop-ship location under Ship To. One without prints no Ship To.
12. The template editor preview shows Ship To on the sales invoice and the sales order.
13. The "prints every text … it reaches" snapshot lists no section that a sample leaves out.
14. The contract Review step shows a line at £60 with 20% tax as £12 tax and £72 per invoice.
15. On an Active fixed-term agreement with no Pending period left and one unbilled charge dated today, Invoice with N = 0 creates one Draft invoice with only the charge line. While a Pending period is left, the server refuses N = 0.
16. The company Invoicing setting and the contract selects do not offer Manual. The company-settings validator refuses Manual.

## Open questions (resolved)

- [x] Does an early invoice follow the agreement's Invoicing choice? — **Answer:** No. It is always a Draft.
- [x] Add a "Manual" invoicing choice? — **Answer:** Yes, as a new `invoiceAutomation` value.
- [x] How does the user pick periods? — **Answer:** A count N, with "All remaining" for a fixed term.
- [x] How far ahead on an open-ended agreement? — **Answer:** Up to 12 periods.
- [x] Where does "Send Via" start in the Won step? — **Answer:** On the choice made at Finalize, with a warning line for Email (changed after review: it started on None).
- [x] The sales order Confirm dialog too? — **Answer:** It starts on None. It has no Finalize choice to start from.
- [x] Ship To on the sales order PDF? — **Answer:** A separate block that prints only for a drop shipment (changed after review: printed for every order, it repeated the Customer block's address).
- [x] Rental Site on Active: snapshot the site on delivery shipments? — **Answer:** No. Reprints show the new site. Add the customer check.
- [x] Does a site change move the bill-to too? — **Answer:** Yes. Each invoice already copies the site as bill-to and ship-to. Keep that, and say so in the helper text and the docs.
- [x] Tax on the contract Review step in this branch? — **Answer:** Yes.
- [x] Where is Manual offered? — **Answer:** On the rental agreement's own Invoicing select only. The company setting and contracts never offer it.
- [x] Can the dialog bill due charges when no period is left? — **Answer:** Yes. N = 0 is allowed only when no Pending period is left and at least one charge is due. Otherwise N >= 1.

## Changelog

- 2026-11-25: First version, after the interview.
- 2026-11-25: Manual is offered on the rental agreement only, never on the company setting or a contract. The dialog bills due charges alone with N = 0 when no period is left (AC 15, 16). Recorded the plan's decisions: Manual still cuts periods and drafts credit memos; every line is billed, a Returned line included; the fixed-term limit is the periods left; the Ship To comes from view columns; samples may need a third variant; contract tax also shows on the contract page.
- 2026-11-25: Implemented (plan `.ai/plans/2026-11-25-rentals-and-documents.md`). What shipped:
  - Early invoice: `invoiceRentalAgreementPeriods` and the read-only `previewRentalAgreementInvoice` (`sales.server.ts`) call `draftEarlyRentalInvoice` (`sales.service.ts`). An open-ended line is cut with `generatePeriodsForPending`. The UI is `RentalInvoiceModal`, with the preview route `api+/rental-agreement.$id.invoice-preview.ts`.
  - Manual: migration `20261125131412_invoice-automation-manual.sql`. `invoiceAutomationPosts` (`@carbon/utils`) is false for Draft Only and Manual. Contracts and the company setting use `inheritableInvoiceAutomations`, and a CHECK refuses Manual on both (`20261125131414_invoice-automation-manual-agreements-only.sql`).
  - Rental Site: `customerLocationId` is in `rentalActiveTerms`. `refuseForeignRentalSite` refuses another customer's location with `RENTAL_SITE_WRONG_CUSTOMER`.
  - Sales order Ship To: migration `20261125131413_sales-order-ship-to.sql` adds the `shipTo*` columns to `salesOrderLocations`. `PartiesBlock` prints them under Customer.
  - Send Via: both dialogs start on None. `CustomerContact` takes `emailNotice` for the warning line.
  - Contract tax: `contractInvoiceTax` (`ui/Contracts/contractTerms.ts`) feeds `ContractSummary`.
- 2026-11-25: Deviations from the design:
  - Charges-only invoicing (N = 0) works only when no Pending period is left. A unit still out past its term end always has a period left, because the roll-forward keeps cutting holdover periods. So on such an agreement the due charges go on the invoice with the next period.
  - 3 nested texts stay in the "prints every text" snapshot: `jobTraveler` `jobDetails:makeToOrder`, `issue` `issueDetails:unknown` and `issue` `actionTasks:unknown`. The test marks the outer text, so it cannot see the nested one print (AC 13).
  - After a server refusal, the Invoice dialog stays open and loads a fresh preview, which shows the refusal.
- 2026-11-25: The new sample data shows 2 click-to-edit limits, kept in the `previewClick.pdf.test.ts` snapshot. The job traveler prints "BATCH {value}" as one run (`jobTraveler/OperationsBlock.tsx:207`), so a click opens the operation actions panel. On the stock transfer "Any" row, a click on the arrow opens the "Any" text. Neither one comes from this branch.
- 2026-11-25: Fixes after the browser test. Rental invoice lines print dates as "Oct 7, 2026" (`rentLineDescription`), not ISO dates. Older lines keep their text. The contract Confirm dialog shows totals with tax. The location picker reopens after "Create" by design, so it stays as it is.
- 2026-11-25: Fixes after the code review.
  - Ship To prints only for a drop shipment (§5, AC 11). For every other order it repeated the Customer block's address.
  - A CHECK on `companySettings` and `customerContract` refuses Manual (migration `20261125131414_invoice-automation-manual-agreements-only.sql`). The app lists alone did not stop a direct API write. `inheritableInvoiceAutomations` (`settings.models.ts`) is the one list of every mode but Manual.
  - A run bills a Manual agreement only with `billManual` (Sell to Customer). Before, any run for one agreement billed it.
  - The early invoice preview takes no lock. The dialog posts the preview's `firstPeriodStart` as `fromPeriodStart`, and the server refuses when another period comes first. So a resubmit or a retried MCP call never bills the following periods.
  - Contract tax follows the drafting's rule (§7).
- 2026-11-25: Fixes after the second code review.
  - An open-ended line is never invoiced more than 12 periods ahead of today. The count includes the periods that earlier early invoices billed ahead (`refuseBillingTooFarAhead`). Before, each call could bill 12 more.
  - The early invoice also drafts the due early-return credits on their own credit memo, as the daily run does. So Close is not blocked until the next run. With only a credit due, N = 0 drafts the memo alone.
  - The preview locks the agreement's lines while it cuts periods. It does not lock the agreement or the rows it bills.

- 2026-11-25: Review fixes. Early invoices carry a hold, so the daily automation never posts them. Contract tax comes from the drafting's own rate and rounding (server side). A Rental Site change moves the bill-to and the ship-to of later invoices. The tests now go through the real operations.
- 2026-11-25: The Won step starts "Send Via" on the choice made at Finalize (§4, AC 9). Finalize writes `quote.sendViaEmail` in `finalizeQuote` (`sales.service.ts`) from the `notification` it gets. If no `notification` comes, the column keeps its value. The `quotes` view does not carry the column, so the quote page loader reads it with `getQuoteSendViaEmail`. A quote revision does not copy it, as with `emailOrderOnAcceptance`. Test: `apps/erp/test/database/finalize-quote-send-via.test.ts`.
- 2026-11-25: Fixes after the third code review.
  - Drafting an early invoice of 1 or more periods needs `fromPeriodStart`. Before, a retried API or MCP call that left it out billed the next periods again. N = 0 (the due charges alone) still needs none. Test: `rental-invoice-early.test.ts`.
  - An early invoice never bills the periods of a unit treated as a sale (`lessorClassification = 'Sale'`). Those periods are lease payments, and the daily run bills them on their due dates. The period count, **All remaining** and the periods left count only the other units. Test: `rental-invoice-early.test.ts`.
- 2026-11-25: Fixes after the fourth code review.
  - On an Active Manual agreement, the daily run drafts the due periods of units treated as a sale. The early invoice leaves those periods out, so before this they were never billed. Rental units and charges still wait for **Invoice**. The drafts are never posted or emailed automatically. Test: `create-rental-invoices.test.ts`.
  - The Manual skip applies only to an Active agreement. A Closed Manual agreement has its released periods drafted, as any agreement has. Before, a void of its last invoice left periods that nothing could bill, because Invoice refuses a Closed agreement. Test: `create-rental-invoices.test.ts`.
  - An early invoice that drafts an early-return credit memo needs `invoicing.creditMemos` Create. Without it the call is refused with a `forbidden` error and writes nothing. Periods and charges alone do not need it. Test: `rental-invoice-early.test.ts`.
