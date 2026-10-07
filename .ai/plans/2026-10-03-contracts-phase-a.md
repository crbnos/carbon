# Contracts, Phase A — implementation plan

> Phase A of `.ai/specs/2026-10-02-contracts.md` ("Delivery phases"): contracts, lines, an invoice schedule you can edit, amendments, cancellation with a credit memo, renewal, contract types, discounts, *Billed through*, Create Contract from a sales order, the contract source in `recurring-billing`, contract holds, and the *Post and Send via Stripe* mode.
> Phase B (separate plan, not here) builds the line-level revenue engine: `customerContractRevenue`, the contract branches of `post-sales-invoice` / `post-memo` that relieve Contract Assets, `synthesizeContractRevenue`, the posting effect of Even Period and *Recognize revenue from*, and the contract position view.

**Spec:** .ai/specs/2026-10-02-contracts.md
**Interview record:** .ai/runs/2026-10-02-contracts.md (Q1–Q11, U1–U4, G1–G9, Handoff "Split")
**Research:** .ai/research/subscription-recurring-invoicing.md
**Builds on:** .ai/plans/2026-10-02-rental-invoice-automation.md (shared recurring-invoicing layer, executed; only Task 21's email check is still pending)
**Branch:** revenue-recognition-rentals-spec. Rentals and the shared layer are not on `main` yet, and this plan builds on both.

## Where the spec's names live now

The spec was written before edge functions became Node server functions (`f58d55409d`) and before rental math moved to `@carbon/utils` (`4489907c8b`). Read the spec through this table:

| Spec says | Build it at |
|---|---|
| `packages/database/supabase/functions/shared/contract-schedule.ts` (re-exported by `@carbon/utils`) | `packages/database/src/contract-schedule.ts`, subpath `@carbon/database/contract-schedule`, re-exported from the `@carbon/utils` root (as `precision` is). It lives in `@carbon/database` so the demo-dataset tier, which cannot import `@carbon/utils`, can plan a schedule. |
| Revenue preview math (`revenueSchedule`, `contractPosition`) | `packages/utils/src/contract-revenue.ts`, which reuses `spreadStraightLine` from `revenue-schedule.ts` |
| `@carbon/database/contract-billing` (`confirmContract`, `applyContractAmendment`, `cancelContract`, `renewDueContracts`, `createContractInvoicesForDuePlannedInvoices`) | Two server functions. `post-customer-contract` covers confirm, schedule edits, amend, cancel and revert. `create-contract-invoices` covers renewal, the horizon roll, ending a contract, and drafting. |
| Edge functions `post-sales-invoice` / `post-memo` / `convert` | `packages/server-functions/src/<name>/` |
| `automateSalesInvoice` | `postSalesInvoiceUnattended` + `emailPostedInvoice` (`packages/jobs/src/invoicing/automate-invoice.ts`), plus a new `sendPostedInvoiceViaStripe` |
| `releaseRecurringInvoiceStamps` | `releaseRentalInvoiceStamps` in `apps/erp/app/modules/sales/sales.server.ts:413`, generalized |

## Plan-level decisions (fold into the spec changelog at close-out)

These refine the spec where the code facts gathered for this plan disagree with its assumptions. Reviewed with Brad on 2026-10-03: decision 3 was changed to a real line discount; the project dimension (decision 5) was confirmed; the rest were approved as written.

1. **No `customerContractRevenue` table in Phase A.** It belongs to Phase B (spec "Delivery phases"). The Revenue section is a preview computed from the lines (`contract-revenue.ts`). Posted revenue comes from the Service-line deferral that each invoice line already triggers.
2. **The invoice schedule is persisted only once someone edits it, or at Confirm.** While a Draft is unedited, the loader computes the schedule live from the lines with the pure planner. The first schedule edit materializes it (`customerContractInvoice` rows, `isEdited = true`). If lines change after an edit, the per-line residual shows and the page offers *Reset schedule*. Confirm materializes an unedited schedule, and refuses an edited one that no longer conserves every line's total. This means a line written through MCP can never leave a stale persisted schedule behind.
3. **Sales invoice lines get a real discount (user, 2026-10-03).** `salesInvoiceLine.discountPercent NUMERIC NOT NULL DEFAULT 0` is a fraction from 0 to 1, as on `quoteLinePrice`, with generated `netUnitPrice` / `convertedNetUnitPrice` columns copied from the quote pattern (`20260811123619_widen-sales-production-scale.sql:55-58`). It discounts **merchandise only** (`quantity × unitPrice`). Add-on, non-taxable add-on and shipping are not discounted. Tax is charged on the discounted merchandise. Every place that computes line or invoice amounts applies it: the `salesInvoices` view's totals, `calculateSalesPostingAmounts`, the documents helpers + PDF + email, the ERP invoice summary and line form, the Stripe line conversion and expected total, the accounting-provider sales document builder, and rental utilization (Tasks 3b, 13b–13e). Existing rows default to 0, so nothing already posted changes. A contract invoice line carries the contract line's **list** `unitPrice` per unit and its `discountPercent`, so the invoice shows price + discount (spec G8).
4. **The cancellation credit memo posts to Deferred Revenue, not Sales Discount.** Today `post-memo` offsets an AR credit memo to `salesDiscountAccount` (`post-memo-transaction.ts:295-301`). That would leave the credited period's Planned Service-deferral rows in place, so the cancelled days would still be recognized. A memo with `customerContractId` instead debits Deferred Revenue up to the Planned deferral it releases and debits Sales for any remainder already recognized. It deletes or trims those Planned rows in the posting transaction. Voiding a contract memo is refused (the spec already makes the cancellation irreversible once its memo has posted).
5. **The project is carried on `salesInvoiceLine.projectId`, and `post-sales-invoice` writes it as the Project dimension.** Sales posting has no Project dimension today; only purchase invoices, charges and reimbursements do. Phase A records the project on each drafted invoice line and dimensions the line's Sales / Deferred Revenue journal lines (AR keeps the customer). The recognition-run journal is Phase B. This is the spec's "one-way door": every contract invoice carries its project from the first one.
6. **Rental reconciliation is not extracted.** Rental re-cut and adjustment logic lives inside `generateRentalBillingPeriods` (`packages/utils/src/rental-periods.ts:252`). It is keyed on `returnedAt` and applied by `post-rental-agreement` at return. Contracts get their own `reconcileContractSchedule` in `contract-schedule.ts` using the same adjustment rule (billed amount × days after the new end ÷ days billed, at most one per billed period). Rental files are untouched, which is what the "rental behaviour unchanged" acceptance criterion asks for.
7. **A sales-order line taken into a contract is marked `invoicedComplete = true` when the contract is created**, and released if the Draft contract or that contract line is deleted. `convert` already invoices only lines with `quantityToInvoice > 0 && !invoicedComplete` (`convert/index.ts`, the `salesOrderToSalesInvoice` branch), and the order-status rollup in `post-sales-invoice` reads `invoicedComplete`. The spec's "convert skips contract-linked lines" and "rollup counts them as invoiced" both follow without changing `convert`.
8. **A row created by reconciliation, or a line starting mid-period, lands on the next regular invoice date.** It is not drafted on its own day. This matches the spec's one-time-line rule ("first planned invoice on or after their start date") and the amendment acceptance criterion ("the next invoice carries −$206.45 and +$309.68").
9. **Recurring units are counted in whole months from the period start, then by days.** For a Month / Quarter / Year rate unit, `units = (n + remainderDays ÷ daysOfTheNextMonthFromThere) ÷ (1 | 3 | 12)`. Here `n` is the count of whole months added to the period start (`@internationalized/date` `.add({ months })`, which clamps to month end). So an Anniversary period such as 15 Mar–14 Apr is exactly 1, with no proration, and a Calendar partial period is its days ÷ that month's days. The spec's "each partial month's days ÷ its days" would bill 15 Mar–14 Apr at 1.015 months, which contradicts "Anniversary … no proration".
10. **Pricing a schedule row is two roundings at internal scale.** `unitPrice = round(rate × units)` (the list price per contract-line unit for the period) and `amount = round(quantity × unitPrice × (1 − discountPercent))`. The drafted invoice line copies `quantity`, `unitPrice` and `discountPercent`, so its net merchandise equals the row. A row whose amount no longer equals that product (a split installment, an adjustment) is drafted as `quantity` 1, `unitPrice` = amount, `discountPercent` 0, with the discount stated in the description (`invoiceLinePricing`).
11. **Cancellation stores what it changed, so it can be reverted.** `customerContractAmendment.previousState JSONB` holds `{ contractEndDate, renewal, lineEndDates: { [lineId]: string | null } }`. *Revert cancellation* restores from it. This adds a column the spec doesn't have. Memo-borne adjustment rows have no planned invoice, so `customerContractInvoiceLine.customerContractInvoiceId` is nullable, with a CHECK that the row has an invoice or a memo, and the table also gets `customerContractId`.
12. **The contract type is suggested when the contract is created and stays editable** (spec decision 17). Confirm does not overwrite what the user chose. Amendment types are suggested in the amendment preview from the change in recurring value per billing period.
13. **The list's "recurring per period" column is computed in TypeScript on the contract page, not in the view.** Expressing rate-unit-to-frequency conversion in SQL would duplicate `periodUnits`. The list shows contract value, invoiced to date and next invoice from the view. "Recognized" and "deferred" are Phase B.
14. **The Stripe send moves into `@carbon/stripe`** as `sendPostedSalesInvoiceViaStripe` (`packages/stripe/src/send-sales-invoice.server.ts`), so the job and the manual post route share it. `@carbon/stripe` already depends on `@carbon/lib`. The mapping write (`createMappingService` is `@carbon/ee`) is injected as a callback, so `@carbon/stripe` does not gain a commercial dependency.
15. **Demo datasets: one Active contract per dataset, as the spec says**, even though rentals shipped without dataset rows.

## Acceptance criteria covered in Phase A

Every acceptance criterion in the spec is covered except these, which belong to Phase B:

- the Contract Assets criterion (implementation billed 2 × $30,000);
- the recognition parts of the Acme posting criterion. Posting the 1 Nov invoice crediting Deferred Revenue $60,420.00 is Phase A, through the Service deferral. The November run releases the implementation line by day ($60,000 × 30/181), not $10,000; the Even Period amount is Phase B;
- "the October run recognizes $1,000 from Deferred Revenue" in the migrated-contract criterion. The no-invoice-before-1-May-2027 part is Phase A;
- "recognition rows post in base" in the EUR criterion. Invoice posting with base translation is Phase A;
- the recognition-run half of the project criterion.

## Progress

- [x] Task 1: Baseline green
- [x] Task 2: Migration — enum values
- [x] Task 3: Migration — contract tables, provenance columns, view, sequence
- [x] Task 3b: Migration — sales invoice line discount
- [x] Task 4: Authz rules, apply, generated RLS migration, types, DB gates
- [x] Task 5: Pure schedule math (`@carbon/database/contract-schedule`) + tests
- [x] Task 6: Pure revenue preview + contract invoice holds (`@carbon/utils`) + tests
- [x] Task 7: Contract validators (`sales.models.ts`)
- [x] Task 8: Contract services (`sales.service.ts`) with Draft guards and MCP tags
- [x] Task 9: Server function `post-customer-contract` — confirm, schedule edits, reset
- [x] Task 10: `post-customer-contract` — amend
- [x] Task 11: `post-customer-contract` — cancel and revert cancellation
- [x] Task 12: Server function `create-contract-invoices`
- [x] Task 13: `post-sales-invoice` — VOID releases contract rows; Project dimension
- [x] Task 13b: Line discount — posting amounts
- [x] Task 13c: Line discount — documents (PDF, email)
- [x] Task 13d: Line discount — ERP invoice UI and rental utilization
- [x] Task 13e: Line discount — Stripe and accounting providers
- [x] Task 14: `post-memo` — contract credit memo releases deferral
- [x] Task 15: `sales.server.ts` — release stamps on delete, create from sales order, wrappers
- [x] Task 16: `@carbon/stripe` — shared send of a posted invoice; the post route uses it
- [x] Task 17: Automation — contract source, Stripe mode
- [x] Task 18: `recurring-billing` — the contract source
- [x] Task 19: Settings and rental override offer *Post and Send via Stripe*
- [x] Task 20: Paths, navigation, status colors, route types
- [x] Task 21: Contracts list
- [x] Task 22: Contract page shell — new, header, explorer, properties, update, delete
- [x] Task 23: Line form and line routes
- [x] Task 24: Summary section
- [x] Task 25: Invoices section and schedule editing
- [x] Task 26: Revenue section (preview)
- [x] Task 27: Confirm and Invoice Now
- [x] Task 28: Amend modal, preview, amendment history
- [x] Task 29: Cancel modal and revert
- [x] Task 30: Create Contract from a sales order
- [x] Task 31: "From contract" links on invoices, invoice lines and memos
- [x] Task 32: Demo datasets
- [x] Task 33: MCP digest, lint, i18n, scoped typechecks, tests
- [x] Task 34: Docs — reference page, glossary, AGENTS.md, rules, spec changelog
- [x] Task 35: Browser verification (`/test`)

## Dependencies

- Task 1 → Task 2 → Task 3 → Task 3b → Task 4. Every later task needs Task 4's types.
- Tasks 13b, 13c, 13d and 13e touch disjoint files and are parallel-safe after Task 4. Task 12 (drafting with `discountPercent`) needs 13b. Task 16 (Stripe extraction) must land before 13e's Stripe step, or 13e edits the helpers in their new home. Run 16 first.
- Tasks 5 and 6 are independent of each other and can run in parallel after Task 4.
- Task 7 needs Task 4. Task 8 needs Task 7.
- Task 9 needs Tasks 5 and 6. Task 10 and Task 11 need Task 9. Task 12 needs Tasks 5, 6 and 9.
- Tasks 13, 14 and 16 are independent of each other and of Tasks 5–12 (parallel-safe after Task 4).
- Task 15 needs Tasks 8 and 12. Task 17 needs Tasks 12 and 16. Task 18 needs Task 17.
- Task 19 needs Task 4. Task 20 needs Task 4.
- UI: Task 21 needs Tasks 8 and 20. Task 22 needs Task 21. Tasks 23–26 need Task 22 (23, 24 and 26 touch disjoint files; 25 needs 9). Task 27 needs Tasks 15, 17 and 22. Task 28 needs Tasks 10 and 22. Task 29 needs Tasks 11 and 22. Task 30 needs Tasks 15 and 22. Task 31 needs Task 22.
- Task 32 needs Task 5.
- Tasks 33 → 34 → 35 run last, in order.

---

## Task 1: Baseline green

**Depends on:** none
**Files:** none

**Steps:**
1. `git status` must be clean apart from files this plan's author committed. Run `git fetch origin && git merge origin/main` if `main` has moved. STOP and report any conflict in `post-sales-invoice`, `post-memo`, `convert`, `recurring-billing.ts`, `automate-invoice.ts`, `sales.models.ts`, `sales.service.ts`, `sales.server.ts` or the `$invoiceId.post.tsx` route.
2. Record a baseline of the commands below in the run log `.ai/runs/2026-10-02-contracts.md`. Later tasks compare against these results, not against zero.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/server-functions --filter=@carbon/database --filter=@carbon/utils --filter=@carbon/stripe --concurrency=1
# Expected: all successful, or the pre-existing failures recorded in the run log
pnpm --filter @carbon/utils test && pnpm --filter @carbon/database test && pnpm --filter @carbon/server-functions test && pnpm --filter @carbon/jobs test
# Expected: all pass, or the pre-existing failures recorded
```

**Out of scope:** fixing pre-existing failures.

---

## Task 2: Migration — enum values

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_contract-enums.sql` (via `pnpm db:migrate:new contract-enums`)
- Copy from (precedent): `packages/database/supabase/migrations/20260923003308_rental-enums.sql`

**Steps:**
1. `pnpm db:migrate:new contract-enums`. The timestamp must be newer than the newest file in `packages/database/supabase/migrations/` before you ran it (`20261003191518` when this plan was written). Its HHMMSS must not be `000000`. Do not create the file while a `db:migrate` is running.
2. Write the following. `ADD VALUE` must sit in a migration earlier than anything that uses the value, which is why this file is separate.
```sql
-- Contracts (.ai/specs/2026-10-02-contracts.md). Enum values only: an ADD VALUE
-- cannot share a transaction with statements that use it.
ALTER TYPE "invoiceAutomation" ADD VALUE IF NOT EXISTS 'Post and Send via Stripe';

DO $$ BEGIN CREATE TYPE "customerContractStatus" AS ENUM ('Draft', 'Active', 'Ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "customerContractType" AS ENUM ('New Sales', 'Existing', 'Expansion', 'Reactivation', 'Contraction');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "customerContractLineKind" AS ENUM ('One-time', 'Recurring');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractRateUnit" AS ENUM ('Day', 'Week', 'Month', 'Quarter', 'Year');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractBillingFrequency" AS ENUM ('Week', 'Month', 'Quarter', 'Year');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractBillingAlignment" AS ENUM ('Anniversary', 'Calendar');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractBillingTiming" AS ENUM ('Advance', 'Arrears');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractRenewal" AS ENUM ('Renew', 'End');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- A method, not a pattern: 'As Invoiced' and 'Percent Complete' arrive later as values.
DO $$ BEGIN CREATE TYPE "contractRevenueMethod" AS ENUM ('Daily', 'Even Period');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractAmendmentEffect" AS ENUM ('Change Date', 'Next Period');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "contractInvoiceStatus" AS ENUM ('Planned', 'Invoiced', 'Billed Externally');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

**Verify:**
```bash
ls packages/database/supabase/migrations | tail -1 | grep -c "contract-enums"
# Expected: 1
grep -c "CREATE TYPE" packages/database/supabase/migrations/*_contract-enums.sql
# Expected: 11
```

**Out of scope:** `revenueScheduleStatus` (Phase B uses the existing enum).

---

## Task 3: Migration — contract tables, provenance columns, view, sequence

**Depends on:** 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_contracts.sql` (via `pnpm db:migrate:new contracts`)
- Copy from (precedent): `packages/database/supabase/migrations/20261006220501_rental-agreements.sql`. Copy its table shape (lines 30–80), the sequence backfill (section "10) Sequence per company", around line 271) and the `salesInvoiceLines` view recreation (line 217).

**Steps:**
1. `pnpm db:migrate:new contracts`. It must be newer than `_contract-enums.sql`.
2. Before writing any FK, check the target's primary key: `grep -n "_pkey\" PRIMARY KEY" packages/database/supabase/migrations/*.sql | grep -E '"(customer|customerContact|customerLocation|item|paymentTerm|salesOrder|salesOrderLine|memo|project)_pkey"'`. A single-column `("id")` PK takes `REFERENCES "<t>"("id")` as written below. A composite PK takes `FOREIGN KEY ("<col>", "companyId") REFERENCES "<t>"("id", "companyId")`, plus `ON DELETE SET NULL ("<col>")` when nullable. If a target in the list below is composite and is written single-column here, convert it.
3. Write:
```sql
-- Contracts, Phase A (.ai/specs/2026-10-02-contracts.md, .ai/plans/2026-10-03-contracts-phase-a.md).
-- RLS comes from the authz manifest (no CREATE POLICY here).

-- 1) Header -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customerContract" (
  "id" TEXT NOT NULL DEFAULT id('con'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "customerContractStatus" NOT NULL DEFAULT 'Draft',
  "contractType" "customerContractType" NOT NULL DEFAULT 'New Sales',
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "invoiceCustomerId" TEXT REFERENCES "customer"("id"),
  "invoiceCustomerContactId" TEXT REFERENCES "customerContact"("id"),
  "invoiceCustomerLocationId" TEXT REFERENCES "customerLocation"("id"),
  "salesPersonId" TEXT REFERENCES "user"("id"),
  "salesOrderId" TEXT REFERENCES "salesOrder"("id") ON DELETE SET NULL,
  "projectId" TEXT,
  "customerReference" TEXT,
  "closeDate" DATE NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "termMonths" INTEGER CHECK ("termMonths" > 0),
  "renewal" "contractRenewal" NOT NULL DEFAULT 'End',
  "renewalUplift" NUMERIC NOT NULL DEFAULT 0 CHECK ("renewalUplift" >= 0),
  "billingFrequency" "contractBillingFrequency" NOT NULL DEFAULT 'Month',
  "billingAlignment" "contractBillingAlignment" NOT NULL DEFAULT 'Anniversary',
  "billingTiming" "contractBillingTiming" NOT NULL DEFAULT 'Advance',
  "firstInvoiceDate" DATE,
  "billedThrough" DATE,
  "recognizeRevenueFrom" DATE,
  "invoiceAutomation" "invoiceAutomation",
  "paymentTermId" TEXT REFERENCES "paymentTerm"("id"),
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
  "notes" JSONB,
  "confirmedAt" TIMESTAMP WITH TIME ZONE,
  "confirmedBy" TEXT REFERENCES "user"("id"),
  "cancelledAt" TIMESTAMP WITH TIME ZONE,
  "cancellationReason" TEXT,
  "endedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerContract_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContract_customerContractId_companyId_key" UNIQUE ("customerContractId", "companyId"),
  CONSTRAINT "customerContract_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContract_project_fkey" FOREIGN KEY ("projectId", "companyId")
    REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  -- endDate = startDate - 1 is a contract cancelled back to nothing
  CONSTRAINT "customerContract_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate" - 1)
);
CREATE INDEX IF NOT EXISTS "customerContract_companyId_idx" ON "customerContract" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContract_companyId_status_idx" ON "customerContract" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "customerContract_customerId_idx" ON "customerContract" ("customerId");
CREATE INDEX IF NOT EXISTS "customerContract_invoiceCustomerId_idx" ON "customerContract" ("invoiceCustomerId");
CREATE INDEX IF NOT EXISTS "customerContract_invoiceCustomerContactId_idx" ON "customerContract" ("invoiceCustomerContactId");
CREATE INDEX IF NOT EXISTS "customerContract_invoiceCustomerLocationId_idx" ON "customerContract" ("invoiceCustomerLocationId");
CREATE INDEX IF NOT EXISTS "customerContract_salesPersonId_idx" ON "customerContract" ("salesPersonId");
CREATE INDEX IF NOT EXISTS "customerContract_salesOrderId_idx" ON "customerContract" ("salesOrderId");
CREATE INDEX IF NOT EXISTS "customerContract_projectId_idx" ON "customerContract" ("projectId");
CREATE INDEX IF NOT EXISTS "customerContract_paymentTermId_idx" ON "customerContract" ("paymentTermId");
CREATE INDEX IF NOT EXISTS "customerContract_confirmedBy_idx" ON "customerContract" ("confirmedBy");
CREATE INDEX IF NOT EXISTS "customerContract_createdBy_idx" ON "customerContract" ("createdBy");

-- 2) Amendments -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customerContractAmendment" (
  "id" TEXT NOT NULL DEFAULT id('cona'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "amendmentDate" DATE NOT NULL,                -- the effective date, after snapping
  "effect" "contractAmendmentEffect" NOT NULL DEFAULT 'Change Date',
  "contractType" "customerContractType" NOT NULL,
  "reason" TEXT NOT NULL,
  -- What a cancellation changed, so it can be reverted:
  -- { contractEndDate, renewal, lineEndDates: { [lineId]: date | null } }. NULL otherwise.
  "previousState" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractAmendment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractAmendment_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractAmendment_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "customerContractAmendment_companyId_idx" ON "customerContractAmendment" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractAmendment_customerContractId_idx" ON "customerContractAmendment" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractAmendment_createdBy_idx" ON "customerContractAmendment" ("createdBy");

-- 3) Lines ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customerContractLine" (
  "id" TEXT NOT NULL DEFAULT id('conl'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "kind" "customerContractLineKind" NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "description" TEXT,
  "quantity" NUMERIC NOT NULL DEFAULT 1 CHECK ("quantity" > 0),
  "rate" NUMERIC NOT NULL CHECK ("rate" >= 0),
  "rateUnit" "contractRateUnit",
  "discountPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("discountPercent" >= 0 AND "discountPercent" <= 1),
  "discountEndsOn" DATE,
  "taxPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1),
  "startDate" DATE NOT NULL,
  "endDate" DATE,                               -- NULL = runs to the contract's end
  "goLiveDate" DATE,
  "revenueMethod" "contractRevenueMethod" NOT NULL DEFAULT 'Daily',
  "revenueStartDate" DATE,
  "revenueEndDate" DATE,
  "amendmentId" TEXT,
  "amendsLineId" TEXT,
  "salesOrderLineId" TEXT REFERENCES "salesOrderLine"("id") ON DELETE SET NULL,
  "projectId" TEXT,
  "sortOrder" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerContractLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractLine_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractLine_amendment_fkey" FOREIGN KEY ("amendmentId", "companyId")
    REFERENCES "customerContractAmendment"("id", "companyId") ON DELETE SET NULL ("amendmentId"),
  CONSTRAINT "customerContractLine_amendsLine_fkey" FOREIGN KEY ("amendsLineId", "companyId")
    REFERENCES "customerContractLine"("id", "companyId") ON DELETE SET NULL ("amendsLineId"),
  CONSTRAINT "customerContractLine_project_fkey" FOREIGN KEY ("projectId", "companyId")
    REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  CONSTRAINT "customerContractLine_rateUnit_check" CHECK (("kind" = 'Recurring') = ("rateUnit" IS NOT NULL)),
  CONSTRAINT "customerContractLine_amends_check" CHECK ("amendsLineId" IS NULL OR "amendmentId" IS NOT NULL),
  CONSTRAINT "customerContractLine_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate" - 1)
);
CREATE INDEX IF NOT EXISTS "customerContractLine_companyId_idx" ON "customerContractLine" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractLine_customerContractId_idx" ON "customerContractLine" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractLine_itemId_idx" ON "customerContractLine" ("itemId");
CREATE INDEX IF NOT EXISTS "customerContractLine_amendmentId_idx" ON "customerContractLine" ("amendmentId");
CREATE INDEX IF NOT EXISTS "customerContractLine_amendsLineId_idx" ON "customerContractLine" ("amendsLineId");
CREATE INDEX IF NOT EXISTS "customerContractLine_projectId_idx" ON "customerContractLine" ("projectId");
CREATE INDEX IF NOT EXISTS "customerContractLine_createdBy_idx" ON "customerContractLine" ("createdBy");
CREATE UNIQUE INDEX IF NOT EXISTS "customerContractLine_salesOrderLine_key"
  ON "customerContractLine" ("salesOrderLineId", "companyId") WHERE "salesOrderLineId" IS NOT NULL;

-- 4) The invoice schedule: planned invoices and their lines -----------------------------
CREATE TABLE IF NOT EXISTS "customerContractInvoice" (
  "id" TEXT NOT NULL DEFAULT id('coni'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "invoiceDate" DATE NOT NULL,
  "status" "contractInvoiceStatus" NOT NULL DEFAULT 'Planned',
  "salesInvoiceId" TEXT,                        -- stamp when drafted (no FK, rental precedent)
  "isEdited" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractInvoice_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractInvoice_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractInvoice_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "customerContractInvoice_companyId_idx" ON "customerContractInvoice" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_due_idx" ON "customerContractInvoice" ("companyId", "status", "invoiceDate");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_customerContractId_idx" ON "customerContractInvoice" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_salesInvoiceId_idx" ON "customerContractInvoice" ("salesInvoiceId");
CREATE INDEX IF NOT EXISTS "customerContractInvoice_createdBy_idx" ON "customerContractInvoice" ("createdBy");

CREATE TABLE IF NOT EXISTS "customerContractInvoiceLine" (
  "id" TEXT NOT NULL DEFAULT id('conil'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "customerContractInvoiceId" TEXT,             -- NULL only for a cancellation credit (memoId set)
  "customerContractLineId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "units" NUMERIC NOT NULL,
  "unitPrice" NUMERIC NOT NULL,                 -- per contract-line unit, net of discount
  "amount" NUMERIC NOT NULL,                    -- negative for an adjustment
  "isAdjustment" BOOLEAN NOT NULL DEFAULT FALSE,
  "salesInvoiceLineId" TEXT,                    -- stamp (no FK, rental precedent)
  "voidedSalesInvoiceId" TEXT,                  -- re-bill hold (rental D26)
  "memoId" TEXT,                                -- cancellation credit
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractInvoiceLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractInvoiceLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_invoice_fkey" FOREIGN KEY ("customerContractInvoiceId", "companyId")
    REFERENCES "customerContractInvoice"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_line_fkey" FOREIGN KEY ("customerContractLineId", "companyId")
    REFERENCES "customerContractLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractInvoiceLine_dates_check" CHECK ("periodEnd" >= "periodStart"),
  CONSTRAINT "customerContractInvoiceLine_parent_check" CHECK ("customerContractInvoiceId" IS NOT NULL OR "memoId" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_companyId_idx" ON "customerContractInvoiceLine" ("companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_customerContractId_idx" ON "customerContractInvoiceLine" ("customerContractId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_invoiceId_idx" ON "customerContractInvoiceLine" ("customerContractInvoiceId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_lineId_idx" ON "customerContractInvoiceLine" ("customerContractLineId", "companyId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_salesInvoiceLineId_idx" ON "customerContractInvoiceLine" ("salesInvoiceLineId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_memoId_idx" ON "customerContractInvoiceLine" ("memoId");
CREATE INDEX IF NOT EXISTS "customerContractInvoiceLine_createdBy_idx" ON "customerContractInvoiceLine" ("createdBy");

-- 5) Provenance on existing tables ------------------------------------------------------
ALTER TABLE "salesInvoice" ADD COLUMN IF NOT EXISTS "customerContractId" TEXT;
ALTER TABLE "salesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "customerContractId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerContractLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerContractInvoiceLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "memo" ADD COLUMN IF NOT EXISTS "customerContractId" TEXT;

DO $$ BEGIN
  ALTER TABLE "salesInvoice" ADD CONSTRAINT "salesInvoice_customerContract_fkey"
    FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId")
    ON DELETE SET NULL ("customerContractId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_customerContract_fkey"
    FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId")
    ON DELETE SET NULL ("customerContractId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_customerContractLine_fkey"
    FOREIGN KEY ("customerContractLineId", "companyId") REFERENCES "customerContractLine"("id", "companyId")
    ON DELETE SET NULL ("customerContractLineId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_customerContractInvoiceLine_fkey"
    FOREIGN KEY ("customerContractInvoiceLineId", "companyId") REFERENCES "customerContractInvoiceLine"("id", "companyId")
    ON DELETE SET NULL ("customerContractInvoiceLineId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_project_fkey"
    FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId")
    ON DELETE SET NULL ("projectId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "memo" ADD CONSTRAINT "memo_customerContract_fkey"
    FOREIGN KEY ("customerContractId", "companyId") REFERENCES "customerContract"("id", "companyId")
    ON DELETE SET NULL ("customerContractId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "salesInvoice_customerContractId_idx" ON "salesInvoice" ("customerContractId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_customerContractId_idx" ON "salesInvoiceLine" ("customerContractId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_customerContractLineId_idx" ON "salesInvoiceLine" ("customerContractLineId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_customerContractInvoiceLineId_idx" ON "salesInvoiceLine" ("customerContractInvoiceLineId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_projectId_idx" ON "salesInvoiceLine" ("projectId");
CREATE INDEX IF NOT EXISTS "memo_customerContractId_idx" ON "memo" ("customerContractId");
```
4. Recreate `salesInvoiceLines` so it exposes the four new line columns. Find the newest definition with `grep -ln 'VIEW "salesInvoiceLines"' packages/database/supabase/migrations/*.sql | sort | tail -1`. Copy its `DROP VIEW IF EXISTS` and `CREATE VIEW … WITH(SECURITY_INVOKER=true)` statements VERBATIM. If the select list already has `sil.*` (or `"salesInvoiceLine".*`), the recreate alone picks the columns up. Otherwise append `sil."customerContractId", sil."customerContractLineId", sil."customerContractInvoiceLineId", sil."projectId"` after its last column. Before dropping, check for dependent views with `grep -n '"salesInvoiceLines"' packages/database/supabase/migrations/*.sql`. If another view selects from it, STOP and report.
5. The `customerContracts` view:
```sql
DROP VIEW IF EXISTS "customerContracts";
CREATE VIEW "customerContracts" WITH(SECURITY_INVOKER=true) AS
SELECT
  c.*,
  cu."name" AS "customerName",
  COALESCE(c."invoiceAutomation", cs."invoiceAutomation") AS "effectiveInvoiceAutomation",
  (SELECT COUNT(*) FROM "customerContractLine" l
     WHERE l."customerContractId" = c."id" AND l."companyId" = c."companyId") AS "lineCount",
  (SELECT COALESCE(SUM(il."amount"), 0) FROM "customerContractInvoiceLine" il
     WHERE il."customerContractId" = c."id" AND il."companyId" = c."companyId") AS "contractValue",
  (SELECT COALESCE(SUM(il."amount"), 0) FROM "customerContractInvoiceLine" il
     JOIN "customerContractInvoice" ci ON ci."id" = il."customerContractInvoiceId" AND ci."companyId" = il."companyId"
     WHERE il."customerContractId" = c."id" AND il."companyId" = c."companyId" AND ci."status" = 'Invoiced') AS "invoicedToDate",
  (SELECT MIN(ci."invoiceDate") FROM "customerContractInvoice" ci
     WHERE ci."customerContractId" = c."id" AND ci."companyId" = c."companyId" AND ci."status" = 'Planned') AS "nextInvoiceDate"
FROM "customerContract" c
JOIN "customer" cu ON cu."id" = c."customerId"
LEFT JOIN "companySettings" cs ON cs."id" = c."companyId";
```
   `contractValue` on a Draft whose schedule has not been edited is 0, because nothing is persisted yet (decision 2). The list renders that as "—" for Drafts (Task 21).
6. The readable-id sequence for existing companies:
```sql
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'customerContract', 'Contract', 'CON', NULL, 0, 6, 1, c."id"
FROM "company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "sequence" s WHERE s."companyId" = c."id" AND s."table" = 'customerContract'
);
```
7. Add the same sequence for NEW companies to the `sequences` array in `packages/database/src/seed-data.ts`, next to the `rentalAgreement` entry (around line 581):
   `{ table: "customerContract", name: "Contract", prefix: "CON", suffix: null, next: 0, size: 6, step: 1 },`
8. Add the FK-less id columns to `ID_REF_COLUMNS` in `packages/jobs/src/backups/id-refs.ts`, as its header comment requires: `customerContractInvoice: ["salesInvoiceId"]` and `customerContractInvoiceLine: ["salesInvoiceLineId", "voidedSalesInvoiceId", "memoId"]`. Keep the object's alphabetical order. The file is typed against the generated rows, so it compiles only after Task 4.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_contracts.sql
# Expected: 5
grep -c "CREATE POLICY" packages/database/supabase/migrations/*_contracts.sql
# Expected: 0
grep -c "SECURITY_INVOKER=true" packages/database/supabase/migrations/*_contracts.sql
# Expected: 2
grep -n '"customerContract"' packages/database/src/seed-data.ts
# Expected: one sequence entry
```

**Out of scope:** `customerContractRevenue` (Phase B); `TABLE_RENAMES` (nothing is renamed); the `salesInvoices` view (the header link reads `salesInvoice` directly, Task 31).

---

## Task 3b: Migration — sales invoice line discount

**Depends on:** 3
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_sales-invoice-line-discount.sql` (via `pnpm db:migrate:new sales-invoice-line-discount`)
- Copy from (precedent): `packages/database/supabase/migrations/20260811123619_widen-sales-production-scale.sql:55-58` (quote net generated columns); `packages/database/supabase/migrations/20261003053100_sales-invoices-needs-review-posted.sql` (the newest `salesInvoices` view)

**Steps:**
1. `pnpm db:migrate:new sales-invoice-line-discount`. It must be newer than `_contracts.sql`.
2. Columns:
```sql
ALTER TABLE "salesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "discountPercent" NUMERIC NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_discountPercent_check"
    CHECK ("discountPercent" >= 0 AND "discountPercent" <= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "salesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "netUnitPrice" NUMERIC
    GENERATED ALWAYS AS ("unitPrice" * (1 - "discountPercent")) STORED,
  ADD COLUMN IF NOT EXISTS "convertedNetUnitPrice" NUMERIC
    GENERATED ALWAYS AS ("unitPrice" * "exchangeRate" * (1 - "discountPercent")) STORED;
```
   Check `convertedUnitPrice`'s generated expression in `20250507143421_sales-invoice.sql:152-155` (or its newest redefinition: `grep -n '"convertedUnitPrice"' packages/database/supabase/migrations/*.sql | tail -3`). Copy its exact form for `convertedNetUnitPrice` (e.g. if it uses `COALESCE("exchangeRate", 1)`).
3. Recreate `salesInvoiceLines` (DROP + CREATE, copying the definition Task 3 step 4 wrote) so `sl.*` picks up the three new columns.
4. Recreate `salesInvoices`. Confirm `grep -ln 'VIEW "salesInvoices"' packages/database/supabase/migrations/*.sql | sort | tail -1` is `20261003053100_sales-invoices-needs-review-posted.sql` (copy the newest otherwise). Copy its whole statement, including the `WITH(SECURITY_INVOKER=true)` clause and its DROP/CREATE or CREATE OR REPLACE form. Change only the merchandise term inside the `subtotal` SUM (around lines 103–108) and the `totalTax` SUM (around lines 109–115): `"quantity" * "unitPrice"` becomes `"quantity" * "unitPrice" * (1 - "discountPercent")`. If the `lines` JSON (lines 117–125) lists line fields, add `'discountPercent', sil."discountPercent"`. Every place in that file that multiplies `quantity` by `unitPrice` gets the factor. Grep the copied text for `unitPrice` and justify each occurrence left unchanged in the run log.
5. AR reports read `salesInvoices."totalAmount"` and need no change.

**Verify:**
```bash
grep -c 'discountPercent' packages/database/supabase/migrations/*_sales-invoice-line-discount.sql
# Expected: >= 5
grep -c "SECURITY_INVOKER=true" packages/database/supabase/migrations/*_sales-invoice-line-discount.sql
# Expected: 2
```

**Out of scope:** `salesInvoice.totalDiscount` (an unused header column); sales order lines (no discount; quote → order already folds it into the price).

---

## Task 4: Authz rules, apply, generated RLS migration, types, DB gates

**Depends on:** 3
**Files:**
- Modify: `packages/database/src/authz/manifest.ts` — add rules after the `rentalAgreement*` block (around lines 1254–1258)
- Create: the generated RLS migration (via `pnpm --filter @carbon/database authz migration contracts-rls`)
- Generated: `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`, `packages/server-functions/src/lib/types.ts` if it exists, `packages/jobs/manifests/schema.json`
- Copy from (precedent): `packages/database/supabase/migrations/20260928014618_rental-revenue-recognition-rls.sql` (shape of the generated file)

**Steps:**
1. Add these rules, in the manifest's sort order:
```ts
customerContract: company("sales", { read: "sales_view" }),
customerContractAmendment: company("sales", { read: "sales_view" }),
customerContractInvoice: company("sales", { read: "sales_view" }),
customerContractInvoiceLine: company("sales", { read: "sales_view" }),
customerContractLine: company("sales", { read: "sales_view" }),
```
2. `pnpm db:migrate`. This applies both migrations, syncs authz locally and regenerates types. If the local database is unreachable, STOP and ask the user to start it. Never rebuild the database.
3. `pnpm --filter @carbon/database authz migration contracts-rls`. Never hand-edit the file it writes.
4. `pnpm run generate:types` if step 2 did not regenerate.
5. `pnpm db:check:datasets` and `pnpm db:check:backups`.

**Verify:**
```bash
grep -c '"Post and Send via Stripe"' packages/database/src/types.ts
# Expected: >= 2
grep -n 'customerContracts: {' packages/database/src/types.ts | head -2
# Expected: the view is present
grep -c "customerContractInvoiceLineId" packages/database/src/types.ts
# Expected: >= 3
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all pass
pnpm --filter @carbon/database authz check
# Expected: exit 0 (no drift)
pnpm db:check:datasets && pnpm db:check:backups
# Expected: both exit 0
# In your SQL client against the local database:
#   BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM "customerContracts"; ROLLBACK;
# Expected: 0
```

**Out of scope:** hand-editing `types.ts` or the generated RLS migration.

---

## Task 5: Pure schedule math (`@carbon/database/contract-schedule`) + tests

**Depends on:** 4
**Files:**
- Create: `packages/database/src/contract-schedule.ts`
- Create: `packages/database/src/contract-schedule.test.ts`
- Modify: `packages/database/package.json` — add `"./contract-schedule": "./src/contract-schedule.ts"` to `exports`, next to `./supersession-pick`
- Modify: `packages/utils/src/index.ts` — add `export * from "@carbon/database/contract-schedule";` next to the `@carbon/database/precision` re-export (line 7)
- Copy from (precedent): `packages/database/src/supersession-pick.ts` + `.test.ts` (pure module + vitest); `packages/utils/src/rental-periods.ts` (calendar arithmetic with `@internationalized/date`)

**Steps:**
1. Start the file with the AGPL SPDX header (`pnpm --filter @carbon/checks license-headers`). Import `parseDate`, `CalendarDate`, `endOfMonth`, `startOfWeek` from `@internationalized/date`, and `round`, `equals` from `./precision`. No JS `Date`, no `Math.round`. Dates cross the API as `YYYY-MM-DD` strings.
2. Types (enum types come from `./types` `Database["public"]["Enums"]`):
```ts
export type ContractTerms = {
  startDate: string; endDate: string | null;
  billingFrequency: BillingFrequency; billingAlignment: BillingAlignment; billingTiming: BillingTiming;
  firstInvoiceDate: string | null; billedThrough: string | null;
};
export type ContractLineTerms = {
  id: string; kind: "One-time" | "Recurring"; quantity: number; rate: number;
  rateUnit: RateUnit | null; discountPercent: number; startDate: string; endDate: string | null;
};
export type PlannedRow = {
  lineId: string; periodStart: string; periodEnd: string; units: number; unitPrice: number;
  amount: number; isAdjustment: boolean; invoiceDate: string; status: "Planned" | "Billed Externally";
};
export type PlannedInvoice = { invoiceDate: string; status: "Planned" | "Billed Externally"; rows: PlannedRow[] };
export type ExistingRow = {
  id: string; invoiceId: string | null; invoiceDate: string | null;
  invoiceStatus: "Planned" | "Invoiced" | "Billed Externally" | null; invoiceIsEdited: boolean;
  lineId: string; periodStart: string; periodEnd: string; units: number; unitPrice: number;
  amount: number; isAdjustment: boolean; memoId: string | null;
};
```
3. Functions. Each is exported and has a doc comment stating its rule:
   - `billingGrid(terms, through): { start: string; end: string; dueDate: string }[]`. Periods from `startDate` to `min(endDate, through)`. Month-based frequencies (Month 1, Quarter 3, Year 12 months) under **Anniversary** compute period k as `[start.add({ months: k·m }), start.add({ months: (k+1)·m }) − 1 day]`, always adding from the anchor, never chained, so a 31 Jan anchor gives 28 Feb then 31 Mar. Week is 7-day periods from the anchor. Under **Calendar** the grid anchors on the Monday of the start's week (`startOfWeek(d, "en-GB")`), or the 1st of its month, of its quarter's first month, or 1 Jan. The first period is clipped to start at `startDate`. The last period is clipped at `endDate`. `dueDate` is `start` (Advance) or `end` (Arrears).
   - `periodUnits(periodStart, periodEnd, rateUnit): number`. Day: days inclusive. Week: days ÷ 7. Month / Quarter / Year (decision 9): `n` = the largest integer with `periodStart.add({ months: n }) − 1 day ≤ periodEnd`; `rest` = days from `periodStart.add({ months: n })` to `periodEnd` inclusive; `restBase` = days in `[periodStart.add({ months: n }), periodStart.add({ months: n + 1 }) − 1 day]`; result `(n + rest ÷ restBase) ÷ (1 | 3 | 12)`. Do not round.
   - `rowPricing(line, units): { unitPrice; amount }`. `unitPrice = round(rate × units)`, `amount = round(quantity × unitPrice × (1 − discountPercent))` (decision 10).
   - `nextInvoiceDate(gridDueDates: string[], date: string): string`. The first grid due date ≥ `date`, else `date` itself (decision 8).
   - `planInvoiceSchedule(terms, lines, through): PlannedInvoice[]`. **Recurring:** one row per grid period intersecting `[line.startDate, line.endDate ?? terms.endDate ?? through]`, clipped to that span, priced with `periodUnits` + `rowPricing`. Its `invoiceDate` is `nextInvoiceDate(grid dues, dueDate)`, where `dueDate` is the clipped start (Advance) or clipped end (Arrears). **One-time:** one row, `periodStart = line.startDate`, `periodEnd = line.endDate ?? line.startDate`, `units = 1`, `invoiceDate = nextInvoiceDate(grid dues, line.startDate)`. Then any `invoiceDate` before `firstInvoiceDate` becomes `firstInvoiceDate`. A row with `periodEnd ≤ billedThrough` has status `Billed Externally`. Group rows by `(invoiceDate, status)` into invoices, sorted by date, rows by line input order then `periodStart`.
   - `lineTotals(invoices): Map<lineId, number>` and `validateScheduleEdit(computed: Map<lineId, number>, rows: { lineId; amount; isAdjustment }[]): { ok: boolean; residuals: Map<lineId, number> }`. Residual = computed − Σ non-adjustment amounts. `ok` when every residual `equals` 0 and no row's line is unknown.
   - `invoiceLinePricing(row: { amount; unitPrice }, line: { quantity; discountPercent }): { quantity; unitPrice; discountPercent }`. Returns `{ quantity: line.quantity, unitPrice: row.unitPrice, discountPercent: line.discountPercent }` when `equals(round(line.quantity × row.unitPrice × (1 − line.discountPercent)), row.amount)`, else `{ quantity: 1, unitPrice: row.amount, discountPercent: 0 }`.
   - `reconcileContractSchedule({ terms, lines, existing, from, through }): { deleteInvoiceIds: string[]; deleteRowIds: string[]; recut: { id; periodEnd; units; unitPrice; amount }[]; create: PlannedInvoice[]; adjustments: PlannedRow[] }`. `lines` are all lines after the change. Algorithm, which the doc comment must restate:
     1. `ideal = planInvoiceSchedule(terms, lines, through)`, rows keyed `lineId|periodStart`.
     2. For every existing non-adjustment row whose invoice is `Invoiced`, whose line is Recurring, and whose line now ends before `row.periodEnd`, unless an adjustment row already exists with the same `lineId` and `periodEnd`: add an adjustment `{ periodStart: max(lineEnd + 1, row.periodStart), periodEnd: row.periodEnd, units: −(row.units × daysAfter ÷ daysBilled), unitPrice: row.unitPrice, amount: −round(row.amount × daysAfter ÷ daysBilled), isAdjustment: true }`. For a line now ending before the row starts, `daysAfter = daysBilled`. Its `invoiceDate` is the first planned invoice date ≥ `from` in the result, or `from` if there is none.
     3. Existing `Planned` invoices dated ≥ `from` → `deleteInvoiceIds`.
     4. Existing `Planned` rows on invoices dated < `from`: if `ideal` has the key with a different `periodEnd` or `amount` → `recut`. If `ideal` lacks the key → `deleteRowIds`. A kept invoice left with no rows → `deleteInvoiceIds`.
     5. `create` = ideal rows whose key matches no kept row and no `Invoiced` / `Billed Externally` row, with `invoiceDate = max(row.invoiceDate, from)` re-snapped via `nextInvoiceDate`, grouped into invoices. Adjustments ride with them.
   - `amendmentEffectiveDate(terms, effect, requested, through): string`. `Change Date` returns `requested`. `Next Period` returns the start of the first grid period whose start is > `requested`, or `requested` when it already starts a period.
   - `recurringValuePerPeriod(lines, frequency, on: string): number`. Σ over Recurring lines active on `on` of `quantity × rate × (1 − discount) × perFrequency`, where `perFrequency` = periods per year of the rate unit ÷ periods per year of the frequency (Day 365, Week 52, Month 12, Quarter 4, Year 1).
   - `suggestAmendmentType(before: number, after: number)`. Greater → `"Expansion"`, smaller → `"Contraction"`, equal → `"Existing"`.
   - `suggestContractType(previous: { status: "Draft" | "Active" | "Ended" }[])`. No non-Draft previous → `"New Sales"`. All non-Draft previous `Ended` → `"Reactivation"`. Otherwise → `"New Sales"`.
   - `currentPeriodEnd(terms, today): string`. End of the grid period containing `today`, used as the cancel default.
   - `renewedEndDate(endDate, termMonths): string`. `(endDate + 1 day).add({ months: termMonths }) − 1 day`.
   - `horizon(terms, today): string`. `terms.endDate` when set. Otherwise the end of the grid period after the one containing `today`.
4. Tests, one `it` each. Every number is from the spec's acceptance criteria:
   - Acme: Calendar / Monthly / Advance, contract start 1 Nov 2026, end 31 Oct 2027. Implementation One-time 60,000 1 Nov 2026–30 Apr 2027. Platform 10 × 40 per Month at 0.2 discount. Support 1 × 1,200 per Year. `planInvoiceSchedule` gives invoice 2026-11-01 total 60,420, and 2026-12-01 total 420.
   - `rowPricing` for 10 per Day over 2026-12-01..2026-12-31 gives 310, and over 2027-02-01..2027-02-28 gives 280.
   - Anniversary Monthly starting 2027-03-15: periods start on the 15th, and `periodUnits` of 2027-03-15..2027-04-14 per Month is 1.
   - Anniversary Monthly anchored 2027-01-31: the grid has 2027-02-28 then 2027-03-31 as period starts.
   - Calendar first period 2026-10-15..2026-10-31 per Month gives units 17/31.
   - Split edit: implementation rows 3 × 20,000 on three invoices → `validateScheduleEdit` ok. Rows summing to 50,000 → not ok, residual 10,000.
   - `reconcileContractSchedule`: platform March 2027 `Invoiced` 1–31 Mar at 320 (10 seats). The line now ends 2027-03-11 and a new 15-seat line starts 2027-03-12, from 2027-03-12. Expect an adjustment of −206.45 and a created row of 309.68 for 12–31 Mar, both on invoice 2027-04-01.
   - `amendmentEffectiveDate(…, "Next Period", "2027-03-12")` gives 2027-04-01.
   - Cancellation: September 2027 `Invoiced` at 420, line ends 2027-09-20 → adjustment −140.
   - Re-running `reconcileContractSchedule` with the adjustment present creates no second adjustment.
   - Billed through: Yearly / Advance, start 2026-05-01, `billedThrough` 2027-04-30, one 12,000 per Year line → the first `Planned` invoice is 2027-05-01, and the 2026-05-01 row is `Billed Externally`.
   - `invoiceLinePricing({ amount: 320, unitPrice: 40 }, { quantity: 10, discountPercent: 0.2 })` gives `{10, 40, 0.2}`. `({ amount: 20000, unitPrice: 60000 }, { quantity: 1, discountPercent: 0 })` (a split installment) gives `{1, 20000, 0}`. The 12–31 Mar row of 15 seats: `rowPricing` gives unitPrice `25.80645` and amount `309.68`, and `invoiceLinePricing` keeps `{15, 25.80645, 0.2}`.
   - `suggestContractType([])` gives "New Sales". `([{status:"Ended"}])` gives "Reactivation". `([{status:"Active"}])` gives "New Sales".
   - `suggestAmendmentType(400, 600)` gives "Expansion". `renewedEndDate("2027-10-31", 12)` gives "2028-10-31".

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/contract-schedule.test.ts
# Expected: all passed (≥ 16), 0 failed
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/utils
# Expected: successful
```

**Out of scope:** DB access in this file; revenue math (Task 6).

---

## Task 6: Pure revenue preview + contract invoice holds (`@carbon/utils`) + tests

**Depends on:** 4 (parallel-safe with Task 5)
**Files:**
- Create: `packages/utils/src/contract-revenue.ts`, `packages/utils/src/contract-revenue.test.ts`
- Create: `packages/utils/src/contract-invoice-plan.ts`, `packages/utils/src/contract-invoice-plan.test.ts`
- Modify: `packages/utils/src/index.ts` — re-export both, next to `./rental-invoice-plan`
- Copy from (precedent): `packages/utils/src/rental-invoice-plan.ts` + `.test.ts`; `packages/utils/src/revenue-schedule.ts` (`spreadStraightLine`, `distributeRoundingResidual` usage)

**Steps:**
1. `contract-revenue.ts`:
```ts
export type RevenueLine = {
  id: string; kind: "One-time" | "Recurring"; method: "Daily" | "Even Period";
  revenueStart: string; revenueEnd: string | null; netAmount: number; // what the invoice schedule bills for the span
};
export type RevenueMonth = { lineId: string; periodStart: string; periodEnd: string; amount: number };
/** Revenue dates default: start = goLiveDate ?? revenueStartDate ?? startDate; end = revenueEndDate ?? endDate. */
export function lineRevenueDates(line: { startDate: string; endDate: string | null; goLiveDate: string | null; revenueStartDate: string | null; revenueEndDate: string | null }): { start: string; end: string | null };
/** Daily → spreadStraightLine. Even Period → equal per full calendar month, partial first/last months prorated
 *  by their days ÷ that month's days, residual by distributeRoundingResidual. No end → one row in the start month. */
export function revenuePreview(line: RevenueLine): RevenueMonth[];
/** Per calendar month: invoiced (Σ schedule rows by invoiceDate month), recognized (Σ revenue months),
 *  deferred = cumulative invoiced − cumulative recognized. */
export function contractPositionPreview(invoices: { invoiceDate: string; amount: number }[], revenue: RevenueMonth[]): { month: string; invoiced: number; recognized: number; deferred: number }[];
```
   Pass in amounts already summed. No DB.
2. `contract-invoice-plan.ts`:
```ts
export const CONTRACT_HOLD_ADJUSTMENT = "Includes a credit for a contract change";
export { rentalHoldRebill as recurringHoldRebill } from "./rental-invoice-plan";
/** The hold for one drafted contract invoice. Draft Only → null. Re-bill of a voided invoice
 *  (any row with voidedInvoiceReadableId) wins over a negative adjustment row. */
export function contractInvoiceHold(mode: InvoiceAutomation, rows: { amount: number; isAdjustment: boolean; voidedInvoiceReadableId: string | null }[]): string | null;
```
3. Tests:
   - Implementation 60,000, Even Period, 2026-11-01..2027-04-30 → six months of 10,000.
   - Daily over the same span → the first month is `round(60000 × 30/181)` and the total is exactly 60,000.
   - Even Period 2026-11-15..2027-01-14 at 2,000 → November and January each 16/30 and 14/31 of a month share, and the total is exactly 2,000.
   - One-time with no end → one row in the start month.
   - Acme November position: invoiced 60,420, recognized 10,420 (implementation 10,000 Even Period + platform 320 + support 100), deferred 50,000.
   - `contractInvoiceHold("Draft Only", [negative adjustment])` gives null. `("Post", [a row with voided "INV-7", a negative adjustment])` gives "Re-billing INV-7, which was voided". `("Post and Email", [a negative adjustment])` gives `CONTRACT_HOLD_ADJUSTMENT`. `("Post and Send via Stripe", [positive rows])` gives null.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/contract-revenue.test.ts src/contract-invoice-plan.test.ts
# Expected: all passed, 0 failed
```

**Out of scope:** posting; persisting revenue (Phase B).

---

## Task 7: Contract validators (`sales.models.ts`)

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — add after the rental block (lines 1362–1620); add `"Post and Send via Stripe"` to `invoiceAutomations` (L1382)
- Copy from (precedent): `rentalAgreementValidator`, `rentalAgreementLineValidator`, `rentalAgreementInvoiceAutomationValidator`, `selectedLinesValidator` (L1164) in the same file

**Steps:**
1. Enum arrays that mirror the DB enums: `customerContractStatuses`, `customerContractTypes`, `customerContractLineKinds`, `contractRateUnits`, `contractBillingFrequencies`, `contractBillingAlignments`, `contractBillingTimings`, `contractRenewals`, `contractRevenueMethods`, `contractAmendmentEffects`, `contractInvoiceStatuses`. Type each as `readonly [...] satisfies Database["public"]["Enums"]["<enum>"][]` (copy the rental arrays' typing).
2. `customerContractValidator`: `id?`, `customerContractId?`, `name`, `contractType`, `customerId`, `invoiceCustomerId?`, `invoiceCustomerContactId?`, `invoiceCustomerLocationId?`, `salesPersonId?`, `projectId?`, `customerReference?`, `closeDate`, `startDate`, `duration` (`"6"|"12"|"24"|"36"|"open"|"custom"`), `endDate?` (required when `duration = "custom"`), `renewal`, `renewalUplift` (percent points, ÷ 100 in the service), `billingFrequency`, `billingAlignment`, `billingTiming`, `firstInvoiceDate?`, `billedThrough?`, `recognizeRevenueFrom?`, `invoiceAutomation?` (the shared enum, or `""` for the company default), `paymentTermId?`, `currencyCode`, `exchangeRate?`, `notes?`. Refines: end date ≥ start date − 1; `billedThrough` ≥ start date − 1.
   Export `contractEndDate(startDate, duration, endDate): { endDate: string | null; termMonths: number | null }`. "open" gives `null, null`. "custom" gives `endDate, null`. N months gives `parseDate(start).add({ months: N }).subtract({ days: 1 })` and N.
3. `customerContractLineValidator`: `id?`, `customerContractId`, `kind`, `itemId`, `description?`, `quantity` (> 0), `rate` (≥ 0), `rateUnit?` (required iff Recurring, via refine), `discountPercent` (percent points 0–100), `discountEndsOn?`, `taxPercent` (percent points 0–100), `startDate`, `endDate?`, `goLiveDate?`, `revenueMethod`, `revenueStartDate?`, `revenueEndDate?`, `projectId?`. Refines: end date ≥ start date; `discountEndsOn` within `[startDate, endDate)`.
4. `customerContractScheduleEditValidator`: a `z.discriminatedUnion("intent", …)` of
   - `{ intent: "move", customerContractInvoiceId, invoiceDate }`
   - `{ intent: "split", customerContractInvoiceLineId, installments: JSON string → [{ invoiceDate, amount }] (≥ 2) }`
   - `{ intent: "merge", sourceInvoiceId, targetInvoiceId }`
   - `{ intent: "moveLine", customerContractInvoiceLineId, invoiceDate }`
   - `{ intent: "reset" }`
5. `customerContractAmendmentValidator`: `customerContractId`, `amendmentDate`, `effect`, `contractType`, `reason`, and `changes` (a JSON string → array of `{ op: "change", lineId, quantity?, rate?, rateUnit?, discountPercent?, taxPercent?, description?, revenueMethod?, projectId? } | { op: "add", line: <the line fields> } | { op: "end", lineId }`, ≥ 1).
6. `customerContractCancelValidator`: `customerContractId`, `endDate`, `reason`, `creditUnusedTime` (`zfd.checkbox()`).
7. `createContractFromSalesOrderValidator`: `salesOrderId`, `name`, `startDate`, `duration`, `endDate?`, `billingFrequency`, `billingAlignment`, `billingTiming`, `lines` (a JSON string → `[{ salesOrderLineId, kind, rateUnit? }]`, ≥ 1).
8. `customerContractInvoiceAutomationValidator`: copy `rentalAgreementInvoiceAutomationValidator`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful (validators unused so far is fine)
```

**Out of scope:** the services that use these (Task 8).

---

## Task 8: Contract services (`sales.service.ts`) with Draft guards and MCP tags

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — add after the rental block (around lines 8618–9440)
- Create: `apps/erp/app/modules/sales/ui/Contracts/types.ts`
- Copy from (precedent): `getRentalAgreements`, `getRentalAgreement`, `insertRentalAgreement`, `updateRentalAgreement` (and its private `rentalAgreementTerms` field picker and `rentalRefusal` helper), `deleteRentalAgreement`, `upsertRentalAgreementLine`, `updateRentalAgreementInvoiceAutomation` in the same file; `apps/erp/app/modules/sales/ui/Rentals/types.ts`

**Steps:**
1. Readers: `getContracts(client, companyId, args: GenericQueryFilters & { search: string | null })` from the `customerContracts` view, with `setGenericQueryFilters` and search on `customerContractId` / `name` / `customerName`. Also `getContract(client, id)` (view, `.single()`), `getContractLines(client, customerContractId)` (embed `item(name, readableIdWithRevision, type)`, ordered by `sortOrder`, `startDate`), `getContractLine(client, id)`, `getContractInvoiceSchedule(client, customerContractId)` (`customerContractInvoice` with embedded `customerContractInvoiceLine(*)`, ordered by `invoiceDate`; also the memo-borne rows `customerContractInvoiceLine` where `customerContractInvoiceId IS NULL`), `getContractAmendments(client, customerContractId)` (with the lines that point at each), and `getCustomerContractStatuses(client, companyId, customerId)` (status only, for `suggestContractType`).
2. Writers. Each builds its row from an explicit field picker (`customerContractTerms(…)`, `customerContractLineTerms(…)`), never a spread, and wraps it in `sanitize`. Percent points are divided by 100 here.
   - `insertContract(client, Omit<…> & { customerContractId, companyId, createdBy, customFields? })` sets `endDate` / `termMonths` from `contractEndDate`.
   - `updateContract(client, …)` refuses a non-Draft contract with `contractRefusal("CONTRACT_NOT_DRAFT", "Only a Draft contract can be edited — use Amend")`, then updates with `.eq("status", "Draft")`. One exception: `updateContractType(client, { id, contractType, updatedBy })` is allowed in any status (decision 12).
   - `deleteContract(client, id)` deletes with `.eq("status", "Draft")`. Order-line release happens in `deleteContractReleasingSalesOrderLines` (Task 15); the route uses that.
   - `upsertContractLine(client, …)` refuses when the parent is not Draft, and refuses a non-Service item (`item.type !== "Service"`, error code `CONTRACT_LINE_NOT_SERVICE`).
   - `deleteContractLine(client, id)` refuses when the parent is not Draft.
   - `updateContractInvoiceAutomation(client, …)` allows any status. It refuses `Post and Email` when the invoice contact has no email, as `updateRentalAgreementInvoiceAutomation` does. `Post and Send via Stripe` is accepted here; Confirm and the job check the Stripe link.
3. JSDoc tags, which make these MCP tools: `@mcp read` on the readers; `@mcp create` on `insertContract`; `@mcp update` on `updateContract`, `updateContractType`, `updateContractInvoiceAutomation`; `@mcp upsert` on `upsertContractLine`; `@mcp delete` on `deleteContractLine`. **No tag** on `deleteContract`, because the MCP path would skip releasing sales-order lines (the rental delete has the same documented gap).
4. `ui/Contracts/types.ts`: `Contract = Database["public"]["Views"]["customerContracts"]["Row"]`, and `ContractLine`, `ContractInvoice`, `ContractAmendment` as `NonNullable<Awaited<ReturnType<typeof getX>>["data"]>[number]`. Also `ContractRouteData` (contract, lines, schedule, amendments, `computedSchedule`, `revenue`), copying `RentalAgreementRouteData`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
grep -c "@mcp" apps/erp/app/modules/sales/sales.service.ts
# Expected: the previous count + 11
```

**Out of scope:** Kysely in this file (`no-db-client-in-service`); confirm, amend, cancel (server functions).

---

## Task 9: Server function `post-customer-contract` — confirm, schedule edits, reset

**Depends on:** 5, 6
**Files:**
- Create: `packages/server-functions/src/post-customer-contract/index.ts`
- Create: `packages/server-functions/src/post-customer-contract/schedule-writes.ts` (internal helpers shared by Tasks 9–12)
- Modify: `packages/server-functions/src/invoke.ts` — register `"post-customer-contract"` (alphabetical, after `"post-charge"`)
- Modify: `packages/server-functions/src/__snapshots__/permissions-manifest.test.ts.snap` (via `vitest -u` after reviewing the diff)
- Copy from (precedent): `packages/server-functions/src/post-rental-agreement/index.ts` (L1800 `defineServerFn`, transaction shape) and `packages/server-functions/src/create-rental-invoices/index.ts` (`forUpdate` reads, `inOrder`, `assertCompanyRecords`)

**Steps:**
1. Input, a `z.discriminatedUnion("type", …)`. Every branch has `customerContractId` and `asOf` (`YYYY-MM-DD`, today in the company timezone, computed by the caller):
   - `{ type: "confirm" }`
   - `{ type: "edit-schedule", edit: <Task 7 step 4 union minus "reset"> }`
   - `{ type: "reset-schedule" }`
   - `amend`, `cancel`, `revert-cancellation` (Tasks 10 and 11). Declare them now; the bodies `throw new InvalidInputError("not implemented")` until those tasks.
   `permissions: { update: "sales" }`. The confirm route checks `create: "invoicing"` itself when the effective mode posts (spec decision 29).
2. `schedule-writes.ts` exports:
   - `loadContractForUpdate(trx, companyId, id)`: the header `forUpdate`, all lines, and every schedule row joined to its invoice, as `ExistingRow[]`.
   - `toTerms(contract)` and `toLineTerms(lines)` (DB rows → the pure types).
   - `materializeSchedule(trx, ctx, contract, lines, through)`: inserts `planInvoiceSchedule` output. Each `customerContractInvoice` row carries its status. Lines carry `customerContractId`, `units`, `unitPrice`, `amount`. Multi-row inserts set the same keys on every row.
   - `applyReconciliation(trx, ctx, contractId, result)`: deletes, recuts, then inserts the created invoices and adjustments. Adjustments attach to the created or kept invoice with their `invoiceDate`, inserting one if needed.
   Every statement has `.where("companyId", "=", companyId)`.
3. **confirm**. In one `db.transaction()`:
   1. Lock and load. Refuse if not Draft. Refuse with ≥ 1 line missing, a non-Service item (one query on `item` ids), or a Recurring line without `rateUnit`.
   2. If no schedule rows exist, `materializeSchedule(…, horizon(terms, asOf))`. Otherwise run `validateScheduleEdit(lineTotals(planInvoiceSchedule(…)), rows)` and refuse with the residuals in the message when it fails.
   3. If the effective mode is `Post and Send via Stripe`, refuse when `externalIntegrationMapping` has no row for `entityType = 'customer'`, the billing customer (`invoiceCustomerId ?? customerId`) and integration `'stripe-connect'`. Read the exact column names from `packages/ee/src/accounting/core/external-mapping.ts` `link(...)`. If that table's shape is not what `link` writes, STOP and report.
   4. For each line with `discountEndsOn`, create a `customerContractAmendment` (`amendmentDate` = `discountEndsOn` + 1, effect `Change Date`, reason `"Discount ends"`, type `suggestAmendmentType(...)` from `recurringValuePerPeriod` before/after). End the old line at `discountEndsOn`. Insert a copy starting `discountEndsOn` + 1 with `discountPercent 0`, `discountEndsOn null`, `amendmentId`, `amendsLineId`. Then `applyReconciliation(reconcileContractSchedule({ from: discountEndsOn + 1, … }))`.
   5. Set `status 'Active'`, `confirmedAt`, `confirmedBy`, `updatedBy`, `updatedAt`.
   Return `{ customerContractId }`.
4. **edit-schedule** (Draft only). Lock and load. If no rows exist, materialize first. Then apply the edit:
   - `move`: set `invoiceDate` (merging into an existing Planned invoice on that date, if one exists).
   - `split`: replace the row with one row per installment. Each keeps `periodStart` / `periodEnd` / `unitPrice`, sets `amount` = the installment and `units` = `units × amount ÷ originalAmount`, and goes on the Planned invoice of its `invoiceDate` (created if missing). Refuse unless the installments sum (`equals`) to the original amount, and report the residual: "Installments total {x}; the line must still total {y}".
   - `merge`: move every row from source to target and delete the source.
   - `moveLine`: as `move`, for one row.
   Set `isEdited = true` on every touched invoice. Delete invoices left empty. Only `Planned` invoices may be touched.
5. **reset-schedule** (Draft only): delete all of the contract's schedule rows and invoices. The loader goes back to the live preview.
6. `pnpm --filter @carbon/server-functions exec vitest run src/permissions-manifest.test.ts`, review the new snapshot entry (`post-customer-contract: { update: "sales" }`), then re-run with `-u`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: successful
pnpm --filter @carbon/server-functions test
# Expected: all pass (snapshot updated after review)
pnpm --filter @carbon/checks test
# Expected: pass (server-fn-authorizes-caller, no-unscoped-kysely-write)
```

**Out of scope:** amend, cancel, revert (Tasks 10–11); drafting invoices (Task 12).

---

## Task 10: `post-customer-contract` — amend

**Depends on:** 9
**Files:**
- Modify: `packages/server-functions/src/post-customer-contract/index.ts`

**Steps:**
1. Input: `{ type: "amend", customerContractId, asOf, amendmentDate, effect, contractType, reason, changes, preview?: boolean }`, where `changes` is the Task 7 step 5 array.
2. In one transaction: lock and load, and refuse unless Active.
   1. `effective = amendmentEffectiveDate(terms, effect, amendmentDate, horizon)`.
   2. Build the next line set:
      - `change`: refuse a One-time line whose rows are already `Invoiced`. Otherwise the old line ends at `effective − 1`, and the new line copies every column with the changes applied, `startDate = effective`, `amendmentId`, `amendsLineId`, `salesOrderLineId = null`.
      - `add`: the new line starts at `max(line.startDate, effective)`.
      - `end`: the line ends at `effective − 1`.
   3. Insert the amendment header. Write the lines. `applyReconciliation(reconcileContractSchedule({ from: effective, … }))`.
3. With `preview: true`, run all of step 2 inside the transaction, collect `{ adjustments, nextInvoices: the first two Planned invoices after the change with their rows, suggestedType: suggestAmendmentType(before, after), resetsEditedInvoices: count of deleted invoices with isEdited }`, then throw a private `PreviewRollback` carrying the result. Catch it outside the transaction and return the result. Nothing is committed.
4. Return `{ amendmentId }`, or the preview object.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: successful
pnpm --filter @carbon/server-functions test
# Expected: all pass
```

**Out of scope:** UI (Task 28).

---

## Task 11: `post-customer-contract` — cancel and revert cancellation

**Depends on:** 9
**Files:**
- Modify: `packages/server-functions/src/post-customer-contract/index.ts`
- Copy from (precedent): `createSalesReturnOrderCredit` in `apps/erp/app/modules/sales/sales.service.ts:8038` (the Kysely `insertInto("memo")` at L8186-8203); `getNextSequence` from `@carbon/database/sequence`

**Steps:**
1. **cancel** input: `{ type: "cancel", customerContractId, asOf, endDate, reason, creditUnusedTime, preview?: boolean }`. Resolve the memo sequence BEFORE opening the transaction, and only when `creditUnusedTime && !preview`. In one transaction:
   1. Lock and load. Refuse unless Active. Refuse `endDate` ≥ a set contract `endDate`. Refuse `endDate < startDate` when any row is `Invoiced` ("Invoices exist — cancel on or after {first invoiced period}").
   2. Record `previousState = { contractEndDate, renewal, lineEndDates }` for every line whose end is null or > `endDate`, and set each such line's end to `max(endDate, line.startDate − 1)`.
   3. Update the contract: `endDate`, `renewal = 'End'`, `cancelledAt`, `cancellationReason = reason`.
   4. Insert an amendment (`amendmentDate = endDate + 1`, effect `Change Date`, reason `"Cancellation: " + reason`, type `Contraction`, `previousState`).
   5. `result = reconcileContractSchedule({ from: endDate + 1, … })`.
      - With `creditUnusedTime` false, drop `result.adjustments`.
      - With it true and at least one adjustment, insert the memo: `direction 'Credit'`, `status 'Draft'`, `customerId = invoiceCustomerId ?? customerId`, `memoId` from the `creditMemo` sequence, `memoDate = asOf`, `currencyCode`, `exchangeRate`, `amount = −Σ adjustments`, `reference = customerContractId` (readable), `customerContractId`, audit columns. Read the `memo` columns from `packages/database/src/types.ts` (`memo` Insert) and set every NOT NULL column without a default. Insert the adjustments with `customerContractInvoiceId = null` and `memoId`, not on an invoice.
   6. Apply the rest of `result`. When `endDate < startDate`, also set `status 'Ended'` and `endedAt`.
   With `preview: true`, roll back as Task 10 step 3 and return `{ credit: −Σ adjustments, creditAvailable: adjustments.length > 0, removedInvoices }`.
2. **revert-cancellation** input: `{ type: "revert-cancellation", customerContractId, asOf }`. Refuse unless `cancelledAt` is set, the status is Active, and `asOf ≤ endDate`. Refuse if the cancellation's memo is not Draft ("The credit memo has been posted"). In one transaction:
   1. Restore the line end dates, `endDate` and `renewal` from the latest amendment whose reason starts with `"Cancellation"`.
   2. Clear `cancelledAt` / `cancellationReason`.
   3. Delete the memo-borne rows and the Draft memo, then the amendment.
   4. `applyReconciliation(reconcileContractSchedule({ from: cancelledEndDate + 1, … }))`.
3. Write the cancellation's `previousState` JSON with `toJson()` (lesson: "A JSON column through Kysely only survives as an object").

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: successful
pnpm --filter @carbon/server-functions test
# Expected: all pass
```

**Out of scope:** posting the memo (Task 14); UI (Task 29).

---

## Task 12: Server function `create-contract-invoices`

**Depends on:** 5, 6, 9, 13b
**Files:**
- Create: `packages/server-functions/src/create-contract-invoices/index.ts`
- Modify: `packages/server-functions/src/invoke.ts` — register `"create-contract-invoices"` (before `"create-rental-invoices"`)
- Modify: the permissions snapshot (review, then `-u`)
- Copy from (precedent): `packages/server-functions/src/create-rental-invoices/index.ts`. Copy all of it: `createRentalInvoicesForDuePeriods` (L74-153), `draftAgreementInvoices` (L169-360), `insertRentalInvoice` (L367-483) and the `defineServerFn` block (L623-645).

**Steps:**
1. `defineServerFn({ name: "create-contract-invoices", input: { asOf, customerContractId? }, permissions: { update: "sales", create: "invoicing" } })`. It returns `{ invoices: DraftedContractInvoice[]; invoiceIds: string[]; failures: { customerContractId; error }[] }`, where `DraftedContractInvoice = { invoiceId; customerContractId; mode: InvoiceAutomation; holdReason: string | null }`.
2. Select Active contracts for the company (or the one id) that have any of: a `Planned` invoice with `invoiceDate ≤ asOf`; `renewal = 'Renew'` with `endDate ≤ asOf`; `endDate < asOf`; `endDate IS NULL` (horizon roll). Process each in its own `db.transaction()`. A throw goes into `failures` and does not stop the loop.
3. Per contract, in order:
   1. Lock and load (`loadContractForUpdate`).
   2. **Renew** while `renewal = 'Renew' && termMonths && endDate ≤ asOf`: `newEnd = renewedEndDate(endDate, termMonths)`. Insert an amendment (`amendmentDate = endDate + 1`, effect `Next Period`, reason `"Renewal"`, type `Existing`). For every Recurring line whose end is null or equals the old contract end: when `renewalUplift > 0`, end it at the old end and insert a copy from `endDate + 1` with `rate = round(rate × (1 + renewalUplift))`, `endDate null`, `amendmentId`, `amendsLineId`. When the uplift is 0, keep it (a null end follows the contract). Set the contract's `endDate = newEnd`. Reconcile `from: old endDate + 1`. Loop so that a contract several terms behind catches up.
   3. **Roll the horizon** for open-ended contracts: `applyReconciliation(reconcileContractSchedule({ from: the day after the last persisted row's periodEnd, through: horizon(terms, asOf) }))`. It creates only.
   4. **Draft** every `Planned` invoice with `invoiceDate ≤ asOf`, one `salesInvoice` each. Mode = `effectiveInvoiceAutomation(contract.invoiceAutomation, companySettings.invoiceAutomation)`. Read the readable ids of `voidedSalesInvoiceId` in one query. Hold = `contractInvoiceHold(mode, rows)`.
      - `getNextSequence(trx, "salesInvoice", companyId)` and the opportunity insert, copied from `insertRentalInvoice`.
      - The `salesInvoice` insert copies the rental column list, with these changes: `customerId`; `invoiceCustomerId = contract.invoiceCustomerId ?? customerId`; `invoiceCustomerContactId`; `invoiceCustomerLocationId`; `locationId` = the company's default location (read the same way `insertRentalInvoice`'s caller resolves a location; if contracts have no location source, use `companySettings` / the first `location` of the company, and STOP and report if neither exists); `customerReference`; `customerContractId`; `automationHoldReason`.
      - Totals, computed as the rental code does but from each line's net merchandise `round(quantity × unitPrice × (1 − discountPercent))` and `taxPercent`: `subtotal`, `totalTax`, `totalAmount`.
      - `salesInvoiceShipment` as in rentals.
      - One `salesInvoiceLine` per row:
        - `invoiceLineType 'Service'`, `itemId`
        - `description` = `line.description ?? item.name`, plus `" · " + periodStart + "–" + periodEnd` formatted with `formatDate` (`@carbon/utils`, `dateStyle: "medium"`). When `invoiceLinePricing` fell back (discount 0 on a discounted line), also append `" · " + formatPercent(line.discountPercent) + " off"`
        - `{ quantity, unitPrice, discountPercent } = invoiceLinePricing(row, line)` (decision 10)
        - `taxPercent`
        - `serviceStartDate` / `serviceEndDate` = the row's period for Recurring lines. For One-time lines, use `lineRevenueDates(line)`, or both null when there is no end (point in time).
        - `customerContractId`, `customerContractLineId`, `customerContractInvoiceLineId`
        - `projectId = line.projectId ?? contract.projectId`
        - `methodType`, `unitOfMeasureCode` (the item's, else `"EA"`), `exchangeRate`, `locationId`, `sortOrder`
        Before writing, read how `convert`'s `salesOrderToSalesInvoice` branch fills `methodType` for a Service line and copy that.
      - Stamp the `customerContractInvoice` with `status 'Invoiced'` and `salesInvoiceId`. Stamp each `customerContractInvoiceLine` with `salesInvoiceLineId`, joined on `sil.customerContractInvoiceLineId` exactly like the rental stamp (L453-466).
   5. **End** the contract when `endDate < asOf` and no `Planned` invoice remains: `status 'Ended'`, `endedAt`.
4. Idempotency: re-running on the same day drafts nothing, because the stamps plus `forUpdate` exclude them.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --concurrency=1
# Expected: successful
pnpm --filter @carbon/server-functions test
# Expected: all pass
```

**Out of scope:** posting and emailing (Task 17); rental files.

---

## Task 13: `post-sales-invoice` — VOID releases contract rows; Project dimension

**Depends on:** 4
**Files:**
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts`
- Modify: `packages/database/src/sales-posting-amounts.ts` — `SalesPostingMetadata` (L34) gains `projectId: string | null`
- Copy from (precedent): the rental VOID block (`index.ts` L2321-2355); the Project dimension in `packages/server-functions/src/post-purchase-invoice/index.ts` (L675 query, L2034 metadata, L2287-2291 insert)

**Steps:**
1. VOID: inside the existing void transaction (L2307), after the rental block, for this invoice's line ids:
   - set `customerContractInvoiceLine.salesInvoiceLineId = null, voidedSalesInvoiceId = invoiceId, updatedBy, updatedAt`, matched on `salesInvoiceLineId IN (lineIds)`;
   - then set `customerContractInvoice.status = 'Planned', salesInvoiceId = null`, matched on `salesInvoiceId = invoiceId`.
   Both statements are scoped by `companyId`. The existing Service-deferral refusal (a Posted deferral row blocks the void, L2228-2240) still applies first.
2. Project dimension:
   - add `"Project"` to the dimension-type query (L326-345), mirroring the purchase-invoice query;
   - carry `invoiceLine.projectId` into `SalesPostingMetadata.projectId` for every line type;
   - where `journalLineDimension` rows are written (L1680-1765), add a Project dimension row on the line's revenue-side journal lines only (Sales, Deferred Revenue, and in the Rental branch Rental Income / Contract Assets), never on AR or tax, when `projectId` is set and a `Project` dimension exists.
   Copy how the purchase invoice decides which journal lines get its project. If the sales journal lines have no "revenue side" marker to key on, STOP and report.
3. Add a unit test only if the existing `post-sales-invoice` tests build `SalesPostingMetadata`. Otherwise this is verified in the browser (Task 35).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions --filter=@carbon/database --concurrency=1
# Expected: successful
pnpm --filter @carbon/server-functions test
# Expected: all pass, rental-posting.test.ts unchanged
```

**Out of scope:** the Phase B contract posting branch; the recognition run's journal dimensions.

---

## Task 13b: Line discount — posting amounts

**Depends on:** 4
**Files:**
- Modify: `packages/database/src/sales-posting-amounts.ts` — `SalesPostingAmountsInput` (:9-17), merchandise (:136-138), `allocateSalesHeaderShipping` weights (:182-189), `calculateSalesIntercompanyAmount` (:219-227)
- Modify: `packages/utils/src/sales-posting-amounts.test.ts`
- Modify: `packages/server-functions/src/post-sales-invoice/index.ts:1088` — `shipmentLine.unitPrice` becomes the net unit price

**Steps:**
1. Add `discountPercent?: number | null` to the input. `merchandise = quantity × unitPrice × (1 − (discountPercent ?? 0))`. `salesRevenueBase`, `salesTaxBase` and `grossReceivableBase` follow from it. Shipping weights and the intercompany amount use the same net merchandise.
2. Intercompany: the buyer-side purchase invoice must match the net amount exactly. Read how `calculateSalesIntercompanyAmount`'s result is compared (`post-sales-invoice/index.ts:1909` and the matching purchase side). If the purchase side recomputes from its own lines with no discount, STOP and report.
3. `post-sales-invoice` reads `salesInvoiceLine` rows with every column (L107) and spreads them into the posting input (L979), so `discountPercent` flows through. Confirm that by reading those lines. If the select lists columns explicitly, add `discountPercent`.
4. Tests: a line of quantity 10 at 40, 20% off, 10% tax → merchandise 320, tax 32, revenue base 320. An existing test with no discount is unchanged. Shipping allocation across a discounted line and an undiscounted line weights by net.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/sales-posting-amounts.test.ts
# Expected: all passed
pnpm --filter @carbon/server-functions test
# Expected: all pass, rental-posting.test.ts unchanged
```

**Out of scope:** COGS (cost-based, never reads prices).

---

## Task 13c: Line discount — documents (PDF, email)

**Depends on:** 4
**Files:**
- Modify: `packages/documents/src/utils/sales-invoice.ts` — `getLineSubtotal` (:38-47), `getLineTaxableSubtotal` (:49-57)
- Modify: `packages/documents/src/pdf/blocks/SummaryBlock.tsx` (:47-50 inline subtotal, :127, :141)
- Modify: `packages/documents/src/pdf/blocks/LineItemsBlock.tsx` (:179 unit price, :184 line total)
- Modify: `packages/documents/src/email/SalesInvoiceEmail.tsx` (:268, :275, :296)
- Modify: `packages/documents/src/pdf/samples.ts` (:53, :67) and `packages/documents/src/utils/document-totals.test.ts`

**Steps:**
1. Line subtotal = `quantity × convertedUnitPrice × (1 − discountPercent)` (documents render in the invoice currency). `getLineTaxesAndFees`, `getLineTotal` and `getTotal` follow.
2. SummaryBlock's inline subtotal uses the same helper, not its own multiplication. Add a "Discount" row (−Σ quantity × convertedUnitPrice × discountPercent) above Subtotal only when it is non-zero, so undiscounted invoices render exactly as before.
3. LineItemsBlock and the email: keep the list unit price, and when `discountPercent > 0` show "−20%" under it (`formatPercent`). The line total is net.
4. Give one sample line `discountPercent: 0.2`. Add a totals test: a 10 × 40 line at 20% off with 10% tax totals 352.

**Verify:**
```bash
pnpm --filter @carbon/documents test
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/documents
# Expected: successful
```

**Out of scope:** quote, order and purchase documents.

---

## Task 13d: Line discount — ERP invoice UI and rental utilization

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` (~:323, the sales invoice line validator) — `discountPercent` (percent points 0–100; the route divides by 100, as quote pricing does)
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm.tsx` (:187 amount, :354-376 tax pair seed, a discount input after the unit price :820)
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceSummary.tsx` (:88-108 per-line math, :209/:264/:268/:298/:302 display, :387-439 totals)
- Modify: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.$lineId.details.tsx` (:238), `$invoiceId.new.tsx` (:185), `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceExplorer.tsx` (:85) — default 0
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts:7425-7484` (`getRentalUtilization`) — select and apply `discountPercent`
- Copy from (precedent): the discount input in `apps/erp/app/modules/sales/ui/Quotes/QuoteLinePricing.tsx:1227-1238`

**Steps:**
1. Validator: `discountPercent: zfd.numeric(z.number().min(0).max(100).optional())`. Convert it to a fraction in the action before `upsertSalesInvoiceLine` (the service passes fields through `sanitize`). Initial values multiply by 100.
2. Line form: a Discount % input (`INPUT_FORMAT` percent-points kind, as the quote uses). Amount = `quantity × unitPrice × (1 − discount)`. Pass the NET unit price into `taxableBase` / `useTaxPair` rather than changing the shared helper.
3. Summary: every `unitPrice × quantity` becomes net. Show the discount beside the unit price when non-zero. Lines 92–99 appear to omit `nonTaxableAddOnCost` unlike the view; leave that unchanged and note it in the run log as a separate finding.
4. Rental utilization: apply the factor to its revenue-base mirror.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
cd apps/erp && pnpm exec vitest run app/modules/invoicing
# Expected: all pass
```

**Out of scope:** sales order and quote screens.

---

## Task 13e: Line discount — Stripe and accounting providers

**Depends on:** 4, 16
**Files:**
- Modify: `packages/stripe/src/send-sales-invoice.server.ts` (`toStripeInvoiceLines`, moved there by Task 16)
- Modify: `packages/stripe/src/connect.server.ts` — `ConnectInvoiceLineInput` doc (:542-580), `expectedConnectInvoiceTotal` (:623-640)
- Modify: `packages/ee/src/accounting/core/sales-invoice-source.ts` (:91 select, :265-285 `lineAmount`)
- Modify: `packages/ee/src/accounting/core/models.ts` (:1226-1278 line schema)
- Modify: `packages/ee/src/accounting/core/sales-document-components.ts` (:166 posting input, :219-234 `unitAmount`, :259 `baseNet`, :184-198 reconciliation)
- Modify: `packages/ee/src/accounting/core/sales-document-components.test.ts` and `packages/ee/src/accounting/providers/{xero,quickbooks-online,rillet}/entities/__tests__/invoice.test.ts`

**Steps:**
1. Stripe: send the NET unit price (`unitPrice × (1 − discountPercent)`, rounded to internal scale), and append "(20% off)" to the description when discounted. `expectedConnectInvoiceTotal` uses the same net price, so the drift check against Stripe's draft total still holds. Stripe coupons are not used.
2. Accounting source and builder: select `discountPercent`, pass it to `calculateSalesPostingAmounts`, and use the net unit price for `unitAmount` (keeping its sanity check against `unitPrice × rate`, net on both sides) and `baseNet`. The reconciliation against the view's subtotal and tax must still pass, because the view (Task 3b) and the builder now agree.
3. Providers: Xero and Rillet send net line amounts and follow automatically. QuickBooks Online sends `UnitPrice: unitAmount` with `Amount` and `Qty`, which now agree because `unitAmount` is net. Do not use provider-native line discount fields.
4. Tests: one discounted line per provider test: the amount is net, and QBO has `Qty × UnitPrice = Amount`. The builder test covers a discounted line reconciling.

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/accounting
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/stripe --concurrency=1
# Expected: successful
```

**Out of scope:** reading back remote discounts (sync mirrors remote values as today).

---

## Task 14: `post-memo` — contract credit memo releases deferral

**Depends on:** 4
**Files:**
- Modify: `packages/server-functions/src/post-memo/post-memo-transaction.ts` (reason account L276-317, journal lines around L416, memo stamp L485)
- Modify: `packages/server-functions/src/post-memo/index.ts` — refuse `void` for a contract memo
- Create: `packages/utils/src/deferral-release.ts` + `.test.ts` (pure); re-export from `packages/utils/src/index.ts`
- Modify: `packages/server-functions/src/post-memo/post-memo-transaction.test.ts`

**Steps:**
1. Pure function in utils: `releaseDeferral(rows: { id; periodStart; amount; status: "Planned" | "Posted" }[], amount): { deleteIds: string[]; reduce: { id; amount }[]; fromRevenue: number }`. Walk the `Planned` rows from the latest `periodStart` backwards. Delete whole rows while `row.amount ≤ remaining`, then reduce the next one by what remains. Any amount left after the Planned rows run out is `fromRevenue`. Tests: 3 Planned rows (100, 100, 100) releasing 150 → delete the last row, reduce the middle to 50, `fromRevenue` 0. Releasing 350 with one row Posted → delete both Planned rows, `fromRevenue` 150.
2. In the posting transaction, when `memo.customerContractId` is set, the memo is an AR Credit, and `accountingEnabled`:
   1. Load the memo-borne rows (`customerContractInvoiceLine.memoId = memo.id`).
   2. For each, find the `Invoiced` non-adjustment row with the same `customerContractLineId` and `periodEnd`. Its `salesInvoiceLineId` identifies the `revenueRecognitionSchedule` rows (`type 'Deferral'`).
   3. Run `releaseDeferral(thoseRows, |adjustment.amount| in base)`, converting with `toBaseAmount` at the memo's `exchangeRate`.
   4. Delete and reduce those rows in the transaction.
   5. Build the journal with the offset split into two debit lines: `deferredRevenueAccount` for the released amount and `salesAccount` for `fromRevenue`.
   Read how the existing reason line is built and extend it to N lines. If the journal builder only supports a single reason line, STOP and report — do not restructure `buildMemoJournal` without approval.
   Otherwise (no contract, or accounting off) the memo behaves as today.
3. `index.ts`: for `type: "void"`, throw `ServerFnError("A contract cancellation credit cannot be voided", 400)` when `memo.customerContractId` is set.
4. Test: a contract memo of 140 against a Planned deferral row of 420 for September → the row becomes 280, the journal debits Deferred Revenue 140, credits AR 140, and balances.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/deferral-release.test.ts
# Expected: all passed
pnpm --filter @carbon/server-functions exec vitest run src/post-memo
# Expected: all passed, existing memo tests unchanged
```

**Out of scope:** Phase B's contract-assets branch; memos without `customerContractId`.

---

## Task 15: `sales.server.ts` — release stamps on delete, create from sales order, wrappers

**Depends on:** 8, 12
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.server.ts` (`releaseRentalInvoiceStamps` L413, `deleteSalesInvoiceReleasingRentals` L452/460, `deleteSalesInvoiceLineReleasingRentals` ~L496, `generateRentalInvoicesNow` L385)
- Copy from (precedent): those functions

**Steps:**
1. Rename `releaseRentalInvoiceStamps` to `releaseRecurringInvoiceStamps`. Keep the rental statements and add, for the same `salesInvoiceLineIds`:
   - `customerContractInvoiceLine` gets `salesInvoiceLineId = null`;
   - the parent `customerContractInvoice` rows (those whose `salesInvoiceId` is the deleted invoice) get `status 'Planned'` and `salesInvoiceId = null`.
   `voidedSalesInvoiceId` stays, so the hold is sticky (rental decision 8).
   Both delete functions also pick lines with `customerContractInvoiceLineId IS NOT NULL`, not only Rental lines. Deleting a single contract line from a Draft invoice releases that row but leaves its `customerContractInvoice` `Invoiced` while the invoice still has other contract lines. Re-open the planned invoice only when no stamped row remains on it.
2. `generateContractInvoicesNow(db, { companyId, userId, customerContractId, asOf })` calls `serverFns.system({ db, companyId, userId }).invokeOrThrow("create-contract-invoices", { asOf, customerContractId })`. Copy `generateRentalInvoicesNow`.
3. `runContractAction(caller, input)` is a thin wrapper over `serverFns.as(caller).invoke("post-customer-contract", input)` for the routes.
4. `createContractFromSalesOrder(db, { companyId, userId, input })` (Kysely, one transaction; resolve the `customerContract` sequence before it):
   1. Lock the order and its chosen lines (`forUpdate`). Refuse a line that is not `Service`, is already `invoicedComplete`, or has `quantityInvoiced > 0`.
   2. Insert the contract. Copy `customerId`, `paymentTermId`, `currencyCode`, `exchangeRate`, `customerReference`, `salesPersonId`, `invoiceCustomerContactId` / `invoiceCustomerLocationId` from the order. Read the order's real column names in `types.ts`; skip any the order does not have. Set `salesOrderId`, `contractType = suggestContractType(...)`, `closeDate = asOf`.
   3. Insert one contract line per order line: `itemId`, `description`, `quantity = saleQuantity`, `rate = unitPrice`, `taxPercent`, `kind`, `rateUnit`, `startDate` = the contract start, `salesOrderLineId`.
   4. Set those order lines to `invoicedComplete = true` (decision 7).
   5. If every line of the order is now `invoicedComplete`, recompute the order's status with the rule in `post-sales-invoice` (around L1520–1580: all invoiced and shipped → `Completed`, all invoiced → `To Ship`). Copy the rule, don't import it.
   Return the new contract id.
5. `deleteContractReleasingSalesOrderLines(db, { companyId, id })`. Draft only. In one transaction: set `invoicedComplete = false` on the order lines its lines reference, where `quantityInvoiced < saleQuantity`, then delete the contract. Do the same for a single line: `deleteContractLineReleasingSalesOrderLine`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
grep -n "releaseRentalInvoiceStamps" -r apps/erp/app | wc -l
# Expected: 0
```

**Out of scope:** `convert` (decision 7); MCP delete tools (documented gap, unchanged).

---

## Task 16: `@carbon/stripe` — shared send of a posted invoice; the post route uses it

**Depends on:** 4
**Files:**
- Create: `packages/stripe/src/send-sales-invoice.server.ts`
- Modify: `packages/stripe/package.json` — export `"./send-sales-invoice.server": "./src/send-sales-invoice.server.ts"`
- Modify: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.post.tsx` — delete the moved helpers (`storeStripeInvoicePdf` L66, `appendStripeLinkToNotes` L134, `toStripeInvoiceLines` L223, `toStripeEpochSeconds` L254, `clampDueDate` L268, `clampEffectiveAt` L276) and the send block (around L990–1080); call the new function
- Modify: `apps/erp/app/modules/invoicing/stripe-customer.server.ts` — `getStripeConnectAccountId` (L139) and `STRIPE_CONNECT_INTEGRATION` become re-exports from the new module

**Steps:**
1. Move the six helpers verbatim. Add, from `stripe-customer.server.ts`, `STRIPE_CONNECT_INTEGRATION` and `getStripeConnectAccountId`. Add `getLinkedStripeCustomerId(serviceRole, companyId, customerId): Promise<string | null>`, a read of `externalIntegrationMapping` for `customer` / `STRIPE_CONNECT_INTEGRATION`, using the columns `createMappingService.link` writes.
2. Export:
```ts
export async function sendPostedSalesInvoiceViaStripe(args: {
  serviceRole: SupabaseClient<Database>; companyId: string; userId: string; invoiceId: string;
  stripeAccountId: string; stripeCustomerId: string; dueDateOverride?: string | null;
  linkStripeInvoice: (stripeInvoiceId: string, metadata: { hostedInvoiceUrl: string | null; invoicePdf: string | null }) => Promise<void>;
}): Promise<{ stripeInvoiceId: string; hostedInvoiceUrl: string | null; invoicePdf: string | null }>
```
   The body is the route's send block. Replace its ERP service reads (`getSalesInvoiceLines`, `getSalesInvoiceShipment`, `getSalesInvoiceCustomerDetails`, `getCompanyTimeZone`) with direct `serviceRole` reads of the same views or tables (`salesInvoiceLines`, `salesInvoiceShipment`, the customer-details view or RPC the ERP service uses, and `getCompanyTimeZone` from `@carbon/lib` if exported there, else read it the way the ERP helper does). Then call `createAndSendConnectInvoice`, `linkStripeInvoice`, `storeStripeInvoicePdf` and `appendStripeLinkToNotes`. It throws on failure.
3. The route keeps `preflightStripeSend` and its own error handling. It calls `sendPostedSalesInvoiceViaStripe` with `linkStripeInvoice = (id, metadata) => createMappingService(getDatabaseClient(), companyId).link("salesInvoice", invoiceId, STRIPE_CONNECT_INTEGRATION, id, { metadata })`. Behaviour must be identical.
4. The new module must not import `@carbon/ee` or any `~/` path.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/stripe --filter=erp --concurrency=1
# Expected: successful
grep -n "function toStripeInvoiceLines\|function storeStripeInvoicePdf" "apps/erp/app/routes/x+/sales-invoice+/\$invoiceId.post.tsx"
# Expected: no output
grep -n "@carbon/ee" packages/stripe/src/send-sales-invoice.server.ts
# Expected: no output
```

**Out of scope:** the post modal and preflight; changing what is sent to Stripe.

---

## Task 17: Automation — contract source, Stripe mode

**Depends on:** 12, 16
**Files:**
- Modify: `packages/jobs/src/invoicing/automate-invoice.ts` — `resolveInvoiceAutomation` (L65-89), `getInvoiceOwnerEmail` (L305-333), new `sendPostedInvoiceViaStripe`
- Modify: `packages/jobs/src/invoicing/automate-invoice.test.ts`
- Modify: `packages/jobs/src/inngest/functions/tasks/invoice-automate.ts` — the Stripe branch
- Modify: `packages/lib/src/events.ts:769` — `mode?` adds `"Post and Send via Stripe"`

**Steps:**
1. `resolveInvoiceAutomation`: read `salesInvoice.customerContractId` first. When set, return the `customerContracts` view's `effectiveInvoiceAutomation`. Otherwise use the current rental path, unchanged.
2. `getInvoiceOwnerEmail`: when `salesInvoice.customerContractId` is set, the owner is `customerContract.salesPersonId ?? createdBy`. Otherwise use the rental path.
3. Export `INVOICE_SEND_NO_STRIPE = "No Stripe customer is linked"` and `INVOICE_SEND_STRIPE_NOT_CONNECTED = "Stripe is not connected"`.
   `sendPostedInvoiceViaStripe({ client, companyId, invoiceId }): Promise<EmailOutcome>`:
   1. Skip when `sentAt` is set or the invoice is not posted (`isPostedSalesInvoice`).
   2. `getStripeConnectAccountId`; null → `stampSendError(INVOICE_SEND_STRIPE_NOT_CONNECTED)`.
   3. Billing customer = `invoiceCustomerId ?? customerId`; `getLinkedStripeCustomerId`; null → `stampSendError(INVOICE_SEND_NO_STRIPE)`.
   4. `sendPostedSalesInvoiceViaStripe` with `linkStripeInvoice` built from `createMappingService` (`@carbon/ee/accounting`, which jobs already depends on).
   5. Success → stamp `{ sentAt: datetime.timestamp(), sentTo: "Stripe", sendError: null }`. A throw → `stampSendError(message)`.
4. `invoice-automate.ts`: after `post`, when the mode is `Post and Send via Stripe`, run step `stripe` → `sendPostedInvoiceViaStripe`. The email branch is unchanged.
5. Tests, extending the existing mocks: a contract invoice resolves the contract's mode; a Stripe send with no link stamps `INVOICE_SEND_NO_STRIPE`; a successful send stamps `sentTo "Stripe"`.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/invoicing
# Expected: all passed
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/lib --concurrency=1
# Expected: successful
```

**Out of scope:** the email path; the digest builder (unchanged, it is already source-agnostic).

---

## Task 18: `recurring-billing` — the contract source

**Depends on:** 17
**Files:**
- Modify: `packages/jobs/src/inngest/functions/scheduled/recurring-billing.ts` (find-companies L45-52, the per-company step, the invoice loop L126-181, digest recipients L192-197)

**Steps:**
1. `find-companies`: the DISTINCT union of companies with an Active `rentalAgreement` and companies with an Active `customerContract`.
2. Per company, after the existing `rental-billing-${company.id}` step, add `contract-billing-${company.id}`. It invokes `create-contract-invoices` with the same `asOf` and the same try/catch isolation, and returns `{ invoices, failures }`. Map contract invoices to the loop's shape with `sourceId: customerContractId`. Concatenate both lists before the posting loop.
3. In the loop, a `Post and Send via Stripe` invoice posts like the others, then runs step `stripe-${invoiceId}` (`sendPostedInvoiceViaStripe`). The outcome is `"emailed"` when sent and `"unsent"` with an error, so the digest counts it as sent.
4. Digest recipients: owners also include `customerContract` ids → `salesPersonId ?? createdBy` (filtered to `userToCompany`, as rentals are).
5. One company's contract step throwing must not stop the others. Copy the existing try/catch per step.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --concurrency=1
# Expected: successful
pnpm --filter @carbon/jobs test
# Expected: all pass
```

**Out of scope:** renaming the step ids of the rental source.

---

## Task 19: Settings and rental override offer *Post and Send via Stripe*

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `invoiceAutomations` (L37)
- Modify: `apps/erp/app/routes/x+/settings+/invoicing.tsx` — the mode select's options and helper copy
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementProperties.tsx` (~L387) — option label
- Copy from (precedent): the existing options in those files

**Steps:**
1. Add `"Post and Send via Stripe"` to the settings array. The sales array was done in Task 7.
2. Label it "Post and send via Stripe". Helper copy: "Posts the invoice and sends it through your connected Stripe account with a payment link. Customers without a linked Stripe customer are held."
3. When Stripe Connect is not connected (`getStripeConnectAccountId` in the settings loader returns null), disable the option with the tooltip "Connect Stripe in Integrations first".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** the rental agreement's Invoice Now (unchanged; `invoice-automate` handles the new mode).

---

## Task 20: Paths, navigation, status colors, route types

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — next to the rental entries (L891–896, L1722–1726, L2103–2124)
- Modify: `apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx` (L60–65)
- Modify: `packages/utils/src/status-colors.ts` (L177, L408)

**Steps:**
1. Paths:
   - `contracts: \`${x}/sales/contracts\``
   - `newContract: \`${x}/contract/new\``
   - `contract(id)`, `contractDetails(id)`, `contractSchedule(id)`, `contractConfirm(id)`, `contractAmend(id)`, `contractCancel(id)`, `contractRevertCancellation(id)`, `contractInvoice(id)`, `contractUpdate: \`${x}/contract/update\``
   - `deleteContract(id)`, `newContractLine(id)`, `contractLine(id, lineId)`, `deleteContractLine(id, lineId)`
   - `salesOrderContract(orderId)` → `${x}/sales-order/${orderId}/contract`
   Each id helper uses `generatePath`, as the rental helpers do.
2. Nav: `{ name: t\`Contracts\`, to: path.to.contracts, icon: <LuFileSignature />, table: "customerContract" }` before Rentals. If `LuFileSignature` is not exported by the installed `react-icons/lu`, use `LuFileText`.
3. `CUSTOMER_CONTRACT_STATUS_COLOR_MAP`: Draft gray, Active green, Ended muted. Copy `RENTAL_AGREEMENT_STATUS_COLOR_MAP`'s value shape and register its key at L408.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/utils
# Expected: successful
```

**Out of scope:** routes (Tasks 21–30).

---

## Task 21: Contracts list

**Depends on:** 8, 20
**Files:**
- Create: `apps/erp/app/routes/x+/sales+/contracts.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractsTable.tsx`, `ContractStatus.tsx`, `index.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/sales+/rental-agreements.tsx`, `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementsTable.tsx`, `RentalStatus.tsx`, `ui/Rentals/index.ts`

**Steps:**
1. The route copies the rental list: `requirePermissions(request, { view: "sales" })`, `getGenericQueryFilters`, `getContracts`, render `<ContractsTable data count />` + `<Outlet />`, and a `handle` breadcrumb `msg\`Contracts\``.
2. Columns: ID (`Hyperlink` → `path.to.contract`), Name, Customer (`CustomerAvatar`), Type, Status (`ContractStatus`), Contract value (money; "—" for a Draft with `contractValue = 0`), Invoiced to date, Next invoice (date), Ends on (`endDate`, "Open-ended" when null), plus `useCustomColumns("customerContract")`. The New button goes to `path.to.newContract` (permission `create: "sales"`).
3. Use the `carbon-design` skill's list archetype. Money uses `useCurrencyFormatter` with the row's `currencyCode`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** recognized and deferred columns (Phase B).

---

## Task 22: Contract page shell — new, header, explorer, properties, update, delete

**Depends on:** 21
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/_layout.tsx`, `new.tsx`, `update.tsx`, `$id.tsx`, `$id._index.tsx`, `$id.details.tsx`, `$id.delete.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractForm.tsx`, `ContractHeader.tsx`, `ContractExplorer.tsx`, `ContractProperties.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/rental-agreement+/` (`_layout`, `new`, `update`, `$id`, `$id._index`, `$id.details`, `$id.delete`) and `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementForm.tsx`, `RentalAgreementHeader.tsx`, `RentalAgreementExplorer.tsx`, `RentalAgreementProperties.tsx`

**Steps:**
1. `new.tsx`:
   1. `requirePermissions(request, { create: "sales" })`, validate with `customerContractValidator`.
   2. `getNextSequence(client, "customerContract", companyId)`.
   3. `contractType` from `suggestContractType(await getCustomerContractStatuses(...))` unless the form set it.
   4. `insertContract`, then redirect to `path.to.contractDetails(id)`.
   The form fields follow the spec's Properties list. Duration is a select (6 months / 1 year / 2 years / 3 years / Open-ended / Custom); Custom reveals End date.
2. `$id.tsx` loader (`view: "sales"`):
   1. Load the contract, lines, persisted schedule and amendments with `Promise.all`.
   2. If the contract is a Draft with no persisted rows, `computedSchedule = planInvoiceSchedule(toTerms, toLineTerms, horizon(terms, today))`, where `today = datetime.today(await getCompanyTimeZone(client, companyId)).toString()`. Otherwise use the persisted schedule.
   3. `residuals = validateScheduleEdit(...)` for an edited Draft.
   4. `revenue` = `revenuePreview` per line, with `netAmount` = that line's scheduled total.
   Layout: `<PanelProvider><ContractHeader/><ResizablePanels explorer={<ContractExplorer key={id}/>} content={<VStack><Outlet/></VStack>} properties={<ContractProperties key={id}/>}/></PanelProvider>`. Breadcrumb as rentals, with `module: "sales"`.
3. Header: ID, name, `ContractStatus`, "Ends {date}" when `cancelledAt` is set. Buttons: Confirm (Draft), Invoice Now (Active), Amend (Active), Cancel (Active), Revert cancellation (Active with `cancelledAt` and endDate ≥ today), Delete (Draft). Each links to its route, built in Tasks 27–29. Gate them with `usePermissions().can("update", "sales")`.
4. Explorer: lines grouped One-time / Recurring, each linking to `path.to.contractLine`, with *Add Line* (Draft) → `path.to.newContractLine`. Lines replaced by an amendment show struck through with "until {endDate}".
5. Properties: the spec's Properties list, saved through `update.tsx` intents, copying the rental update route. Draft fields are editable. On an Active contract only `contractType`, `invoiceAutomation` and `notes` are editable (the others are read-only text). Invoicing select: "Company default ({mode})" plus the four modes.
6. `$id.details.tsx` renders the center sections in order: `<ContractSummary/>`, `<ContractInvoices/>`, `<ContractRevenue/>`, `<ContractAmendments/>`. Until Tasks 24–28 build them, render the section headings with an empty state.
7. `$id.delete.tsx`: Draft only. Calls `deleteContractReleasingSalesOrderLines(getDatabaseClient(), …)` and redirects to `path.to.contracts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** the section bodies (Tasks 24–26, 28).

---

## Task 23: Line form and line routes

**Depends on:** 22
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/$id.lines.new.tsx`, `$id.$lineId.details.tsx`, `$id.$lineId.delete.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractLineForm.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/rental-agreement+/$id.lines.new.tsx`, `$id.$lineId.details.tsx`, `$id.$lineId.delete.tsx`; `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementLineForm.tsx`

**Steps:**
1. Fields: Service item (the item picker filtered to `type: "Service"`; find the filter prop by reading how the picker is used for service items elsewhere), Kind (One-time / Recurring), Description (customer-facing), Quantity, Rate (`INPUT_FORMAT.rate`) plus Per (rate unit, Recurring only), Discount % plus Discount ends on, Tax %, Start / End, Go-live, Revenue method plus Revenue start / end (collapsed under "Revenue"), Project (defaults to the contract's project).
2. Actions: `update: "sales"`, `upsertContractLine`. A Draft-guard refusal flashes its message.
3. Delete route: `deleteContractLineReleasingSalesOrderLine(getDatabaseClient(), …)`.
4. An Active contract renders the form read-only with the note "Change lines with Amend".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** multi-select add (follow-up).

---

## Task 24: Summary section

**Depends on:** 22
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractSummary.tsx`
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementSummary.tsx`

**Steps:**
1. One row per line, written as a sentence: "Implementation · one-time · $60,000.00", "Platform access · 10 × $40.00 per month · 20% off until 31 Oct 2027".
2. Totals: contract value (Σ the schedule), recurring per period (`recurringValuePerPeriod(lines, billingFrequency, today)`, labelled "per month / quarter / …"), next invoice (date and total).
3. When the effective mode is not `Draft Only` and the contract is Active, show "Invoices are drafted and {posted / posted and emailed / posted and sent via Stripe} automatically." Copy the rental summary copy at `RentalAgreementSummary.tsx:263-281`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** recognized and deferred figures (Phase B).

---

## Task 25: Invoices section and schedule editing

**Depends on:** 22, 9
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractInvoices.tsx`, `ContractInvoiceSplitModal.tsx`
- Create: `apps/erp/app/routes/x+/contract+/$id.schedule.tsx` (action only)
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Rentals/RentalBillingPeriods.tsx` (table, the Held badge at L152); a `useFetcher` modal form such as `apps/erp/app/modules/sales/ui/SalesReturnOrders/ReturnableLinesModal.tsx`

**Steps:**
1. Table: date, total, lines (expandable: line name, service window, amount, an "Adjustment" badge), status (Planned / Invoiced with a link to the sales invoice / Billed externally), "Edited" badge, and a Held badge when the drafted invoice has `automationHoldReason` (load it with the schedule in Task 22's loader through the stamped `salesInvoiceId`, in one `.in()` query).
2. Draft only, per invoice: *Move date* (date picker), *Merge into…* (select another Planned invoice). Per line: *Split* (modal with N installments of date and amount, live residual "{x} left to place"), *Move to…* (date). All of these post to `$id.schedule.tsx`.
3. When `residuals` has a non-zero value, show a warning callout listing each line's residual ("Platform access: {x} not on any invoice") and a *Reset schedule* button (intent `reset`).
4. `$id.schedule.tsx`:
   1. `update: "sales"`, `customerContractScheduleEditValidator`.
   2. `runContractAction(…, { type: "edit-schedule" | "reset-schedule", customerContractId, asOf: today, edit })`.
   3. Flash the server function's error message on refusal. That is how the residual message from Task 9 step 4 reaches the user.
5. Memo-borne rows (cancellation credit) show under the table as "Credited on {memoId}" with a link to `path.to.memo`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** drag-and-drop.

---

## Task 26: Revenue section (preview)

**Depends on:** 22
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractRevenue.tsx`
- Copy from (precedent): the table styling of `RentalBillingPeriods.tsx`

**Steps:**
1. Per line: method, project, revenue dates (`lineRevenueDates`), and its monthly revenue preview.
2. A per-month table from `contractPositionPreview`: Month, Invoiced, Recognized, Deferred. A negative deferred amount reads "Earned, not billed".
3. Footnote: "Preview. Until line-level revenue arrives, posted revenue follows each invoice line's service period by day." This is the Phase A interim (spec "Delivery phases").

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** posted figures (Phase B).

---

## Task 27: Confirm and Invoice Now

**Depends on:** 15, 17, 22
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/$id.confirm.tsx`, `$id.invoice.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractConfirmModal.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/rental-agreement+/$id.activate.tsx` and `$id.invoice.tsx`; the Stripe customer step in `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoicePostModal.tsx` + `StripeCustomerPanel.tsx`, and `preflightStripeSend` in `$invoiceId.post.tsx` (L300)

**Steps:**
1. Modal: a summary (first invoice date and total, invoice count to the horizon, the effective invoicing mode). When the mode is Stripe and no customer is linked, show `StripeCustomerPanel`. Read how the post modal fetches `path.to.api.stripeConnectCustomer`. If that API requires an `invoiceId` and cannot resolve by customer, STOP and report — a by-customer variant is a design change.
2. `$id.confirm.tsx`:
   1. `requirePermissions(request, { update: "sales" })`. When the effective mode is not `Draft Only`, also require `create: "invoicing"`.
   2. Stripe mode: run the link step (resolve plus `mappingService.link("customer", …)`, as in `preflightStripeSend`).
   3. `runContractAction(…, { type: "confirm", customerContractId, asOf: today })`.
   4. Flash the result and redirect to the contract.
3. `$id.invoice.tsx` (Invoice Now): `update: "sales"` + `create: "invoicing"`. Call `generateContractInvoicesNow`, then `batchTrigger("invoice-automate", …)` for the invoices that are not held and not `Draft Only`, passing `mode`. Copy the rental route exactly. Flash "Drafted N invoice(s)", or "Nothing is due" when there are none.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** changing `preflightStripeSend`.

---

## Task 28: Amend modal, preview, amendment history

**Depends on:** 10, 22
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/$id.amend.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractAmendModal.tsx`, `ContractAmendments.tsx`
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementReturnForm.tsx` (a modal form posting to a document action route)

**Steps:**
1. Modal: effective date (default today), "Takes effect" (From the change date / From the next billing period), a table of open lines with editable quantity / rate / discount / tax / description and an End checkbox, *Add line*, reason, contract type (pre-filled from the preview's `suggestedType`).
2. Preview: on change (debounced), a fetcher posts `intent=preview` to `$id.amend.tsx`, which runs `runContractAction({ type: "amend", preview: true, … })`. It renders the adjustments, the next two invoices and the suggested type. When `resetsEditedInvoices > 0` it adds the warning "This resets {n} edited invoice(s) after {date}".
3. Save: `intent=save` → `runContractAction({ type: "amend", … })`.
4. `ContractAmendments`: history (date, effect, type, reason) and the replaced → replacement lines with their changed fields.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** amending a Draft (Draft edits lines directly).

---

## Task 29: Cancel modal and revert

**Depends on:** 11, 22
**Files:**
- Create: `apps/erp/app/routes/x+/contract+/$id.cancel.tsx`, `$id.revert-cancellation.tsx`
- Create: `apps/erp/app/modules/sales/ui/Contracts/ContractCancelModal.tsx`
- Copy from (precedent): the Task 28 modal

**Steps:**
1. Modal: end date (default `currentPeriodEnd(terms, today)`), reason, and *Credit unused time*. The checkbox is visible only when the preview returns `creditAvailable`, and reads "Credit unused time ({credit})".
2. Preview through `intent=preview` as in Task 28. Save → `runContractAction({ type: "cancel", … })`. When a memo was created, flash "Cancelled. Credit memo {memoId} drafted" with a link.
3. Revert route: `update: "sales"` → `runContractAction({ type: "revert-cancellation", … })`, behind a `Confirm` dialog.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** posting the memo (the user posts it from Credits; Task 14 handles the accounting).

---

## Task 30: Create Contract from a sales order

**Depends on:** 15, 22
**Files:**
- Create: `apps/erp/app/routes/x+/sales-order+/$orderId.contract.tsx`
- Create: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderToContractModal.tsx`
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx` — add the action next to the jobs action
- Copy from (precedent): `apps/erp/app/modules/sales/ui/SalesReturnOrders/ReturnableLinesModal.tsx` (checkbox modal), `apps/erp/app/modules/sales/ui/Quotes/QuoteToOrderDrawer.tsx` (hidden JSON `selectedLines`), `apps/erp/app/routes/x+/quote+/$quoteId.convert.tsx`

**Steps:**
1. Show the action only when the order has at least one `Service` line that is not `invoicedComplete` and has `quantityInvoiced = 0`, and the user can `create` sales.
2. Modal: the eligible Service lines with a checkbox, Kind (One-time / Recurring) and Per (rate unit when Recurring); contract name (default "{customer} — {order id}"), start date, duration, frequency, alignment, timing. Post hidden JSON `lines`.
3. Route: `create: "sales"`, `createContractFromSalesOrderValidator`, `createContractFromSalesOrder(getDatabaseClient(), …)`, then redirect to the new contract's details.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** goods lines (spec: physical goods stay on sales orders).

---

## Task 31: "From contract" links on invoices, invoice lines and memos

**Depends on:** 22
**Files:**
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm.tsx` — beside `RentalInvoiceLineSummary` (L135)
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader.tsx` — near the related-documents area (~L151)
- Modify: the memo detail header (find it with `grep -rln "path.to.memo" apps/erp/app/modules/invoicing/ui`)

**Steps:**
1. Line form: when `customerContractLineId` is set, show "Generated from contract {CON…}" linking to `path.to.contract(customerContractId)`. Copy `RentalInvoiceLineSummary`'s `useCarbon` lookup.
2. Invoice header: when `salesInvoice.customerContractId` is set, add a "Contract {CON…}" link.
3. Memo header: the same when `memo.customerContractId` is set.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: successful
```

**Out of scope:** list columns.

---

## Task 32: Demo datasets

**Depends on:** 5
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — `SalesData` (~L870) gains `contracts: ContractSpec[]`
- Modify: `packages/database/src/datasets/data/{satellite,robotics,precision,motor}/sales.ts`
- Modify: `packages/database/src/datasets/tiers/04-sales.ts` — after the sales-return block (~L465)
- Modify: `packages/database/src/datasets/coverage.ts` — floors
- Copy from (precedent): the sales-return block in `04-sales.ts` (`nextSequence(ctx, "salesReturnOrder")`, `insertId`); `.claude/rules/onboarding-company-templates.md` (offsets, never `Date`)

**Steps:**
1. `ContractSpec`:
```ts
{ key; name; customer; startOffset: DayOffset; termMonths: number | null; renewal; renewalUpliftPercent;
  billingFrequency; billingAlignment; billingTiming;
  lines: { kind; item; description; quantity; rate; rateUnit?; discountPercent?; startOffset; endOffset?; revenueMethod }[] }
```
   Percentages are written as people write them; the tier divides by 100.
2. One contract per dataset: a One-time implementation line and two Recurring lines, on Service items that already exist in that dataset. If a dataset has fewer than three Service items, add the missing ones to its items slice. The contract starts at offset −60, Monthly / Calendar / Advance, a 12-month term renewing at 5%.
3. Tier:
   1. Insert the contract as Active with `confirmedAt` and lines.
   2. Plan the schedule with `planInvoiceSchedule` (import `../../contract-schedule`) through `horizon(terms, anchor)`.
   3. Insert it with every invoice dated ≤ the anchor marked `Billed Externally` and `billedThrough` set to the last such row's `periodEnd`. This keeps the seed free of drafted invoices, which tier 09 would otherwise have to journal.
4. Floors: measure with `pnpm db:check:datasets` (read the counts it reports), then add `customerContract: 1`, `customerContractLine: 3`, `customerContractInvoice` / `customerContractInvoiceLine` at their measured minimum × 0.8 (rounded down).

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets OK, no shortfalls
pnpm --filter @carbon/database test
# Expected: all pass
```

**Out of scope:** seeding drafted or posted contract invoices.

---

## Task 33: MCP digest, lint, i18n, scoped typechecks, tests

**Depends on:** 1–32
**Files:** generated and catalog files only

**Steps:**
1. `pnpm generate:mcp`, then `pnpm check:manifest`.
2. `pnpm --filter @carbon/checks license-headers` (fixes any new file's SPDX header).
3. `pnpm run lint` (fix new findings only).
4. `pnpm lingui:extract`, then the `/translate` skill to fill new strings.
5. Run the scoped typechecks and tests below.

**Verify:**
```bash
pnpm check:manifest
# Expected: OK
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/server-functions --filter=@carbon/database --filter=@carbon/utils --filter=@carbon/stripe --filter=@carbon/lib --filter=@carbon/ee --filter=@carbon/documents --concurrency=1
# Expected: all successful (or only the Task 1 baseline failures)
pnpm --filter @carbon/utils test && pnpm --filter @carbon/database test && pnpm --filter @carbon/server-functions test && pnpm --filter @carbon/jobs test && pnpm --filter @carbon/checks test && pnpm --filter @carbon/documents test && pnpm --filter @carbon/ee exec vitest run src/accounting
# Expected: all pass
cd apps/erp && pnpm exec vitest run app/modules/sales test/list-select-columns.test.ts
# Expected: all pass
```

**Out of scope:** pre-existing lint findings.

---

## Task 34: Docs — reference page, glossary, AGENTS.md, rules, spec changelog

**Depends on:** 33
**Files:**
- Create: `docs/content/docs/reference/contracts.mdx` (use the `carbon-docs` skill); add it to `docs/content/docs/reference/meta.json`
- Modify: `docs/content/src/glossary/terms.ts` — *Contract*, *Contract type*, *Invoice schedule*, *Revenue method*, *Billed through*, *Amendment* (copy the `"rental-agreement"` entry shape, ~L496)
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — a "Contracts" section beside "Rentals"
- Modify: `packages/server-functions/AGENTS.md` only if it lists functions
- Modify: `.ai/specs/2026-10-02-contracts.md` — Changelog entry recording plan-level decisions 1–15, plus the path mapping table
- Copy from (precedent): `docs/content/docs/reference/rental-agreements.mdx`

**Steps:**
1. The reference page covers concepts, lifecycle (`<StatusFlow entity="customerContract">`, if `StatusFlow` reads entities from a registry, register it there as rental agreements are), invoice schedule editing, amendments, cancellation, renewal, invoicing automation, and a Phase A callout that revenue follows invoice service periods.
2. Regenerate the agent knowledge base with the command in `.claude/rules/agent-knowledge-base.md`.
3. Add any durable lesson to `.ai/lessons.md` (`Context → Problem → Rule → Applies to`).

**Verify:**
```bash
pnpm --filter docs typecheck
# Expected: successful
pnpm --filter @carbon/content test
# Expected: terms.test.ts passes
```

**Out of scope:** a changelog entry (shipped with the PR, `changelog-entry` skill).

---

## Task 35: Browser verification (`/test`)

**Depends on:** 34
**Files:** `.ai/playbooks/` (cached by `/test`), the run log

**Steps:** With the user's permission, `/auth` then `/test` against the running stack, with accounting enabled and default mode *Post and Email*. Record PASS or FAIL for each check in the run log:
1. Create the Acme Draft (Task 5's worked example). The Invoices section shows 1 Nov = $60,420.00 and $420.00 monthly. The Revenue preview shows implementation $10,000/month Nov–Apr. November reads invoiced $60,420.00, recognized $10,420.00, deferred $50,000.00.
2. Split implementation into 3 × $20,000 (1 Nov / 1 Dec / 1 Jan): accepted. A split totalling $50,000: refused, with the residual shown.
3. Confirm. Invoice Now on/after 1 Nov drafts one invoice with three Service lines (service windows 1–30 Nov ×2 and 1 Nov–30 Apr), and it posts. A second Invoice Now drafts nothing. The journal credits Deferred Revenue $60,420.00. With a project on the contract and an override on one line, each line's revenue-side journal line carries its own Project dimension and AR carries none.
4. A $10/day line bills $310.00 for a 31-day month.
5. Amend on 12 March (10 → 15 seats, From the change date): the preview shows −$206.45 / +$309.68 and Expansion. With *From the next billing period* there are no March lines.
6. Cancel effective 20 Sep with Credit unused time: a Draft credit memo for $140.00. Post it: the journal debits Deferred Revenue. Revert is refused after posting.
7. VOID a posted contract invoice. Invoice Now re-drafts it, held with "Re-billing INV-…, which was voided".
8. An invoice containing a negative adjustment is held under *Post and Email*.
9. Set the contract to *Post and Send via Stripe* with no linked customer: Confirm asks for the link. In test mode with Stripe connected, the invoice is sent and stamped "Stripe". Without Stripe, the option is disabled in Settings.
10. Create Contract from a sales order with one Service line ticked. Invoicing the order bills only the remaining lines, and the order completes when they are invoiced.
11. A EUR contract posts with base translation.
12. Rental agreement Invoice Now still behaves as before.
13. The drafted Acme invoice's platform line shows 10 × $40.00, −20%, $320.00, on screen and in the PDF. A hand-made invoice line at 20% off posts net revenue, and the invoice total matches the list.
Email-dependent checks (actual delivery, digest) are recorded as pending when SMTP is not configured, as in the rental plan.

**Verify:**
```bash
grep -c "PASS" .ai/runs/2026-10-02-contracts.md
# Expected: ≥ 13 (or each FAIL has a follow-up)
```

**Out of scope:** Phase B acceptance criteria.
