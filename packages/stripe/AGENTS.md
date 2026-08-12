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
pnpm --filter @carbon/stripe typecheck   # tsgo --noEmit
pnpm --filter @carbon/stripe dev:stripe  # local Stripe listener (dev)
```

## Key Patterns

- **Exports**: `@carbon/stripe/stripe.server` (platform billing),
  `@carbon/stripe/connect.server` (Connect accounts, invoicing, Connect webhooks),
  `@carbon/stripe/connect.constants` — all server-only
- **Redis cache**: subscription state cached by customer ID; `companyPlan` is the durable mirror
- **GTM forwarding**: `gtm-events.server.ts` forwards invoice events to Google Tag Manager
- **User-based pricing**: `updateSubscriptionQuantityForCompany()` syncs active user count (excludes `@carbon.ms`)
- **Stripe API version**: `2025-06-30.basil` on the shared v1 `stripe` client
  (`2026-07-29.dahlia` on the v2 `stripeConnect` client used for account management).
  On basil, `invoice.charge` / `invoice.payment_intent` no longer exist — payments
  hang off `invoice.payments` (see `getConnectInvoicePaymentDetails`)
- **Two webhook endpoints, two secrets**: the platform endpoint
  (`/api/webhook/stripe`, `STRIPE_WEBHOOK_SECRET`, verified inside
  `processStripeEvent`) and the Connect endpoint (`/api/webhook/stripe-connect`,
  `STRIPE_CONNECT_WEBHOOK_SECRET`, verified by `constructConnectWebhookEvent`).
  Connected-account events carry `event.account`; verifying one against the wrong
  secret always fails
- **Money conversion**: `toStripeAmount` / `fromStripeAmount` handle zero- and
  three-decimal currencies — never hand-roll `* 100`

## Cross-References

- `.claude/rules/billing-system.md` — full billing architecture
- `packages/ee/src/plan.ts` + `plan.server.ts` — feature/plan gating (`FEATURE_PLANS`)
- `apps/erp/app/routes/api+/webhook.stripe.ts` — platform webhook route
- `apps/erp/app/routes/api+/webhook.stripe-connect.ts` — Connect webhook route
- `apps/erp/app/modules/invoicing/invoicing.server.ts` —
  `recordStripeConnectPayment`, the Connect payment → Carbon `payment` recorder
- `packages/database/supabase/migrations/*billing*.sql` — schema
