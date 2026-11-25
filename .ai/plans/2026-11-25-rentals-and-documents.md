# Rentals and documents fixes — implementation plan
**Spec / source:** .ai/specs/2026-11-25-rentals-and-documents.md
**Branch:** fix/rentals-and-documents
> **Later changes (after the browser test and review rounds).** The branch has 4 migrations, not 2: `20261125091117_invoice-automation-manual-agreements-only.sql` (a CHECK keeps Manual off the company setting and contracts) and `20261125121101_quote-send-via-email.sql` (`quote.sendViaEmail`). The Won step now starts from the Send Via picked at Finalize (it no longer starts on None); the sales order Confirm dialog still starts on None. The sales order Ship To prints for a drop shipment only. The Rental Site sets the bill-to and the ship-to of later invoices. Early invoices carry a hold. The spec is the source of truth for these.

## Progress
- [x] Task 0: Cherry-pick #2362 (done: commit 3aeadf5238)
- [x] Task 1: Write the two migrations (Manual enum value, sales order ship-to view columns)
- [x] Task 2: Apply the migrations and regenerate the DB types (MAIN AGENT ONLY)
- [x] Task 3: Add the pure helpers (`invoiceAutomationPosts`, `generatePeriodsForPending`) with unit tests
- [x] Task 4: Wire the Manual value through the server, jobs and models
- [x] Task 5: Build the server side of "invoice the next N periods"
- [x] Task 6: Let an Active agreement change its Rental Site, with the customer check
- [x] Task 7: Build the Invoice dialog
- [x] Task 8: Show Manual on the agreement's Invoicing select, and make the Rental Site editable while Active
- [x] Task 9: Start Send Via on None and warn before an email
- [x] Task 10: Add the Ship To block to the sales order template
- [x] Task 11: Fill every template sample and update the snapshots
- [x] Task 12: Show tax on the service contract Review step
- [x] Task 13: Update AGENTS.md, rules and the reader docs
- [x] Task 14: Extract and translate the new strings (MAIN AGENT ONLY)
- [x] Task 15: Run the final verification (MAIN AGENT ONLY)

## Dependencies

| Task | Depends on | Can run in parallel with |
|---|---|---|
| 1 | — | 9, 12 |
| 2 | 1 | 9, 12 |
| 3 | 2 | 9, 10, 12 |
| 4 | 3 | 9, 10, 11, 12 |
| 5 | 4 | 9, 10, 11, 12 |
| 6 | 5 | 9, 10, 11, 12 |
| 7 | 5 | 8, 9, 10, 11, 12 |
| 8 | 4, 6 | 7, 9, 10, 11, 12 |
| 9 | — | every task up to 13 |
| 10 | 2 | 3–9, 12 |
| 11 | 10 | 4–9, 12 |
| 12 | — | every task up to 13 |
| 13 | 4–12 | — |
| 14 | 7, 8, 9, 12 | — |
| 15 | every task | — |

- Tasks 4, 5 and 6 all edit `sales.service.ts` and `sales.server.ts`. Run them one after the other, in one subagent if you can.
- Tasks 7 and 8 edit different files. Task 7 owns `RentalAgreementHeader.tsx`, `RentalNextInvoice.tsx` and the new dialog. Task 8 owns `RentalAgreementProperties.tsx` and every other select.
- Tasks 10 and 11 both edit `packages/documents` snapshots and `salesOrder.samples.ts`. Run 11 after 10.
- Task 9 and Task 12 touch files no other task touches. Start them at once.
- A subagent never runs the `erp` typecheck, `pnpm generate:mcp`, `pnpm check:manifest` or raw `tsc` in `apps/erp`. The main agent runs them once, in Task 15.

Decisions. The spec records each one (Design decisions table).

| # | Question | Decision | Task |
|---|---|---|---|
| A | Where is Manual offered? | Only on the agreement's own Invoicing select (`rentalAgreement.invoiceAutomation`). The company setting does not offer it, and its validator refuses it. Contracts never offer it. So no contract and no company default is ever Manual. (User decision.) | 4, 8 |
| B | The daily run skips a Manual agreement. Does it still roll periods forward and draft the early-return credit memo? | Yes. It cuts periods and drafts the credit memo (a credit memo stays Draft in every mode). It drafts no invoice. | 4 |
| C | An Active agreement can have unbilled charges and no Pending period (a fixed term fully billed, then a damage charge). | The dialog allows N = 0 only when no Pending period is left and at least one charge is due (`chargeDate <= today`). Then it bills the due charges alone. Otherwise N >= 1. (User decision.) | 5, 7 |
| D | Step 3 of the spec said "each live line". A Returned line can still hold an unbilled Pending period (re-cut at the return). | Take the first N Pending non-adjustment periods of every line of the agreement. A Returned line has fewer, so it adds what it has. | 5 |
| E | `ContractSummary` renders on the Review step and on the contract page (`$id.details.tsx:135`). | Show tax on both. | 12 |

---

## Task 1: Write the two migrations (Manual enum value, sales order ship-to view columns)
**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_invoice-automation-manual.sql` — adds `Manual` to `invoiceAutomation`.
- Create: `packages/database/supabase/migrations/<timestamp>_sales-order-ship-to.sql` — adds the ship-to address to `salesOrderLocations`.
- Copy from (precedent): `packages/database/supabase/migrations/20260430000001_tax-status.sql` (newest `salesOrderLocations`, `CREATE OR REPLACE VIEW "salesOrderLocations"`); `packages/database/supabase/migrations/20261006221401_sales-invoice-discount-and-ship-to.sql` (the invoice ship-to joins, `sis` / `scl` / `sa` / `scc` / `sc`).

**Facts checked:**
- `invoiceAutomation` is used only by `companySettings`, `rentalAgreement` and `customerContract`. The views `rentalAgreements` (`20261119231546_rental-agreements-tax-code.sql:13`) and `customerContracts` (`20261021013300_contract-billing-basis.sql:31`) read it through `COALESCE` only. No view casts it, no SQL function reads it (`grep -rln invoiceAutomation packages/database/src --include=*.sql` is empty). So the new value needs no view or function refresh.
- `invoiceAutomation` is not a dataset `COVERAGE` set (`grep invoiceAutomation packages/database/src/datasets/*.ts` is empty). The rentals tier keeps `Draft Only` (`packages/database/src/datasets/tiers/rentals.ts:91`). No dataset change.
- `salesOrderLocations` lists explicit columns (no `so.*`), so appending columns at the end is `CREATE OR REPLACE`-safe (`.ai/lessons.md` → "CREATE OR REPLACE VIEW cannot reorder columns").
- `salesOrderShipment` is keyed by the order id and has `dropShipment boolean` and `customerLocationId` (`packages/database/src/types.ts:73411` block). The ship-to rule is `orderShipToCustomerLocationId` (`apps/erp/app/modules/shared/shared.service.ts:9371`) and `resolveSalesOrderShipTo` (`packages/ee/src/rules/sales/server.ts:335`): a drop shipment's own location, else the header's `customerLocationId`, never a fallback.

**Steps:**
1. Run `pnpm db:migrate:new invoice-automation-manual`. Confirm the file name's HHMMSS is not `000000`.
2. Write this SQL into it:
   ```sql
   -- Manual: Carbon never creates invoices for the agreement on its own. A
   -- person bills its periods with Invoice (spec 2026-11-25-rentals-and-documents).
   -- Only a rental agreement takes it; the app refuses it for the company
   -- setting and for contracts.
   ALTER TYPE "invoiceAutomation" ADD VALUE IF NOT EXISTS 'Manual' BEFORE 'Draft Only';
   ```
3. Run `pnpm db:migrate:new sales-order-ship-to`. Confirm the HHMMSS is not `000000`.
4. Write this SQL into it. Copy every existing column and join from `20260430000001_tax-status.sql` unchanged, then append the new ones at the end:
   ```sql
   -- Forked from 20260430000001_tax-status.sql. Adds the order's ship-to address
   -- for the sales order PDF: the drop-ship location when Drop Shipment is on,
   -- else the order's location (orderShipToCustomerLocationId, shared.service.ts).
   CREATE OR REPLACE VIEW "salesOrderLocations" WITH(SECURITY_INVOKER=true) AS
     SELECT
       so.id,
       c.name AS "customerName",
       ca."addressLine1" AS "customerAddressLine1",
       ca."addressLine2" AS "customerAddressLine2",
       ca."city" AS "customerCity",
       ca."stateProvince" AS "customerStateProvince",
       ca."postalCode" AS "customerPostalCode",
       ca."countryCode" AS "customerCountryCode",
       cc."name" AS "customerCountryName",
       ctx."taxId" AS "customerTaxId",
       ctx."vatNumber" AS "customerVatNumber",
       ctx."eori" AS "customerEori",
       pc.name AS "paymentCustomerName",
       pa."addressLine1" AS "paymentAddressLine1",
       pa."addressLine2" AS "paymentAddressLine2",
       pa."city" AS "paymentCity",
       pa."stateProvince" AS "paymentStateProvince",
       pa."postalCode" AS "paymentPostalCode",
       pa."countryCode" AS "paymentCountryCode",
       pn."name" AS "paymentCountryName",
       stc.name AS "shipToCustomerName",
       sta."addressLine1" AS "shipToAddressLine1",
       sta."addressLine2" AS "shipToAddressLine2",
       sta."city" AS "shipToCity",
       sta."stateProvince" AS "shipToStateProvince",
       sta."postalCode" AS "shipToPostalCode",
       sta."countryCode" AS "shipToCountryCode",
       stn."name" AS "shipToCountryName"
     FROM "salesOrder" so
     INNER JOIN "customer" c
       ON c.id = so."customerId"
     LEFT OUTER JOIN "customerTax" ctx
       ON ctx."customerId" = c.id
     LEFT OUTER JOIN "customerLocation" cl
       ON cl.id = so."customerLocationId"
     LEFT OUTER JOIN "address" ca
       ON ca.id = cl."addressId"
     LEFT OUTER JOIN "country" cc
       ON cc.alpha2 = ca."countryCode"
     LEFT OUTER JOIN "salesOrderPayment" sop
       ON sop.id = so.id
     LEFT OUTER JOIN "customer" pc
       ON pc.id = sop."invoiceCustomerId"
     LEFT OUTER JOIN "customerLocation" pl
       ON pl.id = sop."invoiceCustomerLocationId"
     LEFT OUTER JOIN "address" pa
       ON pa.id = pl."addressId"
     LEFT OUTER JOIN "country" pn
       ON pn.alpha2 = pa."countryCode"
     LEFT OUTER JOIN "salesOrderShipment" sos
       ON sos.id = so.id
     LEFT OUTER JOIN "customerLocation" stl
       ON stl.id = CASE
         WHEN sos."dropShipment" THEN sos."customerLocationId"
         ELSE so."customerLocationId"
       END
     LEFT OUTER JOIN "address" sta
       ON sta.id = stl."addressId"
     LEFT OUTER JOIN "country" stn
       ON stn.alpha2 = sta."countryCode"
     LEFT OUTER JOIN "customer" stc
       ON stc.id = stl."customerId";
   ```
5. Before you save, diff the copied part against `20260430000001_tax-status.sql`. If the newest definition differs from the block above, STOP and report. Do not improvise.

**Verify:**
- `ls packages/database/supabase/migrations | tail -2` → the two new files.
- `pnpm --filter @carbon/checks exec vitest run src/run.test.ts` → passes (covers `migration-replay-safe`).

**Out of scope:** applying the migration (Task 2), any RLS change, any dataset change.

---

## Task 2: Apply the migrations and regenerate the DB types (MAIN AGENT ONLY)
**Depends on:** Task 1
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/src/constants.ts`, `packages/database/src/swagger-docs-schema.ts` — by the generator only.

**Steps:**
1. 🛑 Never rebuild the database. Apply pending migrations only.
2. Run `pnpm db:migrate`.
3. Run `pnpm run generate:types`.

**Verify:**
- `grep -n '"Manual"' packages/database/src/constants.ts` → one hit in the `invoiceAutomation` list.
- `grep -n "shipToCountryName" packages/database/src/types.ts` → hits in the `salesOrderLocations` view type.
- `pnpm --filter @carbon/database typecheck` → exit 0.

**Out of scope:** hand-editing any generated file.

---

## Task 3: Add the pure helpers (`invoiceAutomationPosts`, `generatePeriodsForPending`) with unit tests
**Depends on:** Task 2 (the `InvoiceAutomation` type must include `Manual`)
**Files:**
- Modify: `packages/utils/src/rental-invoice-plan.ts` — add `invoiceAutomationPosts`; `planRentalInvoices` (`:55-99`) treats Manual like Draft Only.
- Modify: `packages/database/src/rental-periods.ts` — add `generatePeriodsForPending` after `generateRentalBillingPeriods` (`:326`).
- Modify: `packages/utils/src/rental-invoice-plan.test.ts`, `packages/database/src/rental-periods.test.ts` — new cases.
- No change: `contractInvoiceHold` (`contract-invoice-plan.ts:30`) and `projectInvoiceHold` (`project-billing.ts:499`). A contract is never Manual (decision A), so their `"Draft Only"` test stays correct.

**Steps:**
1. In `rental-invoice-plan.ts`, after `effectiveInvoiceAutomation` (`:102-107`), add:
   ```ts
   /** Whether invoices under this mode post (and send) on their own. Draft
    *  Only and Manual leave every invoice a draft that a person posts. */
   export function invoiceAutomationPosts(
     mode: InvoiceAutomation | null | undefined
   ): boolean {
     return !!mode && mode !== "Draft Only" && mode !== "Manual";
   }
   ```
2. In `planRentalInvoices`, replace `if (mode === "Draft Only")` (`:61`) with `if (!invoiceAutomationPosts(mode))`. Update the TSDoc bullet at `:46` to "Draft Only and Manual → one combined invoice, no hold".
3. Leave the contract and project hold functions alone (see Files).
4. In `rental-periods.ts`, add:
   ```ts
   /** `generateRentalBillingPeriods` for an open-ended line, with `through`
    *  moved forward until the line holds at least `minPending` Pending
    *  non-adjustment periods (its rows plus the periods cut now). An early
    *  invoice bills that many periods ahead. Each pass adds one period. A
    *  fixed term or a returned line is generated as it is. */
   export function generatePeriodsForPending(
     args: Parameters<typeof generateRentalBillingPeriods>[0] & {
       minPending: number;
     }
   ): RentalBillingPlan
   ```
   Body:
   1. If `args.endDate !== null` or `args.returnedAt !== null`, return `generateRentalBillingPeriods(args)`.
   2. Count `held` = rows in `args.existing` with `status === "Pending"` and `!isAdjustment`.
   3. Loop at most `args.minPending + 1` times. Each pass calls `generateRentalBillingPeriods({ ...args, through })`. Start with `through = args.through`.
   4. Stop when `held + plan.create.length >= args.minPending`. Else set `through` to the `periodEnd` of the last period in `plan.create` (or the last existing period when `create` is empty).
   5. Return the last plan.
5. Add unit tests. Expected values are literals.
   - `rental-invoice-plan.test.ts`: "Manual keeps rent and charges on one unheld invoice" (copy the Draft Only case at `:34`). An `it.each` table for `invoiceAutomationPosts`: `Draft Only` → false, `Manual` → false, `null` → false, `Post` → true, `Post and Email` → true, `Post and Send via Stripe` → true.
   - `rental-periods.test.ts`: worked example. Calendar Month, Advance, Month rate 300, `startDate` 2026-09-01, `endDate` null, existing rows Sep (Invoiced) and Oct (Pending), `through` 2026-11-30 (`billingHorizon("Calendar Month", "2026-10-05")`), `minPending` 6. Expect `create` period starts `["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"]` (Oct + 5 = 6 Pending). Second case: `minPending` 1 returns the same `create` as plain `generateRentalBillingPeriods` (`["2026-11-01", "2026-12-01"]`). Third case: a fixed term (`endDate` 2026-12-31) returns the plain plan whatever `minPending` is.

**Verify:**
- `pnpm --filter @carbon/utils test` → passes.
- `pnpm --filter @carbon/database exec vitest run src/rental-periods.test.ts` → passes.
- `pnpm --filter @carbon/utils typecheck` and `pnpm --filter @carbon/database typecheck` → exit 0.
- `pnpm exec biome check packages/utils/src/rental-invoice-plan.ts packages/utils/src/rental-invoice-plan.test.ts packages/database/src/rental-periods.ts packages/database/src/rental-periods.test.ts` → no errors.

**Out of scope:** callers of the helpers (Tasks 4 and 5); contract and project holds.

---

## Task 4: Wire the Manual value through the server, jobs and models
**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `invoiceAutomations` (`:1544`) gains `"Manual"` first, for the agreement validator (`rentalAgreementInvoiceAutomationValidator`, `:1645`); add `contractInvoiceAutomations` for the contract validators (`customerContractValidator` `:2062`, `customerContractInvoiceAutomationValidator` `:2938`).
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `invoiceAutomations` (`:52`) stays without Manual; fix its comment. `invoiceAutomationValidator` (`:303`) and `settings.server.ts:345` read this array, so the company setting refuses Manual.
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `draftAgreementInvoices` (`:17097`) drafts no invoice for a Manual agreement in a company-wide run.
- Modify: `apps/erp/app/modules/sales/sales.server.ts` — `setContractInvoiceAutomation` input (`:4697-4700`); `sellRentalUnit` (`:6068`).
- Modify: `packages/jobs/src/inngest/functions/tasks/invoice-automate.ts` — `:48`.
- Modify: `packages/jobs/src/invoicing/automate-invoice.ts` — `:233` (and the comment at `:200`).
- Modify: `apps/erp/test/database/fixtures/rental.ts` — an `invoiceAutomation` option.
- Modify: `apps/erp/test/database/create-rental-invoices.test.ts` — Manual cases.
- No change: `confirmContract` (`sales.server.ts:4786`), `contract+/$id.invoice.tsx:87`, `recurring-billing.ts:642`, and the contract and project holds. A contract is never Manual, and the daily run drafts no invoice for a Manual agreement, so no `"Draft Only"` test there can meet Manual.

**Why the automation sites still change:** a Manual agreement can still get an invoice from Sell to Customer (`sellRentalUnit`, `:6049`). `sellRentalUnit` fires `invoice-automate` for every invoice that is not Draft Only (`:6068`), and `invoice-automate` reads the agreement's mode when the event carries none (`invoice-automate.ts:35-38`). `findInvoicesToAutomate` re-reads the agreement's mode for system drafts of the last 3 days (`automate-invoice.ts:216-235`), so an agreement switched to Manual after the run must not post them. Each of the 3 sites must treat Manual like Draft Only.

**Steps:**
1. `sales.models.ts:1544`: write the array as `["Manual", "Draft Only", "Post", "Post and Email", "Post and Send via Stripe"] as const`. Update its TSDoc: "What happens to an invoice the daily run creates for a rental agreement — the DB enum `invoiceAutomation`. Manual: the daily run creates no invoice. Only an agreement takes Manual; the company setting and contracts use their own lists."
2. Below it, add:
   ```ts
   /** The modes a contract can choose: every mode but Manual, which only a
    *  rental agreement takes. */
   export const contractInvoiceAutomations = [
     "Draft Only",
     "Post",
     "Post and Email",
     "Post and Send via Stripe"
   ] as const;
   ```
3. In `customerContractValidator` (`:2062`) and `customerContractInvoiceAutomationValidator` (`:2938`), replace `invoiceAutomations` with `contractInvoiceAutomations`. Keep `rentalAgreementInvoiceAutomationValidator` (`:1645`) on `invoiceAutomations`.
4. `settings.models.ts:52`: keep the 4 values. New comment: "The company default for invoices the daily job creates. Every `invoiceAutomation` value but Manual: Manual is set per rental agreement only, so no agreement or contract inherits it."
5. `setContractInvoiceAutomation` (`sales.server.ts:4697-4700`): change the input to `z.enum(contractInvoiceAutomations).nullable()`. Leave its body unchanged.
6. `draftAgreementInvoices` (`sales.service.ts:17097`): after the `creditMemos` block (`:17166-17181`) and before the `for (const invoice of planned)` loop, add:
   ```ts
   // A company-wide run (the daily job) drafts no invoice for a Manual
   // agreement; a person bills it with Invoice. A run for one agreement
   // (Sell to Customer) bills it whatever its mode.
   if (mode === "Manual" && !args.rentalAgreementId) {
     return { invoices: [], creditMemos };
   }
   ```
   The roll-forward and the credit memo above it still run (decision B). Add one sentence on Manual to the TSDoc of `createRentalInvoicesForDuePeriods` (`:16705-16719`).
7. `sellRentalUnit` (`:6068`): `invoice.mode !== "Draft Only"` → `invoiceAutomationPosts(invoice.mode)`.
8. `invoice-automate.ts:48`: `if (!mode || mode === "Draft Only")` → `if (!invoiceAutomationPosts(mode))`. A resend still maps to `Post and Email` first (`:44-47`), so a person can resend a posted invoice of a Manual agreement.
9. `automate-invoice.ts:233`: `if (!mode || mode === "Draft Only") continue;` → `if (!invoiceAutomationPosts(mode)) continue;`. Fix the comment at `:200` to say "Draft Only or Manual at the time".
10. Import `invoiceAutomationPosts` from `@carbon/utils` in each file above.
11. Grep once more: `grep -rn '"Draft Only"' apps/erp/app packages/jobs/src --include=*.ts --include=*.tsx`. Every hit left must be a label (Task 8), a dataset value, a contract or project site in the "No change" list, or `ContractConfirmModal.tsx:79` (a default). If a hit decides automation for a rental invoice and is not in this task, STOP and report.
12. `fixtures/rental.ts`: add `invoiceAutomation?: Database["public"]["Enums"]["invoiceAutomation"] | null` (default null) and write it on the agreement.
13. DB tests in `create-rental-invoices.test.ts` (`rentalFixture`: Active, open-ended, Oct Pending):
    - "the daily run drafts no invoice for a Manual agreement": `invokePosting(f.ctx, "create-rental-invoices", { asOf: "2026-10-05" }, createRentalInvoices)` with `invoiceAutomation: "Manual"` → `invoices` is `[]`, and Oct is still `Pending`.
    - "a run for one Manual agreement still drafts its invoice": the same call with `rentalAgreementId: f.agreementId` → one invoice, Oct `Invoiced`.

**Verify:**
- `pnpm --filter @carbon/jobs typecheck` → exit 0.
- `pnpm --filter @carbon/jobs exec vitest run src/invoicing/automate-invoice.test.ts` → passes.
- `SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)" pnpm --filter erp exec vitest run test/database/create-rental-invoices.test.ts` → passes, the 2 new cases included (they skip only without a local database).
- `pnpm exec biome check <every file above>` → no errors.

**Out of scope:** the selects and texts (Task 8); the early invoice (Task 5); a database CHECK on `companySettings.invoiceAutomation` (the validator is the gate; ask the user before adding a CHECK to `companySettings`).

---

## Task 5: Build the server side of "invoice the next N periods"
**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — add `RENTAL_EARLY_INVOICE_MAX_PERIODS` and `rentalEarlyInvoiceValidator`.
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — extend `rollBillingPeriodsForward` (`:17421`), `selectDueRentalRows` (`:16843`) and `planDueRentalInvoices` (`:16941`); extract `agreementCurrencyDecimals` out of `draftAgreementInvoices` (`:17117-17131`); add `RentalEarlyInvoiceRefusal`, `EarlyRentalInvoice` and `draftEarlyRentalInvoice`.
- Modify: `apps/erp/app/modules/sales/sales.server.ts` — add `previewRentalAgreementInvoice` and `invoiceRentalAgreementPeriods` next to `sellRentalUnit` (`:5956`).
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.invoice.tsx` — rewrite: one action that calls `invoiceRentalAgreementPeriods`.
- Create: `apps/erp/app/routes/api+/rental-agreement.$id.invoice-preview.ts` — the preview loader, cached by URL.
- Modify: `apps/erp/app/utils/path.ts` — add `path.to.api.rentalAgreementInvoicePreview(id, periods)` in the `api` group next to `salesOrderDeliveryDate` (`:394`).
- Modify: `apps/erp/test/database/fixtures/rental.ts` — `endDate` and `charges` options.
- Modify: `apps/erp/test/database/create-rental-invoices.test.ts` — early invoice cases.
- Copy from (precedent): `sellRentalUnit` (`sales.server.ts:5956-6080`) for the operation shape and `service.companyToday(ctx)` (`sales.service.ts:16621`); `PreviewRollback` + `inTransaction` (`sales.service.ts:22784-22802`) for the preview; `apps/erp/app/routes/api+/sales-order.$orderId.delivery-date.ts` for the cached preview loader.

**Design (decided):**
- The Invoice button no longer runs "what's due". `generateRentalInvoicesNow` (`:13853`) stays: Sell to Customer still calls it (`sales.server.ts:6049`).
- The early invoice is always one Draft invoice, plan `Draft Only`, no hold, `dateIssued` = company today, `createdBy` = `ctx.auditUserId`. `findInvoicesToAutomate` reads only `createdBy = 'system'` (`automate-invoice.ts:196`), and the operation fires no `invoice-automate`. So nothing posts it.
- It takes the first N Pending non-adjustment periods of every line (decision D), plus unbilled charges with `chargeDate <= today`. It drafts no credit memo: the daily run drafts those (decision B).
- N = 0 is allowed only when the agreement has no Pending non-adjustment period left (after the roll-forward) and at least one charge is due. It then bills the due charges alone (decision C). Otherwise N >= 1.

**Steps:**
1. `sales.models.ts`, near `invoiceAutomations`:
   ```ts
   /** The most periods an early invoice bills on an open-ended agreement. */
   export const RENTAL_EARLY_INVOICE_MAX_PERIODS = 12;

   export const rentalEarlyInvoiceValidator = z.object({
     periods: zfd.numeric(z.number().int().min(0))
   });
   ```
   The validator takes 0 (charges only) and has no upper bound: a fixed term may have more than 12 Pending periods ("bill the whole term"). The server decides when 0 is allowed, caps an open-ended agreement at 12 and a fixed term at its Pending count (step 6).
2. Extract `agreementCurrencyDecimals(trx, companyId, currencyCode): Promise<number>` from `draftAgreementInvoices` (`:17117-17131`, the `currency` read and its throw). Call it from `draftAgreementInvoices` and from the new block.
3. `rollBillingPeriodsForward` (`:17421`): add `minPendingPeriods?: number` to `args`. In the `lines.flatMap` (`:17484`), call `generatePeriodsForPending({ ...sameArgs, minPending: args.minPendingPeriods })` when `args.minPendingPeriods` is above 0, else `generateRentalBillingPeriods` as today. `generatePeriodsForPending` itself leaves a fixed term unchanged (Task 3). Update the TSDoc.
4. `selectDueRentalRows` (`:16843`): add `nextPeriodsPerLine?: number` to `args`. When it is not `undefined` (0 is a valid value, so never test it for truthiness):
   1. Drop the `p.dueOn <= asOf` filter (`:16876`).
   2. Add `.where("p.isAdjustment", "=", false)`.
   3. Order by `p.rentalAgreementLineId`, then `p.periodStart`.
   4. After `periodQuery.execute()`, keep the first `nextPeriodsPerLine` rows of each `rentalAgreementLineId`, then sort the kept rows by `periodStart` (the order drafting expects).
   The charge query does not change (`chargeDate <= asOf`).
5. `planDueRentalInvoices` (`:16941`): add `nextPeriodsPerLine?: number` to `args` and pass it to `selectDueRentalRows`.
6. Add to `sales.service.ts`, after `draftAgreementInvoices`:
   ```ts
   /** A refusal of an early invoice, written for the person. */
   export class RentalEarlyInvoiceRefusal extends Error {}

   export type EarlyRentalInvoice = {
     /** Null on a preview. */
     invoiceId: string | null;
     lines: LineValues[];
     subtotal: number;
     totalTax: number;
     totalAmount: number;
     /** Pending periods left to bill on the line with the most, after the
      *  roll-forward; null on an open-ended agreement. */
     remainingPeriods: number | null;
     /** Unbilled charges dated on or before today. */
     dueChargeCount: number;
   };

   /** Drafts one Draft invoice for the next `periods` Pending periods of each
    *  line of an Active agreement, and its unbilled charges dated on or
    *  before `today`. An open-ended line first gets its missing periods cut.
    *  `periods` 0 bills the due charges alone, and only when no Pending period
    *  is left. `preview` rolls everything back and returns what would be
    *  drafted. */
   export async function draftEarlyRentalInvoice(
     db: Kysely<KyselyDatabase>,
     args: {
       companyId: string;
       userId: string;
       today: string;
       rentalAgreementId: string;
       periods: number;
       preview: boolean;
     }
   ): Promise<EarlyRentalInvoice>
   ```
   Body, inside `inTransaction<EarlyRentalInvoice, EarlyRentalInvoice>(db, async (trx) => { … })`:
   1. Lock the agreement: `selectFrom("rentalAgreement").selectAll()`, `id`, `companyId`, `status = 'Active'`, `.forUpdate()`. None → throw `new RentalEarlyInvoiceRefusal("Only an active rental agreement can be invoiced")`.
   2. If `agreement.endDate === null` and `periods > RENTAL_EARLY_INVOICE_MAX_PERIODS`, throw a refusal: "An open-ended agreement is invoiced at most 12 periods ahead".
   3. Read `decimals` with `agreementCurrencyDecimals`.
   4. Call `rollBillingPeriodsForward(trx, { companyId, userId, asOf: today, agreementId, cycle, timing, decimals, minPendingPeriods: periods })`.
   5. Count Pending non-adjustment periods per line of the agreement (one grouped query, scoped by `companyId`). `remaining` = the largest count, 0 when none. Count the unbilled charges of the agreement with `chargeDate <= today` (`dueChargeCount`, one query, scoped by `companyId`).
   6. Refuse in this order:
      1. `periods === 0` and `remaining > 0` → "Choose at least one period: periods are still left to invoice".
      2. `periods === 0` and `dueChargeCount === 0` → "Nothing is due to invoice on this agreement".
      3. `periods > 0`, `agreement.endDate !== null` and `periods > remaining` → `remaining === 0 ? "No billing periods are left. Choose 0 to invoice the due charges" : \`Only ${remaining} periods are left to invoice\``. Use the first text only when `dueChargeCount > 0`; else "Nothing is left to invoice on this agreement".
   7. Call `planDueRentalInvoices(trx, { companyId, agreement, mode: "Draft Only", asOf: today, lock: true, nextPeriodsPerLine: periods })`. `planned` holds at most one combined invoice.
   8. If `planned.length === 0`, throw a refusal: "Nothing is left to invoice on this agreement".
   9. Build the result: `lines = planned[0].lines`, totals from `rentalInvoiceTotals(lines)`, `remainingPeriods = agreement.endDate === null ? null : remaining`, `dueChargeCount`.
   10. If `preview`, throw `new PreviewRollback<EarlyRentalInvoice>({ ...result, invoiceId: null })`.
   11. Call `insertRentalInvoice(trx, { companyId, userId, asOf: today, rentalAgreementId }, agreement, lines, null)` (`:17296`). It writes `dateIssued = asOf`, the Rental Site ship-to and the `Invoiced` / `salesInvoiceLineId` stamps (`:17380-17408`).
   12. Return `{ ...result, invoiceId }`.
   If `PreviewRollback` or `inTransaction` turns out to need a different generic shape, adapt only the type arguments. If it cannot carry this result, STOP and report.
7. `sales.server.ts`, after `sellRentalUnit`. Both use `permission: { "sales.rentalAgreements": "Edit", "invoicing.salesInvoices": "Create" }` (the old route's gate, `$id.invoice.tsx:26-29`) and `input: z.object({ rentalAgreementId: z.string(), periods: z.number().int().min(0) })`.
   - `previewRentalAgreementInvoice` (no `@mcp`): `run` calls `service.draftEarlyRentalInvoice(ctx.asSystem.pg, { companyId: ctx.company.id, userId: ctx.auditUserId, today: await service.companyToday(ctx), rentalAgreementId, periods, preview: true })`.
   - `invoiceRentalAgreementPeriods` (TSDoc with `@mcp`, summary "Invoice the next periods of a rental agreement", `@remarks` "One Draft invoice for the next N periods of each unit and the unbilled charges dated today or earlier. Never posted or sent on its own. A fixed term takes at most the periods left; an open-ended agreement at most 12. N = 0 bills the due charges alone, and only when no period is left."): same call with `preview: false`; returns `{ invoiceId }`.
   - In both, catch `service.RentalEarlyInvoiceRefusal` → `ctx.error("rule", err.message)`. Any other throw → `ctx.error("internal", "Failed to invoice the rental agreement", err)`.
   - The agreement read in step 6.1 is scoped by `companyId`, so a foreign id is "Only an active rental agreement can be invoiced".
8. Rewrite `apps/erp/app/routes/x+/rental-agreement+/$id.invoice.tsx`. Keep the SPDX header.
   ```ts
   export async function action(args: ActionFunctionArgs) {
     const input = await validator(rentalEarlyInvoiceValidator).request(args, {
       params: ["id"]
     });
     if ("invalid" in input) return input.invalid;
     const { api } = await authorize(args.request);
     const result = await api.sales.invoiceRentalAgreementPeriods({
       rentalAgreementId: input.params.id,
       periods: input.data.periods
     });
     return respond(args.request, result).redirect(
       result.data
         ? path.to.salesInvoiceDetails(result.data.invoiceId)
         : path.to.rentalAgreementDetails(input.params.id),
       {
         message: "Drafted the invoice",
         onError: path.to.rentalAgreementDetails(input.params.id)
       }
     );
   }
   ```
   Remove the old imports (`batchTrigger`, `generateRentalInvoicesNow`, `getRentalAgreement`, `getDatabaseClient`).
9. Create `apps/erp/app/routes/api+/rental-agreement.$id.invoice-preview.ts` (run the SPDX fixer). Copy the shape of `api+/sales-order.$orderId.delivery-date.ts`: read `periods` from the search params with `rentalEarlyInvoiceValidator.safeParse`, call `api.sales.previewRentalAgreementInvoice(...)`, log a refusal with `getLogger("erp", "rental-invoice-preview")` at `warn`, return the result, and export `clientLoader = cachedClientLoader<typeof loader>()`.
10. `path.ts`, in the `api` group:
    ```ts
    rentalAgreementInvoicePreview: (id: string, periods: number) =>
      `${generatePath(`${api}/rental-agreement/${id}/invoice-preview`)}?${new URLSearchParams({ periods: String(periods) })}`,
    ```
11. `fixtures/rental.ts`: add `endDate?: string` (default null). When set, insert one Pending period per calendar month from November through `endDate` after the existing Sep (Invoiced) and Oct (Pending) rows, at the same amount (300). Add `charges?: { chargeDate: string; amount: number }[]` (default none): one unbilled `Charge` row each on the first line. Keep every current caller's default unchanged.
12. DB tests in `create-rental-invoices.test.ts`. Call `draftEarlyRentalInvoice(f.db, { companyId: f.companyId, userId: "system", today: "2026-10-05", rentalAgreementId: f.agreementId, periods, preview })` directly.
    - AC1: fixed term `endDate` 2026-12-31 (Oct, Nov, Dec Pending), `periods` 2 → one Draft invoice with 2 Rent lines (Oct, Nov). Oct and Nov are `Invoiced` with their `salesInvoiceLineId`; Dec stays `Pending`. Then `invokePosting(f.ctx, "create-rental-invoices", { asOf: "2026-12-05" }, createRentalInvoices)` bills only Dec.
    - AC2: the same fixture with `preview: true` and `periods` 1 → `remainingPeriods` is 3, `invoiceId` is null, and no period changed status.
    - AC3: open-ended fixture, `periods` 13 → the refusal. `periods` 6 → 6 Rent lines from Oct to Mar 2027, and the Nov–Mar rows now exist as `Invoiced`.
    - Fixed term, `periods` 4 → the refusal "Only 3 periods are left to invoice".
    - AC4: fixture with `invoiceAutomation: "Post and Email"` → the invoice is `Draft` with `automationHoldReason` null.
    - AC6: delete the Draft through `deleteSalesInvoiceReleasingRentals(f.db, { companyId, invoiceId, userId })` (`sales.service.ts:14065`) → Oct and Nov are `Pending` again.
    - A Closed agreement → the refusal "Only an active rental agreement can be invoiced".
    - AC15: fixed term `endDate` 2026-10-31 (Oct the only Pending period), plus one unbilled charge dated 2026-10-03. `periods` 0 → refused ("Choose at least one period…"). `periods` 1 → one invoice with the Oct Rent line and the charge. Then a second charge dated 2026-10-04: `periods` 0 → one Draft invoice with only that charge line, and the charge carries its `salesInvoiceLineId`.
    - No period left and no due charge (a charge dated 2026-10-20): `periods` 0 → "Nothing is due to invoice on this agreement".
    If a fixture needs a column it does not have, add it to the fixture with a default that keeps every current test green.

**Verify:**
- `SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)" pnpm --filter erp exec vitest run test/database/create-rental-invoices.test.ts test/database/create-rental-invoices-monthly-cycle.test.ts` → passes.
- `pnpm exec biome check apps/erp/app/modules/sales/sales.service.ts apps/erp/app/modules/sales/sales.server.ts apps/erp/app/modules/sales/sales.models.ts "apps/erp/app/routes/x+/rental-agreement+/\$id.invoice.tsx" "apps/erp/app/routes/api+/rental-agreement.\$id.invoice-preview.ts" apps/erp/app/utils/path.ts apps/erp/test/database` → no errors.
- `pnpm --filter @carbon/checks exec vitest run src/run.test.ts` → passes (`route-action-shape`, `service-fn-file`, `no-unscoped-kysely-write`, `loader-reads-through-api`).

**Out of scope:** the dialog (Task 7); a free amount or a part period (spec non-goal); a credit memo from the dialog.

---

## Task 6: Let an Active agreement change its Rental Site, with the customer check
**Depends on:** Task 5 (same files)
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.server.ts` — `rentalActiveTerms` (`:5301-5305`), the refusal text (`:5339-5346`), the update branch (`:5459-5481`), the TSDoc (`:5307-5322`).
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `updateRentalAgreementInvoiceTerms` (`:9743`), `insertRentalAgreement` (`:9655`), `updateRentalAgreement` (`:9693`); add `refuseForeignRentalSite`.
- Create or modify: a DB test, `apps/erp/test/database/rental-agreement-site.test.ts` (new, SPDX header via the fixer).

**Steps:**
1. Add `"customerLocationId"` to `rentalActiveTerms`. Fix the comment above it.
2. Change the Active refusal to "Only the payment terms, tax and Rental Site of an Active rental agreement can be changed". Add the Rental Site to the TSDoc remarks.
3. In the update branch, build `terms` by field:
   - `paymentTermId` → `{ paymentTermId: data.paymentTermId ?? null }` (as today).
   - `customerLocationId` → `{ customerLocationId: data.customerLocationId ?? null }`.
   - otherwise → the tax pair (as today).
4. `updateRentalAgreementInvoiceTerms`: add `| { customerLocationId: string | null }` to the `terms` union. Update its TSDoc ("The payment terms, the tax code and percent, or the Rental Site").
5. Add to `sales.service.ts`, next to `rentalRefusal` (`:9682`):
   ```ts
   /** A Rental Site belongs to the agreement's customer. Null when the site is
    *  empty or the customer's; else the refusal. */
   async function refuseForeignRentalSite(
     client: SupabaseClient<Database>,
     args: {
       companyId: string;
       customerId: string;
       customerLocationId: string | null | undefined;
     }
   )
   ```
   Body: return null when `customerLocationId` is empty. Else read `customerLocation` `id` with `.eq("id", …).eq("customerId", …).eq("companyId", …).maybeSingle()`. A read error → return `{ data: null, error }`. No row → return `rentalRefusal("RENTAL_SITE_WRONG_CUSTOMER", "The Rental Site must be a location of the agreement's customer")`.
6. Call it:
   - In `insertRentalAgreement`, before the insert, with the payload's `customerId` and `customerLocationId`.
   - In `updateRentalAgreement`, after the Draft check (`:9707-9719`), with the payload's `customerId` and `customerLocationId`.
   - In `updateRentalAgreementInvoiceTerms`, when `"customerLocationId" in args.terms`: first read the agreement's `customerId` (`.eq("id").eq("companyId").in("status", ["Draft","Active"]).single()`), then check.
   If any of the three callers has no `customerId` in hand, STOP and report.
7. DB test (`postgrestTest` from `fixtures/local-supabase.ts:109`, `rentalFixture`):
   1. Insert 2 `address` + `customerLocation` rows through `f.db`: one for the fixture's customer, one for a second customer of the same company.
   2. AC7: `updateRentalAgreementInvoiceTerms(client, { …, terms: { customerLocationId: ownSite } })` → no error, the agreement holds the new site. Then `draftEarlyRentalInvoice` (Task 5) → the new invoice's `salesInvoiceShipment.customerLocationId` is the new site.
   3. AC8 Active: the same call with the other customer's site → `error.code === "RENTAL_SITE_WRONG_CUSTOMER"`, and the agreement keeps its site.
   4. AC8 Draft: set the agreement to Draft through `f.db` (sync GUC as the fixture does), then `updateRentalAgreement(client, {...terms, customerLocationId: otherSite})` → the same refusal code.
   If the fixture's customer has no id you can reach, add it to the fixture's return value.

**Verify:**
- `SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)" pnpm --filter erp exec vitest run test/database/rental-agreement-site.test.ts` → passes (skips only without a local stack).
- `pnpm exec biome check apps/erp/app/modules/sales/sales.server.ts apps/erp/app/modules/sales/sales.service.ts apps/erp/test/database/rental-agreement-site.test.ts` → no errors.

**Out of scope:** a site snapshot on delivery shipments (spec non-goal; a Delivery Ticket reprint reads the site live, `packages/lib/src/packing-slip-document.server.tsx:424`); the UI (Task 8).

---

## Task 7: Build the Invoice dialog
**Depends on:** Task 5
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Rentals/RentalInvoiceLinesTable.tsx` — the lines + Subtotal / Tax / Total table, moved out of `RentalNextInvoice.tsx:110-182`.
- Create: `apps/erp/app/modules/sales/ui/Rentals/RentalInvoiceModal.tsx` — the dialog.
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalNextInvoice.tsx` — use the shared table; show a Manual note.
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementHeader.tsx` — the Invoice button opens the dialog; remove the `invoice` confirm (`:64`, `:164-169`, `:332-340`).
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Contracts/ContractLineBuildModal.tsx` (thin shell, body inside `ModalContent`); `apps/erp/app/modules/sales/ui/SalesOrder/useDeliveryDateCheck.ts:79` (`useLoaderQuery` with `keepPreviousData`); sibling card `RentalNextInvoice.tsx`.

**Steps:**
1. Run the SPDX fixer on each new file (`pnpm --filter @carbon/checks license-headers`).
2. `RentalInvoiceLinesTable.tsx`: props `{ lines: RentalInvoiceLineValues[]; subtotal: number; totalTax: number; totalAmount: number; currencyCode: string }`. Move the `<Table>` block from `RentalNextInvoice.tsx` unchanged (description, tax %, amount, the three footer rows, `RentalMoney`, `formatPercent`). `RentalNextInvoice` renders it in place of the inline table.
3. `RentalNextInvoice.tsx`: when `rentalAgreement.effectiveInvoiceAutomation === "Manual"`, the card description reads `<Trans>Carbon never creates invoices for this agreement. Use Invoice to bill periods yourself.</Trans>`, and "Drafted on …" is not shown. The plan table still shows.
4. `RentalInvoiceModal.tsx`: `export default function RentalInvoiceModal({ open, onClose, rentalAgreement })`. Shell: `<Modal open={open} onOpenChange={(o) => !o && onClose()}>` + `ModalOverlay` + `ModalContent` with `<RentalInvoiceBody …/>`. Never `{open && …}`.
5. `RentalInvoiceBody` (inside `ModalContent`, so its state resets on each open):
   1. `const [periods, setPeriods] = useState(initialPeriods)`. The shell takes `initialPeriods` from the header (step 6): 1 when the agreement has a Pending non-adjustment period, else 0.
   2. `const preview = useLoaderQuery<typeof loader>(path.to.api.rentalAgreementInvoicePreview(id, periods), { keepPreviousData: true })` with the loader type imported from the api route (type-only).
   3. `ValidatedForm` with `validator={rentalEarlyInvoiceValidator}`, `method="post"`, `action={path.to.rentalAgreementInvoice(id)}`, no fetcher (the action redirects to the invoice).
   4. Header: `<ModalTitle><Trans>Invoice {readableId}</Trans></ModalTitle>`.
   5. Body row: "Invoice the next" + `NumberControlled name="periods"` (`minValue={initialPeriods === 0 ? 0 : 1}`, `maxValue` = `remainingPeriods ?? RENTAL_EARLY_INVOICE_MAX_PERIODS`, `value={periods}`, `onChange={setPeriods}`) + `<Plural value={periods} one="period" other="periods" />`. When `periods` is 0, show `<Trans>No billing periods are left. This invoice bills the due charges only.</Trans>` above the table. The server still decides (Task 5 step 6).
   6. When `remainingPeriods !== null` (fixed term), show a `Button variant="secondary" size="sm"` "All remaining" that sets `periods` to `remainingPeriods`. An open-ended agreement shows no button.
   7. While the query is fetching for more than 300 ms (`useSpinDelay`, as the precedent), dim the table. On `preview.data?.error`, show an `Alert variant="destructive"` with its message and disable Confirm.
   8. Otherwise render `RentalInvoiceLinesTable` from `preview.data.data`.
   9. Footer: Cancel (`Button variant="secondary"`) and `<Submit isDisabled={!preview.data?.data}>` "Create Draft Invoice".
   10. A short helper line: `<Trans>The invoice stays a draft. Nothing is posted or emailed.</Trans>`.
   If `NumberControlled` does not exist in `~/components/Form`, use the controlled number field the precedent modal uses and report the substitution.
6. `RentalAgreementHeader.tsx`: add `const invoiceDisclosure = useDisclosure()`. The Invoice button (`:332-340`) calls `invoiceDisclosure.onOpen`. Compute `hasPendingPeriod = periods.some((p) => p.status === "Pending" && !p.isAdjustment)` from the `periods` prop (`:53`). Render `<RentalInvoiceModal open={invoiceDisclosure.isOpen} onClose={invoiceDisclosure.onClose} rentalAgreement={rentalAgreement} initialPeriods={hasPendingPeriod ? 1 : 0} />`. If `RentalBillingPeriod` has no `status` or `isAdjustment`, STOP and report. Remove `"invoice"` from `PendingAction` and from `confirmProps`. Keep `canInvoice` (`:88-89`) as the button's gate.
7. Do not add `useEffect`. The URL change is what loads a new preview.

**Verify:**
- `pnpm exec biome check apps/erp/app/modules/sales/ui/Rentals` → no errors.
- `pnpm --filter @carbon/checks exec vitest run src/run.test.ts` → passes (`no-unmounting-dialog`, `no-unguarded-submit`, `no-state-copy-of-loader-data`).
- Typecheck runs in Task 15 (MAIN AGENT ONLY).

**Out of scope:** the server rules (Task 5); browser testing (offer `/test` to the user after Task 15).

---

## Task 8: Show Manual on the agreement's Invoicing select, and make the Rental Site editable while Active
**Depends on:** Task 4, Task 6
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/useInvoiceAutomationHint.tsx` — the Manual case.
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementProperties.tsx` — labels (`:192-200`); Rental Site editable while Active (`:302-315`).
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementBilling.tsx` — labels (`:83-91`).
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementSummary.tsx` — `invoicingScheduleText` (`:286-…`).
- Modify: `apps/erp/app/modules/sales/ui/Contracts/useContractLabels.ts` — `:59` gains a Manual key (TypeScript needs it: `Labels<typeof invoiceAutomations>`).
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractBillTo.tsx` (`:450`) and `ContractProperties.tsx` (`:646`, `:659`) — options from `contractInvoiceAutomations`, so a contract never offers Manual.
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractConfirmModal.tsx` — the `automation` Record (`:134-…`) gains a Manual key, only if TypeScript asks for it (the column type includes Manual).
- No change: `apps/erp/app/routes/x+/settings+/invoicing.tsx`. Its options and labels come from `settings.models.ts` `invoiceAutomations`, which has no Manual (Task 4). If TypeScript refuses `companySettings.invoiceAutomation` (now typed with Manual) as the form's default value, narrow it with a type guard over the settings array and fall back to `"Post and Email"`. Do not add Manual to the page.

**Steps:**
1. `useInvoiceAutomationHint`: add `case "Manual": return t\`Carbon never creates invoices for this agreement. Use Invoice to bill periods yourself.\`` (the spec tooltip). A contract never reaches it.
2. The agreement label maps gain `Manual: t\`Manual\``: `RentalAgreementProperties.tsx:192`, `RentalAgreementBilling.tsx:83`. The select options already map over `invoiceAutomations`, so Manual shows on the agreement's Invoicing select in Properties and in the setup Billing step.
3. `useContractLabels.ts:59`: add `Manual: t\`Manual\`` (exhaustiveness only).
4. `ContractBillTo.tsx:450` and `ContractProperties.tsx:659`: map over `contractInvoiceAutomations` in place of `invoiceAutomations`. Fix the cast at `ContractProperties.tsx:646`.
5. `ContractConfirmModal.tsx`: if TypeScript asks, add `Manual` to the `automation` Record with the Draft Only text. Leave `mode !== "Draft Only"` (`:105`) as it is.
6. `RentalAgreementSummary.tsx` `invoicingScheduleText`: when `mode === "Manual"`, return `<Trans>Carbon never creates invoices for this agreement. Use Invoice to bill periods yourself.</Trans>` for Draft and Active (before the `nextDueOn` branch).
7. `RentalAgreementProperties.tsx`, Rental Site (`:302-315`): `isReadOnly={isInvoicingReadOnly}` and `helperText={invoiceTermHelper}` (the payment terms pattern, `:453-463`). Update the comment above `invoiceTermHelper` (`:217-218`) to name the Rental Site.

**Verify:**
- `grep -rn '"Draft Only": t' apps/erp/app --include=*.tsx --include=*.ts` → every map typed on the sales `invoiceAutomations` has a `Manual` sibling; `invoicing.tsx` has none.
- `pnpm exec biome check <every file above>` → no errors.
- Typecheck runs in Task 15 (MAIN AGENT ONLY).

**Out of scope:** the Invoice dialog (Task 7); the Finalize modal; Manual on the company setting or a contract.

---

## Task 9: Start Send Via on None and warn before an email
**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteToOrderDrawer.tsx` — `:345-348`, `:376`, `:1103-1105`, `:1145-1156`.
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx` — `:115-117`, `:175-184`.
- Modify: `apps/erp/app/components/Form/CustomerContact.tsx` — an `emailNotice` prop.

**Steps:**
1. `CustomerContact.tsx`: add `emailNotice?: (contactName: string) => string` to `CustomerContactSelectProps` (`:19-32`). Under the combobox, when `emailNotice` is set and `selected` exists and `!missingEmail`, render `<p className="text-sm text-muted-foreground">{emailNotice(selected.contact?.fullName || selected.contact?.email || "")}</p>`.
2. `QuoteToOrderDrawer.tsx`:
   1. `:348`: `const defaultNotification = "None";`. Rewrite the comment (`:345-347`): both this default and `NotificationOptionsForm`'s state start on "None"; they must stay equal, else the Radix select clears the value on mount.
   2. `:1103-1105`: `useState("None")`.
   3. On the `CustomerContact` at `:1147`, pass `emailNotice={(name) => t\`This will email the sales order to ${name}.\`}`.
3. `SalesOrderHeader.tsx`:
   1. `:115-117`: `useState<"Email" | "None">("None")`.
   2. On the `CustomerContact` at `:177`, pass the same `emailNotice`.
4. Do not touch `QuoteFinalizeModal.tsx`.
5. Server: `convertQuote` emails only when `notification` is Email (`sales.server.ts:1299-1323`). No server change.

**Verify:**
- `pnpm exec biome check apps/erp/app/modules/sales/ui/Quotes/QuoteToOrderDrawer.tsx apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx apps/erp/app/components/Form/CustomerContact.tsx` → no errors.
- `grep -n 'canEmail ? "Email"' apps/erp/app/modules/sales/ui/Quotes/QuoteToOrderDrawer.tsx apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx` → no hits.

**Out of scope:** storing the Finalize choice; the Finalize dialog.

---

## Task 10: Add the Ship To block to the sales order template
**Depends on:** Task 2 (the `shipTo*` view columns in the types)
**Files:**
- Modify: `packages/documents/src/template/texts/salesOrder.ts` — `parties` (`:14-55`).
- Modify: `packages/documents/src/template/mergeFields.ts` — `SALES_ORDER_MERGE_FIELDS` (`:91-113`).
- Modify: `packages/documents/src/pdf/blocks/salesOrder/vars.ts` — `buildSalesOrderVars` (`:97-118`).
- Modify: `packages/documents/src/pdf/blocks/salesOrder/PartiesBlock.tsx` — the Ship To block.
- Copy from (precedent): `packages/documents/src/template/texts/salesInvoice.ts:72-73`; `packages/documents/src/pdf/blocks/vars.ts:136-144`; `packages/documents/src/pdf/blocks/PartiesBlock.tsx:81-92`.

**Facts checked:**
- Every SO PDF goes through `renderSalesOrderPdf` (`apps/erp/app/modules/sales/sales.pdf.tsx:280`): the file route `file+/sales-order+/$id[.]pdf.tsx:19`, the Edit document preview `settings/document-edit.pdf.tsx:181` and the email `sales.service.ts:15232`. It reads the view through `getSalesOrderCustomerDetails` (`sales.service.ts:2124`, `select("*")`). So the new view columns reach every renderer. No ERP change.
- `MERGE_FIELD_NAMES` already translates "Ship To", "Ship To Name" and the other Ship To labels (`apps/erp/app/components/DocumentTemplateEditor/mergeFieldNames.ts:194-200`). `mergeFieldNames.test.ts` stays green.

**Steps:**
1. `texts/salesOrder.ts`: append to `parties`, after `...addressTexts("billTo")`:
   ```ts
   { key: "shipTo", kind: "heading", default: "Ship To" },
   ...addressTexts("shipTo")
   ```
2. `mergeFields.ts`: in `SALES_ORDER_MERGE_FIELDS`, after `...addressFields("billTo", "Bill To")`, add `...addressFields("shipTo", "Ship To")`.
3. `vars.ts`: after the `billTo` block, add:
   ```ts
   ...addressVars("shipTo", {
     name: loc?.shipToCustomerName,
     addressLine1: loc?.shipToAddressLine1,
     addressLine2: loc?.shipToAddressLine2,
     city: loc?.shipToCity,
     stateProvince: loc?.shipToStateProvince,
     postalCode: loc?.shipToPostalCode,
     country: loc?.shipToCountryName
   }),
   ```
4. `PartiesBlock.tsx`: read `shipToCustomerName` from `data.salesOrderLocations`. In the LEFT column, under the Customer rows, render a section when `shipToCustomerName` is set: `View style={tw("mt-3 pt-3 border-t border-gray-200")}` with the heading `t("shipTo")` (same style as `t("customer")`) and `<AddressRows t={t} prefix="shipTo" />`. Copy the invoice block's markup (`blocks/PartiesBlock.tsx:81-92`). The PDF has no rule that hides one block because of the other (spec 5.6).
5. Update the TSDoc of `buildSalesOrderVars` if it lists the groups.

**Verify:**
- `pnpm --filter @carbon/documents typecheck` → exit 0.
- `pnpm --filter @carbon/documents exec vitest run src/template` → passes (`texts.test.ts` "uses only variables the document offers", `validate.test.ts`).
- `cd apps/erp && pnpm exec vitest run app/components/DocumentTemplateEditor/mergeFieldNames.test.ts` → passes.
- Snapshot updates wait for Task 11.

**Out of scope:** a quote Ship To (spec non-goal); samples (Task 11).

---

## Task 11: Fill every template sample and update the snapshots
**Depends on:** Task 10
**Files:**
- Modify: `packages/documents/src/pdf/samples.ts` (sales invoice), `salesOrder.samples.ts`, `quote.samples.ts`, `purchaseOrder.samples.ts`, `purchaseReturnOrder.samples.ts`, `packingSlip.samples.ts`, `purchasingRfq.samples.ts`, `jobTraveler.samples.ts`, `issue.samples.ts`, `stockTransfer.samples.ts`, `salesReturnOrder.samples.ts` — the data each section needs.
- Modify: `packages/documents/src/pdf/preview-documents.test.ts` — the `everyTable` variants (`:60-140`) for texts that exclude what the sample prints.
- Modify: `packages/documents/src/pdf/__snapshots__/preview-documents.test.ts.snap` — by `vitest -u` only.

**Facts checked:** the test "prints every text of the %s catalog it reaches" (`preview-documents.test.ts:228-283`) renders each document twice: the sample (`{}`) and the sample plus `everyTable[type]`. The current gaps are in the snapshot (`__snapshots__/preview-documents.test.ts.snap:1-110`).

**Steps:**
1. Run `pnpm --filter @carbon/documents exec vitest run src/pdf/preview-documents.test.ts` once. Save the list of gaps per document.
2. For each gap key, find what prints it: `grep -rn '"<key>"' packages/documents/src/pdf/blocks/<doc>/`. Then pick one fix:
   - If the text can print next to what the sample prints, add the data to the sample.
   - If the text prints only instead of something the sample prints (an alternate title, "None" for empty notes, a plural key, another job type), add the data to `everyTable[type]` in the test.
3. Use the conditions already found:
   | Document | Gap | What prints it |
   |---|---|---|
   | salesInvoice | `parties:shipTo*` | `salesInvoiceLocations.shipment*` fields in `samples.ts` (`shipmentCustomerName`, `shipmentAddressLine1`, …) |
   | salesInvoice | `parties:salesOrders` | 2 or more `salesOrderIds` (`blocks/PartiesBlock.tsx:30-31`): `everyTable` |
   | salesInvoice, salesOrder, quote, purchaseOrder, purchaseReturnOrder, salesReturnOrder | `notes:none` | empty notes: `everyTable` |
   | salesOrder | `parties:billTo*` | `salesOrderLocations.paymentCustomerName` and the `payment*` address (`blocks/salesOrder/PartiesBlock.tsx:68-79`) |
   | salesOrder | the new `parties:shipTo*` | `salesOrderLocations.shipTo*` (a drop-ship address that differs from the customer's) |
   | quote | `lineItems:columnTaxAndFees*` | a line with more than one price (`blocks/quote/LineItemsBlock.tsx:54`) |
   | packingSlip | `parties:contractNumber`, `document:receivingReportTitle` | the contract delivery variant (`blocks/packingSlip/PartiesBlock.tsx:56`): `everyTable` |
   | packingSlip | `lineItems:serialBatch*` | a line with tracked entities (`blocks/packingSlip/LineItemsBlock.tsx:142`) |
   | purchasingRfq | `terms:termsAndConditions` | non-empty terms (`blocks/purchasingRfq/TermsBlock.tsx:34`) |
   | stockTransfer | `lineItems:any` | a line with no `fromStorageUnitName` (`blocks/stockTransfer/LineItemsBlock.tsx:81`) |
   | jobTraveler | `jobDetails:service`, `makeToOrder`, `inventory` | item type Service, a job with no sales order, an inventory job (`blocks/jobTraveler/JobDetailsBlock.tsx:67-76`) |
   | jobTraveler | `operations:*`, `notes:jobNotes` | batch, MES link, procedure steps, work instructions, notes (`blocks/jobTraveler/OperationsBlock.tsx:218-354`, `NotesBlock.tsx:29`) |
   | issue | `issueDetails:unknown`, `actionTasks:unknown` | an empty `issue.initiatedBy` / assignee (`blocks/issue/IssueDetailsBlock.tsx:21`, `ActionTasksBlock.tsx:117`) |
   | issue | `associations:*` | an `associations` object with every kind (`blocks/issue/AssociationsBlock.tsx:60-71`) |
4. If three or more texts exclude each other (the job types), let `everyTable[type]` return an array of prop sets, and render `[{}, ...variants]` in the "prints every text" test. Keep the other tests on the first variant. Change the test only that far.
5. Use made-up demo values only (Globex, Acme). Never a real customer, part or order number.
6. Re-run the test. The target is `[]` for every "prints every text" snapshot. If one text still cannot print with any sample data, STOP and report the key and the reason. Do not leave it in the snapshot without asking.
7. Read the "prints the X sample" snapshot diffs. Each change must be new data you added. Then update: `pnpm --filter @carbon/documents exec vitest run src/pdf/preview-documents.test.ts -u`.

**Verify:**
- `pnpm --filter @carbon/documents test` → passes.
- `grep -A1 "prints every text of the" packages/documents/src/pdf/__snapshots__/preview-documents.test.ts.snap` → every block is `[]` (the line after each head is `` `[]` `` or `[` followed by `]`).
- `pnpm --filter @carbon/documents typecheck` → exit 0.
- `pnpm exec biome check packages/documents/src/pdf` → no errors.
- If the tests fail on fonts, run `pnpm --filter @carbon/documents build` (it writes the gitignored `fonts.data.ts`), and `pnpm --filter @carbon/config build` if the config import fails. Then run again.

**Out of scope:** changing block logic to make a text print; the trackingLabel document (excluded from the test, `:56-58`).

---

## Task 12: Show tax on the service contract Review step
**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Contracts/contractTerms.ts` — add `contractInvoiceTax`.
- Create: `apps/erp/app/modules/sales/ui/Contracts/contractTerms.test.ts` — the AC14 example.
- Modify: `apps/erp/app/modules/sales/ui/Contracts/ContractSummary.tsx` — `SummaryLine` (`:227-343`), the next invoice block (`:162-189`), `nextPlannedInvoice` (`:346-376`).

**Facts checked:** `ContractLine` is `getContractLines`' row (`ui/Contracts/types.ts:39-41`), which selects `*` (`sales.service.ts:10810`), so it carries `taxPercent` (0–1). Live rows carry `lineId` (`computedSchedule`); stored rows carry `customerContractLineId` (`contractTerms.ts:58-87`).

**Steps:**
1. `contractTerms.ts`:
   ```ts
   /** The tax on one invoice's rows: each row at its line's `taxPercent`.
    *  Display only; the drafted invoice computes its own tax. */
   export function contractInvoiceTax(
     rows: { lineId: string; amount: number }[],
     lines: { id: string; taxPercent: number | string | null }[]
   ): number
   ```
2. `contractTerms.test.ts` (SPDX fixer): "taxes a 60 line at 20% as 12" → `contractInvoiceTax([{ lineId: "a", amount: 60 }], [{ id: "a", taxPercent: 0.2 }])` is `12`. A second case: a row whose line has no tax adds 0.
3. `nextPlannedInvoice`: also return `rows: { lineId, amount }[]` from both branches.
4. Under the "Next invoice" row, when `nextInvoice` exists and the contract is not a project contract with only billing lines, render 2 rows in the same style:
   - `<Trans>Tax</Trans>` → `MotionMoney value={tax}`.
   - `<Trans>Total per invoice</Trans>` → `MotionMoney value={nextInvoice.total + tax}`.
5. `SummaryLine`: when the line is not a billing line and `Number(line.taxPercent) > 0`, add a muted line under the amount: `t\`${percent.format(taxPercent)} tax · ${money.format(amount * taxPercent)}\``.
6. This shows on the Review step and on the contract page (open point E).

**Verify:**
- `cd apps/erp && pnpm exec vitest run app/modules/sales/ui/Contracts/contractTerms.test.ts` → passes.
- `pnpm exec biome check apps/erp/app/modules/sales/ui/Contracts/ContractSummary.tsx apps/erp/app/modules/sales/ui/Contracts/contractTerms.ts apps/erp/app/modules/sales/ui/Contracts/contractTerms.test.ts` → no errors.

**Out of scope:** tax on the invoice grid or the revenue plan.

---

## Task 13: Update AGENTS.md, rules and the reader docs
**Depends on:** Tasks 4–12
**Files:**
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — Rentals: Invoice generation (the dialog, `invoiceRentalAgreementPeriods`, `previewRentalAgreementInvoice`, `draftEarlyRentalInvoice`), the Manual mode, the Rental Site in `rentalActiveTerms`, the Rentals safety bullet ("The exceptions are `paymentTermId`, `taxCodeId`, `taxPercent` and `customerLocationId`"); Contracts: the contract validators and selects use `contractInvoiceAutomations` (every mode but Manual). Note that the company setting never takes Manual.
- Modify: `docs/content/docs/reference/rental-agreements.mdx` — the Invoice dialog (N periods, All remaining, N = 0 for due charges alone), the Manual mode on the agreement only (next to `:143`), the Rental Site while Active (`:18`).
- No change: `docs/content/docs/reference/contracts.mdx`. A contract never takes Manual.
- Modify: any `docs/content` page on the sales order PDF or the quote-to-order Send Via, if one exists (`grep -rln "Send Via\|Ship To" docs/content/docs`).

**Steps:**
1. Load the `carbon-docs` skill before editing `docs/content`.
2. Ground every sentence in the code from Tasks 4–12. Write in STE-80.
3. Grep each new name across `.ai/`, `.claude/rules/`, `**/AGENTS.md` and `docs/content`: `invoiceRentalAgreementPeriods`, `RENTAL_SITE_WRONG_CUSTOMER`, `contractInvoiceAutomations`, `shipToCustomerName`.

**Verify:**
- `grep -n "customerLocationId" apps/erp/app/modules/sales/AGENTS.md` → the Rentals safety bullet names it.
- The docs build check the `carbon-docs` skill names → passes.

**Out of scope:** moving the spec to `implemented/` (the user decides); a changelog entry.

---

## Task 14: Extract and translate the new strings (MAIN AGENT ONLY)
**Depends on:** Tasks 7, 8, 9, 12
**Files:**
- Modify: `packages/locale/locales/*/erp.po` (and `mes.po` only if the extract changes it).

**Steps:**
1. Run `git status`. If another session has uncommitted `.ts` / `.tsx` edits that are not this branch's work, STOP (`.ai/lessons.md` → "The pre-commit Lingui extract reads the working tree").
2. Run `pnpm run lingui:extract && pnpm run lingui:clean`.
3. Run `git diff --stat packages/locale/locales`. If the extract removes strings this branch did not touch (more than about 50 removed lines in `en/erp.po` beyond the replaced Invoice confirm text), STOP and report.
4. Load the `translate` skill and fill the empty `msgstr` entries.

**Verify:**
- The `translate` skill's merge script reports `Remaining: 0`.
- `pnpm run lingui:compile` → exit 0.

**Out of scope:** new locales.

---

## Task 15: Run the final verification (MAIN AGENT ONLY)
**Depends on:** every task
**Steps:**
1. `pnpm exec turbo run typecheck --filter=erp` (MAIN AGENT ONLY) → 0 errors. A TS2589 in an unrelated file is the budget problem in memory "erp TS2589 instantiation budget": fix it as that note says.
2. `pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/database --filter=@carbon/documents --filter=@carbon/jobs` → 0 errors.
3. `pnpm generate:mcp` (MAIN AGENT ONLY), then `pnpm check:manifest` (MAIN AGENT ONLY) → the digest matches. The enum change and `invoiceRentalAgreementPeriods` change the digest.
4. `pnpm --filter @carbon/utils test`, `pnpm --filter @carbon/database exec vitest run src/rental-periods.test.ts`, `pnpm --filter @carbon/jobs exec vitest run src/invoicing`, `pnpm --filter @carbon/documents test` → pass.
5. `cd apps/erp && pnpm exec vitest run app/modules/sales app/components/DocumentTemplateEditor` → pass.
6. `SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)" pnpm --filter erp exec vitest run test/database/create-rental-invoices.test.ts test/database/create-rental-invoices-monthly-cycle.test.ts test/database/rental-agreement-site.test.ts test/database/post-rental-agreement test/database/post-shipment/rental-agreement.test.ts test/database/post-receipt/rental-agreement.test.ts` → pass.
7. `pnpm exec biome check $(git diff --name-only main -- '*.ts' '*.tsx')` → no error-severity findings (leave the known warnings).
8. `pnpm --filter @carbon/checks exec vitest run src/run.test.ts` → passes.
9. `pnpm db:check:datasets` → ✓ for every dataset. `pnpm db:check:backups` → passes.
10. Ask the user before a browser check with the `test` skill (AC 1–12). List every flow not tested.

**Out of scope:** committing (the user commits).
