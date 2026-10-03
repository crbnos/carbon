# Grill — subscriptions / recurring invoicing (spec in design)

> Complete: all 14 questions resolved; carried into `.ai/specs/2026-10-02-subscriptions.md`.

Resolutions carried into `.ai/specs/2026-10-02-subscriptions.md` when it is written.
Research: `.ai/research/subscription-recurring-invoicing.md`.

## Settled by the codebase (no question)

- Foreign currency: Service-line deferral in `post-sales-invoice` already posts in base
  (`amountBase: charges.amounts.salesRevenueBase`), so subscriptions are not restricted to
  base currency the way rental agreements are.

- From the Rillet / Stripe API review (`.ai/research/subscription-recurring-invoicing.md`):
  - Lines carry their own start/end dates, defaulting to the subscription's (Rillet item dates,
    Stripe per-item periods) — needed for mid-term add-ons and amendments.
  - A change is an **amendment line** pointing at the line it replaces (`amendsLineId`, Rillet
    `amending`); the replaced line is closed at the effective date, never edited once billed.
  - Adjustment credits are computed from the amount actually billed for the period, not the
    current rate (Stripe flexible billing mode).
  - An invoice line points at its subscription line and billing period and flags adjustments
    (Stripe `parent.subscription_item_details`; Rillet's missing link is the gap to avoid).
  - An upcoming-invoice schedule preview on the subscription before and after activation
    (Rillet `preview-invoice-schedule`), computed by the same pure function that cuts periods.
  - The subscription's customer PO reference is copied onto every invoice
    (`salesInvoice.customerReference`; Rillet `purchase_order_number`).
  - Carbon is the system of record for the subscription; "Post and send via Stripe" sends each
    posted invoice through the existing Connect path (one-off Stripe invoices), never a Stripe
    Subscription object — two billing engines for one contract would double-bill.
  - Revenue is spread by day over each line's service period (Carbon's existing
    `spreadStraightLine`, = Rillet `DAILY`); an even-per-month pattern (Rillet `EVEN_PERIOD`)
    is out of v1.
  - Syncing subscription invoices to Rillet as recurring revenue (today Carbon pushes every
    product `ONE_TIME`, `include_in_arr_mrr: false`) is a follow-up, out of v1.

## Resolved with the user

- [x] **Q1 — What can a subscription line bill?** — **Answer:** Service items only. Recurring
  physical goods (shipping, stock) are recurring sales orders, a different feature; usage-based
  (metered, in arrears) billing is out of v1.
- [x] **Q2 — Billing frequencies** — **Answer:** Daily, Weekly, Monthly, Quarterly, Annually.
  (Whether this is the invoice rhythm or the unit the rate is quoted in — see Q2b.)
- [x] **Q2b — Price unit vs invoice rhythm** — **Answer:** Separate (BC "billing base period" vs
  "billing rhythm"; the rental split of line `rateUnit` vs agreement `billingCycle`). Each line
  carries a rate per Day / Week / Month / Quarter / Year; the subscription is invoiced every
  Week / Month / Quarter / Year. €10/day invoiced monthly = one invoice per month for the days
  in it.
- [x] **Q3 — Period alignment** — **Answer:** A choice per subscription, Anniversary by default
  (periods run from the start date, no proration) or Calendar (aligned to the 1st of the
  month / quarter / year, first period prorated by days). Research consensus.
  - Settled by research + codebase: an anniversary on the 29th–31st clamps to the month's last
    day and returns to the anchor day when it exists (Stripe's rule; `@internationalized/date`
    `.add({ months })` clamps, `.claude/rules/date-handling.md`).
- [x] **Q4 — Invoice grouping** — **Answer:** One invoice per subscription per run (Stripe, Odoo,
  Acumatica; rental agreements today). Several services on one invoice = several lines on one
  subscription. Per-customer consolidation is out of v1.
- [x] **Q5 — Invoice automation** — **Answer:** A per-subscription setting, Draft by default:
  *Draft for review* (a person posts and chooses Email / Stripe, as rentals today) /
  *Post and email* / *Post and send via Stripe* (hosted invoice + payment link). The subscription
  stores the invoice contact, and for Stripe the linked Stripe customer, confirmed once at
  activation (the existing `preflightStripeSend` link step).
  - Settled by the codebase: mail already goes out from `SMTP_FROM` with the poster as
    `replyTo` (`packages/lib/src/email.server.ts`, `send-email.ts`). An automatic send uses the
    subscription's sales person as reply-to, falling back to the user who activated it.
- [x] **Q6 — Mid-term changes** — **Answer:** Dated changes, prorated by day (NetSuite change
  orders, Stripe, Odoo upsell). A quantity or rate change carries an effective date; a period
  already billed in advance gets a prorated adjustment line on the next invoice (increase =
  charge, decrease = credit); unbilled and arrears periods are simply priced by day across the
  change. A billed period is never rewritten (the rental adjustment-row precedent).
- [x] **Q7 — Cancellation** — **Answer:** Cancel asks for an end date, defaulting to the end of
  the current period (nothing to credit). An earlier date offers a *Credit unused time* option
  that credits the unused prepaid days, prorated (Chargebee credit options, F&O issue credit,
  Stripe `cancel_at_period_end` as the default).
- [x] **Q7b — Form of a cancellation credit** — **Answer:** A Draft customer credit memo (the
  existing `memo`), linked to the subscription, applied or refunded like any memo. Mid-term
  reduction credits (Q6) still ride the next invoice as negative lines.
- [x] **Q8 — Renewals and escalation** — **Answer:** In v1. A subscription is open-ended or has
  a term (e.g. 12 months); at term end it either *Renews automatically* (same term length,
  every line's rate raised by an optional uplift %) or *Ends*. Renewal is applied by the daily
  job as a dated rate change effective the new term's first day (the Q6 mechanism), so a
  renewed term never rewrites a billed period (NetSuite Extend + Uplift, BC subsequent term +
  price update, Chargebee contract terms).
- [x] **Q9 — Origin** — **Answer:** Subscriptions are created standalone (like rental
  agreements), and *Create Subscription* on a sales order turns chosen Service lines into one.
- [x] **Q9b — Sales-order lines after conversion** — **Answer:** The user picks which Service
  lines become the subscription; those lines are marked billed-by-subscription and drop out of
  the order's own invoicing (no double billing). The order's other lines (e.g. a one-off setup
  fee) invoice from the order as usual.
- [x] **Q10 — Migrating contracts already billed elsewhere** — **Answer:** A subscription has an
  optional *Billed through* date. It keeps its real start date and term; periods ending on or
  before that date are recorded as billed elsewhere (no invoice, no revenue schedule), and the
  first Carbon invoice is the first period after it (Rillet `REVENUE_RECOGNITION_ONLY`, F&O
  stubbing). Deferred revenue already booked in the old system arrives through the opening
  balance, not through the subscription.
- [x] **Q11 — When an amendment takes effect** — **Answer:** A choice per amendment, *From the
  change date* (prorated by day — the Q6 behaviour, and the default) or *From the next billing
  period* (no proration). Rillet `effective_from` `AS_OF_AMENDMENT_DATE` /
  `END_OF_CURRENT_BILLING_CYCLE`; Stripe `proration_behavior`.
