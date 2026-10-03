# Grill — subscriptions / recurring invoicing (spec in design)

> Complete. Q1–Q11 produced the Subscriptions draft; U1–U4 (unify with rental invoice automation) and G1–G9 (generalized AR contracts) re-scoped it. All carried into `.ai/specs/2026-10-02-contracts.md`.

Resolutions carried into `.ai/specs/2026-10-02-contracts.md` (originally drafted as `2026-10-02-subscriptions.md`).
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

## Unification with rental invoice automation (2026-10-02, after the spec was written)

Context: `.ai/specs/2026-10-02-rental-invoice-automation.md` + its plan (not started, 23 open
tasks) independently design the same post / send / hold / notify layer for rentals.

- [x] **U1 — One layer or two?** — **Answer:** Unify. One recurring-invoicing layer: billing
  *sources* (rental agreements, subscriptions) generate periods and draft invoices and declare
  their own holds; ONE shared pipeline (claim, hold checks, post, send, `sentAt` / `sendError`,
  VOID re-bill holds, digest) in `packages/jobs/src/invoicing/`, one mode list, one Settings →
  Invoicing page. The rental automation spec + plan are renamed to source-agnostic names before
  any code exists and still ship first (rentals only); the subscription spec drops its own
  delivery / post-extraction / sender sections and plugs in as the second source.
- [x] **U2 — Where the mode is set** — **Answer:** One company default for all recurring invoices
  (`companySettings.invoiceAutomation`, default `Post and Email`, on Settings → Invoicing) plus a
  nullable per-document override (`rentalAgreement.invoiceAutomation`,
  `subscription.invoiceAutomation`; NULL = company default). Supersedes subscription-spec Q5's
  "per subscription, Draft by default".
- [x] **U3 — Reply-to on automatic emails** — **Answer:** `companySettings.accountsReceivableEmail`,
  else the document's owner (sales person, else creator) — the same owner the digest uses. From
  stays `"<Company name>" <DEFAULT_FROM>`. Refines rental D13 ("else the agreement creator") and
  supersedes the subscription spec's "sales person, else activator".
- [x] **U4 — Daily job** — **Answer:** One `recurring-billing` job: per company (isolated step),
  draft every source (rental agreements now; subscriptions when built), run the shared
  automation over all drafted invoices, send ONE digest per owner. The `rental-billing` cron is
  renamed now.
- Settled with U1 (no question): `Post and Send via Stripe` joins the shared mode list when the
  Stripe branch is built (subscription work, `ALTER TYPE … ADD VALUE`), and is then available
  to rental agreements too — the rental plan does not build Stripe.

## Generalized AR contracts (2026-10-02, from Rillet's Contract screens)

Rillet's Contract (General Details → Products → Invoicing → Revenue → Summary): customer +
shipping customer, contract type (New Sales …), close date, PO number, start + duration presets
(6 mo / 1–3 yr / open-ended / custom) → end date, currency; product lines of any pricing type
(One-time / Fixed recurring / Usage) with price × qty, customer-facing description, own dates +
go-live, "Over Contract Term" / "Adjust Contract Term", tax, discount (% or $), dimensions,
revenue account; invoicing = frequency + first invoice date + payment terms + bill/ship-to +
email recipients + an EDITABLE invoice breakdown (dates and totals); revenue = per-line pattern
(Daily | Even Period, prorated first & last) + an EDITABLE monthly revenue schedule; summary of
invoiced / recognized / deferred per month. Billing and revenue are independent schedules on the
same lines (a one-time $1.8M item invoiced once, recognized $300k/month over six months).

- [x] **G1 — AP side** — **Answer:** Nothing on the purchasing side for now (Rillet has none).
  Prepaid expenses and repeating supplier bills remain a documented gap, out of scope.
- [x] **G2 — Contract scope** — **Answer:** A generalized AR **Contract** replaces the
  "Subscription" document: services, SaaS and one-time items on one contract, with independent
  billing and revenue schedules. Rental agreements stay a separate document (fleet custody,
  deliver / return, out of service, lease classification) and share the recurring-invoicing
  layer (U1–U4); merging them is a later option, not blocked by either.
- [x] **G3 — Contract line kinds** — **Answer:** One-time and Recurring lines, Service items only
  (setup fees, implementation, prepaid licences, platform access, support). Physical goods stay
  on sales orders (shipping, stock), linkable to the contract. Usage out of v1. Extends Q1.
- [x] **G4 — Invoice schedule** — **Answer:** Computed from frequency + first invoice date
  (one-time lines on the first invoice), then editable while Draft — move a date, split or merge
  invoices, bill a one-time line later — with each line's billed total conserved (Rillet
  "redistribution only").
  - Settled by the model: an open-ended contract's schedule is editable only within the cut
    horizon; an amendment regenerates the unbilled schedule from its effective date, resetting
    manual edits after it (the user is warned).
- [x] **G4b — Editable schedule for rentals?** — **Answer:** No. Rentals get the shared read-only
  "Upcoming invoices" preview; their schedule stays driven by terms, deliveries and returns.
  Reasons: returns / holdover / rolling periods re-cut the schedule and would overwrite edits;
  a unit treated as a sale must bill exactly the level payment × whole periods its net
  investment was valued on (`salesTypeRequirementError`); rent automation relies on invoices
  being fully determined by the terms. Revisit narrowly (Rental-treated units on fixed terms)
  if a real case appears.
- [x] **G5 — Revenue per line** — **Answer:** A revenue pattern per line — *Daily* or *Even per
  month, prorated first & last* (Rillet `DAILY` / `EVEN_PERIOD`) — over revenue start / end
  dates that default to the line's (a go-live date can push the start). A read-only per-month
  revenue preview and an invoiced / recognized / deferred summary. Hand-edited revenue
  schedules are out of v1.
  - Settled by the model (supersedes the subscription spec's "plain Service-line deferral, no
    new posting rules"): revenue follows the contract LINE, not the invoice, so a contract
    line's revenue schedule is generated at confirmation and posted by the recognition run;
    invoice posting for a contract line uses the rental revenue model already built
    (`rental-posting.ts` `planRentalLine`: consume accrued Contract Assets first, defer the
    rest; the run accrues earned-but-unbilled revenue to Contract Assets,
    `synthesizeRentalAccruals`), generalized from rental lines to contract lines. This is the
    "revenue arrangement" of `.ai/specs/2026-07-04-revenue-recognition.md` Phases 2–3, built
    from the billing side (no SSP allocation: each line's revenue is its own price).
- [x] **G6 — Contract type** — **Answer:** Types *New Sales*, *Existing*, *Expansion*,
  *Reactivation*, *Contraction*, suggested automatically and editable: first contract for the
  customer → New Sales; customer whose previous contracts all ended → Reactivation; a renewal →
  Existing; an amendment that raises / lowers recurring value → Expansion / Contraction. ARR /
  MRR reporting is a follow-up spec.
  - Settled by the model: the type belongs to the contract AND to each amendment, so an
    amendment is a small header (`contractAmendment`: date, reason, type, effective-from) that
    its replacement lines point at — Rillet's amendment carries `amendment_date` + reason the
    same way.
- [x] **G7 — Email recipients** — **Answer:** The document's invoice contact (To), CC the
  customer's default CC (else the company default CC) — the rental automation plan's rule, kept
  as the shared-layer rule for rentals and contracts. (All-customer-emails and an "invoice
  recipient" contact flag were considered and declined.)
- [x] **G8 — Line discounts** — **Answer:** A discount % per line (and per amendment line), shown
  on invoices as price + discount; a time-limited discount is an amendment that removes it at a
  date; revenue is the net amount.
- [x] **G9 — Revenue on migrated, already-billed periods** — **Answer:** Carbon recognizes it. A
  migrated contract carries *Billed through* (Q10) and *Recognize revenue from* (the migration
  date); its revenue schedule from that date releases the migrated Deferred Revenue opening
  balance month by month, and nothing before the date is touched. Requires the opening balance
  to sit in Deferred Revenue. Refines Q10 ("deferred revenue … arrives through the opening
  balance, not through the subscription").
- Settled by the codebase: tables are `customerContract*` (no `contract*` tables exist; only the
  unrelated `contractor`), leaving room for a supplier-side contract later; UI label "Contracts".
- Settled by the codebase: per-line manual dimensions (Rillet) are out of v1 — no Carbon sales
  document carries them; `post-sales-invoice` derives journal dimensions at posting.

## Handoff (2026-10-02)

- [x] **Split** — **Answer:** Contracts ship as two plans: Phase A (contracts, editable invoice
  schedule, invoicing via the shared layer, Stripe mode; interim revenue through the existing
  Service-line deferral) and Phase B (line-level revenue engine). Recorded in the spec's
  "Delivery phases".
- Order of work: (1) execute `.ai/plans/2026-10-02-rental-invoice-automation.md` (builds the
  shared recurring-invoicing layer, renamed to source-agnostic names, scope unchanged);
  (2) `/plan` contracts Phase A from `.ai/specs/2026-10-02-contracts.md`; (3) `/plan` Phase B.
- Not committed at handoff: contracts spec (renamed from subscriptions), rental automation spec +
  plan renames, rev-rec scope note, this record, the research file additions.
