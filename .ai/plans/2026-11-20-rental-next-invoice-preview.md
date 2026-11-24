# Rental agreement Next Invoice preview — implementation plan

**Spec / source:** `.ai/specs/2026-11-20-rental-next-invoice-preview.md`
**Branch:** `feat/rental-invoice-preview`

## Progress
- [x] Task 1: Extract the pure invoice planner and totals from the drafter
- [x] Task 2: Add the read `getRentalNextInvoice`
- [x] Task 3: Name rental lines by their description on the invoice PDF
- [x] Task 4: Add the preview PDF loader in `@carbon/lib`
- [x] Task 5: Add the preview PDF route and path helper
- [x] Task 6: Add the Next Invoice card to the agreement details page
- [x] Task 7: Verify (tests, typecheck, Biome, extract strings)

## Dependencies
Task 2 needs Task 1. Task 5 needs Tasks 2 and 4. Task 6 needs Tasks 2 and 5. Task 3 is independent.

---

## Task 1: Extract the pure invoice planner and totals from the drafter

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `draftAgreementInvoices` (~15937), `insertRentalInvoice` (~16265)
- Create: `apps/erp/app/modules/sales/sales.rental-invoice-plan.test.ts`
- Copy from (precedent): `apps/erp/app/modules/sales/sales.rent-line-description.test.ts`

**Steps:**
1. Move the period and charge selects of `draftAgreementInvoices` into `selectDueRentalRows(db, { companyId, agreementId, asOf, lock })`. When `lock` is true, add `.forUpdate("p")` / `.forUpdate("c")`. Return `{ periods, charges }`.
2. Move the voided-invoice read into `readVoidedInvoiceIds(db, companyId, rows)`. Return a `Map<id, readableId>`.
3. Export a pure `planAgreementRentalInvoices({ billingCycle, taxPercent, exchangeRate, mode, periods, charges, voidedReadableIds })`. It builds the `lines` array exactly as today and returns `planRentalInvoices(mode, …)`. It skips `isAdjustment` periods.
4. Export a pure `rentalInvoiceTotals(lines)` → `{ subtotal, totalTax, totalAmount }` with today's rounding. `insertRentalInvoice` calls it.
5. Export the `LineValues` type as `RentalInvoiceLineValues`.
6. Write unit tests: two periods + one charge under Draft Only → one invoice with 3 lines, rent tax = agreement tax; under Post with `invoiceSeparately` → rent invoice + held charges invoice; totals of £305.00 at 20 % → 305 / 61 / 366; an adjustment period is left out.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/modules/sales/sales.rental-invoice-plan.test.ts app/modules/sales/sales.rent-line-description.test.ts
# Expected: all tests pass
```

**Out of scope:** the roll-forward, the credit memo path, the job.

## Task 2: Add the read `getRentalNextInvoice`

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts`

**Steps:**
1. Add `getRentalNextInvoice(db, { companyId, rentalAgreementId, today })`. It returns `RentalNextInvoice | null`.
2. Read the agreement (`status = 'Active'`, scoped by `companyId`). If none, return null.
3. Read `companySettings.invoiceAutomation` and compute `effectiveInvoiceAutomation`.
4. Read the earliest Pending non-adjustment `dueOn` of the agreement. Set `asOf = max(today, nextDueOn ?? today)`.
5. Call `selectDueRentalRows` with `lock: false`, then `readVoidedInvoiceIds`, then `planAgreementRentalInvoices`.
6. If the plan is empty, return null. Else return `{ asOf, invoices: [{ role, holdReason, lines (with convertedUnitPrice), ...rentalInvoiceTotals }] }`.
7. Write nothing. No `FOR UPDATE`.

**Verify:** typecheck in Task 7.

**Out of scope:** Draft and Closed agreements.

## Task 3: Name rental lines by their description on the invoice PDF

**Depends on:** none
**Files:**
- Modify: `packages/documents/src/utils/sales-invoice.ts` — `isItemlessServiceLine`

**Steps:**
1. Treat an `invoiceLineType` of `Rental` with no `itemId` like an item-less Service line. `getLineDescription` then returns the description and `getLineDescriptionDetails` returns "".

**Verify:**
```bash
pnpm --filter @carbon/documents test
# Expected: all tests pass
```

## Task 4: Add the preview PDF loader in `@carbon/lib`

**Depends on:** none
**Files:**
- Modify: `packages/lib/src/sales-invoice-document.server.tsx`

**Steps:**
1. Move the company-level reads (company, settings, AR billing address, terms, payment terms, shipping methods, shipping terms) into one internal `loadCompanyDocumentData`. `loadSalesInvoiceDocument` calls it.
2. Add `loadUnsavedSalesInvoiceDocument({ client, companyId, companyGroupId, locale, invoice, lines, customerId, customerLocationId, customerContactId })`. It reads the customer name, the customer location address and country, the contact, the currency decimals, `getCompanyTemplate(client, companyId, "salesInvoice")` and the sections. It builds `salesInvoice`, `salesInvoiceLines`, `salesInvoiceLocations` (invoice and shipment address = the location) and `salesInvoiceShipment` in memory. It returns `{ pdfProps, fileName }`.

**Verify:**
```bash
pnpm --filter @carbon/lib typecheck
# Expected: no errors
```

## Task 5: Add the preview PDF route and path helper

**Depends on:** Tasks 2, 4
**Files:**
- Create: `apps/erp/app/routes/file+/rental-agreement+/$id.next-invoice[.]pdf.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `path.to.file.rentalNextInvoice(id, role?)`
- Copy from (precedent): `apps/erp/app/routes/file+/sales-invoice+/$id[.]pdf.tsx`

**Steps:**
1. `requirePermissions(request, { view: ["sales", "invoicing"] })`.
2. Read the agreement (customer, location, contact, payment term, currency) with the caller's client.
3. Call `getRentalNextInvoice(getDatabaseClient(), …)` with `datetime.today(getCompanyTimeZone(...))`. Pick the invoice by `?invoice=` role, else the first. If none, throw a 404 with "This agreement has no upcoming invoice."
4. Set `dateDue` with `calculateDueDate` from the payment term's days, the way `computeInvoiceDateDue` does.
5. Render with `renderSalesInvoicePdf`. Return it inline.

## Task 6: Add the Next Invoice card to the agreement details page

**Depends on:** Tasks 2, 5
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Rentals/RentalNextInvoice.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Rentals/index.ts`, `apps/erp/app/modules/sales/ui/Rentals/types.ts`
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.details.tsx` — loader returns `nextInvoice` for an Active agreement
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Rentals/RentalBillingPeriods.tsx`

**Steps:**
1. Loader: after the Draft redirect, if the agreement is Active, call `getRentalNextInvoice`. Return `{ nextInvoice }`.
2. Card: title "Next Invoice", the run date, one table per planned invoice (Description, Amount, Tax, Total), Subtotal / Tax / Total rows, a hold badge, and a "Preview PDF" link (new tab) when the user has `view: invoicing`. Empty: "No upcoming invoice."
3. Render it above `RentalBillingPeriods`, only for an Active agreement.

## Task 7: Verify

1. `cd apps/erp && pnpm exec vitest run app/modules/sales`
2. `pnpm --filter @carbon/documents test`
3. `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/lib --filter=@carbon/documents`
4. `pnpm exec biome check <changed files>`
5. `pnpm lingui:extract` — commit only the new msgids of the erp catalogs (see memory: extract churn).
6. If the local stack runs, open an Active agreement and the Preview PDF.

## Execution notes

- After the review, the pure planner (`planAgreementRentalInvoices`, `rentalInvoiceTotals`, `rentLineDescription`) moved to `packages/utils/src/rental-invoice-plan.ts`. Its tests moved to `packages/utils/src/rental-invoice-plan.test.ts`. `sales.rental-invoice-plan.test.ts` and `sales.rent-line-description.test.ts` are gone.
- Drafting and the preview share `planDueRentalInvoices` (`sales.service.ts`). The live test is in `apps/erp/test/database/create-rental-invoices.test.ts`.
