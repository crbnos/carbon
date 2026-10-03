# Subscriptions — recurring invoicing for services

> Status: draft
> Author: Brad (with Claude)
> Date: 2026-10-02
> Research: `.ai/research/subscription-recurring-invoicing.md` (SAP, NetSuite, Business Central, D365 F&O, Acumatica, Odoo, Xero, QuickBooks, Stripe, Chargebee, Maxio; Rillet and Stripe API data models)
> Interview record: `.ai/runs/2026-10-02-grill-subscriptions.md`
> Related: `.ai/specs/2026-09-22-revenue-recognition-and-rentals.md` (rental billing machinery, Service-line deferral, revenue recognition run — reused here)

## TLDR

A **subscription** is a new sales document that bills a customer for one or more **Service items** on a recurring rhythm — SaaS platform access, support plans, maintenance retainers. Each **subscription line** has its own quantity, **rate** and **rate unit** (per Day / Week / Month / Quarter / Year), start and end date; the subscription itself is invoiced every **Week / Month / Quarter / Year**, aligned to its start date (**Anniversary**, the default) or to the 1st (**Calendar**, first period prorated), in **Advance** or in **Arrears**. Billing periods are persisted per line (the rental agreement pattern) and a daily job drafts **one sales invoice per subscription** for every period that falls due. Each subscription chooses its **invoice delivery**: *Draft for review* (default), *Post and email*, or *Post and send via Stripe* (payment link). Invoice lines are ordinary **Service** lines carrying the period as their service dates, so the existing deferral and revenue recognition run recognize them by day with no new posting rules. Changes are **amendment lines** that replace a line from a date — prorated *from the change date* (default) or *from the next billing period*; a period already billed in advance is adjusted on the next invoice by a prorated line computed from what was actually billed. **Cancel** picks an end date (default the end of the current period) and can credit unused prepaid time as a **customer credit memo**. Fixed **terms** renew automatically with an optional **uplift %**. A **Billed through** date onboards contracts already invoiced in another system. Subscriptions are created standalone or from chosen Service lines of a sales order.

## Problem Statement

A customer moving all of its customer invoicing to Carbon needs three kinds of invoice: one-off (covered by sales invoices), rentals (covered by rental agreements), and **recurring service / SaaS** — which Carbon cannot do today:

- There is no recurring-invoice, subscription or "copy invoice" feature in the sales or invoicing domain (verified: nothing named subscription/recurring in `apps/erp/app/modules/{sales,invoicing}`; `@carbon/stripe`'s subscription code is Carbon's own plan billing and is unrelated).
- Rental agreements bill on a recurring cycle but require a **serialized fleet unit** (a fixed asset) per line, so they cannot carry platform access or a support contract.
- So every monthly SaaS invoice is created by hand, and every annual contract's renewal, mid-year seat increase and cancellation is tracked outside Carbon.
- Delivery is manual too: a person posts each invoice and chooses Email or Stripe at that moment (`$invoiceId.post.tsx`, `notification: Email | Stripe | None`). Nothing posts or sends unattended.

Concrete example the feature must handle: *Acme* buys platform access (10 seats × $40 / month) and premium support ($1,200 / year), invoiced monthly in advance, 12-month term renewing at +5 %. On 12 March they add 5 seats; in September they cancel effective 30 September and ask for unused time to be credited.

## Proposed Solution

### Concepts

| Term | Meaning |
|---|---|
| **Subscription** | The contract header: customer, invoicing terms, rhythm, term and renewal, delivery. Readable id `SUB000001`. |
| **Subscription line** | One Service item billed at a quantity × **rate** per **rate unit**, from a start date to an optional end date. |
| **Rate unit** | What the rate is quoted per: Day, Week, Month, Quarter, Year (BC "billing base period", Rillet price `interval_months`). |
| **Billing frequency** | How often the subscription is invoiced: Week, Month, Quarter, Year (BC "billing rhythm", Rillet `invoicing.interval`). Independent of the rate unit: $10 per Day invoiced every Month = one invoice per month for the days in it. |
| **Billing alignment** | *Anniversary*: periods run from the start date (15 Mar–14 Apr, …). *Calendar*: periods run from the 1st of the week (Monday) / month / quarter (Jan, Apr, Jul, Oct) / year, the first one prorated. |
| **Billing timing** | *Advance*: a period falls due on its first day. *Arrears*: on its last day. |
| **Billing period** | A persisted row per line and period with its dates, units, amount, due date and status (Pending / Invoiced / Billed Externally) — the rental `rentalBillingPeriod` pattern (NetSuite "charges", SAP billing plan dates). |
| **Amendment** | A new subscription line that replaces an existing one from an effective date (`amendsLineId`, Rillet `amending`). The replaced line ends the day before; a billed line is never edited. |
| **Adjustment** | A negative or positive billing period that corrects a period already billed in advance when its line's end date moved (amendment, cancellation). Computed from the amount actually billed (Stripe flexible billing). |
| **Term** | Optional length in months; at term end the subscription *Renews* (same length, rates × (1 + uplift)) or *Ends*. No term = open-ended. |
| **Billed through** | For a migrated contract: the last day already invoiced in another system. Periods ending on or before it are *Billed Externally* — never invoiced, never recognized by Carbon. |
| **Invoice delivery** | What the daily job does with each drafted invoice: *Draft* (leave for review), *Email* (post, email the invoice contact), *Stripe* (post, send through Stripe Connect with a payment link). |

### Lifecycle

`subscriptionStatus`: **Draft → Active → Ended**.

- **Draft** — everything editable; the upcoming-invoice preview is live; no periods persisted. Delete allowed.
- **Activate** (`update: sales`; plus `create: invoicing` when delivery is Email or Stripe) — validates (≥ 1 line, every line a Service item, every line rate ≥ 0, invoice contact with an email for Email/Stripe, a linked Stripe customer for Stripe — the existing `preflightStripeSend` link step, done once here), stamps `activatedAt`, cuts billing periods through the billing horizon (the first `Billed Externally` ones included). Lines, terms and delivery are then changed only through amendments and the actions below.
- **Active** — the daily job drafts (and, per delivery, posts and sends) invoices; amendments, cancellation and renewal apply. A cancelled subscription stays **Active** until its end date has passed and every period through it is invoiced; the header shows "Ends {date}" (Stripe `cancel_at_period_end`, Chargebee `non_renewing`).
- **Ended** — set by the daily job once the end date has passed and nothing is left to bill. `cancelledAt` / `cancellationReason` distinguish a cancellation from a natural term end. Read-only.

Delete is Draft-only. An Active subscription with no invoiced period can be **cancelled with an end date before its start** (`Cancel`), which removes its Pending periods — the rental "Cancel" precedent.

### Billing periods

Pure math in a new `packages/database/supabase/functions/shared/subscription-billing.ts` (re-exported by `@carbon/utils`, unit-tested):

1. **The grid.** The subscription's frequency, alignment and anchor define period boundaries: Anniversary anchors on `startDate` (a 29th–31st anchor clamps to the month's last day and returns to the anchor day when it exists — Stripe's rule, `@internationalized/date` `.add({ months })` clamp); Calendar anchors on the 1st of the week (Monday) / month / quarter / year containing the start date.
2. **Per line.** Each line's periods are the grid periods intersected with `[line.startDate, line.endDate ?? ∞]` — so a line added on 12 March gets a 12–31 March stub inside the March period, and co-termed lines stay aligned.
3. **Units and amount.** `units` = the period's length in the line's rate unit, prorated **by day** (no rounding up — the subscription convention; rentals' whole-unit rounding does not apply):
   - Day: days. Week: days ÷ 7.
   - Month / Quarter / Year: whole calendar months covered ÷ (1 / 3 / 12), plus each partial month's days ÷ that month's days ÷ (1 / 3 / 12).
   - `amount = round(quantity × rate × units)` at internal scale (`round`, `.claude/rules/numeric-precision.md`).
   - Examples: $40 / Month, a full month → 1 × 40; 12–31 March → 20/31 × 40 = 25.80645. $1,200 / Year invoiced monthly → 1/12 × 1,200 = 100 a month. $10 / Day, a 31-day month → 310.
4. **Due date.** Advance: `periodStart`. Arrears: `periodEnd`.
5. **Horizon and roll.** Periods are cut through the current period plus the next one (`billingHorizon`), extended by the daily job; a fixed term is cut only up to its end date.
6. **Reconcile, never rewrite.** Regeneration matches existing rows by `(line, periodStart, isAdjustment)` exactly as `generateRentalBillingPeriods` does: a missing period is created; a **Pending** period whose end moved is re-cut; an **Invoiced** period that now extends past its line's end date gets **one Adjustment row** = − (billed amount × days after the new end ÷ days billed). A later amendment of the same line cannot produce a second adjustment for the same period (the rental "never repeated" rule). The generic create / re-cut / adjust reconciliation is extracted from `rental-billing.ts` into a shared helper both engines call; rental behaviour stays pinned by `rental-billing.test.ts`.
7. **Billed through.** Periods with `periodEnd ≤ billedThrough` are created `Billed Externally` (no invoice, no revenue schedule). `billedThrough` must fall on a grid period end (validator).

### Invoicing (the daily job)

New Inngest function **`subscription-billing`** (`packages/jobs/src/inngest/functions/scheduled/subscription-billing.ts`), cron `0 5 * * *` UTC, one `step.run` per company with a try/catch that records the failure and continues (`.ai/lessons.md` "A cron that walks every tenant must isolate each tenant"), `asOf` = the company's today (`getCompanyTimeZone` + `datetime.today`). Per company, the testable core `createSubscriptionInvoicesForDuePeriods(db, { companyId, asOf, subscriptionId?, userId })` (`@carbon/database/subscription-billing`, the `createRentalInvoicesForDuePeriods` pattern) runs, one transaction per subscription:

1. **Renewal.** A subscription whose term ends before or on `asOf` with renewal *Renew* gets its end date extended by one term and, when `renewalUplift > 0`, an amendment per open line effective the new term's first day at `rate × (1 + uplift)` (*From the next billing period* — no proration). With renewal *End* nothing changes; the subscription ends at its end date.
2. **Roll** periods to the horizon (renewal included).
3. **Draft** one Draft `salesInvoice` for every subscription with Pending periods due on or before `asOf` (adjustments included), from the subscription: customer, invoice customer / contact / location, payment term, currency (exchange rate resolved at draft time with `getExchangeRate`), `customerReference` (the subscription's PO reference, Rillet `purchase_order_number`), `subscriptionId`. One invoice line per period:
   - `invoiceLineType 'Service'`, `itemId` = the line's Service item, `description` = the line's description + "1–31 Mar 2027", `quantity` = line quantity, `unitPrice` = `amount ÷ quantity`, `taxPercent` = the line's, `serviceStartDate` / `serviceEndDate` = the period (an adjustment: the credited span), `subscriptionId`, `subscriptionLineId`, `subscriptionBillingPeriodId`.
   - Stamps the periods `Invoiced` + `salesInvoiceLineId` in the same transaction (idempotent re-run — the rental stamp pattern).
4. **Deliver.** Per the subscription's `invoiceDelivery`: *Draft* stops here. *Email* / *Stripe* call the shared **post-and-deliver pipeline** (below) with `notification` Email / Stripe, contact = the subscription's invoice contact, reply-to = the subscription's sales person, else the user who activated it. A failure to post or send leaves the invoice Draft (the route's existing rollback), records it on the subscription (`lastBillingError`), and notifies the sales person; the next run does not re-draft (the periods are stamped) — a person posts it.
5. **End.** A subscription past its end date with no Pending period → `Ended`.

"**Generate invoices**" on an Active subscription runs steps 2–4 for that subscription now (`update: sales` + `create: invoicing`, the rental `$id.invoice.tsx` precedent).

**The post-and-deliver pipeline moves out of the ERP route.** Today posting + PDF + email + Stripe live in `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.post.tsx`. They move to `packages/jobs/src/invoicing/post-and-deliver.ts` (exported as `@carbon/jobs/invoicing`; the ERP already depends on `@carbon/jobs`, which already depends on `@carbon/documents` and `@carbon/stripe`), and the route calls it — so the human path and the unattended path are one implementation. The sales-rule gate, the Pending → post → rollback sequence, `raiseMoment("invoicing.salesInvoicePosted")`, PDF storage and the Email / Stripe branches move unchanged. The unattended caller passes the subscription's sales person (else activator) as the acting user for `postedBy` and reply-to.

### Posting and revenue

No new posting rules for regular periods: a Service line with service dates already credits **Deferred Revenue** and writes per-month `Deferral` rows (`post-sales-invoice` `deferredServicePeriod`, `spreadStraightLine`, posted by the revenue recognition run) whenever `companySettings.accountingEnabled` is on, and posts straight to revenue when it is off. Deferral is already in base currency, so subscriptions are not restricted to the base currency the way rental agreements are.

Adjustments and credits:

- A **negative adjustment line** (mid-term reduction, Q6) posts as a negative Service line over the credited span: Dr Deferred Revenue / Cr AR, with negative `Deferral` rows over the same days, so each month nets to what was earned. A credited span in a month already recognized lands as a catch-up in the next run. `post-sales-invoice` is verified (and extended if needed) to accept a negative Service line with service dates — today only the rental posting path is pinned for negative amounts.
- A **positive adjustment** (mid-term increase on an advance-billed period) is just a Service line over the remaining days.
- A **cancellation credit** is a Draft customer **credit memo** (`memo`, `direction` AR) with new `memo.subscriptionId`, amount = Σ the cancellation's adjustment rows, which are stamped with `memoId` instead of `salesInvoiceLineId`. `post-memo` gets a subscription branch beside its return-order branch: reason account = `deferredRevenueAccount` (accounting on), and it writes the negative `Deferral` rows for each stamped adjustment (new `revenueRecognitionSchedule.memoId`). Applied or refunded like any memo.

### Amendments

An **Amend** on an Active subscription (`update: sales`) changes one line's quantity, rate, rate unit, description or tax, or adds a new line, with:

- **Effective date** (≥ the subscription start; may be in the past within an open accounting period).
- **Effective from**: *From the change date* (default — prorated by day) or *From the next billing period* (the effective date snaps to the first day of the next period not yet started; nothing is prorated). Rillet `effective_from` `AS_OF_AMENDMENT_DATE` / `END_OF_CURRENT_BILLING_CYCLE`.

It inserts the new line (`amendsLineId` → the old line, `startDate` = effective date) and sets the old line's `endDate` = effective date − 1, in one transaction, then reconciles both lines' periods (§ Billing periods step 6). Removing a line is an amendment with no successor (end date only). A **preview** shows the resulting adjustment and next-invoice lines before saving (Rillet amendment preview), computed by the same pure function.

### Cancellation

**Cancel** (`update: sales`) asks for an **end date** (default: the end of the current billing period, so nothing is credited), a **reason**, and — only when the end date falls inside a period already billed in advance — **Credit unused time** (default off). It sets `endDate`, `cancelledAt`, `cancellationReason`, ends every open line at the end date, and reconciles: unbilled periods after the end date are removed; a billed-in-advance period crossing it produces adjustment rows when (and only when) *Credit unused time* is on; those rows are drafted into one credit memo (§ Posting). A cancellation can be reverted (end date cleared) until the end date passes and only if no credit memo was posted.

### Sales order → subscription

**Create Subscription** on a sales order (`create: sales`) offers the order's **Service** lines; the user ticks the recurring ones and supplies rate unit, billing frequency and start date (defaulting from the lines' service start dates). It creates a Draft subscription with those lines (`subscriptionLine.salesOrderLineId`), `subscription.salesOrderId`, and copies customer, payment term, currency and customer reference. Those order lines are then **billed by the subscription**: the sales order → invoice conversion skips any order line referenced by a subscription line, and the order's invoiced-status rollup counts them as invoiced, so the order can complete while its other lines (a one-off setup fee) invoice from the order as usual.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | What a line bills | Service items only; recurring goods and usage-based billing out of v1 | Q1. Recurring goods need shipping and stock (a recurring sales order); usage is a separate later layer at every competitor |
| 2 | Rate unit vs billing frequency | Separate: line rate per Day / Week / Month / Quarter / Year; subscription invoiced every Week / Month / Quarter / Year | Q2, Q2b. BC billing base period vs rhythm, Rillet price interval vs contract invoicing, the rental `rateUnit` vs `billingCycle` split |
| 3 | Alignment | Per subscription, Anniversary default, Calendar optional with prorated first period | Q3. Research consensus (NetSuite, SAP SSB, Stripe, Chargebee, BC) |
| 4 | Proration | By day, exact (no whole-unit rounding) | Subscription convention (NetSuite Prorate By Day, BC, Stripe); rental whole-unit rounding is a rental-pricing rule |
| 5 | Grouping | One invoice per subscription per run | Q4. Stripe, Odoo, Acumatica; rentals; consolidation is a later layer |
| 6 | Automation | Per-subscription invoice delivery: Draft (default) / Email / Stripe | Q5. Xero "Approve for sending", Odoo, F&O post automatically; draft-for-review everywhere |
| 7 | Unattended send identity | Mail from `SMTP_FROM`, reply-to the sales person, else the activator; Stripe customer linked once at activation | Codebase: `email.server.ts` already sends from `SMTP_FROM` with the poster as `replyTo`; Stripe preflight requires a confirmed link |
| 8 | Changes | Amendment lines replacing a line from a date; prorated by default, or from the next period | Q6, Q11. Rillet amendments + `effective_from`, Stripe proration behaviour, NetSuite change orders |
| 9 | Adjustment basis | Amount actually billed × unused days ÷ billed days | Stripe flexible billing mode; never credits money that was not billed |
| 10 | Cancellation | Chosen end date, default end of current period; optional prorated credit as a customer credit memo | Q7, Q7b. Chargebee / F&O credit options; `memo` already exists with a source-specific reason-account branch |
| 11 | Renewal | Optional term; Renew (same length, optional uplift %) or End | Q8. NetSuite Extend + Uplift, BC subsequent term + price update, Chargebee contract terms |
| 12 | Migration | Optional *Billed through* date; earlier periods Billed Externally | Q10. Rillet `REVENUE_RECOGNITION_ONLY`, F&O stubbing |
| 13 | Origin | Standalone + Create Subscription from chosen sales-order Service lines | Q9, Q9b. No double billing: converted lines leave the order's invoicing |
| 14 | Billing engine of record | Carbon. Stripe only delivers and collects each posted invoice (one-off Connect invoices), never a Stripe Subscription | Two engines for one contract double-bill; existing Connect path |
| 15 | Revenue | Existing Service-line deferral, by day over the period; any currency | Codebase: `post-sales-invoice` Service deferral posts in base; Rillet `DAILY`. `EVEN_PERIOD` out of v1 |
| 16 | Invoice line provenance | Line → `subscriptionId`, `subscriptionLineId`, `subscriptionBillingPeriodId` + service dates | Stripe `parent.subscription_item_details`; Rillet's missing link is the gap to avoid |
| 17 | Shared engine | Generic period reconciliation extracted from `rental-billing.ts`; subscription pricing in its own pure module | Reuse without changing rental pricing; both pinned by tests |
| 18 | Post pipeline | Moves from the ERP route into `@carbon/jobs/invoicing`, called by route and job | Dependency direction already ERP → jobs → documents / stripe |
| 19 | Module | Inside `sales` (`sales.models.ts` / `sales.service.ts` / `sales.server.ts`, `ui/Subscriptions/`) | Heuristic 6; rental agreements precedent; a feature is not a module |
| 20 | Multi-tenancy (H1) | Every new table `companyId` + `PRIMARY KEY ("id","companyId")` + `id('prefix')` | `.claude/rules/conventions-database.md` |
| 21 | Service shape (H2) | `client` first, `{ data, error }`, MCP-safe guards (Draft-only edits, explicit field picks) like the rental writers | `.claude/rules/conventions-services.md`; rental `upsertRentalAgreementLine` precedent |
| 22 | RLS (H3) | `company("sales", { read: "sales_view" })` in `authz/manifest.ts`, shipped with `authz migration` | `.claude/rules/authz-manifest.md`; rental tables |
| 23 | Permissions (H4) | Subscription CRUD / amend / cancel: `sales_*`. Generate invoices, and activating with Email / Stripe delivery: also `create: invoicing` | Rental "Generate Invoices" precedent; auto-posting is an invoicing act |
| 24 | Forms (H5) | `ValidatedForm` + zod: `subscriptionValidator`, `subscriptionLineValidator`, `subscriptionAmendmentValidator`, `subscriptionCancelValidator`, `createSubscriptionFromSalesOrderValidator` | `.claude/rules/conventions-forms.md` |
| 25 | Backward compatibility (H7) | Additive only: new tables/enums/columns; post-pipeline extraction keeps the route's behaviour; SO conversion change only affects lines linked to a subscription | No FROZEN surface changes; MCP digest regenerated for new service functions |
| 26 | Status model | `Draft → Active → Ended`; cancellation = end date + `cancelledAt` / reason | Rillet / Stripe distinguish requested vs actual end; avoids a second "Cancelled but still billing" state |

## Data Model Changes

Two migrations (enums first, per the ADD VALUE transaction rule; randomized HHMMSS), then `pnpm db:migrate`, `pnpm --filter @carbon/database authz migration subscriptions-rls`, `pnpm run generate:types`.

```sql
-- 1) Enums
CREATE TYPE "subscriptionStatus"           AS ENUM ('Draft', 'Active', 'Ended');
CREATE TYPE "subscriptionRateUnit"         AS ENUM ('Day', 'Week', 'Month', 'Quarter', 'Year');
CREATE TYPE "subscriptionBillingFrequency" AS ENUM ('Week', 'Month', 'Quarter', 'Year');
CREATE TYPE "subscriptionBillingAlignment" AS ENUM ('Anniversary', 'Calendar');
CREATE TYPE "subscriptionBillingTiming"    AS ENUM ('Advance', 'Arrears');
CREATE TYPE "subscriptionInvoiceDelivery"  AS ENUM ('Draft', 'Email', 'Stripe');
CREATE TYPE "subscriptionRenewal"          AS ENUM ('Renew', 'End');
CREATE TYPE "subscriptionAmendmentEffect"  AS ENUM ('Change Date', 'Next Period');
CREATE TYPE "subscriptionBillingPeriodStatus" AS ENUM ('Pending', 'Invoiced', 'Billed Externally');

-- 2) Header
CREATE TABLE "subscription" (
  "id" TEXT NOT NULL DEFAULT id('sub'),
  "companyId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,                    -- readable, sequence 'subscription' prefix SUB
  "status" "subscriptionStatus" NOT NULL DEFAULT 'Draft',
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "invoiceCustomerId" TEXT REFERENCES "customer"("id"),            -- bill-to, default customerPayment
  "invoiceCustomerContactId" TEXT REFERENCES "customerContact"("id"),
  "invoiceCustomerLocationId" TEXT REFERENCES "customerLocation"("id"),
  "salesPersonId" TEXT REFERENCES "user"("id"),
  "locationId" TEXT REFERENCES "location"("id"),
  "salesOrderId" TEXT,                                               -- origin, FK below
  "customerReference" TEXT,                                          -- PO number, copied onto every invoice
  "startDate" DATE NOT NULL,
  "endDate" DATE,                                                    -- NULL = open-ended; set by term or cancellation
  "termMonths" INTEGER CHECK ("termMonths" > 0),
  "renewal" "subscriptionRenewal" NOT NULL DEFAULT 'End',
  "renewalUplift" NUMERIC NOT NULL DEFAULT 0 CHECK ("renewalUplift" >= 0),   -- fraction, 0.05 = 5 %
  "billingFrequency" "subscriptionBillingFrequency" NOT NULL DEFAULT 'Month',
  "billingAlignment" "subscriptionBillingAlignment" NOT NULL DEFAULT 'Anniversary',
  "billingTiming" "subscriptionBillingTiming" NOT NULL DEFAULT 'Advance',
  "billedThrough" DATE,
  "invoiceDelivery" "subscriptionInvoiceDelivery" NOT NULL DEFAULT 'Draft',
  "paymentTermId" TEXT REFERENCES "paymentTerm"("id"),
  "currencyCode" TEXT NOT NULL,
  "notes" JSONB,
  "activatedAt" TIMESTAMP WITH TIME ZONE,
  "activatedBy" TEXT REFERENCES "user"("id"),
  "cancelledAt" TIMESTAMP WITH TIME ZONE,
  "cancellationReason" TEXT,
  "endedAt" TIMESTAMP WITH TIME ZONE,
  "lastBillingError" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "subscription_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "subscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "subscription_subscriptionId_key" UNIQUE ("subscriptionId", "companyId"),
  CONSTRAINT "subscription_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate" - 1),
  CONSTRAINT "subscription_billedThrough_check" CHECK ("billedThrough" IS NULL OR "billedThrough" >= "startDate")
);
-- indexes: companyId, customerId, status, salesOrderId, createdBy (+ every FK)

-- 3) Lines
CREATE TABLE "subscriptionLine" (
  "id" TEXT NOT NULL DEFAULT id('subl'),
  "companyId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),       -- a Service item (service-layer check)
  "description" TEXT,
  "quantity" NUMERIC NOT NULL DEFAULT 1 CHECK ("quantity" > 0),
  "rate" NUMERIC NOT NULL CHECK ("rate" >= 0),
  "rateUnit" "subscriptionRateUnit" NOT NULL DEFAULT 'Month',
  "taxPercent" NUMERIC NOT NULL DEFAULT 0 CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1),
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "amendsLineId" TEXT,                                   -- the line this one replaces
  "amendmentEffect" "subscriptionAmendmentEffect",
  "salesOrderLineId" TEXT,                               -- origin; billed by the subscription
  "sortOrder" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "subscriptionLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "subscriptionLine_subscription_fkey" FOREIGN KEY ("subscriptionId", "companyId")
    REFERENCES "subscription"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "subscriptionLine_amends_fkey" FOREIGN KEY ("amendsLineId", "companyId")
    REFERENCES "subscriptionLine"("id", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "subscriptionLine_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate" - 1),
  CONSTRAINT "subscriptionLine_amendment_check" CHECK (("amendsLineId" IS NULL) = ("amendmentEffect" IS NULL))
);
CREATE UNIQUE INDEX "subscriptionLine_salesOrderLine_key"
  ON "subscriptionLine" ("salesOrderLineId", "companyId") WHERE "salesOrderLineId" IS NOT NULL;

-- 4) Billing periods
CREATE TABLE "subscriptionBillingPeriod" (
  "id" TEXT NOT NULL DEFAULT id('subp'),
  "companyId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "subscriptionLineId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "units" NUMERIC NOT NULL,                    -- in the line's rate unit, prorated by day
  "amount" NUMERIC NOT NULL,                   -- negative for a credit adjustment
  "dueOn" DATE NOT NULL,
  "isAdjustment" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" "subscriptionBillingPeriodStatus" NOT NULL DEFAULT 'Pending',
  "salesInvoiceLineId" TEXT,                   -- stamp (no FK, rental precedent)
  "memoId" TEXT,                               -- stamp when credited by a cancellation memo
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "subscriptionBillingPeriod_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "subscriptionBillingPeriod_line_fkey" FOREIGN KEY ("subscriptionLineId", "companyId")
    REFERENCES "subscriptionLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "subscriptionBillingPeriod_key" UNIQUE ("companyId", "subscriptionLineId", "periodStart", "isAdjustment"),
  CONSTRAINT "subscriptionBillingPeriod_dates_check" CHECK ("periodEnd" >= "periodStart")
);
CREATE INDEX "subscriptionBillingPeriod_due_idx" ON "subscriptionBillingPeriod" ("companyId", "status", "dueOn");

-- 5) Provenance on existing tables
ALTER TABLE "salesInvoice"      ADD COLUMN "subscriptionId" TEXT;
ALTER TABLE "salesInvoiceLine"  ADD COLUMN "subscriptionId" TEXT,
                                ADD COLUMN "subscriptionLineId" TEXT,
                                ADD COLUMN "subscriptionBillingPeriodId" TEXT;
ALTER TABLE "memo"              ADD COLUMN "subscriptionId" TEXT;
ALTER TABLE "revenueRecognitionSchedule" ADD COLUMN "memoId" TEXT;
-- (each with an ON DELETE SET NULL FK on (col, companyId) where the target has a composite key, + index)

-- 6) Sequence 'subscription' prefix 'SUB' size 6 for every company (seed + seed-company), and
--    view "subscriptions": s.* + customerName, lineCount, nextInvoiceDate (min Pending dueOn),
--    recurringAmountPerPeriod (Σ open lines' per-period amount), unbilledAmount.
```

RLS: `subscription`, `subscriptionLine`, `subscriptionBillingPeriod` each `company("sales", { read: "sales_view" })` in `packages/database/src/authz/manifest.ts`. Backups: new tenant tables are discovered automatically; `pnpm db:check:backups` regenerates `packages/jobs/manifests/schema.json` (no renames, so no `TABLE_RENAMES` entry). Demo datasets: one Active subscription per dataset in the sales slice so the list and detail screens have rows (floors measured into `coverage.ts`).

## API / Service Changes

**Pure (Deno + Node, unit-tested)** — `shared/subscription-billing.ts`: `billingGrid`, `periodUnits(rateUnit, start, end)`, `periodAmount`, `generateSubscriptionBillingPeriods({ subscription, line, through, existing })` returning `{ create, recut, adjustments }`, `previewInvoiceSchedule(subscription, lines, horizon)`, `renewalAmendments(subscription, lines, asOf)`; the shared reconciliation helper extracted from `rental-billing.ts`.

**Database package** — `@carbon/database/subscription-billing`: `createSubscriptionInvoicesForDuePeriods`, `releaseSubscriptionInvoiceStamps` (Draft invoice / line deletion un-stamps periods, the `releaseRentalInvoiceStamps` pattern), `applySubscriptionAmendment(trx, …)`, `cancelSubscription(trx, …)` (Kysely, one transaction each).

**Jobs** — `@carbon/jobs/invoicing` `postAndDeliverSalesInvoice({ invoiceId, companyId, actingUserId, notification, contactId, … })` extracted from the post route; `subscriptionBillingFunction` (cron). `deleteSalesInvoiceReleasingRentals` / `…LineReleasingRentals` also release subscription stamps (renamed `…ReleasingStamps`).

**Edge functions** — `post-sales-invoice`: accept negative Service lines with service dates (negative Deferral rows); `post-memo`: subscription branch (reason account = deferred revenue, negative Deferral rows linked to `memoId`); `convert` (sales order → invoice): skip order lines referenced by a subscription line.

**ERP service functions** (`sales.service.ts`, MCP tools, guarded like the rental writers): `getSubscriptions`, `getSubscription`, `insertSubscription`, `updateSubscription` (Draft only), `deleteSubscription` (Draft only), `getSubscriptionLines`, `upsertSubscriptionLine` (Draft only; item must be a Service item), `deleteSubscriptionLine` (Draft only), `getSubscriptionBillingPeriods`, `getSubscriptionInvoices`, `previewSubscriptionInvoices`. Server-only (`sales.server.ts`, Kysely): `activateSubscription`, `amendSubscription`, `cancelSubscription`, `generateSubscriptionInvoicesNow`, `createSubscriptionFromSalesOrder`.

**Routes** — `x+/sales+/subscriptions.tsx` (list), `x+/subscription+/new.tsx`, `$id.tsx` (shell), `$id.details.tsx`, `$id.lines.new.tsx`, `$id.$lineId.details.tsx`, `$id.activate.tsx`, `$id.amend.tsx`, `$id.cancel.tsx`, `$id.invoice.tsx`, `$id.delete.tsx`, `update.tsx` (properties panel field saves, the rental `update.tsx` pattern), `x+/sales-order+/$orderId.subscription.tsx`.

## UI Changes

Built with the `carbon-design` skill, mirroring rental agreements (`ui/Subscriptions/`):

- **Sales → Subscriptions** list (nav entry in the `Manage` group beside Rental Agreements): ID, customer, status, billing frequency, recurring amount per period, next invoice date, delivery, ends on.
- **Subscription page** — sales-order-style shell: header (status, *Activate*, *Generate Invoices*, *Amend*, *Cancel*, *Delete* while Draft); explorer of lines (*Add Line* while Draft); center: summary (lines with "10 × $40 per month", recurring total per period, next invoice, billed through), **Upcoming invoices** (the preview: next N invoices with their lines and periods, live while Draft), Billing Periods, Invoices and Credit Memos; **Properties** panel with every term (customer, bill-to, contact, sales person, start date, term and renewal + uplift, frequency, alignment, timing, billed through, delivery, payment term, currency, customer reference, notes, custom fields), editable while Draft.
- **Line form** — Service item, description, quantity, rate, **per** (Day / Week / Month / Quarter / Year), tax %, start / end (default the subscription's). The rate starts from the item's sale price; no rate-card lookup in v1.
- **Amend modal** — the line (or "New line"), new values, effective date, *From the change date* / *From the next billing period*, and a preview of the adjustment and the next invoice.
- **Cancel modal** — end date (default end of current period), reason, *Credit unused time* (shown only when the date falls inside an advance-billed period), with the credit amount previewed.
- **Sales order** — *Create Subscription* action (order has Service lines): tick lines, rate unit, frequency, start date.
- **Sales invoice** — a "From subscription SUB000012" link on invoices and lines with `subscriptionId`.
- **Docs** — new reference page `docs/content/docs/reference/subscriptions.mdx` (via `carbon-docs`), agent KB regenerated, glossary entries for *Subscription*, *Rate unit*, *Billing frequency*, *Billed through*, *Amendment*.

## Acceptance Criteria

- [ ] A Draft subscription for Acme (platform access 10 × $40 per Month, premium support 1 × $1,200 per Year), billed Monthly, Anniversary, Advance, start 15 March, shows upcoming invoices of $500.00 (400 + 100) on 15 Mar, 15 Apr, 15 May before activation.
- [ ] The same subscription with Calendar alignment previews a first invoice for 15–31 March of $274.19 (400 × 17/31 + 100 × 17/31) and $500.00 on 1 April.
- [ ] A line at $10 per Day on a Monthly subscription invoices $310.00 for a 31-day month and $280.00 for February 2027.
- [ ] Activating cuts billing periods through the next period; the daily job (run with `asOf` = 15 March) drafts exactly one invoice with two Service lines whose service dates are 15 Mar–14 Apr; re-running the job drafts nothing.
- [ ] With accounting enabled, posting that invoice credits Deferred Revenue and writes Deferral rows per month; the April recognition run releases revenue for 1–14 April only.
- [ ] Delivery *Post and email*: the job posts the invoice and emails the invoice contact with the PDF link, reply-to the sales person; with a missing contact email activation is refused.
- [ ] Delivery *Post and send via Stripe*: activation requires the Stripe customer link; the job posts and sends through Connect; a Stripe failure leaves the invoice Draft, sets `lastBillingError` and notifies the sales person, and the next run does not draft a second invoice.
- [ ] Amend on 12 March (Calendar, monthly, March billed $400 for 10 seats) to 15 seats *From the change date*: the old line ends 11 March; the next invoice carries a credit of −$258.06 on the old line (400 × 20/31, from the amount billed) and $387.10 on the new line (15 × 40 × 20/31) for 12–31 March — net $129.04 on the invoice — plus April at $600.
- [ ] The same amendment *From the next billing period* produces no March line and April at $600.
- [ ] A reduction from 15 to 10 seats mid-period after April was billed at $600 produces a negative adjustment line on the next invoice computed from the $600 actually billed; posting it nets the April Deferral rows.
- [ ] Cancel with end date = end of the current period: no credit, the subscription shows "Ends {date}", stays Active, and becomes Ended after the final period is invoiced and the date passes.
- [ ] Cancel effective 20 September with *Credit unused time* on a September billed at $600: a Draft credit memo for $200.00 (600 × 10/30) linked to the subscription; posting it debits Deferred Revenue and writes negative Deferral rows for 21–30 September.
- [ ] A 12-month term starting 1 January with renewal *Renew* and uplift 5 %: on 1 January next year the end date extends 12 months and the lines bill at 1.05 × rate; with renewal *End* the subscription ends on 31 December.
- [ ] Billed through 30 April next year on an annual contract that started 1 May: periods through that date are *Billed Externally*, no invoice or revenue schedule is created for them, and the first Carbon invoice is dated 1 May next year.
- [ ] *Create Subscription* from a sales order with a setup-fee Service line and a monthly platform line, ticking only the platform line: the subscription has one line; invoicing the order bills only the setup fee; the order completes once the setup fee is invoiced.
- [ ] A foreign-currency (EUR) subscription posts with the deferral in base currency.
- [ ] Deleting a Draft subscription invoice returns its periods to Pending (the next run re-drafts them).
- [ ] A cron run where one company's billing throws still bills every other company, and the run output names the failed company.
- [ ] Rental billing tests (`rental-billing.test.ts`, `lessor.test.ts`) pass unchanged after the reconciliation helper is extracted.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Unattended posting sends a wrong invoice to a customer | High | Draft is the default; Email / Stripe need `create: invoicing` to activate; amounts come from the persisted, previewed periods; failures leave a Draft and notify |
| Extracting the post pipeline from the route regresses manual posting | High | Move code unchanged behind one function; the route becomes a thin caller; existing post-route tests + a browser check of Email and Stripe posting before merge |
| Negative Service lines / memo deferral reversal is new posting territory | Med | Mirror the rental negative-Rent pattern (negative Deferral rows); unit tests for the netting; journal balance assertions |
| Proration rounding drifts from the per-period total over a year | Low | Amounts rounded once per period at internal scale; settlement rounding on the invoice; tests with 28/29/30/31-day months |
| Double billing of sales-order lines converted to a subscription | Med | `convert` skips subscription-linked order lines; unique index on `salesOrderLineId`; acceptance test |
| Timezone: due dates evaluated in UTC instead of the company's day | Med | `asOf` = `datetime.today(getCompanyTimeZone(...))`, never `CURRENT_DATE` (`.claude/rules/date-handling.md`) |
| Rental and subscription engines diverge after the shared extraction | Low | One reconciliation helper, each engine's pricing in its own module, both test suites in CI |
| Subscription invoices synced to Rillet appear as one-time revenue | Low | Documented follow-up: send Rillet `FIXED_RECURRING` / `include_in_arr_mrr` and the line's revenue period |

## Out of scope (v1)

Usage-based / metered billing; recurring physical goods; per-customer invoice consolidation; customer- or type-specific subscription rate cards (the rental rate-card mechanism could be reused later); trials and pausing; discounts and coupons (use the rate); revenue pattern even-per-month (`EVEN_PERIOD`); Rillet recurring-revenue sync; dunning / auto-charge of a saved card (Stripe collects through the sent invoice).

## Open Questions

> All resolved with Brad on 2026-10-02 before this spec was written (`.ai/runs/2026-10-02-grill-subscriptions.md`).

- [x] **What can a subscription line bill?** — **Answer:** Service items only; recurring goods and usage-based billing out of v1.
- [x] **Billing frequencies** — **Answer:** Daily, Weekly, Monthly, Quarterly, Annually — as rate units; the invoice rhythm is Week / Month / Quarter / Year (next question).
- [x] **Price unit vs invoice rhythm** — **Answer:** Separate. Each line carries a rate per Day / Week / Month / Quarter / Year; the subscription is invoiced every Week / Month / Quarter / Year.
- [x] **Period alignment** — **Answer:** Choice per subscription, Anniversary by default, Calendar with a prorated first period.
- [x] **Invoice grouping** — **Answer:** One invoice per subscription per run.
- [x] **Invoice automation** — **Answer:** Per-subscription delivery: Draft for review (default) / Post and email / Post and send via Stripe.
- [x] **Mid-term changes** — **Answer:** Dated changes prorated by day; a period billed in advance is adjusted on the next invoice; a billed period is never rewritten.
- [x] **Cancellation** — **Answer:** Choose the end date (default end of current period); an earlier date can credit unused time, prorated.
- [x] **Form of a cancellation credit** — **Answer:** A Draft customer credit memo linked to the subscription; mid-term reduction credits ride the next invoice.
- [x] **Renewals and escalation** — **Answer:** In v1: optional term, Renew automatically (same length, optional uplift %) or End.
- [x] **Origin** — **Answer:** Standalone, plus Create Subscription from a sales order.
- [x] **Sales-order lines after conversion** — **Answer:** Chosen Service lines move to the subscription and leave the order's invoicing; other lines invoice from the order.
- [x] **Migrating contracts already billed elsewhere** — **Answer:** Optional *Billed through* date; earlier periods are Billed Externally.
- [x] **When an amendment takes effect** — **Answer:** Choice per amendment, *From the change date* (prorated, default) or *From the next billing period*.

## Changelog

- 2026-10-02: Created after research (`.ai/research/subscription-recurring-invoicing.md`, including the Rillet and Stripe API data models) and a 14-question interview.
