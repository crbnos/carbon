# Rentals and documents: code map

Date: 2026-11-25. Branch `fix/rentals-and-documents`. All paths are relative to the repository root.

## Key facts

1. The Invoice button bills what is due today. `$id.invoice.tsx:58-66` passes `asOf = datetime.today(companyTz)`. Drafting picks periods with `status = 'Pending'` and `dueOn <= asOf` (`sales.service.ts:16759-16760`, `16875-16876`). The only check on `asOf` is a regex (`sales.service.ts:17527`). No code refuses a future period.
2. Future periods exist only for a fixed term. Activation cuts a fixed term in full (`rental-periods.ts:402-403`). An open-ended line has periods up to `billingHorizon(asOf)` plus one (`rental-periods.ts:248-260`, `413`). "Invoice N periods" on an open-ended line must cut periods past that horizon.
3. The route automates an early invoice at once. It fires `invoice-automate` for each unheld, non Draft Only invoice (`$id.invoice.tsx:109-119`). The daily job reads only invoices with `createdBy = 'system'` (`automate-invoice.ts:196`).
4. The daily job never bills a period twice. Drafting stamps the period `Invoiced` and its `salesInvoiceLineId` (`sales.service.ts:17381-17394`). The job reads only Pending periods. Roll-forward skips period starts that exist (`rental-periods.ts:424-426`).
5. Posting defers revenue for a period billed early. With no accruals, all rent goes to Cr Deferred Revenue, spread one row per month (`invoicing.service.ts:9467-9509`, `revenue-schedule.ts:130-173`).
6. Risk: an early return after early billing gives a credit for each Invoiced period past the return (`rental-periods.ts:447-468`). `dateIssued` is `asOf` (`sales.service.ts:17333`).
7. Rental Site on an Active agreement is blocked in 3 places: `rentalActiveTerms` (`sales.server.ts:5301-5305`), `updateRentalAgreementInvoiceTerms` (`sales.service.ts:9743-9769`), and the UI `isDisabled` (`RentalAgreementProperties.tsx:224-226`, `311`). Drafting copies the site per invoice (`sales.service.ts:17328`, `17352`). Risk: the Delivery Ticket reads the site live (`packing-slip-document.server.tsx:424`). No code checks that the site belongs to the customer (`20261006220501_rental-agreements.sql:38`).
8. The snapshot `pdf/__snapshots__/preview-documents.test.ts.snap:1-110` lists the sections the samples never print.
9. Carbon does not store the Finalize "Send Via" choice. It stores only `quote.emailOrderOnAcceptance` (`20261112030415`). The drawer, the Finalize modal and the sales order Confirm modal default to Email when email is on (`QuoteToOrderDrawer.tsx:348`, `1103-1105`; `QuoteFinalizeModal.tsx:128-130`; `SalesOrderHeader.tsx:115-117`).
10. The sales order and quote PDFs have no Ship To. The SO "Customer" block prints the header `customerLocationId` address. The drop-ship location is in no view the PDF loads (`sales.pdf.tsx:280-305`). The quote has only a header `customerLocationId`.
11. The contract Review step renders `ContractSummary`, which shows no tax (`$id.setup.review.tsx:232-237`). Line tax is `customerContractLine.taxPercent` and `taxCodeId`.

## 1. Rental invoicing early

### 1.1 Invoice button → drafting

| Step | Fact | Cite |
|---|---|---|
| Button | Shows only while Active. Needs `canInvoice` (Edit on Rental Agreements, Create on Sales Invoices). | `RentalAgreementHeader.tsx:88-89`, `332-340` |
| Confirm text | "Use this to bill what's due right away…" | `RentalAgreementHeader.tsx:164-169` |
| Route gate | `sales.rentalAgreements: Edit` + `invoicing.salesInvoices: Create`. Active only. | `rental-agreement+/$id.invoice.tsx:26-29`, `43-51` |
| `asOf` | `datetime.today(getCompanyTimeZone(...))` | `$id.invoice.tsx:53`, `62` |
| Wrapper | `generateRentalInvoicesNow` → `invokePosting("create-rental-invoices", { asOf, rentalAgreementId })` | `sales.service.ts:13853-13882` |
| Posting body | `createRentalInvoices` → `createRentalInvoicesForDuePeriods` | `sales.service.ts:17525-17555` |
| Agreements selected | Active or Closed with a live line, a due Pending period, or a due unbilled charge | `sales.service.ts:16728-16782`, `16835-16836` |
| Transaction | Locks the agreement `FOR UPDATE`, rolls periods forward (Active only), runs `planDueRentalInvoices(lock: true)` | `sales.service.ts:17097-17163` |
| Due rows | `selectDueRentalRows`: Pending periods with `dueOn <= asOf`; charges with no line and `chargeDate <= asOf` | `sales.service.ts:16843-16909` |
| Tax | Rate on `asOf` | `sales.service.ts:16961-16982` |
| Invoice insert | `insertRentalInvoice`: `dateIssued = asOf`, `automationHoldReason` | `sales.service.ts:17296-17344` |
| Billed marker | Period `status: "Invoiced"`, `salesInvoiceLineId` | `sales.service.ts:17380-17408` |
| Draft delete | `releaseRecurringInvoiceStamps` clears the stamps | `sales.service.ts:13888-13937` |

### 1.2 Planning (`packages/utils/src/rental-invoice-plan.ts`)

| Function | Rule | Cite |
|---|---|---|
| `planRentalInvoices` | Draft Only → one combined invoice. Other modes → a rent invoice and a held charges invoice. | `:55-99` |
| `effectiveInvoiceAutomation` | `agreementMode ?? companyMode` | `:102-107` |
| `planAgreementRentalInvoices` | One Rent line per period, one line per charge | `:191-252` |
| `planDueRentalInvoices` (ERP) | Shared by drafting and the preview | `sales.service.ts:16941-17004` |

### 1.3 Period cutting

| Fact | Cite |
|---|---|
| `billingHorizon`: Calendar Month → end of next month; Monthly → today + 1 month; 28 Days → today + 28 | `packages/database/src/rental-periods.ts:248-260` |
| A fixed term is cut in full; an open-ended line adds one period past `through` | `rental-periods.ts:400-413` |
| `dueOn` = `periodStart` (Advance) or `periodEnd` (Arrears) | `rental-periods.ts:395` |
| `rollBillingPeriodsForward` inserts new Pending rows through `billingHorizon(cycle, asOf)` | `sales.service.ts:17421-17523` |
| A return after billing makes a negative `isAdjustment` row per Invoiced period past `returnedAt` | `rental-periods.ts:447-468` |

### 1.4 Automation

| Fact | Cite |
|---|---|
| The route automates unheld, non Draft Only invoices through `batchTrigger("invoice-automate")` | `$id.invoice.tsx:107-128` |
| `invoice-automate` resolves the mode, then post → PDF → Stripe or email | `packages/jobs/src/inngest/functions/tasks/invoice-automate.ts:24-86` |
| `resolveInvoiceAutomation` | `packages/jobs/src/invoicing/automate-invoice.ts:112-148` |
| Daily `recurring-billing`, cron `0 5 * * *`, `userId "system"` | `packages/jobs/src/inngest/functions/scheduled/recurring-billing.ts:57`, `244-258` |
| `findInvoicesToAutomate`: `createdBy = 'system'`, Draft/Pending, no hold, last 3 days, not Draft Only | `automate-invoice.ts:168-237` |

### 1.5 The `invoiceAutomation` enum

| Fact | Cite |
|---|---|
| Values: Draft Only, Post, Post and Email, Post and Send via Stripe | `20261006221101_rental-invoice-automation.sql:5-7` |
| `companySettings.invoiceAutomation` default `'Post and Email'` | same `:9-10` |
| `rentalAgreement.invoiceAutomation` nullable | same `:13-15` |
| `rentalAgreements.effectiveInvoiceAutomation` | newest view `20261119231546_rental-agreements-tax-code.sql:13` |
| TS arrays | `sales.models.ts:1544`, `settings.models.ts:52` |
| Agreement select | `RentalAgreementProperties.tsx:412-441` |
| `setRentalInvoiceAutomation` / `updateRentalAgreementInvoiceAutomation` | `sales.server.ts:5509-5537`; `sales.service.ts:9773-9830` |

### 1.6 Recognition for a period billed early

| Fact | Cite |
|---|---|
| `planRentalLine`: accrued part → Contract Assets; the rest → Deferred Revenue over the period | `invoicing.service.ts:9467-9509` |
| `spreadStraightLine`: one row per month | `packages/database/src/revenue-schedule.ts:130-173` |
| `synthesizeRentalAccruals` accrues only periods no posted invoice covers | `accounting.service.ts:23217-23226`, `23270-23319` |
| No guard refuses a future period | grep |

### 1.7 Next Invoice card

| Fact | Cite |
|---|---|
| `getRentalNextInvoice`: read only, earliest Pending `dueOn` | `sales.service.ts:17022-17095` |
| Card | `RentalNextInvoice.tsx:67-111` |

## 2. Rental Site on an Active agreement

| Fact | Cite |
|---|---|
| `rentalActiveTerms` and the refusal | `sales.server.ts:5301-5305`, `5324-5348` |
| Active writes: `updateRentalAgreementInvoiceTerms` | `sales.server.ts:5459-5481`; `sales.service.ts:9743-9769` |
| A customer change clears the site and contact | `sales.server.ts:5422-5426` |
| UI read-only unless Draft | `RentalAgreementProperties.tsx:224-226`, `302-315` |
| Drafting copies the site to the invoice and its shipment | `sales.service.ts:17328`, `17346-17357` |
| Delivery Ticket reads the site live | `packages/lib/src/packing-slip-document.server.tsx:406-424` |

## 3. Template sample data

| Type (sample) | Section that needs data | In sample? | Cite |
|---|---|---|---|
| salesInvoice (`samples.ts`) | Ship To | No | `pdf/blocks/PartiesBlock.tsx:81-92`; `samples.ts:108-123` |
| salesOrder | Bill To (`paymentCustomerName`) | No | `pdf/blocks/salesOrder/PartiesBlock.tsx:68-79` |
| quote | Contact, email, incoterm, Tax ID | No | `quote.samples.ts:113-122` |
| purchaseOrder | Supplier contact, buyer rows, incoterm | No | `purchaseOrder.samples.ts:30-96` |
| packingSlip | Contract No., Serial/Batch column, Receiving Report title | No | snap `:37-44` |
| purchasingRfq | Terms | No | snap `:58-62` |
| jobTraveler | Batch, steps, work instructions, notes, materials | No | snap `:20-35` |
| issue | Associations, unknown type | No | snap `:3-18` |

The "prints every text … it reaches" test (`preview-documents.test.ts:228-283`) lists the texts that do not print. Changing a sample changes the "prints the X sample" snapshots.

## 4. Quote → order email

| Fact | Cite |
|---|---|
| Drawer default Email when email is on | `QuoteToOrderDrawer.tsx:345-348`, `1091-1159` |
| Finalize modal default | `QuoteFinalizeModal.tsx:128-130` |
| Stored: only `quote.emailOrderOnAcceptance` | `20261112030415_quote-email-order-on-acceptance.sql:3-4` |
| `convertQuote` emails only when `notification` is Email | `sales.server.ts:1299-1323` |
| Sales order Confirm default Email | `SalesOrderHeader.tsx:112-117` |

## 5. Ship To on sales order and quote templates

| Fact | Cite |
|---|---|
| SO texts have no Ship To | `template/texts/salesOrder.ts:14-55` |
| SO vars: `customer.*`, `billTo.*` | `pdf/blocks/salesOrder/vars.ts:97-118` |
| `salesOrderLocations` view | `20260430000001_tax-status.sql:427-470` |
| Invoice pattern | `texts/salesInvoice.ts:72-73`; `pdf/blocks/vars.ts:136-144`; `pdf/blocks/PartiesBlock.tsx:57-92` |
| SO PDF loader loads no shipment | `apps/erp/app/modules/sales/sales.pdf.tsx:280-305` |
| SO ship-to rule: drop ship → shipment location, else header | `shared.service.ts:9365-9377` |
| Quote: header `customerLocationId` only | `20260430000001_tax-status.sql:531-554` |

## 6. Service contract Review step

| Fact | Cite |
|---|---|
| Route renders `ContractSummary` | `contract+/$id.setup.review.tsx:184-237` |
| `ContractSummary` shows no tax | `ui/Contracts/ContractSummary.tsx:47-343` |
| `customerContractLine.taxPercent`, `taxCodeId` | `20261006221301_contracts.sql:114`; `20261119231542_multi-jurisdiction-tax.sql:360-366` |
