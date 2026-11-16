# Sales posting date, gross revenue with discounts, sales rep on invoices

Branch `feat/sales-posting-date-discounts-reps`. One PR (user's choice).

Why: Heaviside's accountant (Rillet) needs back-loaded October sales on their real dates,
revenue at gross with the discount on Sales Discounts, and the sales rep on every invoice
in Rillet. Decisions (user, 2026-11-16): always split discounts; add
`salesInvoice.salesPersonId`; one PR.

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

## C. Sales rep on sales invoices

- [x] Migration: `salesInvoice.salesPersonId` → `user` (ON DELETE SET NULL); recreate the
      `salesInvoices` view with it.
- [x] Copy from the sales order (from order, from shipment), rental agreement, contract.
- [x] Validator, create form, properties panel (Draft-only edit), `updateSalesInvoiceField`
      whitelist.
- [x] Rillet: a REVENUE Field "Sales Rep" on each invoice item (VERIFY).

## Verification (main agent)

- [x] `pnpm run generate:types`, erp + api + ee + database typecheck, scoped tests, Biome,
      `pnpm generate:mcp` + `pnpm check:manifest`, lingui extract + translate.

## Notes from the build

- Shipments: only the Sales Order source takes the date. Purchase Order, Outbound
  Transfer, Sales Return and Purchase Return shipments still post today.
- Providers: no sandbox test of a negative invoice line (Rillet, Xero, QBO) or of a
  Rillet invoice item `fields` entry. Each mapper has a `VERIFY` comment.
- Invoices posted before this change have no Sales Discount line. They keep syncing at net.
