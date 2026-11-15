# Plan: change a posted invoice line's GL account; reopen a closed period

Spec: `.ai/specs/2026-11-14-invoice-line-gl-reclass.md`. Run log: `.ai/runs/2026-11-14-invoice-line-gl-reclass.md`.

Closest siblings: the invoice VOID (`postSalesInvoice` / `postPurchaseInvoice` `void`: same source type, copied document keys, `copyJournalLineDimensions`), the stock movement correction (`postStockMovementCorrection`: dated on the original, refused in a Locked or Closed period, refused before the cutover) and `unlockPeriod` (the reopen operation).

## Tasks

- [x] 1. `invoicing.service.ts`: pure `findInvoiceLinePosition`, `buildLineAccountChangeLines`, `accountingPeriodName`, `lineAccountChangePeriodRefusal`.
- [x] 2. `invoicing.service.ts`: `changeInvoiceLineAccount` (one Kysely transaction: lock the invoice, facts per side, refusals, legs with dimensions, period, journal, lines, dimensions, line `accountId`).
- [x] 3. `invoicing.server.ts`: `changeSalesInvoiceLineAccount`, `changePurchaseInvoiceLineAccount` (`@mcp`, `update: ["invoicing", "accounting"]`).
- [x] 4. `invoicing.models.ts`: `invoiceLineAccountValidator`; routes `x+/{sales,purchase}-invoice+/$invoiceId.$lineId.account.tsx`; `path.to.{sales,purchase}InvoiceLineAccount`.
- [x] 5. UI: `ui/InvoiceLineAccount/ChangeInvoiceLineAccount.tsx` (button, modal, `AccountControlled`, no form element), shown in both line forms for a posted invoice and a user with invoicing and accounting update.
- [x] 6. `accounting.server.ts`: `reopenPeriod` (`@mcp`, `update` + `delete: accounting`); the close route's `reopen` intent and **Reopen Period** button for a Closed period.
- [x] 7. Tests: `invoicing.line-account.test.ts` (balances before and after, repeated change, disambiguation, period refusals); permission refusals in `test/invoicing-operations.test.ts` and `test/accounting-operations.test.ts`.
- [x] 8. Sources in sync: invoicing and accounting `AGENTS.md`, `docs/content/docs/reference/{invoices,period-close}.mdx`, Lingui catalogs, MCP digest.
- [x] 9. Verification: scoped vitest, Biome, erp typecheck, `check:manifest`.

## Addendum 2026-11-15: fixes from testing in the app

- [x] 10. Line forms: Change GL Account in a header `CardAction`, clear of the collapse chevron.
- [x] 11. `invoicing.service.ts`: `locateInvoiceLinePosition` (pure) and `readInvoiceLinePosition` shared by `changeInvoiceLineAccount` and the new `getInvoiceLinePostedAccount`; `invoicing.server.ts`: `getSalesInvoiceLinePostedAccount`, `getPurchaseInvoiceLinePostedAccount` (not `@mcp`); `api+/{sales,purchase}-invoice.$invoiceId.$lineId.account.ts`; the dialog reads it on open and shows the current account or the refusal.
- [x] 12. Close route: a Closed period's checklist is read-only (no banner, no task actions, no run prompts).
- [x] 13. Tests: `locateInvoiceLinePosition` cases in `invoicing.line-account.test.ts`. Sources in sync: spec, run log, invoicing and accounting `AGENTS.md`, `invoices.mdx`, `period-close.mdx`, Lingui catalogs.
