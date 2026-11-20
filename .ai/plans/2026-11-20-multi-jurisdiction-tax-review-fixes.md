# Multi-jurisdiction tax phase 1: review fixes (PR #1957)

Review: `.context/review/REVIEW.md` (+ `A`…`E` area reports, same folder). Branch `xero-invoice-status-taxes`.
Goal: production-ready for a UK VAT company on Xero. Each finding is referred to by its review id (e.g. D-B1 = report D, blocker 1).

## Decisions (apply these; do not re-litigate)
1. **Tax point.** One tax-point date per document:
   - sales invoice `dateIssued`
   - purchase invoice `dateIssued` (else its posting date)
   - memo date
   - receipt: the PO's `orderDate`
   - Rental, contract and project-billing invoice lines take their rate at the invoice's `dateIssued`, the same as every other invoice.
   - Posting splits each line with `taxCodeOn(code, taxPointDate)`.
   - If a coded line has no component in force on that date, refuse posting with a clear message. Never silently fall back to cost or "no authority". (B-B1, C-R1, C-R2)
2. **Exempt / non-taxable / untaxed shipping on Xero** (D-B2), for a company that has tax codes:
   - The Tax Rates tab gets one fallback row per direction: "No tax code (exempt or non-taxable)", for sales and for purchases.
   - Lines with no code and 0 tax (exempt customer, non-taxable item, header shipping on a code without "taxes shipping") send that mapped rate instead of `NONE`.
   - Sync stays off while the company has codes and a used fallback is unmapped.
   - Companies with no codes keep sending `NONE` for 0% lines.
3. **Reverse Charge** (D-B3):
   - Match-by-rate and the 1p check use the charged rate (`chargedTaxPercent`, 0 for RC).
   - A Reverse Charge sales mapping must be a 0% rate.
   - Reverse Charge purchase documents (bills, POs, supplier memos) go tax-neutral (`NONE`) in Phase 1, and an RC code needs no purchase mapping.
4. **Legacy percent lines with several matching provider rates** (D-B5): prefer the rate whose `ReportTaxType` is the standard OUTPUT/INPUT and never a capital-goods rate; otherwise park as today. Correct the PR body claim.
5. **Account-class check** (D-B4): carry Xero `CanApplyTo*` on rate options and check the line account class before the push. Refusing raises the structured warning. Confirm on a real org.
6. **Bill recoverable split** (D-B1): recoverable net = Σ ledger `taxableAmount × recoverableAmount/taxAmount` per code. Use one shared split in `core/` for bills and memos (Xero + QBO).
7. **Ledger anchoring** (A-B1, B-B3, E-3, A-R4, R5):
   - composite FKs on `taxLedger`: journal, taxCode, taxCodeComponent (`ON DELETE SET NULL`), taxAuthority (`ON DELETE RESTRICT`), customer, supplier;
   - `ID_REF_COLUMNS taxLedger: [documentId, documentLineId]`;
   - deleting a tax authority that ledger rows or components reference is refused with a friendly message.
8. **Shipping-tax snapshot** (A-B2):
   - `salesInvoiceLine.taxesShipping` is set by a BEFORE interceptor from the line's code when `taxCodeId` changes;
   - the `salesInvoices` view reads the line, not `taxCode`;
   - `taxCode` gets `delete: false` in the authz manifest.
9. **PDF** (E-1): after the route's permission check, read the document's tax data with a service-role client scoped by `companyId`. Decide "posted" from the invoice status, not `journal`.
10. **Retire** (E-2, C-R3, E-11):
    - refuse retiring a code that customers, suppliers or ship-to locations still reference (show counts);
    - the combobox shows an already-set retired code;
    - retire checks the affected row and stamps `updatedBy`/`updatedAt`.
11. **Server derives the rate from the code** when a code is sent (C-R4); a Reverse Charge line refuses a supplier tax amount on every PO/PI line write, and the receipt ignores it (C-B2).
12. **Deferred** (needs a UK accountant or Phase 2; documented, not built):
    - partial-recovery box 7 (D-R3);
    - reverse-charge bill boxes (D-R4);
    - `reportingCategory` on the ledger (B-R3);
    - post-cutover backfill script (A-R3/B-R2);
    - expand/contract for the `accountDefault` rename (A-R1).

## Work split (parallel, isolated worktrees, merged by the main agent)
- [x] **X — provider sync** (packages/ee, settings Tax Rates tab + integrations route): D-B1..B5, D-R1, D-R2, D-P1, D-R9, D-S1, D-S2, D-S3 (split bill line builders), the C-R6 inbound-bill note.
- [x] **P — posting, ledger, schema**: B-B1, B-B2, A-B1/B-B3, A-B2, B-R4 (memo leg per component account), B-R6 (sales tax leg signed by class), B-C1, B-C4, A-C1/B-C3 (fold `…552` into `…542`), A-R6 (wipe preserves taxLedger), A audit `events: true`, A-P1 (`NOT VALID` + lock_timeout), B-T1/T2 tests, Tax Liability report Total.
- [x] **L — determination and lines**: C-B1 (version list; migration column already added), C-B2, C-B3, B-R5 (service-job invoices), E-2/C-R3/E-11 retire, C-R4, C-R7, C-R5 (lock inside the transaction + confirm copy), C-S1, C-S2, C-S3, C-S4 where they touch the fixes.
- [x] **U — UI, PDF, docs**: E-1, E-4, E-5, E-6, E-8, E-9 (overlap validation), E-10, E-14/E-15/E-16, every docs-freshness item from A–E, the PR body text in `.context/pr1957-body-new.md`.
- [ ] **Main agent:** merge; `pnpm db:migrate` + `generate:types`; `authz migration`; erp/ee/database/documents typecheck; tests; biome; `db:check:datasets`/`backups --stage`; browser pass; UK Xero demo-org test (checklist in D report).

## Deviations found while merging
- **Credits keep the billed rate.** A rental early-return credit and a contract cancellation credit take the code's rate on the period start of the row they reverse. Billing lines take the rate on the invoice date (decision 1). A credit reverses tax at the rate it was billed at.
- **Service-job invoice tax reads inside the transaction.** `serviceInvoiceLineTaxes` reads the customer, ship-to and codes through the Kysely transaction (`decideLineTax` + `loadTaxCodes`). It no longer calls the PostgREST resolver from inside a posting transaction.
- **Shipping-tax snapshot is a migration trigger**, not an event-system interceptor. The dispatcher ignores changes an interceptor makes to `NEW`.
- **Retired codes keep resolving where assigned.** Retire is refused while a party or ship-to uses the code; a code already on a line keeps billing.
