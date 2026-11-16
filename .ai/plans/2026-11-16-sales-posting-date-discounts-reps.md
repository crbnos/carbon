# Sales posting date, gross revenue with discounts, sales rep as a dimension

Branch `feat/sales-posting-date-discounts-reps`. One PR (user's choice).

Why: Heaviside's accountant (Rillet) needs back-loaded October sales on their real dates,
revenue at gross with the discount on Sales Discounts, and the sales rep on every invoice
in Rillet. Decisions (user, 2026-11-16): always split discounts; one PR. The sales rep is
the rep of the sales order, posted as an Employee dimension (no invoice column).

## A. Posting date (sales order shipments, sales invoices)

- [x] `resolveManualPostingDate` + `getManualPostingPeriod` in `shared.service.ts`,
      copied verbatim from PR #2213 (commit `f5715a1a67`) so the two branches merge clean.
      Refuses invalid, future, and before-cutover dates; today → current period, else
      `getAccountingPeriodForDate` (refuses Locked/Closed).
- [x] `postShipment`: the existing `postingDate` input now also dates a Sales Order
      shipment: itemLedger, costLedger, shipment.postingDate, salesOrderLine.sentDate,
      batch split, disposal date, COGS journal, period.
- [x] `postSalesInvoice`: optional `postingDate`; dates journal, ledgers, period,
      `dateIssued`, `postingDate`, and `dateDue` from it.
- [x] UI: date picker in `ShipmentPostModal` (Sales Order, rental and contract shipments) and `SalesInvoicePostModal`,
      default company today, max today.
- [x] Tests: dated post lands on the date; a future date and a pre-cutover date refuse.

## B. Gross revenue + Sales Discount leg

- [x] `buildSalesPostingLines`: on the plain `sales` booking only, credit Sales with gross
      and debit `accountDefault.salesDiscountAccount` ("Sales Discount") with the discount;
      `salesRevenueBase` stays net (deferral, contract, service, rental, disposal unchanged).
- [x] `classifyAccountingPostingRole`: "Sales Discount" → `SalesDiscount`.
- [x] Sync: `sales-invoice-source.ts` replays the discount account;
      `sales-document-components.ts` emits gross Merchandise + a negative `Discount`
      component; Rillet / Xero / QBO mappers book it to the discount account (VERIFY flags
      where not sandbox-tested).
- [x] Tests + rule `.claude/rules/accounting-sync-handlers.md` (the "at NET" section).

## C. Sales rep as an Employee dimension

The user rejected a `salesInvoice.salesPersonId` column (first build, reverted). The rep is
`salesOrder.salesPersonId`, a user id. An Employee dimension value is that user id.

- [x] Revert the column: the migration, the generated types, the form, the properties
      panel, the list column, the copies from the order, rental agreement and contract, and
      the Rillet "Sales Rep" Field.
- [x] `postSalesInvoice` reads `salesOrder.salesPersonId` for the orders of all lines in one
      query. `lineMetadata` puts it on `SalesPostingMetadata.salesPersonId`.
- [x] `salesLineDimensions` writes `Employee` = the rep on every leg of the line, like
      `Customer`. A line with no `salesOrderId` gets no rep.
- [x] `buildSalesShipmentJournal` writes `Employee` = the order's rep on the Sales Order
      shipment COGS legs.
- [x] Void: `copyJournalLineDimensions` already copies every dimension. No change.
- [x] Sync: `loadSalesInvoices` loads the dimensions of the posted revenue legs
      (`postedLineDimensions`). Each invoice line and each of its components carries them.
- [x] Rillet: `mapToRemote` calls `resolveLineDimensions` and sends `fields` on each item,
      as a bill does (VERIFY). A new Field applies to EXPENSES and REVENUE.
- [x] Tests: the posting-lines tests (invoice and shipment), `postedLineDimensions`, the
      component carry, the Rillet mapper, and the `createField` payload.

Limits:

| Case | Result |
|---|---|
| A line not from a sales order line (manual, contract, rental) | The sync finds no revenue leg for it, so it sends no fields. |
| A Field that bills or journals created before this change | It stays EXPENSES only. The sync does not update it. |
| Xero and QBO invoices | No dimensions. Their invoice mappers have no dimension support. |
| The legacy backfill (`journalLegacyDocuments`) | It does not pass the rep. Rebuilt journals have no Employee. |

## Verification (main agent)

- [x] (Re-run after Part C rework.) `pnpm run generate:types`, erp + api + ee + database typecheck, scoped tests, Biome,
      `pnpm generate:mcp` + `pnpm check:manifest`, lingui extract + translate.

## Notes from the build

- Shipments: only the Sales Order source takes the date. Purchase Order, Outbound
  Transfer, Sales Return and Purchase Return shipments still post today.
- Providers: no sandbox test of a negative invoice line (Rillet, Xero, QBO), of a
  Rillet invoice item `fields` entry, or of a Field with both areas. Each has a `VERIFY` comment.
- Invoices posted before this change have no Sales Discount line. They keep syncing at net.
