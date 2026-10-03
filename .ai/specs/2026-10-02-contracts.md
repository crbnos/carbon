# Contracts — AR contracts with independent billing and revenue schedules

> Status: draft
> Author: Brad (with Claude)
> Date: 2026-10-02
> Research: `.ai/research/subscription-recurring-invoicing.md` (SAP, NetSuite, Business Central, D365 F&O, Acumatica, Odoo, Xero, QuickBooks, Stripe, Chargebee, Maxio; Rillet and Stripe API data models; Rillet's Contract screens)
> Interview record: `.ai/runs/2026-10-02-grill-subscriptions.md` (Q1–Q11, U1–U4, G1–G9)
> Builds on: `.ai/specs/2026-10-02-rental-invoice-automation.md` (the shared recurring-invoicing layer — this spec is its second source), `.ai/specs/2026-09-22-revenue-recognition-and-rentals.md` (revenue recognition run, Contract Assets accrual, rental revenue posting model)
> Delivers from the billing side: the "revenue arrangement" of `.ai/specs/2026-07-04-revenue-recognition.md` Phases 2–3 (without SSP allocation)
> Supersedes: the earlier "Subscriptions" draft of this file (same path history)

## TLDR

A **contract** is a new AR document in Sales for everything a customer buys as an agreement rather than a shipment: SaaS access, support and maintenance plans, implementation and setup fees, prepaid licences. Its **lines** are **One-time** or **Recurring** **Service** items, each with quantity, rate, discount %, tax, its own dates, and a **revenue pattern** (*Daily* or *Even per month*, prorated first & last) over revenue dates that default to the line's (a **go-live** date can push the start). A contract has two **independent schedules** built from the same lines:

- an **invoice schedule** — computed from the billing frequency (Week / Month / Quarter / Year), alignment (Anniversary or Calendar), timing (Advance / Arrears) and first invoice date, with one-time lines on the first invoice — that the user can **edit while Draft** (move, split, merge invoices; each line's billed total conserved);
- a **revenue schedule** — read-only, computed per line from its pattern and revenue dates — with an **invoiced / recognized / deferred** summary per month.

Revenue follows the **line, not the invoice**: the monthly recognition run recognizes each line's schedule, releasing Deferred Revenue where it was billed ahead and accruing **Contract Assets** where it was earned first, and invoice posting relieves the accrual before deferring the rest — the rental revenue model, generalized. Due invoices are drafted daily by the shared **`recurring-billing`** job and handed to the shared **recurring-invoicing layer** (post / email / send via Stripe / hold / digest), with the company default automation mode and a per-contract override. Changes are **amendments** (a dated header with a reason and contract type, plus replacement lines), prorated from the change date or effective from the next period. **Cancel** picks an end date and can credit unused prepaid time as a credit memo. A fixed **term** renews automatically with an optional uplift %. Every contract and amendment carries a **contract type** (New Sales, Existing, Expansion, Reactivation, Contraction). Migrated contracts carry **Billed through** and **Recognize revenue from** dates. Contracts are created standalone or from chosen Service lines of a sales order. Rental agreements stay their own document and share the invoicing layer. Nothing on the AP side.

## Problem Statement

A customer moving all of its customer invoicing to Carbon needs one-off invoices (covered), rentals (covered by rental agreements, being automated by `2026-10-02-rental-invoice-automation`), and **contracts** — which Carbon cannot express:

- No recurring-invoice, subscription, contract or copy-invoice feature exists in the sales or invoicing domain (verified; `@carbon/stripe` subscription code is Carbon's own plan billing).
- Rental agreements bill on a cycle but need a serialized fleet unit per line.
- Revenue is tied to the invoice: a Service line defers over its own service dates at posting. There is no way to bill $60,000 for implementation on signature and recognize it over the six months it is delivered, to recognize revenue earned before it is invoiced, or to see a contract's invoiced vs recognized vs deferred position.
- Every renewal, seat increase, discount expiry and cancellation is tracked outside Carbon.

Worked example used throughout: *Acme* signs on 15 October 2026 — implementation $60,000 one-time (revenue over 1 Nov–30 Apr, go-live 1 Nov), platform access 10 seats × $40 per Month with 20 % off the first year, premium support $1,200 per Year — invoiced Monthly, Calendar, in Advance, first invoice 1 November, 12-month term renewing at +5 %.

## Proposed Solution

### Concepts

| Term | Meaning |
|---|---|
| **Contract** | The AR agreement header: customer, invoicing terms, schedule settings, term and renewal, contract type, migration dates, automation override. Readable id `CON000001`. |
| **Contract line** | A Service item, **One-time** or **Recurring**, with quantity, rate, discount %, tax %, start / end dates, revenue pattern, revenue start / end, go-live date. |
| **Rate unit** | Recurring lines only: what the rate is per — Day, Week, Month, Quarter, Year. Independent of the billing frequency ($10 per Day invoiced Monthly). |
| **Billing frequency / alignment / timing** | Every Week / Month / Quarter / Year; *Anniversary* (from the start date) or *Calendar* (1st of week (Monday) / month / quarter / year, first period prorated); *Advance* (due on the period's first day) or *Arrears* (last day). |
| **Invoice schedule** | Persisted planned invoices (`customerContractInvoice`) and their lines (`customerContractInvoiceLine` — contract line, billing period, amount). Computed, then editable while Draft with each contract line's billed total conserved. |
| **Revenue pattern** | *Daily* (equal per day) or *Even per month, prorated first & last* (equal per calendar month, partial first/last months by days) — Rillet `DAILY` / `EVEN_PERIOD`. |
| **Revenue schedule** | Persisted per line per month (`customerContractRevenue`), computed from the pattern over the line's revenue dates. Read-only. |
| **Amendment** | A dated change (`customerContractAmendment`: date, reason, contract type, effective from *Change Date* or *Next Period*) whose replacement lines point at the lines they replace (`amendsLineId`). A billed line is never edited. |
| **Adjustment** | An invoice-schedule line correcting an already-billed recurring period when its line's end moved (amendment, cancellation), computed from the amount actually billed. |
| **Contract type** | New Sales, Existing, Expansion, Reactivation, Contraction — on the contract and on each amendment; suggested automatically, editable. |
| **Billed through / Recognize revenue from** | Migration dates: periods ending on or before *Billed through* were invoiced elsewhere (never drafted); revenue before *Recognize revenue from* belongs to the old books, after it Carbon releases the migrated Deferred Revenue balance. |

### Lifecycle

`customerContractStatus`: **Draft → Active → Ended**.

- **Draft** — everything editable, including the invoice schedule. The invoice and revenue previews and the summary are live. Delete allowed.
- **Confirm** (`update: sales`; `create: invoicing` too when the effective automation mode posts) — validates (≥ 1 line, Service items only, dates consistent, invoice schedule conserves every line's total, Stripe customer linked when the mode is *Post and Send via Stripe* — the existing link step done once here), stamps `confirmedAt`, freezes the schedules, suggests the contract type (New Sales for a customer's first contract; Reactivation when all its earlier contracts ended). From now on changes go through amendments, cancellation and renewal.
- **Active** — the daily job drafts due invoices and the recognition run recognizes revenue. A cancelled contract stays Active until its end date passes and its last invoice is drafted; the header shows "Ends {date}".
- **Ended** — set by the daily job once the end date has passed and nothing is left to draft. `cancelledAt` / `cancellationReason` distinguish a cancellation from a term end. Read-only.

Delete is Draft-only. A confirmed contract with nothing invoiced or recognized can be cancelled back to nothing (end date before its start), which removes its planned invoices and revenue rows.

### The invoice schedule

Pure math in `packages/database/supabase/functions/shared/contract-schedule.ts` (re-exported by `@carbon/utils`, unit-tested):

1. **Grid.** Frequency + alignment define period boundaries. Anniversary anchors on the contract start (a 29th–31st anchor clamps to the month's last day and returns to the anchor day when it exists — `@internationalized/date` `.add({ months })`); Calendar anchors on the 1st of the week / month / quarter / year containing it.
2. **Recurring lines** get one invoice-schedule line per grid period intersecting `[start, end]`, `units` = the period in the line's rate unit **prorated by day** (Day: days; Week: days ÷ 7; Month / Quarter / Year: whole calendar months ÷ 1 / 3 / 12 plus each partial month's days ÷ its days ÷ 1 / 3 / 12), `amount = round(quantity × rate × units × (1 − discount))` at internal scale. Due on the period's first (Advance) or last (Arrears) day.
3. **One-time lines** put their whole net amount on the first planned invoice on or after their start date.
4. **First invoice date** defaults to the first period's due date and can be set (e.g. invoice on signature before the service starts); periods due before it are gathered onto it.
5. **Editing (Draft only).** The user can move an invoice's date, split an invoice line into installments, merge invoices, and move a one-time line to a later invoice. Every edit must keep each contract line's billed total equal to its computed total (Rillet "redistribution only"); the preview shows the residual until it balances. Billing-period dates on lines stay the service window they cover, wherever the invoice lands.
6. **Horizon.** Fixed-term contracts are planned to their end date; open-ended contracts through the current period plus the next, rolled forward daily. Only planned rows can be edited, so an open-ended contract's edits reach as far as the horizon.
7. **Reconcile, never rewrite** (shared with rentals — the create / re-cut / adjust reconciliation extracted from `rental-billing.ts`, rental behaviour pinned by `rental-billing.test.ts`): a planned period whose line's end moved is re-cut; an already-invoiced recurring period that now extends past its line's end gets ONE adjustment = − (billed amount × days after the new end ÷ days billed); never a second one for the same period. An amendment regenerates the unbilled schedule from its effective date and warns that manual edits after that date are reset.
8. **Billed through.** Planned periods ending on or before it are created *Billed Externally* (no invoice). It must fall on a period end.

### The revenue schedule

Per line, at confirmation (and on every amendment / cancellation / renewal), `customerContractRevenue` rows — one per calendar month — from the line's revenue pattern over `[revenueStart, revenueEnd]`:

- **Recurring lines** default revenue dates = the line's dates; the monthly amount follows the pattern over the same net value the invoice schedule bills for that span.
- **One-time lines** default revenue dates = the line's start and end (a one-time line with no end = recognized in the month of its start — point in time).
- **Go-live** (optional) moves the revenue start; the line's billing dates are unchanged.
- *Daily*: amount ∝ days in the month. *Even per month*: equal per full calendar month, first/last partial months prorated by days. Totals reconcile exactly (`distributeRoundingResidual`).
- Months before *Recognize revenue from* are not created (migration).

### Accounting — revenue follows the line

Gated on `companySettings.accountingEnabled` (off → invoices post straight to revenue, as today). Generalizes the rental model (`post-sales-invoice/rental-posting.ts` `planRentalLine`, `synthesizeRentalAccruals`) from rental lines to contract lines, per contract line:

- **Invoice posting.** A sales-invoice line with `customerContractLineId` takes the contract branch (before the Service deferral branch): Cr **Contract Assets** up to the line's accrued-unbilled balance, the rest Cr **Deferred Revenue**; Dr AR. A negative adjustment line reverses in the opposite order (Dr Deferred Revenue up to the line's deferred balance, rest Dr Contract Assets).
- **Recognition run.** For each contract line and month ≤ the run's period, recognized revenue = the `customerContractRevenue` row: Dr Deferred Revenue up to the line's deferred balance, the rest Dr **Contract Assets** (earned, not yet billed); Cr the line's revenue account (the item's sales account). Rows post once (`journalId` / `postedAt` stamps), Planned → Posted, the existing revenue-recognition-run Draft → Posted lifecycle and close task.
- **Migration.** For months from *Recognize revenue from*, a line whose periods are *Billed Externally* draws its Dr from the migrated Deferred Revenue opening balance (the line's deferred balance is seeded with its externally-billed-but-unrecognized amount at confirmation, computed from the revenue schedule; the opening journal must have put that balance in Deferred Revenue).
- **Cancellation credit** (credit memo, below) posts Dr Deferred Revenue up to the line's deferred balance, the rest Dr Contract Assets / revenue for months already recognized beyond the end date (catch-up in the next run), and the line's future revenue rows after the end date are removed.
- **Contract position** per line and month = invoiced (posted invoice lines), recognized (posted revenue rows), deferred = invoiced − recognized (Deferred Revenue when positive, Contract Assets when negative) — the summary on the contract and the input of a later ARR / waterfall report.

Foreign currency: invoices post in the contract currency with base translation as today; revenue rows are computed in contract currency and posted in base at the posting rate of the invoice that funded them (deferred) or the run date's rate (accrued) — the same translation rule the rental model uses; FX remeasurement of the contract balance is out of v1.

### Invoicing — the shared recurring-invoicing layer

Contracts are the second **source** of the layer defined in `2026-10-02-rental-invoice-automation.md`:

- **Drafting.** `createContractInvoicesForDuePlannedInvoices(db, { companyId, asOf, customerContractId?, userId })` (`@carbon/database/contract-billing`), one transaction per contract: renewals (below), roll the horizon, then for each planned invoice due on or before `asOf` draft one Draft `salesInvoice` (customer, bill-to, invoice contact, payment term, currency, `customerReference` = the contract's PO number, `customerContractId`) with one line per planned invoice line: `invoiceLineType 'Service'`, the line's item, customer-facing description + the service window, quantity, `unitPrice` and `discountPercent` from the contract line, `taxPercent`, `serviceStartDate` / `serviceEndDate` = the billing period, `customerContractId`, `customerContractLineId`, `customerContractInvoiceLineId`. Stamps the planned rows *Invoiced* + `salesInvoiceLineId` (idempotent re-run).
- **Daily job.** The shared `recurring-billing` cron (renamed from `rental-billing` by the rental automation plan) runs, per company in an isolated step, every source's drafting — rental agreements, then contracts — and then `automateSalesInvoice` over every drafted invoice, sending one "Recurring invoicing" digest per owner (`salesPersonId ?? createdBy`) across both sources.
- **Mode.** `customerContract.invoiceAutomation` (nullable) overrides `companySettings.invoiceAutomation` (default *Post and Email*). This spec adds the mode **`Post and Send via Stripe`** to the shared `invoiceAutomation` enum and its branch to `automateSalesInvoice` (post, then the existing Stripe Connect send — Carbon stays the billing engine; never a Stripe Subscription). Rental agreements gain it too.
- **Contract holds** (the source declares them, as rentals declare charges and early-return credits): an invoice carrying a negative adjustment line; an invoice re-billing rows a VOID released (`voidedSalesInvoiceId` stamp on `customerContractInvoiceLine`, the rental D26 rule); and the shared holds (sales-rule violation, missing required contact, posting failure).
- **Recipients and sender** (shared rule): To the invoice contact, CC the customer's default CC (else the company default CC); From `"<Company name>" <DEFAULT_FROM>`; Reply-To `companySettings.accountsReceivableEmail`, else the contract owner (`salesPersonId ?? createdBy`).
- **VOID** of a contract invoice returns its planned rows to Pending and stamps `voidedSalesInvoiceId` (held on re-draft); **deleting** a Draft contract invoice un-stamps them (`releaseRecurringInvoiceStamps`, generalizing `releaseRentalInvoiceStamps`).
- **Invoice Now** on an Active contract runs drafting + automation for that contract now (`update: sales` + `create: invoicing`).

### Amendments

**Amend** on an Active contract (`update: sales`) creates a `customerContractAmendment` (date, reason, contract type, effective from) with replacement lines — change quantity, rate, rate unit, discount, tax, description, revenue pattern / dates; add a line; end a line:

- *From the change date* (default): the old line ends the day before the effective date, the new line starts on it; recurring periods are prorated by day and already-billed advance periods adjusted from the billed amount; revenue rows of the old line after the effective date are removed and the new line's are added (prospective).
- *From the next billing period*: the effective date snaps to the first day of the next unstarted period; nothing is prorated.
- **Contract type** is suggested from the change in recurring value per period: up → Expansion, down → Contraction; editable.
- A **preview** shows the adjustment, the next invoices and the revenue change before saving.

A **time-limited discount** (20 % off the first year) is entered as the line's discount plus a scheduled amendment removing it at the date (created at confirmation from an optional "discount ends" date on the line).

### Cancellation

**Cancel** (`update: sales`): end date (default the end of the current billing period, so nothing is credited), reason, and — only when the date falls inside a period already billed in advance — *Credit unused time*. Ends every open line, removes planned invoices and revenue rows after the date, and, when crediting, drafts one Draft customer **credit memo** (`memo.customerContractId`, amount = Σ the cancellation's adjustment rows, stamped `memoId`) posted through the contract branch of `post-memo` (above). Revertible until the end date passes and only while no credit memo has posted.

### Renewal

A contract with a **term** (months; presets 6 months / 1, 2, 3 years / custom; or open-ended) and renewal *Renew* is extended by the daily job on its end date: end date + one term, an amendment of type **Existing** effective the new term's first day raising every open recurring line's rate by the uplift % (*From the next billing period*), new planned invoices and revenue rows. Renewal *End* lets it end.

### Sales order → contract

**Create Contract** on a sales order (`create: sales`) offers its Service lines; the ticked ones become contract lines (One-time, or Recurring with a rate unit), with customer, payment term, currency and PO reference copied and `customerContract.salesOrderId` set. Those order lines are billed by the contract: the `convert` sales order → invoice skips order lines referenced by a contract line, and the order's invoiced rollup counts them as invoiced.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | The document | A generalized AR **Contract** (`customerContract*`), replacing the Subscription draft | G2; Rillet Contract; contract = billing + revenue on the same lines |
| 2 | Rentals | Stay a separate document; share the recurring-invoicing layer; read-only upcoming-invoices preview; no schedule editing | G2, G4b — custody events re-cut the schedule, sales-type units must bill their valued schedule, rent automation needs determinism |
| 3 | AP side | Nothing; prepaid expenses and repeating supplier bills are a documented gap | G1; Rillet has none |
| 4 | Line kinds | One-time + Recurring, Service items only; goods on sales orders; usage later | G3, Q1 |
| 5 | Rate unit vs frequency | Separate (Day…Year vs Week…Year) | Q2, Q2b |
| 6 | Alignment / timing | Anniversary (default) or Calendar; Advance or Arrears; first invoice date | Q3, G4, Rillet invoicing |
| 7 | Proration | By day, exact | NetSuite / BC / Stripe convention |
| 8 | Invoice schedule | Persisted, computed, editable while Draft with per-line totals conserved | G4; Rillet invoice breakdown |
| 9 | Revenue | Per-line pattern Daily / Even per month over revenue dates (go-live); read-only schedule; invoiced / recognized / deferred summary | G5; Rillet revenue step |
| 10 | Revenue engine | Revenue follows the line: recognition run releases Deferred Revenue or accrues Contract Assets; invoice posting relieves accruals first — rental model generalized | G5 settled-by-model; ASC 606 contract asset / liability |
| 11 | SSP allocation | None — each line's revenue is its own net price | Rev-rec spec Phase 2–3 allocation stays later |
| 12 | Discounts | Discount % per line; time-limited via a scheduled amendment | G8 |
| 13 | Changes | Amendment header + replacement lines; Change Date (prorated, default) or Next Period | Q6, Q11, G6; Rillet amendments |
| 14 | Adjustment basis | Amount actually billed × unused days ÷ billed days | Stripe flexible billing |
| 15 | Cancellation | End date (default end of period); optional credit memo | Q7, Q7b |
| 16 | Renewal | Optional term; Renew with uplift % (an *Existing* amendment) or End | Q8, G6 |
| 17 | Contract type | New Sales / Existing / Expansion / Reactivation / Contraction on contract + amendment, suggested, editable; ARR report later | G6 |
| 18 | Migration | *Billed through* + *Recognize revenue from*; Carbon releases the migrated deferred balance | Q10, G9 |
| 19 | Grouping | One invoice per contract per run | Q4 |
| 20 | Automation | Shared layer: company default + per-contract override; adds *Post and Send via Stripe*; contract holds (negative adjustments, VOID re-bills) | U1, U2, Q5 |
| 21 | Recipients / sender | Invoice contact, CC default CC; Reply-To AR email else owner | G7, U3 |
| 22 | Daily job | One `recurring-billing` job across sources, one digest per owner | U4 |
| 23 | Origin | Standalone + Create Contract from chosen sales-order Service lines (removed from the order's invoicing) | Q9, Q9b |
| 24 | Dimensions | Not per line (derived at posting as today) | G7 settled-by-codebase |
| 25 | Module / naming | Inside `sales` (`sales.models.ts` / `.service.ts` / `.server.ts`, `ui/Contracts/`); tables `customerContract*`; UI "Contracts" | Heuristic 6; rental precedent; room for a supplier contract later |
| 26 | Multi-tenancy (H1) | `companyId` + `PRIMARY KEY ("id","companyId")` + `id('prefix')` on every table | conventions-database |
| 27 | Service shape (H2) | `client` first, `{data, error}`, MCP-safe guards (Draft-only edits, explicit field picks) | rental writers precedent |
| 28 | RLS (H3) | `company("sales", { read: "sales_view" })` per table in `authz/manifest.ts` + `authz migration` | authz-manifest rule |
| 29 | Permissions (H4) | CRUD / amend / cancel `sales_*`; confirm with a posting mode and Invoice Now also `create: invoicing` | rental Generate Invoices precedent |
| 30 | Forms (H5) | `customerContractValidator`, `customerContractLineValidator`, `customerContractInvoiceEditValidator`, `customerContractAmendmentValidator`, `customerContractCancelValidator`, `createContractFromSalesOrderValidator` | conventions-forms |
| 31 | Backward compatibility (H7) | Additive tables/columns/enum values; `post-sales-invoice` / `post-memo` / `convert` gain branches only for contract-linked rows | No FROZEN surface touched |

## Data Model Changes

Migrations: enums first (ADD VALUE rule), then tables; `pnpm db:migrate`, `pnpm --filter @carbon/database authz migration contracts-rls`, `pnpm run generate:types`.

```sql
CREATE TYPE "customerContractStatus"        AS ENUM ('Draft', 'Active', 'Ended');
CREATE TYPE "customerContractType"          AS ENUM ('New Sales', 'Existing', 'Expansion', 'Reactivation', 'Contraction');
CREATE TYPE "customerContractLineKind"      AS ENUM ('One-time', 'Recurring');
CREATE TYPE "contractRateUnit"              AS ENUM ('Day', 'Week', 'Month', 'Quarter', 'Year');
CREATE TYPE "contractBillingFrequency"      AS ENUM ('Week', 'Month', 'Quarter', 'Year');
CREATE TYPE "contractBillingAlignment"      AS ENUM ('Anniversary', 'Calendar');
CREATE TYPE "contractBillingTiming"         AS ENUM ('Advance', 'Arrears');
CREATE TYPE "contractRenewal"               AS ENUM ('Renew', 'End');
CREATE TYPE "contractRevenuePattern"        AS ENUM ('Daily', 'Even Period');
CREATE TYPE "contractAmendmentEffect"       AS ENUM ('Change Date', 'Next Period');
CREATE TYPE "contractInvoiceStatus"         AS ENUM ('Planned', 'Invoiced', 'Billed Externally');
ALTER TYPE "invoiceAutomation" ADD VALUE IF NOT EXISTS 'Post and Send via Stripe';  -- enum from the rental automation plan

CREATE TABLE "customerContract" (
  "id" TEXT NOT NULL DEFAULT id('con'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,                 -- readable, sequence 'customerContract' prefix CON
  "name" TEXT NOT NULL,
  "status" "customerContractStatus" NOT NULL DEFAULT 'Draft',
  "contractType" "customerContractType" NOT NULL DEFAULT 'New Sales',
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "invoiceCustomerId" TEXT REFERENCES "customer"("id"),
  "invoiceCustomerContactId" TEXT REFERENCES "customerContact"("id"),
  "invoiceCustomerLocationId" TEXT REFERENCES "customerLocation"("id"),
  "salesPersonId" TEXT REFERENCES "user"("id"),
  "salesOrderId" TEXT,                                   -- origin
  "customerReference" TEXT,                              -- PO number → every invoice
  "closeDate" DATE NOT NULL,                             -- booking date
  "startDate" DATE NOT NULL,
  "endDate" DATE,                                        -- NULL = open-ended
  "termMonths" INTEGER CHECK ("termMonths" > 0),
  "renewal" "contractRenewal" NOT NULL DEFAULT 'End',
  "renewalUplift" NUMERIC NOT NULL DEFAULT 0 CHECK ("renewalUplift" >= 0),   -- fraction
  "billingFrequency" "contractBillingFrequency" NOT NULL DEFAULT 'Month',
  "billingAlignment" "contractBillingAlignment" NOT NULL DEFAULT 'Anniversary',
  "billingTiming" "contractBillingTiming" NOT NULL DEFAULT 'Advance',
  "firstInvoiceDate" DATE,
  "billedThrough" DATE,
  "recognizeRevenueFrom" DATE,
  "invoiceAutomation" "invoiceAutomation",               -- NULL = companySettings.invoiceAutomation
  "paymentTermId" TEXT REFERENCES "paymentTerm"("id"),
  "currencyCode" TEXT NOT NULL,
  "notes" JSONB,
  "confirmedAt" TIMESTAMP WITH TIME ZONE, "confirmedBy" TEXT REFERENCES "user"("id"),
  "cancelledAt" TIMESTAMP WITH TIME ZONE, "cancellationReason" TEXT,
  "endedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerContract_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerContract_readable_key" UNIQUE ("customerContractId", "companyId"),
  CONSTRAINT "customerContract_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate" - 1)
);

CREATE TABLE "customerContractAmendment" (
  "id" TEXT NOT NULL DEFAULT id('cona'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "amendmentDate" DATE NOT NULL,                         -- effective date after snapping
  "effect" "contractAmendmentEffect" NOT NULL DEFAULT 'Change Date',
  "contractType" "customerContractType" NOT NULL,
  "reason" TEXT NOT NULL,                                -- 'Renewal' for a renewal, 'Cancellation' for a cancel
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"), "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractAmendment_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractAmendment_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE
);

CREATE TABLE "customerContractLine" (
  "id" TEXT NOT NULL DEFAULT id('conl'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "kind" "customerContractLineKind" NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),         -- a Service item (service-layer check)
  "description" TEXT,                                     -- customer-facing
  "quantity" NUMERIC NOT NULL DEFAULT 1 CHECK ("quantity" > 0),
  "rate" NUMERIC NOT NULL CHECK ("rate" >= 0),            -- price; per rate unit when Recurring
  "rateUnit" "contractRateUnit",                          -- Recurring only
  "discountPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("discountPercent" >= 0 AND "discountPercent" <= 1),
  "discountEndsOn" DATE,                                  -- schedules the removing amendment at confirm
  "taxPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1),
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "goLiveDate" DATE,
  "revenuePattern" "contractRevenuePattern" NOT NULL DEFAULT 'Daily',
  "revenueStartDate" DATE,                                -- default goLiveDate ?? startDate
  "revenueEndDate" DATE,                                  -- default endDate (one-time, no end = point in time)
  "amendmentId" TEXT,                                     -- the amendment that created it
  "amendsLineId" TEXT,                                    -- the line it replaces
  "salesOrderLineId" TEXT,
  "sortOrder" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"), "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "customerContractLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractLine_contract_fkey" FOREIGN KEY ("customerContractId", "companyId")
    REFERENCES "customerContract"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "customerContractLine_rateUnit_check" CHECK (("kind" = 'Recurring') = ("rateUnit" IS NOT NULL)),
  CONSTRAINT "customerContractLine_amends_check" CHECK ("amendsLineId" IS NULL OR "amendmentId" IS NOT NULL)
);
CREATE UNIQUE INDEX "customerContractLine_salesOrderLine_key"
  ON "customerContractLine" ("salesOrderLineId", "companyId") WHERE "salesOrderLineId" IS NOT NULL;

CREATE TABLE "customerContractInvoice" (                   -- a planned invoice (the editable breakdown)
  "id" TEXT NOT NULL DEFAULT id('coni'),
  "companyId" TEXT NOT NULL,
  "customerContractId" TEXT NOT NULL,
  "invoiceDate" DATE NOT NULL,
  "status" "contractInvoiceStatus" NOT NULL DEFAULT 'Planned',
  "salesInvoiceId" TEXT,                                   -- stamp when drafted
  "isEdited" BOOLEAN NOT NULL DEFAULT FALSE,
  /* audit */ "createdBy" TEXT NOT NULL REFERENCES "user"("id"), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"), "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractInvoice_pkey" PRIMARY KEY ("id", "companyId")
);
CREATE INDEX "customerContractInvoice_due_idx" ON "customerContractInvoice" ("companyId", "status", "invoiceDate");

CREATE TABLE "customerContractInvoiceLine" (
  "id" TEXT NOT NULL DEFAULT id('conil'),
  "companyId" TEXT NOT NULL,
  "customerContractInvoiceId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL, "periodEnd" DATE NOT NULL,  -- service window covered
  "units" NUMERIC NOT NULL,
  "amount" NUMERIC NOT NULL,                               -- net of discount; negative for an adjustment
  "isAdjustment" BOOLEAN NOT NULL DEFAULT FALSE,
  "salesInvoiceLineId" TEXT,                               -- stamp (no FK, rental precedent)
  "voidedSalesInvoiceId" TEXT,                             -- re-bill hold (rental D26)
  "memoId" TEXT,                                           -- cancellation credit
  /* audit */ "createdBy" TEXT NOT NULL REFERENCES "user"("id"), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"), "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractInvoiceLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractInvoiceLine_dates_check" CHECK ("periodEnd" >= "periodStart")
);

CREATE TABLE "customerContractRevenue" (                   -- per line per month, read-only
  "id" TEXT NOT NULL DEFAULT id('conr'),
  "companyId" TEXT NOT NULL,
  "customerContractLineId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL, "periodEnd" DATE NOT NULL,  -- a calendar month (or its covered part)
  "amount" NUMERIC NOT NULL,
  "status" "revenueScheduleStatus" NOT NULL DEFAULT 'Planned',   -- existing enum
  "journalId" TEXT, "postedAt" TIMESTAMP WITH TIME ZONE,
  /* audit */ "createdBy" TEXT NOT NULL REFERENCES "user"("id"), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"), "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerContractRevenue_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerContractRevenue_key" UNIQUE ("companyId", "customerContractLineId", "periodStart")
);

-- Provenance on existing tables (ON DELETE SET NULL FKs on (col, companyId) + indexes)
ALTER TABLE "salesInvoice"     ADD COLUMN "customerContractId" TEXT;
ALTER TABLE "salesInvoiceLine" ADD COLUMN "customerContractId" TEXT,
                               ADD COLUMN "customerContractLineId" TEXT,
                               ADD COLUMN "customerContractInvoiceLineId" TEXT;
ALTER TABLE "memo"             ADD COLUMN "customerContractId" TEXT;
-- Sequence 'customerContract' prefix 'CON' size 6 (seed + seed-company); view "customerContracts":
-- c.* + customerName, lineCount, recurringPerPeriod, contractValue, nextInvoiceDate,
-- invoicedToDate, recognizedToDate, deferredBalance.
```

RLS: each new table `company("sales", { read: "sales_view" })`. Backups: tenant tables discovered automatically; `pnpm db:check:backups` regenerates the manifest (no renames). Demo datasets: one Active contract per dataset (a one-time implementation line + two recurring lines) in the sales slice; coverage floors measured.

## API / Service Changes

- **Pure** — `shared/contract-schedule.ts`: `billingGrid`, `periodUnits`, `planInvoiceSchedule(contract, lines)`, `validateScheduleEdit(lines, plannedRows)` (per-line totals conserved), `revenueSchedule(line, pattern)`, `amendmentPlan(...)`, `cancellationPlan(...)`, `renewalPlan(...)`, `contractPosition(...)`; the reconciliation helper extracted from `rental-billing.ts`.
- **Database package** — `@carbon/database/contract-billing`: `createContractInvoicesForDuePlannedInvoices`, `confirmContract`, `applyContractAmendment`, `cancelContract`, `renewDueContracts` (Kysely, one transaction each); `releaseRecurringInvoiceStamps` generalizes `releaseRentalInvoiceStamps`; the revenue-recognition run's synthesizer list gains `synthesizeContractRevenue` (beside `synthesizeRentalAccruals`).
- **Jobs** — the shared `recurring-billing` cron and `automateSalesInvoice` (rental automation plan) gain the contract source and the Stripe branch.
- **Edge functions** — `post-sales-invoice`: contract branch (relieve Contract Assets, defer the rest, negative adjustments in reverse); VOID: release + `voidedSalesInvoiceId` on contract rows. `post-memo`: contract branch. `convert`: skip contract-linked order lines.
- **ERP** (`sales.service.ts`, MCP tools with Draft-only guards): `getContracts`, `getContract`, `insertContract`, `updateContract`, `deleteContract`, `getContractLines`, `upsertContractLine`, `deleteContractLine`, `getContractInvoiceSchedule`, `updateContractInvoiceSchedule` (Draft, conserved totals), `getContractRevenueSchedule`, `getContractPosition`, `previewContract`. Server-only (`sales.server.ts`): confirm, amend, cancel, invoice now, create from sales order.
- **Routes** — `x+/sales+/contracts.tsx`; `x+/contract+/new.tsx`, `$id.tsx` shell, `$id.details.tsx`, `$id.lines.new.tsx`, `$id.$lineId.details.tsx`, `$id.schedule.tsx` (invoice-schedule edits), `$id.confirm.tsx`, `$id.amend.tsx`, `$id.cancel.tsx`, `$id.invoice.tsx`, `$id.delete.tsx`, `update.tsx`; `x+/sales-order+/$orderId.contract.tsx`.

## UI Changes

Built with the `carbon-design` skill, following the rental agreement page (explorer + center + properties) rather than Rillet's wizard; the five Rillet steps become sections of one page:

- **Sales → Contracts** list: ID, name, customer, type, status, recurring per period, contract value, next invoice, invoiced / recognized / deferred, ends on.
- **Contract page** — header (status, *Confirm*, *Invoice Now*, *Amend*, *Cancel*, *Delete* while Draft); explorer of lines (*Add Line*: product picker, multi-select like Rillet's "Add to contract"); center sections:
  - **Summary** — lines as line items ("Implementation · one-time · $60,000", "Platform access · 10 × $40 per month · 20 % off until 31 Oct 2027"), contract value, recurring per period, next invoice.
  - **Invoices** — the invoice schedule (date, total, lines, status, sales-invoice link); while Draft: move date, split, merge, move a line, with the per-line residual shown until it balances.
  - **Revenue** — per line pattern and dates, the monthly schedule, and the **invoiced / recognized / deferred** table per month.
  - **Amendments** — history with date, type, reason and changes.
- **Properties** panel — name, customer, bill-to, contact, sales person, close date, start + **duration** (6 months / 1, 2, 3 years / open-ended / custom) → end date, renewal + uplift, frequency, alignment, timing, first invoice date, billed through, recognize revenue from, invoicing (company default / Draft Only / Post / Post and Email / Post and Send via Stripe), payment term, currency, PO number, contract type, notes, custom fields.
- **Line form** — Service item, kind, description (customer-facing), quantity, rate (+ per rate unit when Recurring), discount % + ends on, tax %, start / end, go-live, revenue pattern + revenue dates.
- **Amend / Cancel modals** with previews (as specified above); **Create Contract** on sales orders; "From contract CON000012" links on invoices, lines and memos.
- **Settings → Invoicing** (rental automation plan) mode list gains *Post and Send via Stripe*.
- **Docs** — `docs/content/docs/reference/contracts.mdx` (`carbon-docs`), agent KB regenerated, glossary: *Contract*, *Contract type*, *Invoice schedule*, *Revenue pattern*, *Billed through*, *Amendment*.

## Acceptance Criteria

Worked example (Acme, accounting enabled):

- [ ] A Draft contract with implementation $60,000 one-time (revenue 1 Nov 2026–30 Apr 2027, Even Period), platform 10 × $40 per Month at 20 % off, support $1,200 per Year, Monthly / Calendar / Advance, first invoice 1 Nov, previews invoice 1 Nov = $60,420.00 (60,000 + 320 + 100) and $420.00 each month after; revenue preview for implementation = $10,000 per month Nov–Apr; summary for November: invoiced $60,420.00, recognized $10,420.00, deferred $50,000.00.
- [ ] Editing the schedule to split implementation into 3 × $20,000 on 1 Nov / 1 Dec / 1 Jan is accepted; moving $10,000 of it off the schedule is refused with the residual shown.
- [ ] After confirming, the daily job on 1 Nov drafts one invoice with three Service lines (service windows 1–30 Nov for the recurring lines, 1 Nov–30 Apr for implementation), and re-running drafts nothing; with the company default *Post and Email* it posts and emails the invoice contact (CC default CC, Reply-To the receivables email).
- [ ] Posting that invoice credits Deferred Revenue $60,420.00 (no Contract Assets yet); the November recognition run recognizes $10,420.00 (Dr Deferred Revenue / Cr each item's sales account).
- [ ] With the implementation billed later instead — 2 × $30,000 on 1 Jan and 1 Apr — the November and December runs each accrue $10,000 of implementation revenue to Contract Assets (earned, not billed); posting the 1 Jan invoice relieves the $20,000 accrual and defers $10,000, which the January run releases; no Deferred Revenue debit balance or Contract Assets credit balance ever appears.
- [ ] A line at $10 per Day invoices $310.00 for a 31-day month and $280.00 for February 2027.
- [ ] Anniversary alignment, start 15 March, monthly: invoices on the 15th, no proration; a 31 January anchor bills 28 February then 31 March.
- [ ] Amend on 12 March (platform 10 → 15 seats, *From the change date*, March billed $320 net): the next invoice carries −$206.45 (320 × 20/31) and +$309.68 (15 × 40 × 0.8 × 20/31) and the amendment is suggested as *Expansion*; *From the next billing period* produces no March lines.
- [ ] With 10 seats, the discount ends on 31 Oct 2027 (scheduled amendment) and the term renews the same day with a 5 % uplift: November 2027 bills platform at 10 × $40 × 1.05 = $420.00.
- [ ] Renewal on 31 Oct 2027 with uplift 5 %: end date extends 12 months, an *Existing* amendment raises recurring rates by 5 %; with renewal *End* the contract ends.
- [ ] Cancel effective 20 Sep with *Credit unused time* on a September billed at $420: a Draft credit memo for $140.00 (420 × 10/30); posting it debits Deferred Revenue; revenue rows after 20 Sep are removed.
- [ ] VOID of a posted contract invoice returns its planned rows to Pending; the next run re-drafts and holds it ("Re-billing INV-…, which was voided").
- [ ] An invoice containing a negative adjustment line is drafted and held for review regardless of the automation mode.
- [ ] *Post and Send via Stripe*: confirmation requires the Stripe customer link; the job posts and sends through Connect; failures leave a held Draft with the reason.
- [ ] Migrated annual contract (start 1 May 2026, Billed through 30 Apr 2027, Recognize revenue from 1 Oct 2026, one line $12,000 per Year invoiced Yearly in advance, revenue pattern Even Period): no invoice before 1 May 2027; the October run recognizes $1,000 from Deferred Revenue (the migrated opening balance); first Carbon invoice 1 May 2027.
- [ ] Contract type suggestions: a customer's first contract → New Sales; a customer whose earlier contracts all ended → Reactivation; a seat reduction amendment → Contraction.
- [ ] *Create Contract* from a sales order ticking only the platform line: invoicing the order bills only the remaining lines; the order completes when they are invoiced.
- [ ] A EUR contract posts with base translation; recognition rows post in base.
- [ ] One company whose contract billing throws does not stop the `recurring-billing` run for other companies; rental billing behaviour and tests are unchanged after the shared extraction.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Line-level revenue engine (accrue / defer per line) is new posting territory beyond rentals | High | Generalize the rental model already built and tested (`planRentalLine`, `synthesizeRentalAccruals`); per-line balance invariants in unit tests; journal balance assertions; worked-example tests above |
| Editable schedules break the conservation invariant | Med | Pure `validateScheduleEdit` on every save and at confirmation; DB-side check at confirm (Σ per line = computed total) |
| Amendments reset hand-edited future invoices | Low | Warn in the amendment preview; edits before the effective date are kept |
| Unattended posting / sending a wrong invoice | High | Shared-layer holds (negative adjustments, VOID re-bills, rule violations, posting failures); company default can be set to Draft Only; per-contract override |
| Migration revenue depends on the opening balance being in Deferred Revenue | Med | Confirmation shows the migrated deferred amount per line; a period-close check compares it with the Deferred Revenue balance |
| Two sources in one cron grow its runtime | Low | Per-company isolated steps (`.ai/lessons.md` tenant isolation); each source in its own step within the company |
| Scope overlap with the rev-rec spec Phases 2–3 | Med | This spec delivers the arrangement from the billing side without SSP; a scope note on `2026-07-04-revenue-recognition.md` points here |

## Delivery phases

Two plans, in order, each shippable (decided 2026-10-02; the rental invoice automation plan, which builds the shared layer, executes first):

- **Phase A — contracts, invoice schedule, invoicing.** Everything except the line-level revenue engine: tables, contract page, lines, editable invoice schedule, amendments, cancellation + credit memo, renewal, contract types, discounts, migration *Billed through*, Create Contract from sales orders, the contract source in `recurring-billing`, contract holds, and the *Post and Send via Stripe* mode. Interim revenue: contract invoice lines post through the existing **Service-line deferral** — each line's service dates are its billing period, and a one-time line's service dates are its revenue dates — so revenue is right whenever billing is at or ahead of delivery (the common case). The revenue section shows the preview and summary computed from the schedule; *Recognize revenue from* and Even Period are accepted but only take effect in Phase B.
- **Phase B — revenue follows the line.** `customerContractRevenue`, the contract branch of `post-sales-invoice` / `post-memo` (relieve Contract Assets, defer the rest), `synthesizeContractRevenue` in the recognition run, Even Period, migrated deferred-balance release, the contract position view. Contract lines switch from the Service deferral branch to the contract branch; invoices already posted in Phase A keep their Service deferral rows (no restatement).

## Out of scope (v1)

Usage-based / metered lines; physical goods on contracts; SSP allocation across lines; hand-edited revenue schedules; ARR / MRR waterfall reports (contract type and position are captured for them); per-customer invoice consolidation; customer rate cards for contracts; trials, pausing and coupons; per-line manual dimensions; FX remeasurement of contract balances; Rillet recurring-revenue sync; anything on the AP side (prepaid expenses, repeating supplier bills); merging rental agreements into contracts.

## Open Questions

> All resolved with Brad on 2026-10-02 before this version was written (`.ai/runs/2026-10-02-grill-subscriptions.md`).

- [x] **Line content** — **Answer:** Service items only (Q1), now One-time + Recurring (G3); usage later.
- [x] **Frequencies; rate unit vs rhythm** — **Answer:** rates per Day / Week / Month / Quarter / Year; invoiced every Week / Month / Quarter / Year (Q2, Q2b).
- [x] **Alignment** — **Answer:** Anniversary by default, Calendar optional (Q3).
- [x] **Grouping** — **Answer:** one invoice per contract per run (Q4).
- [x] **Automation** — **Answer:** the shared layer: company default + per-contract override, adding *Post and Send via Stripe* (Q5, U1, U2).
- [x] **Mid-term changes; when they take effect** — **Answer:** amendments prorated by day from the change date (default) or from the next period (Q6, Q11).
- [x] **Cancellation; credit form** — **Answer:** chosen end date (default end of period); optional credit memo (Q7, Q7b).
- [x] **Renewal** — **Answer:** optional term; Renew with uplift % or End (Q8).
- [x] **Origin; sales-order lines** — **Answer:** standalone + Create Contract from chosen Service lines, removed from the order's invoicing (Q9, Q9b).
- [x] **Migration** — **Answer:** Billed through (Q10) + Recognize revenue from, Carbon releasing the migrated deferred balance (G9).
- [x] **Reply-to; daily job** — **Answer:** AR email else owner; one `recurring-billing` job (U3, U4).
- [x] **AP side** — **Answer:** nothing for now (G1).
- [x] **Contract vs Subscription; rentals** — **Answer:** a generalized Contract; rentals stay separate (G2).
- [x] **Editable invoice schedule; for rentals?** — **Answer:** editable while Draft with totals conserved (G4); rentals get a read-only preview (G4b).
- [x] **Revenue per line** — **Answer:** Daily or Even per month over revenue dates with go-live; read-only schedule; invoiced / recognized / deferred summary (G5).
- [x] **Contract types** — **Answer:** New Sales / Existing / Expansion / Reactivation / Contraction, suggested and editable; reports later (G6, G6b).
- [x] **Recipients** — **Answer:** invoice contact + default CC (G7, G7b).
- [x] **Discounts** — **Answer:** discount % per line (G8).

## Changelog

- 2026-10-02: Created as "Subscriptions" after research and a 14-question interview.
- 2026-10-02: Re-scoped to **Contracts** after reviewing Rillet's Contract (G1–G9) and unifying with rental invoice automation into one recurring-invoicing layer (U1–U4): independent invoice and revenue schedules, editable invoice schedule, per-line revenue patterns and the line-level revenue engine, one-time lines, contract types, discounts, migration revenue; delivery, sender and the daily job now come from the shared layer.
