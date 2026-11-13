# @carbon/stripe

Stripe billing integration — checkout, subscriptions, webhooks, and customer sync. **Cloud edition only.**

## Always

- **Route all subscription state writes through `syncStripeDataToKV()`** — it's the single writer of `companyPlan` from Stripe; both webhook and GET re-sync funnel through it
- **Use `normalizePlanId()` before comparing plans** — DB stores partner tiers as `PARTNER-300/400/500`; normalize collapses onto `Plan.Partner`
- **Query `companyPlan` by `.eq("id", companyId)`** — the `id` column IS the company id (not a generated `id('cplan')`)
- **Guard for null `stripe` client** — `stripe` is `null` when `STRIPE_SECRET_KEY` is unset (non-Cloud); all functions must handle this

## Ask First

- Adding new Stripe webhook event handlers (coordinate with `processStripeEvent` flow)
- Changing plan catalog (`plan` table seeds) or price IDs
- Modifying the bypass mechanism (`STRIPE_BYPASS_COMPANY_IDS/USER_IDS`)

## Never

- Add subscription-status logic outside `syncStripeDataToKV` — it's the one source of truth
- Commit real Stripe price IDs or secrets — use test-mode overrides from `database/src/seed/stripe.ts`
- Skip signature verification in the webhook handler

## Validation Commands

```bash
pnpm --filter @carbon/stripe typecheck   # tsc --noEmit
pnpm --filter @carbon/stripe dev:stripe  # local Stripe listener (dev)
```

## Key Patterns

- **Exports**: `@carbon/stripe/stripe.server` (platform billing),
  `@carbon/stripe/connect.server` (Connect accounts, invoicing, Connect webhooks),
  `@carbon/stripe/connect.constants`, `@carbon/stripe/send-sales-invoice.server`
  (the send of a posted sales invoice, below) — all server-only — plus
  `@carbon/stripe/connect-invoice`, the pure line mapping (`toStripeInvoiceLines`,
  `expectedConnectInvoiceTotal`, no client or env), tested in
  `packages/jobs/src/invoicing/stripe-invoice-lines.test.ts`
- **Send a posted sales invoice**: `sendPostedSalesInvoiceViaStripe`
  (`send-sales-invoice.server.ts`) is the ONE send, shared by the ERP post operation
  (`postSalesInvoice`, `invoicing.server.ts`) and invoice automation
  (`sendPostedInvoiceViaStripe` in `@carbon/jobs` `src/invoicing/automate-invoice.ts`,
  the `Post and Send via Stripe` mode). The caller resolves and links the Stripe
  customer first. The mapping write is injected as `linkStripeInvoice`, so this
  package never depends on `@carbon/ee`. It throws when the invoice cannot be read,
  created, sent or linked; after the send, storing the PDF and writing the payment
  link to the notes are best-effort (a retry would create a SECOND Stripe invoice).
  Same file: `getStripeConnectAccountId` (null until onboarding can accept
  charges — `active` alone is not enough), `getLinkedStripeCustomerId`,
  `toStripeInvoiceLines` (re-exported from `connect-invoice`), `STRIPE_CONNECT_INTEGRATION`
- **Redis cache**: subscription state cached by customer ID; `companyPlan` is the durable mirror
- **GTM forwarding**: `gtm-events.server.ts` forwards invoice events to Google Tag Manager
- **User-based pricing**: `updateSubscriptionQuantityForCompany()` syncs active user count (excludes `@carbon.ms`)
- **Stripe API versions — two clients, on purpose**: every Connect call (v2
  accounts, and the v1 customers, tax rates, invoices, invoice payments, charges
  and login links on a connected account) goes through `stripeConnect` in
  `connect.server.ts` at `2026-07-29.dahlia`, the SDK's own version, so the SDK's
  types describe what Stripe returns. Platform billing (`stripe.server.ts`, the
  shared `stripe` client) stays on `2025-06-30.basil` behind a `@ts-expect-error`:
  its types are dahlia's while Stripe answers in basil, and the breaking changes
  between them are in billing (Discount `coupon` no longer expanded, flexible
  billing mode the default for new subscriptions, Checkout `ui_mode` values), so
  moving it is its own migration. Stripe's changelog lists no breaking change
  between the two for any object Connect uses. Since basil, `invoice.charge` /
  `invoice.payment_intent` do not exist — payments hang off `invoice.payments`
  (see `getConnectInvoicePaymentDetails`)
- **Webhook payload versions**: an endpoint's `api_version` is fixed when it is
  created, and Stripe never changes it; unset, events come in the account's
  default version. `stripe.register.ts` pins the platform endpoint to basil and
  the Connect endpoint to dahlia, and warns when an existing endpoint differs
  (recreate it to fix; it gets a new signing secret). `stripe.dev.ts` and
  `stripe.register.ts` subscribe the Connect endpoint to every event
  `webhook.stripe-connect.ts` handles: `invoice.paid`, `invoice.payment_succeeded`,
  `invoice.payment_failed`, `invoice.marked_uncollectible`, `invoice.voided`,
  `charge.refunded`, `charge.dispute.closed`, `account.updated`
- **Two webhook endpoints, two secrets**: the platform endpoint
  (`/api/webhook/stripe`, `STRIPE_WEBHOOK_SECRET`, verified inside
  `processStripeEvent`) and the Connect endpoint (`/api/webhook/stripe-connect`,
  `STRIPE_CONNECT_WEBHOOK_SECRET`, verified by `constructConnectWebhookEvent`).
  Connected-account events carry `event.account`; verifying one against the wrong
  secret always fails
- **Money conversion**: `toStripeAmount` / `fromStripeAmount` handle zero- and
  three-decimal currencies — never hand-roll `* 100`. Per-unit prices go through
  the SDK's branded `Stripe.Decimal` (`unit_amount_decimal` / `quantity_decimal`
  are `Decimal`, not `string`), never a rounded minor-unit integer
- **Sales invoice → Stripe invoice**: `createAndSendConnectInvoice` mirrors the
  `salesInvoices` view's arithmetic, which is the only definition of what a
  Carbon invoice is worth, in the INVOICE currency: `toStripeInvoiceLines` reads
  the line's `converted*` columns (the unprefixed ones are base currency), and
  the header `salesInvoiceShipment.shippingCost` is converted with
  `toDocumentAmount` at the currency's `decimalPlaces`. One Carbon line becomes up to four Stripe items
  (`unitPrice × quantity`, `addOnCost`, `shippingCost` — all taxable — plus an
  untaxed `nonTaxableAddOnCost`). The line discount (`discountPercent`, a fraction)
  is applied to the merchandise item only: `toStripeInvoiceLines` sends the NET unit
  price `convertedNetUnitPrice` unrounded and says "(20% off)" in the description;
  add-ons and shipping go at full price, and Stripe coupons are not used (a coupon
  discounts the whole invoice), and `salesInvoiceShipment.shippingCost` is a
  fifth, untaxed, invoice-level item. `setupPrice` is in neither the view's
  subtotal nor its tax base, so it is **not billed**. `salesInvoiceLine.taxPercent`
  is a FRACTION in [0,1] (a column CHECK) and must be ×100 for Stripe's
  `percentage`; rates are looked-up-or-created per connected account by
  `resolveConnectTaxRateId`. Before finalizing, the draft's Stripe-computed
  total is reconciled against `expectedConnectInvoiceTotal` and the draft is
  deleted rather than sent on a mismatch beyond per-item rounding. Every Stripe
  write of the send carries an idempotency key derived from
  `ConnectInvoiceInput.idempotencyKey` (`carbon-invoice-<account>-<invoiceId>`;
  `-item-<n>`, `-finalize`, `-send`), so a retry after Stripe succeeded replays
  the same invoice instead of creating a second one. Stripe keeps a key for 24
  hours and refuses a reused key whose parameters changed, so the send's
  parameters must not move with the clock: the due and issue dates are decided
  on whole company calendar days (`stripeDueDate` / `stripeEffectiveDate` in
  `connect-invoice.ts` — a due date on or before today, and an issue date of
  today or later, are left unset, never replaced with "now"). A retry that
  straddles the company's midnight can still change them; Stripe then refuses
  it (a safe failure, never a duplicate) until the key expires
- **Connect accounts**: `getOrCreateConnectAccount` creates the account from
  `STRIPE_CONNECT_ACCOUNT_CONFIG` (`connect.constants.ts`): full Stripe Dashboard,
  the seller pays Stripe's fees, Stripe carries losses. Stripe fixes the
  dashboard and responsibilities at creation, so accounts created before the
  switch from Express keep the Express dashboard and the platform keeps paying
  their fees and covering their losses. `getConnectDashboardUrl` reads the
  account's own `dashboard`: Express gets a single-use login link (Stripe makes
  login links for Express accounts only), full gets `https://dashboard.stripe.com/`,
  where the seller signs in with their own Stripe login
- **Connect customers**: `upsertConnectCustomer` (create/update),
  `retrieveConnectCustomer` (null on missing OR `deleted`, so a stale mapping
  degrades instead of throwing), `findConnectCustomersByEmail` (`customers.list`,
  NOT `customers.search` — search lags indexing and would duplicate a
  just-created customer; `limit: 2` so callers can detect ambiguity). Every call
  passes `{ stripeAccount }`; a platform-scoped call lands on the wrong account.
  `invoice_prefix` and `tax_id_data` are create-only (`tax_id_data` is absent
  from `CustomerUpdateParams` entirely — changing tax ids means
  `createTaxId`/`deleteTaxId`). `ConnectCustomerInput.taxExempt` is already in
  Stripe's vocabulary (`none`/`exempt`/`reverse`); interpreting Carbon's
  `customerTax` pair is the ERP's job, in
  `apps/erp/app/modules/invoicing/stripe-customer.mapper.ts`

## Cross-References

- `.claude/rules/billing-system.md` — full billing architecture
- `packages/ee/src/plan.ts` + `plan.server.ts` — feature/plan gating (`FEATURE_PLANS`)
- `apps/erp/app/routes/api+/webhook.stripe.ts` — platform webhook route
- `apps/erp/app/routes/api+/webhook.stripe-connect.ts` — Connect webhook route
- `packages/ee/src/stripe-connect/payment.server.ts` (exported as
  `@carbon/ee/stripe-connect.server`) — `recordStripeConnectPayment`, the
  Connect payment → Carbon `payment` recorder
- `packages/database/supabase/migrations/*billing*.sql` — schema
